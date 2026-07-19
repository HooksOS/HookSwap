/**
 * HookSwapPerps — market directory reads (MarketRegistry).
 *
 * REAL wagmi reads (no mock data): `marketCount()` then a single `getMarkets(0, count)`
 * page, decoded into a typed list the directory renders. When the registry isn't deployed
 * on the chain, or has no markets yet, the caller shows an honest empty state — never a
 * fabricated row. See `contracts/perps/src/factory/MarketRegistry.sol`.
 */
import { useMemo } from 'react'
import { useReadContract } from 'wagmi'
import type { Address, Hash } from '~/chains'
import { getPerpsFactoryDeployment, marketRegistryAbi } from '~/terminal/perps/factory/abis'

/** MarketRegistry.Tier. */
export enum RegistryTier {
  Curated = 0,
  Permissionless = 1,
}

/** MarketRegistry.Status. */
export enum RegistryStatus {
  Active = 0,
  Paused = 1,
  Delisted = 2,
}

/** One decoded row from `getMarkets`. */
export interface MarketRow {
  market: Address
  creator: Address
  collateral: Address
  /** Raw bytes32 marketId (keccak of the label — the human label isn't stored on-chain). */
  marketId: Hash
  tier: RegistryTier
  status: RegistryStatus
  createdAt: bigint
}

/** Raw tuple shape returned by `getMarkets`. */
interface RawMarketInfo {
  market: Address
  creator: Address
  collateral: Address
  marketId: Hash
  tier: number
  status: number
  createdAt: bigint
}

export interface UseMarkets {
  /** True when the registry is deployed on this chain. */
  ready: boolean
  /** undefined = still loading; [] = genuinely no markets yet (honest empty state). */
  markets?: MarketRow[]
  /** Total count from `marketCount()`. */
  count?: number
  isLoading: boolean
  error: boolean
  refetch: () => void
}

export function useMarkets({ chainId }: { chainId?: number }): UseMarkets {
  const deployment = getPerpsFactoryDeployment(chainId)
  const registry = deployment?.registry
  const ready = Boolean(registry)

  const countRead = useReadContract({
    address: registry,
    chainId,
    abi: marketRegistryAbi,
    functionName: 'marketCount',
    query: { enabled: ready },
  })
  const count = countRead.data !== undefined ? Number(countRead.data as bigint) : undefined

  // Single paginated read of the whole registry (start 0, count = total). Enabled only once
  // the count is known AND > 0 — a zero-count registry needs no second call.
  const listRead = useReadContract({
    address: registry,
    chainId,
    abi: marketRegistryAbi,
    functionName: 'getMarkets',
    args: count !== undefined ? [0n, BigInt(count)] : undefined,
    query: { enabled: ready && count !== undefined && count > 0 },
  })

  const markets = useMemo<MarketRow[] | undefined>(() => {
    if (!ready || count === undefined) {
      return undefined
    }
    if (count === 0) {
      return []
    }
    const raw = listRead.data as readonly RawMarketInfo[] | undefined
    if (raw === undefined) {
      return undefined
    }
    return raw.map((r) => ({
      market: r.market,
      creator: r.creator,
      collateral: r.collateral,
      marketId: r.marketId,
      tier: r.tier as RegistryTier,
      status: r.status as RegistryStatus,
      createdAt: r.createdAt,
    }))
  }, [ready, count, listRead.data])

  const refetch = (): void => {
    void countRead.refetch()
    void listRead.refetch()
  }

  return {
    ready,
    markets,
    count,
    isLoading: ready && (countRead.isLoading || (count !== undefined && count > 0 && listRead.isLoading)),
    error: Boolean(countRead.error || listRead.error),
    refetch,
  }
}
