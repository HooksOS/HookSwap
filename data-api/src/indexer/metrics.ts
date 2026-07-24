/**
 * Metrics reads for the HookSwap Phase-2 indexer — PURE reads from the SQLite event store, NO live RPC.
 *
 * Everything derives from stored Swap/Sync events + pool_meta (real on-chain data captured by ingest).
 * All prices/volumes/TVL are NATIVE- or TOKEN-denominated. There is NO USD oracle on these chains, so
 * every USD-denominated value is returned as `undefined` (explicitly, never faked) — it lights up only
 * once a stablecoin anchor / price feed is added. Insufficient/empty data returns undefined or [] —
 * this layer never fabricates a number.
 *
 * Decimal adjustment uses ethers `formatUnits` (exact BigNumber→human), matching onchain.ts.
 */

import { BigNumber, ethers } from 'ethers'
import { getChain } from '../chains'
import {
  getPoolMeta,
  getV3PoolRow,
  getV3PoolState,
  getV4PoolRow,
  getV4PoolState,
  PoolMetaRow,
  SqliteDatabase,
} from './schema'

const SECONDS_PER_DAY = 86_400

/** A single stored Sync snapshot (reserves + when). */
interface SyncRow {
  blockNumber: number
  logIndex: number
  reserve0: string
  reserve1: string
  timestamp: number
}

/** Fetch the most-recent Sync snapshot for a pool (latest block, then latest log within it). */
function latestSync(db: SqliteDatabase, chainId: number, pool: string): SyncRow | undefined {
  return db
    .prepare(
      `SELECT blockNumber, logIndex, reserve0, reserve1, timestamp
         FROM sync_events WHERE chainId=? AND pool=?
         ORDER BY blockNumber DESC, logIndex DESC LIMIT 1`,
    )
    .get(chainId, pool) as SyncRow | undefined
}

/**
 * price of token0 expressed in token1, from reserves + decimals: (reserve1/10^dec1)/(reserve0/10^dec0).
 * Returns undefined if the token0 reserve is zero (price undefined, never Infinity/NaN).
 */
function price0In1(reserve0: string, reserve1: string, meta: PoolMetaRow): number | undefined {
  const r0 = Number(ethers.utils.formatUnits(reserve0, meta.decimals0))
  const r1 = Number(ethers.utils.formatUnits(reserve1, meta.decimals1))
  if (!(r0 > 0)) {
    return undefined
  }
  return r1 / r0
}

export interface SpotPriceNative {
  /** price of 1 unit of token0 expressed in token1 units (from the latest Sync reserves). */
  priceToken0InToken1: number
  /** price of 1 unit of token1 expressed in token0 units. */
  priceToken1InToken0: number
}

/**
 * Latest reserve-derived spot price for a pool, both directions. Native/token-denominated only.
 * undefined when there's no stored Sync yet, no pool_meta, or a zero reserve.
 */
export function getSpotPriceNative(db: SqliteDatabase, chainId: number, pool: string): SpotPriceNative | undefined {
  const meta = getPoolMeta(db, chainId, pool)
  if (!meta) {
    return undefined
  }
  const sync = latestSync(db, chainId, pool)
  if (!sync) {
    return undefined
  }
  const p0 = price0In1(sync.reserve0, sync.reserve1, meta)
  if (p0 === undefined || !(p0 > 0)) {
    return undefined
  }
  return { priceToken0InToken1: p0, priceToken1InToken0: 1 / p0 }
}

export interface Volume24h {
  /** total token0 that flowed through swaps (in + out), in token units, over the last 24h. */
  volumeToken0: number
  /** total token1 that flowed through swaps (in + out), in token units, over the last 24h. */
  volumeToken1: number
  /** number of Swap events in the window. */
  swapCount: number
  /** always undefined — no USD anchor exists on these chains. */
  volumeUSD: undefined
}

/**
 * 24h swap volume in TOKEN units + swap count. Sums (amountIn + amountOut) per side over now-24h.
 * undefined when pool_meta is missing (can't decimal-adjust). When there are no swaps, returns real
 * zeros (honest — the pool traded nothing), not undefined.
 */
