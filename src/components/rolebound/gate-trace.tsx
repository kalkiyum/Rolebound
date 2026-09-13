"use client";

import { cn } from "@/lib/utils";

export type CheckState = "ok" | "gated" | "bad" | "idle";

const MARK: Record<CheckState, { glyph: string; className: string }> = {
  ok: { glyph: "✓", className: "text-verified-ink" },
  gated: { glyph: "→", className: "text-gated-ink" },
  bad: { glyph: "✕", className: "text-refused" },
  idle: { glyph: "·", className: "text-muted-foreground/50" },
};

export interface Check {
  state: CheckState;
  label: React.ReactNode;
}

/**
 * The gate, read out as it decides.
 *
 * `assertCanSpend` runs five or six tests in a fixed order and returns the
 * first one that fails. Everywhere else in this product that is invisible —
 * you get a sentence telling you the outcome and are asked to trust it. Here
 * the tests are listed in the order the server will run them, updating as the
 * form is filled in, because "it was refused" and "it was refused *by this
 * rule, and here is the rule*" are different products.
 *
 * These are a rehearsal of the server's checks, never a replacement: nothing
 * here gates the submit button. A payment this list calls fine is still
 * decided, from the database, by the gate.
 */
export function GateTrace({ checks }: { checks: Check[] }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        How this gets decided
      </p>
      <ol className="mt-2 space-y-1.5">
        {checks.map((check, i) => {
          const mark = MARK[check.state];
          return (
            <li key={i} className="flex gap-2.5 text-xs leading-relaxed">
              <span
                aria-hidden
                className={cn(
                  "w-3 shrink-0 text-center font-mono transition-colors",
                  mark.className,
                )}
              >
                {mark.glyph}
              </span>
              <span
                className={cn(
                  "text-pretty transition-colors",
                  check.state === "idle"
                    ? "text-muted-foreground/70"
                    : check.state === "bad"
                      ? "text-refused"
                      : check.state === "gated"
                        ? "text-gated-ink"
                        : "text-foreground/80",
                )}
              >
                {check.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
