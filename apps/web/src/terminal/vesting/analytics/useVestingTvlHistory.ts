/**
 * HookSwap Vesting Analytics — daily snapshot series (`GET /vesting/tvl-history`).
 *
 * The series only grows while the indexer runs (no historical backfill) — it may be
 * short or empty at first, and a point's `totalTvlUsd` is OMITTED until a chain has a
 * USD anchor. Callers must handle 0-few priced points honestly (a "history builds as
 * snapshots accrue" empty state, never a fabricated line).
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { vestingApi, type VestingSnapshot } from '~/terminal/vesting/analytics/client'

export interface UseVestingTvlHistory {
  points?: VestingSnapshot[]
  isLoading: boolean
  error: boolean
  refetch: () => void
}

export function useVestingTvlHistory(): UseVestingTvlHistory {
  const query = useQuery({
    queryKey: ['vesting-tvl-history'],
    queryFn: ({ signal }) => vestingApi.getTvlHistory(signal),
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseVestingTvlHistory>(
    () => ({
      points: query.data ? (Array.isArray(query.data.points) ? query.data.points : []) : undefined,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
