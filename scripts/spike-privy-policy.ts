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
 * READ THIS BEFORE TRUSTING THE OUTPUT: an unfunded wallet makes every
 * outcome look like a failure. A transaction the policy ALLOWED and the
 * chain then reverted returns an error too, and an earlier version of this
 * script counted that as a refusal and printed a false confirmation. So
 * every result is classified by *why* it failed, and the run includes a
 * control that must be denied. If the control is not denied, the policy is
 * not being enforced and nothing else in the run means anything.
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

/** Not on the allowlist. Any call here must be refused, whatever the amount. */
const OTHER_CONTRACT = "0x00000000000000000000000000000000DeaDBeef";

/**
 * Parameter NAMES here are ours to choose — the selector for
 * transfer(address,uint256) is fixed regardless — and the policy engine
 * decodes calldata using this ABI. Privy addresses the decoded argument as
 * `functionName.argumentName`, so the field below is `transfer.amount`.
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

type Outcome =
  /** Signed and broadcast. The policy permitted it. */
  | { kind: "allowed"; hash: string }
  /** The policy permitted it; the chain rejected it (funding, gas, revert). */
  | { kind: "allowed_then_reverted"; detail: string }
  /** The enclave refused to sign. */
  | { kind: "denied"; detail: string }
  /** Something else broke — a bad request, auth, network. */
  | { kind: "error"; detail: string };

/**
 * The whole spike turns on telling "denied" apart from "reverted", so the
 * classification is explicit rather than a catch-all. A broadcast failure is
 * proof of the OPPOSITE of denial: to revert on chain, it had to be signed.
 */
function classify(err: unknown): Outcome {
  const e = err as { status?: number; error?: { code?: string; error?: string }; message?: string };
  const code = e?.error?.code ?? "";
  const text = `${e?.message ?? ""} ${JSON.stringify(e?.error ?? {})}`.toLowerCase();
  const detail = `status ${e?.status ?? "?"} · ${code || "(no code)"} · ${e?.message ?? String(err)}`;

  if (code === "transaction_broadcast_failure") {
    return { kind: "allowed_then_reverted", detail };
  }
  if (
    code.includes("polic") ||
    text.includes("policy") ||
    text.includes("denied") ||
    text.includes("not allowed") ||
    e?.status === 403
  ) {
    return { kind: "denied", detail };
  }
  return { kind: "error", detail };
}

const LABEL: Record<Outcome["kind"], string> = {
  allowed: "ALLOWED (broadcast)",
  allowed_then_reverted: "ALLOWED by policy, reverted on chain",
  denied: "DENIED by policy",
  error: "UNCLASSIFIED",
};

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
            field: "transfer.amount",
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
  const created = await privy.wallets().create({
    chain_type: "ethereum",
    policy_ids: [policy.id],
  });
  console.log(`     wallet ${created.id}`);
  console.log(`     address ${created.address}`);

  // Attachment is an assumption until the API says so. If policy_ids comes
  // back empty, every send below is unpoliced and the run proves nothing.
  const wallet = await privy.wallets().get(created.id);
  const attached = (wallet as { policy_ids?: string[] }).policy_ids ?? [];
  console.log(`     policy_ids on wallet: ${JSON.stringify(attached)}`);
  if (!attached.includes(policy.id)) {
    console.log("\n✗ Policy is NOT attached to the wallet. Nothing below is meaningful.\n");
    process.exit(1);
  }
  console.log("");

  const send = async (to: string, amount: bigint): Promise<Outcome> => {
    try {
      const res = await privy
        .wallets()
        .ethereum()
        .sendTransaction(created.id, {
          caip2: CAIP2 as never,
          params: {
            transaction: {
              to: to as `0x${string}`,
              data: encodeFunctionData({
                abi: TRANSFER_ABI,
                functionName: "transfer",
                args: [RECIPIENT, amount],
              }),
            },
          },
        } as never);
      return { kind: "allowed", hash: (res as { hash: string }).hash };
    } catch (err) {
      return classify(err);
    }
  };

  const report = (step: string, o: Outcome) => {
    console.log(`${step}  → ${LABEL[o.kind]}`);
    console.log(`     ${o.kind === "allowed" ? o.hash : o.detail}\n`);
  };

  // CONTROL — a contract that is not on the allowlist. If this is not
  // denied, the policy is not being enforced and the cap result is noise.
  console.log("CTRL  transfer to a NON-allowlisted contract (must be denied)…");
  const control = await send(OTHER_CONTRACT, UNDER);
  report("     ", control);

  // 0.4 — under the cap. Reverting on chain is fine: it proves it was signed.
  console.log(`0.4  under cap  (100 USDC ≤ ${CAP_HUMAN})…`);
  const under = await send(usdc, UNDER);
  report("     ", under);

  // 0.5 — over the cap. This is the finding.
  console.log(`0.5  over cap   (900 USDC > ${CAP_HUMAN})…`);
  const over = await send(usdc, OVER);
  report("     ", over);

  const permitted = (o: Outcome) =>
    o.kind === "allowed" || o.kind === "allowed_then_reverted";

  console.log("── Verdict ────────────────────────────────────────");
  if (control.kind !== "denied") {
    console.log("INCONCLUSIVE — the control was not denied.");
    console.log("The policy is attached but is not refusing an off-allowlist");
    console.log("contract, so it is not gating this wallet at all. Fix that");
    console.log("before reading anything into 0.4 and 0.5.");
  } else if (permitted(under) && over.kind === "denied") {
    console.log("HARD CAPS CONFIRMED. Privy enforces the calldata amount cap.");
    console.log("PRD §5 stands: per-tx caps are enclave-enforced.");
  } else if (permitted(under) && permitted(over)) {
    console.log("HARD CAPS UNAVAILABLE via calldata conditions.");
    console.log("The allowlist holds (the control was denied) but the amount");
    console.log("condition did not stop an over-cap transfer.");
    console.log("Move per-tx caps to the app layer and redraw PRD §5.");
  } else if (under.kind === "denied") {
    console.log("INCONCLUSIVE — the under-cap call was denied too.");
    console.log("Likely the field name or ABI shape, not the cap mechanism.");
  } else {
    console.log("INCONCLUSIVE — unclassified outcome. Read the detail above.");
  }
  console.log(`\npolicy ${policy.id}\nwallet ${created.id}\n`);
}

main().catch((err) => {
  const e = err as { status?: number; message?: string; error?: unknown };
  console.error("\nSpike failed before reaching a verdict:");
  console.error(`  status:  ${e?.status ?? "(none)"}`);
  console.error(`  message: ${e?.message ?? String(err)}`);
  if (e?.error) console.error(`  body:    ${JSON.stringify(e.error)}`);
  process.exit(1);
});
