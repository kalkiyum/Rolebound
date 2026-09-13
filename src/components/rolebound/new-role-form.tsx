"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { createRoleAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseUsdc } from "@/lib/format";

/**
 * Creating a role is creating a wallet — the form says so, because a person
 * who thinks they are naming a category will not think carefully about the
 * numbers underneath it, and those numbers are what the enclave is about to
 * be told.
 *
 * The two caps do different jobs and are worth distinguishing here rather
 * than in a tooltip nobody opens: the per-payment cap decides what needs an
 * approver, and the monthly budget becomes the ceiling no approval can lift.
 */
export function NewRoleForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createRoleAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", capPerTx: "", capMonthly: "" });

  useEffect(() => {
    if (!state) return;
    (state.ok ? toast.success : toast.error)(state.message);
  }, [state]);

  // Render-time reset rather than an effect: once it succeeded there is
  // nothing left in the draft that belongs on screen.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setDraft({ name: "", capPerTx: "", capMonthly: "" });
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        New role
      </Button>
    );
  }

  // The one combination that produces a role nothing can ever pay out of.
  // Flagged while typing rather than on submit, because the fix is to change
  // a number the person is already looking at.
  const perTx = parseUsdc(draft.capPerTx.trim());
  const monthly = draft.capMonthly.trim() ? parseUsdc(draft.capMonthly.trim()) : null;
  const impossible = perTx !== null && monthly !== null && monthly < perTx;

  return (
    <form action={action} className="w-full space-y-4 rounded-lg border border-border p-4 sm:w-[32rem]">
      <input type="hidden" name="orgId" value={orgId} />

      <div className="space-y-2">
        <Label htmlFor="role-name" className="text-xs">
          Name
        </Label>
        <Input
          id="role-name"
          name="name"
          required
          autoFocus
          placeholder="Marketing"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="role-per-tx" className="text-xs">
            Cap per payment
          </Label>
          <Input
            id="role-per-tx"
            name="capPerTx"
            required
            inputMode="decimal"
            placeholder="500"
            className="font-mono tnum"
            value={draft.capPerTx}
            onChange={(e) => setDraft({ ...draft, capPerTx: e.target.value })}
          />
          <p className="text-xs text-muted-foreground text-pretty">
            Above this, a payment waits for an approver instead of going out.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="role-monthly" className="text-xs">
            Monthly budget{" "}
            <span className="text-muted-foreground">— optional</span>
          </Label>
          <Input
            id="role-monthly"
            name="capMonthly"
            inputMode="decimal"
            placeholder="4,000"
            className="font-mono tnum"
            value={draft.capMonthly}
            onChange={(e) => setDraft({ ...draft, capMonthly: e.target.value })}
          />
          <p className="text-xs text-muted-foreground text-pretty">
            {draft.capMonthly.trim()
              ? "Becomes the wallet's hard ceiling. No approver can authorize past it."
              : "Left blank, the role is uncapped monthly and the enclave stays silent on amount."}
          </p>
        </div>
      </div>

      {impossible ? (
        <p className="text-sm text-refused text-pretty">
          The monthly budget is below the per-payment cap, so no payment could
          ever clear. Raise the budget or lower the cap.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground text-pretty">
        This provisions a real wallet with its own key, under a policy carrying
        the ceiling above. It takes a few seconds.
      </p>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Provisioning…" : "Create role"}
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
