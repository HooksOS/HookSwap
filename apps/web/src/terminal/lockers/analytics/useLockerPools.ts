/**
 * HookSwap Locker Analytics — per-pool (LP) aggregates (`GET /pools`).
 *
 * Real indexer data, sorted by `tvlUsd` desc then `lockCount` server-side. `tvlUsd` is
 * OMITTED per pool when unpriceable — callers render "—". An empty list is an honest
 * "no LP locks yet" state, not an error.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { lockerApi, type PoolAgg } from '~/terminal/lockers/analytics/client'

export interface UseLockerPools {
  pools?: PoolAgg[]
  total?: number
  isLoading: boolean
  error: boolean
  refetch: () => void
}

export function useLockerPools(): UseLockerPools {
  const query = useQuery({
    queryKey: ['locker-pools'],
    queryFn: ({ signal }) => lockerApi.getPools(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseLockerPools>(
    () => ({
      pools: query.data ? (Array.isArray(query.data.pools) ? query.data.pools : []) : undefined,
      total: query.data?.total,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
