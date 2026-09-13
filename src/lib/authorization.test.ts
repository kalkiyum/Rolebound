import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { ANVIL_KEYS } from "../../test/chain";
import {
  AUTHORIZATION_TYPES,
  AuthorizationInvalid,
  authorizationDomain,
  hashReason,
  verifyAuthorization,
  type PaymentAuthorization,
} from "./authorization";
import { roleIdToBytes32 } from "./ids";

process.env.NEXT_PUBLIC_CHAIN_ID = "31337";
process.env.NEXT_PUBLIC_ROLEBOUND_PAY_ADDRESS =
  "0x0000000000000000000000000000000000000009";

const alice = privateKeyToAccount(ANVIL_KEYS[0]);
const mallory = privateKeyToAccount(ANVIL_KEYS[1]);

const authorization: PaymentAuthorization = {
  roleId: roleIdToBytes32("a3f1c0de-0000-4000-8000-000000000001"),
  to: getAddress("0x000000000000000000000000000000000000bEEF"),
  amount: 200_000_000n,
  reasonHash: hashReason("Landing page design, invoice #204"),
  nonce: "nonce-1",
};

const sign = (account: typeof alice, message = authorization) =>
  account.signTypedData({
    domain: authorizationDomain(),
    types: AUTHORIZATION_TYPES,
    primaryType: "PaymentAuthorization",
    message,
  });

describe("hashReason", () => {
  it("ignores surrounding whitespace, so the same reason hashes the same", () => {
    expect(hashReason("  invoice #204  ")).toBe(hashReason("invoice #204"));
  });

  it("changes completely when the reason changes", () => {
    expect(hashReason("invoice #204")).not.toBe(hashReason("invoice #205"));
  });
});

describe("verifying an actor's authorization", () => {
  it("accepts a signature from the member who claims it", async () => {
    await expect(
      verifyAuthorization({
        authorization,
        signature: await sign(alice),
        expectedSigner: alice.address,
      }),
    ).resolves.toBeUndefined();
  });

  /** Otherwise anyone could spend under someone else's name. */
  it("refuses a signature from a different member", async () => {
    await expect(
      verifyAuthorization({
        authorization,
        signature: await sign(mallory),
        expectedSigner: alice.address,
      }),
    ).rejects.toBeInstanceOf(AuthorizationInvalid);
  });

  it.each([
    ["amount", { ...authorization, amount: 900_000_000n }],
    ["recipient", { ...authorization, to: getAddress("0x000000000000000000000000000000000000dEaD") }],
    ["reason", { ...authorization, reasonHash: hashReason("something else entirely") }],
  ])("refuses when the %s was changed after signing", async (_field, tampered) => {
    await expect(
      verifyAuthorization({
        authorization: tampered,
        signature: await sign(alice),
        expectedSigner: alice.address,
      }),
    ).rejects.toBeInstanceOf(AuthorizationInvalid);
  });

  it("refuses a malformed signature rather than throwing something opaque", async () => {
    await expect(
      verifyAuthorization({
        authorization,
        signature: "0xdeadbeef",
        expectedSigner: alice.address,
      }),
    ).rejects.toBeInstanceOf(AuthorizationInvalid);
  });
});
