/**
 * HookSwap Locker Analytics — global stats (`GET /stats`).
 *
 * Real indexer data or an honest "unreachable" signal; nothing is fabricated. USD
 * fields (`totalTvlUsd`, per-chain `tvlUsd`) are OMITTED by the indexer when a value
 * can't be priced — callers render "—", never $0.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { lockerApi, type LockerStats } from '~/terminal/lockers/analytics/client'

export interface UseLockerStats {
  stats?: LockerStats
  isLoading: boolean
  /** True when the indexer is unreachable / errored (drives the "engine offline" note). */
  error: boolean
  refetch: () => void
}

export function useLockerStats(): UseLockerStats {
  const query = useQuery({
    queryKey: ['locker-stats'],
    queryFn: ({ signal }) => lockerApi.getStats(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseLockerStats>(
    () => ({
      stats: query.data,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
