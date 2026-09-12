import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity } from "./activity";

/**
 * Who a logged-in person *is* inside an organization.
 *
 * A Privy account and a member row are different things: the org already
 * knows it has a Head of Marketing with grants and a history, long before
 * that person first logs in. Claiming is how one becomes the other — it
 * attaches an authenticated identity to a seat that already exists, rather
 * than creating a stranger with no authority and no past.
 */

export class AlreadyClaimed extends Error {
  constructor(displayName: string) {
    super(`${displayName} has already been claimed by another account.`);
    this.name = "AlreadyClaimed";
  }
}

export class NotClaimable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotClaimable";
  }
}

export async function memberForPrivyUser(privyUserId: string) {
  if (!privyUserId) return null;
  const member = await db.query.members.findFirst({
    where: eq(schema.members.privyUserId, privyUserId),
  });
  return member ?? null;
}

/** People nobody has logged in as yet. Agents are never claimable. */
export async function unclaimedMembers(orgId: string) {
  return db.query.members.findMany({
    where: and(
      eq(schema.members.orgId, orgId),
      eq(schema.members.kind, "person"),
      isNull(schema.members.privyUserId),
    ),
    orderBy: asc(schema.members.createdAt),
  });
}

/**
 * Attaches a verified Privy identity to a member seat.
 *
 * The caller must have *verified* the session before calling this — the
 * privyUserId here is trusted completely, and the whole authority model
 * rests on it pointing at the person who actually authenticated.
 */
export async function claimMember(input: {
  orgId: string;
  memberId: string;
  privyUserId: string;
  walletAddress: string;
}) {
  const member = await db.query.members.findFirst({
    where: and(
      eq(schema.members.id, input.memberId),
      eq(schema.members.orgId, input.orgId),
    ),
  });

  if (!member) throw new NotClaimable("That member does not exist.");

  if (member.kind === "agent") {
    throw new NotClaimable(
      "An agent cannot be claimed — agents authenticate with an API key.",
    );
  }

  // Re-claiming your own seat is a no-op, not an error: a second login on a
  // new device lands here and should simply work.
  if (member.privyUserId && member.privyUserId !== input.privyUserId) {
    throw new AlreadyClaimed(member.displayName);
  }

  const alreadyClaimed = member.privyUserId === input.privyUserId;

  const [updated] = await db
    .update(schema.members)
    .set({
      privyUserId: input.privyUserId,
      address: input.walletAddress,
    })
    .where(eq(schema.members.id, input.memberId))
    .returning();

  if (!alreadyClaimed) {
    await logActivity({
      orgId: input.orgId,
      type: "member.claimed",
      actorId: updated.id,
      subjectId: updated.id,
      payload: { displayName: updated.displayName, address: input.walletAddress },
    });
  }

  return updated;
}
