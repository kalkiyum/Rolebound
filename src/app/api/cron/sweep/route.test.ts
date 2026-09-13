import { beforeEach, describe, expect, inject, it } from "vitest";
import { encodeFunctionData, getAddress } from "viem";
import {
  ANVIL_KEYS,
  ANVIL_URL,
  publicClient as testClient,
  walletClient,
} from "../../../../../test/chain";

process.env.NEXT_PUBLIC_CHAIN_ID = "31337";
process.env.NEXT_PUBLIC_RPC_URL = ANVIL_URL;
process.env.NEXT_PUBLIC_USDC_ADDRESS = inject("usdcAddress");
process.env.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS = inject("payAddress");
process.env.CRON_SECRET = "test-sweep-secret";
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_SECRET;

const { db, schema } = await import("@/db");
const { createRole, grantCapability } = await import("@/lib/roles");
const { createOrg } = await import("@/lib/orgs");
const { createSchedule } = await import("@/lib/schedules");
const { POST } = await import("./route");

const USDC = (n: string) => BigInt(n) * 1_000_000n;
const VENDOR = getAddress("0x000000000000000000000000000000000000bEEF");
const usdcAddress = inject("usdcAddress");

let orgId: string;
let roleId: string;
let roleAddress: `0x${string}`;
let danaId: string;

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

const call = (headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/cron/sweep", { method: "POST", headers }));

const authorized = () => call({ authorization: "Bearer test-sweep-secret" });

beforeEach(async () => {
  await db.delete(schema.payments);
  await db.delete(schema.schedules);
  await db.delete(schema.activity);
  await db.delete(schema.grants);
  await db.delete(schema.organizations);

  const stamp = `${Date.now()}-${Math.random()}`;
  const { org } = await createOrg({
    name: `Sweep Co ${stamp}`,
    ownerName: "Owner",
    privyUserId: `seed:${stamp}`,
  });
  orgId = org.id;

  const role = await createRole({ orgId, name: `Marketing ${stamp}`, capPerTx: USDC("500") });
  roleId = role.id;
  roleAddress = role.address as `0x${string}`;

  const [dana] = await db
    .insert(schema.members)
    .values({ orgId, kind: "person", displayName: "Dana" })
    .returning();
  danaId = dana.id;
  await grantCapability({ orgId, roleId, memberId: danaId, capability: "spend" });
});

describe("POST /api/cron/sweep", () => {
  it("refuses a request with no secret", async () => {
    expect((await call()).status).toBe(401);
  });

  it("refuses a request with the wrong secret", async () => {
    expect((await call({ authorization: "Bearer nope" })).status).toBe(401);
  });

  it("runs due schedules and reports what happened to each", async () => {
    await fundUsdc(roleAddress, USDC("500"));
    await createSchedule({
      orgId,
      roleId,
      createdBy: danaId,
      direction: "role_to_recipient",
      to: VENDOR,
      amount: USDC("100"),
      cadence: "0 9 1 * *",
      reason: "Ad agency retainer",
      startAt: new Date("2026-01-01T00:00:00Z"),
    });

    const response = await authorized();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ran).toBe(1);
    expect(body.results[0].status).toBe("paid");
  });

  it("is quiet and successful when nothing is due", async () => {
    const response = await authorized();
    expect(response.status).toBe(200);
    expect((await response.json()).ran).toBe(0);
  });

  it("reports a shortfall instead of a server error", async () => {
    await fundUsdc(roleAddress, USDC("10"));
    await createSchedule({
      orgId,
      roleId,
      createdBy: danaId,
      direction: "role_to_recipient",
      to: VENDOR,
      amount: USDC("100"),
      cadence: "0 9 1 * *",
      reason: "Ad agency retainer",
      startAt: new Date("2026-01-01T00:00:00Z"),
    });

    const response = await authorized();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results[0].status).toBe("short");
    expect(body.results[0].shortfall).toBe("90000000");
  });
});
