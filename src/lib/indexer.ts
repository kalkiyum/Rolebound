import type { Log } from "viem";
import { roleboundPayAbi } from "./abi";
import { publicClient } from "./chain";
import { env } from "./env";
import { hashReason } from "./authorization";
import { roleIdToBytes32 } from "./ids";

/**
 * Narrowed with a predicate rather than cast, so the literal ABI type
 * survives and `getLogs` can type-check the indexed filters below. Casting
 * here is what silently turns a filter into a no-op.
 */
type PaymentEventAbi = Extract<
  (typeof roleboundPayAbi)[number],
  { name: "Payment" }
>;

const paymentEvent = roleboundPayAbi.find(
  (e): e is PaymentEventAbi => e.type === "event" && e.name === "Payment",
)!;

export interface OnchainPayment {
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  roleId: `0x${string}`;
  roleWallet: `0x${string}`;
  to: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  reasonHash: `0x${string}`;
  actor: `0x${string}`;
}

/**
 * Reads payments as the chain saw them.
 *
 * The feed is rendered from our database because that is where the plaintext
 * reasons live, but the database is also the thing an operator could edit.
 * These events are the copy nobody can quietly change, which is what makes
 * the verified badge worth anything.
 */
export async function fetchPaymentEvents(opts: {
  fromBlock?: bigint;
  toBlock?: bigint;
  /** Application role ids; hashed to their onchain form before filtering. */
  roleIds?: string[];
} = {}): Promise<OnchainPayment[]> {
  const logs = await publicClient().getLogs({
    address: env.payAddress,
    event: paymentEvent,
    args: opts.roleIds
      ? { roleId: opts.roleIds.map(roleIdToBytes32) }
      : undefined,
    fromBlock: opts.fromBlock ?? 0n,
    toBlock: opts.toBlock ?? "latest",
  });

  return (logs as Array<Log & { args: Record<string, unknown> }>).map((log) => ({
    txHash: log.transactionHash!,
    blockNumber: log.blockNumber!,
    logIndex: log.logIndex!,
    roleId: log.args.roleId as `0x${string}`,
    roleWallet: log.args.roleWallet as `0x${string}`,
    to: log.args.to as `0x${string}`,
    token: log.args.token as `0x${string}`,
    amount: log.args.amount as bigint,
    reasonHash: log.args.reasonHash as `0x${string}`,
    actor: log.args.actor as `0x${string}`,
  }));
}

/**
 * `verified` means the chain and the app agree. `mismatch` means the reason
 * on screen is not the reason that was committed — the one state that must
 * never be quietly rendered as ordinary, because it is either a bug or
 * someone editing history.
 */
export type Verification =
  | { state: "verified"; onchain: OnchainPayment }
  | { state: "pending" }
  | { state: "not_found" }
  | { state: "mismatch"; onchain: OnchainPayment; expected: `0x${string}` };

export interface VerifiablePayment {
  id: string;
  txHash: string | null;
  reason: string;
  amount: string;
}

/**
 * Verifies a page of payments with a single log query rather than one call
 * per row — a feed of thirty payments should not be thirty round trips.
 */
export async function verifyPayments(
  rows: VerifiablePayment[],
): Promise<Map<string, Verification>> {
  const result = new Map<string, Verification>();
  const settled = rows.filter((r) => r.txHash);

  if (settled.length === 0) {
    for (const row of rows) result.set(row.id, { state: "pending" });
    return result;
  }

  const events = await fetchPaymentEvents();
  const byTx = new Map(events.map((e) => [e.txHash.toLowerCase(), e]));

  for (const row of rows) {
    if (!row.txHash) {
      result.set(row.id, { state: "pending" });
      continue;
    }

    const onchain = byTx.get(row.txHash.toLowerCase());
    if (!onchain) {
      result.set(row.id, { state: "not_found" });
      continue;
    }

    const expected = hashReason(row.reason);
    result.set(
      row.id,
      onchain.reasonHash.toLowerCase() === expected.toLowerCase() &&
        onchain.amount === BigInt(row.amount)
        ? { state: "verified", onchain }
        : { state: "mismatch", onchain, expected },
    );
  }

  return result;
}

/**
 * Payments that exist onchain with no row behind them. A role wallet can only
 * reach RoleboundPay, so anything here moved through the contract without
 * going through the app — worth surfacing rather than silently ignoring.
 */
export async function unrecordedPayments(
  knownTxHashes: string[],
): Promise<OnchainPayment[]> {
  const known = new Set(knownTxHashes.map((h) => h.toLowerCase()));
  const events = await fetchPaymentEvents();
  return events.filter((e) => !known.has(e.txHash.toLowerCase()));
}
