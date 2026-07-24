/**
 * SQLite storage + schema for the HookSwap Phase-2 event indexer.
 *
 * Storage engine is `better-sqlite3` (synchronous, single-file, no external DB). The DB file path
 * comes from env `INDEXER_DB_PATH` (default `./indexer.db`, relative to the service working dir).
 *
 * DESIGN NOTES / honesty rules:
 *   - Every stored value originates from a REAL on-chain event (Swap/Sync log) or a real on-chain
 *     read (pool token metadata from onchain.getV2Pairs). Nothing here fabricates prices/volumes.
 *   - Big integers (amounts, reserves) are stored as TEXT decimal strings — NEVER JS numbers — so
 *     uint112/uint256 values are preserved exactly (JS `number` loses precision above 2^53).
 *   - `pool_meta` (token0/token1 addresses + decimals) is added beyond the raw-event tables so the
 *     metrics layer can compute native-denominated / decimal-adjusted prices purely from stored data
 *     (no live RPC read at query time). It is populated from onchain.getV2Pairs — real on-chain reads.
 *
 * ⚠ better-sqlite3 ships no bundled TypeScript types and `@types/better-sqlite3` is NOT installed in
 * this (disk-constrained) checkout, so the `import` below is the single expected TS2307 for this
 * module (mirrors the pre-existing `@connectrpc/connect-node` gap in server.ts). We describe the tiny
 * slice of the better-sqlite3 API we actually use via the `SqliteDatabase` interface, so all query
 * code in this module and in ingest/metrics stays fully type-checked regardless of whether the
 * runtime types resolve. `npm install better-sqlite3 @types/better-sqlite3` makes the import resolve.
 */

// eslint-disable-next-line import/no-unresolved
import DatabaseConstructor from 'better-sqlite3'
import { isHookSwapV4Hook } from '../v4Hooks'

// ---------- minimal structural typing of the better-sqlite3 API we use ----------

interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}
interface Statement {
  run(...params: unknown[]): RunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}
export interface SqliteDatabase {
  prepare(sql: string): Statement
  exec(sql: string): void
  pragma(source: string): unknown
  transaction<F extends (...args: never[]) => unknown>(fn: F): F
  close(): void
}
interface DatabaseCtor {
  new (filename: string): SqliteDatabase
}

// Whether the imported symbol is typed (types installed) or `any` (types absent), this cast compiles.
const Database = DatabaseConstructor as unknown as DatabaseCtor

// ---------- row shapes (what callers read back) ----------

export interface SwapEventRow {
  chainId: number
  pool: string
  blockNumber: number
  logIndex: number
  txHash: string
  sender: string
  recipient: string
  /**
   * tx-origin EOA (`tx.from`), lowercased — the real trader wallet. Captured per-tx by the ingest
   * loop (see ingest.ts). Empty string when unresolved (RPC gap, or a row indexed before origin
   * capture existed). NEVER fabricated; the leaderboard falls back to `recipient` when this is ''.
   */
  origin: string
  /** uint256 token amounts, decimal strings. */
  amount0In: string
  amount1In: string
  amount0Out: string
  amount1Out: string
  /** unix seconds (block timestamp). */
  timestamp: number
}

export interface SyncEventRow {
  chainId: number
  pool: string
  blockNumber: number
  logIndex: number
  /** uint112 reserves, decimal strings. */
  reserve0: string
  reserve1: string
  /** unix seconds (block timestamp). */
  timestamp: number
}

export interface PoolMetaRow {
  chainId: number
  pool: string
  token0: string
  token1: string
  decimals0: number
  decimals1: number
  symbol0: string
  symbol1: string
}

export interface CursorRow {
  chainId: number
  pool: string
  /** last block fully scanned for this pool (inclusive). Next pass starts at lastBlock + 1. */
  lastBlock: number
}

// ---------- schema DDL ----------

