"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { addMemberAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * People and agents are added through one form with one toggle, because
 * adding them is one operation on one table. A separate "add an agent" flow
 * would quietly imply a second authority model, and there is only ever one.
 *
 * Being in the organization is not authority. A new member holds nothing
 * until someone grants it on a role, and the form ends by saying so rather
 * than leaving the person to discover it.
 */
export function NewMemberForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addMemberAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ displayName: "", kind: "person" });

  useEffect(() => {
    if (!state) return;
    (state.ok ? toast.success : toast.error)(state.message);
  }, [state]);

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setDraft({ displayName: "", kind: "person" });
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Add someone
      </Button>
    );
  }

  const field =
    "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <form
      action={action}
      className="w-full space-y-4 rounded-lg border border-border p-4 sm:w-[30rem]"
    >
      <input type="hidden" name="orgId" value={orgId} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="member-name" className="text-xs">
            Name
          </Label>
          <Input
            id="member-name"
            name="displayName"
            required
            autoFocus
            placeholder="Dev Raman"
            value={draft.displayName}
            onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
          />
        </div>

        <div className="min-w-36 space-y-2">
          <Label htmlFor="member-kind" className="text-xs">
            Is a
          </Label>
          <select
            id="member-kind"
            name="kind"
            className={field}
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
          >
            <option value="person">Person</option>
            <option value="agent">Agent</option>
          </select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-pretty">
        {draft.kind === "agent"
          ? "Agents authenticate with an API key you issue from their page. They hold grants and answer to caps exactly as people do."
          : "People sign in with Privy and claim their seat. Adding them here creates the seat, not the authority."}
      </p>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add to organization"}
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
