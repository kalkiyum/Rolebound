"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { dissolveRoleAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/rolebound/primitives";

/**
 * Closing a role is not a delete button either. What it takes with it — the
 * balance, the standing payments, everyone's authority — is stated before
 * the confirmation, because those are the three things people forget and
 * then discover a month later.
 */
export function DissolveRole({
  orgId,
  roleId,
  roleName,
  balance,
  returnsTo,
  scheduleCount,
  holderCount,
  pendingCount,
}: {
  orgId: string;
  roleId: string;
  roleName: string;
  balance: bigint | null;
  returnsTo: string | null;
  scheduleCount: number;
  holderCount: number;
  pendingCount: number;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    dissolveRoleAction,
    null,
  );
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!state) return;
    (state.ok ? toast.success : toast.error)(state.message);
  }, [state]);

  // Derived rather than reset in an effect: once it has gone through, the
  // confirmation has nothing left to confirm. The revalidated page takes the
  // whole section away a moment later anyway.
  const confirming = asking && !state?.ok;

  if (!confirming) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setAsking(true)}
      >
        Dissolve this role
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="roleId" value={roleId} />

      <ul className="space-y-1 text-sm text-muted-foreground">
        <li>
          {balance === null ? (
            "The balance could not be read, so nothing will be returned yet."
          ) : balance === 0n ? (
            "There is nothing left in the wallet to return."
          ) : (
            <>
              <Money base={balance} className="text-foreground" /> goes back to
              the treasury{returnsTo ? ` (${returnsTo.slice(0, 6)}…${returnsTo.slice(-4)})` : ""}.
            </>
          )}
        </li>
        {scheduleCount > 0 ? (
          <li>
            {scheduleCount === 1
              ? "1 standing payment is cancelled"
              : `${scheduleCount} standing payments are cancelled`}
            .
          </li>
        ) : null}
        {holderCount > 0 ? (
          <li>
            {holderCount === 1 ? "1 person loses" : `${holderCount} people lose`}{" "}
            their authority over {roleName}.
          </li>
        ) : null}
        {pendingCount > 0 ? (
          <li>
            {pendingCount === 1
              ? "1 payment waiting on an approver is closed"
              : `${pendingCount} payments waiting on an approver are closed`}
            .
          </li>
        ) : null}
        <li>The history stays readable. Nothing is deleted.</li>
      </ul>

      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          {pending ? "Closing…" : `Dissolve ${roleName}`}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setAsking(false)}
          disabled={pending}
        >
          Keep it
        </Button>
      </div>
    </form>
  );
}
