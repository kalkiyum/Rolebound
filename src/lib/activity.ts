import { db, schema } from "@/db";

/**
 * Every state change worth explaining later goes through here. The activity
 * feed is the product's accountability surface, so writing to it is not
 * optional bookkeeping bolted on afterwards — it is part of the operation.
 */
export type ActivityType =
  | "org.created"
  | "role.created"
  | "role.dissolved"
  | "member.added"
  | "member.claimed"
  | "grant.created"
  | "grant.revoked"
  | "payment.requested"
  | "payment.executed"
  | "payment.blocked"
  | "payment.approved"
  | "payment.rejected"
  | "schedule.created"
  | "schedule.ran"
  | "schedule.short"
  | "schedule.unstaffed"
  | "schedule.cancelled";

export async function logActivity(entry: {
  orgId: string;
  type: ActivityType;
  actorId?: string | null;
  roleId?: string | null;
  subjectId?: string | null;
  payload?: Record<string, unknown>;
}) {
  await db.insert(schema.activity).values({
    orgId: entry.orgId,
    type: entry.type,
    actorId: entry.actorId ?? null,
    roleId: entry.roleId ?? null,
    subjectId: entry.subjectId ?? null,
    payload: entry.payload ?? null,
  });
}
