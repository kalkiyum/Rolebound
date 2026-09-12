import { beforeEach, describe, expect, inject, it } from "vitest";
import { ANVIL_URL } from "../../test/chain";

process.env.NEXT_PUBLIC_CHAIN_ID = "31337";
process.env.NEXT_PUBLIC_RPC_URL = ANVIL_URL;
process.env.NEXT_PUBLIC_USDC_ADDRESS = inject("usdcAddress");
process.env.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS = inject("payAddress");
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_SECRET;

const { db, schema } = await import("@/db");
const { addMember } = await import("./orgs");
const { claimMember, unclaimedMembers, memberForPrivyUser, AlreadyClaimed } =
  await import("./identity");

let orgId: string;
let mayaId: string;

beforeEach(async () => {
  await db.delete(schema.organizations);
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Northwind Labs" })
    .returning();
  orgId = org.id;
  mayaId = (await addMember({ orgId, kind: "person", displayName: "Maya" })).id;
  await addMember({ orgId, kind: "agent", displayName: "ops-agent" });
});

describe("claimMember", () => {
  it("links a Privy user to a member and stores their wallet address", async () => {
    await claimMember({
      orgId,
      memberId: mayaId,
      privyUserId: "did:privy:maya",
      walletAddress: "0x1111111111111111111111111111111111111111",
    });

    const member = await memberForPrivyUser("did:privy:maya");

    expect(member?.id).toBe(mayaId);
    expect(member?.address).toBe("0x1111111111111111111111111111111111111111");
  });

  it("refuses a member somebody else already claimed", async () => {
    await claimMember({
      orgId,
      memberId: mayaId,
      privyUserId: "did:privy:maya",
      walletAddress: "0x1111111111111111111111111111111111111111",
    });

    await expect(
      claimMember({
        orgId,
        memberId: mayaId,
        privyUserId: "did:privy:impostor",
        walletAddress: "0x2222222222222222222222222222222222222222",
      }),
    ).rejects.toThrow(AlreadyClaimed);
  });

  it("is idempotent for the same user re-claiming", async () => {
    const claim = {
      orgId,
      memberId: mayaId,
      privyUserId: "did:privy:maya",
      walletAddress: "0x1111111111111111111111111111111111111111",
    };
    await claimMember(claim);

    await expect(claimMember(claim)).resolves.toBeDefined();
  });

  it("refuses to claim an agent — agents authenticate with API keys", async () => {
    const [agent] = await db
      .select()
      .from(schema.members)
      .where((await import("drizzle-orm")).eq(schema.members.kind, "agent"));

    await expect(
      claimMember({
        orgId,
        memberId: agent.id,
        privyUserId: "did:privy:maya",
        walletAddress: "0x1111111111111111111111111111111111111111",
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
      walletAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(await unclaimedMembers(orgId)).toEqual([]);
  });
});

describe("memberForPrivyUser", () => {
  it("returns null for a user who has claimed nobody", async () => {
    expect(await memberForPrivyUser("did:privy:stranger")).toBeNull();
  });
});
