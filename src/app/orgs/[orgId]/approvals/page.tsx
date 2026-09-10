import Link from "next/link";
import { pendingApprovals } from "@/lib/approvals";
import { capabilitiesFor, currentMember } from "@/lib/session";
import { DecideForm } from "@/components/rolebound/decide-form";
import {
  AddressChip,
  EmptyState,
  KindBadge,
  Money,
  PageHeader,
  TimeAgo,
} from "@/components/rolebound/primitives";

export default async function ApprovalsPage({
  params,
}: PageProps<"/orgs/[orgId]/approvals">) {
  const { orgId } = await params;

  const [waiting, actor] = await Promise.all([
    pendingApprovals(orgId),
    currentMember(orgId),
  ]);
  const capabilities = actor
    ? await capabilitiesFor(orgId, actor.id)
    : new Map<string, Set<"spend" | "approve">>();

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Payments the gate parked because they were over a cap. Nothing here has moved money; nothing here will until someone decides, on the record."
      />

      {waiting.length === 0 ? (
        <EmptyState title="Nothing is waiting on you">
          When a payment goes over its role&rsquo;s per-payment or monthly cap,
          it stops here instead of failing — with the amount, the recipient, and
          the reason already attached.
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {waiting.map((p) => {
            const canApprove = capabilities.get(p.roleId)?.has("approve") ?? false;
            const overCap = BigInt(p.amount) > BigInt(p.capPerTx);

            return (
              <li
                key={p.id}
                className="rounded-lg border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Money base={p.amount} className="text-lg font-medium" />
                    <span className="text-sm text-muted-foreground">to</span>
                    <AddressChip address={p.toAddress} className="text-sm" />
                  </div>
                  <TimeAgo at={p.createdAt} />
                </div>

                <p className="mt-3 text-pretty">{p.reason}</p>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    Asked by {p.requestedBy}
                    <KindBadge kind={p.requesterKind} />
                  </span>
                  <span aria-hidden>·</span>
                  <Link
                    href={`/orgs/${orgId}/roles/${p.roleId}`}
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    {p.roleName}
                  </Link>
                  <span aria-hidden>·</span>
                  <span>
                    {overCap ? (
                      <>
                        over the{" "}
                        <Money base={p.capPerTx} unit={null} /> per-payment cap
                      </>
                    ) : (
                      <>would pass the role&rsquo;s monthly cap</>
                    )}
                  </span>
                </div>

                <div className="mt-5 border-t border-border pt-4">
                  <DecideForm
                    orgId={orgId}
                    paymentId={p.id}
                    canApprove={canApprove}
                    isOwnRequest={p.requestedById === actor?.id}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
