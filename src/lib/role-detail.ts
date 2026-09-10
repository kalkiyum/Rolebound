import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { verifyPayments } from "./indexer";

/** Mirrors the gate's definition — pending spend still counts against a month. */
const CONSUMING = ["pending_approval", "executing", "executed"] as const;

function startOfMonthUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function roleDetail(orgId: string, roleId: string) {
  const role = await db.query.roles.findFirst({
    where: and(eq(schema.roles.id, roleId), eq(schema.roles.orgId, orgId)),
  });
  if (!role) return null;

  const holders = await db
    .select({
      memberId: schema.members.id,
      displayName: schema.members.displayName,
      kind: schema.members.kind,
      capability: schema.grants.capability,
      grantedAt: schema.grants.grantedAt,
    })
    .from(schema.grants)
    .innerJoin(schema.members, eq(schema.members.id, schema.grants.memberId))
    .where(and(eq(schema.grants.roleId, roleId), isNull(schema.grants.revokedAt)));

  const rows = await db
    .select({
      id: schema.payments.id,
      amount: schema.payments.amount,
      toAddress: schema.payments.toAddress,
      reason: schema.payments.reason,
      status: schema.payments.status,
      txHash: schema.payments.txHash,
      createdAt: schema.payments.createdAt,
      blockedReason: schema.payments.blockedReason,
      approvalReason: schema.payments.approvalReason,
      actorName: schema.members.displayName,
      actorKind: schema.members.kind,
    })
    .from(schema.payments)
    .innerJoin(schema.members, eq(schema.members.id, schema.payments.actorId))
    .where(eq(schema.payments.roleId, roleId))
    .orderBy(desc(schema.payments.createdAt))
    .limit(50);

  const verdicts = await verifyPayments(
    rows.map((r) => ({ id: r.id, txHash: r.txHash, reason: r.reason, amount: r.amount })),
  );

  // What is left of the monthly cap, so the limit can be shown before it bites.
  let spentThisMonth: bigint | null = null;
  if (role.capMonthly !== null) {
    const [row] = await db
      .select({ spent: sql<string>`coalesce(sum(${schema.payments.amount}), 0)` })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.roleId, roleId),
          inArray(schema.payments.status, [...CONSUMING]),
          gte(schema.payments.createdAt, startOfMonthUTC()),
        ),
      );
    spentThisMonth = BigInt(row?.spent ?? "0");
  }

  return {
    role,
    holders,
    payments: rows.map((r) => ({
      ...r,
      verification: verdicts.get(r.id) ?? { state: "pending" as const },
    })),
    spentThisMonth,
  };
}
