/**
 * Minimal write-op ABI fragments for the HookSwap locker contracts, mirrored from
 * apps/web/src/terminal/lockers/abis.ts. Used by the (stubbed) locker write module as
 * the concrete target for the TODO wiring — the read side is served by `data.locks()`.
 *
 *   HookSwapTokenLockerManager  — ERC-20 + Uniswap-V2 LP locks (`lock`, `extend`, `deposit`).
 *   HookSwapV3PositionLocker    — Uniswap v3 position-NFT locks (`lock`, `collectFees`).
 */
export const TokenLockerManagerABI = [
  {
    name: 'lock',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'unlockTime', type: 'uint256' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'lockId', type: 'uint256' }],
  },
  {
    name: 'extend',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'lockId', type: 'uint256' },
      { name: 'newUnlockTime', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'lockFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const V3PositionLockerABI = [
  {
    name: 'lock',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'unlockTime', type: 'uint256' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'lockId', type: 'uint256' }],
  },
  {
    name: 'collectFees',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [],
  },
] as const
