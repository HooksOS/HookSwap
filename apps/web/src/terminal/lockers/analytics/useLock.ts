/**
 * HookSwap Locker Analytics — a single lock by chain + id (`GET /lock/:chainId/:id`).
 *
 * Powers the public, no-wallet proof-of-lock detail page. Real indexer data or an honest
 * signal: `notFound` (indexer returned 404 — the lock doesn't exist) is distinguished from
 * `error` (the indexer is unreachable / errored otherwise). Nothing here fabricates a lock,
 * price, or amount — `valueUsd` stays omitted (rendered "—") when the indexer can't price it.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { LockerApiError, lockerApi, type Lock } from '~/terminal/lockers/analytics/client'

export interface UseLock {
  lock?: Lock
  isLoading: boolean
  /** True when the indexer returned 404 — this lock id doesn't exist on this chain. */
  notFound: boolean
  /** True when the indexer is unreachable / errored (non-404). Drives the offline state. */
  error: boolean
  refetch: () => void
}

/** Whether the chain + id pair is a well-formed lookup (non-negative integers). */
function isValidRef(chainId: number, idOrToken: number | string): boolean {
  if (!(Number.isInteger(chainId) && chainId > 0)) {
    return false
  }
  return typeof idOrToken === 'number' ? Number.isInteger(idOrToken) && idOrToken >= 0 : idOrToken.trim().length > 0
}

export function useLock(chainId: number, idOrToken: number | string): UseLock {
  const enabled = isValidRef(chainId, idOrToken)

  const query = useQuery({
    queryKey: ['locker-lock', chainId, idOrToken],
    queryFn: ({ signal }) => lockerApi.getLock(chainId, idOrToken, signal),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    // Don't retry a genuine 404 — the lock simply doesn't exist. Retry transient failures once.
    retry: (failureCount, err) => {
      if (err instanceof LockerApiError && err.status === 404) {
        return false
      }
      return failureCount < 1
    },
  })

  return useMemo<UseLock>(() => {
    const err = query.error
    const notFound = err instanceof LockerApiError && err.status === 404
    return {
      lock: query.data,
      // An invalid ref never fires the query — surface it as not-found, not an infinite spinner.
      isLoading: enabled ? query.isLoading && !query.data : false,
      notFound: !enabled || notFound,
      error: query.isError && !notFound && !query.data,
      refetch: () => void query.refetch(),
    }
  }, [enabled, query.data, query.error, query.isLoading, query.isError, query.refetch])
}
