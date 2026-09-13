import { beforeEach, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import { encodeFunctionData, getAddress } from "viem";
import {
  ANVIL_KEYS,
  ANVIL_URL,
  publicClient as testClient,
  walletClient,
} from "../../test/chain";

process.env.NEXT_PUBLIC_CHAIN_ID = "31337";
process.env.NEXT_PUBLIC_RPC_URL = ANVIL_URL;
process.env.NEXT_PUBLIC_USDC_ADDRESS = inject("usdcAddress");
process.env.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS = inject("payAddress");
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_SECRET;

const { db, schema } = await import("@/db");
const { createSchedule, cancelSchedule, dueSchedules, runSweep, upcomingSchedules } =
  await import("./schedules");
const { createRole, grantCapability, revokeGrants } = await import("./roles");
const { createOrg } = await import("./orgs");

const USDC = (n: string) => BigInt(n) * 1_000_000n;
const VENDOR = getAddress("0x000000000000000000000000000000000000bEEF");
const PAST = new Date("2026-01-01T00:00:00Z");
const usdcAddress = inject("usdcAddress");

const balanceOf = (address: `0x${string}`) =>
  testClient().readContract({
    address: usdcAddress,
    abi: [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "a", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ] as const,
    functionName: "balanceOf",
    args: [address],
  }) as Promise<bigint>;

/** Anvil's faucet mints a wallet its budget. */
async function fundUsdc(to: `0x${string}`, amount: bigint) {
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

let orgId: string;
let roleId: string;
let roleAddress: `0x${string}`;
let treasuryAddress: `0x${string}`;
let danaId: string;

beforeEach(async () => {
  await db.delete(schema.payments);
  await db.delete(schema.schedules);
  await db.delete(schema.activity);
  await db.delete(schema.grants);
  await db.delete(schema.organizations);

  // Wallet keys are derived from the name, so a name unique to this test
  // stops one run inheriting the previous run's balance.
  const stamp = `${Date.now()}-${Math.random()}`;
  const { org } = await createOrg({
    name: `Northwind ${stamp}`,
    ownerName: "Owner",
    privyUserId: `seed:${stamp}`,
  });
  orgId = org.id;
  treasuryAddress = org.treasuryAddress as `0x${string}`;

  const role = await createRole({
    orgId,
    name: `Marketing ${stamp}`,
    capPerTx: USDC("500"),
  });
  roleId = role.id;
  roleAddress = role.address as `0x${string}`;

  const [dana] = await db
    .insert(schema.members)
    .values({ orgId, kind: "person", displayName: "Dana" })
    .returning();
  danaId = dana.id;
  await grantCapability({ orgId, roleId, memberId: danaId, capability: "spend" });
});

const retainer = (over: Partial<Parameters<typeof createSchedule>[0]> = {}) =>
  createSchedule({
    orgId,
    roleId,
    createdBy: danaId,
    direction: "role_to_recipient",
    to: VENDOR,
    amount: USDC("100"),
    cadence: "0 9 1 * *",
    reason: "Ad agency retainer",
    startAt: PAST,
    ...over,
  });

describe("createSchedule", () => {
  it("refuses a recipient-bound schedule with no recipient", async () => {
    await expect(retainer({ to: undefined })).rejects.toThrow(/recipient/i);
  });

  it("refuses a reason nobody could act on", async () => {
    await expect(retainer({ reason: "   " })).rejects.toThrow(/reason/i);
  });

  it("refuses a cadence it cannot honour", async () => {
    await expect(retainer({ cadence: "*/5 * * * *" })).rejects.toThrow(/cadence/i);
  });

  it("refuses a member who cannot spend from the role", async () => {
    const [sam] = await db
      .insert(schema.members)
      .values({ orgId, kind: "person", displayName: "Sam" })
      .returning();
    await expect(retainer({ createdBy: sam.id })).rejects.toThrow(/authority|spend/i);
  });

  it("records who set it up without making the schedule theirs", async () => {
    const s = await retainer();
    expect(s.createdBy).toBe(danaId);
    expect(s.roleId).toBe(roleId);
    expect(s.status).toBe("active");
  });
});

describe("dueSchedules", () => {
  it("returns only active schedules whose next run has passed", async () => {
    const due = await retainer();
    await retainer({ startAt: new Date("2030-01-01T00:00:00Z") });
    const cancelled = await retainer();
    await cancelSchedule({ orgId, scheduleId: cancelled.id, actorId: danaId });

    const ids = (await dueSchedules(new Date("2026-09-10T12:00:00Z"))).map((s) => s.id);
    expect(ids).toEqual([due.id]);
  });
});

describe("runSweep", () => {
  it("pays a due retainer out of the role wallet and advances it", async () => {
    await fundUsdc(roleAddress, USDC("500"));
    const s = await retainer();

    const [result] = await runSweep({ now: new Date("2026-09-10T12:00:00Z") });
    expect(result.status).toBe("paid");

    const after = await db.query.schedules.findFirst({
      where: eq(schema.schedules.id, s.id),
    });
    expect(after!.nextRunAt.getTime()).toBeGreaterThan(
      new Date("2026-09-10T12:00:00Z").getTime(),
    );
  });

  it("does not pay the same retainer twice in one period", async () => {
    await fundUsdc(roleAddress, USDC("500"));
    await retainer();
    const now = new Date("2026-09-10T12:00:00Z");

    await runSweep({ now });
    expect(await runSweep({ now })).toEqual([]);
  });

  it("says how short a role is instead of failing silently", async () => {
    await fundUsdc(roleAddress, USDC("60"));
    await retainer();

    const [result] = await runSweep({ now: new Date("2026-09-10T12:00:00Z") });
    expect(result.status).toBe("short");
    if (result.status !== "short") throw new Error("unreachable");
    expect(result.shortfall).toBe(USDC("40"));
  });

  it("leaves a short schedule due, so funding it is enough to fix it", async () => {
    await fundUsdc(roleAddress, USDC("60"));
    const s = await retainer();
    const before = (await db.query.schedules.findFirst({
      where: eq(schema.schedules.id, s.id),
    }))!.nextRunAt;

    await runSweep({ now: new Date("2026-09-10T12:00:00Z") });

    const after = await db.query.schedules.findFirst({
      where: eq(schema.schedules.id, s.id),
    });
    expect(after!.nextRunAt).toEqual(before);
  });

  it("says a role is unstaffed rather than paying without authority", async () => {
    await fundUsdc(roleAddress, USDC("500"));
    await retainer();
    await revokeGrants({ orgId, roleId, memberId: danaId, actorId: danaId });

    const [result] = await runSweep({ now: new Date("2026-09-10T12:00:00Z") });
    expect(result.status).toBe("unstaffed");
  });

  it("runs a retainer under whoever holds the role now, not who created it", async () => {
    await fundUsdc(roleAddress, USDC("500"));
    await retainer();

    const [sam] = await db
      .insert(schema.members)
      .values({ orgId, kind: "person", displayName: "Sam" })
      .returning();
    await grantCapability({ orgId, roleId, memberId: sam.id, capability: "spend" });
    await revokeGrants({ orgId, roleId, memberId: danaId, actorId: danaId });

    const [result] = await runSweep({ now: new Date("2026-09-10T12:00:00Z") });
    expect(result.status).toBe("paid");

    const payment = await db.query.payments.findFirst();
    expect(payment!.actorId).toBe(sam.id);
  });

  it("sends an over-cap retainer to approval rather than over the cap", async () => {
    await fundUsdc(roleAddress, USDC("5000"));
    await retainer({ amount: USDC("900") });

    const [result] = await runSweep({ now: new Date("2026-09-10T12:00:00Z") });
    expect(result.status).toBe("pending_approval");
  });

  it("tops a role up from the treasury on a due schedule", async () => {
    await fundUsdc(treasuryAddress, USDC("1000"));
    await createSchedule({
      orgId,
      roleId,
      createdBy: danaId,
      direction: "treasury_to_role",
      amount: USDC("250"),
      cadence: "@monthly",
      reason: "Marketing monthly budget",
      startAt: PAST,
    });

    const [result] = await runSweep({ now: new Date("2026-09-10T12:00:00Z") });
    expect(result.status).toBe("paid");
    expect(await balanceOf(roleAddress)).toBe(USDC("250"));
  });

  it("says how short the treasury is rather than half-funding a role", async () => {
    await fundUsdc(treasuryAddress, USDC("100"));
    await createSchedule({
      orgId,
      roleId,
      createdBy: danaId,
      direction: "treasury_to_role",
      amount: USDC("250"),
      cadence: "@monthly",
      reason: "Marketing monthly budget",
      startAt: PAST,
    });

    const [result] = await runSweep({ now: new Date("2026-09-10T12:00:00Z") });
    expect(result.status).toBe("short");
    if (result.status !== "short") throw new Error("unreachable");
    expect(result.shortfall).toBe(USDC("150"));
  });

  it("writes every run into the record", async () => {
    await fundUsdc(roleAddress, USDC("500"));
    await retainer();
    await runSweep({ now: new Date("2026-09-10T12:00:00Z") });

    const types = (await db.query.activity.findMany()).map((a) => a.type);
    expect(types).toContain("schedule.ran");
  });
});

describe("upcomingSchedules", () => {
  it("surfaces the shortfall before the run rather than after", async () => {
    await fundUsdc(roleAddress, USDC("60"));
    await retainer();

    const [row] = await upcomingSchedules(orgId);
    expect(row.roleName).toMatch(/^Marketing/);
    expect(row.shortfall).toBe(USDC("40"));
    expect(row.when).toBe("on the 1st at 09:00, monthly");
  });

  it("reports no shortfall when the role is funded", async () => {
    await fundUsdc(roleAddress, USDC("500"));
    await retainer();

    const [row] = await upcomingSchedules(orgId);
    expect(row.shortfall).toBe(0n);
  });
});
