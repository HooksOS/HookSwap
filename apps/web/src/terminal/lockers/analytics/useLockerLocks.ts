/**
 * HookSwap Locker Analytics — the individual-lock list (`GET /locks`).
 *
 * Powers row → detail linking on the Ledger explore view: the per-token / per-pool
 * aggregates (`/tokens`, `/pools`) don't carry a lock id, but the proof-of-lock detail
 * route is per-lock (`/lock/:chainId/:id`). This hook fetches the real locks so the
 * explore view can resolve a representative lock id for each aggregate row.
 *
 * Sorted by `tvl` server-side, so the FIRST lock seen for a given (chain, token) is the
 * most significant one — the right target for a single-lock row (e.g. "HOOK · 1 lock")
 * and a sensible default for a multi-lock row. Real indexer data only; nothing fabricated.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { lockerApi, type Lock } from '~/terminal/lockers/analytics/client'

/** Upper bound on locks fetched for id-resolution — generous for current scale. */
const LOCKS_LIMIT = 500

export interface UseLockerLocks {
  locks?: Lock[]
  total?: number
  isLoading: boolean
  error: boolean
  refetch: () => void
}

export function useLockerLocks(): UseLockerLocks {
  const query = useQuery({
    queryKey: ['locker-locks', 'tvl', LOCKS_LIMIT],
    queryFn: ({ signal }) => lockerApi.getLocks({ sort: 'tvl', limit: LOCKS_LIMIT }, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return useMemo<UseLockerLocks>(
    () => ({
      locks: query.data ? (Array.isArray(query.data.locks) ? query.data.locks : []) : undefined,
      total: query.data?.total,
      isLoading: query.isLoading && !query.data,
      error: query.isError && !query.data,
      refetch: () => void query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  )
}
