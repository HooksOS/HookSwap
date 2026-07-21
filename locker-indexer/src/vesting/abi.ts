// Minimal ABIs the vesting indexer reads on-chain.
//
// Lifted verbatim from the frontend authoritative source
// (apps/web/src/terminal/vesting/abis.ts) — the exact signatures of the deployed
// HookSwapVestingManager (enumerable factory + registry) and its per-schedule
// HookSwapVesting child.
//
// - HookSwapVestingManager: vestingCount() → schedule count; getScheduleData(id)
//   → the 10-field schedule tuple (proxies the child's view).
// - HookSwapVesting (child): releasable() → vested-but-unreleased (live claimable).
// - ERC-20: symbol()/decimals() (tolerant reads for the vesting token).

/** Shared 10-field schedule tuple returned by getScheduleData(id). */
const SCHEDULE_DATA_OUTPUTS = [
  { name: "id", type: "uint256" },
  { name: "token", type: "address" },
  { name: "beneficiary", type: "address" },
  { name: "creator", type: "address" },
  { name: "start", type: "uint64" },
  { name: "cliff", type: "uint64" },
  { name: "duration", type: "uint64" },
  { name: "totalAmount", type: "uint256" },
  { name: "released", type: "uint256" },
  { name: "contractAddress", type: "address" },
] as const;

export const VESTING_MANAGER_ABI = [
  {
    type: "function",
    name: "vestingCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getScheduleData",
    stateMutability: "view",
    inputs: [{ name: "id_", type: "uint256" }],
    outputs: SCHEDULE_DATA_OUTPUTS,
  },
] as const;

export const VESTING_CHILD_ABI = [
  {
    type: "function",
    name: "releasable",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const ERC20_META_ABI = [
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
