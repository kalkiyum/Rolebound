"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";

/**
 * Who you are, and the way out.
 *
 * The name is a link to your own page rather than a label, because that is
 * where your wallet address and the export live — and someone who has just
 * signed in for the first time has no other way to find them.
 *
 * Styled against the chrome tokens, not the page ones: this sits on the dark
 * band, where `text-foreground` is near-black and effectively invisible.
 */
export function SignOut({
  name,
  href,
}: {
  name: string | null;
  href: string | null;
}) {
  const { logout } = usePrivy();
  const router = useRouter();

  return (
    <div className="flex items-center gap-3 text-sm">
      {name ? (
        href ? (
          <Link
            href={href}
            className="text-chrome-foreground underline-offset-4 hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className="text-chrome-muted">{name}</span>
        )
      ) : null}
      <button
        onClick={async () => {
          await logout();
          router.refresh();
        }}
        className="text-xs text-chrome-muted underline underline-offset-4 hover:text-chrome-foreground"
      >
        Sign out
      </button>
    </div>
  );
}
