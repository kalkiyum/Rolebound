/**
 * PHASE 0 SPIKE — the one unknown the whole architecture rests on.
 *
 * Question: can a Privy policy cap the ERC-20 *amount* argument inside
 * calldata, enforced in the enclave rather than by our code?
 *
 * If yes, PRD §5 stands as written: per-transaction caps are a hard limit.
 * If no, per-tx caps move to the application layer and the hard/soft table
 * gets redrawn — a finding, not a failure. Either way, write it down.
 *
 * We probe against USDC's own `transfer` so this needs no contract of ours
 * deployed. The mechanism is identical to RoleboundPay.pay().
 *
 *   pnpm spike:policy
 */
import "dotenv/config";
import { PrivyClient } from "@privy-io/node";
import { encodeFunctionData, parseUnits, type Abi } from "viem";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? process.env.PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;
const USDC = process.env.NEXT_PUBLIC_USDC_ADDRESS;
const CAIP2 = `eip155:${process.env.NEXT_PUBLIC_CHAIN_ID ?? "84532"}`;

/** USDC has 6 decimals. Cap the role at 500 USDC per transaction. */
const CAP_HUMAN = "500";
const UNDER = parseUnits("100", 6); // allowed
const OVER = parseUnits("900", 6); // must be refused
const CAP = parseUnits(CAP_HUMAN, 6);

const RECIPIENT = "0x000000000000000000000000000000000000dEaD";

/**
 * Parameter NAMES here are ours to choose — the selector for
 * transfer(address,uint256) is fixed regardless — and the policy engine
 * decodes calldata using this ABI, so `amount` is the field we constrain.
 */
const TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

function must(name: string, v: string | undefined): string {
  if (!v) {
    console.error(`\n✗ Missing ${name}. Fill it in .env (see .env.example).\n`);
    process.exit(1);
  }
  return v;
}

function show(label: string, err: unknown) {
  const e = err as { status?: number; error?: unknown; message?: string };
  console.log(`   ${label}`);
  console.log(`     status:  ${e?.status ?? "(none)"}`);
  console.log(`     message: ${e?.message ?? String(err)}`);
  if (e?.error) console.log(`     body:    ${JSON.stringify(e.error)}`);
}

async function main() {
  const appId = must("NEXT_PUBLIC_PRIVY_APP_ID", APP_ID);
  const appSecret = must("PRIVY_APP_SECRET", APP_SECRET);
  const usdc = must("NEXT_PUBLIC_USDC_ADDRESS", USDC);

  const privy = new PrivyClient({ appId, appSecret });

  console.log("\n── Phase 0 spike ──────────────────────────────────");
  console.log(`chain    ${CAIP2}`);
  console.log(`token    ${usdc}`);
  console.log(`cap      ${CAP_HUMAN} USDC per transaction\n`);

  // 0.3 — a policy that allows this token, and only under the cap.
  console.log("0.3  creating policy (allowlist + calldata amount cap)…");
  const policy = await privy.policies().create({
    version: "1.0",
    chain_type: "ethereum",
    name: `rolebound-spike-${Date.now()}`,
    rules: [
      {
        name: "usdc transfers under cap",
        method: "eth_sendTransaction",
        action: "ALLOW",
        conditions: [
          {
            field_source: "ethereum_transaction",
            field: "to",
            operator: "eq",
            value: usdc,
          },
          {
            field_source: "ethereum_calldata",
            abi: TRANSFER_ABI as unknown as never,
            field: "amount",
            operator: "lte",
            value: CAP.toString(),
          },
        ],
      },
    ],
  });
  console.log(`     policy ${policy.id}\n`);

  // 0.2 — a wallet governed by it.
  console.log("0.2  provisioning server wallet under that policy…");
  const wallet = await privy.wallets().create({
    chain_type: "ethereum",
    policy_ids: [policy.id],
  });
  console.log(`     wallet ${wallet.id}`);
  console.log(`     address ${wallet.address}\n`);

  const send = (amount: bigint) =>
    privy
      .wallets()
      .ethereum()
      .sendTransaction(wallet.id, {
        caip2: CAIP2 as never,
        params: {
          transaction: {
            to: usdc as `0x${string}`,
            data: encodeFunctionData({
              abi: TRANSFER_ABI,
              functionName: "transfer",
              args: [RECIPIENT, amount],
            }),
          },
        },
      } as never);

  // 0.4 — under the cap. An unfunded wallet still proves the point: a
  // broadcast or an on-chain/funding error means POLICY LET IT THROUGH.
  console.log(`0.4  under cap  (100 USDC ≤ ${CAP_HUMAN})…`);
  let underAllowed = false;
  try {
    const res = await send(UNDER);
    underAllowed = true;
    console.log(`     ✓ allowed — broadcast ${res.hash}\n`);
  } catch (err) {
    const msg = JSON.stringify(err).toLowerCase();
    underAllowed = !msg.includes("policy");
    console.log(
      underAllowed
        ? "     ✓ allowed by policy (failed later — funding/gas, expected)"
        : "     ✗ REFUSED BY POLICY — the cap is wrong or the field name is",
    );
    show("detail:", err);
    console.log("");
  }

  // 0.5 — over the cap. This is the finding.
  console.log(`0.5  over cap   (900 USDC > ${CAP_HUMAN})…`);
  let overRefused = false;
  try {
    const res = await send(OVER);
    console.log(`     ✗ ALLOWED — broadcast ${res.hash}`);
    console.log("       The enclave did NOT enforce the calldata cap.\n");
  } catch (err) {
    overRefused = true;
    console.log("     ✓ refused");
    show("detail:", err);
    console.log("");
  }

  console.log("── Verdict ────────────────────────────────────────");
  if (underAllowed && overRefused) {
    console.log("HARD CAPS CONFIRMED. Privy enforces the calldata amount cap.");
    console.log("PRD §5 stands: per-tx caps are enclave-enforced.");
  } else if (!overRefused) {
    console.log("HARD CAPS UNAVAILABLE via calldata conditions.");
    console.log("Move per-tx caps to the app layer and redraw PRD §5.");
    console.log("The contract allowlist (0.3, field `to`) still holds.");
  } else {
    console.log("INCONCLUSIVE — the under-cap call was refused too.");
    console.log("Likely the `field` name or ABI shape. Read 0.4 above.");
  }
  console.log(`\npolicy ${policy.id}\nwallet ${wallet.id}\n`);
}

main().catch((err) => {
  console.error("\nSpike failed before reaching a verdict:");
  show("", err);
  process.exit(1);
});
