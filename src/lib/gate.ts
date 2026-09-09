import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { grants, members, payments, roles } from "@/db/schema";

/**
 * THE GATE — PRD §4's single invariant.
 *
 * No signature is ever released without a live grant and a non-empty reason.
 * Every path that can reach the Privy signing API goes through this function,
 * including the agent endpoint. Do not write a second one: a parallel path
 * eventually grows parallel limits, which is the exact failure this product
 * exists to prevent.
 */

/** Hard refusals. The payment does not happen and no approver can wave it through. */
export type DenyCode =
  | "no_grant"
  | "role_dissolved"
  | "missing_reason"
  | "invalid_amount"
  | "recipient_not_allowed";

/** Soft limits, which route to an approver rather than refusing outright. */
export type ApprovalCode = "over_per_tx_cap" | "over_monthly_cap";

export class SpendDenied extends Error {
  constructor(
    readonly code: DenyCode,
    message: string,
  ) {
    super(message);
    this.name = "SpendDenied";
  }
}

export type SpendDecision =
  | { outcome: "execute" }
  | { outcome: "needs_approval"; because: ApprovalCode; limit: bigint; requested: bigint };

export interface SpendRequest {
  memberId: string;
  roleId: string;
  /** Token base units. */
  amount: bigint;
  reason: string;
  to: string;
}

/** Payments that have consumed budget or are about to. Pending ones count, so
 *  a queue of approvals cannot collectively overshoot the monthly cap. */
const CONSUMING = ["pending_approval", "executing", "executed"] as const;

function startOfMonthUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * "Does this member currently hold this authority on this role?"
 *
 * Exported because the approval path needs the same answer, and asking it a
 * second way is how the two eventually disagree — a member offboarded while
 * their payment sat pending would still get paid out. One query, both
 * callers.
 */
export async function liveGrant(
  memberId: string,
  roleId: string,
  capability: "spend" | "approve",
): Promise<{ id: string } | null> {
  const [grant] = await db
    .select({ id: grants.id })
    .from(grants)
    .where(
      and(
        eq(grants.roleId, roleId),
        eq(grants.memberId, memberId),
        eq(grants.capability, capability),
        isNull(grants.revokedAt),
      ),
    )
    .limit(1);

  return grant ?? null;
}

export async function assertCanSpend(req: SpendRequest): Promise<SpendDecision> {
  const reason = req.reason?.trim() ?? "";
  if (!reason) {
    throw new SpendDenied(
      "missing_reason",
      "Every payment needs a reason. Say what this is for.",
    );
  }
  if (req.amount <= 0n) {
    throw new SpendDenied("invalid_amount", "Enter an amount greater than zero.");
  }

  const [role] = await db.select().from(roles).where(eq(roles.id, req.roleId)).limit(1);
  if (!role) {
    throw new SpendDenied("no_grant", "That role no longer exists.");
  }
  if (role.status !== "active") {
    throw new SpendDenied(
      "role_dissolved",
      `${role.name} has been dissolved and can no longer spend.`,
    );
  }

  // Authority. `revokedAt IS NULL` is the whole of it — removing someone from a
  // role sets this column, and the next request stops here.
  const grant = await liveGrant(req.memberId, req.roleId, "spend");

  if (!grant) {
    const [member] = await db
      .select({ name: members.displayName })
      .from(members)
      .where(eq(members.id, req.memberId))
      .limit(1);
    throw new SpendDenied(
      "no_grant",
      `${member?.name ?? "That member"} is not currently in ${role.name}.`,
    );
  }

  // Recipient allowlist, when the role has one. Empty means unrestricted.
  if (role.allowedRecipients.length > 0) {
    const to = req.to.toLowerCase();
    const allowed = role.allowedRecipients.some((a) => a.toLowerCase() === to);
    if (!allowed) {
      throw new SpendDenied(
        "recipient_not_allowed",
        `${role.name} can only pay approved recipients. This address is not one of them.`,
      );
    }
  }

  // Per-transaction cap. Also enforced in the Privy enclave — this check exists
  // so the app can route to approval rather than let the signer refuse blindly.
  const capPerTx = BigInt(role.capPerTx);
  if (req.amount > capPerTx) {
    return {
      outcome: "needs_approval",
      because: "over_per_tx_cap",
      limit: capPerTx,
      requested: req.amount,
    };
  }

  // Monthly cap. Application-layer only; the enclave knows nothing about months.
  if (role.capMonthly !== null) {
    const capMonthly = BigInt(role.capMonthly);
    const [row] = await db
      .select({ spent: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(
        and(
          eq(payments.roleId, req.roleId),
          inArray(payments.status, [...CONSUMING]),
          gte(payments.createdAt, startOfMonthUTC()),
        ),
      );

    const spent = BigInt(row?.spent ?? "0");
    if (spent + req.amount > capMonthly) {
      return {
        outcome: "needs_approval",
        because: "over_monthly_cap",
        limit: capMonthly,
        requested: spent + req.amount,
      };
    }
  }

  return { outcome: "execute" };
}
