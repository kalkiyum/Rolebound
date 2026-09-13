import { upcomingSchedules } from "@/lib/schedules";
import { listRoles } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { liveGrant } from "@/lib/gate";
import { ScheduleForm } from "@/components/rolebound/schedule-form";
import { CancelSchedule } from "@/components/rolebound/cancel-schedule";
import { RunSweep } from "@/components/rolebound/run-sweep";
import {
  AddressChip,
  EmptyState,
  Money,
  PageHeader,
} from "@/components/rolebound/primitives";
import { TimeAgo } from "@/components/rolebound/time-ago";

/**
 * "the 1st" reads better than a cron string in a warning, and the date is
 * the thing someone has to act before. UTC, like every other run time here.
 */
const dayLabel = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);

export default async function RecurringPage({
  params,
}: PageProps<"/orgs/[orgId]">) {
  const { orgId } = await params;

  const [schedules, roles, actor] = await Promise.all([
    upcomingSchedules(orgId),
    listRoles(orgId),
    currentMember(orgId),
  ]);

  const active = roles.filter((r) => r.status === "active");

  // Only roles this person can already spend from, because a schedule is a
  // standing instruction to spend and `createSchedule` refuses anything else.
  const spendable = actor
    ? (
        await Promise.all(
          active.map(async (role) =>
            (await liveGrant(actor.id, role.id, "spend")) ? role : null,
          ),
        )
      ).filter((r) => r !== null)
    : [];

  return (
    <>
      <PageHeader
        title="Recurring"
        description="Standing payments belong to the role, not to whoever set them up. They keep running when people move on — and stop when nobody holds the role."
      >
        <RunSweep orgId={orgId} />
      </PageHeader>

      {schedules.length === 0 ? (
        <EmptyState title="Nothing recurring yet">
          Retainers, subscriptions and monthly top-ups live here. Set one up
          and it runs on its own schedule, through the same cap and the same
          reason as a payment made by hand.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {schedules.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-lg border border-border bg-card p-4"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.roleName}</span>
                  <span className="text-muted-foreground text-sm">
                    {s.direction === "treasury_to_role"
                      ? "top-up from the treasury"
                      : "pays"}
                  </span>
                  {s.to ? <AddressChip address={s.to} /> : null}
                </div>
                <p className="text-muted-foreground text-sm text-pretty">
                  {s.reason}
                </p>
                <p className="text-muted-foreground text-xs">
                  {s.when} · next <TimeAgo at={s.nextRunAt} />
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <Money base={s.amount} className="text-lg" muted />
                  {s.shortfall > 0n ? (
                    <p className="mt-1 text-sm text-gated-ink">
                      {s.roleName} is <Money base={s.shortfall} unit={null} />{" "}
                      short for {dayLabel(s.nextRunAt)}
                    </p>
                  ) : null}
                </div>
                <CancelSchedule orgId={orgId} scheduleId={s.id} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-10 rounded-lg border border-border p-5">
        <h2 className="text-sm font-medium">Set up a recurring payment</h2>
        <p className="text-muted-foreground mt-1 mb-4 text-sm text-pretty">
          It runs under whoever holds the role at the time, within that role&apos;s
          cap. Over the cap, it waits for an approver like any other payment.
        </p>
        {spendable.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You need spend authority on a role before you can make it recur.
          </p>
        ) : (
          <ScheduleForm orgId={orgId} roles={spendable} />
        )}
      </section>
    </>
  );
}
