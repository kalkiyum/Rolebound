import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { ANVIL_KEYS, ANVIL_PORT, ANVIL_URL, artifact, publicClient, walletClient } from "./chain";
import { TEST_DATABASE_URL } from "./db";

/**
 * Starts a real EVM for the suite and deploys the real contracts to it.
 *
 * The payment path is the riskiest code in this project, and the half of it
 * that lives onchain cannot be asserted about by reading it. Anvil costs a
 * second of startup and makes `pnpm test` exercise the whole thing —
 * transfer, event, reason hash — with no network and no credentials.
 */
export default async function setup(project: TestProject) {
  const root = path.resolve(import.meta.dirname, "..");
  const contracts = path.join(root, "contracts");

  prepareDatabase(root);

  // Artifacts are gitignored, so a fresh clone has none. Build rather than
  // fail with a confusing missing-file error three frames deep.
  execFileSync("forge", ["build"], { cwd: contracts, stdio: "pipe" });

  // Refuse to run against a chain we did not start. Without this the suite
  // silently adopts whatever answers on the port — which is how a test run
  // ends up deploying into, and asserting against, the development chain.
  if (await portAnswers()) {
    throw new Error(
      `Something is already listening on ${ANVIL_URL}. The test suite starts its own anvil and will not attach to one it does not own — stop that process, or move it off port ${ANVIL_PORT}.`,
    );
  }

  // No --block-time: anvil auto-mines on each transaction, which is what a
  // test wants. Keep stderr, or a bad flag looks like "anvil never came up".
  const anvil = spawn("anvil", ["--port", String(ANVIL_PORT), "--silent"], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let anvilStderr = "";
  anvil.stderr?.on("data", (chunk) => {
    anvilStderr += String(chunk);
  });
  anvil.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`anvil exited with ${code}: ${anvilStderr}`);
    }
  });

  const client = publicClient();
  await waitFor(async () => {
    await client.getBlockNumber();
  }, () => `anvil did not come up on ${ANVIL_URL}. ${anvilStderr}`);

  const deployer = walletClient(ANVIL_KEYS[0]);

  const usdc = artifact("TestUSDC");
  const usdcHash = await deployer.deployContract({ ...usdc, args: [] });
  const usdcReceipt = await client.waitForTransactionReceipt({ hash: usdcHash });

  const pay = artifact("RoleboundPay");
  const payHash = await deployer.deployContract({ ...pay, args: [] });
  const payReceipt = await client.waitForTransactionReceipt({ hash: payHash });

  project.provide("usdcAddress", usdcReceipt.contractAddress!);
  project.provide("payAddress", payReceipt.contractAddress!);

  return () => {
    anvil.kill("SIGTERM");
  };
}

/**
 * Creates the test database if it does not exist and brings it up to the
 * current migrations. A fresh clone should be able to run `pnpm test` without
 * a setup step nobody wrote down.
 */
function prepareDatabase(root: string) {
  const { name, admin } = splitDatabaseUrl(TEST_DATABASE_URL);

  const exists = execFileSync("psql", [
    admin,
    "-tAc",
    `select 1 from pg_database where datname = '${name}'`,
  ]).toString().trim();

  if (exists !== "1") {
    execFileSync("psql", [admin, "-c", `create database "${name}"`], { stdio: "pipe" });
  }

  execFileSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}

/** The same server, addressed at `postgres`, so the database can be created. */
function splitDatabaseUrl(url: string) {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");
  parsed.pathname = "/postgres";
  return { name, admin: parsed.toString() };
}

async function portAnswers() {
  try {
    await publicClient().getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

async function waitFor(probe: () => Promise<unknown>, message: () => string) {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await probe();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`${message()} — last error: ${String(lastError)}`);
}
