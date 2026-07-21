/**
 * HookSwap Locker Analytics — per-token aggregates (`GET /tokens`).
 *
 * Real indexer data, sorted by `tvlUsd` desc then `lockCount` server-side. `tvlUsd` is
 * OMITTED per token when unpriceable — callers render "—".
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { lockerApi, type TokenAgg } from '~/terminal/lockers/analytics/client'

export interface UseLockerTokens {
  tokens?: TokenAgg[]
  total?: number
  isLoading: boolean
  error: boolean
  refetch: () => void
}

export function useLockerTokens(): UseLockerTokens {
  const query = useQuery({
    queryKey: ['locker-tokens'],
    queryFn: ({ signal }) => lockerApi.getTokens(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseLockerTokens>(
    () => ({
      tokens: query.data ? (Array.isArray(query.data.tokens) ? query.data.tokens : []) : undefined,
      total: query.data?.total,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
