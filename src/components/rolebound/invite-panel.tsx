"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { reissueInviteAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * The link that lets one named person take one named seat.
 *
 * The code is rendered as a full URL rather than a token to paste, because
 * the thing being handed over is "click this", not "enter this somewhere".
 * Reissuing kills the previous link — said before the click, since the usual
 * reason to reissue is that the first one went to the wrong inbox.
 */
export function InvitePanel({
  orgId,
  memberId,
  displayName,
  code,
}: {
  orgId: string;
  memberId: string;
  displayName: string;
  code: string | null;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    reissueInviteAction,
    null,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!state) return;
    (state.ok ? toast.success : toast.error)(state.message);
  }, [state]);

  // A freshly issued code arrives on the action result; otherwise use the one
  // the server rendered with.
  const live = (state?.ok ? state.secret : undefined) ?? code ?? null;

  // Built in the browser so the link carries whatever origin this is actually
  // being used from — a preview deployment's invitation should point at the
  // preview, not at production.
  const url =
    live && typeof window !== "undefined"
      ? `${window.location.origin}/join/${live}`
      : null;

  return (
    <div className="space-y-4">
      {live ? (
        <div className="space-y-2">
          <code className="block overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
            {url ?? `/join/${live}`}
          </code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              if (!url) return;
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                toast.error("Could not copy. Select the link and copy it manually.");
              }
            }}
          >
            {copied ? "Copied" : "Copy invitation link"}
          </Button>
          <p className="text-xs text-muted-foreground text-pretty">
            Opening it signs {displayName} in and attaches their account to
            this seat. It stops working once used.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-pretty">
          This seat has no live invitation, so nobody can claim it. Issue one
          to let {displayName} in.
        </p>
      )}

      <form action={action}>
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="memberId" value={memberId} />
        <Button
          type="submit"
          size="sm"
          variant={live ? "ghost" : "default"}
          disabled={pending}
        >
          {pending
            ? "Issuing…"
            : live
              ? "Replace this link"
              : "Issue an invitation"}
        </Button>
      </form>
    </div>
  );
}
