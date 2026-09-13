"use client";

import { useTransition } from "react";
import { switchActorAction } from "@/app/actions";
import { KindBadge } from "./primitives";

interface Member {
  id: string;
  displayName: string;
  kind: "person" | "agent";
}

/**
 * Development only — the org layout does not render this once Privy is
 * configured. Approvals and offboarding are only meaningful with more than
 * one identity, and until login exists there is no other way to be someone
 * else.
 */
export function ActorSwitcher({
  orgId,
  members,
  actorId,
}: {
  orgId: string;
  members: Member[];
  actorId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const current = members.find((m) => m.id === actorId);

  return (
    <form
      action={(formData) => startTransition(() => switchActorAction(formData))}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <label
        htmlFor="actor"
        className="font-mono text-[10px] uppercase tracking-wider text-chrome-muted"
        title="Development only. Identity comes from the signed-in session once Privy login is wired up."
      >
        acting as
      </label>
      <select
        id="actor"
        name="memberId"
        defaultValue={actorId ?? ""}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-sm text-chrome-foreground disabled:opacity-50 [&>option]:text-foreground"
      >
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName}
            {m.kind === "agent" ? " (agent)" : ""}
          </option>
        ))}
      </select>
      {current ? <KindBadge kind={current.kind} /> : null}
    </form>
  );
}
