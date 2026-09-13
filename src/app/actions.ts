"use server";

import { revalidatePath } from "next/cache";
import { claimMember, memberForInviteCode, reissueInvite } from "@/lib/identity";
import { embeddedWalletAddress, verifiedPrivyUserId } from "@/lib/privy-auth";
import { cookies } from "next/headers";
import { requestPayment } from "@/lib/payments";
import { approvePayment, rejectPayment, ApprovalDenied } from "@/lib/approvals";
import { offboardMember } from "@/lib/offboarding";
import { createRole, revokeGrants, grantCapability } from "@/lib/roles";
import { addMember } from "@/lib/orgs";
import { issueApiKey, NotAnAgent } from "@/lib/agents";
import { fundRole, FundingDenied } from "@/lib/treasury";
import { cancelSchedule, createSchedule, runSweep } from "@/lib/schedules";
import { dissolve } from "@/lib/dissolution";
import { SpendDenied } from "@/lib/gate";
import { AuthorizationInvalid } from "@/lib/authorization";
import { ACTOR_COOKIE, currentMember, privyConfigured } from "@/lib/session";
import { formatUsdc, parseUsdc } from "@/lib/format";

/**
 * Every action returns a message rather than throwing at the boundary. A
 * refusal is a normal outcome in this product — the gate declining a payment
 * is the feature working — so the UI has to be able to say why, in words the
 * person can act on.
 */
export type ActionResult =
  /**
   * `secret` is shown once and never stored in plaintext, so the UI has to
   * put it in front of the person at this moment or not at all. It is on the
   * result rather than fetched afterwards because there is nothing to fetch.
   */
  | { ok: true; message: string; secret?: string }
  | { ok: false; message: string; code?: string };

async function actorFor(orgId: string) {
  const member = await currentMember(orgId);
  if (!member) throw new Error("Sign in to continue.");
  return member;
}

export async function payAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const roleId = String(formData.get("roleId"));
  const to = String(formData.get("to") ?? "").trim();
  const reason = String(formData.get("reason") ?? "");
  const amountInput = String(formData.get("amount") ?? "").trim();

  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
    return { ok: false, message: "That does not look like a wallet address." };
  }

  const amount = parseUsdc(amountInput);
  if (amount === null) {
    return { ok: false, message: "Enter an amount, like 250 or 249.50." };
  }

  // The browser signs before it submits, so these ride along on the form.
  // Absent in local development, where there is no Privy wallet to sign with.
  const signature = String(formData.get("actorSignature") ?? "").trim();
  const nonce = String(formData.get("nonce") ?? "").trim();

  try {
    const actor = await actorFor(orgId);
    const result = await requestPayment({
      orgId,
      roleId,
      memberId: actor.id,
      to: to as `0x${string}`,
      amount,
      reason,
      actorSignature: signature ? (signature as `0x${string}`) : undefined,
      nonce: nonce || undefined,
    });

    revalidatePath(`/orgs/${orgId}`, "layout");

    if (result.status === "executed") {
      return { ok: true, message: "Paid. The reason is committed onchain." };
    }
    if (result.status === "pending_approval") {
      return {
        ok: true,
        message:
          result.because === "over_per_tx_cap"
            ? "Over this role's per-payment cap, so it has gone to an approver."
            : "This would pass the role's monthly cap, so it has gone to an approver.",
      };
    }
    return { ok: false, message: `Could not send: ${result.reason}` };
  } catch (err) {
    if (err instanceof SpendDenied) {
      return { ok: false, message: err.message, code: err.code };
    }
    if (err instanceof AuthorizationInvalid) {
      return {
        ok: false,
        message:
          "This payment could not be tied to your wallet, so nothing was sent.",
        code: "bad_signature",
      };
    }
    return { ok: false, message: messageOf(err) };
  }
}

