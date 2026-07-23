/**
 * HookSwap Terminal — LaunchPad engine registry.
 *
 * The single source of truth for the 4 launch engines the create surface exposes. Availability is
 * resolved from the vendored `@hookos/sdk` PER CHAIN (never hardcoded): each engine asks the SDK
 * whether its contracts are deployed on the given chain. The picker + panels read this so the UI
 * gates honestly (enabled vs. a COMING-SOON / "Robinhood only" note) with zero mock data.
 *
 *   • bondingCurve — TokenFactory.createTokenAndCurve (BASE · RH · MEGA · HYPE · BNB · ETH).
 *   • fairV3       — HookOSV3Launcher direct-to-v3, LP locked in the FeeVault (all 6 HookOS chains).
 *   • quickLaunch  — RHLaunchpad direct-to-v4 memecoin fast path (Robinhood only).
 *   • stockReward  — StockRewardLauncherV4 taxed launch → tokenized-stock rewards (Robinhood only).
 */
import {
  ADDRESSES,
  getHookOSV3Addresses,
  getQuickLaunchAddresses,
  getStockRewardAddresses,
  HOOKOS_V3_SUPPORTED_CHAIN_IDS,
  type ContractAddresses,
} from '@hookos/sdk'

export type LaunchEngineId = 'bondingCurve' | 'fairV3' | 'quickLaunch' | 'stockReward'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Availability of an engine on a specific chain, resolved live from the SDK. */
export interface EngineAvailability {
  available: boolean
  /** Human reason when unavailable (shown under a disabled card / in the panel). */
  reason?: string
}

export interface LaunchEngineDef {
  id: LaunchEngineId
  /** Short card/tab label. */
  label: string
  /** Mono pill shown in the engine header (e.g. "fair launch · v3"). */
  pill: string
  /** One-line description shown on the picker card. */
  description: string
  /** Resolve whether this engine's contracts are deployed on `chainId` (SDK-driven). */
  resolveAvailability: (chainId?: number) => EngineAvailability
  /** All chains this engine is deployed on today (SDK-derived; informational for gating copy). */
  supportedChains: number[]
}

/* --------------------------------------------------------------- SDK availability probes */

/** The bonding-curve TokenFactory address on `chainId`, or undefined when not deployed. */
function bondingCurveAddress(chainId?: number): string | undefined {
  if (chainId === undefined) {
    return undefined
  }
  const rec = (ADDRESSES as Record<number, ContractAddresses>)[chainId]
  if (!rec || rec.bondingCurve === ZERO_ADDRESS) {
    return undefined
  }
  return rec.bondingCurve
}

/** Every chain the bonding curve is live on (SDK-derived from ADDRESSES). */
const BONDING_CURVE_CHAINS: number[] = Object.keys(ADDRESSES)
  .map(Number)
  .filter((id) => bondingCurveAddress(id) !== undefined)

function quickLaunchChains(): number[] {
  // getQuickLaunchAddresses returns null off-chain; probe the HookOS chain set.
  return HOOKOS_V3_SUPPORTED_CHAIN_IDS.filter((id) => getQuickLaunchAddresses(id) !== null)
}

function stockRewardChains(): number[] {
  return HOOKOS_V3_SUPPORTED_CHAIN_IDS.filter((id) => getStockRewardAddresses(id) !== null)
}

const ROBINHOOD_ONLY = 'This engine is live on Robinhood Chain only.'

/* --------------------------------------------------------------- the registry */

export const LAUNCH_ENGINES: LaunchEngineDef[] = [
  {
    id: 'bondingCurve',
    label: 'Bonding Curve',
    pill: 'bonding curve',
    description: 'Fair mint on a bonding curve that graduates to a real DEX pool once it fills.',
    supportedChains: BONDING_CURVE_CHAINS,
    resolveAvailability: (chainId) =>
      bondingCurveAddress(chainId) !== undefined
        ? { available: true }
        : { available: false, reason: 'The bonding-curve factory is not deployed on this network.' },
  },
  {
    id: 'fairV3',
    label: 'Fair Launch · v3',
    pill: 'fair launch · v3',
    description: 'Deploy a token, seed its v3 pool, and lock the LP in the fee vault — one transaction.',
    supportedChains: HOOKOS_V3_SUPPORTED_CHAIN_IDS,
    resolveAvailability: (chainId) =>
      chainId !== undefined && getHookOSV3Addresses(chainId) !== null
        ? { available: true }
        : { available: false, reason: 'The v3 launcher is not deployed on this network.' },
  },
  {
    id: 'quickLaunch',
    label: 'Quick Launch',
    pill: 'quick launch · v4',
    description: 'Direct-to-v4 memecoin fast path — token + concentrated pool seeded in one call.',
    supportedChains: quickLaunchChains(),
    resolveAvailability: (chainId) =>
      chainId !== undefined && getQuickLaunchAddresses(chainId) !== null
        ? { available: true }
        : { available: false, reason: ROBINHOOD_ONLY },
  },
  {
    id: 'stockReward',
    label: 'Stock Reward',
    pill: 'stock reward · rwa',
    description: 'Taxed fair launch whose 2–5% tax buys REAL tokenized stocks and drips them to holders.',
    supportedChains: stockRewardChains(),
    resolveAvailability: (chainId) =>
      chainId !== undefined && getStockRewardAddresses(chainId) !== null
        ? { available: true }
        : { available: false, reason: ROBINHOOD_ONLY },
  },
]

export const DEFAULT_ENGINE_ID: LaunchEngineId = 'fairV3'

export function getEngine(id: LaunchEngineId): LaunchEngineDef {
  const found = LAUNCH_ENGINES.find((e) => e.id === id)
  if (!found) {
    throw new Error(`Unknown launch engine: ${id}`)
  }
  return found
}
