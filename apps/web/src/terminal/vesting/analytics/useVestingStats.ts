/**
 * HookSwap Vesting Analytics — global stats (`GET /vesting/stats`).
 *
 * Real indexer data or an honest "unreachable" signal; nothing is fabricated. USD
 * fields (`totalTvlUsd`) are OMITTED by the indexer when a value can't be priced —
 * callers render "—", never $0.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { vestingApi, type VestingStats } from '~/terminal/vesting/analytics/client'

export interface UseVestingStats {
  stats?: VestingStats
  isLoading: boolean
  /** True when the indexer is unreachable / errored (drives the offline note). */
  error: boolean
  refetch: () => void
}

export function useVestingStats(): UseVestingStats {
  const query = useQuery({
    queryKey: ['vesting-stats'],
    queryFn: ({ signal }) => vestingApi.getStats(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseVestingStats>(
    () => ({
      stats: query.data,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