export function get24hVolumeTokens(db: SqliteDatabase, chainId: number, pool: string): Volume24h | undefined {
  const meta = getPoolMeta(db, chainId, pool)
  if (!meta) {
    return undefined
  }
  const since = Math.floor(Date.now() / 1000) - SECONDS_PER_DAY
  const rows = db
    .prepare(
      `SELECT amount0In, amount1In, amount0Out, amount1Out
         FROM swap_events WHERE chainId=? AND pool=? AND timestamp >= ?`,
    )
    .all(chainId, pool, since) as Array<{
    amount0In: string
    amount1In: string
    amount0Out: string
    amount1Out: string
  }>

  let v0 = BigNumber.from(0)
  let v1 = BigNumber.from(0)
  for (const r of rows) {
    v0 = v0.add(r.amount0In).add(r.amount0Out)
    v1 = v1.add(r.amount1In).add(r.amount1Out)
  }
  return {
    volumeToken0: Number(ethers.utils.formatUnits(v0, meta.decimals0)),
    volumeToken1: Number(ethers.utils.formatUnits(v1, meta.decimals1)),
    swapCount: rows.length,
    volumeUSD: undefined,
  }
}

/**
 * 24h price change (native-denominated, token0-in-token1) as a FRACTION: (now - then)/then.
 * `now` = latest Sync price; `then` = the last Sync at/or-before the 24h-ago mark. undefined when
 * there's insufficient history (no baseline before the window, or no current price / meta).
 */
export function get24hPriceChangeNative(db: SqliteDatabase, chainId: number, pool: string): number | undefined {
  const meta = getPoolMeta(db, chainId, pool)
  if (!meta) {
    return undefined
  }
  const nowSync = latestSync(db, chainId, pool)
  if (!nowSync) {
    return undefined
  }
  const priceNow = price0In1(nowSync.reserve0, nowSync.reserve1, meta)
  if (priceNow === undefined) {
    return undefined
  }
  const cutoff = Math.floor(Date.now() / 1000) - SECONDS_PER_DAY
  const thenSync = db
    .prepare(
      `SELECT reserve0, reserve1 FROM sync_events
         WHERE chainId=? AND pool=? AND timestamp <= ?
         ORDER BY timestamp DESC, blockNumber DESC, logIndex DESC LIMIT 1`,
    )
    .get(chainId, pool, cutoff) as { reserve0: string; reserve1: string } | undefined
  if (!thenSync) {
    return undefined
  }
  const priceThen = price0In1(thenSync.reserve0, thenSync.reserve1, meta)
  if (priceThen === undefined || !(priceThen > 0)) {
    return undefined
  }
  return (priceNow - priceThen) / priceThen
}

export interface ReserveTVL {
  /** latest token0 reserve, in token units. */
  reserveToken0: number
  /** latest token1 reserve, in token units. */
  reserveToken1: number
  /** always undefined — no USD anchor. The wrapped-native side's amount is a real TVL proxy. */
  tvlUSD: undefined
}

/**
 * Latest pool reserves in token units (a real, native/token-denominated TVL proxy). undefined when
 * there's no stored Sync yet or no pool_meta.
 */
export function getReserveTVLTokens(db: SqliteDatabase, chainId: number, pool: string): ReserveTVL | undefined {
  const meta = getPoolMeta(db, chainId, pool)
  if (!meta) {
    return undefined
  }
  const sync = latestSync(db, chainId, pool)
  if (!sync) {
    return undefined
  }
  return {
    reserveToken0: Number(ethers.utils.formatUnits(sync.reserve0, meta.decimals0)),
    reserveToken1: Number(ethers.utils.formatUnits(sync.reserve1, meta.decimals1)),
    tvlUSD: undefined,
  }
}

export interface PricePoint {
  /** bucket start, unix seconds. */
  t: number
  /** native-denominated close price (token0 in token1) for the bucket. */
  price: number
}

/**
 * Native-denominated price history: the CLOSE (last Sync price) per `bucketSec` bucket since `sinceTs`.
 * Returns points sorted ascending by time. Empty array when there's no data / no meta (never fabricated).
 */
