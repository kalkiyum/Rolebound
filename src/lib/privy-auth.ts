import "server-only";
import { cookies } from "next/headers";
import { createRemoteJWKSet } from "jose";
import { verifyAccessToken } from "@privy-io/node";
import { env } from "./env";
import { privy } from "./wallets/privy";

/**
 * Server-side proof of who is asking.
 *
 * The browser holds a Privy access token; this verifies it against Privy's
 * published keys before anything downstream treats it as an identity. The
 * client is never asked who it is — it presents a token, and the signature
 * on that token is what we believe. A client-supplied user id or wallet
 * address would be a request to be trusted, which is not the same thing.
 */

/** Privy sets this on the app's own domain when the user logs in. */
const TOKEN_COOKIE = "privy-token";

/**
 * Cached because it fetches over the network and the keys rarely rotate.
 * `createRemoteJWKSet` handles refresh on an unknown key id itself.
 */
const globalForJwks = globalThis as unknown as {
  rbJwks?: ReturnType<typeof createRemoteJWKSet>;
};

function jwks() {
  globalForJwks.rbJwks ??= createRemoteJWKSet(
    new URL(`https://auth.privy.io/api/v1/apps/${env.privyAppId}/jwks.json`),
  );
  return globalForJwks.rbJwks;
}

/**
 * The authenticated Privy user id, or null. Never throws on a bad token:
 * an expired or forged one is simply not a session, and every caller
 * renders the signed-out state rather than an error page.
 */
export async function verifiedPrivyUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(TOKEN_COOKIE)?.value;
  if (!token) return null;

  try {
    const claims = await verifyAccessToken({
      access_token: token,
      app_id: env.privyAppId,
      verification_key: jwks(),
    });
    return claims.user_id;
  } catch {
    return null;
  }
}

/**
 * The user's embedded wallet address, read from Privy rather than from the
 * browser. This address is what every payment justification is verified
 * against, so taking the client's word for it would let a caller nominate
 * the key that "signed" their reason.
 */
export async function embeddedWalletAddress(
  privyUserId: string,
): Promise<`0x${string}` | null> {
  // `_get` is the SDK's underscore-prefixed accessor for fetching one user;
  // there is no unprefixed equivalent in this version.
  const user = await privy().users()._get(privyUserId);

  const wallet = user.linked_accounts.find(
    (account): account is typeof account & { address: string } =>
      account.type === "wallet" &&
      "chain_type" in account &&
      account.chain_type === "ethereum" &&
      "wallet_client_type" in account &&
      account.wallet_client_type === "privy",
  );

  return (wallet?.address as `0x${string}`) ?? null;
}
