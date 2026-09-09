import { keccak256, toHex } from "viem";

/**
 * The onchain identity of a role. Our roles are database UUIDs and the event
 * indexes a bytes32, so the mapping has to be deterministic and one-way —
 * anyone reading the chain can confirm a payment belongs to a role they know
 * the id of, without us publishing a list of every role we have.
 */
export function roleIdToBytes32(roleId: string): `0x${string}` {
  return keccak256(toHex(roleId));
}