export function getPriceHistory(
  db: SqliteDatabase,
  chainId: number,
  pool: string,
  sinceTs: number,
  bucketSec: number,
): PricePoint[] {
  const meta = getPoolMeta(db, chainId, pool)
  if (!meta || !(bucketSec > 0)) {
    return []
  }
  const rows = db
    .prepare(
      `SELECT reserve0, reserve1, timestamp FROM sync_events
         WHERE chainId=? AND pool=? AND timestamp >= ?
         ORDER BY blockNumber ASC, logIndex ASC`,
    )
    .all(chainId, pool, sinceTs) as Array<{ reserve0: string; reserve1: string; timestamp: number }>

  // Ascending order → later rows overwrite the bucket, leaving the last (close) price per bucket.
  const byBucket = new Map<number, number>()
  for (const r of rows) {
    const p = price0In1(r.reserve0, r.reserve1, meta)
    if (p === undefined) {
      continue
    }
    const bucket = Math.floor(r.timestamp / bucketSec) * bucketSec
    byBucket.set(bucket, p)
  }
  return Array.from(byBucket.entries())
    .map(([t, price]) => ({ t, price }))
    .sort((a, b) => a.t - b.t)
}

/* ============================================================================================
 * USD-ANCHOR LAYER
 *
 * THE ANCHOR: every USD value on a chain derives from ONE real on-chain pool — the chain's
 * wrapped-native / stablecoin v2 pool. There is NO external price oracle. `getUsdPerNative` reads
 * that single pool's latest reserves to get stablecoin-per-native (e.g. USDG-per-WETH on Robinhood).
 * From that one number:
 *   priceUsd(token)   = priceInNative(token) × usdPerNative
 *   tvlUsd(pool)      = nativeSideReserve × usdPerNative × 2   (see TVL convention below)
 *   volumeUsd24h(pool)= nativeLegVolume    × usdPerNative
 *
 * Everything is undefined-honest: if the chain has no `stablecoin` configured, or its wrapped-native/
 * stablecoin pool has not been ingested yet (no pool_meta / no Sync), usdPerNative is `undefined` and
 * so is every downstream USD value. NOTHING is fabricated. This lights up automatically the moment a
 * WETH/USDG pool is seeded and the indexer ingests its first Sync.
 * ============================================================================================ */

/**
 * stablecoin-per-native for a chain (e.g. USDG per WETH on Robinhood), from the wrapped-native/
 * stablecoin v2 pool's latest Sync reserves, decimal-adjusted (honoring the stablecoin's real
 * decimals via the pool's stored decimals0/decimals1). Returns `undefined` when:
 *   - the chain has no `stablecoin` configured (now set for 4663 USDG / 4326 USDm / 57073 USD₮0 /
 *     999 USDC / 988 USDT0 — all on-chain-verified seeded pools; a chain without one stays undefined),
 *   - no ingested pool pairs {wrappedNative, stablecoin} (the anchor pool isn't seeded/indexed yet),
 *   - the anchor pool has no stored Sync, or either side's reserve is zero.
 * Never fabricated. The single number every other USD value multiplies by.
 */
export function getUsdPerNative(db: SqliteDatabase, chainId: number): number | undefined {
  const chain = getChain(chainId)
  if (!chain || !chain.stablecoin) {
    return undefined
  }
  const wnative = chain.wrappedNative.address.toLowerCase()
  const stable = chain.stablecoin.address.toLowerCase()
  if (wnative === stable) {
    // Degenerate: stablecoin IS the wrapped-native. No such chain here; guard against a bad config.
    return undefined
  }
  // Find the ingested v2 pool whose {token0,token1} == {wrappedNative, stablecoin} (either order).
  const row = db
    .prepare(
      `SELECT pool, token0, token1, decimals0, decimals1 FROM pool_meta
         WHERE chainId=?
           AND ( (LOWER(token0)=? AND LOWER(token1)=?) OR (LOWER(token0)=? AND LOWER(token1)=?) )
         LIMIT 1`,
    )
    .get(chainId, wnative, stable, stable, wnative) as
    | { pool: string; token0: string; token1: string; decimals0: number; decimals1: number }
    | undefined
  if (!row) {
    return undefined
  }
  const sync = latestSync(db, chainId, row.pool)
  if (!sync) {
    return undefined
  }
  const t0IsNative = row.token0.toLowerCase() === wnative
  const nativeRaw = t0IsNative ? sync.reserve0 : sync.reserve1
  const stableRaw = t0IsNative ? sync.reserve1 : sync.reserve0
  const nativeDec = t0IsNative ? row.decimals0 : row.decimals1
  const stableDec = t0IsNative ? row.decimals1 : row.decimals0
  const nativeHuman = Number(ethers.utils.formatUnits(nativeRaw, nativeDec))
  const stableHuman = Number(ethers.utils.formatUnits(stableRaw, stableDec))
  if (!(nativeHuman > 0) || !(stableHuman > 0)) {
    return undefined
  }
  return stableHuman / nativeHuman
}