const DDL = `
CREATE TABLE IF NOT EXISTS swap_events (
  chainId      INTEGER NOT NULL,
  pool         TEXT    NOT NULL,
  blockNumber  INTEGER NOT NULL,
  logIndex     INTEGER NOT NULL,
  txHash       TEXT    NOT NULL,
  sender       TEXT    NOT NULL DEFAULT '',
  recipient    TEXT    NOT NULL DEFAULT '',
  origin       TEXT    NOT NULL DEFAULT '',
  amount0In    TEXT    NOT NULL,
  amount1In    TEXT    NOT NULL,
  amount0Out   TEXT    NOT NULL,
  amount1Out   TEXT    NOT NULL,
  timestamp    INTEGER NOT NULL,
  PRIMARY KEY (chainId, pool, blockNumber, logIndex)
);
CREATE INDEX IF NOT EXISTS idx_swap_pool_block ON swap_events (chainId, pool, blockNumber);
CREATE INDEX IF NOT EXISTS idx_swap_pool_ts    ON swap_events (chainId, pool, timestamp);
-- Wallet-scoped activity feed (ListTransactions) filters by the swap's on-chain participant
-- (Swap.to = recipient, Swap.sender = the caller/router). These indexes make that lookup cheap.
CREATE INDEX IF NOT EXISTS idx_swap_recipient  ON swap_events (chainId, recipient);
CREATE INDEX IF NOT EXISTS idx_swap_sender     ON swap_events (chainId, sender);
-- Trading-leaderboard attribution: aggregate swaps per trader EOA (tx.from) within a time window.
CREATE INDEX IF NOT EXISTS idx_swap_origin      ON swap_events (chainId, origin, timestamp);

CREATE TABLE IF NOT EXISTS sync_events (
  chainId      INTEGER NOT NULL,
  pool         TEXT    NOT NULL,
  blockNumber  INTEGER NOT NULL,
  logIndex     INTEGER NOT NULL,
  reserve0     TEXT    NOT NULL,
  reserve1     TEXT    NOT NULL,
  timestamp    INTEGER NOT NULL,
  PRIMARY KEY (chainId, pool, blockNumber, logIndex)
);
CREATE INDEX IF NOT EXISTS idx_sync_pool_block ON sync_events (chainId, pool, blockNumber);
CREATE INDEX IF NOT EXISTS idx_sync_pool_ts    ON sync_events (chainId, pool, timestamp);

CREATE TABLE IF NOT EXISTS pool_meta (
  chainId      INTEGER NOT NULL,
  pool         TEXT    NOT NULL,
  token0       TEXT    NOT NULL,
  token1       TEXT    NOT NULL,
  decimals0    INTEGER NOT NULL,
  decimals1    INTEGER NOT NULL,
  symbol0      TEXT    NOT NULL DEFAULT '',
  symbol1      TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (chainId, pool)
);

CREATE TABLE IF NOT EXISTS ingest_cursor (
  chainId      INTEGER NOT NULL,
  pool         TEXT    NOT NULL,
  lastBlock    INTEGER NOT NULL,
  PRIMARY KEY (chainId, pool)
);

-- ============================================================================================
-- UNISWAP-v3-STYLE pools (every LaunchPad launch is a v3 pool). ADDITIVE — v2 tables untouched.
-- Price comes from v3_swap_events.sqrtPriceX96 (a v3 pool's BALANCES do not give price); TVL comes
-- from the pool contract's live ERC-20 balances snapshotted in v3_pool_state (exact).
-- ============================================================================================
CREATE TABLE IF NOT EXISTS v3_pools (
  chainId      INTEGER NOT NULL,
  pool         TEXT    NOT NULL,
  token0       TEXT    NOT NULL,
  token1       TEXT    NOT NULL,
  decimals0    INTEGER NOT NULL,
  decimals1    INTEGER NOT NULL,
  symbol0      TEXT    NOT NULL DEFAULT '',
  symbol1      TEXT    NOT NULL DEFAULT '',
  fee          INTEGER NOT NULL,
  tickSpacing  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chainId, pool)
);

-- One row per v3 pool: latest slot0 (price) + live pool token balances (TVL). REPLACE-updated each pass.
CREATE TABLE IF NOT EXISTS v3_pool_state (
  chainId      INTEGER NOT NULL,
  pool         TEXT    NOT NULL,
  blockNumber  INTEGER NOT NULL,
  sqrtPriceX96 TEXT    NOT NULL,
  tick         INTEGER NOT NULL DEFAULT 0,
  liquidity    TEXT    NOT NULL DEFAULT '0',
  balance0     TEXT    NOT NULL,
  balance1     TEXT    NOT NULL,
  timestamp    INTEGER NOT NULL,
  PRIMARY KEY (chainId, pool)
);

CREATE TABLE IF NOT EXISTS v3_swap_events (
  chainId      INTEGER NOT NULL,
  pool         TEXT    NOT NULL,
  blockNumber  INTEGER NOT NULL,
  logIndex     INTEGER NOT NULL,
  txHash       TEXT    NOT NULL,
  sender       TEXT    NOT NULL DEFAULT '',
  recipient    TEXT    NOT NULL DEFAULT '',
  origin       TEXT    NOT NULL DEFAULT '',
  amount0      TEXT    NOT NULL,
  amount1      TEXT    NOT NULL,
  sqrtPriceX96 TEXT    NOT NULL,
  liquidity    TEXT    NOT NULL DEFAULT '0',
  tick         INTEGER NOT NULL DEFAULT 0,
  timestamp    INTEGER NOT NULL,
  PRIMARY KEY (chainId, pool, blockNumber, logIndex)
);
CREATE INDEX IF NOT EXISTS idx_v3swap_pool_ts   ON v3_swap_events (chainId, pool, timestamp);
CREATE INDEX IF NOT EXISTS idx_v3swap_recipient ON v3_swap_events (chainId, recipient);
CREATE INDEX IF NOT EXISTS idx_v3swap_origin    ON v3_swap_events (chainId, origin, timestamp);

-- ============================================================================================
-- UNISWAP-v4 SINGLETON pools (bytes32 poolId; one PoolManager per chain). ADDITIVE.
-- Price from v4_swap_events.sqrtPriceX96; volume from swap amounts; TVL accumulated in v4_pool_state
-- (the singleton PoolManager has no per-pool balanceOf — see ingest.ts for the tick-math accumulation).
-- ============================================================================================
CREATE TABLE IF NOT EXISTS v4_pools (
  chainId      INTEGER NOT NULL,
  poolId       TEXT    NOT NULL,
  currency0    TEXT    NOT NULL,
  currency1    TEXT    NOT NULL,
  decimals0    INTEGER NOT NULL,
  decimals1    INTEGER NOT NULL,
  symbol0      TEXT    NOT NULL DEFAULT '',
  symbol1      TEXT    NOT NULL DEFAULT '',
  fee          INTEGER NOT NULL,
  tickSpacing  INTEGER NOT NULL DEFAULT 0,
  hooks        TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (chainId, poolId)
);

-- One row per v4 pool: latest sqrtPriceX96/tick (price) + accumulated TVL token amounts (HUMAN units,
-- decimal-adjusted, decimal strings). REPLACE-updated as the PoolManager scan folds events in order.
CREATE TABLE IF NOT EXISTS v4_pool_state (
  chainId      INTEGER NOT NULL,
  poolId       TEXT    NOT NULL,
  blockNumber  INTEGER NOT NULL,
  sqrtPriceX96 TEXT    NOT NULL,
  tick         INTEGER NOT NULL DEFAULT 0,
  liquidity    TEXT    NOT NULL DEFAULT '0',
  tvl0Human    TEXT    NOT NULL DEFAULT '0',
  tvl1Human    TEXT    NOT NULL DEFAULT '0',
  timestamp    INTEGER NOT NULL,
  PRIMARY KEY (chainId, poolId)
);

CREATE TABLE IF NOT EXISTS v4_swap_events (
  chainId      INTEGER NOT NULL,
  poolId       TEXT    NOT NULL,
  blockNumber  INTEGER NOT NULL,
  logIndex     INTEGER NOT NULL,
  txHash       TEXT    NOT NULL,
  sender       TEXT    NOT NULL DEFAULT '',
  origin       TEXT    NOT NULL DEFAULT '',
  amount0      TEXT    NOT NULL,
  amount1      TEXT    NOT NULL,
  sqrtPriceX96 TEXT    NOT NULL,
  liquidity    TEXT    NOT NULL DEFAULT '0',
  tick         INTEGER NOT NULL DEFAULT 0,
  fee          INTEGER NOT NULL DEFAULT 0,
  timestamp    INTEGER NOT NULL,
  PRIMARY KEY (chainId, poolId, blockNumber, logIndex)
);
CREATE INDEX IF NOT EXISTS idx_v4swap_pool_ts ON v4_swap_events (chainId, poolId, timestamp);
CREATE INDEX IF NOT EXISTS idx_v4swap_origin  ON v4_swap_events (chainId, origin, timestamp);
`

