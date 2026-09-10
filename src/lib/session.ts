import "server-only";
import { cookies } from "next/headers";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

/** Set by the development actor switcher. Never read when Privy is configured. */
export const ACTOR_COOKIE = "rb_actor";

export function privyConfigured() {
  return (
    !!process.env.NEXT_PUBLIC_PRIVY_APP_ID && !!process.env.PRIVY_APP_SECRET
  );
}

/**
 * Who is acting.
 *
 * Once Privy login lands this resolves from the verified session. Until then,
 * development reads a cookie so the approval and offboarding flows — which
 * are only meaningful with more than one identity — can actually be walked
 * through. The switcher that sets it is unavailable the moment Privy is
 * configured, so it cannot survive into a real deployment.
 */
export async function currentMember(orgId: string) {
  if (privyConfigured()) {
    // Resolved from the verified Privy session once login lands (step 1.5).
    // Returning null renders the signed-out state rather than guessing.
    return null;
  }

  const jar = await cookies();
  const chosen = jar.get(ACTOR_COOKIE)?.value;

  if (chosen) {
    const member = await db.query.members.findFirst({
      where: and(eq(schema.members.id, chosen), eq(schema.members.orgId, orgId)),
    });
    if (member) return member;
  }

  // Falling back to a real member keeps every screen usable on a fresh clone.
  return db.query.members.findFirst({
    where: and(eq(schema.members.orgId, orgId), eq(schema.members.kind, "person")),
    orderBy: asc(schema.members.createdAt),
  });
}

export async function orgMembers(orgId: string) {
  return db.query.members.findMany({
    where: eq(schema.members.orgId, orgId),
    orderBy: asc(schema.members.createdAt),
  });
}

/**
 * Every capability this member currently holds, keyed by role.
 *
 * Screens need this to decide what to *offer*, not what to allow — the gate
 * still decides that on the way through. Hiding a button nobody can use is a
 * courtesy; it is not a control.
 */
export async function capabilitiesFor(orgId: string, memberId: string) {
  const rows = await db
    .select({
      roleId: schema.grants.roleId,
      capability: schema.grants.capability,
    })
    .from(schema.grants)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.grants.roleId))
    .where(
      and(
        eq(schema.grants.memberId, memberId),
        isNull(schema.grants.revokedAt),
        eq(schema.roles.orgId, orgId),
      ),
    );

  const byRole = new Map<string, Set<"spend" | "approve">>();
  for (const row of rows) {
    const set = byRole.get(row.roleId) ?? new Set<"spend" | "approve">();
    set.add(row.capability);
    byRole.set(row.roleId, set);
  }
  return byRole;
}
