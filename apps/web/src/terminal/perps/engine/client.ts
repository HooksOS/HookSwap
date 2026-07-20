/**
 * HookSwapPerps — matching-engine API client (typed fetch + WebSocket).
 *
 * The engine is the OFF-CHAIN half of the P2P perps system: it holds the live
 * order book, matches EIP-712-signed orders, settles on-chain, and streams book /
 * trade / fill updates. This module is the SINGLE place the terminal talks to it.
 *
 * CONFIG POINT — `PERPS_ENGINE_URL` (one-line change):
 *   Resolved from `process.env.PERPS_ENGINE_URL` (or `VITE_PERPS_ENGINE_URL`),
 *   falling back to `https://perps.hookswap.org`. This repo injects env vars as
 *   `process.env.*` via Vite `define` (see apps/web/vite.config.mts) and does NOT
 *   type `import.meta.env`, so we read `process.env` to stay tsc-clean while keeping
 *   the exact same "set one env var" ergonomics. To finalize the URL after the
 *   backend deploys: set `PERPS_ENGINE_URL` in apps/web/.env (or edit the default
 *   below) — nothing else changes.
 *
 * DATA POLICY: every call returns real engine data or throws / signals unreachable.
 * Nothing here fabricates a price, level, trade, or position. When the engine is
 * down, callers render honest "engine unavailable" states.
 *
 * The endpoint contract is FIXED (the backend implements exactly this):
 *   GET  /health
 *   GET  /markets                          → EngineMarket[]
 *   GET  /orderbook?market=<addr>          → EngineOrderbook
 *   POST /orders {order, signature}        → PlaceOrderResult
 *   DELETE /orders/:orderId
 *   GET  /orders?trader=&market=           → EngineOpenOrder[]
 *   GET  /positions?trader=&market=        → EnginePosition[]
 *   GET  /trades?market=&limit=            → EngineTrade[]
 *   WS   /stream?market=<addr>             → StreamMessage
 */

const DEFAULT_ENGINE_URL = 'https://perps.hookswap.org'

function readEnv(key: string): string | undefined {
  // Read via globalThis so this typechecks under the Terminal tsconfig (which does not
  // include @types/node). Vite injects `process.env.*` at build time via `define`.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return env ? env[key] : undefined
}

/** The matching-engine base URL. Change via env `PERPS_ENGINE_URL` or the default above. */
export const PERPS_ENGINE_URL: string =
  (readEnv('PERPS_ENGINE_URL') || readEnv('VITE_PERPS_ENGINE_URL') || DEFAULT_ENGINE_URL).replace(/\/+$/, '')

/* ------------------------------------------------------------------ wire types */

/** One market row from `GET /markets` (the engine reads MarketRegistry on-chain). */
export interface EngineMarket {
  /** Market clone address — the EIP-712 verifyingContract for orders on this market. */
  market: string
  /** Registry marketId. May be a human label OR the raw bytes32 keccak(label). */
  marketId: string
  /** Collateral token address the market settles in. */
  collateral: string
  /** MarketRegistry.Tier: 0 = curated, 1 = permissionless (number or label). */
  tier: number | string
  /** MarketRegistry.Status: 0 = active, 1 = paused, 2 = delisted (number or label). */
  status: number | string
  /** Optional human display label if the engine provides one (tolerated, not required). */
  symbol?: string
  label?: string
}

/** One order-book level (decimal strings, base/quote units the engine defines). */
export interface EngineLevel {
  price: string
  size: string
}

/** `GET /orderbook` response. */
export interface EngineOrderbook {
  bids: EngineLevel[]
  asks: EngineLevel[]
}

/**
 * One printed trade — the engine's `serializeTrade` shape EXACTLY (engine.ts:494).
 * A P2P match settles a long against a short; `matchPrice`/`matchSize` are 1e18-scaled
 * decimal strings and `ts` is unix ms. `takerIsLong` is the aggressor side (the incoming
 * order) — the honest buy/sell tint for the tape (older persisted trades may omit it).
 */
