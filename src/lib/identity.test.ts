import { beforeEach, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import { ANVIL_URL } from "../../test/chain";

process.env.NEXT_PUBLIC_CHAIN_ID = "31337";
process.env.NEXT_PUBLIC_RPC_URL = ANVIL_URL;
process.env.NEXT_PUBLIC_USDC_ADDRESS = inject("usdcAddress");
process.env.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS = inject("payAddress");
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_SECRET;

const { db, schema } = await import("@/db");
const { addMember } = await import("./orgs");
const {
  claimMember,
  unclaimedMembers,
  memberForPrivyUser,
  memberForInviteCode,
  reissueInvite,
  AlreadyClaimed,
  BadInvite,
} = await import("./identity");

let orgId: string;
let mayaId: string;
let mayaInvite: string;
let agentId: string;

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";

const inviteFor = async (memberId: string) => {
  const member = await db.query.members.findFirst({
    where: eq(schema.members.id, memberId),
  });
  return member!.inviteCode!;
};

beforeEach(async () => {
  await db.delete(schema.organizations);
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Northwind Labs" })
    .returning();
  orgId = org.id;
  mayaId = (await addMember({ orgId, kind: "person", displayName: "Maya" })).id;
  mayaInvite = await inviteFor(mayaId);
  agentId = (await addMember({ orgId, kind: "agent", displayName: "ops-agent" }))
    .id;
});

describe("invitations", () => {
  it("gives every new person a seat nobody can take without the link", async () => {
    expect(mayaInvite).toBeTruthy();
    expect(await memberForInviteCode(orgId, mayaInvite)).toMatchObject({
      id: mayaId,
    });
  });

  it("gives agents none — they authenticate with a key, not a login", async () => {
    const agent = await db.query.members.findFirst({
      where: eq(schema.members.id, agentId),
    });
    expect(agent!.inviteCode).toBeNull();
  });

  it("does not invite a seat that already belongs to an account", async () => {
    const claimed = await addMember({
      orgId,
      kind: "person",
      displayName: "Already here",
      privyUserId: "did:privy:existing",
    });
    expect(claimed.inviteCode).toBeNull();
  });

  it("reissuing replaces the previous link, killing it", async () => {
    const next = await reissueInvite({ orgId, memberId: mayaId });

    expect(next).not.toBe(mayaInvite);
    expect(await memberForInviteCode(orgId, mayaInvite)).toBeNull();
    expect(await memberForInviteCode(orgId, next)).toMatchObject({ id: mayaId });
  });

  it("refuses to reissue for a seat somebody already holds", async () => {
    await claimMember({
      orgId,
      memberId: mayaId,
      privyUserId: "did:privy:maya",
      walletAddress: WALLET,
      inviteCode: mayaInvite,
    });

    await expect(reissueInvite({ orgId, memberId: mayaId })).rejects.toThrow(
      /already claimed/i,
    );
  });
});

describe("claimMember", () => {
  it("links a Privy user to a member and stores their wallet address", async () => {
    await claimMember({
      orgId,
      memberId: mayaId,
      privyUserId: "did:privy:maya",
      walletAddress: WALLET,
      inviteCode: mayaInvite,
    });

    const member = await memberForPrivyUser("did:privy:maya");

    expect(member?.id).toBe(mayaId);
    expect(member?.address).toBe(WALLET);
  });

  it("refuses a first claim with no invitation at all", async () => {
    await expect(
      claimMember({
        orgId,
        memberId: mayaId,
        privyUserId: "did:privy:stranger",
        walletAddress: WALLET,
      }),
    ).rejects.toThrow(BadInvite);
  });

  it("refuses an invitation issued for a different seat", async () => {
    // The hole this closes: a valid code must not be usable to walk into
    // whichever seat the claimer would rather have.
    const devId = (
      await addMember({ orgId, kind: "person", displayName: "Dev" })
    ).id;
    const devInvite = await inviteFor(devId);

    await expect(
      claimMember({
        orgId,
        memberId: mayaId,
        privyUserId: "did:privy:opportunist",
        walletAddress: WALLET,
        inviteCode: devInvite,
      }),
    ).rejects.toThrow(BadInvite);
  });

  it("spends the invitation, so the link cannot be replayed", async () => {
    await claimMember({
      orgId,
      memberId: mayaId,
      privyUserId: "did:privy:maya",
      walletAddress: WALLET,
      inviteCode: mayaInvite,
    });

    expect(await memberForInviteCode(orgId, mayaInvite)).toBeNull();
  });

  it("refuses a member somebody else already claimed", async () => {
    await claimMember({
      orgId,
      memberId: mayaId,
      privyUserId: "did:privy:maya",
      walletAddress: WALLET,
      inviteCode: mayaInvite,
    });

    await expect(
      claimMember({
        orgId,
        memberId: mayaId,
        privyUserId: "did:privy:impostor",
        walletAddress: OTHER_WALLET,
        inviteCode: mayaInvite,
      }),
    ).rejects.toThrow(AlreadyClaimed);
  });

  it("is idempotent for the same user re-claiming, with no invitation left", async () => {
    const claim = {
      orgId,
      memberId: mayaId,
      privyUserId: "did:privy:maya",
      walletAddress: WALLET,
      inviteCode: mayaInvite,
    };
    await claimMember(claim);

    // Signing in on a second device: the code is spent, and that must not
    // lock the person out of their own seat.
    await expect(
      claimMember({ ...claim, inviteCode: undefined }),
    ).resolves.toBeDefined();
  });

  it("refuses to claim an agent — agents authenticate with API keys", async () => {
    await expect(
      claimMember({
        orgId,
        memberId: agentId,
        privyUserId: "did:privy:maya",
        walletAddress: WALLET,
      }),
    ).rejects.toThrow(/agent/i);
  });
});

describe("unclaimedMembers", () => {
  it("lists people nobody has claimed, and never agents", async () => {
    const before = await unclaimedMembers(orgId);
    expect(before.map((m) => m.displayName)).toEqual(["Maya"]);

    await claimMember({
      orgId,
      memberId: mayaId,
      privyUserId: "did:privy:maya",
      walletAddress: WALLET,
      inviteCode: mayaInvite,
    });

    expect(await unclaimedMembers(orgId)).toEqual([]);
  });
});

describe("memberForPrivyUser", () => {
  it("returns null for a user who has claimed nobody", async () => {
    expect(await memberForPrivyUser("did:privy:stranger")).toBeNull();
  });
});
