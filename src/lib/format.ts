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

/**
 * A typed amount to base units, or null when it is not a USDC amount.
 *
 * Shared rather than duplicated because the browser signs over the amount and
 * the server verifies that signature: two parsers that disagree by one unit
 * would refuse every payment, and the error would point at the signature
 * rather than at the arithmetic.
 */
export function parseUsdc(input: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

/**
 * A block explorer link for a transaction, or null on a chain that has none.
 *
 * "Verified onchain" is a claim, and a claim the reader cannot go and check
 * for themselves is just our database talking. Anvil has no explorer, so the
 * badge stands alone there rather than linking somewhere broken.
 */
export function explorerTx(txHash: string, chainId: number): string | null {
  const base: Record<number, string> = {
    8453: "https://basescan.org",
    84532: "https://sepolia.basescan.org",
  };
  const host = base[chainId];
  return host ? `${host}/tx/${txHash}` : null;
}
