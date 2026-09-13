import Link from "next/link";
import { listRoles } from "@/lib/roles";
import { roleBalances } from "@/lib/balances";
import { monthSpend } from "@/lib/spend";
import {
  Money,
  SpendMeter,
  AddressChip,
  EmptyState,
  PageHeader,
  KindBadge,
} from "@/components/rolebound/primitives";

/** One cell of the org-level strip. */
function Total({
  label,
  value,
  tone,
}: {
  label: string;
  value: bigint;
  tone?: "amber";
}) {
  return (
    <div className="bg-background px-4 py-3">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          tone === "amber" && value > 0n
            ? "mt-1 text-amber-700 dark:text-amber-400"
            : "mt-1"
        }
      >
        <Money base={value} className="text-lg" muted />
      </dd>
    </div>
  );
}

export default async function RolesPage({ params }: PageProps<"/orgs/[orgId]">) {
  const { orgId } = await params;
  const roles = await listRoles(orgId);
  const [balances, spending] = await Promise.all([
    roleBalances(roles.map((r) => r.address)),
    monthSpend(roles),
  ]);

  // Alphabetical rather than newest-first. These are standing responsibilities
  // that someone will come back to repeatedly, and a list that reorders itself
  // as roles are created is a list you have to re-read every visit.
  const active = roles
    .filter((r) => r.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name));
  const dissolved = roles.filter((r) => r.status !== "active");

  // Summed over active roles only. A dissolved role's history stays readable
  // on its own page, but rolling it into "this month" would imply the org
  // still has that authority outstanding, and it does not.
  const totals = active.reduce(
    (sum, role) => {
      const spend = spending.get(role.id)!;
      const balance = balances.get(role.address.toLowerCase());
      return {
        paid: sum.paid + spend.paid,
        pending: sum.pending + spend.pending,
        consumed: sum.consumed + spend.consumed,
        // `null` from an unreachable RPC is skipped rather than counted as
        // zero: a total that quietly shrinks is worse than one that is late.
        held: balance === null || balance === undefined ? sum.held : sum.held + balance,
      };
    },
    { paid: 0n, pending: 0n, consumed: 0n, held: 0n },
  );

  return (
    <>
      <PageHeader
        title="Roles"
        description="Each role is a wallet with its own budget and its own policy. Balances are read from the chain on every request, never cached."
      />

      {active.length > 0 ? (
        <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
          <Total label="Committed this month" value={totals.consumed} />
          <Total label="Paid out" value={totals.paid} />
          <Total label="Awaiting approval" value={totals.pending} tone="amber" />
          <Total label="Held across roles" value={totals.held} />
        </dl>
      ) : null}

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
            const spend = spending.get(role.id)!;
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

                <p className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">
                  Spent this month
                </p>
                <Money base={spend.consumed} className="mt-0.5 text-2xl" muted />

                {spend.capMonthly !== null ? (
                  <>
                    <SpendMeter
                      paid={spend.paid}
                      pending={spend.pending}
                      cap={spend.capMonthly}
                      className="mt-3"
                    />
                    {/* Each phrase is its own nowrap span: broken across a
                        line, "900.00 awaiting / approval" reads as two facts
                        rather than one. */}
                    <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span className="whitespace-nowrap">
                        <Money base={spend.remaining} unit={null} /> left of{" "}
                        <Money base={spend.capMonthly} unit={null} />
                      </span>
                      {spend.pending > 0n ? (
                        <span className="whitespace-nowrap text-amber-700 dark:text-amber-400">
                          <Money base={spend.pending} unit={null} /> awaiting
                          approval
                        </span>
                      ) : null}
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No monthly cap &mdash; every payment is capped at{" "}
                    <Money base={role.capPerTx} unit={null} />
                  </p>
                )}

                <dl className="mt-5 space-y-1.5 border-t border-border pt-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">In the wallet</dt>
                    <dd>
                      <Money base={balance} unit={null} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Cap per payment</dt>
                    <dd>
                      <Money base={role.capPerTx} unit={null} />
                    </dd>
                  </div>
                </dl>

                {/* Pushed to the bottom so the cards line up whatever the
                    length of the holder list. */}
                <div className="mt-4 flex grow items-end">
                  {spenders.length === 0 && approvers.length === 0 ? (
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Nobody can spend from this role.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
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
                        <span className="text-xs text-muted-foreground">
                          + {approvers.length} approving
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
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
                <Link
                  href={`/orgs/${orgId}/roles/${role.id}`}
                  className="py-1.5 -my-1.5 hover:text-foreground"
                >
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
