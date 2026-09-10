import "server-only";
import { erc20Abi } from "./abi";
import { publicClient } from "./chain";
import { env } from "./env";

/**
 * A role's budget is its wallet balance, read from the chain every time.
 *
 * There is deliberately no cached balance column: the moment someone funds a
 * role outside the app, a cached number becomes a confident lie, and this is
 * a product about not lying about money.
 */
export async function roleBalances(
  addresses: string[],
): Promise<Map<string, bigint | null>> {
  const client = publicClient();
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];

  const results = await Promise.all(
    unique.map(async (address) => {
      try {
        const balance = await client.readContract({
          address: env.usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        });
        return [address, balance as bigint] as const;
      } catch {
        // An unreachable RPC must not take the whole page down. The UI shows
        // "unavailable" rather than a zero, which would read as "spent".
        return [address, null] as const;
      }
    }),
  );

  return new Map(results);
}
