// Minimal ABIs the launchpad indexer reads on-chain.
//
// Lifted verbatim from the frontend authoritative source
// (apps/web/src/terminal/launchpad/abis.ts) — the exact signatures of the deployed
// HookOSV3Launcher + HookOSV3FeeVault proxies on Robinhood (4663). Only the
// enumeration + enrichment views the indexer reads are included.
//
// - HookOSV3Launcher: launchCount() → number of launches; getLaunch(id) → the
//   launch struct; getLaunchByToken(token) → same struct keyed by token.
// - HookOSV3FeeVault: isPermanentlyLocked(token) → (locked, unlockTime).
// - ERC-20: name()/symbol()/decimals()/totalSupply() (the struct carries neither
//   name nor symbol, so the token is enriched directly).

/** The launch struct returned by getLaunch(id) / getLaunchByToken(token). */
const LAUNCH_STRUCT = {
  type: "tuple",
  components: [
    { name: "token", type: "address" },
    { name: "pool", type: "address" },
    { name: "creator", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "feeTier", type: "uint24" },
    { name: "dex", type: "uint8" },
    { name: "locker", type: "address" },
    { name: "pair", type: "uint8" },
    { name: "pairToken", type: "address" },
    { name: "metadataURI", type: "string" },
    { name: "createdAt", type: "uint256" },
  ],
} as const;

export const LAUNCHER_ABI = [
  {
    type: "function",
    name: "launchCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getLaunch",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [LAUNCH_STRUCT],
  },
  {
    type: "function",
    name: "getLaunchByToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [LAUNCH_STRUCT],
  },
  {
    type: "function",
    name: "launchIdOf",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "launchId", type: "uint256" }],
  },
] as const;

export const FEEVAULT_ABI = [
  {
    type: "function",
    name: "isPermanentlyLocked",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "locked", type: "bool" },
      { name: "unlockTime", type: "uint40" },
    ],
  },
] as const;

export const ERC20_FULL_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
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
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
