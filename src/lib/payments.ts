import "server-only";
import { encodeFunctionData, maxUint256 } from "viem";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { erc20Abi, roleboundPayAbi } from "./abi";
import {
  AuthorizationInvalid,
  hashReason,
  verifyAuthorization,
} from "./authorization";
import { publicClient } from "./chain";
import { env } from "./env";
import { assertCanSpend, SpendDenied, type SpendDecision } from "./gate";
import { roleIdToBytes32 } from "./ids";
import { logActivity } from "./activity";
import { sendFromWallet } from "./wallets";

export type PaymentOutcome =
  | { status: "executed"; paymentId: string; txHash: `0x${string}` }
  | { status: "pending_approval"; paymentId: string; because: string }
  | { status: "blocked"; paymentId: string; reason: string };

export interface PaymentRequest {
  orgId: string;
  roleId: string;
  memberId: string;
  to: `0x${string}`;
  amount: bigint;
  reason: string;
  /**
   * Present whenever a person pays from the browser. Absent for agents,
   * which authenticate with an API key, and for schedules, which run with
   * nobody at the keyboard. When it is present it is always verified.
   */
  actorSignature?: `0x${string}`;
  nonce?: string;
}

/**
 * The only way funds leave a role wallet.
 *
 * Every path — UI, agent API, scheduled retainer — comes through this
 * function, and this function's first act is to call the gate. A second
 * route to `sendFromWallet` would be a second place caps can be forgotten,
 * which is the exact failure this product exists to prevent.
 */
export async function requestPayment(
  req: PaymentRequest,
): Promise<PaymentOutcome> {
  // Who is asking comes before whether they may. A signature that arrives
  // and is not checked is worse than none: it puts a proof-shaped thing on
  // an audit trail that proves nothing.
  if (req.actorSignature) await verifyActor(req, req.actorSignature);

  let decision: SpendDecision;
  try {
    decision = await assertCanSpend({
      memberId: req.memberId,
      roleId: req.roleId,
      amount: req.amount,
      reason: req.reason,
      to: req.to,
    });
  } catch (err) {
    if (err instanceof SpendDenied) {
      // A refusal is not an error to swallow — it is the product working,
      // and it belongs in the record with everything else.
      await logActivity({
        orgId: req.orgId,
        type: "payment.blocked",
        actorId: req.memberId,
        roleId: req.roleId,
        payload: { code: err.code, amount: req.amount.toString(), to: req.to },
      });
    }
    throw err;
  }

  const reasonHash = hashReason(req.reason);

  const [payment] = await db
    .insert(schema.payments)
    .values({
      roleId: req.roleId,
      actorId: req.memberId,
      toAddress: req.to,
      token: env.usdc,
      amount: req.amount.toString(),
      reason: req.reason.trim(),
      reasonHash,
      actorSignature: req.actorSignature ?? null,
      nonce: req.nonce ?? null,
      status: decision.outcome === "execute" ? "executing" : "pending_approval",
    })
    .returning();

  if (decision.outcome === "needs_approval") {
    await logActivity({
      orgId: req.orgId,
      type: "payment.requested",
      actorId: req.memberId,
      roleId: req.roleId,
      subjectId: payment.id,
      payload: {
        because: decision.because,
        limit: decision.limit.toString(),
        requested: decision.requested.toString(),
      },
    });
    return {
      status: "pending_approval",
      paymentId: payment.id,
      because: decision.because,
    };
  }

  return executePayment({ orgId: req.orgId, paymentId: payment.id });
}

/**
 * Checks that the actor really did authorize *these terms*.
 *
 * The role wallet's key lives in Privy's enclave, so its signature says a
 * role paid and nothing about who asked it to. This one binds a named member
 * to this amount, this recipient and this justification — which is the whole
 * of what the activity feed claims. Recovering a different address, or a
 * signature over different terms, is a refusal rather than a warning.
 */
async function verifyActor(
  req: PaymentRequest,
  signature: `0x${string}`,
): Promise<void> {
  if (!req.nonce) {
    throw new AuthorizationInvalid(
      "A signed payment must carry the nonce it was signed with.",
    );
  }

  const signer = await actorAddress(req.memberId);
  if (!signer) {
    throw new AuthorizationInvalid(
      "This member has no wallet on file, so nothing can be checked against the signature.",
    );
  }

  await verifyAuthorization({
    authorization: {
      roleId: roleIdToBytes32(req.roleId),
      to: req.to,
      amount: req.amount,
      reasonHash: hashReason(req.reason),
      nonce: req.nonce,
    },
    signature,
    expectedSigner: signer,
  });
}

