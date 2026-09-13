/**
 * What the gate is *going* to say, worked out in the browser as someone types.
 *
 * This is not a second gate and must never become one: it decides nothing,
 * authorizes nothing, and the server re-derives every one of these answers
 * from the database before a signature is released. It exists because a limit
 * you only discover by hitting it is a limit you experience as a failure,
 * and the whole claim of this product is that bounded authority is a
 * comfortable place to work rather than a wall you keep walking into.
 *
 * It mirrors `assertCanSpend` deliberately. If the two ever disagree the gate
 * is right — the only cost is a preview that promised the wrong outcome.
 */

export type Verdict = "clear" | "gated" | "refused";

export interface Limits {
  /** Most this role can pay in one go without a second person. */
  capPerTx: bigint;
  /** What is left of the month, or null when the role has no monthly cap. */
  remainingMonthly: bigint | null;
  /** The month's whole budget — and the ceiling Privy's enclave enforces. */
  capMonthly: bigint | null;
}

export interface Preview {
  verdict: Verdict;
  /** Why, in the gate's own terms. */
  because: "within_caps" | "over_per_tx_cap" | "over_monthly_budget" | "over_ceiling";
  /** The limit that decided it. */
  limit: bigint;
}

export function previewGate(amount: bigint, limits: Limits): Preview {
  const { capPerTx, remainingMonthly, capMonthly } = limits;

  // The enclave's ceiling is checked first because it is the only one no
  // human can overrule. A payment larger than the role's entire monthly
  // budget is refused inside Privy, after an approver has already said yes —
  // so telling someone to go and find an approver would be sending them on
  // an errand that cannot succeed.
  if (capMonthly !== null && amount > capMonthly) {
    return { verdict: "refused", because: "over_ceiling", limit: capMonthly };
  }

  if (amount > capPerTx) {
    return { verdict: "gated", because: "over_per_tx_cap", limit: capPerTx };
  }

  if (remainingMonthly !== null && amount > remainingMonthly) {
    return {
      verdict: "gated",
      because: "over_monthly_budget",
      limit: remainingMonthly,
    };
  }

  return { verdict: "clear", because: "within_caps", limit: capPerTx };
}

/**
 * Where the limits sit on a 0–100 band, so the dial and its ticks agree
 * about geometry. The band runs to the enclave's ceiling when there is one,
 * because that is the outermost thing that can happen to a payment.
 */
export function bandFor(limits: Limits) {
  const { capPerTx, remainingMonthly, capMonthly } = limits;

  // Without a ceiling there is no outer edge, so the band shows three times
  // the per-payment cap: enough room for "over the cap" to be a place you can
  // see, rather than the entire right-hand side of the control.
  const max = capMonthly ?? capPerTx * 3n;
  const clearTo = remainingMonthly === null
    ? capPerTx
    : capPerTx < remainingMonthly
      ? capPerTx
      : remainingMonthly;

  const pct = (v: bigint) =>
    max === 0n ? 0 : Math.min(100, Number((v * 10_000n) / max) / 100);

  return {
    max,
    /** The value the "straight through" zone ends at — a cap, or what is
     *  left of the month when that is the tighter of the two. */
    clearTo,
    clearPct: pct(clearTo),
    perTxPct: pct(capPerTx),
    remainingPct: remainingMonthly === null ? null : pct(remainingMonthly),
    pct,
  };
}
