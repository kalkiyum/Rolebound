"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { claimSeatAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * First login inside an org that already knows who works there.
 *
 * The alternative — creating a fresh member on the spot — produces someone
 * with no grants, no history and nothing to see, in an organization that
 * has been waiting for them by name. Claiming attaches the new account to
 * the seat that already holds their authority.
 */
export function ClaimSeat({
  orgId,
  members,
}: {
  orgId: string;
  members: { id: string; displayName: string }[];
}) {
  const { logout } = usePrivy();
  const router = useRouter();
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    claimSeatAction,
    null,
  );

  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Who are you?</h1>
        <p className="text-muted-foreground text-sm">
          This organization already has your seat, with whatever authority
          comes with it. Pick yourself and it becomes yours.
        </p>
      </div>

      {members.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Every seat here has been claimed. Ask someone in the organization to
          add you.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li key={m.id}>
              <form action={action}>
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="memberId" value={m.id} />
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={pending}
                >
                  {m.displayName}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {result && !result.ok ? (
        <p className="text-destructive text-sm">{result.message}</p>
      ) : null}

      <button
        onClick={() => logout()}
        className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
      >
        Sign out
      </button>
    </div>
  );
}