/**
 * USD price of a token given its ALREADY-COMPUTED native-denominated price (from getSpotPriceNative /
 * onchain getSpotPrices): priceUsd = priceInNative × usdPerNative. undefined when usdPerNative is
 * undefined (no anchor) or priceInNative is not a finite non-negative number. Never fabricated.
 */
export function getTokenPriceUsd(db: SqliteDatabase, chainId: number, priceInNative: number): number | undefined {
  if (!(priceInNative >= 0) || !Number.isFinite(priceInNative)) {
    return undefined
  }
  const usdPerNative = getUsdPerNative(db, chainId)
  if (usdPerNative === undefined) {
    return undefined
  }
  return priceInNative * usdPerNative
}

/**
 * Full-pool TVL in USD for a v2 pool.
 *
 * TVL CONVENTION: we value the WRAPPED-NATIVE side of the pool in USD (nativeReserve × usdPerNative)
 * and multiply by 2. In a balanced constant-product (x·y=k) pool both sides hold equal value, so
 * 2× the native side ≈ total pool value. This anchors TVL to the ONE trusted USD reference
 * (usdPerNative) rather than pricing the paired token independently (which has no oracle). Requires
 * the pool to HAVE a wrapped-native side; a pool with neither side wrapped-native returns undefined
 * (can't be anchored). Also undefined when there's no anchor, no pool_meta, or no stored Sync.
 */
export function getPoolTvlUsd(db: SqliteDatabase, chainId: number, pool: string): number | undefined {
  const usdPerNative = getUsdPerNative(db, chainId)
  if (usdPerNative === undefined) {
    return undefined
  }
  const chain = getChain(chainId)
  if (!chain) {
    return undefined
  }
  const meta = getPoolMeta(db, chainId, pool)
  if (!meta) {
    return undefined
  }
  const wnative = chain.wrappedNative.address.toLowerCase()
  const t0IsNative = meta.token0.toLowerCase() === wnative
  const t1IsNative = meta.token1.toLowerCase() === wnative
  if (!t0IsNative && !t1IsNative) {
    return undefined
  }
  const sync = latestSync(db, chainId, pool)
  if (!sync) {
    return undefined
  }
  const nativeRaw = t0IsNative ? sync.reserve0 : sync.reserve1
  const nativeDec = t0IsNative ? meta.decimals0 : meta.decimals1
  const nativeHuman = Number(ethers.utils.formatUnits(nativeRaw, nativeDec))
  if (!(nativeHuman >= 0) || !Number.isFinite(nativeHuman)) {
    return undefined
  }
  return nativeHuman * usdPerNative * 2
}

/**
 * 24h swap volume in USD for a v2 pool: the wrapped-native leg's 24h token volume × usdPerNative.
 * We measure only the native-leg flow (which we can price via the anchor) — the paired token has no
 * independent oracle. Requires a wrapped-native side; returns undefined when there's no anchor, no
 * meta, no native side, or the underlying token-volume read is undefined. Real zero-volume returns 0.
 */
export function getPoolVolumeUsd24h(db: SqliteDatabase, chainId: number, pool: string): number | undefined {
  const usdPerNative = getUsdPerNative(db, chainId)
  if (usdPerNative === undefined) {
    return undefined
  }
  const chain = getChain(chainId)
  if (!chain) {
    return undefined
  }
  const meta = getPoolMeta(db, chainId, pool)
  if (!meta) {
    return undefined
  }
  const wnative = chain.wrappedNative.address.toLowerCase()
  const t0IsNative = meta.token0.toLowerCase() === wnative
  const t1IsNative = meta.token1.toLowerCase() === wnative
  if (!t0IsNative && !t1IsNative) {
    return undefined
  }
  const vol = get24hVolumeTokens(db, chainId, pool)
  if (!vol) {
    return undefined
  }
  const nativeVol = t0IsNative ? vol.volumeToken0 : vol.volumeToken1
  return nativeVol * usdPerNative
}

