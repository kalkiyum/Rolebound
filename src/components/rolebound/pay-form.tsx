"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { payAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatUsdc } from "@/lib/format";

export function PayForm({
  orgId,
  roleId,
  roleName,
  capPerTx,
  remainingMonthly,
  canSpend,
}: {
  orgId: string;
  roleId: string;
  roleName: string;
  capPerTx: string;
  remainingMonthly: string | null;
  canSpend: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    payAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message);
      formRef.current?.reset();
    } else {
      toast.error(state.message);
    }
  }, [state]);

  if (!canSpend) {
    return (
      <div className="rounded-lg border border-dashed border-border p-5">
        <p className="text-sm font-medium">You cannot spend from {roleName}</p>
        <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
          Spending needs a live grant on this role. Someone who can already
          approve here has to add you.
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="roleId" value={roleId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="amount">Amount</Label>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            placeholder="250.00"
            autoComplete="off"
            required
            className="font-mono tabular-nums"
          />
          <p className="text-xs text-muted-foreground">
            Up to{" "}
            <span className="font-mono tabular-nums">{formatUsdc(capPerTx)}</span>{" "}
            without approval
            {remainingMonthly !== null ? (
              <>
                {" · "}
                <span className="font-mono tabular-nums">
                  {formatUsdc(remainingMonthly)}
                </span>{" "}
                left this month
              </>
            ) : null}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="to">Recipient</Label>
          <Input
            id="to"
            name="to"
            placeholder="0x…"
            autoComplete="off"
            required
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            The wallet being paid.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reason">
          Reason <span className="text-muted-foreground">(required)</span>
        </Label>
        <Textarea
          id="reason"
          name="reason"
          rows={2}
          required
          placeholder="Landing page design, invoice #204"
        />
        <p className="text-xs text-muted-foreground text-pretty">
          Committed onchain as a hash in the same transaction that moves the
          money. The words stay here; the commitment is public and permanent.
        </p>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send payment"}
      </Button>
    </form>
  );
}
