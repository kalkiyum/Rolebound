import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { verifyPayments, type Verification } from "./indexer";

export interface FeedEntry {
  id: string;
  type: string;
  at: Date;
  actorName: string | null;
  actorKind: "person" | "agent" | null;
  roleName: string | null;
  payload: Record<string, unknown> | null;
  /** Present for entries about a payment. */
  payment?: {
    id: string;
    amount: string;
    token: string;
    to: string;
    /** Plaintext, held here and nowhere else. The chain has only its hash. */
    reason: string;
    reasonHash: string;
    status: string;
    txHash: string | null;
    approvedBy: string | null;
    approvalReason: string | null;
    verification: Verification;
  };
}

/**
 * The accountability surface: who did what, under which role, and why.
 *
 * Payments carry a verification verdict alongside the reason, computed by
 * hashing the plaintext we hold and comparing it to what the chain recorded.
 * Rendering the reason without that verdict would be asking the reader to
 * trust our database, which is the thing the commitment exists to avoid.
 */
export async function orgFeed(orgId: string, limit = 50): Promise<FeedEntry[]> {
  const rows = await db
    .select({
      id: schema.activity.id,
      type: schema.activity.type,
      at: schema.activity.createdAt,
      payload: schema.activity.payload,
      subjectId: schema.activity.subjectId,
      actorName: schema.members.displayName,
      actorKind: schema.members.kind,
      roleName: schema.roles.name,
    })
    .from(schema.activity)
    .leftJoin(schema.members, eq(schema.members.id, schema.activity.actorId))
    .leftJoin(schema.roles, eq(schema.roles.id, schema.activity.roleId))
    .where(eq(schema.activity.orgId, orgId))
    .orderBy(desc(schema.activity.createdAt))
    .limit(limit);

  const paymentIds = rows
    .map((r) => r.subjectId)
    .filter((id): id is string => !!id);

  const payments = paymentIds.length
    ? await db
        .select()
        .from(schema.payments)
        .where(inArray(schema.payments.id, paymentIds))
    : [];

  const verdicts = await verifyPayments(
    payments.map((p) => ({
      id: p.id,
      txHash: p.txHash,
      reason: p.reason,
      amount: p.amount,
    })),
  );

  const byId = new Map(payments.map((p) => [p.id, p]));

  return rows.map((row) => {
    const payment = row.subjectId ? byId.get(row.subjectId) : undefined;

    return {
      id: row.id,
      type: row.type,
      at: row.at,
      actorName: row.actorName,
      actorKind: row.actorKind,
      roleName: row.roleName,
      payload: row.payload,
      payment: payment
        ? {
            id: payment.id,
            amount: payment.amount,
            token: payment.token,
            to: payment.toAddress,
            reason: payment.reason,
            reasonHash: payment.reasonHash,
            status: payment.status,
            txHash: payment.txHash,
            approvedBy: payment.approvedBy,
            approvalReason: payment.approvalReason,
            verification: verdicts.get(payment.id) ?? { state: "pending" },
          }
        : undefined,
    };
  });
}
