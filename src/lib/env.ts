/**
 * Environment access in one place, so a missing variable fails with a
 * sentence a human can act on instead of `undefined` surfacing three
 * layers deeper as a cryptic SDK error.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — see .env.example`);
  return v;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get privyAppId() {
    return required("NEXT_PUBLIC_PRIVY_APP_ID");
  },
  get privyAppSecret() {
    return required("PRIVY_APP_SECRET");
  },
  get privyAuthorizationKey() {
    return process.env.PRIVY_AUTHORIZATION_KEY;
  },
  get chainId() {
    return Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 84532);
  },
  /** CAIP-2 is how Privy names the chain on every wallet call. */
  get caip2(): `eip155:${string}` {
    return `eip155:${this.chainId}`;
  },
  get rpcUrl() {
    return process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";
  },
  get usdc() {
    return required("NEXT_PUBLIC_USDC_ADDRESS") as `0x${string}`;
  },
  get payAddress() {
    return required("NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS") as `0x${string}`;
  },
};
