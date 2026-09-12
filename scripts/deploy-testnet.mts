/**
 * Deploys the demo token to Base Sepolia and mints the deployer a float.
 *
 *   pnpm deploy:testnet
 *
 * Why this exists: Circle's Base Sepolia USDC is faucet-rationed at roughly
 * ten a day, and the demo moves several thousand across six payments. A
 * token we can mint is the only way the amounts in the script are the
 * amounts on screen. RoleboundPay takes the token as an argument, so nothing
 * about the payment pipeline changes — only which ERC-20 it is pointed at.
 *
 * Prints the address rather than writing it anywhere: the value has to reach
 * both `.env` and the Vercel project, and doing that silently in two places
 * is how they drift apart.
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

loadEnv({ path: ".env", quiet: true });

const ROOT = path.resolve(import.meta.dirname, "..");
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";

/** Minted to the deployer, which funds every role wallet from there. */
const FLOAT = 1_000_000n * 1_000_000n;

const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

function artifact(name: string) {
  const file = path.join(ROOT, "contracts", "out", `${name}.sol`, `${name}.json`);
  const json = JSON.parse(readFileSync(file, "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object as `0x${string}` };
}

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set — see .env.example");

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

  const gas = await publicClient.getBalance({ address: account.address });
  console.log(`\n  deployer   ${account.address}`);
  console.log(`  gas        ${formatEther(gas)} ETH`);
  if (gas === 0n) {
    throw new Error("The deployer has no ETH on Base Sepolia — fund it first.");
  }

  const { abi, bytecode } = artifact("TestUSDC");
  const hash = await wallet.deployContract({ abi, bytecode, args: [] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const address = receipt.contractAddress;
  if (!address) throw new Error(`Deployment ${hash} produced no address`);

  const mint = await wallet.sendTransaction({
    to: address,
    data: encodeFunctionData({
      abi,
      functionName: "mint",
      args: [account.address, FLOAT],
    }),
  });
  await publicClient.waitForTransactionReceipt({ hash: mint });

  console.log(`  TestUSDC   ${address}`);
  console.log(`  minted     ${FLOAT / 1_000_000n} to the deployer\n`);
  console.log("  Set NEXT_PUBLIC_USDC_ADDRESS to that address in BOTH places:");
  console.log("    .env");
  console.log("    vercel env  (production and development)\n");
}

main().catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
