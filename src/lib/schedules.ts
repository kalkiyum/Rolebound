import "server-only";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { encodeFunctionData } from "viem";
import { db, schema } from "@/db";
import { erc20TransferAbi } from "./abi";
import { logActivity } from "./activity";
import { roleBalances } from "./balances";
import { describeCadence, nextRun } from "./cadence";
import { publicClient } from "./chain";
import { env } from "./env";
import { liveGrant, SpendDenied } from "./gate";
import { requestPayment } from "./payments";
import { sendFromWallet } from "./wallets";

/**
 * Recurring money, owned by the role.
 *
 * The point of the ownership is what happens when a person leaves: a
 * retainer set up by someone who has since been offboarded keeps running,
 * under whoever holds the role now. What it must never do is run under
 * *nobody* — a schedule with no live grant behind it is reported as
 * unstaffed and left alone, because "the agency did not get paid" is a
 * recoverable Monday and "money left a role no one is answerable for" is
 * the failure this product exists to prevent.
 *
 * Every recipient payment still goes through `requestPayment()`, so the
 * gate, the cap and the reason apply exactly as they do to a person
 * clicking Pay. There is no scheduled-payment shortcut.
 */

export type Direction = "treasury_to_role" | "role_to_recipient";

export interface NewSchedule {
  orgId: string;
  roleId: string;
  createdBy: string;
  direction: Direction;
  /** Required for `role_to_recipient`; ignored for a top-up. */
  to?: `0x${string}`;
  amount: bigint;
  cadence: string;
  reason: string;
  /** The clock the first run is computed from. Defaults to now. */
  startAt?: Date;
}

export type SweepResult =
  | { scheduleId: string; status: "paid"; paymentId?: string; txHash: `0x${string}` }
  | { scheduleId: string; status: "pending_approval"; paymentId: string; because: string }
  | { scheduleId: string; status: "short"; needed: bigint; available: bigint; shortfall: bigint }
  | { scheduleId: string; status: "unstaffed" }
  | { scheduleId: string; status: "blocked"; reason: string };

export async function createSchedule(input: NewSchedule) {
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Every schedule needs a reason. Say what it pays for.");
  }
  if (input.amount <= 0n) {
    throw new Error("Enter an amount greater than zero.");
  }
  if (input.direction === "role_to_recipient" && !input.to) {
    throw new Error("A recurring payment needs a recipient address.");
  }
  // Throws InvalidCadence, which is the right moment for it: refusing at
  // creation is a form the person can fix, refusing at 3am is a page.
  const nextRunAt = nextRun(input.cadence, input.startAt ?? new Date());

  // Only someone who could make this payment by hand may make it recur.
  // Otherwise a schedule is a way to spend without ever holding the role.
  if (!(await liveGrant(input.createdBy, input.roleId, "spend"))) {
    throw new Error(
      "You need spend authority on this role to set up a recurring payment.",
    );
  }

  const [schedule] = await db
    .insert(schema.schedules)
    .values({
      roleId: input.roleId,
      createdBy: input.createdBy,
      direction: input.direction,
      toAddress: input.to ?? null,
      token: env.usdc,
      amount: input.amount.toString(),
      cadence: input.cadence,
      nextRunAt,
      reason,
    })
    .returning();

  await logActivity({
    orgId: input.orgId,
    type: "schedule.created",
    actorId: input.createdBy,
    roleId: input.roleId,
    subjectId: schedule.id,
    payload: {
      direction: schedule.direction,
      amount: schedule.amount,
      to: schedule.toAddress,
      when: describeCadence(schedule.cadence),
      reason,
    },
  });

  return schedule;
}

export async function cancelSchedule(input: {
  orgId: string;
  scheduleId: string;
  actorId?: string | null;
}) {
  const [schedule] = await db
    .update(schema.schedules)
    .set({ status: "cancelled" })
    .where(eq(schema.schedules.id, input.scheduleId))
    .returning();
  if (!schedule) throw new Error(`No schedule ${input.scheduleId}`);

  await logActivity({
    orgId: input.orgId,
    type: "schedule.cancelled",
    actorId: input.actorId ?? null,
    roleId: schedule.roleId,
    subjectId: schedule.id,
    payload: { reason: schedule.reason, amount: schedule.amount },
  });

  return schedule;
}

