/**
 * HookSwap Farms Analytics — a single farm by chain + address (`GET /farm/:chainId/:address`).
 *
 * The indexer counterpart to the on-chain `useFarm` read: it supplies the values only a
 * priced indexer can give — `tvlUsd` (USD TVL) and `aprPct` (yield %) — plus a chain name.
 * The per-farm DETAIL page reads its core stats + actions on-chain (always available with a
 * working RPC) and layers THIS on top for the USD/APR figures, exactly as the Farms page
 * splits FarmsManage (on-chain) from FarmsExplore (indexer).
 *
 * DATA POLICY (facts-only): real indexer data or an honest signal. `tvlUsd` / `aprPct` are
 * OMITTED by the indexer when unpriceable → the caller renders "—", never $0 or a fabricated
 * yield. `notFound` (indexer 404 — not indexed yet) is distinguished from `error` (indexer
 * unreachable). Nothing here fabricates a farm, price, TVL or APR. Mirrors `useLock`.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { FarmsApiError, farmsApi, type Farm } from '~/terminal/farms/analytics/client'

export interface UseFarmAnalytics {
  farm?: Farm
  isLoading: boolean
  /** True when the indexer returned 404 — this farm isn't indexed on this chain (yet). */
  notFound: boolean
  /** True when the indexer is unreachable / errored (non-404). Never blocks the on-chain view. */
  error: boolean
  refetch: () => void
}

/** Whether the chain + address pair is a well-formed lookup. */
function isValidRef(chainId: number, address: string): boolean {
  return Number.isInteger(chainId) && chainId > 0 && address.trim().length > 0
}

export function useFarmAnalytics(chainId: number, address: string): UseFarmAnalytics {
  const enabled = isValidRef(chainId, address)

  const query = useQuery({
    queryKey: ['farms-farm', chainId, address.toLowerCase()],
    queryFn: ({ signal }) => farmsApi.getFarm(chainId, address, signal),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    // Don't retry a genuine 404 — the farm simply isn't indexed. Retry transient failures once.
    retry: (failureCount, err) => {
      if (err instanceof FarmsApiError && err.status === 404) {
        return false
      }
      return failureCount < 1
    },
  })

  return useMemo<UseFarmAnalytics>(() => {
    const err = query.error
    const notFound = err instanceof FarmsApiError && err.status === 404
    return {
      farm: query.data,
      isLoading: enabled ? query.isLoading && !query.data : false,
      notFound: !enabled || notFound,
      error: query.isError && !notFound && !query.data,
      refetch: () => void query.refetch(),
    }
  }, [enabled, query.data, query.error, query.isLoading, query.isError, query.refetch])
}