/**
 * Signs and broadcasts. Split from the decision above so an approved payment
 * lands here too, rather than re-deciding — the gate already ran, and running
 * it twice invites the two runs to disagree.
 */
export async function executePayment(input: {
  orgId: string;
  paymentId: string;
}): Promise<PaymentOutcome> {
  const payment = await db.query.payments.findFirst({
    where: eq(schema.payments.id, input.paymentId),
  });
  if (!payment) throw new Error(`No payment ${input.paymentId}`);

  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, payment.roleId),
  });
  if (!role) throw new Error(`Payment ${payment.id} has no role`);

  try {
    await ensurePayAllowance(role.privyWalletId, role.address as `0x${string}`);

    const data = encodeFunctionData({
      abi: roleboundPayAbi,
      functionName: "pay",
      args: [
        roleIdToBytes32(role.id),
        env.usdc,
        payment.toAddress as `0x${string}`,
        BigInt(payment.amount),
        payment.reasonHash as `0x${string}`,
        // The actor's own address when they have one. Falls back to the role
        // wallet so the event is never silently missing an actor.
        (await actorAddress(payment.actorId)) ?? (role.address as `0x${string}`),
      ],
    });

    const hash = await sendFromWallet({
      walletId: role.privyWalletId,
      to: env.payAddress,
      data,
    });

    const receipt = await publicClient().waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Transaction ${hash} reverted`);
    }

    await db
      .update(schema.payments)
      .set({ status: "executed", txHash: hash })
      .where(eq(schema.payments.id, payment.id));

    await logActivity({
      orgId: input.orgId,
      type: "payment.executed",
      actorId: payment.actorId,
      roleId: payment.roleId,
      subjectId: payment.id,
      payload: { txHash: hash, amount: payment.amount, to: payment.toAddress },
    });

    return { status: "executed", paymentId: payment.id, txHash: hash };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);

    await db
      .update(schema.payments)
      .set({ status: "blocked", blockedReason: reason })
      .where(eq(schema.payments.id, payment.id));

    await logActivity({
      orgId: input.orgId,
      type: "payment.blocked",
      actorId: payment.actorId,
      roleId: payment.roleId,
      subjectId: payment.id,
      payload: { reason },
    });

    return { status: "blocked", paymentId: payment.id, reason };
  }
}

async function actorAddress(memberId: string) {
  const member = await db.query.members.findFirst({
    where: eq(schema.members.id, memberId),
  });
  return (member?.address as `0x${string}` | null) ?? null;
}

/**
 * RoleboundPay moves funds with `transferFrom`, so the role wallet approves
 * it once and every payment afterwards is a single transaction. Checked
 * rather than assumed: a role funded outside the app has no allowance, and
 * discovering that at payment time is a confusing revert.
 */
export async function ensurePayAllowance(
  walletId: string,
  roleAddress: `0x${string}`,
) {
  const allowance = await publicClient().readContract({
    address: env.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [roleAddress, env.payAddress],
  });

  // Re-approve well before exhaustion rather than at zero, so a payment never
  // fails on an allowance that ran out mid-flight.
  if (allowance > maxUint256 / 2n) return;

  const hash = await sendFromWallet({
    walletId,
    to: env.usdc,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [env.payAddress, maxUint256],
    }),
  });
  await publicClient().waitForTransactionReceipt({ hash });

  // A mined receipt is not the same as readable state. Public RPCs are load
  // balanced, and the node that signs the payment is not the node that
  // returned this receipt — so the first payment from a freshly funded role
  // can be estimated against a node that still sees an allowance of zero,
  // and comes back as a bare `execution reverted` with nothing to act on.
  // Polling the value we are about to depend on costs a few hundred
  // milliseconds once per role, and turns a confusing failure into a wait.
  for (let attempt = 0; attempt < 10; attempt++) {
    const confirmed = await publicClient().readContract({
      address: env.usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [roleAddress, env.payAddress],
    });
    if (confirmed > maxUint256 / 2n) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(
    `Approved RoleboundPay in ${hash}, but the allowance is still not readable. The RPC may be lagging — retry the payment.`,
  );
}