export async function dueSchedules(now: Date = new Date()) {
  return db
    .select()
    .from(schema.schedules)
    .where(
      and(
        eq(schema.schedules.status, "active"),
        lte(schema.schedules.nextRunAt, now),
      ),
    )
    .orderBy(asc(schema.schedules.nextRunAt));
}

/**
 * Runs everything due. Safe to call as often as you like: a schedule only
 * advances when it actually ran, so a sweep that finds nothing does nothing,
 * and one that finds a role underfunded leaves it due — funding the role is
 * then the whole fix, with no second button to press.
 */
export async function runSweep(opts: { now?: Date } = {}): Promise<SweepResult[]> {
  const now = opts.now ?? new Date();
  const due = await dueSchedules(now);
  const results: SweepResult[] = [];

  for (const schedule of due) {
    results.push(await runOne(schedule, now));
  }
  return results;
}

type Schedule = Awaited<ReturnType<typeof dueSchedules>>[number];

async function runOne(schedule: Schedule, now: Date): Promise<SweepResult> {
  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, schedule.roleId),
  });
  if (!role) return { scheduleId: schedule.id, status: "blocked", reason: "The role is gone." };

  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, role.orgId),
  });
  if (!org) return { scheduleId: schedule.id, status: "blocked", reason: "The organization is gone." };

  const amount = BigInt(schedule.amount);
  const result =
    schedule.direction === "treasury_to_role"
      ? await topUp({ schedule, org, role, amount })
      : await payRecipient({ schedule, role, amount });

  // Advance only on a run that happened. A skipped period would be a
  // payment quietly dropped, which is the one outcome nobody can audit.
  if (result.status === "paid" || result.status === "pending_approval") {
    await db
      .update(schema.schedules)
      .set({ nextRunAt: nextRun(schedule.cadence, now) })
      .where(eq(schema.schedules.id, schedule.id));
  }

  await logActivity({
    orgId: role.orgId,
    type:
      result.status === "short"
        ? "schedule.short"
        : result.status === "unstaffed"
          ? "schedule.unstaffed"
          : "schedule.ran",
    roleId: role.id,
    subjectId: schedule.id,
    payload: {
      outcome: result.status,
      amount: schedule.amount,
      reason: schedule.reason,
      ...(result.status === "short"
        ? { shortfall: result.shortfall.toString(), available: result.available.toString() }
        : {}),
      ...(result.status === "blocked" ? { blocked: result.reason } : {}),
    },
  });

  return result;
}

async function balanceOf(address: string): Promise<bigint> {
  const balances = await roleBalances([address]);
  const balance = balances.get(address.toLowerCase());
  if (balance === null || balance === undefined) {
    throw new Error("Could not read the balance — the RPC is unreachable.");
  }
  return balance;
}

