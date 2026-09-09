import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity } from "./activity";
import { liveGrant } from "./gate";
import { executePayment, type PaymentOutcome } from "./payments";

export type ApprovalDenyCode =
  | "not_pending"
  | "no_approve_grant"
  | "self_approval"
  | "requester_revoked"
  | "role_dissolved"
  | "missing_reason";

export class ApprovalDenied extends Error {
  constructor(
    readonly code: ApprovalDenyCode,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalDenied";
  }
}

interface ApprovalRequest {
  orgId: string;
  paymentId: string;
  approverId: string;
  /** The approver's own justification. They are answering for this too. */
  approvalReason: string;
  signature?: `0x${string}`;
}

/**
 * Approving releases a payment the gate had already parked. It deliberately
 * does NOT re-run the cap check — the amount being over the cap is the entire
 * reason this is here, so re-deciding would refuse everything an approver is
 * for.
 *
 * What it does re-check is authority, on both sides. A payment approved after
 * its requester was offboarded would be exactly the leak this product claims
 * to close.
 */
export async function approvePayment(
  req: ApprovalRequest,
): Promise<PaymentOutcome> {
  const { payment, role } = await loadPending(req.paymentId);

  const reason = req.approvalReason?.trim() ?? "";
  if (!reason) {
    throw new ApprovalDenied(
      "missing_reason",
      "Say why you are approving this. Approvals are on the record too.",
    );
  }

  // An approval you can give yourself is not an approval.
  if (req.approverId === payment.actorId) {
    throw new ApprovalDenied(
      "self_approval",
      "You cannot approve your own payment. Someone else with approve rights has to.",
    );
  }

  if (!(await liveGrant(req.approverId, payment.roleId, "approve"))) {
    throw new ApprovalDenied(
      "no_approve_grant",
      `You do not have approve rights on ${role.name}.`,
    );
  }

  // The requester's authority has to still be live at the moment funds move,
  // not merely at the moment they asked.
  if (!(await liveGrant(payment.actorId, payment.roleId, "spend"))) {
    throw new ApprovalDenied(
      "requester_revoked",
      "The person who requested this is no longer in the role. It cannot be approved.",
    );
  }

  await db
    .update(schema.payments)
    .set({
      status: "executing",
      approvedBy: req.approverId,
      approvalReason: reason,
    })
    .where(eq(schema.payments.id, payment.id));

  await logActivity({
    orgId: req.orgId,
    type: "payment.approved",
    actorId: req.approverId,
    roleId: payment.roleId,
    subjectId: payment.id,
    payload: { approvalReason: reason, amount: payment.amount },
  });

  return executePayment({ orgId: req.orgId, paymentId: payment.id });
}

/**
 * Rejection is a decision, so it carries a name and a reason like every other
 * decision here. The row stays — a rejected request is part of the record of
 * how a role was run.
 */
export async function rejectPayment(req: ApprovalRequest): Promise<void> {
  const { payment, role } = await loadPending(req.paymentId);

  const reason = req.approvalReason?.trim() ?? "";
  if (!reason) {
    throw new ApprovalDenied(
      "missing_reason",
      "Say why you are turning this down. The requester will see it.",
    );
  }

  if (!(await liveGrant(req.approverId, payment.roleId, "approve"))) {
    throw new ApprovalDenied(
      "no_approve_grant",
      `You do not have approve rights on ${role.name}.`,
    );
  }

  await db
    .update(schema.payments)
    .set({
      status: "rejected",
      approvedBy: req.approverId,
      approvalReason: reason,
    })
    .where(eq(schema.payments.id, payment.id));

  await logActivity({
    orgId: req.orgId,
    type: "payment.rejected",
    actorId: req.approverId,
    roleId: payment.roleId,
    subjectId: payment.id,
    payload: { approvalReason: reason },
  });
}

async function loadPending(paymentId: string) {
  const payment = await db.query.payments.findFirst({
    where: eq(schema.payments.id, paymentId),
  });
  if (!payment) throw new Error(`No payment ${paymentId}`);

  if (payment.status !== "pending_approval") {
    throw new ApprovalDenied(
      "not_pending",
      `This payment is ${payment.status}, so there is nothing to decide.`,
    );
  }

  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, payment.roleId),
  });
  if (!role) throw new Error(`Payment ${paymentId} has no role`);

  if (role.status !== "active") {
    throw new ApprovalDenied(
      "role_dissolved",
      `${role.name} has been dissolved. Its pending payments cannot be released.`,
    );
  }

  return { payment, role };
}

/** Everything waiting on a decision, newest first, with who asked and why. */
export async function pendingApprovals(orgId: string) {
  return db
    .select({
      id: schema.payments.id,
      roleId: schema.payments.roleId,
      roleName: schema.roles.name,
      amount: schema.payments.amount,
      toAddress: schema.payments.toAddress,
      reason: schema.payments.reason,
      createdAt: schema.payments.createdAt,
      requestedBy: schema.members.displayName,
      requestedById: schema.members.id,
      requesterKind: schema.members.kind,
      capPerTx: schema.roles.capPerTx,
    })
    .from(schema.payments)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.payments.roleId))
    .innerJoin(schema.members, eq(schema.members.id, schema.payments.actorId))
    .where(
      and(
        eq(schema.roles.orgId, orgId),
        eq(schema.payments.status, "pending_approval"),
      ),
    )
    .orderBy(desc(schema.payments.createdAt));
}
