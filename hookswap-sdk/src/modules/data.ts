/**
 * `data` — the HookSwap indexer / data-api module (pure HTTP, no wallet).
 *
 * Wraps the read-only indexer that enumerates every LOCK, FARM, VESTING schedule and
 * fair LAUNCH across the HookSwap chains. This is a headless mirror of the terminal's
 * four analytics clients — SAME base URL, SAME endpoints, SAME wire shapes:
 *
 *   locker:    GET /stats · /tvl-history · /tokens · /pools · /locks · /lock/:chainId/:id
 *   farms:     GET /farms/stats · /farms/tvl-history · /farms · /farm/:chainId/:addr
 *   vesting:   GET /vesting/stats · /vesting/tvl-history · /vesting · /vesting/:chainId/:id
 *   launchpad: GET /launches/stats · /launches · /launch/:chainId/:tokenOrId
 *
 * Default base: `https://data.hookswap.org/locker` (override via the client `dataBaseUrl`).
 *
 * Every method issues a REAL fetch and returns typed indexer data, or throws HttpApiError
 * (`status` for an HTTP error, `unreachable: true` for a network failure). Nothing is
 * fabricated — USD fields are omitted by the indexer when unpriceable.
 */
import { httpJson } from '../http.js'
import type {
  FarmsParams,
  FarmsResponse,
  FarmsStats,
  FarmsTvlHistoryResponse,
  Farm,
  HookSwapStats,
  LaunchesParams,
  LaunchesResponse,
  LaunchesStats,
  Launch,
  Lock,
  LocksParams,
  LocksResponse,
  LockerStats,
  PoolsResponse,
  TokensResponse,
  TVLHistoryResponse,
  VestingParams,
  VestingResponse,
  VestingSchedule,
  VestingStats,
  VestingTvlHistoryResponse,
} from './data-types.js'

export class DataModule {
  /** The resolved indexer base URL (e.g. `https://data.hookswap.org/locker`). */
  readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  private get<T>(path: string, params?: LocksParams | FarmsParams | VestingParams | LaunchesParams, signal?: AbortSignal): Promise<T> {
    return httpJson<T>(this.baseUrl, path, {
      params: params as Record<string, string | number | undefined>,
      signal,
    })
  }

  /* --------------------------------------------------------------- locker */

  /** `GET /stats` — global locker stats + per-chain breakdown. */
  lockerStats(signal?: AbortSignal): Promise<LockerStats> {
    return this.get<LockerStats>('/stats', undefined, signal)
  }

  /** `GET /tvl-history` — daily locker TVL snapshots. */
  lockerTvlHistory(signal?: AbortSignal): Promise<TVLHistoryResponse> {
    return this.get<TVLHistoryResponse>('/tvl-history', undefined, signal)
  }

  /** `GET /tokens` — per-token locked aggregates. */
  lockerTokens(signal?: AbortSignal): Promise<TokensResponse> {
    return this.get<TokensResponse>('/tokens', undefined, signal)
  }

  /** `GET /pools` — per-pool (LP) locked aggregates. */
  lockerPools(signal?: AbortSignal): Promise<PoolsResponse> {
    return this.get<PoolsResponse>('/pools', undefined, signal)
  }

  /** `GET /locks` — every lock, filterable + sortable. */
  locks(params: LocksParams = {}, signal?: AbortSignal): Promise<LocksResponse> {
    return this.get<LocksResponse>('/locks', params, signal)
  }

  /** `GET /lock/:chainId/:idOrToken` — single lock (proof-of-lock). Throws 404 when unknown. */
  lock(chainId: number, idOrToken: number | string, signal?: AbortSignal): Promise<Lock> {
    return httpJson<{ lock: Lock }>(this.baseUrl, `/lock/${chainId}/${idOrToken}`, { signal }).then((r) => r.lock)
  }

  /* --------------------------------------------------------------- farms */

