/**
 * A believable organization. Run more than once — it clears first.
 *
 * Everything goes through the real application code paths: roles are
 * provisioned as wallets, payments go through the gate, over-cap requests
 * land in the approval queue. A seed that inserted rows directly would drift
 * from what the app actually produces, and the screens would be built
 * against a fiction.
 */
import { db, schema } from "@/db";
import { createRole, grantCapability } from "@/lib/roles";
import { addMember, createOrg } from "@/lib/orgs";
import { issueApiKey } from "@/lib/agents";
import { requestPayment } from "@/lib/payments";
import { approvePayment } from "@/lib/approvals";

const USDC = (n: string) => BigInt(Math.round(Number(n) * 1_000_000));

const VENDORS = {
  designStudio: "0x1111111111111111111111111111111111111111",
  conference: "0x2222222222222222222222222222222222222222",
  grantee: "0x3333333333333333333333333333333333333333",
  saas: "0x4444444444444444444444444444444444444444",
} as const;

export async function seed(opts: {
  mint: (to: `0x${string}`, amount: bigint) => Promise<void>;
}) {
  console.log("\nSeeding…");

  await db.delete(schema.payments);
  await db.delete(schema.schedules);
  await db.delete(schema.grants);
  await db.delete(schema.organizations);

  // Through createOrg, not a direct insert: it provisions the treasury
  // wallet, and an org seeded without one has no funding source for role
  // top-ups — a state the real app cannot produce.
  const { org, owner: maya } = await createOrg({
    name: "Northwind Labs",
    ownerName: "Maya Okonkwo",
    privyUserId: "seed:maya",
  });
  const dev = await addMember({
    orgId: org.id,
    kind: "person",
    displayName: "Dev Raman",
    actorId: maya.id,
  });
  const sasha = await addMember({
    orgId: org.id,
    kind: "person",
    displayName: "Sasha Lindqvist",
    actorId: maya.id,
  });
  // Same table as the people above. That is the point.
  const agent = await addMember({
    orgId: org.id,
    kind: "agent",
    displayName: "Growth agent",
    actorId: maya.id,
  });

  const marketing = await createRole({
    orgId: org.id,
    name: "Marketing",
    capPerTx: USDC("500"),
    capMonthly: USDC("4000"),
    actorId: maya.id,
  });
  const grants = await createRole({
    orgId: org.id,
    name: "Grants",
    capPerTx: USDC("2500"),
    capMonthly: USDC("10000"),
    actorId: maya.id,
  });
  const ops = await createRole({
    orgId: org.id,
    name: "Operations",
    capPerTx: USDC("1000"),
    actorId: maya.id,
  });

  console.log("  funding roles…");
  await opts.mint(marketing.address as `0x${string}`, USDC("8000"));
  await opts.mint(grants.address as `0x${string}`, USDC("25000"));
  await opts.mint(ops.address as `0x${string}`, USDC("3000"));

  const grant = (roleId: string, memberId: string, capability: "spend" | "approve") =>
    grantCapability({ orgId: org.id, roleId, memberId, capability, actorId: maya.id });

  await grant(marketing.id, dev.id, "spend");
  await grant(marketing.id, agent.id, "spend");
  await grant(marketing.id, maya.id, "approve");

  await grant(grants.id, sasha.id, "spend");
  await grant(grants.id, maya.id, "approve");

  await grant(ops.id, maya.id, "spend");

  console.log("  making payments…");
  const pay = (roleId: string, memberId: string, to: string, amount: bigint, reason: string) =>
    requestPayment({
      orgId: org.id,
      roleId,
      memberId,
      to: to as `0x${string}`,
      amount,
      reason,
    });

  await pay(marketing.id, dev.id, VENDORS.designStudio, USDC("450"),
    "Landing page redesign, invoice #204");
  await pay(marketing.id, agent.id, VENDORS.saas, USDC("89"),
    "Ad platform top-up for the launch campaign");
  await pay(ops.id, maya.id, VENDORS.saas, USDC("240"),
    "Monitoring plan, annual renewal");
  await pay(grants.id, sasha.id, VENDORS.grantee, USDC("2000"),
    "Milestone 2 payout — open-source indexer");

  // One that needed a second pair of eyes, and got them.
  const approved = await pay(marketing.id, dev.id, VENDORS.conference, USDC("1200"),
    "Booth deposit for DevConf, invoice #77");
  if (approved.status === "pending_approval") {
    await approvePayment({
      orgId: org.id,
      paymentId: approved.paymentId,
      approverId: maya.id,
      approvalReason: "Signed off in the Q3 marketing budget",
    });
  }

  // One still waiting, so the approvals screen is not empty.
  await pay(grants.id, sasha.id, VENDORS.grantee, USDC("4500"),
    "Milestone 3 payout — requires a second signature");

  // A recurring commitment owned by the role, so offboarding has something
  // real to surface.
  await db.insert(schema.schedules).values({
    roleId: marketing.id,
    createdBy: dev.id,
    direction: "role_to_recipient",
    toAddress: VENDORS.designStudio,
    token: process.env.NEXT_PUBLIC_USDC_ADDRESS!,
    amount: USDC("400").toString(),
    cadence: "0 0 1 * *",
    nextRunAt: nextMonthFirst(),
    reason: "Design retainer",
  });

  // The agent needs a credential to be demonstrable. Printed once, here,
  // because only the hash is stored and there is nowhere to read it back.
  const { key } = await issueApiKey(agent.id);

  console.log(`\n  Northwind Labs — /orgs/${org.id}`);
  console.log(`  4 members · 3 roles · 6 payments · 1 awaiting approval`);
  console.log(`  treasury ${org.treasuryAddress}`);
  console.log(`\n  Growth agent API key (shown once):\n    ${key}`);
  console.log(`\n  curl -sX POST localhost:3001/api/agent/pay \\`);
  console.log(`    -H "authorization: Bearer ${key}" \\`);
  console.log(`    -H "content-type: application/json" \\`);
  console.log(`    -d '{"roleId":"${marketing.id}","to":"${VENDORS.saas}","amount":"120.00","reason":"Ad platform top-up"}'`);
  return org;
}

function nextMonthFirst() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
