/**
 * v2 pair event ABIs + topic hashes + typed parse helpers for the HookSwap Phase-2 indexer.
 *
 * Mirrors the v3 `PoolCreated` pattern in ../onchain.ts (ethers v5 `Interface` + `getEventTopic`).
 * A UniswapV2 pair emits exactly two events we care about for prices/volume:
 *   - Swap(sender, amount0In, amount1In, amount0Out, amount1Out, to) — realized trade amounts.
 *   - Sync(reserve0, reserve1) — the pool's reserves AFTER every mint/burn/swap (the price source).
 * Both are canonical UniswapV2Pair events; HookSwap's v2 factory deploys canonical pair bytecode
 * (init-code hash verified == canonical, CLAUDE.md 2026-07-03 / 07-08), so these signatures match
 * on every HookSwap chain.
 *
 * The parse helpers return the schema row shapes MINUS the fields the ingest layer fills from context:
 * `chainId` + `pool` (the scan target) and `blockNumber` + `timestamp` (from the log / block header).
 * Big integers are returned as decimal strings (never JS numbers) to preserve uint112/uint256 exactly.
 */

import { BigNumber, ethers } from 'ethers'
import { SwapEventRow, SyncEventRow } from './schema'

// Canonical UniswapV2Pair event signatures (indexed topics: Swap.sender, Swap.to).
const V2_PAIR_EVENT_ABI = [
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
  'event Sync(uint112 reserve0, uint112 reserve1)',
]

/** ethers Interface for the two v2 pair events (used for topic derivation + log parsing). */
export const v2PairIface = new ethers.utils.Interface(V2_PAIR_EVENT_ABI)

/** topic0 for the Swap event (verified against ethers at build time via getEventTopic). */
export const SWAP_TOPIC = v2PairIface.getEventTopic('Swap')
/** topic0 for the Sync event. */
export const SYNC_TOPIC = v2PairIface.getEventTopic('Sync')

/**
 * Swap fields derivable from the log alone — ingest adds chainId/pool/blockNumber/timestamp AND
 * `origin` (tx.from, resolved per-tx from the transaction, not present on the Swap log itself).
 */
export type ParsedSwap = Omit<SwapEventRow, 'chainId' | 'pool' | 'blockNumber' | 'timestamp' | 'origin'>
/** Sync fields derivable from the log alone — ingest adds chainId/pool/blockNumber/timestamp. */
export type ParsedSync = Omit<SyncEventRow, 'chainId' | 'pool' | 'blockNumber' | 'timestamp'>

/**
 * Parse a raw log as a v2 Swap. Returns undefined if the log isn't a well-formed Swap (never throws,
 * never fabricates). `logIndex`/`txHash` come straight off the log; amounts are exact decimal strings.
 */
export function parseSwapLog(log: ethers.providers.Log): ParsedSwap | undefined {
  try {
    const parsed = v2PairIface.parseLog(log)
    if (parsed.name !== 'Swap') {
      return undefined
    }
    return {
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      sender: parsed.args.sender as string,
      recipient: parsed.args.to as string,
      amount0In: (parsed.args.amount0In as BigNumber).toString(),
      amount1In: (parsed.args.amount1In as BigNumber).toString(),
      amount0Out: (parsed.args.amount0Out as BigNumber).toString(),
      amount1Out: (parsed.args.amount1Out as BigNumber).toString(),
    }
  } catch {
    return undefined
  }
}

/**
 * Parse a raw log as a v2 Sync. Returns undefined if the log isn't a well-formed Sync (never throws,
 * never fabricates). Reserves are exact decimal strings (uint112).
 */
export function parseSyncLog(log: ethers.providers.Log): ParsedSync | undefined {
  try {
    const parsed = v2PairIface.parseLog(log)
    if (parsed.name !== 'Sync') {
      return undefined
    }
    return {
      logIndex: log.logIndex,
      reserve0: (parsed.args.reserve0 as BigNumber).toString(),
      reserve1: (parsed.args.reserve1 as BigNumber).toString(),
    }
  } catch {
    return undefined
  }
}

/* ============================================================================================
 * UNISWAP-v3-STYLE POOL EVENTS (per-pool contract; every LaunchPad launch is a v3 pool)
 *
 * A canonical UniswapV3Pool emits `Swap` on every trade carrying the pool's post-trade `sqrtPriceX96`
 * (the EXACT price source — a v3 pool's token BALANCES do NOT give price because liquidity is
 * concentrated) plus signed `amount0/amount1` deltas (the trade volume). Mint/Burn change the range
 * liquidity; we do not need them for price/volume/TVL because TVL is read as the pool contract's live
 * ERC-20 balances (exact), but their topics are exported so the ingest scan can recognize/skip them.
 * Signatures verified against ethers `getEventTopic` at build time (topics asserted in tests/logs).
 * ============================================================================================ */
