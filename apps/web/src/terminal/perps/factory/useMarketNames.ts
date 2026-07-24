/**
 * HookSwapPerps — DERIVE a human market name from on-chain identity.
 *
 * WHY (verified): the MarketRegistry stores `marketId = keccak256(utf8Bytes(label))`, a
 * ONE-WAY hash — the original label is unrecoverable. So we can't show the creator's name;
 * we derive one from the market's on-chain oracle instead. Every market registered by the
 * factory has an `OracleGuard` config carrying its Chainlink **refFeed**; that feed's
 * `description()` ("ETH / USD", "BTC / USD", "NVDA / USD") names the underlying. We parse the
 * base asset and render "<BASE>-PERP" (ETH-PERP / BTC-PERP / NVDA-PERP). The collateral
 * token's `symbol()` is a useful secondary label.
 *
 * READS (batched, per-chain, wagmi `useReadContracts` multicall):
 *   1. `OracleGuard.getMarketConfig(market)` → `refFeed` (one per market),
 *   2. `refFeed.description()` (one per resolved feed),
 *   3. `collateral.symbol()` (one per market).
 *
 * FACTS-ONLY: a name is emitted ONLY when a real feed description resolves to a base asset.
 * If the feed is missing/unreadable (refFeed=0, revert, empty description), the market is
 * simply ABSENT from the returned map → the caller keeps its honest short-address fallback
 * ("MKT 0x…"). Nothing is fabricated. Several proof markets legitimately share the ETH/USD
 * feed → they all resolve to "ETH-PERP"; callers disambiguate with the short address.
 */
import { useMemo } from 'react'
import type { ContractFunctionParameters } from 'viem'
import { useReadContracts } from 'wagmi'
import type { Address } from '~/chains'
import { chainlinkFeedAbi, erc20SymbolAbi, getPerpsFactoryDeployment, oracleGuardAbi } from '~/terminal/perps/factory/abis'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** One market's identity the name derivation needs. */
export interface NameableMarket {
  /** Market clone address (the OracleGuard config key). */
  market: Address
  /** Collateral token address (for the secondary `symbol()` label). */
  collateral: Address
}

/** A derived display name for one market. Present ONLY when a real name resolved. */
export interface ResolvedMarketName {
  /** e.g. "ETH-PERP" — derived from the Chainlink feed description's base asset. */
  name: string
  /** Base asset ticker, e.g. "ETH". */
  base: string
  /** Collateral token symbol (e.g. "WETH"), when readable. */
  collateralSymbol?: string
  /** Raw feed description ("ETH / USD"), for tooltips / debugging. */
  refFeedDescription?: string
}

/** The OracleConfig tuple returned by `getMarketConfig` (named components → object). */
interface OracleConfigResult {
  sourceType: `0x${string}`
  venue: Address
  refFeed: Address
  maxDeviationBps: bigint
  maxStaleness: bigint
  minLiquidity: bigint
  dualSourceRequired: boolean
}

/**
 * Parse the base asset from a Chainlink feed description.
 * "ETH / USD" → "ETH", "BTC / USD" → "BTC", "NVDA / USD" → "NVDA", "wstETH / ETH" → "WSTETH".
 * A bare "ETH" (no quote) is used as-is. Returns undefined when nothing usable is present.
 */
export function baseAssetFromFeedDescription(description: string): string | undefined {
  const trimmed = description.trim()
  if (trimmed === '') {
    return undefined
  }
  // The base is everything before the first "/" (quote currency). No "/" → whole string.
  const base = (trimmed.split('/')[0] ?? '').trim()
  if (base === '') {
    return undefined
  }
  return base.toUpperCase()
}

export interface UseMarketNames {
  /** Lowercased market address → its derived name. Absent = keep the short-address fallback. */
  names: ReadonlyMap<string, ResolvedMarketName>
  /** True while the on-chain reads are in flight. */
  isLoading: boolean
}

/**
 * Resolve derived display names for a list of markets on `chainId`. Batched + cached; markets
 * whose feed can't be read are simply omitted (honest fallback lives in the caller).
 */
export function useMarketNames({
  markets,
  chainId,
}: {
  markets?: readonly NameableMarket[]
  chainId?: number
}): UseMarketNames {
  const oracleGuard = getPerpsFactoryDeployment(chainId)?.oracleGuard
  const list = useMemo<readonly NameableMarket[]>(() => markets ?? [], [markets])
  const enabled = Boolean(oracleGuard) && list.length > 0

  // Step 1 — OracleGuard.getMarketConfig(market) → refFeed, one call per market.
  const configReads = useReadContracts({
    // Per-contract `chainId` is read at runtime; cast to viem's base type because our
    // UniverseChainId is wider than wagmi's configured-chains union (see useSeededOnchainPools).
    contracts: list.map((m) => ({
      address: oracleGuard,
      chainId,
      abi: oracleGuardAbi,
      functionName: 'getMarketConfig' as const,
      args: [m.market],
    })) as unknown as readonly ContractFunctionParameters[],
    query: { enabled, staleTime: 300_000 },
  })

  // refFeed per market (aligned to `list`); undefined when unreadable or unset (0x0).
  const refFeeds = useMemo<(Address | undefined)[]>(
    () =>
      list.map((_, i) => {
        const entry = configReads.data?.[i]
        if (entry?.status !== 'success') {
          return undefined
        }
        const cfg = entry.result as OracleConfigResult
        const feed = cfg.refFeed
        return feed && feed.toLowerCase() !== ZERO_ADDRESS ? feed : undefined
      }),
    [list, configReads.data],
  )
  const hasAnyFeed = refFeeds.some(Boolean)

  // Step 2 — refFeed.description(), aligned to `list` (0x0 placeholder for missing feeds → the
  // read fails and is skipped; keeps index alignment simple).
  const descReads = useReadContracts({
    contracts: list.map((_, i) => ({
      address: refFeeds[i] ?? ZERO_ADDRESS,
      chainId,
      abi: chainlinkFeedAbi,
      functionName: 'description' as const,
    })) as unknown as readonly ContractFunctionParameters[],
    query: { enabled: enabled && hasAnyFeed, staleTime: 600_000 },
  })

  // Step 3 — collateral.symbol(), one call per market (secondary label).
  const symbolReads = useReadContracts({
    contracts: list.map((m) => ({
      address: m.collateral,
      chainId,
      abi: erc20SymbolAbi,
      functionName: 'symbol' as const,
    })) as unknown as readonly ContractFunctionParameters[],
    query: { enabled, staleTime: 600_000 },
  })

  const names = useMemo<ReadonlyMap<string, ResolvedMarketName>>(() => {
    const map = new Map<string, ResolvedMarketName>()
    list.forEach((m, i) => {
      const descEntry = descReads.data?.[i]
      if (!refFeeds[i] || descEntry?.status !== 'success') {
        return // no readable feed → caller keeps its short-address fallback.
      }
      const base = baseAssetFromFeedDescription(String(descEntry.result))
      if (!base) {
        return
      }
      const symEntry = symbolReads.data?.[i]
      const collateralSymbol =
        symEntry?.status === 'success' && String(symEntry.result).trim() !== ''
          ? String(symEntry.result).trim()
          : undefined
      map.set(m.market.toLowerCase(), {
        name: `${base}-PERP`,
        base,
        collateralSymbol,
        refFeedDescription: String(descEntry.result).trim(),
      })
    })
    return map
  }, [list, refFeeds, descReads.data, symbolReads.data])

  return {
    names,
    isLoading: enabled && (configReads.isLoading || (hasAnyFeed && descReads.isLoading)),
  }
}
