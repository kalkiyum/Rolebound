import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { ANVIL_URL } from "../../test/chain";

// Same lazy-config dance as the other suites: point the app at Anvil before
// anything imports a module that reads chain settings.
process.env.NEXT_PUBLIC_CHAIN_ID = "31337";
process.env.NEXT_PUBLIC_RPC_URL = ANVIL_URL;
process.env.NEXT_PUBLIC_USDC_ADDRESS = inject("usdcAddress");
process.env.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS = inject("payAddress");
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_SECRET;

const { db, schema } = await import("@/db");
const { addMember } = await import("./orgs");
const { issueApiKey, authenticateAgent } = await import("./agents");

let orgId: string;
let agentId: string;

beforeAll(async () => {
  await db.delete(schema.organizations);
});

beforeEach(async () => {
  await db.delete(schema.organizations);
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Northwind Labs" })
    .returning();
  orgId = org.id;

  const agent = await addMember({
    orgId,
    kind: "agent",
    displayName: "ops-agent",
  });
  agentId = agent.id;
});

describe("issueApiKey", () => {
  it("returns a key that authenticates as that agent", async () => {
    const { key } = await issueApiKey(agentId);

    const member = await authenticateAgent(key);

    expect(member?.id).toBe(agentId);
  });

  it("stores only a hash, never the key itself", async () => {
    const { key } = await issueApiKey(agentId);

    const row = await db.query.members.findFirst({
      where: (m, { eq }) => eq(m.id, agentId),
    });

    expect(row?.apiKeyHash).toBeTruthy();
    expect(row?.apiKeyHash).not.toBe(key);
    expect(row?.apiKeyHash).not.toContain(key);
  });

  it("refuses to issue a key for a person", async () => {
    const person = await addMember({
      orgId,
      kind: "person",
      displayName: "Maya Okonkwo",
    });

    await expect(issueApiKey(person.id)).rejects.toThrow(/agent/i);
  });

  it("rotates: re-issuing invalidates the previous key", async () => {
    const first = await issueApiKey(agentId);
    const second = await issueApiKey(agentId);

    expect(await authenticateAgent(first.key)).toBeNull();
    expect((await authenticateAgent(second.key))?.id).toBe(agentId);
  });
});

describe("authenticateAgent", () => {
  it("rejects an unknown key", async () => {
    await issueApiKey(agentId);

    expect(await authenticateAgent("rb_live_nonsense")).toBeNull();
  });

  it("rejects an empty key rather than matching an agent without one", async () => {
    // A member with no key has a null hash. An empty credential must never
    // authenticate as one of them.
    expect(await authenticateAgent("")).toBeNull();
  });
});
