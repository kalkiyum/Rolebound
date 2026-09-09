import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { grantCapability, revokeGrants } from "./roles";
import { assertCanSpend } from "./gate";

let orgId: string;
let roleId: string;
let memberId: string;

async function wipe() {
  await db.delete(schema.payments);
  await db.delete(schema.grants);
  await db.delete(schema.organizations);
}

const liveGrants = () =>
  db.query.grants.findMany({
    where: and(eq(schema.grants.roleId, roleId), isNull(schema.grants.revokedAt)),
  });

beforeEach(async () => {
  await wipe();

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Revocation Co" })
    .returning();
  orgId = org.id;

  const [role] = await db
    .insert(schema.roles)
    .values({
      orgId,
      name: "Grants",
      privyWalletId: "wallet_test",
      address: "0x0000000000000000000000000000000000000001",
      capPerTx: "500000000",
    })
    .returning();
  roleId = role.id;

  const [member] = await db
    .insert(schema.members)
    .values({ orgId, kind: "person", displayName: "Dana" })
    .returning();
  memberId = member.id;
});

afterAll(wipe);

describe("granting", () => {
  it("records the capability and writes an activity entry", async () => {
    await grantCapability({ orgId, roleId, memberId, capability: "spend" });

    expect(await liveGrants()).toHaveLength(1);

    const feed = await db.query.activity.findMany({
      where: eq(schema.activity.orgId, orgId),
    });
    expect(feed.map((e) => e.type)).toContain("grant.created");
  });

  /** A second live grant would make revocation a loop callers can get wrong. */
  it("is idempotent — granting twice leaves one live grant", async () => {
    const first = await grantCapability({ orgId, roleId, memberId, capability: "spend" });
    const second = await grantCapability({ orgId, roleId, memberId, capability: "spend" });

    expect(second.id).toBe(first.id);
    expect(await liveGrants()).toHaveLength(1);
  });

  it("treats spend and approve as separate authority", async () => {
    await grantCapability({ orgId, roleId, memberId, capability: "spend" });
    await grantCapability({ orgId, roleId, memberId, capability: "approve" });
    expect(await liveGrants()).toHaveLength(2);
  });
});

describe("revocation", () => {
  it("takes away the ability to spend, immediately", async () => {
    await grantCapability({ orgId, roleId, memberId, capability: "spend" });

    const before = await assertCanSpend({
      memberId,
      roleId,
      amount: 1_000_000n,
      reason: "conference sponsorship",
      to: "0x000000000000000000000000000000000000bEEF",
    });
    expect(before).toEqual({ outcome: "execute" });

    await revokeGrants({ orgId, roleId, memberId });

    await expect(
      assertCanSpend({
        memberId,
        roleId,
        amount: 1_000_000n,
        reason: "conference sponsorship",
        to: "0x000000000000000000000000000000000000bEEF",
      }),
    ).rejects.toMatchObject({ code: "no_grant" });
  });

  it("removes every capability when none is named", async () => {
    await grantCapability({ orgId, roleId, memberId, capability: "spend" });
    await grantCapability({ orgId, roleId, memberId, capability: "approve" });

    const revoked = await revokeGrants({ orgId, roleId, memberId });

    expect(revoked).toHaveLength(2);
    expect(await liveGrants()).toHaveLength(0);
  });

  it("removes only the named capability when one is given", async () => {
    await grantCapability({ orgId, roleId, memberId, capability: "spend" });
    await grantCapability({ orgId, roleId, memberId, capability: "approve" });

    await revokeGrants({ orgId, roleId, memberId, capability: "spend" });

    const live = await liveGrants();
    expect(live.map((g) => g.capability)).toEqual(["approve"]);
  });

  it("keeps the historical row rather than deleting it", async () => {
    await grantCapability({ orgId, roleId, memberId, capability: "spend" });
    await revokeGrants({ orgId, roleId, memberId });

    const all = await db.query.grants.findMany({
      where: eq(schema.grants.roleId, roleId),
    });
    expect(all).toHaveLength(1);
    expect(all[0].revokedAt).toBeInstanceOf(Date);
  });

  it("is a no-op, with no log noise, when nothing is live", async () => {
    const revoked = await revokeGrants({ orgId, roleId, memberId });
    expect(revoked).toEqual([]);

    const feed = await db.query.activity.findMany({
      where: eq(schema.activity.orgId, orgId),
    });
    expect(feed.map((e) => e.type)).not.toContain("grant.revoked");
  });
});
