"use server";

import { revalidatePath } from "next/cache";
import { claimMember } from "@/lib/identity";
import { embeddedWalletAddress, verifiedPrivyUserId } from "@/lib/privy-auth";
import { cookies } from "next/headers";
import { requestPayment } from "@/lib/payments";
import { approvePayment, rejectPayment, ApprovalDenied } from "@/lib/approvals";
import { offboardMember } from "@/lib/offboarding";
import { revokeGrants, grantCapability } from "@/lib/roles";
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
  | { ok: true; message: string }
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
  const memberId = String(formData.get("memberId"));

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

    await claimMember({ orgId, memberId, privyUserId, walletAddress });
    revalidatePath(`/orgs/${orgId}`, "layout");
    return { ok: true, message: "Welcome back." };
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

/** "250.50" → 250500000n. Rejects anything that is not a plain amount. */
function messageOf(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