// ---------- connection singleton ----------

let dbSingleton: SqliteDatabase | undefined

/** Resolve the DB file path from env (default ./indexer.db in the service working dir). */
export function resolveDbPath(): string {
  return process.env.INDEXER_DB_PATH || './indexer.db'
}

/**
 * Open (once) and initialize the indexer DB: WAL journal for concurrent read while the ingest loop
 * writes, NORMAL sync (durable enough for a rebuildable cache), and the schema DDL (idempotent).
 */
export function getDb(): SqliteDatabase {
  if (dbSingleton) {
    return dbSingleton
  }
  const db = new Database(resolveDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  // Idempotent `origin` migration — MUST run BEFORE `db.exec(DDL)`: on an existing pre-`origin` DB the
  // DDL's `CREATE TABLE IF NOT EXISTS swap_events` is a no-op (so the table still lacks `origin`), and the
  // DDL also builds `idx_swap_origin` which references `origin` — that index would fail unless the column
  // is added first. ALTER throws "no such table" on a brand-new DB (table not created yet → DDL below makes
  // it WITH origin) and "duplicate column name" once origin already exists — both are harmless, swallow.
  try {
    db.exec(`ALTER TABLE swap_events ADD COLUMN origin TEXT NOT NULL DEFAULT ''`)
  } catch {
    // fresh DB (DDL below creates swap_events with origin) or column already present — nothing to do.
  }
  db.exec(DDL)
  dbSingleton = db
  return db
}

/** Close the singleton DB (tests / shutdown). */
export function closeDb(): void {
  if (dbSingleton) {
    dbSingleton.close()
    dbSingleton = undefined
  }
}

// ---------- write helpers (all idempotent via INSERT OR IGNORE / UPSERT) ----------

/** Insert a batch of swap events idempotently. Returns the count actually inserted (new rows). */
export function insertSwapEvents(db: SqliteDatabase, rows: SwapEventRow[]): number {
  if (rows.length === 0) {
    return 0
  }
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO swap_events
       (chainId, pool, blockNumber, logIndex, txHash, sender, recipient, origin, amount0In, amount1In, amount0Out, amount1Out, timestamp)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const insertAll = db.transaction((batch: SwapEventRow[]) => {
    let inserted = 0
    for (const r of batch) {
      const res = stmt.run(
        r.chainId, r.pool, r.blockNumber, r.logIndex, r.txHash, r.sender, r.recipient, r.origin,
        r.amount0In, r.amount1In, r.amount0Out, r.amount1Out, r.timestamp,
      )
      inserted += res.changes
    }
    return inserted
  })
  return insertAll(rows) as number
}

/** Insert a batch of sync (reserve snapshot) events idempotently. Returns count inserted. */
export function insertSyncEvents(db: SqliteDatabase, rows: SyncEventRow[]): number {
  if (rows.length === 0) {
    return 0
  }
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO sync_events
       (chainId, pool, blockNumber, logIndex, reserve0, reserve1, timestamp)
     VALUES (?,?,?,?,?,?,?)`,
  )
  const insertAll = db.transaction((batch: SyncEventRow[]) => {
    let inserted = 0
    for (const r of batch) {
      const res = stmt.run(r.chainId, r.pool, r.blockNumber, r.logIndex, r.reserve0, r.reserve1, r.timestamp)
      inserted += res.changes
    }
    return inserted
  })
  return insertAll(rows) as number
}

/**
 * Synthetic logIndex marking a LIVE-reserves snapshot row (never a real on-chain log index — real
 * Sync logs sit at small tx-local indexes). Chosen large so the snapshot sorts LAST within its block
 * in latestSync()'s `logIndex DESC` ordering, i.e. it is treated as the freshest reserve point.
 */
export const SNAPSHOT_LOG_INDEX = 2_000_000_000

/**
 * Write a LIVE-reserves snapshot for a pool: the pool's CURRENT on-chain reserves (already read by
 * getV2Pairs via getReserves) stored as a single Sync row at the current block with SNAPSHOT_LOG_INDEX.
 *
 * WHY: the USD anchor + pool TVL (see indexer/metrics.ts) read the pool's LATEST Sync reserves from
 * this store. Relying solely on the getLogs backfill to capture that latest Sync is fragile — on a
 * very fast chain the seed block can fall outside the backfill window, and some public RPCs cap/deny
 * getLogs ranges. This snapshot makes USD TVL work immediately from real current reserves, on the
 * first ingest pass, independent of log backfill. It is NOT fabricated: reserves are a real on-chain
 * read; blockNumber is the real current block; timestamp is the read time (reserves are current).
 *
 * Kept to exactly ONE snapshot row per pool (the prior snapshot is deleted first), so it never
 * accumulates. Real ingested Sync events (small logIndex) are left untouched for history/volume; the
 * snapshot only guarantees a current-reserves point exists.
 */
export function writeReserveSnapshot(db: SqliteDatabase, row: SyncEventRow): void {
  const del = db.prepare(`DELETE FROM sync_events WHERE chainId=? AND pool=? AND logIndex=?`)
  const ins = db.prepare(
    `INSERT OR REPLACE INTO sync_events (chainId, pool, blockNumber, logIndex, reserve0, reserve1, timestamp)
     VALUES (?,?,?,?,?,?,?)`,
  )
  const tx = db.transaction(() => {
    del.run(row.chainId, row.pool, SNAPSHOT_LOG_INDEX)
    ins.run(row.chainId, row.pool, row.blockNumber, SNAPSHOT_LOG_INDEX, row.reserve0, row.reserve1, row.timestamp)
  })
  tx()
}

/** Upsert pool token metadata (real on-chain values from getV2Pairs). */
export function upsertPoolMeta(db: SqliteDatabase, row: PoolMetaRow): void {
  db.prepare(
    `INSERT INTO pool_meta (chainId, pool, token0, token1, decimals0, decimals1, symbol0, symbol1)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(chainId, pool) DO UPDATE SET
       token0=excluded.token0, token1=excluded.token1,
       decimals0=excluded.decimals0, decimals1=excluded.decimals1,
       symbol0=excluded.symbol0, symbol1=excluded.symbol1`,
  ).run(row.chainId, row.pool, row.token0, row.token1, row.decimals0, row.decimals1, row.symbol0, row.symbol1)
}

/** Read a pool's stored metadata, or undefined if never ingested. */
export function getPoolMeta(db: SqliteDatabase, chainId: number, pool: string): PoolMetaRow | undefined {
  const row = db
    .prepare(`SELECT chainId, pool, token0, token1, decimals0, decimals1, symbol0, symbol1 FROM pool_meta WHERE chainId=? AND pool=?`)
    .get(chainId, pool) as PoolMetaRow | undefined
  return row
}

/** Read the ingest cursor (last fully-scanned block) for a pool, or undefined if never scanned. */
export function getCursor(db: SqliteDatabase, chainId: number, pool: string): number | undefined {
  const row = db
    .prepare(`SELECT lastBlock FROM ingest_cursor WHERE chainId=? AND pool=?`)
    .get(chainId, pool) as { lastBlock: number } | undefined
  return row?.lastBlock
}

/** Persist the ingest cursor (last fully-scanned block) for a pool. */
export function setCursor(db: SqliteDatabase, chainId: number, pool: string, lastBlock: number): void {
  db.prepare(
    `INSERT INTO ingest_cursor (chainId, pool, lastBlock) VALUES (?,?,?)
     ON CONFLICT(chainId, pool) DO UPDATE SET lastBlock=excluded.lastBlock`,
  ).run(chainId, pool, lastBlock)
}

// ---------- transaction/activity reads (ListTransactions / GetTransaction) ----------

const SWAP_EVENT_COLUMNS = `chainId, pool, blockNumber, logIndex, txHash, sender, recipient, origin,
       amount0In, amount1In, amount0Out, amount1Out, timestamp`

/**
 * Read a wallet's swap events on one chain — every indexed Swap where the wallet is the on-chain
 * participant: the swap's recipient (Swap.to) OR its sender (msg.sender to the pair; usually the
 * router, but the wallet itself when it calls the pair directly). Matching is case-insensitive
 * (stored sender/recipient are checksummed, callers pass lowercased addresses).
 *
 * Ordered most-recent-first (timestamp, then block, then log) and hard-capped by `limit` to bound
 * memory — a single wallet's swap history on these chains is small. Returns [] when nothing matches
 * or the address list is empty. NOTE: the v2 Swap event does NOT carry the tx-origin EOA, so a swap
 * whose output is fully intermediated by the router (swept to the router, not the wallet) is not
 * attributable to the wallet from Swap logs alone — that is an honest coverage gap, never faked.
 */
export function getWalletSwapEvents(
  db: SqliteDatabase,
  chainId: number,
  walletsLower: string[],
  limit: number,
): SwapEventRow[] {
  if (walletsLower.length === 0) {
    return []
  }
  const placeholders = walletsLower.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT ${SWAP_EVENT_COLUMNS}
         FROM swap_events
        WHERE chainId=?
          AND ( LOWER(recipient) IN (${placeholders}) OR LOWER(sender) IN (${placeholders}) )
        ORDER BY timestamp DESC, blockNumber DESC, logIndex DESC
        LIMIT ?`,
    )
    .all(chainId, ...walletsLower, ...walletsLower, limit) as SwapEventRow[]
}

