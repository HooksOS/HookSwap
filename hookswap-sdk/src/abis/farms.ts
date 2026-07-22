/**
 * Minimal write-op ABI fragments for the HookSwap farms contracts, mirrored from
 * apps/web/src/terminal/farms/abis.ts. Used by the (stubbed) farms write module as the
 * concrete target for the TODO wiring — the read side is served by `data.farms()`.
 *
 *   StakingRewardsFactory — `createAndFund(stakingToken, rewardToken, rewardAmount, duration)`.
 *   StakingRewards (child) — `stake`, `withdraw`, `getReward`, `exit`.
 */
export const StakingRewardsFactoryABI = [
  {
    name: 'createAndFund',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'stakingToken', type: 'address' },
      { name: 'rewardToken', type: 'address' },
      { name: 'rewardAmount', type: 'uint256' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: 'farm', type: 'address' }],
  },
] as const

export const StakingRewardsABI = [
  {
    name: 'stake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  { name: 'getReward', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'exit', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const
