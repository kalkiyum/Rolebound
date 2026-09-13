import Link from "next/link";
import { listRoles } from "@/lib/roles";
import { orgMembers } from "@/lib/session";
import { memberSpend } from "@/lib/spend";
import {
  EmptyState,
  KindBadge,
  Money,
  PageHeader,
} from "@/components/rolebound/primitives";

export default async function MembersPage({
  params,
}: PageProps<"/orgs/[orgId]/members">) {
  const { orgId } = await params;

  const [members, roles] = await Promise.all([
    orgMembers(orgId),
    listRoles(orgId),
  ]);
  const spending = await memberSpend(members.map((m) => m.id));

  return (
    <>
      <PageHeader
        title="People & agents"
        description="Agents sit in the same table as people, hold the same grants, and answer to the same caps. There is no separate, quieter path for software."
      />

      {members.length === 0 ? (
        <EmptyState title="Nobody here yet">
          People and agents are added to the organization first, then given
          rights on individual roles.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {members.map((member) => {
            const spend = spending.get(member.id)!;
            const held = roles
              .filter((role) => role.holders.some((h) => h.memberId === member.id))
              .map((role) => ({
                id: role.id,
                name: role.name,
                status: role.status,
                capabilities: role.holders
                  .filter((h) => h.memberId === member.id)
                  .map((h) => h.capability),
              }));

            return (
              <li
                key={member.id}
                className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 p-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/orgs/${orgId}/members/${member.id}`}
                    className="inline-flex items-center gap-2 py-1.5 -my-1.5 font-medium hover:underline underline-offset-4"
                  >
                    {member.displayName}
                    <KindBadge kind={member.kind} />
                  </Link>

                  <p className="mt-1 text-sm text-muted-foreground">
                    {held.length === 0
                      ? "Holds nothing. Cannot spend anywhere."
                      : held
                          .map(
                            (r) =>
                              `${r.name} (${[...new Set(r.capabilities)].join(" + ")})`,
                          )
                          .join(" · ")}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-6">
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      This month
                    </p>
                    <p className="mt-0.5 text-sm">
                      <Money base={spend.paid} unit={null} />
                    </p>
                    {spend.pending > 0n ? (
                      <p className="text-xs text-gated-ink">
                        <Money base={spend.pending} unit={null} /> pending
                      </p>
                    ) : null}
                  </div>

                  <Link
                    href={`/orgs/${orgId}/members/${member.id}`}
                    className="py-1.5 -my-1.5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Manage
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
