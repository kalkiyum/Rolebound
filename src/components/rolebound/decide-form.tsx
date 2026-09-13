"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { decideAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Outcome } from "@/components/rolebound/primitives";

/**
 * Approving and turning down are the same form because they are the same
 * decision, and both of them require a reason. An approver who cannot say why
 * has not made one.
 */
export function DecideForm({
  orgId,
  paymentId,
  canApprove,
  isOwnRequest,
}: {
  orgId: string;
  paymentId: string;
  canApprove: boolean;
  isOwnRequest: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    decideAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  if (isOwnRequest) {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        This is your own request. An approval you can give yourself is not an
        approval — someone else on this role has to decide.
      </p>
    );
  }

  if (!canApprove) {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        You do not hold approval rights on this role, so this one is not yours
        to decide.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      {state && !state.ok ? (
        <Outcome tone="refused" title={state.message} />
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="paymentId" value={paymentId} />

        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor={`why-${paymentId}`} className="text-xs">
            Your reason
          </Label>
          <Input
            id={`why-${paymentId}`}
            name="approvalReason"
            required
            autoComplete="off"
            placeholder="Checked the invoice against the SOW"
          />
        </div>

        <div className="flex gap-2">
          <Button
            type="submit"
            name="decision"
            value="approve"
            disabled={pending}
            size="sm"
          >
            {pending ? "Working…" : "Approve and pay"}
          </Button>
          <Button
            type="submit"
            name="decision"
            value="reject"
            disabled={pending}
            size="sm"
            variant="outline"
          >
            Turn down
          </Button>
        </div>
      </div>
    </form>
  );
}
