import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity } from "./activity";

/**
 * Agents authenticate with an API key; people authenticate with Privy. Both
 * end up as a row in `members`, holding grants that the same gate reads — an
 * agent that could not be revoked the same way a person can would be a
 * second authority model, and there is only ever one.
 */

const PREFIX = "rb_live_";

/** Recognisable in a log, and greppable if one ever leaks. */
function generateKey(): string {
  return PREFIX + randomBytes(24).toString("base64url");
}

/**
 * The key is high-entropy and random, so a single SHA-256 is the right shape
 * here: there is no password to brute-force, and a slow KDF would only tax
 * every agent request. What matters is that the plaintext is never stored.
 */
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export class NotAnAgent extends Error {
  constructor(memberId: string) {
    super(`Member ${memberId} is not an agent. People authenticate via Privy.`);
    this.name = "NotAnAgent";
  }
}

/**
 * Issues a key and returns it **once**. Only the hash is kept, so a lost key
 * is reissued rather than recovered — and reissuing invalidates the old one,
 * which is the whole point of having a rotation path.
 */
export async function issueApiKey(
  memberId: string,
  actorId?: string,
): Promise<{ key: string }> {
  const member = await db.query.members.findFirst({
    where: eq(schema.members.id, memberId),
  });

  if (!member) throw new Error(`No member ${memberId}`);
  if (member.kind !== "agent") throw new NotAnAgent(memberId);

  const key = generateKey();

  await db
    .update(schema.members)
    .set({ apiKeyHash: hashKey(key) })
    .where(eq(schema.members.id, memberId));

  // Issuing a credential that can move money is a state change worth
  // explaining later, and reissuing silently invalidates the previous key —
  // so the feed records that it happened. The key itself never goes near it.
  await logActivity({
    orgId: member.orgId,
    type: "agent.key_issued",
    actorId: actorId ?? null,
    subjectId: member.id,
    payload: { displayName: member.displayName, reissued: member.apiKeyHash !== null },
  });

  return { key };
}

/**
 * Resolves a key to the agent that holds it, or null. Returning the member
 * rather than a boolean is deliberate: every caller needs the identity to
 * pass to the gate, and a caller that only asked "is this valid?" would have
 * to look the agent up a second time and could look up the wrong one.
 */
export async function authenticateAgent(key: string) {
  // An empty credential must never match, and a null hash column must never
  // be reachable by hashing "" into a lookup.
  if (!key) return null;

  const member = await db.query.members.findFirst({
    where: and(
      eq(schema.members.apiKeyHash, hashKey(key)),
      eq(schema.members.kind, "agent"),
    ),
  });

  return member ?? null;
}
