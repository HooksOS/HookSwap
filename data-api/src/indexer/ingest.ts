/**
 * Event ingest for the HookSwap Phase-2 indexer.
 *
 * Discovers real v2 pools per chain (onchain.getV2Pairs — factory enumeration + seeded CREATE2, all
 * on-chain-verified with live reserves), records their token metadata (pool_meta), then scans each
 * pool's Swap + Sync logs into SQLite. Everything stored comes from a real on-chain log or read —
 * nothing is fabricated.
 *
 * BACKFILL + TAIL + RESUME:
 *   - First pass for a pool with no cursor starts at `latest - INDEXER_BACKFILL_BLOCKS` (default
 *     200_000), clamped to >= 0. The bounded start is LOGGED (no silent truncation) so it's clear how
 *     far back history goes; a pool's Sync/Swap history before that window is simply absent (metrics
 *     honestly return undefined/empty rather than guessing).
 *   - Scanning is CHUNKED (INDEXER_LOG_CHUNK blocks per eth_getLogs, mirroring onchain.ts's v3 scanner)
 *     and RESUMABLE: after each chunk the cursor is persisted (setCursor = last fully-scanned block),
 *     so an interrupted or restarted process resumes from `cursor + 1` and never rescans/duplicates
 *     (inserts are idempotent via INSERT OR IGNORE anyway).
 *   - The tail loop (startIngestLoop) re-runs runIngestOnce on an interval; each pass only scans
 *     cursor+1..latest, i.e. new blocks since the previous pass.
 *
 * Error policy: per-chain and per-pool work is wrapped so a single bad RPC/pool never aborts the pass
 * — runIngestOnce always resolves (never throws out of the loop).
 */

import { ethers } from 'ethers'
import { getProvider, getTokenMeta, getV2Pairs, readV3LiveState, TokenMeta } from '../onchain'
import { ChainConfig, getChain, supportedChainIds } from '../chains'
import {
  getCursor,
  getDb,
  getV3PoolRows,
  getV4PoolRow,
  getV4PoolState,
  insertSwapEvents,
  insertSyncEvents,
  insertV3SwapEvents,
  insertV4SwapEvents,
  setCursor,
  SNAPSHOT_LOG_INDEX,
  SwapEventRow,
  SyncEventRow,
  upsertPoolMeta,
  upsertV3Pool,
  upsertV4Pool,
  V3SwapEventRow,
  V4SwapEventRow,
  writeReserveSnapshot,
  writeV3PoolState,
  writeV4PoolState,
} from './schema'
import {
  parseSwapLog,
  parseSyncLog,
  parseV3PoolCreatedLog,
  parseV3SwapLog,
  parseV4InitializeLog,
  parseV4ModifyLiquidityLog,
  parseV4SwapLog,
  SWAP_TOPIC,
  SYNC_TOPIC,
  V3_POOL_CREATED_TOPIC,
  V3_SWAP_TOPIC,
  V4_INITIALIZE_TOPIC,
  V4_MODIFY_LIQUIDITY_TOPIC,
  V4_SWAP_TOPIC,
} from './abis'

/** Blocks per eth_getLogs window. Public RPCs commonly cap ranges; 9_500 matches onchain.ts's v3 scanner. */
const INDEXER_LOG_CHUNK = 9_500

/** How far back the FIRST scan of a never-seen pool reaches (blocks). Overridable via env. */
function backfillBlocks(): number {
  const env = process.env.INDEXER_BACKFILL_BLOCKS
  if (env && /^\d+$/.test(env.trim())) {
    return Number(env.trim())
  }
  return 200_000
}

/**
 * Effective set of chainIds to ingest this pass. `INDEXER_CHAINS` (comma-separated chainIds, e.g.
 * `4663` for Robinhood-only) SCOPES ingest to just those chains, intersected with the supported set —
 * this lets prod index only Robinhood without hammering all 6 public RPCs. Unset/blank/all-invalid →
 * the full supported set (unchanged default behavior). Error-safe: bad tokens are ignored, never throw.
 */
function ingestChainIds(): number[] {
  const supported = supportedChainIds()
  const env = process.env.INDEXER_CHAINS
  if (!env || !env.trim()) {
    return supported
  }
  const requested = env
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
  const filtered = supported.filter((id) => requested.includes(id))
  // If the env named only unsupported/invalid ids, fall back to all supported (never ingest nothing
  // silently due to a typo). The effective set is logged by the caller.
  return filtered.length > 0 ? filtered : supported
}

