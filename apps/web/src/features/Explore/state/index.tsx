import { ExploreStatsResponse } from '@uniswap/client-explore/dist/uniswap/explore/v1/service_pb'
import { ALL_NETWORKS_ARG } from '@universe/api'
import { FeatureFlags, useFeatureFlag } from '@universe/gating'
import { createContext, useContext, useMemo } from 'react'
import { useExploreStatsQuery } from 'uniswap/src/data/rest/exploreStats'
import { useProtocolStatsQuery } from 'uniswap/src/data/rest/protocolStats'
import { useIsSupportedChainId } from 'uniswap/src/features/chains/hooks/useSupportedChainId'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { PROTOCOL_STATS_LIVE } from '~/terminal/config/liquidityGate'

export const TABLE_PAGE_SIZE = 20

export const giveExploreStatDefaultValue = (value: number | undefined, defaultValue = 0): number => {
  return value ?? defaultValue
}

/** Resolved chain ID string for explore queries (from provider prop). */
const ExploreChainIdContext = createContext<string>(ALL_NETWORKS_ARG)

/** Chain id string from ExploreContextProvider (or ALL_NETWORKS when unset/unsupported). */
export function useExploreChainId(): string {
  return useContext(ExploreChainIdContext)
}

/** Hook that runs the explore-stats query. Deduplicated by React Query. */
export function useExploreStats() {
  const chainId = useExploreChainId()
  const poolsV2EndpointsEnabled = useFeatureFlag(FeatureFlags.V2EndpointsPools)

  return useExploreStatsQuery<ExploreStatsResponse>({
    input: { chainId, multichain: true },
    enabled: !poolsV2EndpointsEnabled,
  })
}

type ProtocolStatsResult = ReturnType<typeof useProtocolStatsQuery>

/**
 * Stand-in result used while `PROTOCOL_STATS_LIVE` is false (protocol-seeded
 * liquidity withdrawn → protocol-wide TVL / volume / depth would read ~zero).
 *
 * Shaped exactly like a DISABLED React Query result — no data, nothing in
 * flight, no error — so every consumer (`use24hProtocolVolume`,
 * `useDailyTVLWithChange`, Analytics, Landing, the legacy /preview Stats tiles)
 * reads "nothing to show" instead of a misleading zero. No request is issued:
 * the query hook is never mounted. Cast because only the fields consumers read
 * are worth spelling out; `refetch` is intentionally absent (nothing calls it
 * while gated).
 */
const GATED_PROTOCOL_STATS = {
  data: undefined,
  error: null,
  status: 'pending',
  fetchStatus: 'idle',
  isPending: true,
  isLoading: false,
  isFetching: false,
  isError: false,
  isSuccess: false,
} as unknown as ProtocolStatsResult

function useLiveProtocolStats(): ProtocolStatsResult {
  const chainId = useExploreChainId()
  return useProtocolStatsQuery({ chainId })
}

function useGatedProtocolStats(): ProtocolStatsResult {
  return GATED_PROTOCOL_STATS
}

/**
 * Hook that runs the protocol-stats query. Deduplicated by React Query.
 *
 * Bound once at module load from the `PROTOCOL_STATS_LIVE` gate, so the hook
 * order is identical on every render and flipping the flag back to `true`
 * restores the live query with no other change.
 */
export const useProtocolStats: () => ProtocolStatsResult = PROTOCOL_STATS_LIVE
  ? useLiveProtocolStats
  : useGatedProtocolStats

export function ExploreContextProvider({
  chainId,
  children,
}: {
  chainId?: UniverseChainId
  children: React.ReactNode
}) {
  const isSupportedChain = useIsSupportedChainId(chainId)

  const chainIdStr = useMemo(() => {
    const chainIdOpt: UniverseChainId | undefined = chainId
    return !isSupportedChain || chainIdOpt === undefined ? ALL_NETWORKS_ARG : chainIdOpt.toString()
  }, [chainId, isSupportedChain])

  return <ExploreChainIdContext.Provider value={chainIdStr}>{children}</ExploreChainIdContext.Provider>
}