export interface EngineTrade {
  matchPrice: string
  matchSize: string
  takerIsLong?: boolean
  longTrader?: string
  shortTrader?: string
  token?: string
  settled?: boolean
  /** Unix ms the fill printed. */
  ts?: number
}

/** `GET /trades` response envelope. */
export interface EngineTradesResponse {
  market: string
  trades: EngineTrade[]
}

/**
 * `GET /ticker?market=` — live per-market stats. All price fields are quote-per-base
 * scaled 1e18 as decimal STRINGS; honest `null` where a value is not yet computable
 * (never fabricated). `mark`/`indexPrice` come from the market's on-chain Chainlink
 * refFeed (the same price the deviation guard enforces) when configured, else the
 * book-mid / last-trade for `mark` and `null` for `indexPrice`.
 */
export interface EngineTicker {
  market: string
  /** Mark price, 1e18 string, or null. */
  mark: string | null
  /** Oracle index price (Chainlink refFeed), 1e18 string, or null. */
  indexPrice: string | null
  /** 24h change percent (already ×100), or null until enough mark history. */
  change24h: number | null
  /** 24h volume in quote notional, 1e18 string, or null if the market never traded. */
  volume24h: string | null
  /** Open interest = sum of ACTIVE position sizes, 1e18 string, or null if unreadable. */
  openInterest: string | null
  /** Funding rate (fraction/pct) — null until computed by the engine. */
  fundingRate: number | null
  /** Next funding boundary, unix ms, or null. */
  nextFundingTime: number | null
}

/** One OHLC candle from `GET /candles`. Prices are 1e18 strings; `t` is unix ms. */
export interface EngineCandle {
  t: number
  o: string
  h: string
  l: string
  c: string
  /** Quote notional traded in the bucket, 1e18 string. */
  v: string
}

/** `GET /candles` response envelope. */
export interface EngineCandlesResponse {
  market: string
  interval: string
  candles: EngineCandle[]
}

/** Candle intervals the engine supports. */
export type CandleInterval = '1m' | '5m' | '1h'

/**
 * One open (resting) order from `GET /orders`.
 *
 * Mirrors the engine's `orderView` EXACTLY (perps-engine/src/server.ts:55) — the engine
 * derives `side` from `order.isLong`, exposes the unfilled `remaining`, maps `orderType`
 * to the `'LIMIT'|'MARKET'` label, and stamps `receivedAt = Date.now()` (unix ms).
 * `size`/`remaining`/`price` are 1e18-scaled decimal strings; `leverage` is 1e4-scaled.
 */
export interface EngineOpenOrder {
  orderId: string
  market: string
  trader: string
  /** Collateral/base token the order is on (engine `order.token`). */
  token: string
  /** Order side — engine maps `order.isLong` → 'long' | 'short'. */
  side: 'long' | 'short'
  /** Original order size — 1e18-scaled decimal string. */
  size: string
  /** Unfilled size remaining — 1e18-scaled decimal string. */
  remaining: string
  /** Leverage — 1e4-scaled decimal string. */
  leverage: string
  /** Limit price — 1e18-scaled decimal string (0 for a MARKET order). */
  price: string
  /** Order type label — engine maps `order.orderType === 1` → 'LIMIT', else 'MARKET'. */
  orderType: 'LIMIT' | 'MARKET'
  /** Order deadline — unix-seconds decimal string. */
  deadline: string
  /** Signer nonce — decimal string. */
  nonce: string
  /** Engine-side order status. */
  status: 'open' | 'matched' | 'cancelled'
  /** Unix ms the engine received the order (`Date.now()`). */
  receivedAt: number
}

/** One position from `GET /positions` (engine mirror of on-chain PairedPosition). */
export interface EnginePosition {
  pairId: string
  market: string
  side: 'long' | 'short'
  size: string
  entryPrice: string
  markPrice?: string
  liqPrice?: string
  uPnl?: string
  margin?: string
}

