/**
 * Native OHLC(V) candle builder for the HookSwap Phase-2 indexer — PURE reads from the SQLite event
 * store, NO live RPC. Turns the already-indexed Swap/Sync events of a single pool into open/high/low/
 * close/volume bars per timeframe, so the Terminal token/pool chart can draw real candles instead of
 * the "No price history yet" empty state.
 *
 * PRICE SOURCE (identical math to indexer/metrics.ts, kept honest + native-denominated):
 *   - v2   : price = (reserve1/10^dec1) / (reserve0/10^dec0), read from each stored Sync snapshot
 *            (the pool's post-trade reserves — the v2 price source). Volume from swap_events amounts.
 *   - v3/v4: price = (sqrtPriceX96 / 2^96)^2 × 10^(dec0-dec1), read from each stored Swap's post-trade
 *            sqrtPriceX96 (the ONLY correct concentrated-liquidity price). Volume from |amount| deltas.
 *
 * ORIENTATION: candle o/h/l/c are ALWAYS pool-canonical — the price of token0 expressed in token1
 * (native/quote-denominated). The response also carries token0/token1 metadata, which side (if any) is
 * the chain's wrapped-native (`nativeSide`), and `usdPerNative` (the single on-chain USD anchor, when a
 * stablecoin pool exists on the chain). A consumer can therefore render the base token priced in the
 * quote token (invert for token1) and, when the quote side is the native side, scale by usdPerNative to
 * get USD — both are EXACT, linear/monotonic transforms of the pool-canonical bars. Nothing is
 * fabricated: a pool with no swaps returns `candles: []` (honest empty → the UI keeps its empty state).
 */

import { BigNumber, ethers } from 'ethers'
import { getChain } from '../chains'
import { getUsdPerNative } from './metrics'
import { SqliteDatabase } from './schema'

/** Supported chart timeframes (the Terminal timeframe selector). */
export type Timeframe = '1H' | '1D' | '1W' | '1M' | '1Y'
export const TIMEFRAMES: readonly Timeframe[] = ['1H', '1D', '1W', '1M', '1Y'] as const

/** Narrow an arbitrary string to a supported timeframe. */
export function isTimeframe(s: string): s is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(s)
}

interface TfSpec {
  /** bucket (bar) width in seconds. */
  bucketSec: number
  /** how far back the series reaches, in seconds. */
  windowSec: number
}

/**
 * Bucket width + lookback per timeframe. Chosen so each window yields a reasonable, bounded bar count
 * (1H→60, 1D→96, 1W→168, 1M→180, 1Y→365) — dense enough to read, capped so the JSON payload stays small.
 */
const TF_SPECS: Record<Timeframe, TfSpec> = {
  '1H': { bucketSec: 60, windowSec: 60 * 60 }, //          1-min bars over 1 hour  → 60
  '1D': { bucketSec: 15 * 60, windowSec: 24 * 60 * 60 }, // 15-min bars over 1 day  → 96
  '1W': { bucketSec: 60 * 60, windowSec: 7 * 24 * 60 * 60 }, //  1-hr bars over 1 wk  → 168
  '1M': { bucketSec: 4 * 60 * 60, windowSec: 30 * 24 * 60 * 60 }, // 4-hr bars / 1 mo → 180
  '1Y': { bucketSec: 24 * 60 * 60, windowSec: 365 * 24 * 60 * 60 }, // 1-day bars / 1y → 365
}

const Q96 = 2 ** 96
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export interface Candle {
  /** bucket start, unix seconds. */
  t: number
  /** open / high / low / close — price of token0 in token1 (native/quote-denominated). */
  o: number
  h: number
  l: number
  c: number
  /** volume that flowed through the bucket, in token0 units. */
  v0: number
  /** volume that flowed through the bucket, in token1 units. */
  v1: number
}

export interface CandleTokenInfo {
  address: string
  symbol: string
  decimals: number
}

export interface CandleSeries {
  chainId: number
  /** the resolved pool key (v2/v3 address or v4 bytes32 poolId), as stored. */
  pool: string
  protocolVersion: 'v2' | 'v3' | 'v4'
  tf: Timeframe
  bucketSeconds: number
  token0: CandleTokenInfo
  token1: CandleTokenInfo
  /** 0 if token0 is the chain's native side, 1 if token1 is, null if neither (token/token pool). */
  nativeSide: 0 | 1 | null
  /** the chain's single on-chain USD anchor (stablecoin-per-native), or null when none exists yet. */
  usdPerNative: number | null
  /** OHLCV bars, ascending by time. Empty when the pool has no usable price history (honest). */
  candles: Candle[]
}

