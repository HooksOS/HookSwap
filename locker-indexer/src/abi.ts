// Minimal ABIs the indexer reads on-chain.
//
// - HookSwapTokenLockerManager: total-lock count + per-lock data + LP data
//   (see contracts/locker/HookSwapTokenLockerManager.sol — ids are uint40).
// - ERC-20: symbol()/decimals() (tolerant reads; some tokens omit/revert these).

export const LOCKER_MANAGER_ABI = [
  {
    type: "function",
    name: "tokenLockerCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint40" }],
  },
  {
    type: "function",
    name: "getTokenLockData",
    stateMutability: "view",
    inputs: [{ name: "id_", type: "uint40" }],
    outputs: [
      { name: "isLpToken", type: "bool" },
      { name: "id", type: "uint40" },
      { name: "contractAddress", type: "address" },
      { name: "lockOwner", type: "address" },
      { name: "token", type: "address" },
      { name: "createdBy", type: "address" },
      { name: "createdAt", type: "uint40" },
      { name: "unlockTime", type: "uint40" },
      { name: "balance", type: "uint256" },
      { name: "totalSupply", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getLpData",
    stateMutability: "view",
    inputs: [{ name: "id_", type: "uint40" }],
    outputs: [
      { name: "hasLpData", type: "bool" },
      { name: "id", type: "uint40" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "balance0", type: "uint256" },
      { name: "balance1", type: "uint256" },
      { name: "price0", type: "uint256" },
      { name: "price1", type: "uint256" },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
