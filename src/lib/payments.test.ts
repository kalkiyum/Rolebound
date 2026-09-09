import { beforeAll, beforeEach, afterAll, describe, expect, inject, it } from "vitest";
import { decodeEventLog, encodeFunctionData, getAddress } from "viem";
import { ANVIL_KEYS, ANVIL_URL, publicClient as testClient, walletClient } from "../../test/chain";

// The app reads its chain configuration lazily, so pointing it at Anvil has
// to happen before anything calls into it — but after the imports above.
process.env.NEXT_PUBLIC_CHAIN_ID = "31337";
process.env.NEXT_PUBLIC_RPC_URL = ANVIL_URL;
process.env.NEXT_PUBLIC_USDC_ADDRESS = inject("usdcAddress");
process.env.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS = inject("payAddress");
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_SECRET;

const { db, schema } = await import("@/db");
const { createRole } = await import("./roles");
const { grantCapability } = await import("./roles");
const { requestPayment } = await import("./payments");
const { hashReason } = await import("./authorization");
const { roleboundPayAbi, erc20Abi } = await import("./abi");
const { roleIdToBytes32 } = await import("./ids");

const USDC = (n: string) => BigInt(n) * 1_000_000n;
const VENDOR = getAddress("0x000000000000000000000000000000000000bEEF");

const usdcAddress = inject("usdcAddress");
const payAddress = inject("payAddress");

let orgId: string;
let roleId: string;
let roleAddress: `0x${string}`;
let memberId: string;

async function wipe() {
  await db.delete(schema.payments);
  await db.delete(schema.grants);
  await db.delete(schema.organizations);
}

const balanceOf = (address: `0x${string}`) =>
  testClient().readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  }) as Promise<bigint>;

/** Anvil's faucet account mints the role its budget. */
async function fundRole(to: `0x${string}`, amount: bigint) {
  const wallet = walletClient(ANVIL_KEYS[0]);
  const hash = await wallet.sendTransaction({
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

beforeAll(async () => {
  // A role name unique to this run: the local backend derives its key from
  // the name, so reusing one would inherit the previous run's balance.
  process.env.ROLEBOUND_TEST_RUN = String(Date.now());
});

beforeEach(async () => {
  await wipe();

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Payments Co" })
    .returning();
  orgId = org.id;

  const role = await createRole({
    orgId,
    name: `Marketing ${process.env.ROLEBOUND_TEST_RUN}-${Math.random()}`,
    capPerTx: USDC("500"),
  });
  roleId = role.id;
  roleAddress = role.address as `0x${string}`;

  const [member] = await db
    .insert(schema.members)
    .values({ orgId, kind: "person", displayName: "Alice" })
    .returning();
  memberId = member.id;

  await grantCapability({ orgId, roleId, memberId, capability: "spend" });
  await fundRole(roleAddress, USDC("1000"));
});

afterAll(wipe);

describe("a payment, end to end on a real chain", () => {
  it("moves the funds and records the transaction", async () => {
    const before = await balanceOf(VENDOR);

    const result = await requestPayment({
      orgId,
      roleId,
      memberId,
      to: VENDOR,
      amount: USDC("200"),
      reason: "Landing page design, invoice #204",
    });

    expect(result.status).toBe("executed");
    expect(await balanceOf(VENDOR)).toBe(before + USDC("200"));

    const row = await db.query.payments.findFirst({
      where: (p, { eq }) => eq(p.id, result.paymentId),
    });
    expect(row?.status).toBe("executed");
    expect(row?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  /**
   * The product's accountability claim, verified the way an auditor would:
   * take the hash from the chain, hash the plaintext we hold, compare.
   */
  it("commits the reason hash onchain in the same transaction", async () => {
    const reason = "Q3 contractor retainer — design";

    const result = await requestPayment({
      orgId,
      roleId,
      memberId,
      to: VENDOR,
      amount: USDC("120"),
      reason,
    });
    expect(result.status).toBe("executed");
    if (result.status !== "executed") return;

    const receipt = await testClient().getTransactionReceipt({
      hash: result.txHash,
    });

    const events = receipt.logs
      .filter((log) => getAddress(log.address) === getAddress(payAddress))
      .map((log) =>
        decodeEventLog({ abi: roleboundPayAbi, data: log.data, topics: log.topics }),
      );

    expect(events).toHaveLength(1);
    const event = events[0].args as unknown as {
      roleId: `0x${string}`;
      to: `0x${string}`;
      amount: bigint;
      reasonHash: `0x${string}`;
    };

    expect(event.reasonHash).toBe(hashReason(reason));
    expect(event.roleId).toBe(roleIdToBytes32(roleId));
    expect(getAddress(event.to)).toBe(VENDOR);
    expect(event.amount).toBe(USDC("120"));
  });

  it("does not move funds when the amount is over the cap", async () => {
    const before = await balanceOf(VENDOR);

    const result = await requestPayment({
      orgId,
      roleId,
      memberId,
      to: VENDOR,
      amount: USDC("900"),
      reason: "Oversized sponsorship",
    });

    expect(result).toMatchObject({
      status: "pending_approval",
      because: "over_per_tx_cap",
    });
    expect(await balanceOf(VENDOR)).toBe(before);
  });

  it("refuses without a reason, and moves nothing", async () => {
    const before = await balanceOf(VENDOR);

    await expect(
      requestPayment({
        orgId,
        roleId,
        memberId,
        to: VENDOR,
        amount: USDC("10"),
        reason: "   ",
      }),
    ).rejects.toMatchObject({ code: "missing_reason" });

    expect(await balanceOf(VENDOR)).toBe(before);
    expect(await db.query.payments.findMany()).toHaveLength(0);
  });

  it("logs a blocked payment to the activity feed when the gate refuses", async () => {
    await expect(
      requestPayment({
        orgId,
        roleId,
        memberId,
        to: VENDOR,
        amount: 0n,
        reason: "Zero",
      }),
    ).rejects.toMatchObject({ code: "invalid_amount" });

    const feed = await db.query.activity.findMany({
      where: (a, { eq }) => eq(a.orgId, orgId),
    });
    expect(feed.map((e) => e.type)).toContain("payment.blocked");
  });
});
