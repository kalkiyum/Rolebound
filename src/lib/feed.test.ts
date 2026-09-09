import { beforeEach, afterAll, describe, expect, inject, it } from "vitest";
import { encodeFunctionData, getAddress } from "viem";
import { eq } from "drizzle-orm";
import { ANVIL_KEYS, ANVIL_URL, publicClient as testClient, walletClient } from "../../test/chain";

process.env.NEXT_PUBLIC_CHAIN_ID = "31337";
process.env.NEXT_PUBLIC_RPC_URL = ANVIL_URL;
process.env.NEXT_PUBLIC_USDC_ADDRESS = inject("usdcAddress");
process.env.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS = inject("payAddress");
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_SECRET;

const { db, schema } = await import("@/db");
const { createRole, grantCapability } = await import("./roles");
const { requestPayment } = await import("./payments");
const { orgFeed } = await import("./feed");

const USDC = (n: string) => BigInt(n) * 1_000_000n;
const VENDOR = getAddress("0x000000000000000000000000000000000000bEEF");
const usdcAddress = inject("usdcAddress");

let orgId: string;
let roleId: string;
let memberId: string;

async function wipe() {
  await db.delete(schema.payments);
  await db.delete(schema.grants);
  await db.delete(schema.organizations);
}

async function fundRole(to: `0x${string}`, amount: bigint) {
  const hash = await walletClient(ANVIL_KEYS[0]).sendTransaction({
    to: usdcAddress,
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "mint",
          stateMutability: "nonpayable",
          inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [],
        },
      ] as const,
      functionName: "mint",
      args: [to, amount],
    }),
  });
  await testClient().waitForTransactionReceipt({ hash });
}

beforeEach(async () => {
  await wipe();

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Feed Co" })
    .returning();
  orgId = org.id;

  const role = await createRole({
    orgId,
    name: `DevRel ${Date.now()}-${Math.random()}`,
    capPerTx: USDC("500"),
  });
  roleId = role.id;

  const [member] = await db
    .insert(schema.members)
    .values({ orgId, kind: "person", displayName: "Priya" })
    .returning();
  memberId = member.id;

  await grantCapability({ orgId, roleId, memberId, capability: "spend" });
  await fundRole(role.address as `0x${string}`, USDC("2000"));
});

afterAll(wipe);

describe("the activity feed", () => {
  it("shows who did what, under which role", async () => {
    const feed = await orgFeed(orgId);

    const grant = feed.find((e) => e.type === "grant.created");
    expect(grant).toBeDefined();
    expect(grant!.actorName).toBeNull(); // granted by the system in this setup
    expect(grant!.roleName).toContain("DevRel");
  });

  it("is newest first", async () => {
    await requestPayment({
      orgId,
      roleId,
      memberId,
      to: VENDOR,
      amount: USDC("25"),
      reason: "Meetup pizza",
    });

    const feed = await orgFeed(orgId);
    const times = feed.map((e) => e.at.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("carries the reason and marks it verified against the chain", async () => {
    await requestPayment({
      orgId,
      roleId,
      memberId,
      to: VENDOR,
      amount: USDC("25"),
      reason: "Meetup pizza for 40 people",
    });

    const feed = await orgFeed(orgId);
    const executed = feed.find((e) => e.type === "payment.executed");

    expect(executed?.actorName).toBe("Priya");
    expect(executed?.payment?.reason).toBe("Meetup pizza for 40 people");
    expect(executed?.payment?.verification.state).toBe("verified");
    expect(executed?.payment?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  /** A reason edited after the fact must never render as ordinary. */
  it("flags a payment whose stored reason no longer matches the chain", async () => {
    const result = await requestPayment({
      orgId,
      roleId,
      memberId,
      to: VENDOR,
      amount: USDC("25"),
      reason: "What was actually approved",
    });

    await db
      .update(schema.payments)
      .set({ reason: "A tidier story" })
      .where(eq(schema.payments.id, result.paymentId));

    const feed = await orgFeed(orgId);
    const executed = feed.find((e) => e.type === "payment.executed");

    expect(executed?.payment?.verification.state).toBe("mismatch");
  });

  it("shows a payment still awaiting approval as pending, not unverified", async () => {
    await requestPayment({
      orgId,
      roleId,
      memberId,
      to: VENDOR,
      amount: USDC("900"),
      reason: "Big sponsorship",
    });

    const feed = await orgFeed(orgId);
    const requested = feed.find((e) => e.type === "payment.requested");

    expect(requested?.payment?.status).toBe("pending_approval");
    expect(requested?.payment?.verification.state).toBe("pending");
  });

  it("records a refusal, so blocked attempts are part of the record too", async () => {
    await expect(
      requestPayment({
        orgId,
        roleId,
        memberId,
        to: VENDOR,
        amount: USDC("25"),
        reason: "",
      }),
    ).rejects.toMatchObject({ code: "missing_reason" });

    const feed = await orgFeed(orgId);
    expect(feed.some((e) => e.type === "payment.blocked")).toBe(true);
  });
});