/** Per-pass ingest result (rows NEWLY inserted this pass). */
export interface IngestPoolResult {
  chainId: number
  pool: string
  swaps: number
  syncs: number
}

/**
 * Fetch (and cache) the unix-second timestamp for a set of block numbers on one chain. Block numbers
 * are unique within a chain, so the cache is keyed by block number only. Failed fetches are simply
 * left out of the cache (the caller skips any row whose block timestamp is unavailable rather than
 * storing a fabricated time).
 */
async function loadBlockTimestamps(
  provider: ethers.providers.JsonRpcProvider,
  blocks: number[],
  cache: Map<number, number>,
): Promise<void> {
  const missing = Array.from(new Set(blocks)).filter((b) => !cache.has(b))
  await Promise.all(
    missing.map(async (b) => {
      try {
        const blk = await provider.getBlock(b)
        if (blk && typeof blk.timestamp === 'number') {
          cache.set(b, blk.timestamp)
        }
      } catch {
        // RPC hiccup — leave uncached; rows for this block are skipped (never timestamped with a fake).
      }
    }),
  )
}

/**
 * Resolve the tx-origin EOA (`tx.from`) for a set of transaction hashes — the REAL trader wallet, which
 * the v2 Swap event does NOT carry (Swap.sender = router, Swap.to = next-hop recipient; see schema.ts).
 * One `getTransaction` per unique hash (multi-hop swaps share a tx → deduped by the Set), cached across
 * chunks/pools. Failed lookups are simply left out of the cache (the caller leaves origin='' rather than
 * fabricating an address). Never throws.
 */
async function loadTxOrigins(
  provider: ethers.providers.JsonRpcProvider,
  txHashes: string[],
  cache: Map<string, string>,
): Promise<void> {
  const missing = Array.from(new Set(txHashes)).filter((h) => !cache.has(h))
  await Promise.all(
    missing.map(async (h) => {
      try {
        const tx = await provider.getTransaction(h)
        if (tx && typeof tx.from === 'string' && tx.from) {
          cache.set(h, tx.from.toLowerCase())
        }
      } catch {
        // RPC hiccup — leave uncached; the row's origin stays '' (never a fabricated address).
      }
    }),
  )
}

/**
 * Scan one pool's Swap+Sync logs from `startBlock`..`latest`, chunked + resumable. Returns the count
 * of rows newly inserted. Never throws (caller-safe); on a chunk error it logs and stops this pool's
 * pass at the last good cursor (resumes next pass).
 */
async function ingestPool(
  provider: ethers.providers.JsonRpcProvider,
  chainId: number,
  pool: string,
  startBlock: number,
  latest: number,
  tsCache: Map<number, number>,
  originCache: Map<string, string>,
): Promise<{ swaps: number; syncs: number }> {
  const db = getDb()
  let swaps = 0
  let syncs = 0
  let start = startBlock
  while (start <= latest) {
    const end = Math.min(start + INDEXER_LOG_CHUNK - 1, latest)
    let logs: ethers.providers.Log[]
    try {
      // topic0 = Swap OR Sync (single getLogs call), filtered to this pool address.
      logs = await provider.getLogs({
        address: pool,
        topics: [[SWAP_TOPIC, SYNC_TOPIC]],
        fromBlock: start,
        toBlock: end,
      })
    } catch (err) {
      // RPC rejected this range — stop here; cursor stays at the last persisted block so we resume.
      // eslint-disable-next-line no-console
      console.warn(`[indexer] chain ${chainId} pool ${pool} getLogs ${start}-${end} failed; resuming next pass`, err)
      break
    }

    // Batch-resolve timestamps for every block appearing in this chunk (cached across chunks/pools).
    await loadBlockTimestamps(provider, logs.map((l) => l.blockNumber), tsCache)
    // Batch-resolve tx.from (trader EOA) for the SWAP logs in this chunk (cached across chunks/pools).
    await loadTxOrigins(
      provider,
      logs.filter((l) => l.topics[0] === SWAP_TOPIC).map((l) => l.transactionHash),
      originCache,
    )

    const swapRows: SwapEventRow[] = []
    const syncRows: SyncEventRow[] = []
    for (const log of logs) {
      const ts = tsCache.get(log.blockNumber)
      if (ts === undefined) {
        // No honest timestamp for this block — skip (never store a fabricated time).
        continue
      }
      if (log.topics[0] === SWAP_TOPIC) {
        const p = parseSwapLog(log)
        if (p) {
          // tx.from (lowercased) is the real trader EOA; '' when the RPC lookup failed (never faked).
          const origin = originCache.get(log.transactionHash) ?? ''
          swapRows.push({ chainId, pool, blockNumber: log.blockNumber, timestamp: ts, origin, ...p })
        }
      } else if (log.topics[0] === SYNC_TOPIC) {
        const p = parseSyncLog(log)
        if (p) {
          syncRows.push({ chainId, pool, blockNumber: log.blockNumber, timestamp: ts, ...p })
        }
      }
    }

    swaps += insertSwapEvents(db, swapRows)
    syncs += insertSyncEvents(db, syncRows)

    // Persist progress AFTER the chunk is committed → resumable, idempotent.
    setCursor(db, chainId, pool, end)
    start = end + 1
  }
  return { swaps, syncs }
}

