/**
 * HookSwap Farms Analytics — indexer API client (typed fetch).
 *
 * The farms indexer is a read-only data service that enumerates every staking farm
 * (StakingRewards children) across the 7 HookSwap chains, aggregates globally + per
 * chain, and records a daily snapshot. This module is the SINGLE place the terminal
 * talks to the farms side of it.
 *
 * BASE URL: reuses the locker indexer base (`LOCKER_API_URL`, default
 * `https://data.hookswap.org/locker`) — the farms endpoints live under the SAME
 * service/base as the locker. Change the base via env `LOCKER_API_URL` (see the
 * locker client). Farms endpoints:
 *   GET /farms/stats                                     → FarmsStats
 *   GET /farms/tvl-history                               → { points: FarmsSnapshot[] }
 *   GET /farms?chainId=&sort=tvl|apr&limit=&offset=      → FarmsResponse
 *   GET /farm/:chainId/:address                          → { farm: Farm }
 *
 * DATA POLICY (facts-only, no fabricated data): every call returns real indexer data
 * or throws / signals unreachable. USD fields (`tvlUsd` / `totalTvlUsd`) and `aprPct`
 * are OMITTED by the indexer when a value can't be priced (only chains with a USD
 * anchor price) — callers render an honest "—", never $0 or a fabricated APR.
 */
import { LOCKER_API_URL } from '~/terminal/lockers/analytics/client'

/** The farms indexer shares the locker service base URL. */
export const FARMS_API_URL: string = LOCKER_API_URL

/* ------------------------------------------------------------------ wire types */

/** `{ raw, formatted }` — `raw` is the base-unit integer as a STRING (no precision loss). */
export interface FarmsAmount {
  raw: string
  formatted: string
}

/** A token leg of a farm (staking or reward token). */
export interface FarmToken {
  addr: string
  symbol: string
  decimals: number
}

/** One farm from `GET /farms` / `GET /farm/:chainId/:address`. */
export interface Farm {
  chainId: number
  chainName: string
  factory: string
  farm: string
  stakingToken: FarmToken
  rewardToken: FarmToken
  tvlStaked: FarmsAmount
  /** Omitted when the staked token can't be priced (no USD anchor on the chain). */
  tvlUsd?: number
  rewardRatePerSec: FarmsAmount
  rewardsDuration: number
  periodFinish: number
  rewardsRemaining: FarmsAmount
  rewardBudget: FarmsAmount
  status: 'active' | 'ended'
  /** Omitted when unpriceable — never fabricate a yield %. */
  aprPct?: number
}

export interface FarmsResponse {
  total: number
  offset: number
  limit: number
  farms: Farm[]
}

/** One chain's index status inside `GET /farms/stats` → `perChain`. */
export interface FarmsChainStatus {
  chainId: number
  name: string
  factories: string[]
  rpcUrl: string
  reachable: boolean
  stale: boolean
  error?: string | null
  farmCount: number
  activeFarmCount: number
  lastIndexedAt: number
}

/** `GET /farms/stats` — global stats + per-chain breakdown. `totalTvlUsd` omitted when unpriceable. */
export interface FarmsStats {
  generatedAt: number
  totalFarms: number
  activeFarms: number
  /** Omitted if nothing could be priced. */
  totalTvlUsd?: number
  chains: number
  reachableChains: number
  perChain: FarmsChainStatus[]
}

/** One day's farms snapshot from `GET /farms/tvl-history`. `totalTvlUsd`/`tvlUsd` omitted when unpriceable. */
export interface FarmsSnapshot {
  dateISO: string
  updatedAt: number
  totalFarms: number
  activeFarms: number
  totalTvlUsd?: number
  perChain: {
    chainId: number
    name: string
    totalFarms: number
    activeFarms: number
    tvlUsd?: number
    reachable: boolean
  }[]
}

export interface FarmsTvlHistoryResponse {
  points: FarmsSnapshot[]
}

/* ------------------------------------------------------------------ errors + fetch */

export class FarmsApiError extends Error {
  readonly status?: number
  readonly unreachable: boolean
  constructor(message: string, opts?: { status?: number; unreachable?: boolean }) {
    super(message)
    this.name = 'FarmsApiError'
    this.status = opts?.status
    this.unreachable = opts?.unreachable ?? false
  }
}

const DEFAULT_TIMEOUT_MS = 10_000

function withQuery(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(FARMS_API_URL + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') {
        url.searchParams.set(k, String(v))
      }
    }
  }
  return url.toString()
}

async function farmsFetch<T>(
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
    throw new FarmsApiError(e instanceof Error ? e.message : 'Farms API unreachable', { unreachable: true })
  }
  clearTimeout(timer)
  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      /* ignore body read errors */
    }
    throw new FarmsApiError(detail || `Farms API responded ${res.status}`, { status: res.status })
  }
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ REST methods */

export const farmsApi = {
  baseUrl: FARMS_API_URL,

  getStats(signal?: AbortSignal): Promise<FarmsStats> {
    return farmsFetch<FarmsStats>('/farms/stats', { signal })
  },

  getTvlHistory(signal?: AbortSignal): Promise<FarmsTvlHistoryResponse> {
    return farmsFetch<FarmsTvlHistoryResponse>('/farms/tvl-history', { signal })
  },

  getFarms(
    params: { chainId?: number; sort?: 'tvl' | 'apr'; limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<FarmsResponse> {
    return farmsFetch<FarmsResponse>('/farms', { params, signal })
  },

  /**
   * Single farm by chain + address (`GET /farm/:chainId/:address`). Returns the real
   * `Farm` or throws `FarmsApiError` (`status: 404` when unknown; `unreachable: true`
   * when the indexer is offline). Never fabricates a farm.
   */
  getFarm(chainId: number, address: string, signal?: AbortSignal): Promise<Farm> {
    return farmsFetch<{ farm: Farm }>(`/farm/${chainId}/${address}`, { signal }).then((r) => r.farm)
  },
}