/* ============================================================================================
 * UNISWAP-v3 + v4 METRICS (sqrtPriceX96 price; both-sides USD TVL; native-leg USD volume)
 *
 * SHARED MATH:
 *   price(token0-in-token1, HUMAN) = (sqrtPriceX96 / 2^96)^2 × 10^(dec0 - dec1)
 *   — this is the ONLY correct price for a concentrated-liquidity pool; the pool's raw token BALANCES
 *     do NOT give price (verified on-chain: HSTT/WETH balance-ratio ≠ sqrtPrice-derived price).
 *
 * USD anchoring reuses the SAME single on-chain rate as v2 — `getUsdPerNative(db, chainId)` (the v2
 * wrapped-native/stablecoin pool). A v3/v4 pool must have a NATIVE side (wrapped-native, or the v4 zero-
 * address native currency) to be USD-anchored; otherwise every USD field is undefined (never fabricated).
 *   token USD price  = priceInNative × usdPerNative
 *   pool USD TVL     = nativeSideAmount × usdPerNative  +  otherSideAmount × priceOtherInNative × usdPerNative
 *   pool 24h USD vol = nativeLegSwapVolume × usdPerNative
 * A pool with no swaps yet returns a genuine 0 volume / empty history (distinct from undefined).
 * ============================================================================================ */

const Q96 = 2 ** 96
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** price of token0 expressed in token1 (HUMAN units) from a v3/v4 sqrtPriceX96. undefined if not > 0. */
function priceFromSqrtX96(sqrtPriceX96: string, dec0: number, dec1: number): number | undefined {
  const s = Number(sqrtPriceX96)
  if (!(s > 0) || !Number.isFinite(s)) {
    return undefined
  }
  const ratio = s / Q96
  const price0in1 = ratio * ratio * Math.pow(10, dec0 - dec1)
  return price0in1 > 0 && Number.isFinite(price0in1) ? price0in1 : undefined
}

/** True when a token/currency address is the chain's native side (wrapped-native, or v4 zero-address native). */
function isNativeSideAddr(addr: string, wnativeLower: string): boolean {
  const a = addr.toLowerCase()
  return a === wnativeLower || a === ZERO_ADDRESS
}

// ---------- v3 ----------

/**
 * Latest reserve-derived-equivalent spot price for a v3 pool, both directions, from the pool's latest
 * slot0 sqrtPriceX96 snapshot. Native/token-denominated only (same shape/semantics as the v2 helper, so
 * handlers orient + USD-anchor it identically). undefined with no state snapshot / no meta / zero price.
 */
export function getV3SpotPriceNative(db: SqliteDatabase, chainId: number, pool: string): SpotPriceNative | undefined {
  const meta = getV3PoolRow(db, chainId, pool)
  const state = getV3PoolState(db, chainId, pool)
  if (!meta || !state) {
    return undefined
  }
  const p0 = priceFromSqrtX96(state.sqrtPriceX96, meta.decimals0, meta.decimals1)
  if (p0 === undefined || !(p0 > 0)) {
    return undefined
  }
  return { priceToken0InToken1: p0, priceToken1InToken0: 1 / p0 }
}

/**
 * Full v3 pool USD TVL = both sides valued in USD. The native side is priced directly via the anchor;
 * the paired (launch) token is priced via the pool's own sqrtPriceX96 (its native-denominated price) ×
 * the anchor. Requires a native side + an ingested anchor. undefined otherwise (never fabricated).
 */