/**
 * Read every swap event of a single transaction on one chain (a multi-hop swap emits one Swap per
 * hop), ordered by log index ascending. `txHashLower` must be lowercased; stored txHash is the
 * lowercased hex from the log. Returns [] when the tx has no indexed swap.
 */
export function getSwapEventsByTx(db: SqliteDatabase, chainId: number, txHashLower: string): SwapEventRow[] {
  return db
    .prepare(
      `SELECT ${SWAP_EVENT_COLUMNS}
         FROM swap_events
        WHERE chainId=? AND LOWER(txHash)=?
        ORDER BY blockNumber ASC, logIndex ASC`,
    )
    .all(chainId, txHashLower) as SwapEventRow[]
}

// ============================================================================================
// v3 storage (row shapes + write/read helpers). All big ints are TEXT decimal strings (exact).
// ============================================================================================

export interface V3PoolRow {
  chainId: number
  pool: string
  token0: string
  token1: string
  decimals0: number
  decimals1: number
  symbol0: string
  symbol1: string
  fee: number
  tickSpacing: number
}

export interface V3PoolStateRow {
  chainId: number
  pool: string
  blockNumber: number
  sqrtPriceX96: string
  tick: number
  liquidity: string
  balance0: string
  balance1: string
  timestamp: number
}

