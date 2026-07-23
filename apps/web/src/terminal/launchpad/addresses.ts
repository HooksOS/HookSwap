/**
 * HookSwap Terminal — Launchpad contract addresses.
 *
 * HookOSV3Launcher (proxy) — direct-to-v3 fair launch: mints token + seeds
 * single-sided pool + registers the position in the fee vault.
 *
 * HookOSV3FeeVault (proxy) — holds each launch's LP position NFT forever
 * (principal locked), splits LP fees per-dex creator share, carves buyback slice.
 */

import { getHookOSV3Addresses } from '@hookos/sdk'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import type { Address } from '~/chains'

/**
 * Deployed `HookOSV3Launcher` address for a chain, or `undefined` when not deployed.
 * SDK-resolved (never hardcoded) — the fair-launch launcher is live on every HookOS V3 chain.
 */
export function getLaunchpadAddress(chainId?: number): Address | undefined {
  if (chainId === undefined) {
    return undefined
  }
  return getHookOSV3Addresses(chainId)?.launcher as Address | undefined
}

/**
 * Deployed `HookOSV3FeeVault` address for a chain, or `undefined` when not deployed.
 * SDK-resolved from `getHookOSV3Addresses` (the permanent LP custodian is deployed alongside
 * the launcher on every HookOS V3 chain — Base · RH · MegaETH · HyperEVM · BNB · ETH · Stable),
 * so LP-lock verification is multi-chain rather than the old Robinhood-only hardcode.
 */
export function getFeeVaultAddress(chainId?: number): Address | undefined {
  if (chainId === undefined) {
    return undefined
  }
  return getHookOSV3Addresses(chainId)?.feeVault as Address | undefined
}

/**
 * Immutable-custody holders with NO withdraw/transfer/decrease path — an LP position NFT
 * `ownerOf(tokenId)` == one of these is permanently locked BY CUSTODY (verified on-chain,
 * Robinhood 4663). This is a POSITIVE lock signal only — never an override of a genuine
 * `unlocked` reading from a real locker.
 *   - HookOSV3FeeVault  — holds every HookOSV3Launcher launch's v3 position NFT (fees only).
 *   - LPFeeSplitter     — holds the flagship $HOOK (Uniswap v4) position (fees only).
 */
export const RECOGNIZED_LP_CUSTODY_ADDRESSES: Partial<Record<UniverseChainId, Address[]>> = {
  [UniverseChainId.Robinhood]: [
    '0x2974cE6341067398A5C1E6c0C14F99ED1C3122EF', // HookOSV3FeeVault (v3 launches)
    '0xa3df1c2969452ad3F0C3ca041430E2a8EE2ffa80', // LPFeeSplitter (flagship $HOOK, v4)
  ],
}

/** Lowercased custody-allowlist for a chain (empty array when none configured). */
export function getCustodyLockAddresses(chainId?: number): string[] {
  if (chainId === undefined) {
    return []
  }
  const list = RECOGNIZED_LP_CUSTODY_ADDRESSES[chainId as UniverseChainId]
  return list ? list.map((a) => a.toLowerCase()) : []
}

/**
 * LP position-manager (NFT) addresses per launch `dex` enum (Robinhood 4663):
 *   dex 0 = Uniswap V3 NPM · dex 1 = HookSwap NPM
 * `ownerOf(tokenId)` is read on the manager matching the launch's `dex`.
 */
export const LP_POSITION_MANAGERS: Partial<Record<UniverseChainId, Record<number, Address>>> = {
  [UniverseChainId.Robinhood]: {
    0: '0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3', // Uniswap V3 NonfungiblePositionManager
    1: '0xbd817036c5bF69Cb27D3A342129e39f9f908577d', // HookSwap NonfungiblePositionManager
  },
}

/** Position-manager (NFT) address for a chain + launch `dex` enum, or `undefined`. */
export function getPositionManager(chainId?: number, dex?: number): Address | undefined {
  if (chainId === undefined || dex === undefined) {
    return undefined
  }
  return LP_POSITION_MANAGERS[chainId as UniverseChainId]?.[dex]
}
