/**
 * HookSwapPerps — OHLC candles from the engine `GET /candles`.
 *
 * The engine builds candles from its mark-price series (sampled from each market's
 * Chainlink refFeed) plus settled trade prints, bucketed by interval. Prices arrive
 * as 1e18 strings; this hook parses them into the numeric `Candle` the chart draws.
 * The list is empty until data accrues — an honest "building as trades occur" state,
 * never fabricated candles.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { perpsEngine, type CandleInterval, type EngineCandle } from '~/terminal/perps/engine/client'
import type { Candle } from '~/terminal/screens/perps/PerpsChart'
import type { FeedStatus } from '~/terminal/perps/engine/useOrderbook'

function parseCandle(c: EngineCandle): Candle | undefined {
  const o = Number(c.o) / 1e18
  const h = Number(c.h) / 1e18
  const l = Number(c.l) / 1e18
  const close = Number(c.c) / 1e18
  if (![o, h, l, close].every((n) => Number.isFinite(n) && n > 0)) {
    return undefined
  }
  return { o, h, l, c: close }
}

export interface UseCandles {
  candles: Candle[]
  status: FeedStatus
}

export function useCandles({
  market,
  interval = '1m',
  limit = 200,
}: {
  market?: string
  interval?: CandleInterval
  limit?: number
}): UseCandles {
  const enabled = Boolean(market)

  const query = useQuery({
    queryKey: ['perps-candles', market, interval, limit],
    queryFn: ({ signal }) => perpsEngine.getCandles(market as string, interval, limit, signal),
    enabled,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 5_000,
  })

  return useMemo<UseCandles>(() => {
    const candles = (query.data ?? []).map(parseCandle).filter((c): c is Candle => c !== undefined)

    let status: FeedStatus
    if (!enabled) {
      status = 'idle'
    } else if (query.isError && !candles.length) {
      status = 'unavailable'
    } else if (!query.data && query.isLoading) {
      status = 'loading'
    } else {
      status = candles.length ? 'live' : 'polling'
    }

    return { candles, status }
  }, [query.data, query.isError, query.isLoading, enabled])
}
