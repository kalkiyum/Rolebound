import "server-only";
import { PrivyClient } from "@privy-io/node";
import type { PolicyCondition } from "@privy-io/node/resources";
import { env } from "../env";

/**
 * Cached on globalThis for the same reason the database client is: Next's
 * dev server re-evaluates modules on every hot reload.
 */
const globalForPrivy = globalThis as unknown as { rbPrivy?: PrivyClient };

export function privy(): PrivyClient {
  globalForPrivy.rbPrivy ??= new PrivyClient({
    appId: env.privyAppId,
    appSecret: env.privyAppSecret,
  });
  return globalForPrivy.rbPrivy;
}

/**
 * The two calldata shapes a role wallet is ever allowed to produce. Privy
 * decodes calldata against these to read argument values out of a
 * transaction, so the names here must match the deployed contracts, and the
 * `field` that references one is written `functionName.argumentName` — the
 * API rejects a bare argument name at policy creation.
 */
const PAY_ABI = [
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roleId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "reasonHash", type: "bytes32" },
      { name: "actor", type: "address" },
    ],
    outputs: [],
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

import type {
  ProvisionedWallet,
  RoleWalletSpec,
  SendRequest,
  WalletBackend,
} from "./types";

/**
 * Creates the policy that *is* the role's hard limit, then a wallet bound to
 * it. Order matters: a wallet must never exist unbound, even briefly, or
 * there is a window in which it can sign anything.
 *
 * Privy allows at most one policy per wallet, so every rule for a role lives
 * in this single policy. Rules are ALLOW-only and unmatched transactions are
 * refused by the enclave — `pnpm spike:policy` proved that against a live app.
 *
 * WHAT THAT SPIKE ALSO PROVED (2026-09-10): only the *transaction-level*
 * conditions are enforced. A calldata condition is accepted at creation and
 * then ignored at signing time — an over-cap `amount` and an off-allowlist
 * recipient were both signed by a wallet whose policy forbade them. So the
 * contract allowlist below is the hard limit; the calldata conditions are
 * kept because they cost nothing and become real the day Privy enforces
 * them, but NOTHING may depend on them. The per-transaction cap and the
 * recipient allowlist are enforced by `assertCanSpend()`. See PRD §5.
 */
async function provisionRoleWallet(
  spec: RoleWalletSpec,
): Promise<ProvisionedWallet> {
  const client = privy();

  const payConditions: PolicyCondition[] = [
    {
      field_source: "ethereum_transaction",
      field: "to",
      operator: "eq",
      value: env.payAddress.toLowerCase(),
    },
    {
      field_source: "ethereum_calldata",
      field: "pay.amount",
      abi: PAY_ABI,
      operator: "lte",
      value: spec.capPerTx.toString(),
    },
  ];

  if (spec.allowedRecipients.length > 0) {
    payConditions.push({
      field_source: "ethereum_calldata",
      field: "pay.to",
      abi: PAY_ABI,
      operator: "in",
      value: spec.allowedRecipients.map((a) => a.toLowerCase()),
    });
  }

  const policy = await client.policies().create({
    version: "1.0",
    chain_type: "ethereum",
    name: `rolebound:${spec.roleName}`.slice(0, 64),
    rules: [
      {
        name: "pay-within-cap",
        method: "eth_sendTransaction",
        action: "ALLOW",
        conditions: payConditions,
      },
      {
        // RoleboundPay moves funds with transferFrom, so the role wallet has
        // to approve it once. Narrowed to that one spender: an approval to
        // anyone else is not a payment, it is a way around the cap.
        name: "approve-pay-contract-only",
        method: "eth_sendTransaction",
        action: "ALLOW",
        conditions: [
          {
            field_source: "ethereum_transaction",
            field: "to",
            operator: "eq",
            value: env.usdc.toLowerCase(),
          },
          {
            field_source: "ethereum_calldata",
            field: "approve.spender",
            abi: ERC20_APPROVE_ABI,
            operator: "eq",
            value: env.payAddress.toLowerCase(),
          },
        ],
      },
    ],
  });

  const wallet = await client.wallets().create({
    chain_type: "ethereum",
    display_name: `Rolebound · ${spec.roleName}`.slice(0, 64),
    policy_ids: [policy.id],
  });

  return {
    walletId: wallet.id,
    address: wallet.address as `0x${string}`,
    policyId: policy.id,
  };
}

/**
 * The treasury holds the org's funds and is deliberately policy-free: it is
 * the source roles are funded *from*, and its own controls are the org
 * owner's problem, not ours. Rolebound never claims to be its custodian.
 */
async function provisionTreasuryWallet(
  orgName: string,
): Promise<ProvisionedWallet> {
  const wallet = await privy().wallets().create({
    chain_type: "ethereum",
    display_name: `Rolebound Treasury · ${orgName}`.slice(0, 64),
  });
  return { walletId: wallet.id, address: wallet.address as `0x${string}` };
}

/**
 * Releases a signature from the enclave. If the transaction violates the
 * role's policy this throws — and that refusal is the product's hard limit
 * doing its job, not an error to paper over. Callers surface it as a block.
 */
async function send(request: SendRequest): Promise<`0x${string}`> {
  const result = await privy()
    .wallets()
    .ethereum()
    .sendTransaction(request.walletId, {
      caip2: env.caip2,
      params: {
        transaction: {
          to: request.to,
          data: request.data,
          value: request.value !== undefined ? `0x${request.value.toString(16)}` : undefined,
        },
      },
    });
  return result.hash as `0x${string}`;
}

export const privyBackend: WalletBackend = {
  kind: "privy",
  provisionRoleWallet,
  provisionTreasuryWallet,
  send,
};