/* ============================================================================================
 * v3 INGEST — factory PoolCreated discovery (persisted) + per-pool Swap scan + live slot0/balance state.
 * ============================================================================================ */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
/** 2^96 as a float — for sqrtPriceX96 → raw-sqrt-price conversion in the v4 TVL tick-math. */
const Q96 = 2 ** 96

/**
 * getLogs with ADAPTIVE range-splitting. A busy singleton (the v4 PoolManager emits every pool's events)
 * can exceed an RPC's per-query log cap (e.g. Robinhood's "logs matched by query exceeds limit of 10000")
 * even on a small block span. On ANY getLogs error over a multi-block range we bisect and retry each half,
 * down to a single block. Returns the union of all sub-range logs. Throws only if a SINGLE-block query
 * fails (a genuine RPC failure the caller treats as "resume next pass"). Never fabricates.
 */
async function getLogsAdaptive(
  provider: ethers.providers.JsonRpcProvider,
  filter: { address: string; topics: (string | string[])[] },
  fromBlock: number,
  toBlock: number,
): Promise<ethers.providers.Log[]> {
  try {
    return await provider.getLogs({ ...filter, fromBlock, toBlock })
  } catch (err) {
    if (fromBlock >= toBlock) {
      throw err // single block already — a real failure, let the caller resume next pass
    }
    const mid = Math.floor((fromBlock + toBlock) / 2)
    const [a, b] = await Promise.all([
      getLogsAdaptive(provider, filter, fromBlock, mid),
      getLogsAdaptive(provider, filter, mid + 1, toBlock),
    ])
    return a.concat(b)
  }
}

/** Resolve the FIRST-scan start block for a factory/PoolManager scan: env override → deployBlock → latest-backfill. */
function scanStartBlock(chainId: number, latest: number, backfill: number, envVar: string, deployBlock: number | undefined): number {
  const env = process.env[envVar]
  if (env && /^\d+$/.test(env.trim())) {
    return Number(env.trim())
  }
  if (typeof deployBlock === 'number') {
    return deployBlock
  }
  return Math.max(0, latest - backfill)
}

/**
 * Discover NEW v3 pools on a chain by scanning the v3 factory's PoolCreated logs from a persisted
 * discovery cursor (keyed by the factory address so it never collides with a real pool's swap cursor).
 * Persists each pool's metadata (real on-chain token reads) to v3_pools. Chunked + resumable + error-safe.
 */
