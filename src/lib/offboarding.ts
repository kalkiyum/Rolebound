import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { revokeGrants } from "./roles";

export interface RoleImpact {
  roleId: string;
  roleName: string;
  capabilities: Array<"spend" | "approve">;
  /** Requests this person made that nobody has decided on yet. */
  pendingPayments: Array<{
    id: string;
    amount: string;
    toAddress: string;
    reason: string;
    createdAt: Date;
  }>;
  /**
   * Recurring payments this person set up. They are owned by the ROLE, so
   * they keep running after offboarding — which is correct, and exactly why
   * it has to be said out loud rather than discovered next month.
   */
  standingPayments: Array<{
    id: string;
    amount: string;
    toAddress: string | null;
    cadence: string;
    nextRunAt: Date;
    reason: string;
  }>;
  /** Whether anyone else can still spend here once this person is removed. */
  otherSpendersRemain: boolean;
}

export interface OffboardingImpact {
  memberId: string;
  memberName: string;
  roles: RoleImpact[];
}

/**
 * What actually happens if this person is removed — computed before anyone
 * clicks, because the honest answer is not "nothing".
 *
 * Three things need a decision, and only the first is automatic: their
 * authority disappears, their in-flight requests become undecidable, and the
 * recurring payments they configured keep running under the role.
 */
export async function offboardingImpact(input: {
  orgId: string;
  memberId: string;
}): Promise<OffboardingImpact> {
  const member = await db.query.members.findFirst({
    where: eq(schema.members.id, input.memberId),
  });
  if (!member) throw new Error(`No member ${input.memberId}`);

  const held = await db
    .select({
      roleId: schema.roles.id,
      roleName: schema.roles.name,
      capability: schema.grants.capability,
    })
    .from(schema.grants)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.grants.roleId))
    .where(
      and(
        eq(schema.grants.memberId, input.memberId),
        isNull(schema.grants.revokedAt),
        eq(schema.roles.orgId, input.orgId),
        eq(schema.roles.status, "active"),
      ),
    );

  const roleIds = [...new Set(held.map((h) => h.roleId))];
  if (roleIds.length === 0) {
    return { memberId: member.id, memberName: member.displayName, roles: [] };
  }

  const pending = await db
    .select()
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.actorId, input.memberId),
        eq(schema.payments.status, "pending_approval"),
        inArray(schema.payments.roleId, roleIds),
      ),
    );

  const standing = await db
    .select()
    .from(schema.schedules)
    .where(
      and(
        eq(schema.schedules.createdBy, input.memberId),
        eq(schema.schedules.status, "active"),
        inArray(schema.schedules.roleId, roleIds),
      ),
    );

  // Who else can spend on these roles — the question anyone removing a person
  // asks next, and the one that decides whether the role goes quiet.
  const otherSpenders = await db
    .select({ roleId: schema.grants.roleId })
    .from(schema.grants)
    .where(
      and(
        inArray(schema.grants.roleId, roleIds),
        eq(schema.grants.capability, "spend"),
        isNull(schema.grants.revokedAt),
      ),
    );

  const spendersByRole = new Map<string, number>();
  for (const g of otherSpenders) {
    spendersByRole.set(g.roleId, (spendersByRole.get(g.roleId) ?? 0) + 1);
  }

  const theirSpendRoles = new Set(
    held.filter((h) => h.capability === "spend").map((h) => h.roleId),
  );

  return {
    memberId: member.id,
    memberName: member.displayName,
    roles: roleIds.map((roleId) => {
      const total = spendersByRole.get(roleId) ?? 0;
      const theirs = theirSpendRoles.has(roleId) ? 1 : 0;

      return {
        roleId,
        roleName: held.find((h) => h.roleId === roleId)!.roleName,
        capabilities: held
          .filter((h) => h.roleId === roleId)
          .map((h) => h.capability),
        pendingPayments: pending
          .filter((p) => p.roleId === roleId)
          .map((p) => ({
            id: p.id,
            amount: p.amount,
            toAddress: p.toAddress,
            reason: p.reason,
            createdAt: p.createdAt,
          })),
        standingPayments: standing
          .filter((s) => s.roleId === roleId)
          .map((s) => ({
            id: s.id,
            amount: s.amount,
            toAddress: s.toAddress,
            cadence: s.cadence,
            nextRunAt: s.nextRunAt,
            reason: s.reason,
          })),
        otherSpendersRemain: total - theirs > 0,
      };
    }),
  };
}

export type PendingDisposition = "reject" | "leave";

/**
 * Removes a person from every role in one action, after they have seen the
 * impact above. Pending requests are rejected by default: leaving them
 * queued means an approver can be asked, weeks later, to release money for
 * somebody who no longer works here.
 */
export async function offboardMember(input: {
  orgId: string;
  memberId: string;
  actorId?: string;
  pendingDisposition?: PendingDisposition;
}) {
  const impact = await offboardingImpact(input);
  const disposition = input.pendingDisposition ?? "reject";

  for (const role of impact.roles) {
    await revokeGrants({
      orgId: input.orgId,
      roleId: role.roleId,
      memberId: input.memberId,
      actorId: input.actorId,
    });

    if (disposition === "reject" && role.pendingPayments.length > 0) {
      await db
        .update(schema.payments)
        .set({
          status: "rejected",
          approvalReason: `${impact.memberName} was removed from ${role.roleName} before this was decided.`,
        })
        .where(
          inArray(
            schema.payments.id,
            role.pendingPayments.map((p) => p.id),
          ),
        );
    }
  }

  return impact;
}
