"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { cancelScheduleAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function CancelSchedule({
  orgId,
  scheduleId,
}: {
  orgId: string;
  scheduleId: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    cancelScheduleAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    (state.ok ? toast.success : toast.error)(state.message);
  }, [state]);

  return (
    <form action={action}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? "Cancelling…" : "Cancel"}
      </Button>
    </form>
  );
}
