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

/** One printed trade from `GET /trades`. */
export interface EngineTrade {
  price: string
  size: string
  /** Taker side. */
  side: 'buy' | 'sell'
  /** ISO timestamp or unix ms — rendered as a short time. */
  time?: string | number
  timestamp?: string | number
}

/** One open (resting) order from `GET /orders`. */
export interface EngineOpenOrder {
  orderId: string
  market: string
  trader: string
  isLong: boolean
  size: string
  leverage: string
  price: string
  orderType: number | string
  status?: string
  createdAt?: string | number
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

  getTrades(market: string, limit = 40, signal?: AbortSignal): Promise<EngineTrade[]> {
    return engineFetch<EngineTrade[]>('/trades', { params: { market, limit }, signal })
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

  cancelOrder(orderId: string, signal?: AbortSignal): Promise<void> {
    return engineFetch<void>(`/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE', signal })
  },
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