export function getV3PoolTvlUsd(db: SqliteDatabase, chainId: number, pool: string): number | undefined {
  const usdPerNative = getUsdPerNative(db, chainId)
  if (usdPerNative === undefined) {
    return undefined
  }
  const chain = getChain(chainId)
  const meta = getV3PoolRow(db, chainId, pool)
  const state = getV3PoolState(db, chainId, pool)
  if (!chain || !meta || !state) {
    return undefined
  }
  const wnative = chain.wrappedNative.address.toLowerCase()
  const t0IsNative = isNativeSideAddr(meta.token0, wnative)
  const t1IsNative = isNativeSideAddr(meta.token1, wnative)
  if (!t0IsNative && !t1IsNative) {
    return undefined
  }
  const bal0 = Number(ethers.utils.formatUnits(state.balance0, meta.decimals0))
  const bal1 = Number(ethers.utils.formatUnits(state.balance1, meta.decimals1))
  const p0 = priceFromSqrtX96(state.sqrtPriceX96, meta.decimals0, meta.decimals1) // token1 per token0
  let usd: number
  if (p0 === undefined || !(p0 > 0)) {
    // No usable price — value only the native side (exact), honestly omit the unpriceable other side.
    const nativeBal = t0IsNative ? bal0 : bal1
    usd = nativeBal * usdPerNative
  } else if (t0IsNative) {
    // token0 = native; token1 price in native = 1/p0.
    usd = bal0 * usdPerNative + bal1 * (1 / p0) * usdPerNative
  } else {
    // token1 = native; token0 price in native = p0.
    usd = bal1 * usdPerNative + bal0 * p0 * usdPerNative
  }
  return Number.isFinite(usd) && usd >= 0 ? usd : undefined
}

/**
 * 24h v3 USD volume = the native-leg swap flow (Σ|nativeAmount| over now-24h) × usdPerNative. Requires a
 * native side + anchor. Real zero (pool exists, no swaps) returns 0; undefined when unanchorable.
 */
export function getV3PoolVolumeUsd24h(db: SqliteDatabase, chainId: number, pool: string): number | undefined {
  const usdPerNative = getUsdPerNative(db, chainId)
  if (usdPerNative === undefined) {
    return undefined
  }
  const chain = getChain(chainId)
  const meta = getV3PoolRow(db, chainId, pool)
  if (!chain || !meta) {
    return undefined
  }
  const wnative = chain.wrappedNative.address.toLowerCase()
  const t0IsNative = isNativeSideAddr(meta.token0, wnative)
  const t1IsNative = isNativeSideAddr(meta.token1, wnative)
  if (!t0IsNative && !t1IsNative) {
    return undefined
  }
  const since = Math.floor(Date.now() / 1000) - SECONDS_PER_DAY
  const rows = db
    .prepare(`SELECT amount0, amount1 FROM v3_swap_events WHERE chainId=? AND pool=? AND timestamp >= ?`)
    .all(chainId, pool, since) as Array<{ amount0: string; amount1: string }>
  let native = BigNumber.from(0)
  for (const r of rows) {
    native = native.add(BigNumber.from(t0IsNative ? r.amount0 : r.amount1).abs())
  }
  const nativeDec = t0IsNative ? meta.decimals0 : meta.decimals1
  const nativeHuman = Number(ethers.utils.formatUnits(native, nativeDec))
  return nativeHuman * usdPerNative
}

/** v3 native-denominated price history (token0-in-token1 close per bucket) from swap sqrtPrices. */
export function getV3PriceHistory(
  db: SqliteDatabase,
  chainId: number,
  pool: string,
  sinceTs: number,
  bucketSec: number,
): PricePoint[] {
  const meta = getV3PoolRow(db, chainId, pool)
  if (!meta || !(bucketSec > 0)) {
    return []
  }
  const rows = db
    .prepare(
      `SELECT sqrtPriceX96, timestamp FROM v3_swap_events
         WHERE chainId=? AND pool=? AND timestamp >= ?
         ORDER BY blockNumber ASC, logIndex ASC`,
    )
    .all(chainId, pool, sinceTs) as Array<{ sqrtPriceX96: string; timestamp: number }>
  const byBucket = new Map<number, number>()
  for (const r of rows) {
    const p = priceFromSqrtX96(r.sqrtPriceX96, meta.decimals0, meta.decimals1)
    if (p === undefined) {
      continue
    }
    const bucket = Math.floor(r.timestamp / bucketSec) * bucketSec
    byBucket.set(bucket, p)
  }
  return Array.from(byBucket.entries())
    .map(([t, price]) => ({ t, price }))
    .sort((a, b) => a.t - b.t)
}

