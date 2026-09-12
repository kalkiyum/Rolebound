"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * The signed-out state. Privy owns the credential flow; all this does is
 * start it and, once the session exists, get the server to look again —
 * `router.refresh()` re-runs the server components that resolve the member,
 * so the app appears without a full reload.
 */
export function SignIn() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.refresh();
  }, [ready, authenticated, router]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Rolebound</h1>
        <p className="text-muted-foreground text-sm">
          Spending authority that follows the role, not the person. Sign in to
          see what you can spend, and what you have to explain.
        </p>
      </div>
      <Button onClick={login} disabled={!ready} size="lg">
        {ready ? "Sign in" : "Loading…"}
      </Button>
    </div>
  );
}
