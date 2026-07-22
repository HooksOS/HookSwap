// ─── Main client ───────────────────────────────────────────────────────
export { HookSwap, DEFAULT_DATA_BASE_URL, DEFAULT_TRADING_BASE_URL } from './client.js'
export type { HookSwapOptions } from './client.js'

// ─── Modules ─────────────────────────────────────────────────────────────
export { DataModule } from './modules/data.js'
export { SwapModule } from './modules/swap.js'
export { LaunchModule } from './modules/launch.js'
export type { HookOSHandle } from './modules/launch.js'
export { FeesModule } from './modules/fees.js'
export type { FeeShare } from './modules/fees.js'
export { LockerModule } from './modules/locker.js'
export type { CreateLockParams } from './modules/locker.js'
export { FarmsModule } from './modules/farms.js'
export type { CreateFarmParams } from './modules/farms.js'
export { VestingModule } from './modules/vesting.js'
export type { CreateScheduleParams } from './modules/vesting.js'

// ─── Chains ────────────────────────────────────────────────────────────────
export {
  HOOKSWAP_CHAIN_IDS,
  HOOKSWAP_CHAIN_ID_LIST,
  HOOKSWAP_CHAINS,
  DEFAULT_RPC,
  isHookSwapChain,
  getHookSwapChain,
} from './chains.js'
export type { HookSwapChainId } from './chains.js'

// ─── Addresses (self-service suite) ─────────────────────────────────────────
export {
  LOCKER_ADDRESSES,
  FARM_FACTORY_ADDRESSES,
  VESTING_ADDRESSES,
  getLockerAddresses,
  getFarmFactory,
  getVestingAddress,
} from './addresses.js'
export type { LockerAddresses } from './addresses.js'

// ─── ABIs (write-op fragments) ──────────────────────────────────────────────
export { TokenLockerManagerABI, V3PositionLockerABI } from './abis/locker.js'
export { StakingRewardsFactoryABI, StakingRewardsABI } from './abis/farms.js'
export { VestingManagerABI, VestingChildABI } from './abis/vesting.js'

// ─── Errors ──────────────────────────────────────────────────────────────
export {
  HookSwapError,
  WalletRequiredError,
  ChainError,
  NotImplementedError,
  HttpApiError,
} from './errors.js'

// ─── Data (indexer) types ────────────────────────────────────────────────
export type {
  Amount,
  LockerStats,
  LockerChainStatus,
  TVLSnapshot,
  TVLHistoryResponse,
  TokenAgg,
  TokensResponse,
  PoolAgg,
  PoolsResponse,
  Lock,
  LocksResponse,
  LocksParams,
  Farm,
  FarmToken,
  FarmsResponse,
  FarmsChainStatus,
  FarmsStats,
  FarmsSnapshot,
  FarmsTvlHistoryResponse,
  FarmsParams,
  VestingToken,
  VestingStatus,
  VestingSchedule,
  VestingResponse,
  VestingChainStatus,
  VestingStats,
  VestingSnapshot,
  VestingTvlHistoryResponse,
  VestingSort,
  VestingParams,
  LaunchToken,
  Launch,
  LaunchesResponse,
  LaunchesChainStatus,
  LaunchesStats,
  LaunchesParams,
  HookSwapStats,
} from './modules/data-types.js'

// ─── Swap (trading adapter) types ──────────────────────────────────────────
export {
  TradeType,
  Routing,
  ProtocolItems,
  RoutingPreference,
} from './modules/swap-types.js'
export type {
  ChainId as SwapChainId,
  QuoteRequest,
  QuoteResponse,
  ClassicQuote,
  QuoteInput,
  QuoteOutput,
  PoolInRoute,
  V2PoolInRoute,
  V3PoolInRoute,
  V2Reserve,
  TokenInRoute,
  CreateSwapRequest,
  CreateSwapResponse,
  TransactionRequest,
  ApprovalRequest,
  ApprovalResponse,
  SwappableToken,
  GetSwappableTokensResponse,
} from './modules/swap-types.js'

// ─── Re-exported upstream launch/fees primitives (from @hookos/sdk) ─────────
// The launch engine's parameter + result types live in the upstream SDK. Re-export the
// commonly-needed ones so integrators don't have to depend on `@hookos/sdk` directly.
export type {
  CreateTokenParams,
  TokenInfo,
  TokenCreateResult,
  V3LaunchParams,
  V3LaunchResult,
  V3LaunchInfo,
  QuickLaunchOptions,
  QuickLaunchResult,
  StockLaunchOptions,
  StockLaunchResult,
  TxResult,
} from '@hookos/sdk'
