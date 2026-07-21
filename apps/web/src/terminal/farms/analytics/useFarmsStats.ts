/**
 * HookSwap Farms Analytics — global stats (`GET /farms/stats`).
 *
 * Real indexer data or an honest "unreachable" signal; nothing is fabricated. USD
 * fields (`totalTvlUsd`) are OMITTED by the indexer when a value can't be priced —
 * callers render "—", never $0.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { farmsApi, type FarmsStats } from '~/terminal/farms/analytics/client'

export interface UseFarmsStats {
  stats?: FarmsStats
  isLoading: boolean
  /** True when the indexer is unreachable / errored (drives the offline note). */
  error: boolean
  refetch: () => void
}

export function useFarmsStats(): UseFarmsStats {
  const query = useQuery({
    queryKey: ['farms-stats'],
    queryFn: ({ signal }) => farmsApi.getStats(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseFarmsStats>(
    () => ({
      stats: query.data,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
