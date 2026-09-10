/**
 * Pure formatting, deliberately free of any server import.
 *
 * These live apart from balances.ts because the forms that show a cap are
 * client components, and dragging an RPC client into the browser bundle to
 * render a number would be a strange price to pay for two decimal places.
 */

/** Base units to a human string. USDC has six decimals. */
export function formatUsdc(base: bigint | string, decimals = 6): string {
  const value = typeof base === "string" ? BigInt(base) : base;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(decimals);

  const whole = abs / unit;
  const fraction = abs % unit;

  const wholeStr = whole.toLocaleString("en-US");
  const fractionStr = fraction.toString().padStart(decimals, "0").slice(0, 2);

  return `${negative ? "-" : ""}${wholeStr}.${fractionStr}`;
}

/** 0x1234…cdef — long enough to compare, short enough to scan. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
