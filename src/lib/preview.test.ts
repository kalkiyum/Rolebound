import { describe, expect, it } from "vitest";
import { bandFor, previewGate, type Limits } from "./preview";

const USDC = (n: string) => BigInt(n) * 1_000_000n;

/** Marketing in the demo: 500 a payment, 4,000 a month, 1,241 of it left. */
const marketing: Limits = {
  capPerTx: USDC("500"),
  remainingMonthly: USDC("1241"),
  capMonthly: USDC("4000"),
};

/** Operations: capped per payment, no monthly budget and so no ceiling. */
const operations: Limits = {
  capPerTx: USDC("1000"),
  remainingMonthly: null,
  capMonthly: null,
};

describe("previewGate", () => {
  it("clears a payment inside both caps", () => {
    expect(previewGate(USDC("320"), marketing)).toMatchObject({
      verdict: "clear",
      because: "within_caps",
    });
  });

  it("clears a payment sitting exactly on the per-payment cap", () => {
    expect(previewGate(USDC("500"), marketing).verdict).toBe("clear");
  });

  it("routes one over the per-payment cap to an approver", () => {
    expect(previewGate(USDC("1200"), marketing)).toMatchObject({
      verdict: "gated",
      because: "over_per_tx_cap",
      limit: USDC("500"),
    });
  });

  it("routes one that would outrun the month to an approver", () => {
    // Under the 500 per-payment cap is impossible here, so this is the case
    // where the month is nearly gone: 300 left, a 400 payment.
    const nearlySpent: Limits = { ...marketing, remainingMonthly: USDC("300") };
    expect(previewGate(USDC("400"), nearlySpent)).toMatchObject({
      verdict: "gated",
      because: "over_monthly_budget",
      limit: USDC("300"),
    });
  });

  it("refuses a payment bigger than the whole monthly budget", () => {
    // The enclave holds this one, so no approver can rescue it — the reason
    // this is a separate verdict rather than another trip to the queue.
    expect(previewGate(USDC("9000"), marketing)).toMatchObject({
      verdict: "refused",
      because: "over_ceiling",
      limit: USDC("4000"),
    });
  });

  it("checks the ceiling before the cap, so the advice is actionable", () => {
    // 9,000 is over both. Saying "find an approver" would send someone on an
    // errand that cannot succeed.
    expect(previewGate(USDC("9000"), marketing).because).toBe("over_ceiling");
  });

  it("never refuses a role with no monthly cap, however large", () => {
    expect(previewGate(USDC("500000"), operations)).toMatchObject({
      verdict: "gated",
      because: "over_per_tx_cap",
    });
  });
});

describe("bandFor", () => {
  it("runs to the ceiling and marks the cap along the way", () => {
    const band = bandFor(marketing);
    expect(band.max).toBe(USDC("4000"));
    expect(band.clearTo).toBe(USDC("500"));
    expect(band.clearPct).toBeCloseTo(12.5, 1);
  });

  it("ends the clear zone at the month's remainder once that is the tighter limit", () => {
    const band = bandFor({ ...marketing, remainingMonthly: USDC("300") });
    expect(band.clearTo).toBe(USDC("300"));
  });

  it("invents an outer edge for a role that has no ceiling", () => {
    const band = bandFor(operations);
    expect(band.max).toBe(USDC("3000"));
    expect(band.clearPct).toBeCloseTo(33.3, 1);
  });

  it("pins anything past the ceiling to the end rather than overflowing", () => {
    expect(bandFor(marketing).pct(USDC("100000"))).toBe(100);
  });
});
