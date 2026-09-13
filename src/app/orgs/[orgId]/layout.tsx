import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentMember, orgMembers, privyConfigured } from "@/lib/session";
import { pendingApprovals } from "@/lib/approvals";
import { ActorSwitcher } from "@/components/rolebound/actor-switcher";
import { OrgNav } from "@/components/rolebound/org-nav";
import { SignIn } from "@/components/rolebound/sign-in";
import { ClaimSeat } from "@/components/rolebound/claim-seat";
import { SignOut } from "@/components/rolebound/sign-out";
import { unclaimedMembers } from "@/lib/identity";
import { verifiedPrivyUserId } from "@/lib/privy-auth";

export default async function OrgLayout({
  children,
  params,
}: LayoutProps<"/orgs/[orgId]">) {
  const { orgId } = await params;

  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
  });
  if (!org) notFound();

  const [actor, members, waiting] = await Promise.all([
    currentMember(orgId),
    orgMembers(orgId),
    pendingApprovals(orgId),
  ]);

  // Three states, and only the last one is the application: not signed in,
  // signed in but not yet attached to a seat, and someone the org knows.
  // Deciding this in the layout means no page below has to wonder whether
  // it has an actor.
  if (privyConfigured() && !actor) {
    const signedIn = await verifiedPrivyUserId();
    if (!signedIn) return <SignIn />;
    return <ClaimSeat orgId={orgId} members={await unclaimedMembers(orgId)} />;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* The chrome is dark and the work is light. Two reasons: the dark band
          gives the product an identity that a border-bottom does not, and it
          marks the header as furniture — so that on every screen below it the
          brightest thing is the money. */}
      <header className="bg-chrome text-chrome-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 py-1.5 -my-1.5">
            <span
              aria-hidden
              className="grid size-6 place-items-center rounded-[0.3rem] bg-chrome-foreground text-[11px] font-bold text-chrome"
            >
              R
            </span>
            <span className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-chrome-muted">
                Rolebound
              </span>
              <span className="text-sm font-medium">{org.name}</span>
            </span>
          </Link>

          <div className="ml-auto">
            {privyConfigured() ? (
              <SignOut name={actor?.displayName ?? null} />
            ) : (
              <ActorSwitcher orgId={orgId} members={members} actorId={actor?.id ?? null} />
            )}
          </div>
        </div>

        <OrgNav orgId={orgId} waitingCount={waiting.length} />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
