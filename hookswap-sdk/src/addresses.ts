/**
 * Deployed self-service-suite contract addresses for the HookSwap chains, mirrored from the
 * Terminal's config files (single source of truth; keep in sync):
 *   apps/web/src/terminal/lockers/addresses.ts
 *   apps/web/src/terminal/farms/addresses.ts
 *   apps/web/src/terminal/vesting/addresses.ts
 *
 * FACTS-ONLY: these are REAL deployed HookSwapTokenLockerManager / HookSwapV3PositionLocker /
 * StakingRewardsFactory / HookSwapVestingManager contracts. A chain with no entry has no such
 * contract deployed yet — the write modules surface an honest "not deployed" error, never a
 * fabricated address.
 */
import { HOOKSWAP_CHAIN_IDS } from './chains.js'

export interface LockerAddresses {
  /** HookSwapTokenLockerManager — ERC-20 + Uniswap-V2 LP locks. */
  tokenLockerManager?: string
  /** HookSwapV3PositionLocker — Uniswap v3 position-NFT locks. */
  v3PositionLocker?: string
}

export const LOCKER_ADDRESSES: Record<number, LockerAddresses> = {
  [HOOKSWAP_CHAIN_IDS.HyperEvm]: {
    tokenLockerManager: '0x7EFFe9DD68035f43ad43aE6C31bc1a47Ab4579D0',
    v3PositionLocker: '0xD08E609277eCB0B7E2eF15dF5C1Fb11436627a63',
  },
  [HOOKSWAP_CHAIN_IDS.Ink]: {
    tokenLockerManager: '0x86426094d82bC1fd40F0901965b23D30837Dc66b',
    v3PositionLocker: '0xB5A7BF488f2407479E116f713f116546F67c803b',
  },
  [HOOKSWAP_CHAIN_IDS.MegaETH]: {
    tokenLockerManager: '0x35dB40f22143651159056285E92c113ECE65E7e2',
    v3PositionLocker: '0x86426094d82bC1fd40F0901965b23D30837Dc66b',
  },
  [HOOKSWAP_CHAIN_IDS.XLayer]: {
    tokenLockerManager: '0x35dB40f22143651159056285E92c113ECE65E7e2',
    v3PositionLocker: '0x86426094d82bC1fd40F0901965b23D30837Dc66b',
  },
  [HOOKSWAP_CHAIN_IDS.Robinhood]: {
    tokenLockerManager: '0x35dB40f22143651159056285E92c113ECE65E7e2',
    v3PositionLocker: '0x86426094d82bC1fd40F0901965b23D30837Dc66b',
  },
  [HOOKSWAP_CHAIN_IDS.Tempo]: {
    tokenLockerManager: '0x86426094d82bC1fd40F0901965b23D30837Dc66b',
    v3PositionLocker: '0xB5A7BF488f2407479E116f713f116546F67c803b',
  },
  [HOOKSWAP_CHAIN_IDS.Sepolia]: {
    tokenLockerManager: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
    v3PositionLocker: '0xAB34Bb3767020059A35e71D03f13E9e4fbCD07aC',
  },
  [HOOKSWAP_CHAIN_IDS.Stable]: {
    tokenLockerManager: '0x250c3448278f7b71e3e9b641f2efeb6074820e25',
    v3PositionLocker: '0x144331bb4c3026d135896cafec3ae3d667f4f376',
  },
}

/** StakingRewardsFactory per chain. */
export const FARM_FACTORY_ADDRESSES: Record<number, string> = {
  [HOOKSWAP_CHAIN_IDS.Robinhood]: '0x8d26aa9d0556fd1483ad630fe9f6e21c168f2e33',
  [HOOKSWAP_CHAIN_IDS.HyperEvm]: '0x8d26aa9d0556fd1483ad630fe9f6e21c168f2e33',
  [HOOKSWAP_CHAIN_IDS.XLayer]: '0x7f91048007b653b088282a73d180541f9c228677',
  [HOOKSWAP_CHAIN_IDS.MegaETH]: '0xd9d4795f2a12305a12c36455adad011f2d6143ab',
  [HOOKSWAP_CHAIN_IDS.Ink]: '0x144331bb4c3026d135896cafec3ae3d667f4f376',
  [HOOKSWAP_CHAIN_IDS.Tempo]: '0x250c3448278f7b71e3e9b641f2efeb6074820e25',
  [HOOKSWAP_CHAIN_IDS.Stable]: '0x0e88a920a522d2e858b5fb0e896f228f4619e0a6',
}

/** HookSwapVestingManager per chain. */
export const VESTING_ADDRESSES: Record<number, string> = {
  [HOOKSWAP_CHAIN_IDS.Robinhood]: '0x7f91048007b653b088282a73d180541f9c228677',
  [HOOKSWAP_CHAIN_IDS.HyperEvm]: '0x7f91048007b653b088282a73d180541f9c228677',
  [HOOKSWAP_CHAIN_IDS.XLayer]: '0xb8b8e647259d5de25754278878893456c72c2a56',
  [HOOKSWAP_CHAIN_IDS.MegaETH]: '0x7effe9dd68035f43ad43ae6c31bc1a47ab4579d0',
  [HOOKSWAP_CHAIN_IDS.Ink]: '0x250c3448278f7b71e3e9b641f2efeb6074820e25',
  [HOOKSWAP_CHAIN_IDS.Tempo]: '0xd08e609277ecb0b7e2ef15df5c1fb11436627a63',
  [HOOKSWAP_CHAIN_IDS.Stable]: '0xb5a7bf488f2407479e116f713f116546f67c803b',
}

export function getLockerAddresses(chainId?: number): LockerAddresses | undefined {
  return chainId === undefined ? undefined : LOCKER_ADDRESSES[chainId]
}

export function getFarmFactory(chainId?: number): string | undefined {
  return chainId === undefined ? undefined : FARM_FACTORY_ADDRESSES[chainId]
}

export function getVestingAddress(chainId?: number): string | undefined {
  return chainId === undefined ? undefined : VESTING_ADDRESSES[chainId]
}
