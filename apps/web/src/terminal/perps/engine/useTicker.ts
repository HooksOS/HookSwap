/**
 * HookSwapPerps — live per-market ticker (mark / index / 24h change / 24h volume /
 * open interest / funding) from the engine `GET /ticker`.
 *
 * The engine derives mark + index from each market's on-chain Chainlink refFeed (the
 * same price the deviation guard enforces) and computes 24h change / volume / OI from
 * its mark history + settled trades + on-chain positions. Every field is REAL or an
 * honest `null`; this hook parses the 1e18 string fields into display numbers and maps
 * a `null` field to `undefined` so the UI shows "—" only where the engine has no value
 * yet. Nothing is fabricated.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { perpsEngine, type EngineTicker } from '~/terminal/perps/engine/client'
import type { FeedStatus } from '~/terminal/perps/engine/useOrderbook'

/** Parse a 1e18-scaled decimal string to a display number, or undefined for null/blank. */
function from1e18(v: string | null | undefined): number | undefined {
  if (v === null || v === undefined || v === '') {
    return undefined
  }
  const n = Number(v)
  if (!Number.isFinite(n)) {
    return undefined
  }
  return n / 1e18
}

export interface UseTicker {
  /** Raw ticker payload (when loaded). */
  ticker?: EngineTicker
  /** Mark price in quote units, or undefined when the engine has no mark. */
  mark?: number
  /** Oracle index price (Chainlink refFeed) in quote units, or undefined. */
  indexPrice?: number
  /** 24h change percent (already ×100), or undefined until enough history. */
  change24hPct?: number
  /** 24h volume in quote notional (human units), or undefined if never traded. */
  volume24h?: number
  /** Open interest = sum of ACTIVE position sizes (base units), or undefined. */
  openInterest?: number
  /** Funding rate percent, or undefined until the engine computes it. */
  fundingRatePct?: number
  /** Next funding boundary, unix ms, or undefined. */
  nextFundingTime?: number
  status: FeedStatus
}

export function useTicker({ market }: { market?: string }): UseTicker {
  const enabled = Boolean(market)

  const query = useQuery({
    queryKey: ['perps-ticker', market],
    queryFn: ({ signal }) => perpsEngine.getTicker(market as string, signal),
    enabled,
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 2_000,
  })

  return useMemo<UseTicker>(() => {
    const t = query.data

    let status: FeedStatus
    if (!enabled) {
      status = 'idle'
    } else if (query.isError && !t) {
      status = 'unavailable'
    } else if (!t && query.isLoading) {
      status = 'loading'
    } else if (t) {
      status = 'live'
    } else {
      status = 'polling'
    }

    return {
      ticker: t,
      mark: from1e18(t?.mark),
      indexPrice: from1e18(t?.indexPrice),
      change24hPct: t?.change24h ?? undefined,
      volume24h: from1e18(t?.volume24h),
      openInterest: from1e18(t?.openInterest),
      fundingRatePct: t?.fundingRate ?? undefined,
      nextFundingTime: t?.nextFundingTime ?? undefined,
      status,
    }
  }, [query.data, query.isError, query.isLoading, enabled])
}
