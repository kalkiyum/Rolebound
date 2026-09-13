"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";

/**
 * Signed in, but not anybody here.
 *
 * This screen used to list every unclaimed seat and let the visitor pick
 * one, which meant whoever reached the URL first could take the seat holding
 * approve rights. Seats are now claimed through an invitation link that
 * names exactly one of them, so there is nothing to offer here — only a way
 * back out.
 */
export function ClaimSeat({ orgName }: { orgName: string }) {
  const { logout } = usePrivy();

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight text-balance">
          You are signed in, but not a member of {orgName}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Seats are taken by invitation, and each link names one person. Ask
          someone in the organization to send you yours — anyone there can
          issue it from your page.
        </p>
      </div>

      <Button variant="outline" onClick={() => logout()}>
        Sign out
      </Button>
    </div>
  );
}
