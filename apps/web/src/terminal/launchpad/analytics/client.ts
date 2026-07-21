/**
 * HookSwap LaunchPad Analytics — indexer API client (typed fetch).
 *
 * The launchpad indexer is a read-only data service that enumerates every fair-launch
 * (HookOSV3Launcher children) across the HookSwap chains, aggregates globally + per
 * chain, and prices each launch's market cap where a USD anchor exists. This module is
 * the SINGLE place the terminal talks to the launchpad side of it.
 *
 * BASE URL: reuses the locker indexer base (`LOCKER_API_URL`, default
 * `https://data.hookswap.org/locker`) — the launchpad endpoints live under the SAME
 * service/base as the locker (and farms). Change the base via env `LOCKER_API_URL`
 * (see the locker client). LaunchPad endpoints:
 *   GET /launches/stats                                   → LaunchesStats
 *   GET /launches?chainId=&sort=mcap|created&limit=&offset= → LaunchesResponse
 *   GET /launch/:chainId/:token                           → { launch: Launch }  (by token addr)
 *   GET /launch/:chainId/:id                              → { launch: Launch }  (by numeric id)
 *
 * DATA POLICY (facts-only, no fabricated data): every call returns real indexer data
 * or throws / signals unreachable. USD fields (`marketCapUsd` / `totalMarketCapUsd`)
 * are OMITTED by the indexer when a value can't be priced (only chains with a USD
 * anchor price) — callers render an honest "—", never $0 or a fabricated market cap.
 */
import { LOCKER_API_URL } from '~/terminal/lockers/analytics/client'

/** The launchpad indexer shares the locker service base URL. */
export const LAUNCHPAD_API_URL: string = LOCKER_API_URL

/* ------------------------------------------------------------------ wire types */

/** `{ raw, formatted }` — `raw` is the base-unit integer as a STRING (no precision loss). */
export interface LaunchAmount {
  raw: string
  formatted: string
}

/** The launched token's on-chain metadata. */
export interface LaunchToken {
  addr: string
  name: string
  symbol: string
  decimals: number
  totalSupply: LaunchAmount
}

/** One launch from `GET /launches` / `GET /launch/:chainId/:token`. */
export interface Launch {
  chainId: number
  chainName: string
  id: number
  token: LaunchToken
  pool: string
  creator: string
  tokenId: string
  feeTier: number
  /** DEX enum from the launcher (0 = Uniswap V3, 1 = HookSwap). */
  dex: number
  /** Pair-token enum from the launcher (0 = WETH, 1 = HOOK). */
  pair?: number
  pairToken: string
  metadataURI: string
  createdAt: number
  /** Whether the launch's LP is locked in the fee vault. */
  lpLocked?: boolean
  lpUnlockTime?: number
  /** Omitted when the token can't be priced (no USD anchor on the chain). */
  marketCapUsd?: number
}

export interface LaunchesResponse {
  total: number
  offset: number
  limit: number
  launches: Launch[]
}

/** One chain's index status inside `GET /launches/stats` → `perChain`. */
export interface LaunchesChainStatus {
  chainId: number
  name: string
  launcher: string
  feeVault: string
  rpcUrl: string
  reachable: boolean
  stale: boolean
  error?: string | null
  launchCount: number
  lastIndexedAt: number
}

/** `GET /launches/stats` — global stats + per-chain breakdown. `totalMarketCapUsd` omitted when unpriceable. */
export interface LaunchesStats {
  generatedAt: number
  totalLaunches: number
  lpLockedLaunches: number
  /** Omitted if nothing could be priced. */
  totalMarketCapUsd?: number
  chains: number
  reachableChains: number
  perChain: LaunchesChainStatus[]
}

/* ------------------------------------------------------------------ errors + fetch */

export class LaunchpadApiError extends Error {
  readonly status?: number
  readonly unreachable: boolean
  constructor(message: string, opts?: { status?: number; unreachable?: boolean }) {
    super(message)
    this.name = 'LaunchpadApiError'
    this.status = opts?.status
    this.unreachable = opts?.unreachable ?? false
  }
}

const DEFAULT_TIMEOUT_MS = 10_000

function withQuery(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(LAUNCHPAD_API_URL + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') {
        url.searchParams.set(k, String(v))
      }
    }
  }
  return url.toString()
}

async function launchpadFetch<T>(
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
    throw new LaunchpadApiError(e instanceof Error ? e.message : 'LaunchPad API unreachable', { unreachable: true })
  }
  clearTimeout(timer)
  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      /* ignore body read errors */
    }
    throw new LaunchpadApiError(detail || `LaunchPad API responded ${res.status}`, { status: res.status })
  }
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ REST methods */

export const launchpadApi = {
  baseUrl: LAUNCHPAD_API_URL,

  getStats(signal?: AbortSignal): Promise<LaunchesStats> {
    return launchpadFetch<LaunchesStats>('/launches/stats', { signal })
  },

  getLaunches(
    params: { chainId?: number; sort?: 'mcap' | 'created'; limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<LaunchesResponse> {
    return launchpadFetch<LaunchesResponse>('/launches', { params, signal })
  },

  /**
   * Single launch by chain + token (`GET /launch/:chainId/:token`). `token` may be the
   * launched token ADDRESS (the shareable URL) or the numeric launch id — the indexer
   * accepts both. Returns the real `Launch` or throws `LaunchpadApiError` (`status: 404`
   * when unknown; `unreachable: true` when the indexer is offline). Never fabricates.
   */
  getLaunch(chainId: number, token: string, signal?: AbortSignal): Promise<Launch> {
    return launchpadFetch<{ launch: Launch }>(`/launch/${chainId}/${token}`, { signal }).then((r) => r.launch)
  },
}
