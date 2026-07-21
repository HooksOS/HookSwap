/**
 * HookSwap Locker Analytics — daily TVL snapshot series (`GET /tvl-history`).
 *
 * The series only grows while the indexer runs (no historical backfill) — it may be
 * short or empty at first. Callers must handle 0-few points honestly (a "history
 * builds as snapshots accrue" empty state, never a fabricated line).
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { lockerApi, type TVLSnapshot } from '~/terminal/lockers/analytics/client'

export interface UseLockerTvlHistory {
  points?: TVLSnapshot[]
  isLoading: boolean
  error: boolean
  refetch: () => void
}

export function useLockerTvlHistory(): UseLockerTvlHistory {
  const query = useQuery({
    queryKey: ['locker-tvl-history'],
    queryFn: ({ signal }) => lockerApi.getTvlHistory(signal),
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseLockerTvlHistory>(
    () => ({
      points: query.data ? (Array.isArray(query.data.points) ? query.data.points : []) : undefined,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