async function discoverV3Pools(
  provider: ethers.providers.JsonRpcProvider,
  chainId: number,
  chain: ChainConfig,
  latest: number,
  backfill: number,
): Promise<number> {
  const db = getDb()
  if (!chain.v3Factory || /^0x0+$/.test(chain.v3Factory)) {
    return 0
  }
  const factory = chain.v3Factory.toLowerCase()
  const cursorKey = `v3factory:${factory}`
  const cursor = getCursor(db, chainId, cursorKey)
  let start =
    cursor !== undefined ? cursor + 1 : scanStartBlock(chainId, latest, backfill, `V3_SCAN_FROM_BLOCK_${chainId}`, chain.v3DeployBlock)
  if (start > latest) {
    return 0
  }
  if (cursor === undefined) {
    // eslint-disable-next-line no-console
    console.log(`[indexer] chain ${chainId} v3 discovery: first factory scan bounded to ${start}-${latest}`)
  }
  let discovered = 0
  while (start <= latest) {
    const end = Math.min(start + INDEXER_LOG_CHUNK - 1, latest)
    let logs: ethers.providers.Log[]
    try {
      logs = await provider.getLogs({ address: factory, topics: [V3_POOL_CREATED_TOPIC], fromBlock: start, toBlock: end })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[indexer] chain ${chainId} v3 discovery getLogs ${start}-${end} failed; resuming next pass`, err)
      break
    }
    for (const log of logs) {
      const pc = parseV3PoolCreatedLog(log)
      if (!pc) {
        continue
      }
      const [t0, t1] = await Promise.all([
        getTokenMeta(chainId, pc.token0).catch(() => undefined),
        getTokenMeta(chainId, pc.token1).catch(() => undefined),
      ])
      if (!t0 || !t1) {
        continue // couldn't read real token metadata — skip, never fabricate
      }
      upsertV3Pool(db, {
        chainId,
        pool: pc.pool,
        token0: t0.address.toLowerCase(),
        token1: t1.address.toLowerCase(),
        decimals0: t0.decimals,
        decimals1: t1.decimals,
        symbol0: t0.symbol,
        symbol1: t1.symbol,
        fee: pc.fee,
        tickSpacing: pc.tickSpacing,
      })
      discovered++
    }
    setCursor(db, chainId, cursorKey, end)
    start = end + 1
  }
  return discovered
}

/** Scan one v3 pool's Swap logs start..latest, chunked + resumable. Mirrors the v2 ingestPool loop. */
async function ingestV3Pool(
  provider: ethers.providers.JsonRpcProvider,
  chainId: number,
  pool: string,
  startBlock: number,
  latest: number,
  tsCache: Map<number, number>,
  originCache: Map<string, string>,
): Promise<number> {
  const db = getDb()
  let swaps = 0
  let start = startBlock
  while (start <= latest) {
    const end = Math.min(start + INDEXER_LOG_CHUNK - 1, latest)
    let logs: ethers.providers.Log[]
    try {
      logs = await getLogsAdaptive(provider, { address: pool, topics: [V3_SWAP_TOPIC] }, start, end)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[indexer] chain ${chainId} v3 pool ${pool} getLogs ${start}-${end} failed; resuming next pass`, err)
      break
    }
    await loadBlockTimestamps(provider, logs.map((l) => l.blockNumber), tsCache)
    await loadTxOrigins(provider, logs.map((l) => l.transactionHash), originCache)
    const rows: V3SwapEventRow[] = []
    for (const log of logs) {
      const ts = tsCache.get(log.blockNumber)
      if (ts === undefined) {
        continue
      }
      const p = parseV3SwapLog(log)
      if (!p) {
        continue
      }
      const origin = originCache.get(log.transactionHash) ?? ''
      rows.push({
        chainId,
        pool,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        txHash: p.txHash,
        sender: p.sender,
        recipient: p.recipient,
        origin,
        amount0: p.amount0,
        amount1: p.amount1,
        sqrtPriceX96: p.sqrtPriceX96,
        liquidity: p.liquidity,
        tick: p.tick,
        timestamp: ts,
      })
    }
    swaps += insertV3SwapEvents(db, rows)
    setCursor(db, chainId, pool, end)
    start = end + 1
  }
  return swaps
}

/**
 * Ingest all known v3 pools on a chain: (1) discover new pools from the factory, (2) snapshot each pool's
 * live slot0 (exact price) + token balances (exact TVL basis) into v3_pool_state, (3) scan its Swap logs
 * (volume + price history). Error-safe per pool.
 */
