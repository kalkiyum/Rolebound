"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { scheduleAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const field =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Two shapes of recurring money, and they are genuinely different: a top-up
 * moves the org's own funds into a role, a retainer is the role spending.
 * The recipient field appears only for the second, because a top-up has
 * exactly one possible destination — the role itself.
 */
export function ScheduleForm({
  orgId,
  roles,
}: {
  orgId: string;
  roles: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    scheduleAction,
    null,
  );
  const [direction, setDirection] = useState("role_to_recipient");
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

  return (
    <form ref={formRef} action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="orgId" value={orgId} />

      <div className="space-y-2">
        <Label htmlFor="schedule-role" className="text-xs">
          Role
        </Label>
        <select id="schedule-role" name="roleId" required className={field}>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="schedule-direction" className="text-xs">
          Kind
        </Label>
        <select
          id="schedule-direction"
          name="direction"
          className={field}
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <option value="role_to_recipient">Pays a vendor</option>
          <option value="treasury_to_role">Tops the role up</option>
        </select>
      </div>

      {direction === "role_to_recipient" ? (
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="schedule-to" className="text-xs">
            Recipient
          </Label>
          <Input id="schedule-to" name="to" placeholder="0x…" required />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="schedule-amount" className="text-xs">
          Amount (USDC)
        </Label>
        <Input
          id="schedule-amount"
          name="amount"
          inputMode="decimal"
          placeholder="400"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="schedule-cadence" className="text-xs">
          How often
        </Label>
        <select id="schedule-cadence" name="cadence" className={field}>
          <option value="0 9 1 * *">On the 1st at 09:00</option>
          <option value="0 9 * * 1">Every Monday at 09:00</option>
          <option value="@daily">Daily at midnight</option>
          <option value="@hourly">Hourly</option>
        </select>
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="schedule-reason" className="text-xs">
          What it is for
        </Label>
        <Input
          id="schedule-reason"
          name="reason"
          placeholder="Ad agency retainer — Q4 campaign"
          required
        />
        <p className="text-muted-foreground text-xs text-pretty">
          Committed on chain with every run, the same as a payment made by hand.
        </p>
      </div>

      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Scheduling…" : "Schedule it"}
        </Button>
      </div>
    </form>
  );
}
