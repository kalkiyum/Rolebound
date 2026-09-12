"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";

/** Who you are, and the way out. */
export function SignOut({ name }: { name: string | null }) {
  const { logout } = usePrivy();
  const router = useRouter();

  return (
    <div className="flex items-center gap-3 text-sm">
      {name ? <span className="text-muted-foreground">{name}</span> : null}
      <button
        onClick={async () => {
          await logout();
          router.refresh();
        }}
        className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
      >
        Sign out
      </button>
    </div>
  );
}