/**
 * v3 24h price change (token0-in-token1) as a FRACTION: now (latest slot0) vs the last swap price at/or-
 * before the 24h-ago mark. undefined without a pre-window baseline swap or current state (never faked).
 */
export function getV3PriceChange24hNative(db: SqliteDatabase, chainId: number, pool: string): number | undefined {
  const meta = getV3PoolRow(db, chainId, pool)
  const state = getV3PoolState(db, chainId, pool)
  if (!meta || !state) {
    return undefined
  }
  const priceNow = priceFromSqrtX96(state.sqrtPriceX96, meta.decimals0, meta.decimals1)
  if (priceNow === undefined) {
    return undefined
  }
  const cutoff = Math.floor(Date.now() / 1000) - SECONDS_PER_DAY
  const then = db
    .prepare(
      `SELECT sqrtPriceX96 FROM v3_swap_events WHERE chainId=? AND pool=? AND timestamp <= ?
         ORDER BY timestamp DESC, blockNumber DESC, logIndex DESC LIMIT 1`,
    )
    .get(chainId, pool, cutoff) as { sqrtPriceX96: string } | undefined
  if (!then) {
    return undefined
  }
  const priceThen = priceFromSqrtX96(then.sqrtPriceX96, meta.decimals0, meta.decimals1)
  if (priceThen === undefined || !(priceThen > 0)) {
    return undefined
  }
  return (priceNow - priceThen) / priceThen
}

// ---------- v4 (singleton; poolId) ----------

/** Latest v4 spot price both directions from the pool-state sqrtPriceX96 snapshot. */
export function getV4SpotPriceNative(db: SqliteDatabase, chainId: number, poolId: string): SpotPriceNative | undefined {
  const meta = getV4PoolRow(db, chainId, poolId)
  const state = getV4PoolState(db, chainId, poolId)
  if (!meta || !state) {
    return undefined
  }
  const p0 = priceFromSqrtX96(state.sqrtPriceX96, meta.decimals0, meta.decimals1)
  if (p0 === undefined || !(p0 > 0)) {
    return undefined
  }
  return { priceToken0InToken1: p0, priceToken1InToken0: 1 / p0 }
}

/**
 * v4 pool USD TVL from the accumulated per-pool token amounts (v4_pool_state.tvl{0,1}Human — the
 * PoolManager is a singleton with no per-pool balanceOf, so these are accumulated from ModifyLiquidity
 * via tick-math in the ingest layer). Both sides valued: native via anchor, other via sqrtPrice × anchor.
 */
export function getV4PoolTvlUsd(db: SqliteDatabase, chainId: number, poolId: string): number | undefined {
  const usdPerNative = getUsdPerNative(db, chainId)
  if (usdPerNative === undefined) {
    return undefined
  }
  const chain = getChain(chainId)
  const meta = getV4PoolRow(db, chainId, poolId)
  const state = getV4PoolState(db, chainId, poolId)
  if (!chain || !meta || !state) {
    return undefined
  }
  const wnative = chain.wrappedNative.address.toLowerCase()
  const t0IsNative = isNativeSideAddr(meta.currency0, wnative)
  const t1IsNative = isNativeSideAddr(meta.currency1, wnative)
  if (!t0IsNative && !t1IsNative) {
    return undefined
  }
  const bal0 = Number(state.tvl0Human)
  const bal1 = Number(state.tvl1Human)
  if (!Number.isFinite(bal0) || !Number.isFinite(bal1)) {
    return undefined
  }
  const p0 = priceFromSqrtX96(state.sqrtPriceX96, meta.decimals0, meta.decimals1)
  let usd: number
  if (p0 === undefined || !(p0 > 0)) {
    usd = (t0IsNative ? bal0 : bal1) * usdPerNative
  } else if (t0IsNative) {
    usd = bal0 * usdPerNative + bal1 * (1 / p0) * usdPerNative
  } else {
    usd = bal1 * usdPerNative + bal0 * p0 * usdPerNative
  }
  return Number.isFinite(usd) && usd >= 0 ? usd : undefined
}

