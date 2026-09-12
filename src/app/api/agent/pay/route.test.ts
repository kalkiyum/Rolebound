import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
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
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_SECRET;

const { db, schema } = await import("@/db");
const { createRole, grantCapability, revokeGrants } = await import("@/lib/roles");
const { addMember } = await import("@/lib/orgs");
const { issueApiKey } = await import("@/lib/agents");
const { erc20Abi } = await import("@/lib/abi");
const { POST } = await import("./route");

const USDC = (n: string) => BigInt(n) * 1_000_000n;
const VENDOR = getAddress("0x000000000000000000000000000000000000bEEF");
const usdcAddress = inject("usdcAddress");

let orgId: string;
let roleId: string;
let agentId: string;
let apiKey: string;

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

/** The request an agent actually makes. */
function post(body: unknown, key?: string) {
  return POST(
    new Request("http://localhost/api/agent/pay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(() => {
  process.env.ROLEBOUND_TEST_RUN = String(Date.now());
});

beforeEach(async () => {
  await wipe();

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Agent Co" })
    .returning();
  orgId = org.id;

  const role = await createRole({
    orgId,
    name: `Operations ${process.env.ROLEBOUND_TEST_RUN}-${Math.random()}`,
    capPerTx: USDC("500"),
  });
  roleId = role.id;

  const agent = await addMember({ orgId, kind: "agent", displayName: "ops-agent" });
  agentId = agent.id;
  apiKey = (await issueApiKey(agentId)).key;

  await grantCapability({ orgId, roleId, memberId: agentId, capability: "spend" });
  await fundRole(role.address as `0x${string}`, USDC("1000"));
});

afterAll(wipe);

describe("POST /api/agent/pay — authentication", () => {
  it("refuses a request with no key", async () => {
    const res = await post({ roleId, to: VENDOR, amount: "100", reason: "Invoice 204" });

    expect(res.status).toBe(401);
  });

  it("refuses an unknown key", async () => {
    const res = await post(
      { roleId, to: VENDOR, amount: "100", reason: "Invoice 204" },
      "rb_live_nonsense",
    );

    expect(res.status).toBe(401);
  });
});

describe("POST /api/agent/pay — the same gate as everyone else", () => {
  it("pays when the agent is inside its cap", async () => {
    const before = await balanceOf(VENDOR);

    const res = await post(
      { roleId, to: VENDOR, amount: "100", reason: "SaaS renewal, invoice 204" },
      apiKey,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("executed");
    expect(await balanceOf(VENDOR)).toBe(before + USDC("100"));
  });

  it("routes an over-cap payment to approval instead of paying", async () => {
    const before = await balanceOf(VENDOR);

    const res = await post(
      { roleId, to: VENDOR, amount: "900", reason: "Annual contract" },
      apiKey,
    );
    const body = await res.json();

    expect(body.status).toBe("pending_approval");
    expect(await balanceOf(VENDOR)).toBe(before);
  });

  it("refuses an agent whose grant was revoked", async () => {
    await revokeGrants({ orgId, roleId, memberId: agentId, capability: "spend" });

    const res = await post(
      { roleId, to: VENDOR, amount: "100", reason: "Invoice 204" },
      apiKey,
    );
    const body = await res.json();

    expect(body.status).toBe("blocked");
  });

  it("refuses a payment with no reason", async () => {
    const res = await post({ roleId, to: VENDOR, amount: "100", reason: "  " }, apiKey);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.status).toBe("blocked");
  });

  it("rejects a malformed amount rather than coercing it", async () => {
    const res = await post(
      { roleId, to: VENDOR, amount: "not-a-number", reason: "Invoice 204" },
      apiKey,
    );

    expect(res.status).toBe(400);
  });
});