export interface V3SwapEventRow {
  chainId: number
  pool: string
  blockNumber: number
  logIndex: number
  txHash: string
  sender: string
  recipient: string
  origin: string
  amount0: string
  amount1: string
  sqrtPriceX96: string
  liquidity: string
  tick: number
  timestamp: number
}

/** Upsert a discovered v3 pool's metadata (real on-chain values). */
export function upsertV3Pool(db: SqliteDatabase, row: V3PoolRow): void {
  db.prepare(
    `INSERT INTO v3_pools (chainId, pool, token0, token1, decimals0, decimals1, symbol0, symbol1, fee, tickSpacing)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(chainId, pool) DO UPDATE SET
       token0=excluded.token0, token1=excluded.token1,
       decimals0=excluded.decimals0, decimals1=excluded.decimals1,
       symbol0=excluded.symbol0, symbol1=excluded.symbol1,
       fee=excluded.fee, tickSpacing=excluded.tickSpacing`,
  ).run(row.chainId, row.pool, row.token0, row.token1, row.decimals0, row.decimals1, row.symbol0, row.symbol1, row.fee, row.tickSpacing)
}

/** All discovered v3 pools on a chain (for the pool/token surfaces). */
export function getV3PoolRows(db: SqliteDatabase, chainId: number): V3PoolRow[] {
  return db
    .prepare(
      `SELECT chainId, pool, token0, token1, decimals0, decimals1, symbol0, symbol1, fee, tickSpacing
         FROM v3_pools WHERE chainId=?`,
    )
    .all(chainId) as V3PoolRow[]
}

