/**
 * HookSwap Terminal — Uniswap-v3 contract addresses for concentrated-liquidity
 * position creation (fee tiers + ranges + NPM mint).
 *
 * FACTS-ONLY: every address is resolved from the workspace-overridden
 * `@uniswap/sdk-core` maps (`vendor/sdk-core`, the package the web app actually
 * imports), NOT guessed:
 *   • `V3_CORE_FACTORY_ADDRESSES[chainId]`               — own v3 factory (Pool.getAddress).
 *   • `NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId]`  — own NPM (mint / createAndInitialize…).
 * These are the REAL deployed HookSwap v3 addresses per chain, sourced from each
 * `contracts/deployments/<chain>.json` and wired into `vendor/sdk-core/src/addresses.ts`
 * (e.g. Robinhood NPM `0xbd817036c5bF69Cb27D3A342129e39f9f908577d` ==
 * robinhood.json). The v3 pool init-code hash is CANONICAL (own stack uses canonical
 * bytecode), so `Pool.getAddress(a, b, fee, undefined, v3Factory)` computes the right
 * address with the SDK's default `POOL_INIT_CODE_HASH`.
 *
 * A chain missing either address (or a zero address) returns `undefined` → the UI
 * renders an honest "v3 isn't available on {chain} yet" state, never fabricated data.
 * This auto-covers every chain sdk-core has wired; no per-chain literal to maintain
 * here (unlike the v2 module, which needs the WETH override anyway).
 */
import {
  NONFUNGIBLE_POSITION_MANAGER_ADDRESSES,
  V3_CORE_FACTORY_ADDRESSES,
} from '@uniswap/sdk-core'
import { WRAPPED_NATIVE_CURRENCY } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getAddress, zeroAddress, type Address } from '~/chains'

export interface V3ContractAddresses {
  /** Own UniswapV3Factory — used by `Pool.getAddress` to derive the pool address. */
  v3Factory: Address
  /** Own NonfungiblePositionManager — approve tokens to this, then `mint`. */
  positionManager: Address
  /** Canonical wrapped-native (WETH-equivalent) for this chain, if any. */
  weth?: Address
}

/** Non-zero, checksummed address or undefined. */
function nonZero(addr?: string): Address | undefined {
  if (!addr || addr.toLowerCase() === zeroAddress) {
    return undefined
  }
  try {
    return getAddress(addr) as Address
  } catch {
    return undefined
  }
}

/**
 * v3 addresses for a chain, or `undefined` when the chain has no v3 stack wired in
 * sdk-core (missing factory OR NPM). Callers treat a missing config as an honest
 * "not available" state and offer a switch to a chain that IS wired.
 */
export function getV3Addresses(chainId?: number): V3ContractAddresses | undefined {
  if (chainId === undefined) {
    return undefined
  }
  const v3Factory = nonZero(V3_CORE_FACTORY_ADDRESSES[chainId as UniverseChainId])
  const positionManager = nonZero(NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId as UniverseChainId])
  if (!v3Factory || !positionManager) {
    return undefined
  }
  const weth = nonZero(WRAPPED_NATIVE_CURRENCY[chainId as UniverseChainId]?.address)
  return { v3Factory, positionManager, weth }
}

/** True when the chain has a full v3 stack (factory + NPM) wired. */
export function isV3Live(chainId?: number): boolean {
  return Boolean(getV3Addresses(chainId))
}

/** The set of chains with a v3 stack wired (for the "switch chain" fallback). */
export function v3SupportedChainIds(): UniverseChainId[] {
  const ids = new Set<number>()
  for (const key of Object.keys(V3_CORE_FACTORY_ADDRESSES)) {
    const id = Number(key)
    if (isV3Live(id)) {
      ids.add(id)
    }
  }
  return Array.from(ids) as UniverseChainId[]
}
