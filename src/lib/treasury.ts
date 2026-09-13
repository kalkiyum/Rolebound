import "server-only";
import { and, eq } from "drizzle-orm";
import { encodeFunctionData } from "viem";
import { db, schema } from "@/db";
import { erc20TransferAbi } from "./abi";
import { logActivity } from "./activity";
import { roleBalances } from "./balances";
import { publicClient } from "./chain";
import { env } from "./env";
import { sendFromWallet } from "./wallets";

/**
 * Moving money from the treasury into a role.
 *
 * The recurring sweep has always done this when a schedule found its role
 * short, but only then — which left a role created outside the sweep with no
 * way to ever hold funds. A wallet that cannot be funded is a wallet that
 * cannot pay, so provisioning one from the UI without this would be half a
 * feature.
 *
 * Like the sweep's top-up, this is the treasury moving its own money rather
 * than a role spending: there is no cap to apply and no justification to
 * commit onchain, so it is a plain ERC-20 transfer and not a trip through
 * RoleboundPay. The caps exist to bound what a role may pay *out*; what it
 * holds is the treasury's decision.
 */

export type FundingDenyCode =
  | "bad_amount"
  | "no_such_role"
  | "role_dissolved"
  | "no_treasury"
  | "insufficient_treasury";

export class FundingDenied extends Error {
  constructor(
    readonly code: FundingDenyCode,
    message: string,
  ) {
    super(message);
    this.name = "FundingDenied";
  }
}

export async function fundRole(input: {
  orgId: string;
  roleId: string;
  amount: bigint;
  actorId?: string;
}): Promise<{ txHash: `0x${string}`; amount: bigint }> {
  const { orgId, roleId, amount } = input;

  if (amount <= 0n) {
    throw new FundingDenied("bad_amount", "Enter an amount above zero.");
  }

  const role = await db.query.roles.findFirst({
    where: and(eq(schema.roles.id, roleId), eq(schema.roles.orgId, orgId)),
  });
  if (!role) {
    throw new FundingDenied("no_such_role", "That role is not in this organization.");
  }
  if (role.status === "dissolved") {
    throw new FundingDenied(
      "role_dissolved",
      `${role.name} has been dissolved. Funding it would strand the money.`,
    );
  }

  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
  });
  if (!org?.treasuryWalletId || !org.treasuryAddress) {
    throw new FundingDenied(
      "no_treasury",
      "This organization has no treasury to fund from.",
    );
  }

  // Checked before signing rather than after reverting: a failed transfer
  // still costs gas and reads, in the feed, like something went wrong with
  // the product rather than like the treasury is simply empty.
  const balances = await roleBalances([org.treasuryAddress]);
  const available = balances.get(org.treasuryAddress.toLowerCase());
  if (available === null || available === undefined) {
    throw new FundingDenied(
      "no_treasury",
      "Could not read the treasury balance — the RPC is unreachable.",
    );
  }
  if (available < amount) {
    throw new FundingDenied(
      "insufficient_treasury",
      "The treasury does not hold that much.",
    );
  }

  const txHash = await sendFromWallet({
    walletId: org.treasuryWalletId,
    to: env.usdc,
    data: encodeFunctionData({
      abi: erc20TransferAbi,
      functionName: "transfer",
      args: [role.address as `0x${string}`, amount],
    }),
  });

  const receipt = await publicClient().waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction ${txHash} reverted`);
  }

  await logActivity({
    orgId,
    type: "role.funded",
    actorId: input.actorId ?? null,
    roleId: role.id,
    payload: { amount: amount.toString(), txHash, to: role.address },
  });

  return { txHash, amount };
}
