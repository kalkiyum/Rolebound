import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentMember, orgMembers, privyConfigured } from "@/lib/session";
import { pendingApprovals } from "@/lib/approvals";
import { ActorSwitcher } from "@/components/rolebound/actor-switcher";
import { OrgNav } from "@/components/rolebound/org-nav";

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

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Rolebound
            </span>
            <span className="text-sm font-medium">{org.name}</span>
          </Link>

          <div className="ml-auto">
            {privyConfigured() ? null : (
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
