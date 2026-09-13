"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * A failure here is usually the RPC or the database being unreachable, and
 * the honest thing is to say so rather than render an empty screen — a page
 * about money that quietly shows nothing is worse than one that says it
 * could not read.
 */
export default function OrgError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-lg border border-destructive/30 p-6">
      <h2 className="text-sm font-medium">This screen could not be loaded</h2>
      <p className="mt-1.5 max-w-lg text-sm text-muted-foreground text-pretty">
        Nothing was changed. The database or the chain node did not answer, so
        rather than show you a page with numbers missing from it, here is the
        error.
      </p>

      <p className="mt-4 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
        {error.message}
        {error.digest ? (
          <span className="text-muted-foreground"> ({error.digest})</span>
        ) : null}
      </p>

      <Button onClick={retry} variant="outline" size="sm" className="mt-5">
        Try again
      </Button>
    </div>
  );
}
