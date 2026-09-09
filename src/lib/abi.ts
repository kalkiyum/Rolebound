/**
 * The app's view of the contracts.
 *
 * Hand-written rather than imported from `contracts/out/`, which is a build
 * artifact and gitignored — the Next build must not depend on Foundry having
 * run. `abi.test.ts` asserts these match the compiled output, so drift is a
 * failing test rather than a malformed transaction.
 */
export const roleboundPayAbi = [
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
  {
    type: "event",
    name: "Payment",
    anonymous: false,
    inputs: [
      { name: "roleId", type: "bytes32", indexed: true },
      { name: "roleWallet", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "reasonHash", type: "bytes32", indexed: false },
      { name: "actor", type: "address", indexed: false },
    ],
  },
] as const;

export const erc20Abi = [
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
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
