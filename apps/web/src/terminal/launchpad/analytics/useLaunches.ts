/**
 * HookSwap LaunchPad Analytics — launch list (`GET /launches`).
 *
 * Real indexer data. `sort` (mcap | created) is applied server-side; the caller may pass
 * a chain filter. `marketCapUsd` is OMITTED per launch when unpriceable — callers render
 * "—", never a fabricated market cap or $0.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { launchpadApi, type Launch } from '~/terminal/launchpad/analytics/client'

export interface UseLaunchesParams {
  chainId?: number
  sort?: 'mcap' | 'created'
  limit?: number
  offset?: number
}

export interface UseLaunches {
  launches?: Launch[]
  total?: number
  isLoading: boolean
  error: boolean
  refetch: () => void
}

export function useLaunches(params: UseLaunchesParams = {}): UseLaunches {
  const { chainId, sort, limit, offset } = params
  const query = useQuery({
    queryKey: ['launches-list', chainId ?? 'all', sort ?? 'mcap', limit ?? null, offset ?? null],
    queryFn: ({ signal }) => launchpadApi.getLaunches({ chainId, sort, limit, offset }, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseLaunches>(
    () => ({
      launches: query.data ? (Array.isArray(query.data.launches) ? query.data.launches : []) : undefined,
      total: query.data?.total,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
