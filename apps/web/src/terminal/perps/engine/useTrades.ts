/**
 * HookSwapPerps — recent trades feed (poll + WebSocket).
 *
 * Seeds from `GET /trades?market=&limit=` and prepends real-time `type:'trade'` frames
 * from `/stream`. The most recent trade's price also serves as the desk's mark-price
 * proxy (the fixed engine contract has no dedicated ticker endpoint — see note in the
 * screen). Nothing is fabricated — no feed → empty list + "No trades yet".
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { openPerpsStream, perpsEngine, type EngineTrade } from '~/terminal/perps/engine/client'
import type { Trade } from '~/terminal/screens/perps/TradesFeed'
import type { FeedStatus } from '~/terminal/perps/engine/useOrderbook'

const MAX_TRADES = 40

/** 1e18-scaled decimal string → number (matches the engine's contract precision). */
const WAD = 1e18

function toTime(ts?: number): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) {
    return ''
  }
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) {
    return ''
  }
  return d.toLocaleTimeString('en-US', { hour12: false })
}

function parseTrade(t: EngineTrade): Trade | undefined {
  // A failed live-settlement still emits a frame (settled:false) — never print it as a fill.
  if (t.settled === false) {
    return undefined
  }
  const price = Number(t.matchPrice) / WAD
  const size = Number(t.matchSize) / WAD
  if (!Number.isFinite(price) || !Number.isFinite(size)) {
    return undefined
  }
  // Aggressor (taker) side drives the tape tint: taker long = buy, taker short = sell.
  return { price, size, time: toTime(t.ts), side: t.takerIsLong ? 'buy' : 'sell' }
}

export interface UseTrades {
  trades: Trade[]
  /** Last trade price — the mark-price proxy for the stat bar. */
  lastPrice?: number
  status: FeedStatus
}

export function useTrades({ market, limit = MAX_TRADES }: { market?: string; limit?: number }): UseTrades {
  const enabled = Boolean(market)

  const query = useQuery({
    queryKey: ['perps-trades', market, limit],
    queryFn: ({ signal }) => perpsEngine.getTrades(market as string, limit, signal),
    enabled,
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 2_000,
  })

  const [live, setLive] = useState<Trade[]>([])
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'disconnected'>('disconnected')

  useEffect(() => {
    if (!market) {
      setLive([])
      return
    }
    setLive([])
    const ctrl = openPerpsStream(market, {
      onMessage: (msg) => {
        // Server frame shape: { type:'trade', trade: <serializedTrade> } (server.ts:291).
        if (msg.type === 'trade') {
          const raw = (msg as { trade?: EngineTrade }).trade
          const parsed = raw ? parseTrade(raw) : undefined
          if (parsed) {
            setLive((prev) => [parsed, ...prev].slice(0, limit))
          }
        }
      },
      onStatus: setWsStatus,
    })
    return () => ctrl.close()
  }, [market, limit])

  return useMemo<UseTrades>(() => {
    // Defensive: getTrades already unwraps to an array, but never assume the shape at the .map.
    const seeded = (Array.isArray(query.data) ? query.data : [])
      .map(parseTrade)
      .filter((t): t is Trade => t !== undefined)
    // Live frames first, then the polled seed, de-duped by the initial cap.
    const trades = [...live, ...seeded].slice(0, limit)
    const lastPrice = trades.length ? trades[0].price : undefined

    let status: FeedStatus
    if (!enabled) {
      status = 'idle'
    } else if (query.isError && !trades.length) {
      status = 'unavailable'
    } else if (!query.data && query.isLoading && !live.length) {
      status = 'loading'
    } else if (wsStatus === 'open') {
      status = 'live'
    } else {
      status = 'polling'
    }

    return { trades, lastPrice, status }
  }, [live, query.data, query.isError, query.isLoading, wsStatus, enabled, limit])
}
