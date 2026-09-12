/**
 * The app as it will really run: Privy identities, Privy-held role wallets,
 * Base Sepolia.
 *
 * `.env.local` blanks the Privy variables so the Anvil loop stays local, and
 * it takes precedence over `.env` in Next — but real process environment
 * beats both. So this reads the true values out of `.env` and hands them to
 * `next dev` directly, without editing either file.
 *
 *   pnpm dev:privy
 */
import { config as loadEnv } from "dotenv";
import { spawn } from "node:child_process";

const real = loadEnv({ path: ".env", override: true, quiet: true }).parsed ?? {};

const required = ["NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_SECRET",
                  "NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS", "NEXT_PUBLIC_USDC_ADDRESS"];
const missing = required.filter((k) => !real[k]);
if (missing.length) {
  console.error(`\n✗ .env is missing: ${missing.join(", ")}\n`);
  process.exit(1);
}

console.log("\nPrivy mode — chain 84532 (Base Sepolia)");
console.log(`  pay contract ${real.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS}`);
console.log(`  privy app    ${real.NEXT_PUBLIC_PRIVY_APP_ID}\n`);

spawn("next", ["dev", "--port", process.env.PORT ?? "3002"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ...real,
    NEXT_PUBLIC_CHAIN_ID: "84532",
    NEXT_PUBLIC_RPC_URL: real.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org",
  },
}).on("exit", (code) => process.exit(code ?? 0));
