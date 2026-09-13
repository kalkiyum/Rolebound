import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { encodeFunctionData } from "viem";
import { db, schema } from "@/db";
import { roleboundPayAbi } from "./abi";
import { logActivity } from "./activity";
import { hashReason } from "./authorization";
import { describeCadence } from "./cadence";
import { roleBalances } from "./balances";
import { publicClient } from "./chain";
import { env } from "./env";
import { roleIdToBytes32 } from "./ids";
import { ensurePayAllowance } from "./payments";
import { sendFromWallet } from "./wallets";

/**
 * Closing a role.
 *
 * The question everyone asks straight after seeing offboarding: fine, the
 * person is gone — what happens to the role itself? A role is a wallet, so
 * dissolving one has to answer for the money in it, the standing payments
 * pointed at it, and the authority people still hold over it. Doing any of
 * those three and not the others leaves a live wallet nobody is watching.
 *
 * The sweep back to the treasury deliberately does NOT go through
 * `assertCanSpend()`. The cap governs what a role may *spend*, and returning
 * funds to the treasury they were issued from is not spending — a role
 * holding more than its own cap would otherwise be impossible to close. What
 * keeps that safe is that the destination is not a parameter: it is the
 * organization's own treasury address, read here and nowhere else.
 */

export class CannotDissolve extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CannotDissolve";
  }
}

const SWEEP_REASON = (roleName: string) =>
  `${roleName} was dissolved — remaining balance returned to the treasury`;

export interface DissolutionImpact {
  roleId: string;
  roleName: string;
  /** `null` when the chain could not be read; the screen says so. */
  balance: bigint | null;
  returnsTo: string | null;
  schedules: Array<{ id: string; reason: string; amount: bigint; when: string }>;
  holders: Array<{ memberId: string; displayName: string; capability: string }>;
  pendingPayments: Array<{ id: string; amount: bigint; reason: string }>;
}

export async function dissolutionImpact(input: {
  orgId: string;
  roleId: string;
}): Promise<DissolutionImpact> {
  const role = await loadRole(input);

  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, input.orgId),
  });

  const [balances, schedules, holders, pending] = await Promise.all([
    roleBalances([role.address]),
    db.query.schedules.findMany({
      where: and(
        eq(schema.schedules.roleId, role.id),
        eq(schema.schedules.status, "active"),
      ),
    }),
    db
      .select({
        memberId: schema.grants.memberId,
        displayName: schema.members.displayName,
        capability: schema.grants.capability,
      })
      .from(schema.grants)
      .innerJoin(schema.members, eq(schema.members.id, schema.grants.memberId))
      .where(
        and(eq(schema.grants.roleId, role.id), isNull(schema.grants.revokedAt)),
      ),
    db.query.payments.findMany({
      where: and(
        eq(schema.payments.roleId, role.id),
        eq(schema.payments.status, "pending_approval"),
      ),
    }),
  ]);

  return {
    roleId: role.id,
    roleName: role.name,
    balance: balances.get(role.address.toLowerCase()) ?? null,
    returnsTo: org?.treasuryAddress ?? null,
    schedules: schedules.map((s) => ({
      id: s.id,
      reason: s.reason,
      amount: BigInt(s.amount),
      when: describeCadence(s.cadence),
    })),
    holders,
    pendingPayments: pending.map((p) => ({
      id: p.id,
      amount: BigInt(p.amount),
      reason: p.reason,
    })),
  };
}

export interface DissolutionResult {
  swept: { txHash: `0x${string}`; amount: bigint } | null;
  cancelledSchedules: number;
  revokedGrants: number;
  closedPayments: number;
}

