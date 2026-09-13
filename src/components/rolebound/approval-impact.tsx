import { cn } from "@/lib/utils";
import { Money } from "@/components/rolebound/primitives";

/**
 * What saying yes actually does to the role's month.
 *
 * The interesting answer is: less than people expect. A payment waiting here
 * is already counted against the cap — the gate reserves it the moment it is
 * requested, so a queue of approvals cannot collectively overshoot. Approving
 * it moves the amount from reserved to spent and changes the month's total by
 * nothing at all.
 *
 * That is the single least obvious thing about this design, and an approver
 * who does not know it is either being too cautious or too casual. So it is
 * drawn rather than explained: the slice for this payment is already sitting
 * in the bar, outlined, waiting to change colour.
 */
export function ApprovalImpact({
  roleName,
  amount,
  paid,
  pending,
  capMonthly,
}: {
  roleName: string;
  amount: bigint;
  paid: bigint;
  pending: bigint;
  capMonthly: bigint | null;
}) {
  if (capMonthly === null || capMonthly === 0n) return null;

  const pct = (v: bigint) =>
    Math.min(100, Math.max(0, Number((v * 10_000n) / capMonthly) / 100));

  // The rest of the queue, which this decision does not touch.
  const otherPending = pending > amount ? pending - amount : 0n;
  const remaining = capMonthly > paid + pending ? capMonthly - paid - pending : 0n;

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-4 py-3.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {roleName} this month
      </p>

      <div className="rb-fill mt-2.5 flex h-3 w-full overflow-hidden rounded-md bg-muted">
        <div
          className="h-full bg-settled/90"
          style={{ width: `${pct(paid)}%` }}
          title="Already paid"
        />
        <div
          className={cn(
            "h-full bg-gated ring-1 ring-inset ring-gated-ink/50",
          )}
          style={{ width: `${pct(amount)}%` }}
          title="This payment"
        />
        {otherPending > 0n ? (
          <div
            className="h-full bg-gated/35"
            style={{ width: `${pct(otherPending)}%` }}
            title="Other payments awaiting approval"
          />
        ) : null}
      </div>

      <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        <Row swatch="bg-settled/90" label="Already paid" value={paid} />
        <Row
          swatch="bg-gated ring-1 ring-inset ring-gated-ink/50"
          label="This payment"
          value={amount}
          strong
        />
        {otherPending > 0n ? (
          <Row
            swatch="bg-gated/35"
            label="Others awaiting"
            value={otherPending}
          />
        ) : null}
        <Row swatch="bg-muted border border-border" label="Left after" value={remaining} />
      </dl>

      <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground text-pretty">
        This amount is already held against {roleName}&rsquo;s{" "}
        <Money base={capMonthly} unit={null} /> monthly cap, so approving moves
        it from reserved to paid and leaves the month&rsquo;s total unchanged.
        Turning it down gives the {<Money base={amount} unit={null} />} back.
      </p>
    </div>
  );
}

function Row({
  swatch,
  label,
  value,
  strong,
}: {
  swatch: string;
  label: string;
  value: bigint;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", swatch)} />
        {label}
      </dt>
      <dd className={strong ? "font-medium" : undefined}>
        <Money base={value} unit={null} />
      </dd>
    </div>
  );
}