/** One discovered v3 pool by address, or undefined. */
export function getV3PoolRow(db: SqliteDatabase, chainId: number, pool: string): V3PoolRow | undefined {
  return db
    .prepare(
      `SELECT chainId, pool, token0, token1, decimals0, decimals1, symbol0, symbol1, fee, tickSpacing
         FROM v3_pools WHERE chainId=? AND pool=?`,
    )
    .get(chainId, pool) as V3PoolRow | undefined
}

/** Write the pool's latest slot0 + live balances snapshot (exactly one row per pool, REPLACE). */
export function writeV3PoolState(db: SqliteDatabase, row: V3PoolStateRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO v3_pool_state (chainId, pool, blockNumber, sqrtPriceX96, tick, liquidity, balance0, balance1, timestamp)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(row.chainId, row.pool, row.blockNumber, row.sqrtPriceX96, row.tick, row.liquidity, row.balance0, row.balance1, row.timestamp)
}

/** Read the pool's latest state snapshot, or undefined. */
export function getV3PoolState(db: SqliteDatabase, chainId: number, pool: string): V3PoolStateRow | undefined {
  return db
    .prepare(
      `SELECT chainId, pool, blockNumber, sqrtPriceX96, tick, liquidity, balance0, balance1, timestamp
         FROM v3_pool_state WHERE chainId=? AND pool=?`,
    )
    .get(chainId, pool) as V3PoolStateRow | undefined
}

