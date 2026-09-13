"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { revokeAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function RevokeButton({
  orgId,
  roleId,
  memberId,
}: {
  orgId: string;
  roleId: string;
  memberId: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    revokeAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  return (
    <form action={action}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="roleId" value={roleId} />
      <input type="hidden" name="memberId" value={memberId} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        disabled={pending}
        className="text-muted-foreground hover:text-destructive"
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
    </form>
  );
}