/** 24h v4 USD volume = native-leg swap flow × usdPerNative. Real zero when no swaps; undefined if unanchorable. */
export function getV4PoolVolumeUsd24h(db: SqliteDatabase, chainId: number, poolId: string): number | undefined {
  const usdPerNative = getUsdPerNative(db, chainId)
  if (usdPerNative === undefined) {
    return undefined
  }
  const chain = getChain(chainId)
  const meta = getV4PoolRow(db, chainId, poolId)
  if (!chain || !meta) {
    return undefined
  }
  const wnative = chain.wrappedNative.address.toLowerCase()
  const t0IsNative = isNativeSideAddr(meta.currency0, wnative)
  const t1IsNative = isNativeSideAddr(meta.currency1, wnative)
  if (!t0IsNative && !t1IsNative) {
    return undefined
  }
  const since = Math.floor(Date.now() / 1000) - SECONDS_PER_DAY
  const rows = db
    .prepare(`SELECT amount0, amount1 FROM v4_swap_events WHERE chainId=? AND poolId=? AND timestamp >= ?`)
    .all(chainId, poolId, since) as Array<{ amount0: string; amount1: string }>
  let native = BigNumber.from(0)
  for (const r of rows) {
    native = native.add(BigNumber.from(t0IsNative ? r.amount0 : r.amount1).abs())
  }
  const nativeDec = t0IsNative ? meta.decimals0 : meta.decimals1
  const nativeHuman = Number(ethers.utils.formatUnits(native, nativeDec))
  return nativeHuman * usdPerNative
}

/** v4 native-denominated price history (token0-in-token1 close per bucket) from swap sqrtPrices. */
export function getV4PriceHistory(
  db: SqliteDatabase,
  chainId: number,
  poolId: string,
  sinceTs: number,
  bucketSec: number,
): PricePoint[] {
  const meta = getV4PoolRow(db, chainId, poolId)
  if (!meta || !(bucketSec > 0)) {
    return []
  }
  const rows = db
    .prepare(
      `SELECT sqrtPriceX96, timestamp FROM v4_swap_events
         WHERE chainId=? AND poolId=? AND timestamp >= ?
         ORDER BY blockNumber ASC, logIndex ASC`,
    )
    .all(chainId, poolId, sinceTs) as Array<{ sqrtPriceX96: string; timestamp: number }>
  const byBucket = new Map<number, number>()
  for (const r of rows) {
    const p = priceFromSqrtX96(r.sqrtPriceX96, meta.decimals0, meta.decimals1)
    if (p === undefined) {
      continue
    }
    const bucket = Math.floor(r.timestamp / bucketSec) * bucketSec
    byBucket.set(bucket, p)
  }
  return Array.from(byBucket.entries())
    .map(([t, price]) => ({ t, price }))
    .sort((a, b) => a.t - b.t)
}

/** v4 24h price change (token0-in-token1) fraction: latest state vs last swap ≤ cutoff. undefined if no baseline. */
export function getV4PriceChange24hNative(db: SqliteDatabase, chainId: number, poolId: string): number | undefined {
  const meta = getV4PoolRow(db, chainId, poolId)
  const state = getV4PoolState(db, chainId, poolId)
  if (!meta || !state) {
    return undefined
  }
  const priceNow = priceFromSqrtX96(state.sqrtPriceX96, meta.decimals0, meta.decimals1)
  if (priceNow === undefined) {
    return undefined
  }
  const cutoff = Math.floor(Date.now() / 1000) - SECONDS_PER_DAY
  const then = db
    .prepare(
      `SELECT sqrtPriceX96 FROM v4_swap_events WHERE chainId=? AND poolId=? AND timestamp <= ?
         ORDER BY timestamp DESC, blockNumber DESC, logIndex DESC LIMIT 1`,
    )
    .get(chainId, poolId, cutoff) as { sqrtPriceX96: string } | undefined
  if (!then) {
    return undefined
  }
  const priceThen = priceFromSqrtX96(then.sqrtPriceX96, meta.decimals0, meta.decimals1)
  if (priceThen === undefined || !(priceThen > 0)) {
    return undefined
  }
  return (priceNow - priceThen) / priceThen
}
