import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity } from "./activity";
import { provisionRoleWallet } from "./wallets";

/**
 * A role IS a wallet. Creating one provisions a real Privy server wallet
 * under a real policy — the enclave learns the cap at the same moment the
 * database does, so the two can never disagree about what this role may
 * sign. This is why role creation is an async operation that can fail, and
 * not an insert.
 */
export async function createRole(input: {
  orgId: string;
  name: string;
  capPerTx: bigint;
  capMonthly?: bigint | null;
  allowedRecipients?: string[];
  actorId?: string;
}) {
  const allowedRecipients = (input.allowedRecipients ?? []).map((a) =>
    a.toLowerCase(),
  );

  const wallet = await provisionRoleWallet({
    roleName: input.name,
    capPerTx: input.capPerTx,
    allowedRecipients,
  });

  const [role] = await db
    .insert(schema.roles)
    .values({
      orgId: input.orgId,
      name: input.name,
      privyWalletId: wallet.walletId,
      address: wallet.address,
      capPerTx: input.capPerTx.toString(),
      capMonthly: input.capMonthly ? input.capMonthly.toString() : null,
      allowedRecipients,
    })
    .returning();

  await logActivity({
    orgId: input.orgId,
    type: "role.created",
    actorId: input.actorId ?? null,
    roleId: role.id,
    payload: {
      name: role.name,
      address: role.address,
      capPerTx: role.capPerTx,
      policyId: wallet.policyId,
    },
  });

  return role;
}

/**
 * Dissolving keeps the row. Every payment ever made under this role still
 * points at it, and an audit trail with a dangling reference is not an audit
 * trail. The gate refuses a dissolved role; the history stays readable.
 */
export async function dissolveRole(input: {
  orgId: string;
  roleId: string;
  actorId?: string;
}) {
  await db
    .update(schema.roles)
    .set({ status: "dissolved" })
    .where(eq(schema.roles.id, input.roleId));

  await logActivity({
    orgId: input.orgId,
    type: "role.dissolved",
    actorId: input.actorId ?? null,
    roleId: input.roleId,
  });
}

export async function grantCapability(input: {
  orgId: string;
  roleId: string;
  memberId: string;
  capability: "spend" | "approve";
  actorId?: string;
}) {
  // Re-granting something already live should be a no-op, not a duplicate
  // row: two live grants would make revocation a loop the caller has to get
  // right, and getting it wrong leaves authority behind.
  const existing = await db.query.grants.findFirst({
    where: and(
      eq(schema.grants.roleId, input.roleId),
      eq(schema.grants.memberId, input.memberId),
      eq(schema.grants.capability, input.capability),
      isNull(schema.grants.revokedAt),
    ),
  });
  if (existing) return existing;

  const [grant] = await db
    .insert(schema.grants)
    .values({
      roleId: input.roleId,
      memberId: input.memberId,
      capability: input.capability,
    })
    .returning();

  await logActivity({
    orgId: input.orgId,
    type: "grant.created",
    actorId: input.actorId ?? null,
    roleId: input.roleId,
    subjectId: input.memberId,
    payload: { capability: input.capability },
  });

  return grant;
}

/**
 * Offboarding, in one statement. Stamping `revoked_at` is the whole
 * mechanism — the gate reads it on every single signing call, so authority
 * is gone on the next request rather than the next deploy or the next sync.
 *
 * Revokes every capability the member holds on the role unless one is named.
 */
export async function revokeGrants(input: {
  orgId: string;
  roleId: string;
  memberId: string;
  capability?: "spend" | "approve";
  actorId?: string;
}) {
  const where = [
    eq(schema.grants.roleId, input.roleId),
    eq(schema.grants.memberId, input.memberId),
    isNull(schema.grants.revokedAt),
  ];
  if (input.capability) {
    where.push(eq(schema.grants.capability, input.capability));
  }

  const revoked = await db
    .update(schema.grants)
    .set({ revokedAt: new Date() })
    .where(and(...where))
    .returning();

  if (revoked.length === 0) return [];

  await logActivity({
    orgId: input.orgId,
    type: "grant.revoked",
    actorId: input.actorId ?? null,
    roleId: input.roleId,
    subjectId: input.memberId,
    payload: { capabilities: revoked.map((g) => g.capability) },
  });

  return revoked;
}

/** Roles for an org, newest first, each with its live grants and holders. */
export async function listRoles(orgId: string) {
  const rows = await db.query.roles.findMany({
    where: eq(schema.roles.orgId, orgId),
    orderBy: desc(schema.roles.createdAt),
  });

  const holders = await db
    .select({
      roleId: schema.grants.roleId,
      memberId: schema.members.id,
      capability: schema.grants.capability,
      displayName: schema.members.displayName,
      kind: schema.members.kind,
    })
    .from(schema.grants)
    .innerJoin(schema.members, eq(schema.members.id, schema.grants.memberId))
    .where(isNull(schema.grants.revokedAt));

  return rows.map((role) => ({
    ...role,
    holders: holders.filter((h) => h.roleId === role.id),
  }));
}