/** The EIP-712 order payload posted to `POST /orders` (integers as decimal strings). */
export interface EngineOrderPayload {
  trader: string
  token: string
  isLong: boolean
  size: string
  leverage: string
  price: string
  deadline: string
  nonce: string
  orderType: number
}

export interface PlaceOrderBody {
  /** The market clone address — the EIP-712 verifyingContract the engine recovers against. Required. */
  market: string
  order: EngineOrderPayload
  signature: string
}

export interface PlaceOrderResult {
  orderId: string
  status: string
  txHash?: string
}

/** WebSocket stream frame. */
export type StreamMessage =
  | ({ type: 'orderbook' } & EngineOrderbook)
  | ({ type: 'trade' } & EngineTrade)
  | { type: 'fill'; [k: string]: unknown }
  | { type: string; [k: string]: unknown }

/* ------------------------------------------------------------------ errors + fetch */

export class EngineError extends Error {
  readonly status?: number
  readonly unreachable: boolean
  constructor(message: string, opts?: { status?: number; unreachable?: boolean }) {
    super(message)
    this.name = 'EngineError'
    this.status = opts?.status
    this.unreachable = opts?.unreachable ?? false
  }
}

const DEFAULT_TIMEOUT_MS = 8_000

function withQuery(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(PERPS_ENGINE_URL + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') {
        url.searchParams.set(k, String(v))
      }
    }
  }
  return url.toString()
}

