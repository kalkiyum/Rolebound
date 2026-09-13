import { beforeEach, describe, expect, inject, it } from "vitest";
import { ANVIL_URL } from "../../test/chain";

process.env.NEXT_PUBLIC_CHAIN_ID = "31337";
process.env.NEXT_PUBLIC_RPC_URL = ANVIL_URL;
process.env.NEXT_PUBLIC_USDC_ADDRESS = inject("usdcAddress");
process.env.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS = inject("payAddress");
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_SECRET;

const { db, schema } = await import("@/db");
const { createOrg } = await import("./orgs");
const { createRole } = await import("./roles");
const { monthSpend, startOfMonthUTC } = await import("./spend");

const USDC = (n: string) => BigInt(n) * 1_000_000n;

let orgId: string;
let capped: { id: string; capMonthly: string | null };
let uncapped: { id: string; capMonthly: string | null };
let actorId: string;

/**
 * Rows are inserted rather than paid, because what is under test is how the
 * month is partitioned by status and date — not whether money moves. The
 * payments suite covers that, and going through the gate here would make it
 * impossible to write a row dated last month at all.
 */
async function record(
  roleId: string,
  amount: bigint,
  status: "executed" | "executing" | "pending_approval" | "blocked" | "rejected" | "failed",
  createdAt = new Date(),
) {
  await db.insert(schema.payments).values({
    roleId,
    actorId,
    token: process.env.NEXT_PUBLIC_USDC_ADDRESS!,
    toAddress: "0x000000000000000000000000000000000000beef",
    amount: amount.toString(),
    reason: `test ${status} ${amount}`,
    reasonHash: `0x${"11".repeat(32)}`,
    status,
    createdAt,
  });
}

beforeEach(async () => {
  await db.delete(schema.payments);
  await db.delete(schema.activity);
  await db.delete(schema.grants);
  await db.delete(schema.organizations);

  const stamp = `${Date.now()}-${Math.random()}`;
  const { org } = await createOrg({
    name: `Spend Co ${stamp}`,
    ownerName: "Owner",
    privyUserId: `seed:${stamp}`,
  });
  orgId = org.id;

  capped = await createRole({
    orgId,
    name: `Marketing ${stamp}`,
    capPerTx: USDC("500"),
    capMonthly: USDC("4000"),
  });
  uncapped = await createRole({
    orgId,
    name: `Operations ${stamp}`,
    capPerTx: USDC("1000"),
  });

  const [actor] = await db
    .insert(schema.members)
    .values({ orgId, kind: "person", displayName: "Dana" })
    .returning();
  actorId = actor.id;
});

describe("monthSpend", () => {
  it("separates money that is gone from money that is merely spoken for", async () => {
    await record(capped.id, USDC("450"), "executed");
    await record(capped.id, USDC("1409"), "executed");
    await record(capped.id, USDC("900"), "pending_approval");

    const spend = (await monthSpend([capped])).get(capped.id)!;

    expect(spend.paid).toBe(USDC("1859"));
    expect(spend.pending).toBe(USDC("900"));
    expect(spend.consumed).toBe(USDC("2759"));
    expect(spend.remaining).toBe(USDC("1241"));
  });

  it("counts a payment that is mid-flight as spent, not as pending", async () => {
    await record(capped.id, USDC("200"), "executing");

    const spend = (await monthSpend([capped])).get(capped.id)!;
    expect(spend.paid).toBe(USDC("200"));
    expect(spend.pending).toBe(0n);
  });

  it("ignores payments that never happened", async () => {
    await record(capped.id, USDC("700"), "blocked");
    await record(capped.id, USDC("800"), "rejected");
    await record(capped.id, USDC("900"), "failed");

    const spend = (await monthSpend([capped])).get(capped.id)!;
    expect(spend.consumed).toBe(0n);
    expect(spend.remaining).toBe(USDC("4000"));
  });

  it("ignores last month, because the cap is monthly", async () => {
    const lastMonth = new Date(startOfMonthUTC().getTime() - 86_400_000);
    await record(capped.id, USDC("3000"), "executed", lastMonth);
    await record(capped.id, USDC("100"), "executed");

    const spend = (await monthSpend([capped])).get(capped.id)!;
    expect(spend.paid).toBe(USDC("100"));
    expect(spend.remaining).toBe(USDC("3900"));
  });

  it("still reports what an uncapped role spent", async () => {
    await record(uncapped.id, USDC("240"), "executed");

    const spend = (await monthSpend([uncapped])).get(uncapped.id)!;
    expect(spend.paid).toBe(USDC("240"));
    expect(spend.capMonthly).toBeNull();
    // Null, not zero: "no limit" and "nothing left" must not render alike.
    expect(spend.remaining).toBeNull();
    expect(spend.fraction).toBeNull();
  });

  it("floors the remainder at zero once an approved payment goes over", async () => {
    await record(capped.id, USDC("3800"), "executed");
    await record(capped.id, USDC("900"), "executed");

    const spend = (await monthSpend([capped])).get(capped.id)!;
    expect(spend.consumed).toBe(USDC("4700"));
    expect(spend.remaining).toBe(0n);
    expect(spend.fraction).toBeGreaterThan(1);
  });

  it("keeps each role's month to itself", async () => {
    await record(capped.id, USDC("450"), "executed");
    await record(uncapped.id, USDC("240"), "executed");

    const spending = await monthSpend([capped, uncapped]);
    expect(spending.get(capped.id)!.paid).toBe(USDC("450"));
    expect(spending.get(uncapped.id)!.paid).toBe(USDC("240"));
  });

  it("reports a role that has spent nothing, rather than omitting it", async () => {
    const spending = await monthSpend([capped]);
    const spend = spending.get(capped.id)!;
    expect(spend.consumed).toBe(0n);
    expect(spend.remaining).toBe(USDC("4000"));
  });
});
