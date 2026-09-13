import { readFileSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * A dedicated port — not 8545, and not the 8546 that `pnpm chain` runs the
 * development chain on. A test run must never quietly attach to a chain
 * somebody is using for something else, or worse, drive it: the suite wipes
 * the database between tests and would take the seeded demo with it.
 */
export const ANVIL_PORT = 8547;
export const ANVIL_URL = `http://127.0.0.1:${ANVIL_PORT}`;

/** Anvil's deterministic accounts. Public knowledge, worthless off a local chain. */
export const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
] as const;

export const anvilChain = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_URL] } },
});

export const publicClient = () =>
  createPublicClient({ chain: anvilChain, transport: http(ANVIL_URL) });

export const walletClient = (key: `0x${string}`) =>
  createWalletClient({
    account: privateKeyToAccount(key),
    chain: anvilChain,
    transport: http(ANVIL_URL),
  });

/** Reads a Foundry artifact. `forge build` must have run. */
export function artifact(name: string) {
  const file = path.resolve(
    import.meta.dirname,
    "..",
    "contracts",
    "out",
    `${name}.sol`,
    `${name}.json`,
  );
  const json = JSON.parse(readFileSync(file, "utf8"));
  return {
    abi: json.abi,
    bytecode: json.bytecode.object as `0x${string}`,
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    payAddress: `0x${string}`;
    usdcAddress: `0x${string}`;
  }
}
