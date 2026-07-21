/**
 * HookSwap LaunchPad Analytics — a single launch by chain + token (`GET /launch/:chainId/:token`).
 *
 * Powers the public, no-wallet shareable launch page. `token` may be the launched token
 * ADDRESS (the shareable URL) or the numeric launch id — the indexer accepts both. Real
 * indexer data or an honest signal: `notFound` (indexer returned 404 — the launch doesn't
 * exist) is distinguished from `error` (the indexer is unreachable / errored otherwise).
 * Nothing here fabricates a launch, price, or supply — `marketCapUsd` stays omitted
 * (rendered "—") when the indexer can't price it.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { LaunchpadApiError, launchpadApi, type Launch } from '~/terminal/launchpad/analytics/client'

export interface UseLaunch {
  launch?: Launch
  isLoading: boolean
  /** True when the indexer returned 404 — this launch doesn't exist on this chain. */
  notFound: boolean
  /** True when the indexer is unreachable / errored (non-404). Drives the offline state. */
  error: boolean
  refetch: () => void
}

/** Whether the chain + token pair is a well-formed lookup (positive chain id + non-empty token ref). */
function isValidRef(chainId: number, token: string): boolean {
  return Number.isInteger(chainId) && chainId > 0 && typeof token === 'string' && token.trim() !== ''
}

export function useLaunch(chainId: number, token: string): UseLaunch {
  const enabled = isValidRef(chainId, token)

  const query = useQuery({
    queryKey: ['launchpad-launch', chainId, token],
    queryFn: ({ signal }) => launchpadApi.getLaunch(chainId, token, signal),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    // Don't retry a genuine 404 — the launch simply doesn't exist. Retry transient failures once.
    retry: (failureCount, err) => {
      if (err instanceof LaunchpadApiError && err.status === 404) {
        return false
      }
      return failureCount < 1
    },
  })

  return useMemo<UseLaunch>(() => {
    const err = query.error
    const notFound = err instanceof LaunchpadApiError && err.status === 404
    return {
      launch: query.data,
      // An invalid ref never fires the query — surface it as not-found, not an infinite spinner.
      isLoading: enabled ? query.isLoading && !query.data : false,
      notFound: !enabled || notFound,
      error: query.isError && !notFound && !query.data,
      refetch: () => void query.refetch(),
    }
  }, [enabled, query.data, query.error, query.isLoading, query.isError, query.refetch])
}