/**
 * UniswapV3Factory `PoolCreated` — the ONLY way to discover v3 pools (the factory has no on-chain
 * enumerator). token0/token1/fee are indexed; tickSpacing/pool are in data. topic0
 * 0x783cca1c… (canonical, matches onchain.ts's private v3FactoryIface). Used by the indexer's v3
 * discovery scan (mirrors onchain.ts).
 */
const V3_FACTORY_EVENT_ABI = [
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
]
export const v3FactoryDiscoveryIface = new ethers.utils.Interface(V3_FACTORY_EVENT_ABI)
export const V3_POOL_CREATED_TOPIC = v3FactoryDiscoveryIface.getEventTopic('PoolCreated')

/** Parsed v3 PoolCreated entry (real on-chain values; tickSpacing kept for the pool metadata row). */
export interface ParsedV3PoolCreated {
  pool: string
  token0: string
  token1: string
  fee: number
  tickSpacing: number
}

/** Parse a v3 factory PoolCreated log. undefined if not well-formed (never throws/fabricates). */
export function parseV3PoolCreatedLog(log: ethers.providers.Log): ParsedV3PoolCreated | undefined {
  try {
    const parsed = v3FactoryDiscoveryIface.parseLog(log)
    if (parsed.name !== 'PoolCreated') {
      return undefined
    }
    return {
      pool: (parsed.args.pool as string).toLowerCase(),
      token0: parsed.args.token0 as string,
      token1: parsed.args.token1 as string,
      // ethers v5 decodes an indexed uint24 as a plain JS number (≤48 bits), NOT a BigNumber, so
      // `.toNumber()` would throw — BigNumber.from(...) normalizes either representation. (uint24 fits in Number.)
      fee: BigNumber.from(parsed.args.fee).toNumber(),
      tickSpacing: parsed.args.tickSpacing as number,
    }
  } catch {
    return undefined
  }
}

const V3_POOL_EVENT_ABI = [
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
  'event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
]
export const v3PoolIface = new ethers.utils.Interface(V3_POOL_EVENT_ABI)
export const V3_SWAP_TOPIC = v3PoolIface.getEventTopic('Swap')
export const V3_MINT_TOPIC = v3PoolIface.getEventTopic('Mint')
export const V3_BURN_TOPIC = v3PoolIface.getEventTopic('Burn')

/** v3 Swap fields derivable from the log alone (ingest adds chainId/pool/blockNumber/timestamp/origin). */
export interface ParsedV3Swap {
  logIndex: number
  txHash: string
  sender: string
  recipient: string
  /** signed int256 token deltas (pool-perspective), decimal strings. abs() = per-side trade volume. */
  amount0: string
  amount1: string
  /** post-trade sqrtPriceX96 (uint160) — the EXACT price source. */
  sqrtPriceX96: string
  liquidity: string
  tick: number
}

/** Parse a raw log as a v3 Swap. undefined if not a well-formed v3 Swap (never throws/fabricates). */
export function parseV3SwapLog(log: ethers.providers.Log): ParsedV3Swap | undefined {
  try {
    const parsed = v3PoolIface.parseLog(log)
    if (parsed.name !== 'Swap') {
      return undefined
    }
    return {
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      sender: parsed.args.sender as string,
      recipient: parsed.args.recipient as string,
      amount0: (parsed.args.amount0 as BigNumber).toString(),
      amount1: (parsed.args.amount1 as BigNumber).toString(),
      sqrtPriceX96: (parsed.args.sqrtPriceX96 as BigNumber).toString(),
      liquidity: (parsed.args.liquidity as BigNumber).toString(),
      tick: parsed.args.tick as number,
    }
  } catch {
    return undefined
  }
}

