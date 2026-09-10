"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requestPayment } from "@/lib/payments";
import { approvePayment, rejectPayment, ApprovalDenied } from "@/lib/approvals";
import { offboardMember } from "@/lib/offboarding";
import { revokeGrants, grantCapability } from "@/lib/roles";
import { SpendDenied } from "@/lib/gate";
import { ACTOR_COOKIE, currentMember, privyConfigured } from "@/lib/session";

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

  try {
    const actor = await actorFor(orgId);
    const result = await requestPayment({
      orgId,
      roleId,
      memberId: actor.id,
      to: to as `0x${string}`,
      amount,
      reason,
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

/** "250.50" → 250500000n. Rejects anything that is not a plain amount. */
function parseUsdc(input: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
