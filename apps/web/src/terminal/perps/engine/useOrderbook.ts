/**
 * HookSwapPerps — live order book (poll + WebSocket).
 *
 * Seeds from `GET /orderbook?market=` and then applies real-time `type:'orderbook'`
 * frames from the `/stream` WebSocket. Polling is the resilient baseline (also covers
 * the gap while the socket (re)connects); the socket makes it live. Levels are parsed
 * to numbers for rendering. Nothing is fabricated — no feed → empty book + honest state.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { openPerpsStream, perpsEngine, type EngineLevel, type EngineOrderbook } from '~/terminal/perps/engine/client'
import type { BookLevel } from '~/terminal/screens/perps/OrderBook'

export type FeedStatus = 'idle' | 'loading' | 'live' | 'polling' | 'unavailable'

function parseLevels(raw: EngineLevel[] | undefined): BookLevel[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((l) => ({ price: Number(l.price), size: Number(l.size) }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.size > 0)
}

export interface UseOrderbook {
  bids: BookLevel[]
  asks: BookLevel[]
  /** Best-bid/best-ask mid, or undefined when one side is empty. */
  mid?: number
  status: FeedStatus
}

export function useOrderbook({ market }: { market?: string }): UseOrderbook {
  const enabled = Boolean(market)

  const query = useQuery({
    queryKey: ['perps-orderbook', market],
    queryFn: ({ signal }) => perpsEngine.getOrderbook(market as string, signal),
    enabled,
    refetchInterval: 4_000,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 2_000,
  })

  // Live WebSocket overlay — replaces the polled snapshot when frames arrive.
  const [wsBook, setWsBook] = useState<EngineOrderbook | undefined>(undefined)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'disconnected'>('disconnected')

  useEffect(() => {
    if (!market) {
      setWsBook(undefined)
      return
    }
    setWsBook(undefined)
    const ctrl = openPerpsStream(market, {
      onMessage: (msg) => {
        if (msg.type === 'orderbook') {
          const ob = msg as unknown as EngineOrderbook
          setWsBook({ bids: ob.bids ?? [], asks: ob.asks ?? [] })
        }
      },
      onStatus: setWsStatus,
    })
    return () => ctrl.close()
  }, [market])

  return useMemo<UseOrderbook>(() => {
    const source = wsBook ?? query.data
    const bids = parseLevels(source?.bids).sort((a, b) => b.price - a.price)
    const asks = parseLevels(source?.asks).sort((a, b) => a.price - b.price)
    const mid = bids.length && asks.length ? (bids[0].price + asks[0].price) / 2 : undefined

    let status: FeedStatus
    if (!enabled) {
      status = 'idle'
    } else if (query.isError && !source) {
      status = 'unavailable'
    } else if (!source && query.isLoading) {
      status = 'loading'
    } else if (wsStatus === 'open') {
      status = 'live'
    } else {
      status = 'polling'
    }

    return { bids, asks, mid, status }
  }, [wsBook, query.data, query.isError, query.isLoading, wsStatus, enabled])
}
