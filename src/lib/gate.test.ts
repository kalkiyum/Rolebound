import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { grants, members, organizations, payments, roles } from "@/db/schema";
import { assertCanSpend, SpendDenied } from "./gate";

const USDC = (n: string) => BigInt(n) * 1_000_000n;
const VENDOR = "0x000000000000000000000000000000000000bEEF";

/**
 * Payments intentionally do not cascade from members — an audit row must
 * outlive the member it names — so the sweep goes child-first.
 */
async function wipe() {
  await db.delete(payments);
  await db.delete(grants);
  await db.delete(organizations);
}

let orgId: string;
let roleId: string;
let aliceId: string;
let approverId: string;
let strangerId: string;

async function seed(roleOverrides: Partial<typeof roles.$inferInsert> = {}) {
  const [org] = await db
    .insert(organizations)
    .values({ name: "Test Org" })
    .returning();
  orgId = org.id;

  const [role] = await db
    .insert(roles)
    .values({
      orgId,
      name: "Marketing",
      privyWalletId: "wallet_test",
      address: "0x0000000000000000000000000000000000000001",
      capPerTx: USDC("500").toString(),
      ...roleOverrides,
    })
    .returning();
  roleId = role.id;

  const inserted = await db
    .insert(members)
    .values([
      { orgId, kind: "person", displayName: "Alice" },
      { orgId, kind: "person", displayName: "Approver" },
      { orgId, kind: "person", displayName: "Stranger" },
    ])
    .returning();
  [aliceId, approverId, strangerId] = inserted.map((m) => m.id);

  await db.insert(grants).values([
    { roleId, memberId: aliceId, capability: "spend" },
    { roleId, memberId: approverId, capability: "approve" },
  ]);
}

const ask = (over: Partial<Parameters<typeof assertCanSpend>[0]> = {}) =>
  assertCanSpend({
    memberId: aliceId,
    roleId,
    amount: USDC("100"),
    reason: "Landing page design, invoice #204",
    to: VENDOR,
    ...over,
  });

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(wipe);

describe("the reason is mandatory", () => {
  it("refuses an empty reason", async () => {
    await expect(ask({ reason: "" })).rejects.toThrow(SpendDenied);
  });

  it("refuses whitespace masquerading as a reason", async () => {
    await expect(ask({ reason: "   \n\t " })).rejects.toMatchObject({
      code: "missing_reason",
    });
  });
});

describe("amount", () => {
  it("refuses zero", async () => {
    await expect(ask({ amount: 0n })).rejects.toMatchObject({
      code: "invalid_amount",
    });
  });

  it("refuses negative", async () => {
    await expect(ask({ amount: -1n })).rejects.toMatchObject({
      code: "invalid_amount",
    });
  });
});

describe("authority follows the grant", () => {
  it("allows a member holding a live spend grant", async () => {
    await expect(ask()).resolves.toEqual({ outcome: "execute" });
  });

  it("refuses someone who was never in the role", async () => {
    await expect(ask({ memberId: strangerId })).rejects.toMatchObject({
      code: "no_grant",
    });
  });

  /** The product's central claim. Offboarding must bite immediately. */
  it("refuses the moment a grant is revoked", async () => {
    await expect(ask()).resolves.toEqual({ outcome: "execute" });

    await db
      .update(grants)
      .set({ revokedAt: new Date() })
      .where(eq(grants.memberId, aliceId));

    await expect(ask()).rejects.toMatchObject({ code: "no_grant" });
  });

  it("does not let an approve-only grant spend", async () => {
    await expect(ask({ memberId: approverId })).rejects.toMatchObject({
      code: "no_grant",
    });
  });

  it("refuses a dissolved role", async () => {
    await db.update(roles).set({ status: "dissolved" }).where(eq(roles.id, roleId));
    await expect(ask()).rejects.toMatchObject({ code: "role_dissolved" });
  });
});

describe("recipient allowlist", () => {
  it("is unrestricted when empty", async () => {
    await expect(ask({ to: "0x00000000000000000000000000000000000000ff" }))
      .resolves.toEqual({ outcome: "execute" });
  });

  it("refuses an address not on a non-empty allowlist", async () => {
    await db
      .update(roles)
      .set({ allowedRecipients: ["0x00000000000000000000000000000000000000aa"] })
      .where(eq(roles.id, roleId));
    await expect(ask()).rejects.toMatchObject({ code: "recipient_not_allowed" });
  });

  it("matches allowlisted addresses regardless of checksum casing", async () => {
    await db
      .update(roles)
      .set({ allowedRecipients: [VENDOR.toUpperCase()] })
      .where(eq(roles.id, roleId));
    await expect(ask()).resolves.toEqual({ outcome: "execute" });
  });
});

describe("caps route to approval rather than refusing", () => {
  it("executes at exactly the per-transaction cap", async () => {
    await expect(ask({ amount: USDC("500") })).resolves.toEqual({
      outcome: "execute",
    });
  });

  it("sends one unit over the cap to an approver", async () => {
    const d = await ask({ amount: USDC("500") + 1n });
    expect(d).toMatchObject({ outcome: "needs_approval", because: "over_per_tx_cap" });
  });

  it("sends a month-cap breach to an approver", async () => {
    await db
      .update(roles)
      .set({ capMonthly: USDC("1000").toString() })
      .where(eq(roles.id, roleId));

    await db.insert(payments).values({
      roleId,
      actorId: aliceId,
      toAddress: VENDOR,
      token: "0x0000000000000000000000000000000000000002",
      amount: USDC("950").toString(),
      reason: "earlier spend",
      reasonHash: `0x${"11".repeat(32)}`,
      status: "executed",
    });

    const d = await ask({ amount: USDC("100") });
    expect(d).toMatchObject({
      outcome: "needs_approval",
      because: "over_monthly_cap",
    });
  });

  /** A queue of pending approvals must not collectively overshoot the month. */
  it("counts pending approvals against the monthly cap", async () => {
    await db
      .update(roles)
      .set({ capMonthly: USDC("1000").toString() })
      .where(eq(roles.id, roleId));

    await db.insert(payments).values({
      roleId,
      actorId: aliceId,
      toAddress: VENDOR,
      token: "0x0000000000000000000000000000000000000002",
      amount: USDC("950").toString(),
      reason: "queued, not yet executed",
      reasonHash: `0x${"22".repeat(32)}`,
      status: "pending_approval",
    });

    await expect(ask({ amount: USDC("100") })).resolves.toMatchObject({
      because: "over_monthly_cap",
    });
  });
});