/* ============================================================================================
 * UNISWAP-v4 SINGLETON PoolManager EVENTS (one contract per chain; pools keyed by bytes32 poolId)
 *
 * v4 has no per-pool contract — the PoolManager holds every pool's tokens together. So discovery +
 * metrics come entirely from the PoolManager's event log:
 *   - Initialize(id, currency0, currency1, fee, tickSpacing, hooks, sqrtPriceX96, tick) — pool birth
 *     (currency 0x0 = native). Carries the opening sqrtPriceX96.
 *   - Swap(id, sender, amount0, amount1, sqrtPriceX96, liquidity, tick, fee) — post-trade price +
 *     signed deltas (volume). fee is the pool's current (dynamic) fee.
 *   - ModifyLiquidity(id, sender, tickLower, tickUpper, liquidityDelta, salt) — LP principal change;
 *     used to accumulate per-pool TVL (v4 has no per-pool balanceOf), converted to token amounts via
 *     tick-math at the pool's current price in the ingest layer.
 * Topic hashes verified on-chain 2026-07-24 against the live Robinhood PoolManager
 * 0x8366a39c… (cast keccak == cast logs topic0). PoolId + currencies are indexed topics.
 * ============================================================================================ */
const V4_POOL_MANAGER_EVENT_ABI = [
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
]
export const v4PoolManagerIface = new ethers.utils.Interface(V4_POOL_MANAGER_EVENT_ABI)
export const V4_INITIALIZE_TOPIC = v4PoolManagerIface.getEventTopic('Initialize')
export const V4_SWAP_TOPIC = v4PoolManagerIface.getEventTopic('Swap')
export const V4_MODIFY_LIQUIDITY_TOPIC = v4PoolManagerIface.getEventTopic('ModifyLiquidity')

export interface ParsedV4Initialize {
  logIndex: number
  poolId: string
  currency0: string
  currency1: string
  fee: number
  tickSpacing: number
  hooks: string
  sqrtPriceX96: string
  tick: number
}

/** Parse a v4 Initialize log. undefined if not well-formed (never throws/fabricates). */
export function parseV4InitializeLog(log: ethers.providers.Log): ParsedV4Initialize | undefined {
  try {
    const parsed = v4PoolManagerIface.parseLog(log)
    if (parsed.name !== 'Initialize') {
      return undefined
    }
    return {
      logIndex: log.logIndex,
      poolId: (parsed.args.id as string).toLowerCase(),
      currency0: (parsed.args.currency0 as string),
      currency1: (parsed.args.currency1 as string),
      fee: parsed.args.fee as number,
      tickSpacing: parsed.args.tickSpacing as number,
      hooks: parsed.args.hooks as string,
      sqrtPriceX96: (parsed.args.sqrtPriceX96 as BigNumber).toString(),
      tick: parsed.args.tick as number,
    }
  } catch {
    return undefined
  }
}

export interface ParsedV4Swap {
  logIndex: number
  txHash: string
  poolId: string
  sender: string
  /** signed int128 deltas, decimal strings. abs() = per-side trade volume. */
  amount0: string
  amount1: string
  sqrtPriceX96: string
  liquidity: string
  tick: number
  fee: number
}

/** Parse a v4 Swap log. undefined if not well-formed (never throws/fabricates). */
export function parseV4SwapLog(log: ethers.providers.Log): ParsedV4Swap | undefined {
  try {
    const parsed = v4PoolManagerIface.parseLog(log)
    if (parsed.name !== 'Swap') {
      return undefined
    }
    return {
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      poolId: (parsed.args.id as string).toLowerCase(),
      sender: parsed.args.sender as string,
      amount0: (parsed.args.amount0 as BigNumber).toString(),
      amount1: (parsed.args.amount1 as BigNumber).toString(),
      sqrtPriceX96: (parsed.args.sqrtPriceX96 as BigNumber).toString(),
      liquidity: (parsed.args.liquidity as BigNumber).toString(),
      tick: parsed.args.tick as number,
      fee: parsed.args.fee as number,
    }
  } catch {
    return undefined
  }
}

export interface ParsedV4ModifyLiquidity {
  logIndex: number
  poolId: string
  tickLower: number
  tickUpper: number
  /** signed int256 liquidity delta, decimal string (positive = add, negative = remove). */
  liquidityDelta: string
}

/** Parse a v4 ModifyLiquidity log. undefined if not well-formed (never throws/fabricates). */
export function parseV4ModifyLiquidityLog(log: ethers.providers.Log): ParsedV4ModifyLiquidity | undefined {
  try {
    const parsed = v4PoolManagerIface.parseLog(log)
    if (parsed.name !== 'ModifyLiquidity') {
      return undefined
    }
    return {
      logIndex: log.logIndex,
      poolId: (parsed.args.id as string).toLowerCase(),
      tickLower: parsed.args.tickLower as number,
      tickUpper: parsed.args.tickUpper as number,
      liquidityDelta: (parsed.args.liquidityDelta as BigNumber).toString(),
    }
  } catch {
    return undefined
  }
}
