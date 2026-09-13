"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { claimSeatAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * Two steps that look like one: authenticate, then take the seat.
 *
 * They stay separate because only the first can fail in a way the person can
 * fix by trying again. Once Privy has them, the claim is the server checking
 * that this invitation still names this seat — and the code travels in a
 * hidden field rather than being chosen from a list, which is the whole
 * point of having invitations.
 */
export function AcceptInvite({
  orgId,
  inviteCode,
  displayName,
}: {
  orgId: string;
  inviteCode: string;
  displayName: string;
}) {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    claimSeatAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message);
      router.replace(`/orgs/${orgId}`);
    } else {
      toast.error(state.message);
    }
  }, [state, router, orgId]);

  if (!authenticated) {
    return (
      <div className="space-y-3">
        <Button onClick={login} disabled={!ready} size="lg" className="w-full">
          {ready ? "Sign in to continue" : "Loading…"}
        </Button>
        <p className="text-xs text-muted-foreground text-pretty">
          An email address is all it takes. A wallet is created for you at
          sign-in — it holds no money, it signs for what you approve.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="inviteCode" value={inviteCode} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Taking your seat…" : `Continue as ${displayName}`}
      </Button>
      {state && !state.ok ? (
        <p className="text-sm text-refused text-pretty">{state.message}</p>
      ) : null}
    </form>
  );
}
