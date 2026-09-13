import { beforeEach, describe, expect, inject, it } from "vitest";
import { encodeFunctionData } from "viem";
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
const { dissolve } = await import("./dissolution");
const { fundRole, FundingDenied } = await import("./treasury");

const USDC = (n: string) => BigInt(n) * 1_000_000n;
const usdcAddress = inject("usdcAddress");

let orgId: string;
let treasuryAddress: `0x${string}`;
let roleId: string;
let roleAddress: `0x${string}`;

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

async function mint(to: `0x${string}`, amount: bigint) {
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
    name: `Fund Co ${stamp}`,
    ownerName: "Owner",
    privyUserId: `seed:${stamp}`,
  });
  orgId = org.id;
  treasuryAddress = org.treasuryAddress as `0x${string}`;

  const role = await createRole({
    orgId,
    name: `Marketing ${stamp}`,
    capPerTx: USDC("500"),
    capMonthly: USDC("4000"),
  });
  roleId = role.id;
  roleAddress = role.address as `0x${string}`;
});

describe("fundRole", () => {
  it("moves money from the treasury into the role's wallet", async () => {
    await mint(treasuryAddress, USDC("5000"));

    await fundRole({ orgId, roleId, amount: USDC("1200") });

    expect(await balanceOf(roleAddress)).toBe(USDC("1200"));
    expect(await balanceOf(treasuryAddress)).toBe(USDC("3800"));
  });

  it("is not a payment, so the per-transaction cap does not apply", async () => {
    await mint(treasuryAddress, USDC("5000"));

    // Ten times what this role may pay out in one go. The caps bound what a
    // role spends, not what it may be given — a cap applied here would let a
    // role be starved of the budget it was created with.
    await fundRole({ orgId, roleId, amount: USDC("5000") });

    expect(await balanceOf(roleAddress)).toBe(USDC("5000"));
  });

  it("records it in the activity feed against the role", async () => {
    await mint(treasuryAddress, USDC("900"));
    await fundRole({ orgId, roleId, amount: USDC("900") });

    const entries = await db.query.activity.findMany();
    const funded = entries.find((e) => e.type === "role.funded");
    expect(funded).toBeDefined();
    expect(funded!.roleId).toBe(roleId);
    expect(funded!.payload?.amount).toBe(USDC("900").toString());
  });

  it("refuses more than the treasury holds, and moves nothing", async () => {
    await mint(treasuryAddress, USDC("100"));

    await expect(
      fundRole({ orgId, roleId, amount: USDC("500") }),
    ).rejects.toMatchObject({ code: "insufficient_treasury" });

    expect(await balanceOf(roleAddress)).toBe(0n);
    expect(await balanceOf(treasuryAddress)).toBe(USDC("100"));
  });

  it("refuses zero and negative amounts", async () => {
    await mint(treasuryAddress, USDC("100"));

    await expect(fundRole({ orgId, roleId, amount: 0n })).rejects.toBeInstanceOf(
      FundingDenied,
    );
    await expect(
      fundRole({ orgId, roleId, amount: -1n }),
    ).rejects.toMatchObject({ code: "bad_amount" });
  });

  it("refuses a dissolved role, so money is not stranded in a closed wallet", async () => {
    await mint(treasuryAddress, USDC("1000"));

    // Dissolving takes approve authority somewhere in the org.
    const [approver] = await db
      .insert(schema.members)
      .values({ orgId, kind: "person", displayName: "Approver" })
      .returning();
    await grantCapability({
      orgId,
      roleId,
      memberId: approver.id,
      capability: "approve",
    });
    await dissolve({ orgId, roleId, actorId: approver.id });

    await expect(
      fundRole({ orgId, roleId, amount: USDC("100") }),
    ).rejects.toMatchObject({ code: "role_dissolved" });

    expect(await balanceOf(roleAddress)).toBe(0n);
  });

  it("refuses a role belonging to another organization", async () => {
    await mint(treasuryAddress, USDC("1000"));

    const stamp = `${Date.now()}-${Math.random()}`;
    const { org: other } = await createOrg({
      name: `Other Co ${stamp}`,
      ownerName: "Someone",
      privyUserId: `seed:other:${stamp}`,
    });

    await expect(
      fundRole({ orgId: other.id, roleId, amount: USDC("100") }),
    ).rejects.toMatchObject({ code: "no_such_role" });

    expect(await balanceOf(roleAddress)).toBe(0n);
  });
});
