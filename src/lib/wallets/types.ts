/**
 * The seam between Rolebound and whatever holds a role's keys.
 *
 * There is exactly one implementation that matters — Privy server wallets,
 * which is what the enclave-enforced caps depend on. The local one exists so
 * the payment pipeline can be tested against Anvil, and is fenced off from
 * any chain but Anvil in `wallets/index.ts`.
 */
export interface ProvisionedWallet {
  walletId: string;
  address: `0x${string}`;
  /** Privy policy backing the hard caps. Absent for the treasury and locally. */
  policyId?: string;
}

export interface RoleWalletSpec {
  roleName: string;
  /** Per-transaction ceiling in token base units. */
  capPerTx: bigint;
  /** When non-empty, the only addresses this role may pay. */
  allowedRecipients: string[];
}

export interface SendRequest {
  /** Identifies the wallet to the backend that holds it. */
  walletId: string;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
}

export interface WalletBackend {
  readonly kind: "privy" | "local";
  provisionRoleWallet(spec: RoleWalletSpec): Promise<ProvisionedWallet>;
  provisionTreasuryWallet(orgName: string): Promise<ProvisionedWallet>;
  /** Resolves to the transaction hash. Throws if the backend refuses to sign. */
  send(request: SendRequest): Promise<`0x${string}`>;
}
