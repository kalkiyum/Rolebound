import { cn } from "@/lib/utils";
import { formatUsdc, shortAddress } from "@/lib/format";

export { TimeAgo } from "./time-ago";

/**
 * Money is always tabular so columns of it line up, and always carries its
 * unit. A bare number on a payments screen is an invitation to misread the
 * decimal place.
 */
export function Money({
  base,
  className,
  unit = "USDC",
  muted = false,
}: {
  base: bigint | string | null;
  className?: string;
  unit?: string | null;
  muted?: boolean;
}) {
  if (base === null) {
    return (
      <span className={cn("text-muted-foreground text-sm", className)}>
        unavailable
      </span>
    );
  }

  return (
    <span className={cn("font-mono tabular-nums whitespace-nowrap", className)}>
      {formatUsdc(base)}
      {unit ? (
        <span
          className={cn(
            "ml-1 text-[0.8em]",
            muted ? "text-muted-foreground" : "opacity-60",
          )}
        >
          {unit}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A month's spending against the cap that governs it.
 *
 * Two segments, not one. What has been paid is gone; what is awaiting
 * approval is still in the wallet but already counted by the gate, and a
 * reader who cannot see the difference will think the balance is wrong.
 * Over the cap the whole bar turns — the one state that must not look like
 * a nearly-full bar.
 */
export function SpendMeter({
  paid,
  pending,
  cap,
  className,
}: {
  paid: bigint;
  pending: bigint;
  cap: bigint | null;
  className?: string;
}) {
  // Without a cap there is no denominator, so there is no bar to draw. The
  // amounts still get reported; they just have nothing to be a fraction of.
  if (cap === null || cap === 0n) return null;

  const pct = (value: bigint) => Number((value * 10_000n) / cap) / 100;
  const over = paid + pending > cap;
  const paidPct = Math.min(pct(paid), 100);
  const pendingPct = Math.min(pct(pending), Math.max(0, 100 - paidPct));

  return (
    <div
      className={cn(
        "flex h-1.5 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
      role="img"
      aria-label={`${formatUsdc(paid + pending)} of ${formatUsdc(cap)} USDC committed this month`}
    >
      <div
        style={{ width: `${over ? 100 : paidPct}%` }}
        className={cn(
          "h-full",
          over ? "bg-destructive" : "bg-foreground/80",
        )}
      />
      {!over && pendingPct > 0 ? (
        <div
          style={{ width: `${pendingPct}%` }}
          className="h-full bg-amber-500/60"
        />
      ) : null}
    </div>
  );
}

export function AddressChip({
  address,
  className,
}: {
  address: string;
  className?: string;
}) {
  return (
    <span
      title={address}
      className={cn(
        "font-mono text-xs text-muted-foreground whitespace-nowrap",
        className,
      )}
    >
      {shortAddress(address)}
    </span>
  );
}

type VerificationState = "verified" | "pending" | "not_found" | "mismatch";

/**
 * The only place semantic colour is spent. "Verified" means the chain and the
 * app agree about the reason; "mismatch" means they do not, and it must never
 * look like an ordinary row.
 */
export function VerifiedBadge({ state }: { state: VerificationState }) {
  const styles: Record<VerificationState, { label: string; className: string; title: string }> = {
    verified: {
      label: "Verified onchain",
      className:
        "border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      title: "The reason shown hashes to the value committed in the transaction.",
    },
    pending: {
      label: "Not yet onchain",
      className: "border-border bg-muted text-muted-foreground",
      title: "This payment has not settled, so there is nothing to verify yet.",
    },
    not_found: {
      label: "No matching event",
      className:
        "border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      title: "We have a transaction hash but found no Payment event for it.",
    },
    mismatch: {
      label: "Does not match chain",
      className:
        "border-destructive/30 bg-destructive/10 text-destructive font-medium",
      title:
        "The stored reason or amount does not hash to what was committed onchain.",
    },
  };

  const s = styles[state];

  return (
    <span
      title={s.title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
        s.className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          state === "verified" && "bg-emerald-600 dark:bg-emerald-400",
          state === "pending" && "bg-muted-foreground/50",
          state === "not_found" && "bg-amber-600 dark:bg-amber-400",
          state === "mismatch" && "bg-destructive",
        )}
      />
      {s.label}
    </span>
  );
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  executed: { label: "Paid", className: "border-border bg-muted text-foreground" },
  pending_approval: {
    label: "Awaiting approval",
    className: "border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  executing: { label: "Sending", className: "border-border bg-muted text-muted-foreground" },
  blocked: {
    label: "Blocked",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  failed: {
    label: "Failed",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  rejected: {
    label: "Turned down",
    className: "border-border bg-muted text-muted-foreground line-through decoration-1",
  },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? {
    label: status,
    className: "border-border bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs",
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}

export function KindBadge({ kind }: { kind: "person" | "agent" }) {
  if (kind === "person") return null;
  return (
    <span
      title="An agent. Same table, same grants, same caps as a person."
      className="inline-flex shrink-0 items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
    >
      agent
    </span>
  );
}

/**
 * Empty states say what the thing is and what to do next. "No data" tells a
 * first-time reader nothing about what this screen is for.
 */
/**
 * The result of a mutation, kept on screen.
 *
 * A toast is right for "saved"; it is wrong for "this payment was refused
 * and here is what to do about it", which is the single most important
 * sentence this product ever shows and which nobody can read in four
 * seconds. Refusals stay until the next attempt replaces them.
 */
export function Outcome({
  tone,
  title,
  children,
}: {
  tone: "ok" | "waiting" | "refused";
  title: string;
  children?: React.ReactNode;
}) {
  const skin = {
    ok: "border-emerald-600/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300",
    waiting: "border-amber-600/30 bg-amber-500/5 text-amber-800 dark:text-amber-300",
    refused: "border-destructive/30 bg-destructive/5 text-destructive",
  }[tone];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("rounded-lg border px-4 py-3 text-sm", skin)}
    >
      <p className="font-medium">{title}</p>
      {children ? (
        <p className="mt-1 text-pretty opacity-90">{children}</p>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground text-pretty">
        {children}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 gap-2">{children}</div> : null}
    </div>
  );
}
