import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Payments that have consumed this month's budget or are about to.
 *
 * Pending ones count: a queue of approvals must not be able to collectively
 * overshoot the cap while each one individually looks affordable. The gate
 * decides with this list, so every screen has to report with it too — a
 * number on a budget panel that disagrees with the number the gate enforces
 * is worse than no number, because it gets believed.
 */
export const CONSUMING = ["pending_approval", "executing", "executed"] as const;

/** Caps are monthly, and the month is UTC so it does not move with a laptop. */
export function startOfMonthUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface MonthSpend {
  /** Money that has actually left, or is leaving right now. */
  paid: bigint;
  /** Money promised to an approval queue. It is spoken for, but still here. */
  pending: bigint;
  /** What the gate measures the next payment against. */
  consumed: bigint;
  capMonthly: bigint | null;
  /**
   * Cap minus consumed, never below zero.
   *
   * Clamped because a negative "left this month" is not information a reader
   * can use — the interesting fact is that there is nothing left, and the
   * overshoot is visible in the bar. `null` when the role has no monthly cap,
   * which is a different thing from zero and must not render as one.
   */
  remaining: bigint | null;
  /** Consumed as a fraction of the cap, uncapped so overshoot stays visible. */
  fraction: number | null;
}

const ZERO: Omit<MonthSpend, "capMonthly" | "remaining" | "fraction"> = {
  paid: 0n,
  pending: 0n,
  consumed: 0n,
};

/**
 * What each role has spent this month, split by whether it is gone or merely
 * spoken for.
 *
 * Split rather than summed because the two are different promises. 900 USDC
 * awaiting approval is still in the wallet — the balance proves it — and yet
 * the gate will refuse the next payment as though it were already gone. A
 * panel that shows only the total makes the wallet balance look wrong; one
 * that shows only what is paid makes the refusal look arbitrary.
 */
export async function monthSpend(
  roles: Array<{ id: string; capMonthly: string | null }>,
): Promise<Map<string, MonthSpend>> {
  const result = new Map<string, MonthSpend>();
  if (roles.length === 0) return result;

  const rows = await db
    .select({
      roleId: schema.payments.roleId,
      status: schema.payments.status,
      total: sql<string>`coalesce(sum(${schema.payments.amount}), 0)`,
    })
    .from(schema.payments)
    .where(
      and(
        inArray(
          schema.payments.roleId,
          roles.map((r) => r.id),
        ),
        inArray(schema.payments.status, [...CONSUMING]),
        gte(schema.payments.createdAt, startOfMonthUTC()),
      ),
    )
    .groupBy(schema.payments.roleId, schema.payments.status);

  for (const role of roles) {
    const mine = rows.filter((r) => r.roleId === role.id);
    const sum = (statuses: string[]) =>
      mine
        .filter((r) => statuses.includes(r.status))
        .reduce((total, r) => total + BigInt(r.total), 0n);

    const paid = sum(["executed", "executing"]);
    const pending = sum(["pending_approval"]);
    const consumed = paid + pending;
    const capMonthly = role.capMonthly === null ? null : BigInt(role.capMonthly);

    result.set(role.id, {
      ...ZERO,
      paid,
      pending,
      consumed,
      capMonthly,
      remaining:
        capMonthly === null
          ? null
          : consumed > capMonthly
            ? 0n
            : capMonthly - consumed,
      fraction:
        capMonthly === null || capMonthly === 0n
          ? null
          : Number(consumed) / Number(capMonthly),
    });
  }

  return result;
}

/**
 * What each member has put through the gate this month, across every role.
 *
 * The roles view answers "is this budget holding"; this answers "who is
 * spending it". Both are the same events counted on a different axis, and an
 * accountability product that can only do the first one is asking the reader
 * to reconcile a ledger by hand.
 */
export async function memberSpend(
  memberIds: string[],
): Promise<Map<string, { paid: bigint; pending: bigint }>> {
  const result = new Map<string, { paid: bigint; pending: bigint }>();
  for (const id of memberIds) result.set(id, { paid: 0n, pending: 0n });
  if (memberIds.length === 0) return result;

  const rows = await db
    .select({
      actorId: schema.payments.actorId,
      status: schema.payments.status,
      total: sql<string>`coalesce(sum(${schema.payments.amount}), 0)`,
    })
    .from(schema.payments)
    .where(
      and(
        inArray(schema.payments.actorId, memberIds),
        inArray(schema.payments.status, [...CONSUMING]),
        gte(schema.payments.createdAt, startOfMonthUTC()),
      ),
    )
    .groupBy(schema.payments.actorId, schema.payments.status);

  for (const row of rows) {
    const entry = result.get(row.actorId);
    if (!entry) continue;
    if (row.status === "pending_approval") entry.pending += BigInt(row.total);
    else entry.paid += BigInt(row.total);
  }

  return result;
}
