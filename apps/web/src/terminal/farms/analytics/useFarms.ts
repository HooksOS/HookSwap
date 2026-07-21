/**
 * HookSwap Farms Analytics — farm list (`GET /farms`).
 *
 * Real indexer data. `sort` (tvl | apr) is applied server-side; the caller may pass a
 * chain filter. `tvlUsd` / `aprPct` are OMITTED per farm when unpriceable — callers
 * render "—", never a fabricated APR or $0 TVL.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { farmsApi, type Farm } from '~/terminal/farms/analytics/client'

export interface UseFarmsParams {
  chainId?: number
  sort?: 'tvl' | 'apr'
  limit?: number
  offset?: number
}

export interface UseFarms {
  farms?: Farm[]
  total?: number
  isLoading: boolean
  error: boolean
  refetch: () => void
}

export function useFarms(params: UseFarmsParams = {}): UseFarms {
  const { chainId, sort, limit, offset } = params
  const query = useQuery({
    queryKey: ['farms-list', chainId ?? 'all', sort ?? 'tvl', limit ?? null, offset ?? null],
    queryFn: ({ signal }) => farmsApi.getFarms({ chainId, sort, limit, offset }, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseFarms>(
    () => ({
      farms: query.data ? (Array.isArray(query.data.farms) ? query.data.farms : []) : undefined,
      total: query.data?.total,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