// ---------- price helpers (self-contained; mirror indexer/metrics.ts exactly) ----------

/** token0-in-token1 from v2 reserves + decimals; undefined if the token0 reserve is zero. */
function reservePrice0In1(reserve0: string, reserve1: string, dec0: number, dec1: number): number | undefined {
  const r0 = Number(ethers.utils.formatUnits(reserve0, dec0))
  const r1 = Number(ethers.utils.formatUnits(reserve1, dec1))
  if (!(r0 > 0)) {
    return undefined
  }
  const p = r1 / r0
  return p > 0 && Number.isFinite(p) ? p : undefined
}

/** token0-in-token1 (HUMAN units) from a v3/v4 sqrtPriceX96; undefined if not > 0. */
function priceFromSqrtX96(sqrtPriceX96: string, dec0: number, dec1: number): number | undefined {
  const s = Number(sqrtPriceX96)
  if (!(s > 0) || !Number.isFinite(s)) {
    return undefined
  }
  const ratio = s / Q96
  const p = ratio * ratio * Math.pow(10, dec0 - dec1)
  return p > 0 && Number.isFinite(p) ? p : undefined
}

// ---------- pool detection / resolution ----------

interface PoolShape {
  protocolVersion: 'v2' | 'v3' | 'v4'
  /** the stored pool key (lowercased in every table, but we return the exact stored value). */
  pool: string
  token0: CandleTokenInfo
  token1: CandleTokenInfo
}

/** Look up a pool across v2/v3/v4 by its key (case-insensitive). undefined if not indexed. */
function detectPoolByKey(db: SqliteDatabase, chainId: number, poolKey: string): PoolShape | undefined {
  const key = poolKey.toLowerCase()
  const v2 = db
    .prepare(
      `SELECT pool, token0, token1, decimals0, decimals1, symbol0, symbol1
         FROM pool_meta WHERE chainId=? AND LOWER(pool)=?`,
    )
    .get(chainId, key) as
    | { pool: string; token0: string; token1: string; decimals0: number; decimals1: number; symbol0: string; symbol1: string }
    | undefined
  if (v2) {
    return {
      protocolVersion: 'v2',
      pool: v2.pool,
      token0: { address: v2.token0, symbol: v2.symbol0, decimals: v2.decimals0 },
      token1: { address: v2.token1, symbol: v2.symbol1, decimals: v2.decimals1 },
    }
  }
  const v3 = db
    .prepare(
      `SELECT pool, token0, token1, decimals0, decimals1, symbol0, symbol1
         FROM v3_pools WHERE chainId=? AND LOWER(pool)=?`,
    )
    .get(chainId, key) as
    | { pool: string; token0: string; token1: string; decimals0: number; decimals1: number; symbol0: string; symbol1: string }
    | undefined
  if (v3) {
    return {
      protocolVersion: 'v3',
      pool: v3.pool,
      token0: { address: v3.token0, symbol: v3.symbol0, decimals: v3.decimals0 },
      token1: { address: v3.token1, symbol: v3.symbol1, decimals: v3.decimals1 },
    }
  }
  const v4 = db
    .prepare(
      `SELECT poolId, currency0, currency1, decimals0, decimals1, symbol0, symbol1
         FROM v4_pools WHERE chainId=? AND LOWER(poolId)=?`,
    )
    .get(chainId, key) as
    | { poolId: string; currency0: string; currency1: string; decimals0: number; decimals1: number; symbol0: string; symbol1: string }
    | undefined
  if (v4) {
    return {
      protocolVersion: 'v4',
      pool: v4.poolId,
      token0: { address: v4.currency0, symbol: v4.symbol0, decimals: v4.decimals0 },
      token1: { address: v4.currency1, symbol: v4.symbol1, decimals: v4.decimals1 },
    }
  }
  return undefined
}

/** True when `side` and `want` are the same address, or both are the chain's native side (wnative/0x0). */
function sideMatches(side: string, want: string, wnativeLower: string): boolean {
  const s = side.toLowerCase()
  const w = want.toLowerCase()
  if (s === w) {
    return true
  }
  const isNative = (a: string): boolean => a === wnativeLower || a === ZERO_ADDRESS
  return isNative(s) && isNative(w)
}

