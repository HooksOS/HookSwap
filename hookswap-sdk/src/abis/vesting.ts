/**
 * Minimal write-op ABI fragments for the HookSwap vesting contracts, mirrored from
 * apps/web/src/terminal/vesting/abis.ts. Used by the (stubbed) vesting write module as the
 * concrete target for the TODO wiring — the read side is served by `data.vesting()`.
 *
 *   HookSwapVestingManager — `createVesting(token, beneficiary, amount, startTime, cliffDuration, duration)`.
 *   HookSwapVesting (child) — `release()`.
 */
export const VestingManagerABI = [
  {
    name: 'createVesting',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'beneficiary', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'startTime', type: 'uint256' },
      { name: 'cliffDuration', type: 'uint256' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: 'child', type: 'address' }],
  },
  {
    name: 'vestingFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const VestingChildABI = [
  { name: 'release', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const
