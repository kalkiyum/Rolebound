import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity } from "./activity";
import { provisionTreasuryWallet } from "./wallets";

/**
 * Creating an org provisions its treasury wallet in the same call. An org
 * without a funding source is a row that cannot do anything, and leaving one
 * behind means the next screen has to handle a state that should not exist.
 */
export async function createOrg(input: {
  name: string;
  ownerName: string;
  privyUserId: string;
}) {
  const treasury = await provisionTreasuryWallet(input.name);

  const [org] = await db
    .insert(schema.organizations)
    .values({
      name: input.name,
      treasuryWalletId: treasury.walletId,
      treasuryAddress: treasury.address,
    })
    .returning();

  const [owner] = await db
    .insert(schema.members)
    .values({
      orgId: org.id,
      kind: "person",
      displayName: input.ownerName,
      privyUserId: input.privyUserId,
    })
    .returning();

  await logActivity({
    orgId: org.id,
    type: "org.created",
    actorId: owner.id,
    payload: { name: org.name, treasury: treasury.address },
  });

  return { org, owner };
}

/** Adds a person or an agent. Both land in the same table on purpose. */
export async function addMember(input: {
  orgId: string;
  kind: "person" | "agent";
  displayName: string;
  privyUserId?: string;
  actorId?: string;
}) {
  const [member] = await db
    .insert(schema.members)
    .values({
      orgId: input.orgId,
      kind: input.kind,
      displayName: input.displayName,
      privyUserId: input.privyUserId ?? null,
    })
    .returning();

  await logActivity({
    orgId: input.orgId,
    type: "member.added",
    actorId: input.actorId ?? null,
    subjectId: member.id,
    payload: { kind: member.kind, displayName: member.displayName },
  });

  return member;
}

export async function memberForPrivyUser(privyUserId: string) {
  return db.query.members.findFirst({
    where: eq(schema.members.privyUserId, privyUserId),
  });
}

export async function memberInOrg(orgId: string, memberId: string) {
  return db.query.members.findFirst({
    where: and(
      eq(schema.members.orgId, orgId),
      eq(schema.members.id, memberId),
    ),
  });
}