async function engineFetch<T>(
  path: string,
  opts: {
    method?: string
    params?: Record<string, string | number | undefined>
    body?: unknown
    signal?: AbortSignal
    timeoutMs?: number
  } = {},
): Promise<T> {
  const { method = 'GET', params, body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  let res: Response
  try {
    res = await fetch(withQuery(path, params), {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    // Network-level failure (offline, DNS, CORS, timeout) → unreachable, never fabricate.
    throw new EngineError(e instanceof Error ? e.message : 'Engine unreachable', { unreachable: true })
  }
  clearTimeout(timer)
  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      /* ignore body read errors */
    }
    throw new EngineError(detail || `Engine responded ${res.status}`, { status: res.status })
  }
  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ REST methods */

export const perpsEngine = {
  baseUrl: PERPS_ENGINE_URL,

  async health(signal?: AbortSignal): Promise<{ ok: boolean }> {
    await engineFetch<unknown>('/health', { signal, timeoutMs: 5_000 })
    return { ok: true }
  },

  getMarkets(signal?: AbortSignal): Promise<EngineMarket[]> {
    return engineFetch<EngineMarket[]>('/markets', { signal })
  },

  getOrderbook(market: string, signal?: AbortSignal): Promise<EngineOrderbook> {
    return engineFetch<EngineOrderbook>('/orderbook', { params: { market }, signal })
  },

  async getTrades(market: string, limit = 40, signal?: AbortSignal): Promise<EngineTrade[]> {
    // The engine returns an envelope { market, trades: [...] } — unwrap it (mirrors getCandles).
    const res = await engineFetch<EngineTradesResponse>('/trades', { params: { market, limit }, signal })
    return Array.isArray(res?.trades) ? res.trades : []
  },

  getTicker(market: string, signal?: AbortSignal): Promise<EngineTicker> {
    return engineFetch<EngineTicker>('/ticker', { params: { market }, signal })
  },

  async getCandles(
    market: string,
    interval: CandleInterval = '1m',
    limit = 200,
    signal?: AbortSignal,
  ): Promise<EngineCandle[]> {
    const res = await engineFetch<EngineCandlesResponse>('/candles', { params: { market, interval, limit }, signal })
    return Array.isArray(res?.candles) ? res.candles : []
  },

  getOpenOrders(params: { trader: string; market?: string }, signal?: AbortSignal): Promise<EngineOpenOrder[]> {
    return engineFetch<EngineOpenOrder[]>('/orders', { params, signal })
  },

  getPositions(params: { trader: string; market?: string }, signal?: AbortSignal): Promise<EnginePosition[]> {
    return engineFetch<EnginePosition[]>('/positions', { params, signal })
  },

  placeOrder(body: PlaceOrderBody, signal?: AbortSignal): Promise<PlaceOrderResult> {
    return engineFetch<PlaceOrderResult>('/orders', { method: 'POST', body, signal, timeoutMs: 15_000 })
  },

  /**
   * Cancel a resting order. The engine now AUTHENTICATES cancels: `signature` must be an
   * EIP-712 `Cancel` sig (see `cancelTypedData`) proving the caller owns the order —
   * without it the engine rejects (any actor could otherwise cancel any order by id).
   */
  cancelOrder(orderId: string, signature: string, signal?: AbortSignal): Promise<void> {
    return engineFetch<void>(`/orders/${encodeURIComponent(orderId)}`, {
      method: 'DELETE',
      params: { signature },
      signal,
    })
  },
}

/**
 * EIP-712 typed-data for an authenticated cancel — signed over the SAME per-market domain
 * as an order (verifyingContract = the market), recovered engine-side against the order's
 * owner. `orderId` is a unique single-use id, so a captured sig only re-cancels that same
 * (already-gone) order. Pass the result straight to wagmi `signTypedDataAsync`.
 */
export const CANCEL_TYPES = {
  Cancel: [
    { name: 'orderId', type: 'string' },
    { name: 'trader', type: 'address' },
  ],
} as const

export function cancelTypedData(params: { market: string; orderId: string; trader: string; chainId: number }) {
  return {
    domain: {
      name: 'HookSwapPerps',
      version: '1',
      chainId: params.chainId,
      verifyingContract: params.market as `0x${string}`,
    },
    types: CANCEL_TYPES,
    primaryType: 'Cancel' as const,
    message: { orderId: params.orderId, trader: params.trader as `0x${string}` },
  }
}

/* ------------------------------------------------------------------ WebSocket stream */

export interface StreamController {
  close(): void
}

/**
 * Open a resilient `/stream?market=` WebSocket. Auto-reconnects with capped backoff.
 * Emits parsed `StreamMessage`s and coarse connection status. Never fabricates data —
 * on failure it simply reports 'disconnected' and the caller keeps its last-known
 * (or empty) state. Returns a controller whose `close()` stops reconnection.
 */
export function openPerpsStream(
  market: string,
  handlers: {
    onMessage: (msg: StreamMessage) => void
    onStatus?: (status: 'connecting' | 'open' | 'disconnected') => void
  },
): StreamController {
  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  const wsBase = PERPS_ENGINE_URL.replace(/^http/i, 'ws')
  const url = `${wsBase}/stream?market=${encodeURIComponent(market)}`

  const connect = (): void => {
    if (closed) {
      return
    }
    handlers.onStatus?.('connecting')
    try {
      ws = new WebSocket(url)
    } catch {
      scheduleReconnect()
      return
    }
    ws.onopen = () => {
      attempt = 0
      handlers.onStatus?.('open')
    }
    ws.onmessage = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as StreamMessage
        if (parsed && typeof parsed === 'object' && typeof (parsed as { type?: unknown }).type === 'string') {
          handlers.onMessage(parsed)
        }
      } catch {
        /* ignore malformed frames — never guess their contents */
      }
    }
    ws.onerror = () => {
      ws?.close()
    }
    ws.onclose = () => {
      handlers.onStatus?.('disconnected')
      scheduleReconnect()
    }
  }

  const scheduleReconnect = (): void => {
    if (closed) {
      return
    }
    attempt += 1
    const delay = Math.min(1_000 * 2 ** Math.min(attempt, 5), 15_000)
    reconnectTimer = setTimeout(connect, delay)
  }

  connect()

  return {
    close(): void {
      closed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }
      if (ws) {
        ws.onclose = null
        ws.onerror = null
        ws.onmessage = null
        ws.onopen = null
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }
    },
  }
}