  /** `GET /farms/stats` — global farms stats + per-chain breakdown. */
  farmsStats(signal?: AbortSignal): Promise<FarmsStats> {
    return this.get<FarmsStats>('/farms/stats', undefined, signal)
  }

  /** `GET /farms/tvl-history` — daily farms TVL snapshots. */
  farmsTvlHistory(signal?: AbortSignal): Promise<FarmsTvlHistoryResponse> {
    return this.get<FarmsTvlHistoryResponse>('/farms/tvl-history', undefined, signal)
  }

  /** `GET /farms` — every staking farm, filterable + sortable. */
  farms(params: FarmsParams = {}, signal?: AbortSignal): Promise<FarmsResponse> {
    return this.get<FarmsResponse>('/farms', params, signal)
  }

  /** `GET /farm/:chainId/:address` — single farm. Throws 404 when unknown. */
  farm(chainId: number, address: string, signal?: AbortSignal): Promise<Farm> {
    return httpJson<{ farm: Farm }>(this.baseUrl, `/farm/${chainId}/${address}`, { signal }).then((r) => r.farm)
  }

  /* --------------------------------------------------------------- vesting */

  /** `GET /vesting/stats` — global vesting stats + per-chain breakdown. */
  vestingStats(signal?: AbortSignal): Promise<VestingStats> {
    return this.get<VestingStats>('/vesting/stats', undefined, signal)
  }

  /** `GET /vesting/tvl-history` — daily vesting TVL snapshots. */
  vestingTvlHistory(signal?: AbortSignal): Promise<VestingTvlHistoryResponse> {
    return this.get<VestingTvlHistoryResponse>('/vesting/tvl-history', undefined, signal)
  }

  /** `GET /vesting` — every vesting schedule, filterable + sortable. */
  vesting(params: VestingParams = {}, signal?: AbortSignal): Promise<VestingResponse> {
    return this.get<VestingResponse>('/vesting', params, signal)
  }

  /** `GET /vesting/:chainId/:id` — single schedule. Throws 404 when unknown. */
  schedule(chainId: number, id: number, signal?: AbortSignal): Promise<VestingSchedule> {
    return httpJson<{ schedule: VestingSchedule }>(this.baseUrl, `/vesting/${chainId}/${id}`, { signal }).then(
      (r) => r.schedule,
    )
  }

  /* --------------------------------------------------------------- launchpad */

  /** `GET /launches/stats` — global launchpad stats + per-chain breakdown. */
  launchesStats(signal?: AbortSignal): Promise<LaunchesStats> {
    return this.get<LaunchesStats>('/launches/stats', undefined, signal)
  }

  /** `GET /launches` — every fair launch, filterable + sortable. */
  launches(params: LaunchesParams = {}, signal?: AbortSignal): Promise<LaunchesResponse> {
    return this.get<LaunchesResponse>('/launches', params, signal)
  }

  /** `GET /launch/:chainId/:tokenOrId` — single launch (by token address or numeric id). Throws 404 when unknown. */
  launch(chainId: number, tokenOrId: string | number, signal?: AbortSignal): Promise<Launch> {
    return httpJson<{ launch: Launch }>(this.baseUrl, `/launch/${chainId}/${tokenOrId}`, { signal }).then(
      (r) => r.launch,
    )
  }

  /* --------------------------------------------------------------- aggregate */

  /**
   * `stats()` — the four domains' top-level stats fetched in parallel (one real request each):
   * `{ locker, farms, vesting, launches }`. Any domain that errors rejects the whole call;
   * use the per-domain `*Stats()` methods if you want to tolerate partial availability.
   */
  async stats(signal?: AbortSignal): Promise<HookSwapStats> {
    const [locker, farms, vesting, launches] = await Promise.all([
      this.lockerStats(signal),
      this.farmsStats(signal),
      this.vestingStats(signal),
      this.launchesStats(signal),
    ])
    return { locker, farms, vesting, launches }
  }
}
