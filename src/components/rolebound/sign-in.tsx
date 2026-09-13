"use client";

import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
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
        {/* The heading stays an h1 — the wordmark is the page's title, so the
            image carries it and the alt text is what a screen reader hears.
            Unlike the header, this sits on the themed page ground, so the
            black artwork only inverts in dark mode. */}
        <h1>
          <Image
            src="/logo.png"
            alt="Rolebound"
            width={1010}
            height={220}
            priority
            className="h-7 w-auto dark:invert"
          />
        </h1>
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
