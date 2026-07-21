/**
 * HookSwap Vesting Analytics — schedule list (`GET /vesting`).
 *
 * Real indexer data. `sort` (tvl | created | ending | pct) is applied server-side; the
 * caller may pass a chain filter. `valueUsd` is OMITTED per schedule when unpriceable —
 * callers render "—", never a fabricated $ value.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { vestingApi, type VestingSchedule, type VestingSort } from '~/terminal/vesting/analytics/client'

export interface UseVestingParams {
  chainId?: number
  sort?: VestingSort
  limit?: number
  offset?: number
}

export interface UseVesting {
  schedules?: VestingSchedule[]
  total?: number
  isLoading: boolean
  error: boolean
  refetch: () => void
}

export function useVesting(params: UseVestingParams = {}): UseVesting {
  const { chainId, sort, limit, offset } = params
  const query = useQuery({
    queryKey: ['vesting-list', chainId ?? 'all', sort ?? 'tvl', limit ?? null, offset ?? null],
    queryFn: ({ signal }) => vestingApi.getSchedules({ chainId, sort, limit, offset }, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseVesting>(
    () => ({
      schedules: query.data ? (Array.isArray(query.data.schedules) ? query.data.schedules : []) : undefined,
      total: query.data?.total,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
