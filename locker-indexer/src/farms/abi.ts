// Minimal ABIs the farms indexer reads on-chain.
//
// Lifted verbatim from the frontend authoritative source
// (apps/web/src/terminal/farms/abis.ts) — the exact signatures of the deployed
// StakingRewardsFactory + StakingRewards (a 0.8 port of Synthetix StakingRewards).
// `getRewardForDuration()` (= rewardRate × rewardsDuration = the total reward
// budget for the active period) is added here because the indexer surfaces it.
//
// - StakingRewardsFactory: allFarms() / farmsLength() / farmAt(i) — the
//   creation-ordered registry of every child this factory deployed.
// - StakingRewards (child): stakingToken/rewardsToken/totalSupply/rewardRate/
//   rewardsDuration/periodFinish/getRewardForDuration views.
// - ERC-20: symbol()/decimals() (tolerant reads for the two farm tokens).

export const STAKING_REWARDS_FACTORY_ABI = [
  {
    type: "function",
    name: "allFarms",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "farmsLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "farmAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

export const STAKING_REWARDS_ABI = [
  {
    type: "function",
    name: "stakingToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "rewardsToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "rewardRate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "rewardsDuration",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "periodFinish",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getRewardForDuration",
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