/** Insert a batch of v3 swap events idempotently. Returns count inserted (new rows). */
export function insertV3SwapEvents(db: SqliteDatabase, rows: V3SwapEventRow[]): number {
  if (rows.length === 0) {
    return 0
  }
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO v3_swap_events
       (chainId, pool, blockNumber, logIndex, txHash, sender, recipient, origin, amount0, amount1, sqrtPriceX96, liquidity, tick, timestamp)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const insertAll = db.transaction((batch: V3SwapEventRow[]) => {
    let inserted = 0
    for (const r of batch) {
      const res = stmt.run(
        r.chainId, r.pool, r.blockNumber, r.logIndex, r.txHash, r.sender, r.recipient, r.origin,
        r.amount0, r.amount1, r.sqrtPriceX96, r.liquidity, r.tick, r.timestamp,
      )
      inserted += res.changes
    }
    return inserted
  })
  return insertAll(rows) as number
}

// ============================================================================================
// v4 storage (singleton PoolManager; bytes32 poolId).
// ============================================================================================

export interface V4PoolRow {
  chainId: number
  poolId: string
  currency0: string
  currency1: string
  decimals0: number
  decimals1: number
  symbol0: string
  symbol1: string
  fee: number
  tickSpacing: number
  hooks: string
}

export interface V4PoolStateRow {
  chainId: number
  poolId: string
  blockNumber: number
  sqrtPriceX96: string
  tick: number
  liquidity: string
  /** accumulated TVL token amounts in HUMAN (decimal-adjusted) units, decimal strings. */
  tvl0Human: string
  tvl1Human: string
  timestamp: number
}

export interface V4SwapEventRow {
  chainId: number
  poolId: string
  blockNumber: number
  logIndex: number
  txHash: string
  sender: string
  origin: string
  amount0: string
  amount1: string
  sqrtPriceX96: string
  liquidity: string
  tick: number
  fee: number
  timestamp: number
}

/** Upsert a discovered v4 pool's metadata (from Initialize). */
export function upsertV4Pool(db: SqliteDatabase, row: V4PoolRow): void {
  db.prepare(
    `INSERT INTO v4_pools (chainId, poolId, currency0, currency1, decimals0, decimals1, symbol0, symbol1, fee, tickSpacing, hooks)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(chainId, poolId) DO UPDATE SET
       currency0=excluded.currency0, currency1=excluded.currency1,
       decimals0=excluded.decimals0, decimals1=excluded.decimals1,
       symbol0=excluded.symbol0, symbol1=excluded.symbol1,
       fee=excluded.fee, tickSpacing=excluded.tickSpacing, hooks=excluded.hooks`,
  ).run(row.chainId, row.poolId, row.currency0, row.currency1, row.decimals0, row.decimals1, row.symbol0, row.symbol1, row.fee, row.tickSpacing, row.hooks)
}

/** All discovered v4 pools on a chain. */
export function getV4PoolRows(db: SqliteDatabase, chainId: number): V4PoolRow[] {
  return db
    .prepare(
      `SELECT chainId, poolId, currency0, currency1, decimals0, decimals1, symbol0, symbol1, fee, tickSpacing, hooks
         FROM v4_pools WHERE chainId=?`,
    )
    .all(chainId) as V4PoolRow[]
}

/** One discovered v4 pool by poolId, or undefined. */
export function getV4PoolRow(db: SqliteDatabase, chainId: number, poolId: string): V4PoolRow | undefined {
  return db
    .prepare(
      `SELECT chainId, poolId, currency0, currency1, decimals0, decimals1, symbol0, symbol1, fee, tickSpacing, hooks
         FROM v4_pools WHERE chainId=? AND poolId=?`,
    )
    .get(chainId, poolId) as V4PoolRow | undefined
}

