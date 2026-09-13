import { keccak256, recoverTypedDataAddress, toBytes, type TypedDataDomain } from "viem";
import { env } from "./env";

/**
 * What an actor signs before a role wallet will move money.
 *
 * The role wallet's key never leaves the enclave, so a signature from it says
 * nothing about *who* asked. This one does: it binds a named member to this
 * exact amount, recipient and justification. Without it, "the Marketing role
 * paid a vendor" is the most an audit can ever establish.
 *
 * The reason is committed as a hash, so the signature covers the
 * justification without the plaintext ever leaving the app.
 */
export const AUTHORIZATION_TYPES = {
  PaymentAuthorization: [
    { name: "roleId", type: "bytes32" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "reasonHash", type: "bytes32" },
    { name: "nonce", type: "string" },
  ],
} as const;

export interface PaymentAuthorization {
  roleId: `0x${string}`;
  to: `0x${string}`;
  amount: bigint;
  reasonHash: `0x${string}`;
  nonce: string;
}

export function authorizationDomain(): TypedDataDomain {
  return {
    name: "Rolebound",
    version: "1",
    chainId: env.chainId,
    verifyingContract: env.payAddress,
  };
}

/** The commitment that goes onchain. Plaintext stays in our database. */
export function hashReason(reason: string): `0x${string}` {
  return keccak256(toBytes(reason.trim()));
}

export class AuthorizationInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationInvalid";
  }
}

/**
 * Recovers the signer and checks it is the member we think authorized this.
 * A mismatch is a refusal, never a warning — an unverified authorization on
 * an audit trail is worse than none, because it looks like proof.
 */
export async function verifyAuthorization(input: {
  authorization: PaymentAuthorization;
  signature: `0x${string}`;
  expectedSigner: string;
}): Promise<void> {
  let recovered: string;
  try {
    recovered = await recoverTypedDataAddress({
      domain: authorizationDomain(),
      types: AUTHORIZATION_TYPES,
      primaryType: "PaymentAuthorization",
      message: input.authorization,
      signature: input.signature,
    });
  } catch (cause) {
    throw new AuthorizationInvalid(
      `Signature could not be recovered: ${String(cause)}`,
    );
  }

  if (recovered.toLowerCase() !== input.expectedSigner.toLowerCase()) {
    throw new AuthorizationInvalid(
      `Signed by ${recovered}, but the request claims ${input.expectedSigner}`,
    );
  }
}
