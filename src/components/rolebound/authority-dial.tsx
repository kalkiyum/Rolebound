"use client";

import { cn } from "@/lib/utils";
import { formatUsdc } from "@/lib/format";
import { bandFor, previewGate, type Limits, type Verdict } from "@/lib/preview";

const TONE: Record<
  Verdict,
  { glyph: string; title: string; text: string; ring: string }
> = {
  // "Straight through" is the ordinary case and is deliberately not given a
  // colour of its own. Green here would compete with the verified badge,
  // where green means something much stronger — that the chain and this app
  // agree — and a product that spends its loudest signal on "nothing unusual
  // happened" has nothing left for the moment that matters.
  clear: {
    glyph: "✓",
    title: "Goes straight through",
    text: "text-foreground",
    ring: "border-border bg-muted/70",
  },
  gated: {
    glyph: "▲",
    title: "Needs an approver",
    text: "text-gated-ink",
    ring: "border-gated/40 bg-gated-soft",
  },
  refused: {
    glyph: "✕",
    title: "Nobody can authorize this",
    text: "text-refused",
    ring: "border-refused/40 bg-refused-soft",
  },
};

/**
 * The three things that can happen to a payment, laid out as somewhere you
 * are standing rather than something you are told afterwards.
 *
 * A cap is an abstraction right up until you can see how close you are to it.
 * The marker moves as the amount is typed, so the moment a payment stops
 * being routine and starts needing another person is visible *before* the
 * decision to make it — which is the difference between a control that feels
 * like a guardrail and one that feels like a rejection.
 */
export function AuthorityDial({
  amount,
  limits,
  roleName,
}: {
  amount: bigint | null;
  limits: Limits;
  roleName: string;
}) {
  const band = bandFor(limits);
  const preview = amount === null ? null : previewGate(amount, limits);
  const tone = preview ? TONE[preview.verdict] : null;

  const markerPct = amount === null ? null : band.pct(amount);
  const overflow = amount !== null && amount > band.max;

  return (
    <div>
      <div className="relative pt-6">
        {/* The marker rides above the band so it never obscures the zones,
            and carries its own value: reading a position off an axis is work
            nobody should have to do while spending money. */}
        {markerPct !== null ? (
          <div
            className="absolute top-0 z-10 -translate-x-1/2 transition-[left] duration-300 ease-out"
            style={{ left: `${overflow ? 100 : markerPct}%` }}
          >
            <div
              className={cn(
                "whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium tnum text-background",
                preview?.verdict === "clear" && "bg-settled",
                preview?.verdict === "gated" && "bg-gated",
                preview?.verdict === "refused" && "bg-refused",
              )}
            >
              {overflow ? "▸ " : ""}
              {formatUsdc(amount!)}
            </div>
            <div
              className={cn(
                "mx-auto size-0 border-x-4 border-t-4 border-x-transparent",
                preview?.verdict === "clear" && "border-t-settled",
                preview?.verdict === "gated" && "border-t-gated",
                preview?.verdict === "refused" && "border-t-refused",
              )}
            />
          </div>
        ) : null}

        {/* Zones are named inside themselves. A tick with a label floating
            beside it needs the reader to match one to the other; a region
            with its name written across it does not. */}
        <div className="rb-fill flex h-7 w-full overflow-hidden rounded-md bg-muted">
          <div
            className="flex h-full items-center justify-center overflow-hidden bg-settled/90 px-1"
            style={{ width: `${band.clearPct}%` }}
          >
            {band.clearPct >= 26 ? (
              <span className="truncate text-[10px] font-medium uppercase tracking-wider text-background">
                straight through
              </span>
            ) : null}
          </div>
          <div
            className="flex h-full items-center justify-center overflow-hidden bg-gated/25 px-1"
            style={{ width: `${Math.max(0, 100 - band.clearPct)}%` }}
          >
            {100 - band.clearPct >= 26 ? (
              <span className="truncate text-[10px] font-medium uppercase tracking-wider text-gated-ink">
                needs an approver
              </span>
            ) : null}
          </div>
        </div>

        {/* The axis carries only the two numbers that are boundaries. */}
        <div className="relative mt-1.5 h-7 text-[10px] leading-tight text-muted-foreground">
          <span className="absolute left-0 tnum">0</span>

          <span
            className="absolute flex -translate-x-1/2 flex-col items-center text-center"
            style={{ left: `${band.clearPct}%` }}
          >
            <span className="tnum">{formatUsdc(band.clearTo)}</span>
            <span className="whitespace-nowrap">cap per payment</span>
          </span>

          <span className="absolute right-0 flex flex-col items-end text-right">
            <span className="tnum">{formatUsdc(band.max)}</span>
            {limits.capMonthly !== null ? (
              <span className="whitespace-nowrap text-refused/70">
                enclave ceiling
              </span>
            ) : null}
          </span>
        </div>
      </div>

      {preview && tone ? (
        <div
          key={preview.because}
          className={cn("rb-rise mt-3 rounded-lg border px-3.5 py-3", tone.ring)}
        >
          <p className={cn("flex items-center gap-2 text-sm font-medium", tone.text)}>
            <span aria-hidden className="font-mono text-xs">
              {tone.glyph}
            </span>
            {tone.title}
          </p>
          <p className="mt-1 pl-[1.375rem] text-sm text-muted-foreground text-pretty">
            {explain(preview, limits, roleName)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function explain(
  preview: ReturnType<typeof previewGate>,
  limits: Limits,
  roleName: string,
) {
  switch (preview.because) {
    case "within_caps":
      return `Inside ${roleName}'s per-payment cap and this month's budget. It will be signed and sent as soon as you confirm.`;
    case "over_per_tx_cap":
      return `Over the ${formatUsdc(limits.capPerTx)} per-payment cap, so it is held rather than sent. Someone with approve rights on ${roleName} decides, and records their own reason next to yours.`;
    case "over_monthly_budget":
      return `${roleName} has ${formatUsdc(preview.limit)} left this month, and this is more. It goes to an approver rather than out.`;
    case "over_ceiling":
      return `This is larger than ${roleName}'s entire monthly budget of ${formatUsdc(preview.limit)}, which is the ceiling written into the wallet's own policy. Privy's enclave refuses it — an approver saying yes would not change that.`;
  }
}
