import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { listRoles } from "@/lib/roles";
import { roleBalances } from "@/lib/balances";
import { monthSpend, type MonthSpend } from "@/lib/spend";
import { recentPayments } from "@/lib/feed";
import { NewRoleForm } from "@/components/rolebound/new-role-form";
import {
  Money,
  SpendMeter,
  AddressChip,
  EmptyState,
  PageHeader,
  KindBadge,
  StatusPill,
  VerifiedBadge,
  TimeAgo,
} from "@/components/rolebound/primitives";

export default async function RolesPage({ params }: PageProps<"/orgs/[orgId]">) {
  const { orgId } = await params;

  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
  });
  if (!org) notFound();

  // An org provisioned before the treasury existed has none, and the page
  // still has to render — the roles are the product, the treasury is context.
  const treasuryAddress = org.treasuryAddress;

  const roles = await listRoles(orgId);
  const [balances, spending, latest] = await Promise.all([
    roleBalances([
      ...roles.map((r) => r.address),
      ...(treasuryAddress ? [treasuryAddress] : []),
    ]),
    monthSpend(roles),
    recentPayments(orgId, 6),
  ]);

  // Alphabetical rather than newest-first. These are standing responsibilities
  // that someone will come back to repeatedly, and a list that reorders itself
  // as roles are created is a list you have to re-read every visit.
  const active = roles
    .filter((r) => r.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name));
  const dissolved = roles.filter((r) => r.status !== "active");

  const treasury = treasuryAddress
    ? balances.get(treasuryAddress.toLowerCase()) ?? null
    : null;

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
        description="Money sits in the role, not with a person. Each one is its own wallet, under its own policy, with its own budget — and everything below is read from the chain, never cached."
      >
        <NewRoleForm orgId={orgId} />
      </PageHeader>

      {active.length > 0 ? (
        <>
          {/* The source, stated before the things it funds. Someone meeting
              this product for the first time needs the shape of it — money
              starts here and flows outward into bounded compartments — before
              any individual number means anything. */}
          <section className="rounded-xl border border-border bg-chrome p-5 text-chrome-foreground sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-chrome-muted">
                  Treasury
                </p>
                <Money
                  base={treasury}
                  className="mt-1.5 block text-3xl font-medium"
                  unit={null}
                />
                <div className="mt-1.5 flex items-center gap-2 text-xs text-chrome-muted">
                  <span>USDC</span>
                  <span aria-hidden>·</span>
                  {treasuryAddress ? (
                    <AddressChip
                      address={treasuryAddress}
                      className="text-chrome-muted"
                    />
                  ) : null}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
                <Figure label="Held across roles" value={totals.held} />
                <Figure label="Committed this month" value={totals.paid + totals.pending} />
                <Figure label="Awaiting approval" value={totals.pending} gated />
              </dl>
            </div>
          </section>

          <div aria-hidden className="flex flex-col items-center py-1">
            <span className="h-5 w-px bg-border" />
            <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              funds {active.length} {active.length === 1 ? "role" : "roles"}
            </span>
            <span className="h-5 w-px bg-border" />
          </div>
        </>
      ) : null}

      {roles.length === 0 ? (
        <EmptyState title="No roles yet">
          A role is a responsibility with money attached — Marketing, Grants,
          Operations. Create one and it gets its own wallet, its own cap, and
          its own list of who may spend from it.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((role) => (
            <RoleCard
              key={role.id}
              orgId={orgId}
              role={role}
              spend={spending.get(role.id)!}
              balance={balances.get(role.address.toLowerCase()) ?? null}
            />
          ))}
        </div>
      )}

      {latest.length > 0 ? (
        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-medium">Latest payments</h2>
            <Link
              href={`/orgs/${orgId}/activity`}
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Full record
            </Link>
          </div>

          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {latest.map((p) => (
              <li key={p.id} className="px-4 py-3">
                {/* Two rows on a phone, one on a desktop. The amount and the
                    reason are what someone is scanning for; everything else
                    is corroboration and drops to a second line rather than
                    squeezing the reason down to an ellipsis. */}
                <div className="flex items-baseline gap-3 sm:gap-4">
                  <Money
                    base={p.amount}
                    unit={null}
                    className="w-20 shrink-0 text-right sm:w-24"
                  />
                  <Link
                    href={`/orgs/${orgId}/roles/${p.roleId}`}
                    className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {p.roleName}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {p.reason}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">
                    <TimeAgo at={p.createdAt} />
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-[5.75rem] text-xs text-muted-foreground sm:pl-28">
                  <span className="inline-flex items-center gap-1.5">
                    {p.actorName}
                    <KindBadge kind={p.actorKind} />
                  </span>
                  <StatusPill status={p.status} />
                  <VerifiedBadge state={p.verification.state} />
                  <span className="lg:hidden">
                    <TimeAgo at={p.createdAt} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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

function Figure({
  label,
  value,
  gated,
}: {
  label: string;
  value: bigint;
  gated?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-chrome-muted">
        {label}
      </dt>
      <dd
        className={
          gated && value > 0n ? "mt-0.5 text-gated" : "mt-0.5"
        }
      >
        <Money base={value} unit={null} className="text-base" />
      </dd>
    </div>
  );
}

type Role = Awaited<ReturnType<typeof listRoles>>[number];

function RoleCard({
  orgId,
  role,
  spend,
  balance,
}: {
  orgId: string;
  role: Role;
  spend: MonthSpend;
  balance: bigint | null;
}) {
  const spenders = role.holders.filter((h) => h.capability === "spend");
  const approvers = role.holders.filter((h) => h.capability === "approve");

  return (
    <Link
      href={`/orgs/${orgId}/roles/${role.id}`}
      className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-all hover:border-foreground/25 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-medium">{role.name}</h2>
        <AddressChip address={role.address} />
      </div>

      <p className="mt-5 text-[10px] uppercase tracking-wider text-muted-foreground">
        Spent this month
      </p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <Money base={spend.consumed} className="text-2xl" unit={null} />
        {spend.capMonthly !== null ? (
          <span className="text-sm text-muted-foreground">
            of <Money base={spend.capMonthly} unit={null} className="text-sm" />
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">USDC</span>
        )}
      </div>

      {spend.capMonthly !== null ? (
        <>
          <SpendMeter
            paid={spend.paid}
            pending={spend.pending}
            cap={spend.capMonthly}
            className="mt-3 h-2"
          />
          {/* Each phrase is its own nowrap span: broken across a line,
              "900.00 awaiting / approval" reads as two facts, not one. */}
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">
              <Money base={spend.remaining} unit={null} /> left
            </span>
            {spend.pending > 0n ? (
              <span className="whitespace-nowrap text-gated-ink">
                <Money base={spend.pending} unit={null} /> awaiting approval
              </span>
            ) : null}
          </p>
        </>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No monthly cap on this role.
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

      {/* Pushed to the bottom so the cards line up whatever the length of
          the holder list. */}
      <div className="mt-4 flex grow items-end">
        {spenders.length === 0 && approvers.length === 0 ? (
          <p className="text-sm text-gated-ink">
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
}
