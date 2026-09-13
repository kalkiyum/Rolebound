import { beforeEach, afterAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import { ANVIL_URL } from "../../test/chain";

process.env.NEXT_PUBLIC_CHAIN_ID = "31337";
process.env.NEXT_PUBLIC_RPC_URL = ANVIL_URL;
process.env.NEXT_PUBLIC_USDC_ADDRESS = inject("usdcAddress");
process.env.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS = inject("payAddress");
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_SECRET;

const { db, schema } = await import("@/db");
const { grantCapability } = await import("./roles");
const { offboardingImpact, offboardMember } = await import("./offboarding");
const { assertCanSpend } = await import("./gate");

const USDC = (n: string) => BigInt(n) * 1_000_000n;
const VENDOR = "0x000000000000000000000000000000000000bEEF";

let orgId: string;
let marketingId: string;
let grantsRoleId: string;
let danaId: string;
let samId: string;

async function wipe() {
  await db.delete(schema.payments);
  await db.delete(schema.schedules);
  await db.delete(schema.grants);
  await db.delete(schema.organizations);
}

async function makeRole(name: string) {
  const [role] = await db
    .insert(schema.roles)
    .values({
      orgId,
      name,
      privyWalletId: `wallet_${name}`,
      address: "0x0000000000000000000000000000000000000001",
      capPerTx: USDC("500").toString(),
    })
    .returning();
  return role;
}

beforeEach(async () => {
  await wipe();

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Offboarding Co" })
    .returning();
  orgId = org.id;

  marketingId = (await makeRole("Marketing")).id;
  grantsRoleId = (await makeRole("Grants")).id;

  const people = await db
    .insert(schema.members)
    .values([
      { orgId, kind: "person", displayName: "Dana" },
      { orgId, kind: "person", displayName: "Sam" },
    ])
    .returning();
  [danaId, samId] = people.map((m) => m.id);

  await grantCapability({ orgId, roleId: marketingId, memberId: danaId, capability: "spend" });
  await grantCapability({ orgId, roleId: grantsRoleId, memberId: danaId, capability: "approve" });
});

afterAll(wipe);

describe("what leaving actually costs", () => {
  it("lists every role and capability the person holds", async () => {
    const impact = await offboardingImpact({ orgId, memberId: danaId });

    expect(impact.memberName).toBe("Dana");
    expect(impact.roles).toHaveLength(2);

    const marketing = impact.roles.find((r) => r.roleName === "Marketing")!;
    expect(marketing.capabilities).toEqual(["spend"]);

    const grants = impact.roles.find((r) => r.roleName === "Grants")!;
    expect(grants.capabilities).toEqual(["approve"]);
  });

  it("warns when nobody else can spend on the role", async () => {
    const impact = await offboardingImpact({ orgId, memberId: danaId });
    const marketing = impact.roles.find((r) => r.roleName === "Marketing")!;
    expect(marketing.otherSpendersRemain).toBe(false);

    await grantCapability({ orgId, roleId: marketingId, memberId: samId, capability: "spend" });

    const after = await offboardingImpact({ orgId, memberId: danaId });
    expect(after.roles.find((r) => r.roleName === "Marketing")!.otherSpendersRemain).toBe(true);
  });

  it("surfaces requests they left waiting on someone else", async () => {
    await db.insert(schema.payments).values({
      roleId: marketingId,
      actorId: danaId,
      toAddress: VENDOR,
      token: "0x0000000000000000000000000000000000000002",
      amount: USDC("900").toString(),
      reason: "Conference sponsorship",
      reasonHash: `0x${"33".repeat(32)}`,
      status: "pending_approval",
    });

    const impact = await offboardingImpact({ orgId, memberId: danaId });
    const marketing = impact.roles.find((r) => r.roleName === "Marketing")!;

    expect(marketing.pendingPayments).toHaveLength(1);
    expect(marketing.pendingPayments[0].reason).toBe("Conference sponsorship");
  });

  /**
   * The one people get wrong. Schedules belong to the role, so they survive
   * the person who set them up — which is right, and has to be visible.
   */
  it("surfaces recurring payments they set up, which keep running", async () => {
    await db.insert(schema.schedules).values({
      roleId: marketingId,
      createdBy: danaId,
      direction: "role_to_recipient",
      toAddress: VENDOR,
      token: "0x0000000000000000000000000000000000000002",
      amount: USDC("400").toString(),
      cadence: "0 0 1 * *",
      nextRunAt: new Date(Date.now() + 86_400_000),
      reason: "Design retainer",
    });

    const impact = await offboardingImpact({ orgId, memberId: danaId });
    const marketing = impact.roles.find((r) => r.roleName === "Marketing")!;

    expect(marketing.standingPayments).toHaveLength(1);
    expect(marketing.standingPayments[0].reason).toBe("Design retainer");
    expect(marketing.standingPayments[0].cadence).toBe("0 0 1 * *");
  });

  it("says nothing is at stake for someone holding no roles", async () => {
    const impact = await offboardingImpact({ orgId, memberId: samId });
    expect(impact.roles).toEqual([]);
  });
});

describe("offboarding", () => {
  it("removes every capability across every role in one action", async () => {
    await offboardMember({ orgId, memberId: danaId });

    await expect(
      assertCanSpend({
        memberId: danaId,
        roleId: marketingId,
        amount: USDC("10"),
        reason: "One last thing",
        to: VENDOR,
      }),
    ).rejects.toMatchObject({ code: "no_grant" });

    const impact = await offboardingImpact({ orgId, memberId: danaId });
    expect(impact.roles).toEqual([]);
  });

  it("rejects their undecided requests rather than leaving them queued", async () => {
    const [payment] = await db
      .insert(schema.payments)
      .values({
        roleId: marketingId,
        actorId: danaId,
        toAddress: VENDOR,
        token: "0x0000000000000000000000000000000000000002",
        amount: USDC("900").toString(),
        reason: "Conference sponsorship",
        reasonHash: `0x${"33".repeat(32)}`,
        status: "pending_approval",
      })
      .returning();

    await offboardMember({ orgId, memberId: danaId });

    const row = await db.query.payments.findFirst({
      where: eq(schema.payments.id, payment.id),
    });
    expect(row?.status).toBe("rejected");
    expect(row?.approvalReason).toContain("Dana");
  });

  it("can leave pending requests alone when that is the explicit choice", async () => {
    const [payment] = await db
      .insert(schema.payments)
      .values({
        roleId: marketingId,
        actorId: danaId,
        toAddress: VENDOR,
        token: "0x0000000000000000000000000000000000000002",
        amount: USDC("900").toString(),
        reason: "Conference sponsorship",
        reasonHash: `0x${"33".repeat(32)}`,
        status: "pending_approval",
      })
      .returning();

    await offboardMember({ orgId, memberId: danaId, pendingDisposition: "leave" });

    const row = await db.query.payments.findFirst({
      where: eq(schema.payments.id, payment.id),
    });
    expect(row?.status).toBe("pending_approval");
  });

  it("leaves the historical record intact", async () => {
    await offboardMember({ orgId, memberId: danaId });

    const grants = await db.query.grants.findMany({
      where: eq(schema.grants.memberId, danaId),
    });
    expect(grants).toHaveLength(2);
    expect(grants.every((g) => g.revokedAt instanceof Date)).toBe(true);

    const feed = await db.query.activity.findMany({
      where: eq(schema.activity.orgId, orgId),
    });
    expect(feed.filter((e) => e.type === "grant.revoked")).toHaveLength(2);
  });
});
