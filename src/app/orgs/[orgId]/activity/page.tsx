import { orgFeed, type FeedEntry } from "@/lib/feed";
import {
  AddressChip,
  EmptyState,
  KindBadge,
  Money,
  PageHeader,
  StatusPill,
  TimeAgo,
  VerifiedBadge,
} from "@/components/rolebound/primitives";

/**
 * Each activity type gets a sentence, not a label. "grant.revoked" is a
 * database value; "Maya can no longer spend from Marketing" is what somebody
 * reading an audit trail six months from now actually needs.
 */
function headline(entry: FeedEntry) {
  const who = entry.actorName ?? "Someone";
  const role = entry.roleName ?? "a role";
  const cap = String(entry.payload?.capability ?? "act");

  switch (entry.type) {
    case "org.created":
      return `${who} created this organization`;
    case "role.created":
      return `${who} created ${role}`;
    case "role.dissolved":
      return `${who} dissolved ${role}`;
    case "member.added":
      return `${who} added ${String(entry.payload?.displayName ?? "someone")}`;
    case "grant.created":
      return `${who} gave ${String(entry.payload?.displayName ?? "someone")} ${cap} rights on ${role}`;
    case "grant.revoked":
      return `${who} removed ${String(entry.payload?.displayName ?? "someone")} from ${role}`;
    case "payment.requested":
      return `${who} requested a payment from ${role}`;
    case "payment.executed":
      return `${who} paid from ${role}`;
    case "payment.blocked":
      return `${who} was refused by ${role}`;
    case "payment.approved":
      return `${who} approved a payment from ${role}`;
    case "payment.rejected":
      return `${who} turned down a payment from ${role}`;
    default:
      return `${who} — ${entry.type}`;
  }
}

export default async function ActivityPage({
  params,
}: PageProps<"/orgs/[orgId]/activity">) {
  const { orgId } = await params;
  const entries = await orgFeed(orgId);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Who did what, under which role, and why. Payments carry a verdict: whether the reason shown still hashes to what was committed onchain."
      />

      {entries.length === 0 ? (
        <EmptyState title="Nothing has happened yet">
          Roles, grants, payments and approvals all land here as they happen.
          Nothing is written after the fact.
        </EmptyState>
      ) : (
        <ol className="relative space-y-0 border-l border-border pl-6">
          {entries.map((entry) => (
            <li key={entry.id} className="relative pb-7 last:pb-0">
              <span
                aria-hidden
                className="absolute -left-[1.6875rem] top-1.5 size-2 rounded-full border border-border bg-background"
              />

              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-medium text-pretty">
                  <span className="inline-flex items-center gap-1.5">
                    {headline(entry)}
                    {entry.actorKind ? <KindBadge kind={entry.actorKind} /> : null}
                  </span>
                </p>
                <TimeAgo at={entry.at} />
              </div>

              {entry.payment ? (
                <div className="mt-2.5 rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-2.5">
                      <Money base={entry.payment.amount} />
                      <span className="text-sm text-muted-foreground">to</span>
                      <AddressChip address={entry.payment.to} />
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={entry.payment.status} />
                      <VerifiedBadge state={entry.payment.verification.state} />
                    </div>
                  </div>

                  <p className="mt-2.5 text-sm text-pretty">
                    {entry.payment.reason}
                  </p>

                  {entry.payment.approvalReason ? (
                    <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
                      Approver: {entry.payment.approvalReason}
                    </p>
                  ) : null}

                  <p
                    title="keccak256 of the reason, committed in the same transaction that moved the money."
                    className="mt-3 truncate border-t border-border pt-3 font-mono text-[11px] text-muted-foreground"
                  >
                    {entry.payment.reasonHash}
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