export async function dissolve(input: {
  orgId: string;
  roleId: string;
  actorId: string;
}): Promise<DissolutionResult> {
  const role = await loadRole(input);

  // Dissolving is bigger than any single payment, so it takes more than
  // spend authority. An approver in the organization is the closest thing
  // this product has to oversight, and requiring it here means no single
  // spender can quietly close the role they spend from.
  if (!(await isApproverInOrg(input.actorId, input.orgId))) {
    throw new CannotDissolve(
      "Dissolving a role takes approve authority somewhere in this organization.",
    );
  }

  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, input.orgId),
  });
  if (!org?.treasuryAddress || !org.treasuryWalletId) {
    throw new CannotDissolve(
      "This organization has no treasury to return the balance to.",
    );
  }

  // Money first. If the sweep fails the role stays open and the whole thing
  // can be tried again — the opposite order would strand funds in a wallet
  // nobody holds a grant on.
  const swept = await sweepToTreasury({
    role,
    treasury: org.treasuryAddress as `0x${string}`,
    actorId: input.actorId,
    orgId: input.orgId,
  });

  const cancelled = await db
    .update(schema.schedules)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.schedules.roleId, role.id),
        eq(schema.schedules.status, "active"),
      ),
    )
    .returning({ id: schema.schedules.id });

  const revoked = await db
    .update(schema.grants)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(schema.grants.roleId, role.id), isNull(schema.grants.revokedAt)),
    )
    .returning({ id: schema.grants.id });

  // A payment waiting on an approver can never be released now — approval
  // already refuses a dissolved role — so it is closed here rather than left
  // sitting on the approvals screen forever.
  const closed = await db
    .update(schema.payments)
    .set({
      status: "rejected",
      approvalReason: `${role.name} was dissolved before this could be approved.`,
    })
    .where(
      and(
        eq(schema.payments.roleId, role.id),
        eq(schema.payments.status, "pending_approval"),
      ),
    )
    .returning({ id: schema.payments.id });

  await db
    .update(schema.roles)
    .set({ status: "dissolved" })
    .where(eq(schema.roles.id, role.id));

  await logActivity({
    orgId: input.orgId,
    type: "role.dissolved",
    actorId: input.actorId,
    roleId: role.id,
    payload: {
      returned: swept ? swept.amount.toString() : "0",
      txHash: swept?.txHash ?? null,
      cancelledSchedules: cancelled.length,
      revokedGrants: revoked.length,
      closedPayments: closed.length,
    },
  });

  return {
    swept,
    cancelledSchedules: cancelled.length,
    revokedGrants: revoked.length,
    closedPayments: closed.length,
  };
}

async function loadRole(input: { orgId: string; roleId: string }) {
  const role = await db.query.roles.findFirst({
    where: and(
      eq(schema.roles.id, input.roleId),
      eq(schema.roles.orgId, input.orgId),
    ),
  });
  if (!role) throw new CannotDissolve("That role does not exist here.");
  if (role.status !== "active") {
    throw new CannotDissolve(`${role.name} has already been dissolved.`);
  }
  return role;
}

async function isApproverInOrg(memberId: string, orgId: string) {
  const [grant] = await db
    .select({ id: schema.grants.id })
    .from(schema.grants)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.grants.roleId))
    .where(
      and(
        eq(schema.grants.memberId, memberId),
        eq(schema.grants.capability, "approve"),
        isNull(schema.grants.revokedAt),
        eq(schema.roles.orgId, orgId),
      ),
    )
    .limit(1);
  return !!grant;
}

/**
 * Still through RoleboundPay, not a bare transfer: the reason for the move
 * is committed on chain like every other payment, so the closure is as
 * auditable as the spending was. It also lands in the payments table, which
 * is what makes it appear in the activity feed with a verified reason.
 */
async function sweepToTreasury(input: {
  role: typeof schema.roles.$inferSelect;
  treasury: `0x${string}`;
  actorId: string;
  orgId: string;
}) {
  const { role, treasury, actorId } = input;

  const balances = await roleBalances([role.address]);
  const balance = balances.get(role.address.toLowerCase());
  if (balance === null || balance === undefined) {
    throw new CannotDissolve(
      "Could not read the role's balance, so there is no safe way to close it yet.",
    );
  }
  if (balance === 0n) return null;

  const reason = SWEEP_REASON(role.name);
  const reasonHash = hashReason(reason);

  const [payment] = await db
    .insert(schema.payments)
    .values({
      roleId: role.id,
      actorId,
      toAddress: treasury,
      token: env.usdc,
      amount: balance.toString(),
      reason,
      reasonHash,
      status: "executing",
    })
    .returning();

  try {
    await ensurePayAllowance(role.privyWalletId, role.address as `0x${string}`);

    const hash = await sendFromWallet({
      walletId: role.privyWalletId,
      to: env.payAddress,
      data: encodeFunctionData({
        abi: roleboundPayAbi,
        functionName: "pay",
        args: [
          roleIdToBytes32(role.id),
          env.usdc,
          treasury,
          balance,
          reasonHash,
          role.address as `0x${string}`,
        ],
      }),
    });

    const receipt = await publicClient().waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);

    await db
      .update(schema.payments)
      .set({ status: "executed", txHash: hash })
      .where(eq(schema.payments.id, payment.id));

    await logActivity({
      orgId: input.orgId,
      type: "payment.executed",
      actorId,
      roleId: role.id,
      subjectId: payment.id,
      payload: { txHash: hash, amount: balance.toString(), to: treasury },
    });

    return { txHash: hash, amount: balance };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await db
      .update(schema.payments)
      .set({ status: "blocked", blockedReason: message })
      .where(eq(schema.payments.id, payment.id));

    throw new CannotDissolve(
      `Could not return the balance to the treasury, so the role is still open: ${message}`,
    );
  }
}
