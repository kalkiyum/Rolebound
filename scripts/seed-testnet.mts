/**
 * Seeds the demo organization against Base Sepolia and the hosted database.
 *
 *   pnpm seed:testnet
 *
 * The sibling of `chain:setup`, which does the same thing against Anvil. It
 * runs the same `seed()` — the same roles, the same payments, through the
 * same gate — and differs in one thing only: where the money comes from.
 * Anvil mints from a faucet account; here the deployer mints the demo token
 * it owns and sends it on.
 *
 * Everything it touches is real: Privy provisions a server wallet per role,
 * every payment is a transaction on Base Sepolia, and the reasons are
 * committed onchain. It is therefore slow, and it costs testnet gas.
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// `.env.local` carries the hosted DATABASE_URL that the Neon integration
// wrote; `.env` carries Privy and the chain. Local wins, as it does in Next.
loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

const ROOT = path.resolve(import.meta.dirname, "..");
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";

/**
 * Gas for the wallets Privy provisions. A payment costs on the order of
 * 0.0000006 ETH, so this is thousands of them — cheap insurance against a
 * demo that dies halfway through for want of a fraction of a testnet cent.
 */
const GAS_TOPUP = 5_000_000_000_000_000n; // 0.005 ETH
const GAS_FLOOR = 1_000_000_000_000_000n; // 0.001 ETH

const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

function artifact(name: string) {
  const file = path.join(ROOT, "contracts", "out", `${name}.sol`, `${name}.json`);
  return JSON.parse(readFileSync(file, "utf8")).abi;
}

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set — see .env.example");

  const usdc = process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}` | undefined;
  if (!usdc) throw new Error("NEXT_PUBLIC_USDC_ADDRESS is not set");

  const database = process.env.DATABASE_URL ?? "";
  if (/localhost|127\.0\.0\.1/.test(database)) {
    throw new Error(
      "DATABASE_URL points at localhost. This script seeds the hosted database; run `pnpm chain:setup` for the local one.",
    );
  }

  const account = privateKeyToAccount(key as `0x${string}`);
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });
  const wallet = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const abi = artifact("TestUSDC");
  const gas = await publicClient.getBalance({ address: account.address });
  console.log(`\n  chain      Base Sepolia (84532)`);
  console.log(`  token      ${usdc}`);
  console.log(`  funder     ${account.address}  ${formatEther(gas)} ETH`);

  /**
   * Tops a wallet up with gas if it has none.
   *
   * On Anvil this problem does not exist, which is exactly why it was missed:
   * a Privy role wallet on a real chain starts with zero ETH, and every
   * payment it tries to sign fails with `insufficient funds for gas` — the
   * role holds thousands in tokens and cannot move any of it.
   */
  const fundGas = async (to: `0x${string}`) => {
    const balance = await publicClient.getBalance({ address: to });
    if (balance >= GAS_FLOOR) return;

    const hash = await wallet.sendTransaction({ to, value: GAS_TOPUP });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  gas        ${to}  ${formatEther(GAS_TOPUP)} ETH`);
  };

  /**
   * Funds a role wallet: gas first, then the token it is meant to spend.
   * Serialized rather than concurrent — these are transactions from one
   * account, and firing them in parallel races on the nonce for no gain.
   */
  const mint = async (to: `0x${string}`, amount: bigint) => {
    await fundGas(to);
    const hash = await wallet.sendTransaction({
      to: usdc,
      data: encodeFunctionData({ abi, functionName: "mint", args: [to, amount] }),
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  funded     ${to}  ${amount / 1_000_000n}`);
  };

  const { seed } = await import("./seed");
  const org = await seed({ mint });

  // The treasury signs its own transactions when the sweep tops a role up,
  // so it needs gas for the same reason the roles do — and a balance to send.
  console.log("\n  funding the treasury…");
  await mint(org.treasuryAddress as `0x${string}`, 50_000n * 1_000_000n);
}

main().catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
