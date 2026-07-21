/**
 * HookSwap Locker Analytics — indexer API client (typed fetch).
 *
 * The locker indexer is the read-only data service (Phase 1) that enumerates every
 * token / LP lock across the 7 HookSwap chains, aggregates per-token / per-pool /
 * globally, and records a daily TVL snapshot. This module is the SINGLE place the
 * terminal talks to it.
 *
 * CONFIG POINT — `LOCKER_API_URL` (one-line change):
 *   Resolved from `process.env.LOCKER_API_URL` (or `VITE_LOCKER_API_URL`), falling
 *   back to `https://data.hookswap.org/locker`. This repo injects env vars as
 *   `process.env.*` via Vite `define` (see apps/web/vite.config.mts) and does NOT
 *   type `import.meta.env`, so we read `process.env` (mirrors the perps engine
 *   client) to stay tsc-clean while keeping the same "set one env var" ergonomics.
 *
 * DATA POLICY: every call returns real indexer data or throws / signals unreachable.
 * Nothing here fabricates a lock, price, or TVL. USD fields (`valueUsd` / `tvlUsd` /
 * `totalTvlUsd`) are OMITTED by the indexer when a value can't be priced — callers
 * render an honest "—", never $0 or a fabricated number.
 *
 * The endpoint contract is FIXED (see locker-indexer/README.md):
 *   GET /stats                                   → LockerStats
 *   GET /tvl-history                             → { points: TVLSnapshot[] }
 *   GET /tokens                                  → { total, tokens: TokenAgg[] }
 *   GET /pools                                   → { total, pools: PoolAgg[] }
 *   GET /locks?chainId=&sort=tvl|created&limit=&offset= → { total, offset, limit, locks: Lock[] }
 */

const DEFAULT_LOCKER_API_URL = 'https://data.hookswap.org/locker'

function readEnv(key: string): string | undefined {
  // Read via globalThis so this typechecks under the Terminal tsconfig (which does not
  // include @types/node). Vite injects `process.env.*` at build time via `define`.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return env ? env[key] : undefined
}

/** The locker indexer base URL. Change via env `LOCKER_API_URL` or the default above. */
export const LOCKER_API_URL: string = (
  readEnv('LOCKER_API_URL') ||
  readEnv('VITE_LOCKER_API_URL') ||
  DEFAULT_LOCKER_API_URL
).replace(/\/+$/, '')

/* ------------------------------------------------------------------ wire types */

/** `{ raw, formatted }` — `raw` is the base-unit integer as a STRING (no precision loss). */
export interface LockerAmount {
  raw: string
  formatted: string
}

/** One chain's index status inside `GET /stats` → `perChain`. */
export interface LockerChainStatus {
  chainId: number
  name: string
  manager: string
  rpcUrl: string
  reachable: boolean
  stale: boolean
  error?: string | null
  lockCount: number
  /** Omitted when nothing on the chain could be priced. */
  tvlUsd?: number
  lastIndexedAt: number
}

/** `GET /stats` — global stats + per-chain breakdown. USD fields omitted when unpriceable. */
export interface LockerStats {
  generatedAt: number
  totalLocks: number
  /** Omitted if nothing could be priced. */
  totalTvlUsd?: number
  pricedLocks: number
  unpricedLocks: number
  newLocks24h: number
  chains: number
  reachableChains: number
  perChain: LockerChainStatus[]
}

/** One day's TVL snapshot from `GET /tvl-history`. `totalTvlUsd` omitted when unpriceable. */
export interface TVLSnapshot {
  dateISO: string
  updatedAt: number
  totalTvlUsd?: number
  totalLocks: number
  perChain: {
    chainId: number
    name: string
    totalLocks: number
    tvlUsd?: number
    reachable: boolean
  }[]
}

export interface TVLHistoryResponse {
  points: TVLSnapshot[]
}

/** Per-token aggregate (non-LP locks grouped per token, per chain). `tvlUsd` omitted when unpriceable. */
export interface TokenAgg {
  chainId: number
  chainName: string
  token: string
  symbol: string
  decimals: number
  totalLockedAmount: LockerAmount
  totalSupply: LockerAmount
  /** Percent of supply locked (e.g. 42.0 = 42%). `null` when totalSupply is 0. */
  lockedPctOfSupply: number | null
  tvlUsd?: number
  lockCount: number
}