async function ingestV3ForChain(
  provider: ethers.providers.JsonRpcProvider,
  chainId: number,
  chain: ChainConfig,
  latest: number,
  backfill: number,
  tsCache: Map<number, number>,
  originCache: Map<string, string>,
): Promise<{ pools: number; swaps: number }> {
  const db = getDb()
  let discovered = 0
  try {
    discovered = await discoverV3Pools(provider, chainId, chain, latest, backfill)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[indexer] chain ${chainId} v3 discovery failed (skipped)`, err)
  }
  const pools = getV3PoolRows(db, chainId)
  let swaps = 0
  for (const pool of pools) {
    try {
      // Live slot0 + balances snapshot — exact current price + TVL basis, independent of the swap backfill.
      const live = await readV3LiveState(chainId, pool.pool, pool.token0, pool.token1)
      if (live) {
        writeV3PoolState(db, {
          chainId,
          pool: pool.pool,
          blockNumber: latest,
          sqrtPriceX96: live.sqrtPriceX96,
          tick: live.tick,
          liquidity: live.liquidity,
          balance0: live.balance0,
          balance1: live.balance1,
          timestamp: Math.floor(Date.now() / 1000),
        })
      }
      const cursor = getCursor(db, chainId, pool.pool)
      const start = cursor !== undefined ? cursor + 1 : Math.max(0, latest - backfill)
      if (start <= latest) {
        swaps += await ingestV3Pool(provider, chainId, pool.pool, start, latest, tsCache, originCache)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[indexer] chain ${chainId} v3 pool ${pool.pool} ingest failed (skipped)`, err)
    }
  }
  return { pools: pools.length, swaps }
}

/* ============================================================================================
 * v4 INGEST — singleton PoolManager scan (Initialize + Swap + ModifyLiquidity), one cursor per chain.
 * TVL is accumulated per pool from ModifyLiquidity via tick-math (v4 has no per-pool balanceOf).
 * ============================================================================================ */

/** In-memory per-pool folding state for one v4 ingest pass (seeded from persisted v4_pool_state). */
interface V4FoldState {
  sqrtPriceX96: string
  tick: number
  liquidity: string
  /** accumulated TVL in HUMAN units. */
  tvl0: number
  tvl1: number
  dec0: number
  dec1: number
  block: number
  touched: boolean
}

/** Convert a v4 ModifyLiquidity (signed liquidityDelta over [tickLower,tickUpper]) to signed HUMAN token amounts
 *  at the pool's current raw sqrt price — the standard concentrated-liquidity principal math. */
function liquidityDeltaToAmountsHuman(
  liquidityDelta: string,
  tickLower: number,
  tickUpper: number,
  sqrtPriceX96Raw: string,
  dec0: number,
  dec1: number,
): { amount0Human: number; amount1Human: number } {
  const L = Number(liquidityDelta)
  const sqrtPx = Number(sqrtPriceX96Raw)
  if (!Number.isFinite(L) || L === 0 || !(sqrtPx > 0)) {
    return { amount0Human: 0, amount1Human: 0 }
  }
  const sqrtP = sqrtPx / Q96
  const sqrtA = Math.pow(1.0001, tickLower / 2)
  const sqrtB = Math.pow(1.0001, tickUpper / 2)
  if (!(sqrtA > 0) || !(sqrtB > sqrtA)) {
    return { amount0Human: 0, amount1Human: 0 }
  }
  const absL = Math.abs(L)
  let amount0Raw = 0
  let amount1Raw = 0
  if (sqrtP <= sqrtA) {
    amount0Raw = (absL * (sqrtB - sqrtA)) / (sqrtA * sqrtB)
  } else if (sqrtP >= sqrtB) {
    amount1Raw = absL * (sqrtB - sqrtA)
  } else {
    amount0Raw = (absL * (sqrtB - sqrtP)) / (sqrtP * sqrtB)
    amount1Raw = absL * (sqrtP - sqrtA)
  }
  const sign = L < 0 ? -1 : 1
  return {
    amount0Human: (sign * amount0Raw) / Math.pow(10, dec0),
    amount1Human: (sign * amount1Raw) / Math.pow(10, dec1),
  }
}

/** Resolve a v4 currency's {symbol, decimals}. The zero address = the chain's native coin (v4 native). */
async function resolveCurrencyMeta(
  chainId: number,
  chain: ChainConfig,
  currency: string,
): Promise<{ symbol: string; decimals: number } | undefined> {
  if (currency.toLowerCase() === ZERO_ADDRESS) {
    return { symbol: chain.nativeSymbol, decimals: chain.nativeDecimals }
  }
  const m = await getTokenMeta(chainId, currency).catch(() => undefined as TokenMeta | undefined)
  if (!m || !m.symbol) {
    return undefined
  }
  return { symbol: m.symbol, decimals: m.decimals }
}

