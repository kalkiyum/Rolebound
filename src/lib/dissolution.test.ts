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
const { createOrg } = await import("./orgs");
const { createRole, grantCapability } = await import("./roles");
const { createSchedule } = await import("./schedules");
const { dissolutionImpact, dissolve, CannotDissolve } = await import("./dissolution");
const { requestPayment } = await import("./payments");

const USDC = (n: string) => BigInt(n) * 1_000_000n;
const VENDOR = getAddress("0x000000000000000000000000000000000000bEEF");
const usdcAddress = inject("usdcAddress");

let orgId: string;
let treasuryAddress: `0x${string}`;
let roleId: string;
let roleAddress: `0x${string}`;
let danaId: string;
let approverId: string;

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

beforeEach(async () => {
  await db.delete(schema.payments);
  await db.delete(schema.schedules);
  await db.delete(schema.activity);
  await db.delete(schema.grants);
  await db.delete(schema.organizations);

  const stamp = `${Date.now()}-${Math.random()}`;
  const { org } = await createOrg({
    name: `Dissolve Co ${stamp}`,
    ownerName: "Owner",
    privyUserId: `seed:${stamp}`,
  });
  orgId = org.id;
  treasuryAddress = org.treasuryAddress as `0x${string}`;

  const role = await createRole({ orgId, name: `Marketing ${stamp}`, capPerTx: USDC("500") });
  roleId = role.id;
  roleAddress = role.address as `0x${string}`;

  const [dana, ravi] = await db
    .insert(schema.members)
    .values([
      { orgId, kind: "person", displayName: "Dana" },
      { orgId, kind: "person", displayName: "Ravi" },
    ])
    .returning();
  danaId = dana.id;
  approverId = ravi.id;

  await grantCapability({ orgId, roleId, memberId: danaId, capability: "spend" });
  await grantCapability({ orgId, roleId, memberId: approverId, capability: "approve" });
});

describe("dissolutionImpact", () => {
  it("says what closing the role would take with it", async () => {
    await fundUsdc(roleAddress, USDC("320"));
    await createSchedule({
      orgId,
      roleId,
      createdBy: danaId,
      direction: "role_to_recipient",
      to: VENDOR,
      amount: USDC("100"),
      cadence: "@monthly",
      reason: "Ad agency retainer",
    });

    const impact = await dissolutionImpact({ orgId, roleId });

    expect(impact.balance).toBe(USDC("320"));
    expect(impact.returnsTo!.toLowerCase()).toBe(treasuryAddress.toLowerCase());
    expect(impact.schedules).toHaveLength(1);
    expect(impact.schedules[0].reason).toBe("Ad agency retainer");
    expect(impact.holders.map((h) => h.displayName).sort()).toEqual(["Dana", "Ravi"]);
  });
});

describe("dissolve", () => {
  it("refuses someone with no approve authority in the org", async () => {
    await expect(
      dissolve({ orgId, roleId, actorId: danaId }),
    ).rejects.toBeInstanceOf(CannotDissolve);
  });

  it("returns the remaining balance to the treasury", async () => {
    await fundUsdc(roleAddress, USDC("320"));

    const result = await dissolve({ orgId, roleId, actorId: approverId });

    expect(result.swept).not.toBeNull();
    expect(result.swept!.amount).toBe(USDC("320"));
    expect(await balanceOf(roleAddress)).toBe(0n);
    expect(await balanceOf(treasuryAddress)).toBe(USDC("320"));
  });

  it("sweeps past the role's own per-payment cap", async () => {
    // The cap governs spending authority. Returning money to the treasury it
    // came from is not a spend, and a role holding more than its cap must
    // still be closable.
    await fundUsdc(roleAddress, USDC("4000"));

    const result = await dissolve({ orgId, roleId, actorId: approverId });

    expect(result.swept!.amount).toBe(USDC("4000"));
    expect(await balanceOf(treasuryAddress)).toBe(USDC("4000"));
  });

  it("commits why the money moved, like every other payment", async () => {
    await fundUsdc(roleAddress, USDC("100"));
    await dissolve({ orgId, roleId, actorId: approverId });

    const payment = await db.query.payments.findFirst();
    expect(payment!.status).toBe("executed");
    expect(payment!.reason).toMatch(/dissolved/i);
    expect(payment!.toAddress!.toLowerCase()).toBe(treasuryAddress.toLowerCase());
  });

  it("cancels standing payments rather than leaving them to fire", async () => {
    await fundUsdc(roleAddress, USDC("500"));
    await createSchedule({
      orgId,
      roleId,
      createdBy: danaId,
      direction: "role_to_recipient",
      to: VENDOR,
      amount: USDC("100"),
      cadence: "@monthly",
      reason: "Ad agency retainer",
    });

    const result = await dissolve({ orgId, roleId, actorId: approverId });

    expect(result.cancelledSchedules).toBe(1);
    const schedules = await db.query.schedules.findMany();
    expect(schedules.every((s) => s.status === "cancelled")).toBe(true);
  });

  it("takes everyone's authority with it", async () => {
    await dissolve({ orgId, roleId, actorId: approverId });

    const grants = await db.query.grants.findMany({
      where: eq(schema.grants.roleId, roleId),
    });
    expect(grants.every((g) => g.revokedAt !== null)).toBe(true);
  });

  it("closes out payments that were waiting on an approver", async () => {
    await fundUsdc(roleAddress, USDC("2000"));
    await requestPayment({
      orgId,
      roleId,
      memberId: danaId,
      to: VENDOR,
      amount: USDC("900"),
      reason: "Conference stand",
    });

    const result = await dissolve({ orgId, roleId, actorId: approverId });

    expect(result.closedPayments).toBe(1);
    const waiting = await db.query.payments.findMany();
    expect(waiting.some((p) => p.status === "pending_approval")).toBe(false);
  });

  it("marks the role dissolved and refuses a second attempt", async () => {
    await dissolve({ orgId, roleId, actorId: approverId });

    const role = await db.query.roles.findFirst({ where: eq(schema.roles.id, roleId) });
    expect(role!.status).toBe("dissolved");

    await expect(
      dissolve({ orgId, roleId, actorId: approverId }),
    ).rejects.toBeInstanceOf(CannotDissolve);
  });

  it("closes an empty role without moving anything", async () => {
    const result = await dissolve({ orgId, roleId, actorId: approverId });
    expect(result.swept).toBeNull();
  });

  it("writes the closure into the record", async () => {
    await fundUsdc(roleAddress, USDC("50"));
    await dissolve({ orgId, roleId, actorId: approverId });

    const types = (await db.query.activity.findMany()).map((a) => a.type);
    expect(types).toContain("role.dissolved");
  });
});
