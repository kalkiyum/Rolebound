"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { fundRoleAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/rolebound/primitives";
import { parseUsdc } from "@/lib/format";

/**
 * Topping the role up from the treasury.
 *
 * This is not a payment and the form is shaped to keep that clear: no
 * recipient, no reason, no trip past the gate. The caps bound what a role
 * pays *out*; what it holds is the treasury's decision, and a cap that
 * applied here would mean a role could be starved of the very budget it was
 * given.
 */
export function FundRole({
  orgId,
  roleId,
  roleName,
  balance,
  treasuryBalance,
}: {
  orgId: string;
  roleId: string;
  roleName: string;
  balance: bigint | null;
  treasuryBalance: bigint | null;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    fundRoleAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (!state) return;
    (state.ok ? toast.success : toast.error)(state.message);
  }, [state]);

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setAmount("");
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Fund from treasury
      </Button>
    );
  }

  const parsed = parseUsdc(amount.trim());
  const overdrawn =
    parsed !== null && treasuryBalance !== null && parsed > treasuryBalance;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="roleId" value={roleId} />

      <div className="space-y-2">
        <Label htmlFor="fund-amount" className="text-xs">
          Move to {roleName}
        </Label>
        <Input
          id="fund-amount"
          name="amount"
          required
          autoFocus
          inputMode="decimal"
          placeholder="1,000"
          className="font-mono tnum"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <p className="text-sm text-muted-foreground text-pretty">
        {treasuryBalance === null ? (
          "The treasury balance could not be read."
        ) : (
          <>
            The treasury holds <Money base={treasuryBalance} className="text-foreground" />.
          </>
        )}{" "}
        {balance === null ? null : (
          <>
            {roleName} holds <Money base={balance} className="text-foreground" /> today.
          </>
        )}
      </p>

      {overdrawn ? (
        <p className="text-sm text-refused text-pretty">
          That is more than the treasury holds.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || overdrawn}>
          {pending ? "Sending…" : "Send"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
