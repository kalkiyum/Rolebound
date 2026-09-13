import "server-only";
import { randomBytes } from "node:crypto";
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

export class BadInvite extends Error {
  constructor() {
    super("That invitation is not valid, or has already been used.");
    this.name = "BadInvite";
  }
}

/**
 * The token that turns "some seat in this org" into "your seat".
 *
 * High-entropy and random, because it is the only thing standing between an
 * unclaimed seat and whoever reaches the org URL first. It travels in a link,
 * so it is URL-safe, and it is cleared on claim rather than kept — a used
 * invitation should not be re-usable by someone who finds the link later.
 */
export function generateInviteCode(): string {
  return randomBytes(16).toString("base64url");
}

/** The seat an invitation points at, if it still points at one. */
export async function memberForInviteCode(orgId: string, code: string) {
  if (!code) return null;
  const member = await db.query.members.findFirst({
    where: and(
      eq(schema.members.orgId, orgId),
      eq(schema.members.inviteCode, code),
      isNull(schema.members.privyUserId),
    ),
  });
  return member ?? null;
}

/**
 * Puts a live invitation on a seat, replacing whatever was there.
 *
 * Needed for two cases that look different and are the same: a link that
 * went astray, and a seat created before invitations existed at all — both
 * are seats with no valid code, and both become claimable again here.
 */
export async function reissueInvite(input: {
  orgId: string;
  memberId: string;
}): Promise<string> {
  const member = await db.query.members.findFirst({
    where: and(
      eq(schema.members.id, input.memberId),
      eq(schema.members.orgId, input.orgId),
    ),
  });

  if (!member) throw new NotClaimable("That member does not exist.");
  if (member.kind === "agent") {
    throw new NotClaimable(
      "An agent cannot be invited — agents authenticate with an API key.",
    );
  }
  if (member.privyUserId) {
    throw new NotClaimable(
      `${member.displayName} has already claimed this seat.`,
    );
  }

  const code = generateInviteCode();
  await db
    .update(schema.members)
    .set({ inviteCode: code })
    .where(eq(schema.members.id, member.id));

  return code;
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
  /** The invitation that names this seat. Required unless already claimed. */
  inviteCode?: string;
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

  // Signing back in on another device is not a new claim and needs no
  // invitation — the seat is already this account's. A first claim does,
  // and the code has to be the one issued for *this* seat: accepting any
  // valid code for any seat would put the choice back in the claimer's
  // hands, which is the hole this closes.
  if (!alreadyClaimed) {
    if (!member.inviteCode || member.inviteCode !== input.inviteCode) {
      throw new BadInvite();
    }
  }

  const [updated] = await db
    .update(schema.members)
    .set({
      privyUserId: input.privyUserId,
      address: input.walletAddress,
      // Spent, so the link in someone's inbox stops working.
      inviteCode: null,
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
