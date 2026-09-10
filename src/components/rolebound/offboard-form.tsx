"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { offboardAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Offboarding is not a delete button. The impact is computed and shown first,
 * and the one thing that is genuinely a choice — what happens to requests
 * already in flight — is asked rather than assumed.
 */
export function OffboardForm({
  orgId,
  memberId,
  memberName,
  roleCount,
  pendingCount,
}: {
  orgId: string;
  memberId: string;
  memberName: string;
  roleCount: number;
  pendingCount: number;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    offboardAction,
    null,
  );
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  if (roleCount === 0) {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        {memberName} holds no live grants, so there is nothing left to take
        away. Their history stays where it is.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="memberId" value={memberId} />

      {pendingCount > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Requests already waiting on an approver
          </legend>
          <p className="text-sm text-muted-foreground text-pretty">
            {memberName} has {pendingCount}{" "}
            {pendingCount === 1 ? "request" : "requests"} nobody has decided on
            yet.
          </p>

          <div className="space-y-2 pt-1">
            <Label className="flex items-start gap-2.5 text-sm font-normal">
              <input
                type="radio"
                name="pendingDisposition"
                value="reject"
                defaultChecked
                className="mt-1"
              />
              <span className="text-pretty">
                Turn them down now — nobody is asked, weeks later, to release
                money for someone who has left.
              </span>
            </Label>
            <Label className="flex items-start gap-2.5 text-sm font-normal">
              <input
                type="radio"
                name="pendingDisposition"
                value="leave"
                className="mt-1"
              />
              <span className="text-pretty">
                Leave them queued — an approver still decides each one.
              </span>
            </Label>
          </div>
        </fieldset>
      ) : null}

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1"
        />
        <span className="text-pretty">
          I understand this removes {memberName} from{" "}
          {roleCount === 1 ? "1 role" : `${roleCount} roles`}, effective
          immediately.
        </span>
      </label>

      <Button type="submit" variant="destructive" disabled={pending || !confirmed}>
        {pending ? "Removing…" : `Remove ${memberName}`}
      </Button>
    </form>
  );
}
