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
const { createRole, grantCapability, revokeGrants, dissolveRole } = await import("./roles");
const { requestPayment } = await import("./payments");
const { approvePayment, rejectPayment, pendingApprovals, ApprovalDenied } =
  await import("./approvals");
const { erc20Abi } = await import("./abi");

const USDC = (n: string) => BigInt(n) * 1_000_000n;
const VENDOR = getAddress("0x000000000000000000000000000000000000bEEF");
const usdcAddress = inject("usdcAddress");

let orgId: string;
let roleId: string;
let requesterId: string;
let approverId: string;
let outsiderId: string;

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

/** Over the 500 cap, so it always lands in pending_approval. */
async function requestOverCap(amount = USDC("900")) {
  const result = await requestPayment({
    orgId,
    roleId,
    memberId: requesterId,
    to: VENDOR,
    amount,
    reason: "Annual conference sponsorship",
  });
  expect(result.status).toBe("pending_approval");
  return result.paymentId;
}

beforeEach(async () => {
  await wipe();

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Approvals Co" })
    .returning();
  orgId = org.id;

  const role = await createRole({
    orgId,
    name: `Events ${Date.now()}-${Math.random()}`,
    capPerTx: USDC("500"),
  });
  roleId = role.id;

  const people = await db
    .insert(schema.members)
    .values([
      { orgId, kind: "person", displayName: "Requester" },
      { orgId, kind: "person", displayName: "Approver" },
      { orgId, kind: "person", displayName: "Outsider" },
    ])
    .returning();
  [requesterId, approverId, outsiderId] = people.map((m) => m.id);

  await grantCapability({ orgId, roleId, memberId: requesterId, capability: "spend" });
  await grantCapability({ orgId, roleId, memberId: approverId, capability: "approve" });

  await fundRole(role.address as `0x${string}`, USDC("5000"));
});

afterAll(wipe);

describe("approving releases the payment", () => {
  it("moves the funds once an approver signs off", async () => {
    const paymentId = await requestOverCap();
    const before = await balanceOf(VENDOR);

    const result = await approvePayment({
      orgId,
      paymentId,
      approverId,
      approvalReason: "Budgeted in Q3 plan",
    });

    expect(result.status).toBe("executed");
    expect(await balanceOf(VENDOR)).toBe(before + USDC("900"));
  });

  it("records who approved it and why", async () => {
    const paymentId = await requestOverCap();
    await approvePayment({
      orgId,
      paymentId,
      approverId,
      approvalReason: "Budgeted in Q3 plan",
    });

    const row = await db.query.payments.findFirst({
      where: eq(schema.payments.id, paymentId),
    });
    expect(row?.approvedBy).toBe(approverId);
    expect(row?.approvalReason).toBe("Budgeted in Q3 plan");

    const feed = await db.query.activity.findMany({
      where: eq(schema.activity.orgId, orgId),
    });
    expect(feed.map((e) => e.type)).toContain("payment.approved");
  });

  it("requires the approver to give their own reason", async () => {
    const paymentId = await requestOverCap();
    await expect(
      approvePayment({ orgId, paymentId, approverId, approvalReason: "  " }),
    ).rejects.toMatchObject({ code: "missing_reason" });
  });
});

describe("who may approve", () => {
  /** An approval you can grant yourself is not an approval. */
  it("refuses self-approval even when the requester can also approve", async () => {
    await grantCapability({ orgId, roleId, memberId: requesterId, capability: "approve" });
    const paymentId = await requestOverCap();

    await expect(
      approvePayment({
        orgId,
        paymentId,
        approverId: requesterId,
        approvalReason: "I vouch for myself",
      }),
    ).rejects.toMatchObject({ code: "self_approval" });
  });

  it("refuses someone with no approve grant", async () => {
    const paymentId = await requestOverCap();
    await expect(
      approvePayment({
        orgId,
        paymentId,
        approverId: outsiderId,
        approvalReason: "Looks fine to me",
      }),
    ).rejects.toMatchObject({ code: "no_approve_grant" });
  });

  it("refuses an approver whose own grant was revoked", async () => {
    const paymentId = await requestOverCap();
    await revokeGrants({ orgId, roleId, memberId: approverId });

    await expect(
      approvePayment({ orgId, paymentId, approverId, approvalReason: "Still fine" }),
    ).rejects.toBeInstanceOf(ApprovalDenied);
  });
});

describe("offboarding reaches payments already in flight", () => {
  /**
   * The leak this closes: request while authorized, get offboarded, and have
   * an approver release the funds anyway.
   */
  it("refuses to approve a payment whose requester was offboarded", async () => {
    const paymentId = await requestOverCap();
    const before = await balanceOf(VENDOR);

    await revokeGrants({ orgId, roleId, memberId: requesterId });

    await expect(
      approvePayment({
        orgId,
        paymentId,
        approverId,
        approvalReason: "Approving anyway",
      }),
    ).rejects.toMatchObject({ code: "requester_revoked" });

    expect(await balanceOf(VENDOR)).toBe(before);
  });

  it("refuses to release pending payments for a dissolved role", async () => {
    const paymentId = await requestOverCap();
    await dissolveRole({ orgId, roleId });

    await expect(
      approvePayment({ orgId, paymentId, approverId, approvalReason: "Last one" }),
    ).rejects.toMatchObject({ code: "role_dissolved" });
  });
});

describe("rejecting", () => {
  it("records the decision and moves nothing", async () => {
    const paymentId = await requestOverCap();
    const before = await balanceOf(VENDOR);

    await rejectPayment({
      orgId,
      paymentId,
      approverId,
      approvalReason: "Out of budget this quarter",
    });

    const row = await db.query.payments.findFirst({
      where: eq(schema.payments.id, paymentId),
    });
    expect(row?.status).toBe("rejected");
    expect(row?.approvalReason).toBe("Out of budget this quarter");
    expect(await balanceOf(VENDOR)).toBe(before);
  });

  it("cannot be decided twice", async () => {
    const paymentId = await requestOverCap();
    await rejectPayment({ orgId, paymentId, approverId, approvalReason: "No" });

    await expect(
      approvePayment({ orgId, paymentId, approverId, approvalReason: "Changed my mind" }),
    ).rejects.toMatchObject({ code: "not_pending" });
  });
});

describe("the approvals queue", () => {
  it("lists only what is actually waiting, with who asked and why", async () => {
    const paymentId = await requestOverCap();

    // An executed payment must not appear in the queue.
    await requestPayment({
      orgId,
      roleId,
      memberId: requesterId,
      to: VENDOR,
      amount: USDC("10"),
      reason: "Small under-cap spend",
    });

    const queue = await pendingApprovals(orgId);

    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(paymentId);
    expect(queue[0].requestedBy).toBe("Requester");
    expect(queue[0].reason).toBe("Annual conference sponsorship");
  });

  it("empties once the decision is made", async () => {
    await requestOverCap();
    const [waiting] = await pendingApprovals(orgId);

    await rejectPayment({
      orgId,
      paymentId: waiting.id,
      approverId,
      approvalReason: "Not this quarter",
    });

    expect(await pendingApprovals(orgId)).toHaveLength(0);
  });
});
