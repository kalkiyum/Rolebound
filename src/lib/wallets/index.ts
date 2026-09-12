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

  // Privy has no eip155:31337, so this pairing cannot work in either
  // direction: Privy will not sign for a local chain, and wallets already
  // provisioned locally are not wallets it knows. Left to fall through to
  // the Privy backend it fails much later, inside an SDK call, as
  // "Invalid wallet ID" — which reads like a database problem and is not.
  if (hasPrivy && env.chainId === LOCAL_CHAIN_ID) {
    throw new Error(
      `Privy is configured but the chain is ${LOCAL_CHAIN_ID} (Anvil), which ` +
        `Privy cannot sign for. For local development, blank the Privy ` +
        `variables in .env.local — \`pnpm chain:setup\` writes them for you. ` +
        `To use Privy, point NEXT_PUBLIC_CHAIN_ID at a real chain.`,
    );
  }

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
