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
const { roleIdToBytes32 } = await import("./ids");
const { fetchPaymentEvents, verifyPayments, unrecordedPayments } = await import("./indexer");

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

async function pay(amount: bigint, reason: string) {
  const result = await requestPayment({
    orgId,
    roleId,
    memberId,
    to: VENDOR,
    amount,
    reason,
  });
  if (result.status !== "executed") {
    throw new Error(`expected an executed payment, got ${result.status}`);
  }
  return result;
}

beforeEach(async () => {
  await wipe();

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Indexed Co" })
    .returning();
  orgId = org.id;

  const role = await createRole({
    orgId,
    name: `Ops ${Date.now()}-${Math.random()}`,
    capPerTx: USDC("500"),
  });
  roleId = role.id;

  const [member] = await db
    .insert(schema.members)
    .values({ orgId, kind: "person", displayName: "Ops lead" })
    .returning();
  memberId = member.id;

  await grantCapability({ orgId, roleId, memberId, capability: "spend" });
  await fundRole(role.address as `0x${string}`, USDC("2000"));
});

afterAll(wipe);

describe("reading payments back off the chain", () => {
  it("finds the event and reports the role it belongs to", async () => {
    const { txHash } = await pay(USDC("75"), "Domain renewal");

    const events = await fetchPaymentEvents();
    const mine = events.find((e) => e.txHash === txHash);

    expect(mine).toBeDefined();
    expect(mine!.roleId).toBe(roleIdToBytes32(roleId));
    expect(getAddress(mine!.to)).toBe(VENDOR);
    expect(mine!.amount).toBe(USDC("75"));
  });

  it("filters by role, so one org's feed cannot show another's payments", async () => {
    await pay(USDC("30"), "Filtered in");

    const mine = await fetchPaymentEvents({ roleIds: [roleId] });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.roleId === roleIdToBytes32(roleId))).toBe(true);

    const other = await fetchPaymentEvents({
      roleIds: ["11111111-2222-3333-4444-555555555555"],
    });
    expect(other).toHaveLength(0);
  });
});

describe("the verified badge", () => {
  it("verifies a payment whose reason matches what was committed", async () => {
    const reason = "Conference booth deposit";
    const { paymentId } = await pay(USDC("300"), reason);

    const rows = await db.query.payments.findMany();
    const verdicts = await verifyPayments(
      rows.map((r) => ({ id: r.id, txHash: r.txHash, reason: r.reason, amount: r.amount })),
    );

    expect(verdicts.get(paymentId)?.state).toBe("verified");
  });

  /**
   * The case the badge exists for. Someone edits the stored reason after the
   * fact; the chain still holds the hash of what was actually approved.
   */
  it("reports a mismatch when the stored reason is edited after the fact", async () => {
    const { paymentId } = await pay(USDC("50"), "Original justification");

    await db
      .update(schema.payments)
      .set({ reason: "A more flattering justification" })
      .where(eq(schema.payments.id, paymentId));

    const rows = await db.query.payments.findMany();
    const verdicts = await verifyPayments(
      rows.map((r) => ({ id: r.id, txHash: r.txHash, reason: r.reason, amount: r.amount })),
    );

    expect(verdicts.get(paymentId)?.state).toBe("mismatch");
  });

  it("reports a mismatch when the stored amount is edited", async () => {
    const { paymentId } = await pay(USDC("50"), "Amount check");

    await db
      .update(schema.payments)
      .set({ amount: USDC("5000").toString() })
      .where(eq(schema.payments.id, paymentId));

    const rows = await db.query.payments.findMany();
    const verdicts = await verifyPayments(
      rows.map((r) => ({ id: r.id, txHash: r.txHash, reason: r.reason, amount: r.amount })),
    );

    expect(verdicts.get(paymentId)?.state).toBe("mismatch");
  });

  it("calls an unsettled payment pending, not unverified", async () => {
    const verdicts = await verifyPayments([
      { id: "not-onchain-yet", txHash: null, reason: "Awaiting approval", amount: "1" },
    ]);
    expect(verdicts.get("not-onchain-yet")).toEqual({ state: "pending" });
  });

  it("reports a transaction hash the chain has never seen", async () => {
    const verdicts = await verifyPayments([
      {
        id: "phantom",
        txHash: `0x${"ab".repeat(32)}`,
        reason: "Never happened",
        amount: "1",
      },
    ]);
    expect(verdicts.get("phantom")).toEqual({ state: "not_found" });
  });
});

describe("reconciliation", () => {
  /**
   * Scoped to this payment on purpose: the chain is append-only across the
   * whole suite while the database is wiped per test, so a bare length
   * assertion here would count every earlier test's payments.
   */
  it("surfaces onchain payments the database has no row for", async () => {
    const { txHash } = await pay(USDC("40"), "Recorded");

    const whenKnown = await unrecordedPayments([txHash]);
    expect(whenKnown.some((e) => e.txHash === txHash)).toBe(false);

    const whenUnknown = await unrecordedPayments([]);
    expect(whenUnknown.some((e) => e.txHash === txHash)).toBe(true);
  });
});

/**
 * Base Sepolia's public RPC refuses any `eth_getLogs` spanning more than
 * 10,000 blocks, and the chain is past block 46,000,000. Scanning from zero
 * therefore returns nothing on the deployed app while passing every test
 * here, because Anvil has no such limit and starts at block 0.
 *
 * A window of one block is the strictest form of that constraint: it forces
 * one request per block, so an off-by-one in the loop shows up immediately
 * as a duplicated or missing event rather than as a subtly short feed.
 */
describe("reading logs in windows", () => {
  it("returns each event exactly once when the range spans many windows", async () => {
    for (const amount of ["10", "20", "30"]) {
      const result = await requestPayment({
        orgId,
        roleId,
        memberId,
        to: VENDOR,
        amount: USDC(amount),
        reason: `Windowed payment of ${amount}`,
      });
      expect(result.status).toBe("executed");
    }

    const whole = await fetchPaymentEvents({ windowSize: 10_000n });
    const windowed = await fetchPaymentEvents({ windowSize: 1n });

    const key = (e: { txHash: string; logIndex: number }) =>
      `${e.txHash}:${e.logIndex}`;

    // Every event, once each: a window that overlaps its neighbour would
    // double the boundary blocks, and one that skips would lose them.
    expect(new Set(windowed.map(key)).size).toBe(windowed.length);
    expect(windowed.map(key).sort()).toEqual(whole.map(key).sort());
    expect(windowed.length).toBeGreaterThanOrEqual(3);
  });

  it("covers the final partial window", async () => {
    // The last window almost never divides evenly into the range, so the
    // most recent payment is exactly the one a bad bound would drop.
    const result = await requestPayment({
      orgId,
      roleId,
      memberId,
      to: VENDOR,
      amount: USDC("7"),
      reason: "The most recent payment",
    });
    expect(result.status).toBe("executed");
    if (result.status !== "executed") return;

    const events = await fetchPaymentEvents({ windowSize: 3n });
    expect(events.map((e) => e.txHash)).toContain(result.txHash);
  });
});
