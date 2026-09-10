import Link from "next/link";
import { listRoles } from "@/lib/roles";
import { roleBalances } from "@/lib/balances";
import { Money, AddressChip, EmptyState, PageHeader, KindBadge } from "@/components/rolebound/primitives";

export default async function RolesPage({ params }: PageProps<"/orgs/[orgId]">) {
  const { orgId } = await params;
  const roles = await listRoles(orgId);
  const balances = await roleBalances(roles.map((r) => r.address));

  const active = roles.filter((r) => r.status === "active");
  const dissolved = roles.filter((r) => r.status !== "active");

  return (
    <>
      <PageHeader
        title="Roles"
        description="Each role is a wallet with its own budget and policy. The balance is the budget — read from the chain, never cached."
      />

      {roles.length === 0 ? (
        <EmptyState title="No roles yet">
          A role is a responsibility with money attached — Marketing, Grants,
          Operations. Create one and it gets its own wallet, its own cap, and
          its own list of who may spend from it.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((role) => {
            const balance = balances.get(role.address.toLowerCase()) ?? null;
            const spenders = role.holders.filter((h) => h.capability === "spend");
            const approvers = role.holders.filter((h) => h.capability === "approve");

            return (
              <Link
                key={role.id}
                href={`/orgs/${orgId}/roles/${role.id}`}
                className="group flex flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-medium">{role.name}</h2>
                  <AddressChip address={role.address} />
                </div>

                <Money base={balance} className="mt-4 text-2xl" muted />

                <dl className="mt-5 space-y-1.5 border-t border-border pt-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Cap per payment</dt>
                    <dd>
                      <Money base={role.capPerTx} unit={null} />
                    </dd>
                  </div>
                  {role.capMonthly ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Monthly cap</dt>
                      <dd>
                        <Money base={role.capMonthly} unit={null} />
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {spenders.length === 0 && approvers.length === 0 ? (
                  <p className="mt-4 text-sm text-amber-700 dark:text-amber-400">
                    Nobody can spend from this role.
                  </p>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {spenders.map((h) => (
                      <span
                        key={`${h.memberId}-spend`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {h.displayName}
                        <KindBadge kind={h.kind} />
                      </span>
                    ))}
                    {approvers.length > 0 ? (
                      <span className="inline-flex items-center rounded-full px-1 py-0.5 text-xs text-muted-foreground">
                        + {approvers.length} approving
                      </span>
                    ) : null}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {dissolved.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-medium text-muted-foreground">Dissolved</h2>
          <ul className="mt-3 space-y-2">
            {dissolved.map((role) => (
              <li
                key={role.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground"
              >
                <Link href={`/orgs/${orgId}/roles/${role.id}`} className="hover:text-foreground">
                  {role.name}
                </Link>
                <AddressChip address={role.address} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