/** Count indexed swaps for a pool (used only to rank candidate pools for the same pair). */
function swapCount(db: SqliteDatabase, chainId: number, shape: PoolShape): number {
  const key = shape.pool.toLowerCase()
  const table = shape.protocolVersion === 'v2' ? 'swap_events' : shape.protocolVersion === 'v3' ? 'v3_swap_events' : 'v4_swap_events'
  const col = shape.protocolVersion === 'v4' ? 'poolId' : 'pool'
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE chainId=? AND LOWER(${col})=?`).get(chainId, key) as
    | { n: number }
    | undefined
  return row?.n ?? 0
}

/**
 * Resolve the most-active indexed pool for a token pair on a chain (case-insensitive, treating the
 * wrapped-native and the v4 native zero-address as equivalent). undefined when no indexed pool pairs
 * the two tokens. Among multiple pools (v2/v3/v4, fee tiers) the one with the most swaps wins.
 */
function resolvePoolByTokens(db: SqliteDatabase, chainId: number, tokenA: string, tokenB: string): PoolShape | undefined {
  const chain = getChain(chainId)
  const wnative = chain ? chain.wrappedNative.address.toLowerCase() : ZERO_ADDRESS

  const candidates: PoolShape[] = []
  const pushIfMatch = (shape: PoolShape): void => {
    const t0 = shape.token0.address
    const t1 = shape.token1.address
    const matches =
      (sideMatches(t0, tokenA, wnative) && sideMatches(t1, tokenB, wnative)) ||
      (sideMatches(t0, tokenB, wnative) && sideMatches(t1, tokenA, wnative))
    if (matches) {
      candidates.push(shape)
    }
  }

  for (const r of db
    .prepare(`SELECT pool, token0, token1, decimals0, decimals1, symbol0, symbol1 FROM pool_meta WHERE chainId=?`)
    .all(chainId) as Array<{ pool: string; token0: string; token1: string; decimals0: number; decimals1: number; symbol0: string; symbol1: string }>) {
    pushIfMatch({
      protocolVersion: 'v2',
      pool: r.pool,
      token0: { address: r.token0, symbol: r.symbol0, decimals: r.decimals0 },
      token1: { address: r.token1, symbol: r.symbol1, decimals: r.decimals1 },
    })
  }
  for (const r of db
    .prepare(`SELECT pool, token0, token1, decimals0, decimals1, symbol0, symbol1 FROM v3_pools WHERE chainId=?`)
    .all(chainId) as Array<{ pool: string; token0: string; token1: string; decimals0: number; decimals1: number; symbol0: string; symbol1: string }>) {
    pushIfMatch({
      protocolVersion: 'v3',
      pool: r.pool,
      token0: { address: r.token0, symbol: r.symbol0, decimals: r.decimals0 },
      token1: { address: r.token1, symbol: r.symbol1, decimals: r.decimals1 },
    })
  }
  for (const r of db
    .prepare(`SELECT poolId, currency0, currency1, decimals0, decimals1, symbol0, symbol1 FROM v4_pools WHERE chainId=?`)
    .all(chainId) as Array<{ poolId: string; currency0: string; currency1: string; decimals0: number; decimals1: number; symbol0: string; symbol1: string }>) {
    pushIfMatch({
      protocolVersion: 'v4',
      pool: r.poolId,
      token0: { address: r.currency0, symbol: r.symbol0, decimals: r.decimals0 },
      token1: { address: r.currency1, symbol: r.symbol1, decimals: r.decimals1 },
    })
  }

  if (candidates.length === 0) {
    return undefined
  }
  // Rank by indexed swap count (most active pool for the pair), stable on ties.
  let best = candidates[0]
  let bestN = swapCount(db, chainId, best)
  for (let i = 1; i < candidates.length; i++) {
    const n = swapCount(db, chainId, candidates[i])
    if (n > bestN) {
      best = candidates[i]
      bestN = n
    }
  }
  return best
}

// ---------- candle assembly ----------

/** A single price observation (token0-in-token1), chronological. */
interface PricePoint {
  t: number
  price: number
}

/** Per-bucket volume (already decimal-adjusted, human units). */
interface VolumeBucket {
  v0: number
  v1: number
}

/**
 * Fold ordered price points + a per-bucket volume map into OHLCV candles. Price points MUST arrive
 * chronologically (open = first in bucket, close = last). Buckets with a price but no volume report
 * zero volume (honest — a Sync from a mint/burn moved price without a trade).
 */
function foldCandles(points: PricePoint[], volumeByBucket: Map<number, VolumeBucket>, bucketSec: number): Candle[] {
  const byBucket = new Map<number, Candle>()
  for (const p of points) {
    const t = Math.floor(p.t / bucketSec) * bucketSec
    const existing = byBucket.get(t)
    if (!existing) {
      byBucket.set(t, { t, o: p.price, h: p.price, l: p.price, c: p.price, v0: 0, v1: 0 })
    } else {
      existing.c = p.price
      if (p.price > existing.h) {
        existing.h = p.price
      }
      if (p.price < existing.l) {
        existing.l = p.price
      }
    }
  }
  for (const [t, vol] of volumeByBucket.entries()) {
    const candle = byBucket.get(t)
    if (candle) {
      candle.v0 = vol.v0
      candle.v1 = vol.v1
    }
    // A volume bucket with no price point is dropped — a candle needs a price. This only happens if a
    // trade landed in a bucket with no accompanying price observation, which does not occur in practice
    // (every Swap/Sync carries a price), so it is not synthesized.
  }
  return Array.from(byBucket.values()).sort((a, b) => a.t - b.t)
}

/** v2 price points (from Sync reserves) within the window, chronological. */
function v2PricePoints(db: SqliteDatabase, chainId: number, pool: string, sinceTs: number, dec0: number, dec1: number): PricePoint[] {
  const rows = db
    .prepare(
      `SELECT reserve0, reserve1, timestamp FROM sync_events
         WHERE chainId=? AND LOWER(pool)=? AND timestamp >= ?
         ORDER BY blockNumber ASC, logIndex ASC`,
    )
    .all(chainId, pool.toLowerCase(), sinceTs) as Array<{ reserve0: string; reserve1: string; timestamp: number }>
  const out: PricePoint[] = []
  for (const r of rows) {
    const price = reservePrice0In1(r.reserve0, r.reserve1, dec0, dec1)
    if (price !== undefined) {
      out.push({ t: r.timestamp, price })
    }
  }
  return out
}

/** v2 per-bucket volume (both sides, in + out) from swap_events. */
function v2VolumeBuckets(
  db: SqliteDatabase,
  chainId: number,
  pool: string,
  sinceTs: number,
  dec0: number,
  dec1: number,
  bucketSec: number,
): Map<number, VolumeBucket> {
  const rows = db
    .prepare(
      `SELECT amount0In, amount1In, amount0Out, amount1Out, timestamp FROM swap_events
         WHERE chainId=? AND LOWER(pool)=? AND timestamp >= ?`,
    )
    .all(chainId, pool.toLowerCase(), sinceTs) as Array<{
    amount0In: string
    amount1In: string
    amount0Out: string
    amount1Out: string
    timestamp: number
  }>
  const raw = new Map<number, { a0: BigNumber; a1: BigNumber }>()
  for (const r of rows) {
    const t = Math.floor(r.timestamp / bucketSec) * bucketSec
    const acc = raw.get(t) ?? { a0: BigNumber.from(0), a1: BigNumber.from(0) }
    acc.a0 = acc.a0.add(r.amount0In).add(r.amount0Out)
    acc.a1 = acc.a1.add(r.amount1In).add(r.amount1Out)
    raw.set(t, acc)
  }
  const out = new Map<number, VolumeBucket>()
  for (const [t, acc] of raw.entries()) {
    out.set(t, {
      v0: Number(ethers.utils.formatUnits(acc.a0, dec0)),
      v1: Number(ethers.utils.formatUnits(acc.a1, dec1)),
    })
  }
  return out
}

/** v3/v4 price points (from swap sqrtPriceX96) within the window, chronological. */
function concentratedPricePoints(
  db: SqliteDatabase,
  chainId: number,
  table: 'v3_swap_events' | 'v4_swap_events',
  col: 'pool' | 'poolId',
  pool: string,
  sinceTs: number,
  dec0: number,
  dec1: number,
): PricePoint[] {
  const rows = db
    .prepare(
      `SELECT sqrtPriceX96, timestamp FROM ${table}
         WHERE chainId=? AND LOWER(${col})=? AND timestamp >= ?
         ORDER BY blockNumber ASC, logIndex ASC`,
    )
    .all(chainId, pool.toLowerCase(), sinceTs) as Array<{ sqrtPriceX96: string; timestamp: number }>
  const out: PricePoint[] = []
  for (const r of rows) {
    const price = priceFromSqrtX96(r.sqrtPriceX96, dec0, dec1)
    if (price !== undefined) {
      out.push({ t: r.timestamp, price })
    }
  }
  return out
}

/** v3/v4 per-bucket volume (|amount| per side) from swap events. */
function concentratedVolumeBuckets(
  db: SqliteDatabase,
  chainId: number,
  table: 'v3_swap_events' | 'v4_swap_events',
  col: 'pool' | 'poolId',
  pool: string,
  sinceTs: number,
  dec0: number,
  dec1: number,
  bucketSec: number,
): Map<number, VolumeBucket> {
  const rows = db
    .prepare(
      `SELECT amount0, amount1, timestamp FROM ${table}
         WHERE chainId=? AND LOWER(${col})=? AND timestamp >= ?`,
    )
    .all(chainId, pool.toLowerCase(), sinceTs) as Array<{ amount0: string; amount1: string; timestamp: number }>
  const raw = new Map<number, { a0: BigNumber; a1: BigNumber }>()
  for (const r of rows) {
    const t = Math.floor(r.timestamp / bucketSec) * bucketSec
    const acc = raw.get(t) ?? { a0: BigNumber.from(0), a1: BigNumber.from(0) }
    acc.a0 = acc.a0.add(BigNumber.from(r.amount0).abs())
    acc.a1 = acc.a1.add(BigNumber.from(r.amount1).abs())
    raw.set(t, acc)
  }
  const out = new Map<number, VolumeBucket>()
  for (const [t, acc] of raw.entries()) {
    out.set(t, {
      v0: Number(ethers.utils.formatUnits(acc.a0, dec0)),
      v1: Number(ethers.utils.formatUnits(acc.a1, dec1)),
    })
  }
  return out
}

/** Which pool side (if any) is the chain's native side (wrapped-native or v4 zero-address). */
function nativeSideOf(chainId: number, token0: string, token1: string): 0 | 1 | null {
  const chain = getChain(chainId)
  if (!chain) {
    return null
  }
  const wnative = chain.wrappedNative.address.toLowerCase()
  const isNative = (a: string): boolean => a.toLowerCase() === wnative || a.toLowerCase() === ZERO_ADDRESS
  if (isNative(token0)) {
    return 0
  }
  if (isNative(token1)) {
    return 1
  }
  return null
}

/**
 * Build the OHLCV candle series for a pool + timeframe. Resolution order for the pool:
 *   1. explicit `pool` key (v2/v3 address or v4 poolId), OR
 *   2. `tokenA` + `tokenB` addresses → the most-active indexed pool for that pair.
 * Returns undefined ONLY when the pool cannot be resolved (unknown / not indexed). A resolved pool with
 * no swaps returns a real CandleSeries with `candles: []` (honest empty), never undefined and never faked.
 */
export function buildCandles(
  db: SqliteDatabase,
  chainId: number,
  tf: Timeframe,
  opts: { pool?: string; tokenA?: string; tokenB?: string },
): CandleSeries | undefined {
  const shape = opts.pool
    ? detectPoolByKey(db, chainId, opts.pool)
    : opts.tokenA && opts.tokenB
      ? resolvePoolByTokens(db, chainId, opts.tokenA, opts.tokenB)
      : undefined
  if (!shape) {
    return undefined
  }

  const spec = TF_SPECS[tf]
  const sinceTs = Math.floor(Date.now() / 1000) - spec.windowSec
  const { decimals: dec0 } = shape.token0
  const { decimals: dec1 } = shape.token1

  let points: PricePoint[]
  let volume: Map<number, VolumeBucket>
  if (shape.protocolVersion === 'v2') {
    points = v2PricePoints(db, chainId, shape.pool, sinceTs, dec0, dec1)
    volume = v2VolumeBuckets(db, chainId, shape.pool, sinceTs, dec0, dec1, spec.bucketSec)
  } else if (shape.protocolVersion === 'v3') {
    points = concentratedPricePoints(db, chainId, 'v3_swap_events', 'pool', shape.pool, sinceTs, dec0, dec1)
    volume = concentratedVolumeBuckets(db, chainId, 'v3_swap_events', 'pool', shape.pool, sinceTs, dec0, dec1, spec.bucketSec)
  } else {
    points = concentratedPricePoints(db, chainId, 'v4_swap_events', 'poolId', shape.pool, sinceTs, dec0, dec1)
    volume = concentratedVolumeBuckets(db, chainId, 'v4_swap_events', 'poolId', shape.pool, sinceTs, dec0, dec1, spec.bucketSec)
  }

  const candles = foldCandles(points, volume, spec.bucketSec)

  let usdPerNative: number | null
  try {
    usdPerNative = getUsdPerNative(db, chainId) ?? null
  } catch {
    usdPerNative = null
  }

  return {
    chainId,
    pool: shape.pool,
    protocolVersion: shape.protocolVersion,
    tf,
    bucketSeconds: spec.bucketSec,
    token0: shape.token0,
    token1: shape.token1,
    nativeSide: nativeSideOf(chainId, shape.token0.address, shape.token1.address),
    usdPerNative,
    candles,
  }
}
