/**
 * HookSwap Vesting Analytics — a single schedule by chain + id (`GET /vesting/:chainId/:id`).
 *
 * The indexer counterpart to the on-chain `useSchedule` read: it supplies the value only a
 * priced indexer can give — `valueUsd` (USD value of the schedule) — plus a chain name. The
 * per-schedule DETAIL page reads its core figures + the Release action on-chain (always
 * available with a working RPC) and layers THIS on top for the USD figure, exactly as the
 * Vesting page splits the on-chain `MySchedulesPanel` from the indexer-backed `VestingExplore`.
 *
 * DATA POLICY (facts-only): real indexer data or an honest signal. `valueUsd` is OMITTED by
 * the indexer when unpriceable → the caller renders "—", never $0. `notFound` (indexer 404 —
 * not indexed yet) is distinguished from `error` (indexer unreachable). Mirrors `useLock` /
 * `useFarmAnalytics`. Nothing here fabricates a schedule, price, amount or date.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { VestingApiError, vestingApi, type VestingSchedule } from '~/terminal/vesting/analytics/client'

export interface UseScheduleAnalytics {
  schedule?: VestingSchedule
  isLoading: boolean
  /** True when the indexer returned 404 — this schedule isn't indexed on this chain (yet). */
  notFound: boolean
  /** True when the indexer is unreachable / errored (non-404). Never blocks the on-chain view. */
  error: boolean
  refetch: () => void
}

/** Whether the chain + id pair is a well-formed lookup. */
function isValidRef(chainId: number, id: number): boolean {
  return Number.isInteger(chainId) && chainId > 0 && Number.isInteger(id) && id >= 0
}

export function useScheduleAnalytics(chainId: number, id: number): UseScheduleAnalytics {
  const enabled = isValidRef(chainId, id)

  const query = useQuery({
    queryKey: ['vesting-schedule', chainId, id],
    queryFn: ({ signal }) => vestingApi.getSchedule(chainId, id, signal),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    // Don't retry a genuine 404 — the schedule simply isn't indexed. Retry transient failures once.
    retry: (failureCount, err) => {
      if (err instanceof VestingApiError && err.status === 404) {
        return false
      }
      return failureCount < 1
    },
  })

  return useMemo<UseScheduleAnalytics>(() => {
    const err = query.error
    const notFound = err instanceof VestingApiError && err.status === 404
    return {
      schedule: query.data,
      isLoading: enabled ? query.isLoading && !query.data : false,
      notFound: !enabled || notFound,
      error: query.isError && !notFound && !query.data,
      refetch: () => void query.refetch(),
    }
  }, [enabled, query.data, query.error, query.isLoading, query.isError, query.refetch])
}
