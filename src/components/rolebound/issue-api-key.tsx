"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { issueApiKeyAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * The credential an agent pays with.
 *
 * Only the hash is stored, so the plaintext exists for exactly one render
 * and then is gone — which makes the copy here load-bearing rather than
 * decorative. Reissuing invalidates the key in flight, so an agent already
 * running will start failing; that is said before the click, not after.
 */
export function IssueApiKey({
  orgId,
  memberId,
  hasKey,
}: {
  orgId: string;
  memberId: string;
  hasKey: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    issueApiKeyAction,
    null,
  );
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!state) return;
    (state.ok ? toast.success : toast.error)(state.message);
  }, [state]);

  const secret = state?.ok ? state.secret : undefined;

  if (secret) {
    return (
      <div className="space-y-3 rounded-lg border border-gated bg-gated-soft p-4">
        <div>
          <p className="text-sm font-medium text-gated-ink">
            Copy this now — it is not shown again
          </p>
          <p className="mt-1 text-xs text-gated-ink/80 text-pretty">
            Only a hash of it is stored, so a lost key is reissued rather than
            recovered.
          </p>
        </div>

        <code className="block overflow-x-auto rounded-md border border-gated/40 bg-background px-3 py-2 font-mono text-xs">
          {secret}
        </code>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(secret);
              setCopied(true);
            } catch {
              toast.error("Could not copy. Select the key and copy it manually.");
            }
          }}
        >
          {copied ? "Copied" : "Copy key"}
        </Button>
      </div>
    );
  }

  if (!asking) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setAsking(true)}
      >
        {hasKey ? "Reissue API key" : "Issue an API key"}
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="memberId" value={memberId} />

      <p className="text-sm text-muted-foreground text-pretty">
        {hasKey
          ? "The key this agent is using now stops working immediately. Anything running with it will start failing until it is given the new one."
          : "The key is shown once. It lets this agent request payments through the API, under the same grants and the same caps."}
      </p>

      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant={hasKey ? "destructive" : "default"}
          disabled={pending}
        >
          {pending ? "Issuing…" : hasKey ? "Reissue anyway" : "Issue key"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setAsking(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
