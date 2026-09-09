import "server-only";
import { env } from "../env";
import { localBackend } from "./local";
import { privyBackend } from "./privy";
import type { WalletBackend } from "./types";

export type * from "./types";

const LOCAL_CHAIN_ID = 31337;

/**
 * Chooses who holds the keys.
 *
 * Privy whenever it is configured — it is the product, and the enclave is
 * what enforces every hard cap. The local backend is a development
 * convenience for Anvil and is fenced twice: it is only reachable when Privy
 * is absent, and only on chain 31337. Deterministic keys on a public chain
 * would be a wallet anyone can drain, so that second check is a refusal, not
 * a warning.
 */
export function walletBackend(): WalletBackend {
  const hasPrivy =
    !!process.env.NEXT_PUBLIC_PRIVY_APP_ID && !!process.env.PRIVY_APP_SECRET;

  if (hasPrivy) return privyBackend;

  if (env.chainId === LOCAL_CHAIN_ID) return localBackend;

  throw new Error(
    `No wallet backend: Privy is not configured and chain ${env.chainId} is ` +
      `not Anvil. Set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET ` +
      `(see .env.example), or point NEXT_PUBLIC_CHAIN_ID at a local chain.`,
  );
}

export const provisionRoleWallet: WalletBackend["provisionRoleWallet"] = (s) =>
  walletBackend().provisionRoleWallet(s);

export const provisionTreasuryWallet: WalletBackend["provisionTreasuryWallet"] =
  (n) => walletBackend().provisionTreasuryWallet(n);

export const sendFromWallet: WalletBackend["send"] = (r) =>
  walletBackend().send(r);