export async function decideAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const paymentId = String(formData.get("paymentId"));
  const decision = String(formData.get("decision"));
  const approvalReason = String(formData.get("approvalReason") ?? "");

  try {
    const actor = await actorFor(orgId);

    if (decision === "reject") {
      await rejectPayment({ orgId, paymentId, approverId: actor.id, approvalReason });
      revalidatePath(`/orgs/${orgId}`, "layout");
      return { ok: true, message: "Turned down. The requester will see why." };
    }

    const result = await approvePayment({
      orgId,
      paymentId,
      approverId: actor.id,
      approvalReason,
    });
    revalidatePath(`/orgs/${orgId}`, "layout");

    if (result.status === "executed") {
      return { ok: true, message: "Approved and paid." };
    }
    return {
      ok: false,
      message:
        result.status === "blocked"
          ? `Approved, but the payment failed: ${result.reason}`
          : "Approved, but the payment did not settle.",
    };
  } catch (err) {
    if (err instanceof ApprovalDenied) {
      return { ok: false, message: err.message, code: err.code };
    }
    return { ok: false, message: messageOf(err) };
  }
}

export async function offboardAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const memberId = String(formData.get("memberId"));
  const disposition =
    formData.get("pendingDisposition") === "leave" ? "leave" : "reject";

  try {
    const actor = await actorFor(orgId);
    const impact = await offboardMember({
      orgId,
      memberId,
      actorId: actor.id,
      pendingDisposition: disposition,
    });

    revalidatePath(`/orgs/${orgId}`, "layout");
    return {
      ok: true,
      message: `${impact.memberName} has been removed from ${count(impact.roles.length, "role")}.`,
    };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

export async function revokeAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const roleId = String(formData.get("roleId"));
  const memberId = String(formData.get("memberId"));

  try {
    const actor = await actorFor(orgId);
    const revoked = await revokeGrants({ orgId, roleId, memberId, actorId: actor.id });
    revalidatePath(`/orgs/${orgId}`, "layout");
    return revoked.length
      ? { ok: true, message: "Removed from the role. That takes effect immediately." }
      : { ok: false, message: "They were not in this role." };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

export async function grantAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const roleId = String(formData.get("roleId"));
  const memberId = String(formData.get("memberId"));
  const capability = formData.get("capability") === "approve" ? "approve" : "spend";

  if (!memberId) return { ok: false, message: "Choose someone to add." };

  try {
    const actor = await actorFor(orgId);
    await grantCapability({ orgId, roleId, memberId, capability, actorId: actor.id });
    revalidatePath(`/orgs/${orgId}`, "layout");
    return { ok: true, message: `Added with ${capability} rights.` };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

/**
 * Development only. Switching identity is how the approval and offboarding
 * flows can be walked through before Privy login exists; it refuses outright
 * once Privy is configured, so it cannot follow the app into production.
 */
/**
 * Attaches the signed-in Privy account to a member seat.
 *
 * The privyUserId comes from the verified token, never from the form — the
 * form only says *which seat*, and the server decides who is asking. The
 * wallet address is read from Privy for the same reason: it is the key every
 * justification will be verified against.
 */
export async function claimSeatAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const inviteCode = String(formData.get("inviteCode") ?? "").trim();

  try {
    const privyUserId = await verifiedPrivyUserId();
    if (!privyUserId) {
      return { ok: false, message: "Your session has expired. Sign in again." };
    }

    const walletAddress = await embeddedWalletAddress(privyUserId);
    if (!walletAddress) {
      return {
        ok: false,
        message:
          "No wallet on your account yet. Give it a moment and try again — " +
          "one is created on first sign-in.",
      };
    }

    // The invitation names the seat. The claimer never chooses which one —
    // that choice was the hole: every unclaimed seat in the org used to be
    // offered to whoever signed in first, approve rights included.
    const seat = await memberForInviteCode(orgId, inviteCode);
    if (!seat) {
      return {
        ok: false,
        message: "That invitation is not valid, or has already been used.",
        code: "bad_invite",
      };
    }

    const member = await claimMember({
      orgId,
      memberId: seat.id,
      privyUserId,
      walletAddress,
      inviteCode,
    });
    revalidatePath(`/orgs/${orgId}`, "layout");
    return { ok: true, message: `Welcome, ${member.displayName}.` };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

/**
 * Issues a fresh invitation for a seat nobody has taken yet, invalidating
 * any previous link. Also the way a seat that predates invitations becomes
 * claimable at all.
 */
export async function reissueInviteAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const memberId = String(formData.get("memberId"));

  try {
    await actorFor(orgId);
    const code = await reissueInvite({ orgId, memberId });
    revalidatePath(`/orgs/${orgId}`, "layout");
    return { ok: true, message: "New invitation issued. Any earlier link is dead.", secret: code };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

export async function switchActorAction(formData: FormData) {
  if (privyConfigured()) {
    throw new Error("Identity comes from the signed-in session.");
  }
  const memberId = String(formData.get("memberId"));
  const orgId = String(formData.get("orgId"));

  (await cookies()).set(ACTOR_COOKIE, memberId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  revalidatePath(`/orgs/${orgId}`, "layout");
}

export async function dissolveRoleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const roleId = String(formData.get("roleId"));

  try {
    const actor = await actorFor(orgId);
    const result = await dissolve({ orgId, roleId, actorId: actor.id });

    revalidatePath(`/orgs/${orgId}`, "layout");

    const parts = [
      result.swept
        ? `${formatUsdc(result.swept.amount)} USDC returned to the treasury`
        : "nothing left to return",
      result.cancelledSchedules
        ? `${count(result.cancelledSchedules, "standing payment")} cancelled`
        : null,
      result.revokedGrants ? `${count(result.revokedGrants, "grant")} revoked` : null,
      result.closedPayments
        ? `${count(result.closedPayments, "waiting payment")} closed`
        : null,
    ].filter(Boolean);

    return { ok: true, message: `Role closed: ${parts.join(", ")}.` };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

export async function scheduleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const roleId = String(formData.get("roleId"));
  const direction = String(formData.get("direction"));
  const to = String(formData.get("to") ?? "").trim();
  const cadence = String(formData.get("cadence") ?? "").trim();
  const reason = String(formData.get("reason") ?? "");
  const amount = parseUsdc(String(formData.get("amount") ?? "").trim());

  if (direction !== "treasury_to_role" && direction !== "role_to_recipient") {
    return { ok: false, message: "Choose what this schedule pays." };
  }
  if (direction === "role_to_recipient" && !/^0x[a-fA-F0-9]{40}$/.test(to)) {
    return { ok: false, message: "That does not look like a wallet address." };
  }
  if (amount === null) {
    return { ok: false, message: "Enter an amount, like 250 or 249.50." };
  }

  try {
    const actor = await actorFor(orgId);
    await createSchedule({
      orgId,
      roleId,
      createdBy: actor.id,
      direction,
      to: direction === "role_to_recipient" ? (to as `0x${string}`) : undefined,
      amount,
      cadence,
      reason,
    });

    revalidatePath(`/orgs/${orgId}`, "layout");
    return { ok: true, message: "Scheduled. It runs from the next sweep." };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

export async function cancelScheduleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const scheduleId = String(formData.get("scheduleId"));

  try {
    const actor = await actorFor(orgId);
    await cancelSchedule({ orgId, scheduleId, actorId: actor.id });
    revalidatePath(`/orgs/${orgId}`, "layout");
    return { ok: true, message: "Cancelled. Nothing more will go out on it." };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

/**
 * The sweep, on demand. It is the same call the cron endpoint makes, so a
 * demo does not need a clock — and nothing here decides anything the
 * schedules had not already been given authority for.
 */
export async function runSweepAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));

  try {
    await actorFor(orgId);
    const results = await runSweep();
    revalidatePath(`/orgs/${orgId}`, "layout");

    if (results.length === 0) {
      return { ok: true, message: "Nothing was due." };
    }
    const paid = results.filter((r) => r.status === "paid").length;
    const waiting = results.filter((r) => r.status === "pending_approval").length;
    const short = results.filter((r) => r.status === "short").length;
    const unstaffed = results.filter((r) => r.status === "unstaffed").length;

    const parts = [
      paid ? `${count(paid, "payment")} sent` : null,
      waiting ? `${count(waiting, "payment")} waiting on approval` : null,
      short ? `${count(short, "schedule")} short of funds` : null,
      unstaffed ? `${count(unstaffed, "schedule")} with nobody to run it` : null,
    ].filter(Boolean);

    return { ok: true, message: `Swept: ${parts.join(", ")}.` };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

/**
 * Creating a role provisions a real wallet under a real policy, so this is
 * the one action here that reaches outside the database before it commits.
 * It is slow for that reason, and worth the wait: the cap the form asks for
 * is written into the enclave in the same operation that writes it to the
 * roles table, which is why the two can never disagree.
 */
export async function createRoleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const name = String(formData.get("name") ?? "").trim();
  const perTxRaw = String(formData.get("capPerTx") ?? "").trim();
  const monthlyRaw = String(formData.get("capMonthly") ?? "").trim();

  if (!name) return { ok: false, message: "Give the role a name." };

  const capPerTx = parseUsdc(perTxRaw);
  if (capPerTx === null || capPerTx <= 0n) {
    return { ok: false, message: "Set a per-payment cap above zero." };
  }

  // Left blank means uncapped, which is a real choice and not a mistake —
  // Operations is seeded that way. But an uncapped role gets no enclave
  // ceiling, so the gate alone governs it, and the form says so.
  let capMonthly: bigint | null = null;
  if (monthlyRaw) {
    capMonthly = parseUsdc(monthlyRaw);
    if (capMonthly === null || capMonthly <= 0n) {
      return { ok: false, message: "The monthly budget has to be above zero, or blank." };
    }
    if (capMonthly < capPerTx) {
      return {
        ok: false,
        message:
          "The monthly budget is below the per-payment cap, so no payment could ever clear. " +
          "Raise the budget or lower the cap.",
      };
    }
  }

  try {
    const actor = await actorFor(orgId);
    const role = await createRole({
      orgId,
      name,
      capPerTx,
      capMonthly,
      actorId: actor.id,
    });
    revalidatePath(`/orgs/${orgId}`, "layout");
    return {
      ok: true,
      message: `${role.name} created, with its own wallet at ${role.address.slice(0, 6)}…${role.address.slice(-4)}.`,
    };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

/**
 * People and agents are added the same way, into the same table, because
 * they are the same kind of thing to everything downstream. A new member
 * holds nothing until someone grants it — being in the org is not authority.
 */
export async function addMemberAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const displayName = String(formData.get("displayName") ?? "").trim();
  const kind = formData.get("kind") === "agent" ? "agent" : "person";

  if (!displayName) return { ok: false, message: "Give them a name." };

  try {
    const actor = await actorFor(orgId);
    const member = await addMember({ orgId, kind, displayName, actorId: actor.id });
    revalidatePath(`/orgs/${orgId}`, "layout");
    return {
      ok: true,
      message: `${member.displayName} added. They hold nothing yet — give them rights on a role.`,
    };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

/**
 * Hands back the key exactly once. Reissuing invalidates the previous one,
 * so the form warns before doing it rather than after.
 */
export async function issueApiKeyAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const memberId = String(formData.get("memberId"));

  try {
    const actor = await actorFor(orgId);
    const { key } = await issueApiKey(memberId, actor.id);
    revalidatePath(`/orgs/${orgId}`, "layout");
    return {
      ok: true,
      message: "Key issued. It is shown once and cannot be recovered.",
      secret: key,
    };
  } catch (err) {
    if (err instanceof NotAnAgent) {
      return {
        ok: false,
        message: "Only agents carry API keys. People sign in instead.",
        code: "not_an_agent",
      };
    }
    return { ok: false, message: messageOf(err) };
  }
}

/**
 * Topping a role up from the treasury. Not a payment: the caps bound what a
 * role pays out, not what it is given, so this makes no trip through the
 * gate and commits no reason onchain.
 */
export async function fundRoleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgId = String(formData.get("orgId"));
  const roleId = String(formData.get("roleId"));
  const amountRaw = String(formData.get("amount") ?? "").trim();

  const amount = parseUsdc(amountRaw);
  if (amount === null || amount <= 0n) {
    return { ok: false, message: "Enter an amount above zero." };
  }

  try {
    const actor = await actorFor(orgId);
    await fundRole({ orgId, roleId, amount, actorId: actor.id });
    revalidatePath(`/orgs/${orgId}`, "layout");
    return { ok: true, message: `Moved ${formatUsdc(amount)} USDC from the treasury.` };
  } catch (err) {
    if (err instanceof FundingDenied) {
      return { ok: false, message: err.message, code: err.code };
    }
    return { ok: false, message: messageOf(err) };
  }
}

/** "250.50" → 250500000n. Rejects anything that is not a plain amount. */
function messageOf(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