/**
 * Ingest a chain's v4 PoolManager (singleton). Scans Initialize/Swap/ModifyLiquidity from one persisted
 * cursor (keyed by the PoolManager address), folding events IN ORDER to maintain each pool's current price
 * and accumulated TVL. Persists v4_pools (discovery), v4_swap_events (volume/price history), and
 * v4_pool_state (price + accumulated TVL). Chunked + resumable + error-safe.
 */
async function ingestV4ForChain(
  provider: ethers.providers.JsonRpcProvider,
  chainId: number,
  chain: ChainConfig,
  latest: number,
  backfill: number,
  tsCache: Map<number, number>,
): Promise<{ pools: number; swaps: number }> {
  const db = getDb()
  if (!chain.v4PoolManager || /^0x0+$/.test(chain.v4PoolManager)) {
    return { pools: 0, swaps: 0 }
  }
  const pm = chain.v4PoolManager.toLowerCase()
  const cursorKey = `v4pm:${pm}`
  const cursor = getCursor(db, chainId, cursorKey)
  let start =
    cursor !== undefined ? cursor + 1 : scanStartBlock(chainId, latest, backfill, `V4_SCAN_FROM_BLOCK_${chainId}`, chain.v4DeployBlock)
  if (start > latest) {
    return { pools: 0, swaps: 0 }
  }
  if (cursor === undefined) {
    // eslint-disable-next-line no-console
    console.log(`[indexer] chain ${chainId} v4 PoolManager ${pm}: first scan bounded to ${start}-${latest}`)
  }

  // Per-pass fold state, seeded lazily from persisted v4_pool_state so accumulation resumes correctly.
  const stateMap = new Map<string, V4FoldState>()
  const ensureState = (poolId: string): V4FoldState => {
    const existing = stateMap.get(poolId)
    if (existing) {
      return existing
    }
    const persisted = getV4PoolState(db, chainId, poolId)
    const known = getV4PoolRow(db, chainId, poolId)
    const st: V4FoldState = {
      sqrtPriceX96: persisted?.sqrtPriceX96 ?? '',
      tick: persisted?.tick ?? 0,
      liquidity: persisted?.liquidity ?? '0',
      tvl0: persisted ? Number(persisted.tvl0Human) || 0 : 0,
      tvl1: persisted ? Number(persisted.tvl1Human) || 0 : 0,
      dec0: known?.decimals0 ?? -1,
      dec1: known?.decimals1 ?? -1,
      block: persisted?.blockNumber ?? latest,
      touched: false,
    }
    stateMap.set(poolId, st)
    return st
  }

  let poolsCount = 0
  let swaps = 0
  while (start <= latest) {
    const end = Math.min(start + INDEXER_LOG_CHUNK - 1, latest)
    let logs: ethers.providers.Log[]
    try {
      // Adaptive: the v4 singleton is busy enough to blow past an RPC's per-query log cap on a 9.5k span,
      // so bisect-on-error down to single blocks (see getLogsAdaptive).
      logs = await getLogsAdaptive(
        provider,
        { address: pm, topics: [[V4_INITIALIZE_TOPIC, V4_SWAP_TOPIC, V4_MODIFY_LIQUIDITY_TOPIC]] },
        start,
        end,
      )
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[indexer] chain ${chainId} v4 PoolManager getLogs ${start}-${end} failed; resuming next pass`, err)
      break
    }
    await loadBlockTimestamps(provider, logs.map((l) => l.blockNumber), tsCache)
    // Fold in strict chain order so the running sqrtPrice used by ModifyLiquidity tick-math is correct.
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)

    const swapRows: V4SwapEventRow[] = []
    for (const log of logs) {
      const topic0 = log.topics[0]
      const ts = tsCache.get(log.blockNumber)
      if (topic0 === V4_INITIALIZE_TOPIC) {
        const init = parseV4InitializeLog(log)
        if (!init) {
          continue
        }
        const [m0, m1] = await Promise.all([
          resolveCurrencyMeta(chainId, chain, init.currency0),
          resolveCurrencyMeta(chainId, chain, init.currency1),
        ])
        if (!m0 || !m1) {
          continue
        }
        upsertV4Pool(db, {
          chainId,
          poolId: init.poolId,
          currency0: init.currency0,
          currency1: init.currency1,
          decimals0: m0.decimals,
          decimals1: m1.decimals,
          symbol0: m0.symbol,
          symbol1: m1.symbol,
          fee: init.fee,
          tickSpacing: init.tickSpacing,
          hooks: init.hooks,
        })
        const st = ensureState(init.poolId)
        st.sqrtPriceX96 = init.sqrtPriceX96
        st.tick = init.tick
        st.dec0 = m0.decimals
        st.dec1 = m1.decimals
        st.block = log.blockNumber
        st.touched = true
        poolsCount++
      } else if (topic0 === V4_SWAP_TOPIC) {
        const sw = parseV4SwapLog(log)
        if (!sw || ts === undefined) {
          continue
        }
        swapRows.push({
          chainId,
          poolId: sw.poolId,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          txHash: sw.txHash,
          sender: sw.sender,
          origin: '',
          amount0: sw.amount0,
          amount1: sw.amount1,
          sqrtPriceX96: sw.sqrtPriceX96,
          liquidity: sw.liquidity,
          tick: sw.tick,
          fee: sw.fee,
          timestamp: ts,
        })
        const st = ensureState(sw.poolId)
        st.sqrtPriceX96 = sw.sqrtPriceX96
        st.tick = sw.tick
        st.liquidity = sw.liquidity
        st.block = log.blockNumber
        st.touched = true
      } else if (topic0 === V4_MODIFY_LIQUIDITY_TOPIC) {
        const ml = parseV4ModifyLiquidityLog(log)
        if (!ml) {
          continue
        }
        const st = ensureState(ml.poolId)
        if (st.dec0 < 0) {
          const known = getV4PoolRow(db, chainId, ml.poolId)
          if (known) {
            st.dec0 = known.decimals0
            st.dec1 = known.decimals1
          }
        }
        if (st.dec0 < 0 || !st.sqrtPriceX96) {
          continue // no price/decimals context (Initialize before scan window) — skip TVL fold honestly
        }
        const { amount0Human, amount1Human } = liquidityDeltaToAmountsHuman(
          ml.liquidityDelta,
          ml.tickLower,
          ml.tickUpper,
          st.sqrtPriceX96,
          st.dec0,
          st.dec1,
        )
        st.tvl0 = Math.max(0, st.tvl0 + amount0Human)
        st.tvl1 = Math.max(0, st.tvl1 + amount1Human)
        st.block = log.blockNumber
        st.touched = true
      }
    }
    swaps += insertV4SwapEvents(db, swapRows)
    // Persist every touched pool's price + accumulated TVL, THEN advance the cursor (resumable).
    const nowSec = Math.floor(Date.now() / 1000)
    for (const [poolId, st] of stateMap) {
      if (!st.touched || !st.sqrtPriceX96) {
        continue
      }
      writeV4PoolState(db, {
        chainId,
        poolId,
        blockNumber: st.block,
        sqrtPriceX96: st.sqrtPriceX96,
        tick: st.tick,
        liquidity: st.liquidity,
        tvl0Human: String(st.tvl0),
        tvl1Human: String(st.tvl1),
        timestamp: nowSec,
      })
      st.touched = false
    }
    setCursor(db, chainId, cursorKey, end)
    start = end + 1
  }
  return { pools: poolsCount, swaps }
}

/**
 * One full ingest pass across all supported chains. Discovers pools (getV2Pairs), records pool_meta,
 * then backfills/tails each pool's Swap+Sync logs. Error-safe per chain and per pool — always resolves.
 */
export async function runIngestOnce(): Promise<IngestPoolResult[]> {
  const db = getDb()
  const results: IngestPoolResult[] = []
  const backfill = backfillBlocks()

  const chainIds = ingestChainIds()
  // eslint-disable-next-line no-console
  console.log(`[indexer] ingesting chains: ${chainIds.join(', ')}${process.env.INDEXER_CHAINS ? ` (INDEXER_CHAINS=${process.env.INDEXER_CHAINS})` : ' (all supported)'}`)

  for (const chainId of chainIds) {
    // Per-chain block-timestamp cache (block numbers are unique within a chain).
    const tsCache = new Map<number, number>()
    // Per-chain tx-origin cache (txHash → tx.from), so multi-hop swaps sharing a tx resolve once.
    const originCache = new Map<string, string>()
    try {
      const provider = getProvider(chainId)
      const latest = await provider.getBlockNumber()
      const pairs = await getV2Pairs(chainId)

      for (const pair of pairs) {
        const pool = pair.pairAddress.toLowerCase()
        try {
          // Record real on-chain token metadata for the pool (used by the metrics layer's decimals).
          upsertPoolMeta(db, {
            chainId,
            pool,
            token0: pair.token0.address,
            token1: pair.token1.address,
            decimals0: pair.token0.decimals,
            decimals1: pair.token1.decimals,
            symbol0: pair.token0.symbol,
            symbol1: pair.token1.symbol,
          })

          // Live-reserves snapshot (robust USD anchor): getV2Pairs already read this pool's CURRENT
          // reserves on-chain, so persist them as the pool's latest Sync point. This makes the USD
          // anchor (getUsdPerNative) + pool TVL light up on the FIRST pass from real current reserves,
          // independent of how far the getLogs backfill below reaches — critical on fast chains where
          // the seed block can fall outside the backfill window. Real Sync logs are still ingested for
          // history/volume (see ingestPool). Never fabricated (see writeReserveSnapshot).
          writeReserveSnapshot(db, {
            chainId,
            pool,
            blockNumber: latest,
            logIndex: SNAPSHOT_LOG_INDEX,
            reserve0: pair.reserve0.toString(),
            reserve1: pair.reserve1.toString(),
            timestamp: Math.floor(Date.now() / 1000),
          })

          const cursor = getCursor(db, chainId, pool)
          let start: number
          if (cursor !== undefined) {
            start = cursor + 1
          } else {
            start = Math.max(0, latest - backfill)
            // eslint-disable-next-line no-console
            console.log(
              `[indexer] chain ${chainId} pool ${pool}: first scan bounded to blocks ${start}-${latest} (INDEXER_BACKFILL_BLOCKS=${backfill}); earlier history not indexed`,
            )
          }
          if (start > latest) {
            results.push({ chainId, pool, swaps: 0, syncs: 0 })
            continue
          }

          const { swaps, syncs } = await ingestPool(provider, chainId, pool, start, latest, tsCache, originCache)
          results.push({ chainId, pool, swaps, syncs })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[indexer] chain ${chainId} pool ${pool} ingest failed (skipped)`, err)
        }
      }

      // ---- v3 + v4 ingestion for this chain (ADDITIVE; the v2 pass above is unchanged) ----
      // Driven off the per-chain deployment config: v3 runs wherever a v3Factory is set; v4 runs wherever
      // a v4PoolManager is set (omitted on chains with no canonical v4, e.g. HyperEVM 999 / Stable 988).
      const chain = getChain(chainId)
      if (chain) {
        try {
          const v3 = await ingestV3ForChain(provider, chainId, chain, latest, backfill, tsCache, originCache)
          const v4 = await ingestV4ForChain(provider, chainId, chain, latest, backfill, tsCache)
          if (v3.pools || v3.swaps || v4.pools || v4.swaps) {
            // eslint-disable-next-line no-console
            console.log(
              `[indexer] chain ${chainId}: v3 ${v3.pools} pools/+${v3.swaps} swaps · v4 ${v4.pools} pools/+${v4.swaps} swaps`,
            )
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[indexer] chain ${chainId} v3/v4 pass failed (skipped)`, err)
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[indexer] chain ${chainId} pass failed (skipped)`, err)
    }
  }
  return results
}

let loopStarted = false

/**
 * Start the tail ingest loop: run runIngestOnce, then reschedule `intervalMs` after it finishes
 * (self-scheduling — never overlaps a slow pass). Catches all errors. Idempotent (starts once).
 */
export function startIngestLoop(intervalMs = 60_000): void {
  if (loopStarted) {
    return
  }
  loopStarted = true
  const tick = async (): Promise<void> => {
    try {
      const res = await runIngestOnce()
      const totalSwaps = res.reduce((n, r) => n + r.swaps, 0)
      const totalSyncs = res.reduce((n, r) => n + r.syncs, 0)
      // eslint-disable-next-line no-console
      console.log(`[indexer] pass complete: ${res.length} pools, +${totalSwaps} swaps, +${totalSyncs} syncs`)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[indexer] runIngestOnce threw (unexpected — loop continues)', err)
    } finally {
      setTimeout(() => {
        void tick()
      }, intervalMs)
    }
  }
  void tick()
}
