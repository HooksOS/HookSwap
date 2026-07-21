/**
 * HookSwap LaunchPad Analytics — global stats (`GET /launches/stats`).
 *
 * Real indexer data or an honest "unreachable" signal; nothing is fabricated. USD
 * fields (`totalMarketCapUsd`) are OMITTED by the indexer when a value can't be priced —
 * callers render "—", never $0.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { launchpadApi, type LaunchesStats } from '~/terminal/launchpad/analytics/client'

export interface UseLaunchesStats {
  stats?: LaunchesStats
  isLoading: boolean
  /** True when the indexer is unreachable / errored (drives the offline note). */
  error: boolean
  refetch: () => void
}

export function useLaunchesStats(): UseLaunchesStats {
  const query = useQuery({
    queryKey: ['launches-stats'],
    queryFn: ({ signal }) => launchpadApi.getStats(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseLaunchesStats>(
    () => ({
      stats: query.data,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