export interface TokensResponse {
  total: number
  tokens: TokenAgg[]
}

/** Per-pool aggregate (LP locks grouped per pair token, per chain). `tvlUsd` omitted when unpriceable. */
export interface PoolAgg {
  chainId: number
  chainName: string
  pair: string
  symbol: string
  token0: string
  token1: string
  token0Symbol: string
  token1Symbol: string
  totalLockedAmount: LockerAmount
  tvlUsd?: number
  lockCount: number
}

export interface PoolsResponse {
  total: number
  pools: PoolAgg[]
}

/** One lock from `GET /locks`. */
export interface Lock {
  chainId: number
  chainName: string
  id: number
  lockerContract: string
  token: string
  symbol: string
  decimals: number
  isLpToken: boolean
  owner: string
  createdBy: string
  createdAt: number
  unlockTime: number
  amount: LockerAmount
  totalSupply: LockerAmount
  lockedPctOfSupply: number | null
  valueUsd?: number
  status: 'locked' | 'unlockable'
  lp?: {
    token0: { token: string; symbol: string; decimals: number; balance: LockerAmount; valueUsd?: number }
    token1: { token: string; symbol: string; decimals: number; balance: LockerAmount; valueUsd?: number }
  }
}

export interface LocksResponse {
  total: number
  offset: number
  limit: number
  locks: Lock[]
}

/* ------------------------------------------------------------------ errors + fetch */

export class LockerApiError extends Error {
  readonly status?: number
  readonly unreachable: boolean
  constructor(message: string, opts?: { status?: number; unreachable?: boolean }) {
    super(message)
    this.name = 'LockerApiError'
    this.status = opts?.status
    this.unreachable = opts?.unreachable ?? false
  }
}

const DEFAULT_TIMEOUT_MS = 10_000

function withQuery(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(LOCKER_API_URL + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') {
        url.searchParams.set(k, String(v))
      }
    }
  }
  return url.toString()
}

async function lockerFetch<T>(
  path: string,
  opts: { params?: Record<string, string | number | undefined>; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const { params, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  let res: Response
  try {
    res = await fetch(withQuery(path, params), { signal: controller.signal })
  } catch (e) {
    clearTimeout(timer)
    // Network-level failure (offline, DNS, CORS, timeout) → unreachable, never fabricate.
    throw new LockerApiError(e instanceof Error ? e.message : 'Locker API unreachable', { unreachable: true })
  }
  clearTimeout(timer)
  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      /* ignore body read errors */
    }
    throw new LockerApiError(detail || `Locker API responded ${res.status}`, { status: res.status })
  }
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ REST methods */

export const lockerApi = {
  baseUrl: LOCKER_API_URL,

  getStats(signal?: AbortSignal): Promise<LockerStats> {
    return lockerFetch<LockerStats>('/stats', { signal })
  },

  getTvlHistory(signal?: AbortSignal): Promise<TVLHistoryResponse> {
    return lockerFetch<TVLHistoryResponse>('/tvl-history', { signal })
  },

  getTokens(signal?: AbortSignal): Promise<TokensResponse> {
    return lockerFetch<TokensResponse>('/tokens', { signal })
  },

  getPools(signal?: AbortSignal): Promise<PoolsResponse> {
    return lockerFetch<PoolsResponse>('/pools', { signal })
  },

  getLocks(
    params: { chainId?: number; sort?: 'tvl' | 'created'; limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<LocksResponse> {
    return lockerFetch<LocksResponse>('/locks', { params, signal })
  },

  /**
   * Single lock by chain + id — the public proof-of-lock detail (`GET /lock/:chainId/:id`).
   * Returns the real `Lock` or throws `LockerApiError` (`status: 404` when the lock doesn't
   * exist; `unreachable: true` when the indexer is offline). Never fabricates a lock.
   */
  getLock(chainId: number, id: number, signal?: AbortSignal): Promise<Lock> {
    return lockerFetch<{ lock: Lock }>(`/lock/${chainId}/${id}`, { signal }).then((r) => r.lock)
  },
}