async function topUp(input: {
  schedule: Schedule;
  org: typeof schema.organizations.$inferSelect;
  role: typeof schema.roles.$inferSelect;
  amount: bigint;
}): Promise<SweepResult> {
  const { schedule, org, role, amount } = input;
  if (!org.treasuryWalletId || !org.treasuryAddress) {
    return { scheduleId: schedule.id, status: "blocked", reason: "This organization has no treasury." };
  }

  const available = await balanceOf(org.treasuryAddress);
  if (available < amount) {
    return {
      scheduleId: schedule.id,
      status: "short",
      needed: amount,
      available,
      shortfall: amount - available,
    };
  }

  try {
    // A top-up is the treasury moving its own money, not a role spending —
    // there is no cap to apply and no reason to commit on chain, so it is a
    // plain transfer rather than a trip through RoleboundPay.
    const hash = await sendFromWallet({
      walletId: org.treasuryWalletId,
      to: env.usdc,
      data: encodeFunctionData({
        abi: erc20TransferAbi,
        functionName: "transfer",
        args: [role.address as `0x${string}`, amount],
      }),
    });
    const receipt = await publicClient().waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
    return { scheduleId: schedule.id, status: "paid", txHash: hash };
  } catch (cause) {
    return {
      scheduleId: schedule.id,
      status: "blocked",
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

async function payRecipient(input: {
  schedule: Schedule;
  role: typeof schema.roles.$inferSelect;
  amount: bigint;
}): Promise<SweepResult> {
  const { schedule, role, amount } = input;
  if (!schedule.toAddress) {
    return { scheduleId: schedule.id, status: "blocked", reason: "This schedule has no recipient." };
  }

  const actorId = await holderOf(role.id, schedule.createdBy);
  if (!actorId) return { scheduleId: schedule.id, status: "unstaffed" };

  const available = await balanceOf(role.address);
  if (available < amount) {
    return {
      scheduleId: schedule.id,
      status: "short",
      needed: amount,
      available,
      shortfall: amount - available,
    };
  }

  try {
    const outcome = await requestPayment({
      orgId: role.orgId,
      roleId: role.id,
      memberId: actorId,
      to: schedule.toAddress as `0x${string}`,
      amount,
      reason: schedule.reason,
    });

    if (outcome.status === "executed") {
      await db
        .update(schema.payments)
        .set({ scheduleId: schedule.id })
        .where(eq(schema.payments.id, outcome.paymentId));
      return {
        scheduleId: schedule.id,
        status: "paid",
        paymentId: outcome.paymentId,
        txHash: outcome.txHash,
      };
    }
    if (outcome.status === "pending_approval") {
      await db
        .update(schema.payments)
        .set({ scheduleId: schedule.id })
        .where(eq(schema.payments.id, outcome.paymentId));
      return {
        scheduleId: schedule.id,
        status: "pending_approval",
        paymentId: outcome.paymentId,
        because: outcome.because,
      };
    }
    return { scheduleId: schedule.id, status: "blocked", reason: outcome.reason };
  } catch (cause) {
    return {
      scheduleId: schedule.id,
      status: "blocked",
      reason: cause instanceof SpendDenied ? cause.message : String(cause),
    };
  }
}

/**
 * Who runs this schedule now. The original author first, so the record names
 * the person who set it up whenever that is still true; otherwise whoever
 * currently holds the role — which is the whole point of a role owning it.
 */
async function holderOf(roleId: string, createdBy: string | null) {
  if (createdBy && (await liveGrant(createdBy, roleId, "spend"))) return createdBy;

  // Oldest live grant, so the choice is deterministic across sweeps rather
  // than whatever the database happened to return first.
  const [held] = await db
    .select({ memberId: schema.grants.memberId })
    .from(schema.grants)
    .where(
      and(
        eq(schema.grants.roleId, roleId),
        eq(schema.grants.capability, "spend"),
        isNull(schema.grants.revokedAt),
      ),
    )
    .orderBy(asc(schema.grants.grantedAt))
    .limit(1);

  return held?.memberId ?? null;
}

export interface UpcomingSchedule {
  id: string;
  roleId: string;
  roleName: string;
  direction: Direction;
  to: string | null;
  amount: bigint;
  reason: string;
  when: string;
  nextRunAt: Date;
  /** 0 when the funding source can cover it today. */
  shortfall: bigint;
}

/**
 * What is coming, and whether it will clear.
 *
 * The shortfall is computed per schedule against the current balance, so two
 * retainers on one underfunded role each report their own gap rather than
 * one absorbing the other's. That over-reports slightly and under-reports
 * never, which is the right way round for a warning.
 */
export async function upcomingSchedules(orgId: string): Promise<UpcomingSchedule[]> {
  const roles = await db.query.roles.findMany({
    where: eq(schema.roles.orgId, orgId),
  });
  if (roles.length === 0) return [];

  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
  });

  const rows = await db
    .select()
    .from(schema.schedules)
    .where(
      and(
        eq(schema.schedules.status, "active"),
        inArray(
          schema.schedules.roleId,
          roles.map((r) => r.id),
        ),
      ),
    )
    .orderBy(asc(schema.schedules.nextRunAt));
  if (rows.length === 0) return [];

  const addresses = [
    ...roles.map((r) => r.address),
    ...(org?.treasuryAddress ? [org.treasuryAddress] : []),
  ];
  const balances = await roleBalances(addresses);
  const balanceFor = (address: string | null | undefined) =>
    (address ? balances.get(address.toLowerCase()) : null) ?? null;

  return rows.map((row) => {
    const role = roles.find((r) => r.id === row.roleId)!;
    const amount = BigInt(row.amount);
    const source =
      row.direction === "treasury_to_role" ? org?.treasuryAddress : role.address;
    const available = balanceFor(source);
    return {
      id: row.id,
      roleId: role.id,
      roleName: role.name,
      direction: row.direction,
      to: row.toAddress,
      amount,
      reason: row.reason,
      when: describeCadence(row.cadence),
      nextRunAt: row.nextRunAt,
      // An unreadable balance is not a shortfall; the screen says nothing
      // rather than crying wolf about money that may well be there.
      shortfall: available === null ? 0n : available >= amount ? 0n : amount - available,
    };
  });
}
