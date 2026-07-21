/**
 * HookSwap Vesting Analytics — indexer API client (typed fetch).
 *
 * The vesting indexer is a read-only data service that enumerates every vesting
 * schedule (HookSwapVesting children of each chain's HookSwapVestingManager) across the
 * 7 HookSwap chains, aggregates globally + per chain, and records a daily snapshot.
 * This module is the SINGLE place the terminal talks to the vesting side of it.
 *
 * BASE URL: reuses the locker indexer base (`LOCKER_API_URL`, default
 * `https://data.hookswap.org/locker`) — the vesting endpoints live under the SAME
 * service/base as the locker + farms. Change the base via env `LOCKER_API_URL` (see the
 * locker client). Vesting endpoints:
 *   GET /vesting/stats                                            → VestingStats
 *   GET /vesting/tvl-history                                      → { points: VestingSnapshot[] }
 *   GET /vesting?chainId=&sort=tvl|created|ending|pct&limit=&offset= → VestingResponse
 *   GET /vesting/:chainId/:id                                     → { schedule: VestingSchedule }
 *
 * DATA POLICY (facts-only, no fabricated data): every call returns real indexer data
 * or throws / signals unreachable. USD fields (`valueUsd` / `totalTvlUsd`) are OMITTED
 * by the indexer when a value can't be priced (only chains with a USD anchor price) —
 * callers render an honest "—", never $0.
 */
import { LOCKER_API_URL } from '~/terminal/lockers/analytics/client'

/** The vesting indexer shares the locker service base URL. */
export const VESTING_API_URL: string = LOCKER_API_URL

/* ------------------------------------------------------------------ wire types */

/** `{ raw, formatted }` — `raw` is the base-unit integer as a STRING (no precision loss). */
export interface VestingAmount {
  raw: string
  formatted: string
}

/** The vesting token of a schedule. */
export interface VestingToken {
  addr: string
  symbol: string
  decimals: number
}

/** A schedule's lifecycle phase. */
export type VestingStatus = 'cliff' | 'vesting' | 'complete'

/** One schedule from `GET /vesting` / `GET /vesting/:chainId/:id`. */
export interface VestingSchedule {
  chainId: number
  chainName: string
  id: number
  contractAddress: string
  token: VestingToken
  beneficiary: string
  creator: string
  /** Unix seconds. */
  start: number
  /** Cliff duration in seconds (0 = no cliff). */
  cliff: number
  /** Total vesting duration in seconds. */
  duration: number
  /** Unix seconds — start + cliff. */
  cliffTime: number
  /** Unix seconds — start + duration. */
  endTime: number
  totalAmount: VestingAmount
  released: VestingAmount
  claimable: VestingAmount
  vested: VestingAmount
  /** 0–100. */
  pctVested: number
  status: VestingStatus
  /** Omitted when the token can't be priced (no USD anchor on the chain). */
  valueUsd?: number
}

export interface VestingResponse {
  total: number
  offset: number
  limit: number
  schedules: VestingSchedule[]
}

/** One chain's index status inside `GET /vesting/stats` → `perChain`. */
export interface VestingChainStatus {
  chainId: number
  name: string
  manager: string
  rpcUrl: string
  reachable: boolean
  stale: boolean
  error?: string | null
  scheduleCount: number
  activeCount: number
  lastIndexedAt: number
}

/** `GET /vesting/stats` — global stats + per-chain breakdown. `totalTvlUsd` omitted when unpriceable. */
export interface VestingStats {
  generatedAt: number
  totalSchedules: number
  activeSchedules: number
  /** Omitted if nothing could be priced. */
  totalTvlUsd?: number
  chains: number
  reachableChains: number
  perChain: VestingChainStatus[]
}

/** One day's vesting snapshot from `GET /vesting/tvl-history`. `totalTvlUsd`/`tvlUsd` omitted when unpriceable. */
export interface VestingSnapshot {
  dateISO: string
  updatedAt: number
  totalSchedules: number
  activeSchedules: number
  totalTvlUsd?: number
  perChain: {
    chainId: number
    name: string
    totalSchedules: number
    activeSchedules: number
    tvlUsd?: number
    reachable: boolean
  }[]
}

export interface VestingTvlHistoryResponse {
  points: VestingSnapshot[]
}

/** Server-side sort keys accepted by `GET /vesting`. */
export type VestingSort = 'tvl' | 'created' | 'ending' | 'pct'

/* ------------------------------------------------------------------ errors + fetch */

export class VestingApiError extends Error {
  readonly status?: number
  readonly unreachable: boolean
  constructor(message: string, opts?: { status?: number; unreachable?: boolean }) {
    super(message)
    this.name = 'VestingApiError'
    this.status = opts?.status
    this.unreachable = opts?.unreachable ?? false
  }
}

const DEFAULT_TIMEOUT_MS = 10_000

function withQuery(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(VESTING_API_URL + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') {
        url.searchParams.set(k, String(v))
      }
    }
  }
  return url.toString()
}

async function vestingFetch<T>(
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
    throw new VestingApiError(e instanceof Error ? e.message : 'Vesting API unreachable', { unreachable: true })
  }
  clearTimeout(timer)
  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      /* ignore body read errors */
    }
    throw new VestingApiError(detail || `Vesting API responded ${res.status}`, { status: res.status })
  }
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ REST methods */

export const vestingApi = {
  baseUrl: VESTING_API_URL,

  getStats(signal?: AbortSignal): Promise<VestingStats> {
    return vestingFetch<VestingStats>('/vesting/stats', { signal })
  },

  getTvlHistory(signal?: AbortSignal): Promise<VestingTvlHistoryResponse> {
    return vestingFetch<VestingTvlHistoryResponse>('/vesting/tvl-history', { signal })
  },

  getSchedules(
    params: { chainId?: number; sort?: VestingSort; limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<VestingResponse> {
    return vestingFetch<VestingResponse>('/vesting', { params, signal })
  },

  /**
   * Single schedule by chain + id (`GET /vesting/:chainId/:id`). Returns the real
   * `VestingSchedule` or throws `VestingApiError` (`status: 404` when unknown;
   * `unreachable: true` when the indexer is offline). Never fabricates a schedule.
   */
  getSchedule(chainId: number, id: number, signal?: AbortSignal): Promise<VestingSchedule> {
    return vestingFetch<{ schedule: VestingSchedule }>(`/vesting/${chainId}/${id}`, { signal }).then((r) => r.schedule)
  },
}
