import Image from "next/image";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { privyConfigured } from "@/lib/session";
import { AcceptInvite } from "@/components/rolebound/accept-invite";

/**
 * Where an invitation is accepted.
 *
 * Deliberately outside `/orgs/[orgId]`: that layout answers an unclaimed
 * visitor with the claim screen before any page below it renders, so an
 * invite page nested under it could never be reached. It also cannot read
 * the code — layouts get no search params — which is why the code lives in
 * the path here rather than a query string.
 */
export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  const { code } = await params;

  // The code is looked up across organizations because the link carries no
  // org: the invitation *is* the whole address. A code only ever points at
  // one unclaimed seat, and it is cleared the moment that seat is taken.
  const seat = await db.query.members.findFirst({
    where: eq(schema.members.inviteCode, code),
  });

  const org = seat
    ? await db.query.organizations.findFirst({
        where: eq(schema.organizations.id, seat.orgId),
      })
    : null;

  const valid =
    !!seat && !!org && !seat.privyUserId && seat.kind === "person";

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      {/* The first screen anyone outside the org ever sees, so it says whose
          product this is before it asks them to sign in to it. */}
      <Image
        src="/logo.png"
        alt="Rolebound"
        width={1010}
        height={220}
        priority
        className="h-6 w-auto dark:invert"
      />

      {!valid ? (
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            This invitation has expired
          </h1>
          <p className="text-sm text-muted-foreground text-pretty">
            It may already have been used, or replaced by a newer one. Ask
            whoever invited you to send a fresh link.
          </p>
        </div>
      ) : !privyConfigured() ? (
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            Sign-in is not configured
          </h1>
          <p className="text-sm text-muted-foreground text-pretty">
            This deployment has no identity provider, so a seat cannot be
            claimed here.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {org.name}
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-balance">
              You have been invited as {seat.displayName}
            </h1>
            <p className="text-sm text-muted-foreground text-pretty">
              The seat already exists, with whatever authority comes with it.
              Signing in attaches your account to it — and creates the wallet
              you will sign with.
            </p>
          </div>

          <AcceptInvite
            orgId={org.id}
            inviteCode={code}
            displayName={seat.displayName}
          />
        </>
      )}
    </div>
  );
}
