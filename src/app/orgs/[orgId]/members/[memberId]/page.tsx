import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { offboardingImpact } from "@/lib/offboarding";
import { listRoles } from "@/lib/roles";
import { OffboardForm } from "@/components/rolebound/offboard-form";
import { GrantForm } from "@/components/rolebound/grant-form";
import { RevokeButton } from "@/components/rolebound/revoke-button";
import { IssueApiKey } from "@/components/rolebound/issue-api-key";
import {
  AddressChip,
  KindBadge,
  Money,
  PageHeader,
  TimeAgo,
} from "@/components/rolebound/primitives";

export default async function MemberPage({
  params,
}: PageProps<"/orgs/[orgId]/members/[memberId]">) {
  const { orgId, memberId } = await params;

  const member = await db.query.members.findFirst({
    where: and(eq(schema.members.id, memberId), eq(schema.members.orgId, orgId)),
  });
  if (!member) notFound();

  const [impact, roles] = await Promise.all([
    offboardingImpact({ orgId, memberId }),
    listRoles(orgId),
  ]);

  const heldRoleIds = new Set(impact.roles.map((r) => r.roleId));
  const available = roles.filter(
    (role) => role.status === "active" && !heldRoleIds.has(role.id),
  );

  const pendingCount = impact.roles.reduce(
    (n, role) => n + role.pendingPayments.length,
    0,
  );

  return (
    <>
      <PageHeader
        title={member.displayName}
        description={
          member.kind === "agent" ? (
            <>
              An agent. It holds grants and answers to caps exactly as a person
              does — the only difference is how it authenticates.
            </>
          ) : (
            <>
              What they can reach today, and what changes the moment they are
              removed.
            </>
          )
        }
      >
        <div className="pt-1">
          <KindBadge kind={member.kind} />
        </div>
      </PageHeader>

      {member.address ? (
        <AddressChip address={member.address} className="mb-6 block text-sm" />
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="text-sm font-medium">Roles held</h2>

            {impact.roles.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground text-pretty">
                {member.displayName} holds nothing and cannot move money
                anywhere.
              </p>
            ) : (
              <ul className="mt-3 space-y-4">
                {impact.roles.map((role) => (
                  <li
                    key={role.roleId}
                    className="rounded-lg border border-border bg-card p-5"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                      <Link
                        href={`/orgs/${orgId}/roles/${role.roleId}`}
                        className="font-medium hover:underline underline-offset-4"
                      >
                        {role.roleName}
                      </Link>
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-muted-foreground">
                          can {role.capabilities.join(" and ")}
                        </span>
                        <RevokeButton
                          orgId={orgId}
                          roleId={role.roleId}
                          memberId={memberId}
                        />
                      </div>
                    </div>

                    {!role.otherSpendersRemain ? (
                      <p className="mt-3 rounded-md border border-gated/30 bg-gated-soft p-3 text-sm text-gated-ink text-pretty">
                        Nobody else can spend from {role.roleName}. Remove them
                        and this role goes quiet until someone is added.
                      </p>
                    ) : null}

                    {role.pendingPayments.length > 0 ? (
                      <div className="mt-4 border-t border-border pt-4">
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">
                          Waiting on an approver
                        </p>
                        <ul className="mt-2 space-y-2">
                          {role.pendingPayments.map((p) => (
                            <li
                              key={p.id}
                              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
                            >
                              <Money base={p.amount} unit={null} />
                              <AddressChip address={p.toAddress} />
                              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                {p.reason}
                              </span>
                              <TimeAgo at={p.createdAt} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {role.standingPayments.length > 0 ? (
                      <div className="mt-4 border-t border-border pt-4">
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">
                          Recurring payments they set up
                        </p>
                        <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
                          These belong to the role, not to{" "}
                          {member.displayName}. They keep running after removal
                          — which is correct, and worth knowing now rather than
                          next month.
                        </p>
                        <ul className="mt-2 space-y-2">
                          {role.standingPayments.map((s) => (
                            <li
                              key={s.id}
                              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
                            >
                              <Money base={s.amount} unit={null} />
                              <span className="text-muted-foreground">
                                {s.cadence}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                {s.reason}
                              </span>
                              <span className="text-muted-foreground">
                                next <TimeAgo at={s.nextRunAt} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-medium">Add to a role</h2>
            <div className="mt-4">
              <GrantForm orgId={orgId} memberId={memberId} roles={available} />
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          {member.kind === "agent" ? (
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-medium">API key</h2>
              <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
                {member.apiKeyHash
                  ? "This agent has a key. Only its hash is stored, so the key itself cannot be shown again — it can only be replaced."
                  : "This agent cannot authenticate yet. A key lets it request payments through the API, bounded by the same grants and caps."}
              </p>
              <div className="mt-5">
                <IssueApiKey
                  orgId={orgId}
                  memberId={memberId}
                  hasKey={member.apiKeyHash !== null}
                />
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-destructive/30 p-5">
            <h2 className="text-sm font-medium">Offboard</h2>
            <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
              Revokes every grant at once. Authority ends the moment this is
              done, including for payments already in flight.
            </p>
            <div className="mt-5">
              <OffboardForm
                orgId={orgId}
                memberId={memberId}
                memberName={member.displayName}
                roleCount={impact.roles.length}
                pendingCount={pendingCount}
              />
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
