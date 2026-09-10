/**
 * One command between a fresh clone and a working app, with no credentials.
 *
 *   Terminal 1:  pnpm chain          (anvil, leave it running)
 *   Terminal 2:  pnpm chain:setup    (this — deploys, writes env, seeds)
 *                pnpm dev
 *
 * Deploys the real contracts to Anvil, writes their addresses into
 * `.env.local`, and seeds an organization with enough history that every
 * screen has something truthful to render.
 */
import { config as loadEnv } from "dotenv";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// `.env` first for DATABASE_URL; the chain settings below are written by
// this script and set on process.env directly, so ordering does not matter.
loadEnv({ path: ".env", quiet: true });

const RPC_URL = process.env.ANVIL_URL ?? "http://127.0.0.1:8546";
const ROOT = path.resolve(import.meta.dirname, "..");

const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

/** Anvil's first deterministic account. Local chain only. */
const DEPLOYER =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const publicClient = createPublicClient({ chain: anvil, transport: http(RPC_URL) });
const deployer = createWalletClient({
  account: privateKeyToAccount(DEPLOYER),
  chain: anvil,
  transport: http(RPC_URL),
});

function artifact(name: string) {
  const file = path.join(ROOT, "contracts", "out", `${name}.sol`, `${name}.json`);
  const json = JSON.parse(readFileSync(file, "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object as `0x${string}` };
}

async function deploy(name: string) {
  const hash = await deployer.deployContract({ ...artifact(name), args: [] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const address = receipt.contractAddress!;
  console.log(`  ${name.padEnd(14)} ${address}`);
  return address;
}

/**
 * `.env.local` takes precedence over `.env` in Next, so local chain settings
 * override whatever testnet configuration is committed without editing it.
 */
function writeEnvLocal(vars: Record<string, string>) {
  const file = path.join(ROOT, ".env.local");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";

  const lines = existing.split("\n").filter((line) => {
    const key = line.split("=")[0]?.trim();
    return key && !(key in vars);
  });

  const header = existing.includes("# written by pnpm chain:setup")
    ? []
    : ["# written by pnpm chain:setup — local Anvil development"];

  const body = [
    ...header,
    ...lines.filter(Boolean),
    ...Object.entries(vars).map(([k, v]) => `${k}=${v}`),
    "",
  ].join("\n");

  writeFileSync(file, body);
  console.log(`\n  wrote ${path.relative(ROOT, file)}`);
}

async function main() {
  try {
    await publicClient.getBlockNumber();
  } catch {
    console.error(
      `\nNo chain at ${RPC_URL}.\nStart one in another terminal with:  pnpm chain\n`,
    );
    process.exit(1);
  }

  console.log("\nBuilding contracts…");
  execFileSync("forge", ["build"], {
    cwd: path.join(ROOT, "contracts"),
    stdio: "pipe",
  });

  console.log("\nDeploying to Anvil:");
  const usdc = await deploy("TestUSDC");
  const pay = await deploy("RoleboundPay");

  writeEnvLocal({
    NEXT_PUBLIC_CHAIN_ID: "31337",
    NEXT_PUBLIC_RPC_URL: RPC_URL,
    NEXT_PUBLIC_USDC_ADDRESS: usdc,
    NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS: pay,
  });

  // Point this process at what we just deployed, then seed through the real
  // application code — a seed that inserts rows directly would drift from
  // what the app actually produces.
  process.env.NEXT_PUBLIC_CHAIN_ID = "31337";
  process.env.NEXT_PUBLIC_RPC_URL = RPC_URL;
  process.env.NEXT_PUBLIC_USDC_ADDRESS = usdc;
  process.env.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS = pay;
  delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  delete process.env.PRIVY_APP_SECRET;

  const { seed } = await import("./seed");
  await seed({ mint: mintTo(usdc) });

  console.log("\nReady. Start the app with:  pnpm dev\n");
  process.exit(0);
}

/** Funds a role the way a treasury transfer would, so balances are real. */
function mintTo(usdc: `0x${string}`) {
  return async (to: `0x${string}`, amount: bigint) => {
    const hash = await deployer.sendTransaction({
      to: usdc,
      data: encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "mint",
            stateMutability: "nonpayable",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [],
          },
        ] as const,
        functionName: "mint",
        args: [to, amount],
      }),
    });
    await publicClient.waitForTransactionReceipt({ hash });
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