/**
 * One-time (idempotent) cleanup: DELETE every stored v4 pool whose `hooks` is NOT a HookSwap-owned hook
 * (see v4Hooks.ts), along with its v4_pool_state + v4_swap_events rows. This removes the FOREIGN v4 rows
 * left behind by an earlier UNFILTERED backfill of the shared-singleton PoolManager, so Markets/pools/stats
 * become HookSwap-only without a full DB wipe. STRICTLY v4-only — v2 (pool_meta/swap/sync) and v3
 * (v3_pools/…) tables are never touched. Safe to run on every boot (a no-op once the DB is clean). Returns
 * the number of foreign v4 pools purged.
 */
export function purgeForeignV4Pools(db: SqliteDatabase): number {
  const rows = db.prepare(`SELECT DISTINCT chainId, poolId, hooks FROM v4_pools`).all() as Array<{
    chainId: number
    poolId: string
    hooks: string
  }>
  const foreign = rows.filter((r) => !isHookSwapV4Hook(r.chainId, r.hooks))
  const delPool = db.prepare(`DELETE FROM v4_pools WHERE chainId=? AND poolId=?`)
  const delState = db.prepare(`DELETE FROM v4_pool_state WHERE chainId=? AND poolId=?`)
  const delSwaps = db.prepare(`DELETE FROM v4_swap_events WHERE chainId=? AND poolId=?`)
  for (const r of foreign) {
    delSwaps.run(r.chainId, r.poolId)
    delState.run(r.chainId, r.poolId)
    delPool.run(r.chainId, r.poolId)
  }
  // Also drop ORPHANED v4 swap/state rows — those whose poolId is NOT a (now-allowlisted-only) v4_pools
  // row. The pre-filter ingest stored swaps/state for pools first seen via Swap (Initialize outside the
  // scan window) that never got a v4_pools row, so the per-pool deletes above miss them. After the loop,
  // every remaining v4_pools row is HookSwap-native, so `poolId NOT IN v4_pools` = every foreign/orphan
  // row. Harmless if empty. Keeps the store strictly HookSwap-only + light.
  const orphanState = db
    .prepare(`DELETE FROM v4_pool_state WHERE poolId NOT IN (SELECT poolId FROM v4_pools)`)
    .run().changes
  const orphanSwaps = db
    .prepare(`DELETE FROM v4_swap_events WHERE poolId NOT IN (SELECT poolId FROM v4_pools)`)
    .run().changes
  if (foreign.length > 0 || orphanState > 0 || orphanSwaps > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[indexer] purge detail: ${foreign.length} foreign v4 pool(s), ${orphanSwaps} orphan swap row(s), ${orphanState} orphan state row(s)`,
    )
  }
  return foreign.length
}

/** Write the v4 pool's latest price + accumulated-TVL snapshot (one row per poolId, REPLACE). */
export function writeV4PoolState(db: SqliteDatabase, row: V4PoolStateRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO v4_pool_state (chainId, poolId, blockNumber, sqrtPriceX96, tick, liquidity, tvl0Human, tvl1Human, timestamp)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(row.chainId, row.poolId, row.blockNumber, row.sqrtPriceX96, row.tick, row.liquidity, row.tvl0Human, row.tvl1Human, row.timestamp)
}

/** Read the v4 pool's latest state snapshot, or undefined. */
export function getV4PoolState(db: SqliteDatabase, chainId: number, poolId: string): V4PoolStateRow | undefined {
  return db
    .prepare(
      `SELECT chainId, poolId, blockNumber, sqrtPriceX96, tick, liquidity, tvl0Human, tvl1Human, timestamp
         FROM v4_pool_state WHERE chainId=? AND poolId=?`,
    )
    .get(chainId, poolId) as V4PoolStateRow | undefined
}

/** Insert a batch of v4 swap events idempotently. Returns count inserted. */
export function insertV4SwapEvents(db: SqliteDatabase, rows: V4SwapEventRow[]): number {
  if (rows.length === 0) {
    return 0
  }
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO v4_swap_events
       (chainId, poolId, blockNumber, logIndex, txHash, sender, origin, amount0, amount1, sqrtPriceX96, liquidity, tick, fee, timestamp)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const insertAll = db.transaction((batch: V4SwapEventRow[]) => {
    let inserted = 0
    for (const r of batch) {
      const res = stmt.run(
        r.chainId, r.poolId, r.blockNumber, r.logIndex, r.txHash, r.sender, r.origin,
        r.amount0, r.amount1, r.sqrtPriceX96, r.liquidity, r.tick, r.fee, r.timestamp,
      )
      inserted += res.changes
    }
    return inserted
  })
  return insertAll(rows) as number
}
