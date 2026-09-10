import { notFound } from "next/navigation";
import { roleDetail } from "@/lib/role-detail";
import { roleBalances } from "@/lib/balances";
import { currentMember } from "@/lib/session";
import { PayForm } from "@/components/rolebound/pay-form";
import {
  Money,
  AddressChip,
  EmptyState,
  PageHeader,
  StatusPill,
  VerifiedBadge,
  KindBadge,
  TimeAgo,
} from "@/components/rolebound/primitives";

export default async function RoleDetailPage({
  params,
}: PageProps<"/orgs/[orgId]/roles/[roleId]">) {
  const { orgId, roleId } = await params;

  const [detail, actor] = await Promise.all([
    roleDetail(orgId, roleId),
    currentMember(orgId),
  ]);
  if (!detail) notFound();

  const { role, holders, payments, spentThisMonth } = detail;
  const balances = await roleBalances([role.address]);
  const balance = balances.get(role.address.toLowerCase()) ?? null;

  const remainingMonthly =
    role.capMonthly !== null && spentThisMonth !== null
      ? (BigInt(role.capMonthly) - spentThisMonth).toString()
      : null;

  const canSpend = holders.some(
    (h) => h.memberId === actor?.id && h.capability === "spend",
  );

  const spenders = holders.filter((h) => h.capability === "spend");
  const approvers = holders.filter((h) => h.capability === "approve");

  return (
    <>
      <PageHeader
        title={role.name}
        description={
          role.status === "active" ? (
            <>
              This role holds its own wallet. Its balance is its budget.
            </>
          ) : (
            <>This role has been dissolved. Its history stays readable.</>
          )
        }
      >
        <AddressChip address={role.address} className="pt-2 text-sm" />
      </PageHeader>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          {role.status === "active" ? (
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-medium">Make a payment</h2>
              <div className="mt-4">
                <PayForm
                  orgId={orgId}
                  roleId={roleId}
                  roleName={role.name}
                  capPerTx={role.capPerTx}
                  remainingMonthly={remainingMonthly}
                  canSpend={canSpend}
                />
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="text-sm font-medium">Payments</h2>

            {payments.length === 0 ? (
              <div className="mt-3">
                <EmptyState title="Nothing paid from this role yet">
                  Every payment made here will show what it was for, who
                  authorized it, and whether the reason still matches what was
                  committed onchain.
                </EmptyState>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                {payments.map((p) => (
                  <li key={p.id} className="p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <Money base={p.amount} className="text-base font-medium" />
                      <div className="flex items-center gap-2">
                        <StatusPill status={p.status} />
                        <TimeAgo at={p.createdAt} />
                      </div>
                    </div>

                    <p className="mt-2 text-sm text-pretty">{p.reason}</p>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {p.actorName}
                        <KindBadge kind={p.actorKind} />
                      </span>
                      <span aria-hidden>→</span>
                      <AddressChip address={p.toAddress} />
                      <VerifiedBadge state={p.verification.state} />
                    </div>

                    {p.blockedReason ? (
                      <p className="mt-2 text-xs text-destructive text-pretty">
                        {p.blockedReason}
                      </p>
                    ) : null}
                    {p.approvalReason ? (
                      <p className="mt-2 text-xs text-muted-foreground text-pretty">
                        Approver: {p.approvalReason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-medium text-muted-foreground">Budget</h2>
            <Money base={balance} className="mt-2 block text-2xl" muted />

            <dl className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Per payment</dt>
                <dd>
                  <Money base={role.capPerTx} unit={null} />
                </dd>
              </div>
              {role.capMonthly ? (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Monthly cap</dt>
                    <dd>
                      <Money base={role.capMonthly} unit={null} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Left this month</dt>
                    <dd>
                      <Money base={remainingMonthly} unit={null} />
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>

            <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground text-pretty">
              The per-payment cap is enforced in the wallet&rsquo;s policy, not
              only here. The monthly cap is enforced by this app.
            </p>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-medium text-muted-foreground">
              Who can act
            </h2>

            {holders.length === 0 ? (
              <p className="mt-3 text-sm text-amber-700 dark:text-amber-400 text-pretty">
                Nobody holds this role. It cannot spend until someone is added.
              </p>
            ) : (
              <div className="mt-4 space-y-4 text-sm">
                <Holders label="Can spend" people={spenders} />
                <Holders label="Can approve" people={approvers} />
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function Holders({
  label,
  people,
}: {
  label: string;
  people: Array<{ memberId: string; displayName: string; kind: "person" | "agent" }>;
}) {
  if (people.length === 0) {
    return (
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">Nobody</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {people.map((p) => (
          <li key={p.memberId} className="flex items-center gap-2">
            {p.displayName}
            <KindBadge kind={p.kind} />
          </li>
        ))}
      </ul>
    </div>
  );
}
