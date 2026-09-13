import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { env } from "./env";

const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8546"] } },
});

/**
 * Annotated as `Chain` deliberately: a union of two concrete chain types
 * makes every downstream client type incompatible with itself.
 */
export function activeChain(): Chain {
  return env.chainId === 31337 ? anvil : baseSepolia;
}

const globalForChain = globalThis as unknown as {
  rbPublicClient?: PublicClient;
};

/**
 * Reads only. Balances come from here rather than a cached column, because a
 * cached balance and a real one disagree the moment anyone funds a role
 * outside the app — and then the number on screen is a lie.
 */
export function publicClient(): PublicClient {
  globalForChain.rbPublicClient ??= createPublicClient({
    chain: activeChain(),
    transport: http(env.rpcUrl),
  });
  return globalForChain.rbPublicClient;
}
