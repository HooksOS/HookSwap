/**
 * Wire types for the HookSwap indexer (data-api) — a headless mirror of the terminal clients:
 *   apps/web/src/terminal/lockers/analytics/client.ts
 *   apps/web/src/terminal/farms/analytics/client.ts
 *   apps/web/src/terminal/vesting/analytics/client.ts
 *   apps/web/src/terminal/launchpad/analytics/client.ts
 *
 * All four domains live under ONE service base (default `https://data.hookswap.org/locker`).
 *
 * DATA POLICY: USD fields (`valueUsd` / `tvlUsd` / `totalTvlUsd` / `marketCapUsd` / `aprPct`)
 * are OMITTED by the indexer when a value can't be priced — never $0, never fabricated.
 */

/** `{ raw, formatted }` — `raw` is the base-unit integer as a STRING (no precision loss). */
export interface Amount {
  raw: string
  formatted: string
}

/* ----------------------------------------------------------------- locker */

export interface LockerChainStatus {
  chainId: number
  name: string
  manager: string
  rpcUrl: string
  reachable: boolean
  stale: boolean
  error?: string | null
  lockCount: number
  tvlUsd?: number
  lastIndexedAt: number
}

export interface LockerStats {
  generatedAt: number
  totalLocks: number
  totalTvlUsd?: number
  pricedLocks: number
  unpricedLocks: number
  newLocks24h: number
  chains: number
  reachableChains: number
  perChain: LockerChainStatus[]
}

export interface TVLSnapshot {
  dateISO: string
  updatedAt: number
  totalTvlUsd?: number
  totalLocks: number
  perChain: { chainId: number; name: string; totalLocks: number; tvlUsd?: number; reachable: boolean }[]
}

export interface TVLHistoryResponse {
  points: TVLSnapshot[]
}

export interface TokenAgg {
  chainId: number
  chainName: string
  token: string
  symbol: string
  decimals: number
  totalLockedAmount: Amount
  totalSupply: Amount
  lockedPctOfSupply: number | null
  tvlUsd?: number
  lockCount: number
}

export interface TokensResponse {
  total: number
  tokens: TokenAgg[]
}

export interface PoolAgg {
  chainId: number
  chainName: string
  pair: string
  symbol: string
  token0: string
  token1: string
  token0Symbol: string
  token1Symbol: string
  totalLockedAmount: Amount
  tvlUsd?: number
  lockCount: number
}

export interface PoolsResponse {
  total: number
  pools: PoolAgg[]
}

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
  amount: Amount
  totalSupply: Amount
  lockedPctOfSupply: number | null
  valueUsd?: number
  status: 'locked' | 'unlockable'
  lp?: {
    token0: { token: string; symbol: string; decimals: number; balance: Amount; valueUsd?: number }
    token1: { token: string; symbol: string; decimals: number; balance: Amount; valueUsd?: number }
  }
}

export interface LocksResponse {
  total: number
  offset: number
  limit: number
  locks: Lock[]
}

export interface LocksParams {
  chainId?: number
  sort?: 'tvl' | 'created'
  limit?: number
  offset?: number
}

/* ----------------------------------------------------------------- farms */

export interface FarmToken {
  addr: string
  symbol: string
  decimals: number
}

export interface Farm {
  chainId: number
  chainName: string
  factory: string
  farm: string
  stakingToken: FarmToken
  rewardToken: FarmToken
  tvlStaked: Amount
  tvlUsd?: number
  rewardRatePerSec: Amount
  rewardsDuration: number
  periodFinish: number
  rewardsRemaining: Amount
  rewardBudget: Amount
  status: 'active' | 'ended'
  aprPct?: number
}

export interface FarmsResponse {
  total: number
  offset: number
  limit: number
  farms: Farm[]
}

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

export interface FarmsStats {
  generatedAt: number
  totalFarms: number
  activeFarms: number
  totalTvlUsd?: number
  chains: number
  reachableChains: number
  perChain: FarmsChainStatus[]
}

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

export interface FarmsParams {
  chainId?: number
  sort?: 'tvl' | 'apr'
  limit?: number
  offset?: number
}

/* ----------------------------------------------------------------- vesting */

export interface VestingToken {
  addr: string
  symbol: string
  decimals: number
}

export type VestingStatus = 'cliff' | 'vesting' | 'complete'

export interface VestingSchedule {
  chainId: number
  chainName: string
  id: number
  contractAddress: string
  token: VestingToken
  beneficiary: string
  creator: string
  start: number
  cliff: number
  duration: number
  cliffTime: number
  endTime: number
  totalAmount: Amount
  released: Amount
  claimable: Amount
  vested: Amount
  pctVested: number
  status: VestingStatus
  valueUsd?: number
}

export interface VestingResponse {
  total: number
  offset: number
  limit: number
  schedules: VestingSchedule[]
}

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

export interface VestingStats {
  generatedAt: number
  totalSchedules: number
  activeSchedules: number
  totalTvlUsd?: number
  chains: number
  reachableChains: number
  perChain: VestingChainStatus[]
}

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

export type VestingSort = 'tvl' | 'created' | 'ending' | 'pct'

export interface VestingParams {
  chainId?: number
  sort?: VestingSort
  limit?: number
  offset?: number
}

/* ----------------------------------------------------------------- launchpad */

export interface LaunchToken {
  addr: string
  name: string
  symbol: string
  decimals: number
  totalSupply: Amount
}

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
  lpLocked?: boolean
  lpUnlockTime?: number
  marketCapUsd?: number
}

export interface LaunchesResponse {
  total: number
  offset: number
  limit: number
  launches: Launch[]
}

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

export interface LaunchesStats {
  generatedAt: number
  totalLaunches: number
  lpLockedLaunches: number
  totalMarketCapUsd?: number
  chains: number
  reachableChains: number
  perChain: LaunchesChainStatus[]
}

export interface LaunchesParams {
  chainId?: number
  sort?: 'mcap' | 'created'
  limit?: number
  offset?: number
}

/** Aggregate of all four domains' top-level stats (one real fetch each). */
export interface HookSwapStats {
  locker: LockerStats
  farms: FarmsStats
  vesting: VestingStats
  launches: LaunchesStats
}
