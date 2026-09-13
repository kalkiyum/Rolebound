import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../env";
import type {
  ProvisionedWallet,
  RoleWalletSpec,
  SendRequest,
  WalletBackend,
} from "./types";

/**
 * Anvil-only wallet backend.
 *
 * Keys are derived deterministically from the role name, so a wallet id is
 * all the state needed to sign again — no key storage, no fixtures to keep in
 * sync. That is only acceptable because these keys can never hold anything:
 * `wallets/index.ts` refuses to select this backend off chain 31337.
 *
 * It enforces NO caps. Every hard limit in this product lives in the Privy
 * policy, and this backend is not a stand-in for that — the enclave refusal
 * is a property only a real Privy run can demonstrate.
 */
const LOCAL_CHAIN_ID = 31337;

const chain = () =>
  defineChain({
    id: LOCAL_CHAIN_ID,
    name: "Anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [env.rpcUrl] } },
  });

/** `local:<privateKey>` — the id carries the key because nothing else can. */
function keyForRole(roleName: string): `0x${string}` {
  return keccak256(toHex(`rolebound:local:${roleName}`));
}

function accountFrom(walletId: string) {
  const key = walletId.replace(/^local:/, "") as `0x${string}`;
  return privateKeyToAccount(key);
}

async function provision(name: string): Promise<ProvisionedWallet> {
  const key = keyForRole(name);
  const account = privateKeyToAccount(key);
  return { walletId: `local:${key}`, address: account.address };
}

export const localBackend: WalletBackend = {
  kind: "local",

  async provisionRoleWallet(spec: RoleWalletSpec) {
    return provision(spec.roleName);
  },

  async provisionTreasuryWallet(orgName: string) {
    return provision(`treasury:${orgName}`);
  },

  async send(request: SendRequest) {
    const account = accountFrom(request.walletId);
    const wallet = createWalletClient({
      account,
      chain: chain(),
      transport: http(env.rpcUrl),
    });
    const publicClient = createPublicClient({
      chain: chain(),
      transport: http(env.rpcUrl),
    });

    // Anvil accounts start funded, but a freshly derived role key does not.
    // Top it up rather than failing on gas, which would look like a policy
    // refusal and send whoever is debugging in the wrong direction.
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance === 0n) {
      await fundFromAnvilFaucet(account.address);
    }

    return wallet.sendTransaction({
      to: request.to,
      data: request.data,
      value: request.value ?? 0n,
    });
  },
};

/** Anvil's first prefunded account, by its well-known deterministic key. */
const ANVIL_FAUCET_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

async function fundFromAnvilFaucet(to: `0x${string}`) {
  const faucet = createWalletClient({
    account: privateKeyToAccount(ANVIL_FAUCET_KEY),
    chain: chain(),
    transport: http(env.rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: chain(),
    transport: http(env.rpcUrl),
  });
  const hash = await faucet.sendTransaction({
    to,
    value: 10n ** 18n,
  });
  await publicClient.waitForTransactionReceipt({ hash });
}
