import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { verifyPayments } from "./indexer";
import { monthSpend } from "./spend";

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

  // Computed for every role, not only capped ones. A role with no monthly cap
  // still spends money, and a budget panel that goes silent about it because
  // there is no limit to compare against is answering the wrong question:
  // "what is left" matters less than "what went out".
  const spend = (await monthSpend([role])).get(role.id)!;

  return {
    role,
    holders,
    payments: rows.map((r) => ({
      ...r,
      verification: verdicts.get(r.id) ?? { state: "pending" as const },
    })),
    spend,
  };
}
