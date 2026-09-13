"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { runSweepAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * The hourly sweep, on demand. Production drives the same work through
 * `POST /api/cron/sweep`; this exists so the behaviour can be shown without
 * waiting for a clock, which is the only way anyone ever sees it.
 */
export function RunSweep({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    runSweepAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    (state.ok ? toast.success : toast.error)(state.message);
  }, [state]);

  return (
    <form action={action}>
      <input type="hidden" name="orgId" value={orgId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Running…" : "Run the sweep now"}
      </Button>
    </form>
  );
}
