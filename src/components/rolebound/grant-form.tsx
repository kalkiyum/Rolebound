"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { grantAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Adding someone to a role is granting authority over real money, so the
 * capability is an explicit choice rather than a default. Spend and approve
 * are separate on purpose: holding both on one role means approving your own
 * work, which the gate refuses anyway.
 */
export function GrantForm({
  orgId,
  memberId,
  roles,
}: {
  orgId: string;
  memberId: string;
  roles: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    grantAction,
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

  if (roles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        They already hold every active role.
      </p>
    );
  }

  const field =
    "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="memberId" value={memberId} />

      <div className="min-w-44 flex-1 space-y-2">
        <Label htmlFor="grant-role" className="text-xs">
          Role
        </Label>
        <select id="grant-role" name="roleId" required className={field}>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-36 space-y-2">
        <Label htmlFor="grant-capability" className="text-xs">
          Can
        </Label>
        <select id="grant-capability" name="capability" className={field}>
          <option value="spend">Spend</option>
          <option value="approve">Approve</option>
        </select>
      </div>

      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "Add to role"}
      </Button>
    </form>
  );
}
