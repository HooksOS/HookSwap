/**
 * Tests for the per-chain `eth_getLogs` budget (src/rpc.ts) and the incremental, cursor-resumable v3
 * factory scan (src/onchain.ts + src/indexer/schema.ts).
 *
 * ⛔ NO REAL RPC IS CONTACTED. Robinhood's single public endpoint is a live production dependency that
 * is currently UNDER STRESS — hitting it to test a throttle would be the very behaviour being fixed.
 * Everything below runs against a local in-process fake JSON-RPC server that counts calls by method,
 * and a temp-file SQLite DB. Nothing here touches the network.
 *
 * Run: npx ts-node -P data-api/tsconfig.json data-api/test/getLogsBudget.test.ts
 *
 * Covers exactly the four claims:
 *   (a) the 9th `eth_getLogs` on chain 4663 inside one window is REFUSED LOCALLY (never sent)
 *   (b) `eth_call` still passes freely while the getLogs budget is exhausted
 *   (c) the v3 scan YIELDS on budget exhaustion (no throw) and PERSISTS its cursor
 *   (d) the next pass RESUMES from that cursor instead of rescanning
 */

import * as http from 'http'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ethers } from 'ethers'

// ---------------------------------------------------------------------------------------------
// fake JSON-RPC server (counts every method it is asked for)
// ---------------------------------------------------------------------------------------------

const CHAIN_ID = 4663
const LATEST_BLOCK = 100_000
const FROM_BLOCK = 1_000
const CHUNK = 100

const calls: Record<string, number> = {}
/** every eth_getLogs filter the server actually RECEIVED — the proof of what was/wasn't sent. */
const getLogsRanges: Array<{ from: number; to: number }> = []

const POOL_CREATED_TOPIC = ethers.utils.id('PoolCreated(address,address,uint24,int24,address)')
const TOKEN0 = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'
const TOKEN1 = '0x1111111111111111111111111111111111111111'
const POOL = '0x2222222222222222222222222222222222222222'

function pad(addr: string): string {
  return ethers.utils.hexZeroPad(addr.toLowerCase(), 32)
}

/** A single synthetic PoolCreated log, emitted only for the FIRST scanned window. */
function poolCreatedLog(blockNumber: number, address: string): unknown {
  return {
    address,
    topics: [POOL_CREATED_TOPIC, pad(TOKEN0), pad(TOKEN1), ethers.utils.hexZeroPad('0x0bb8', 32)],
    data: ethers.utils.defaultAbiCoder.encode(['int24', 'address'], [60, POOL]),
    blockNumber: ethers.utils.hexValue(blockNumber),
    blockHash: ethers.utils.hexZeroPad('0xabcd', 32),
    transactionHash: ethers.utils.hexZeroPad('0xbeef', 32),
    transactionIndex: '0x0',
    logIndex: '0x0',
    removed: false,
  }
}

function handle(method: string, params: unknown[]): unknown {
  calls[method] = (calls[method] ?? 0) + 1
  switch (method) {
    case 'eth_chainId':
      return ethers.utils.hexValue(CHAIN_ID)
    case 'eth_blockNumber':
      return ethers.utils.hexValue(LATEST_BLOCK)
    case 'eth_getLogs': {
      const f = params[0] as { fromBlock: string; toBlock: string; address: string }
      const from = Number(f.fromBlock)
      const to = Number(f.toBlock)
      getLogsRanges.push({ from, to })
      // one pool, in the very first window only
      return from <= FROM_BLOCK && to >= FROM_BLOCK ? [poolCreatedLog(FROM_BLOCK, f.address)] : []
    }
    case 'eth_call':
      // 32 zero bytes: a valid uint256 `0` — for balanceOf that means an EMPTY pool, which getV3Pools
      // honestly skips. Enough to exercise the call path without a full ERC-20 fake.
      return ethers.utils.hexZeroPad('0x00', 32)
    default:
      return null
  }
}

async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const payload = JSON.parse(body)
      const one = (p: { id: number; method: string; params: unknown[] }) => ({
        jsonrpc: '2.0',
        id: p.id,
        result: handle(p.method, p.params ?? []),
      })
      const out = Array.isArray(payload) ? payload.map(one) : one(payload)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(out))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

// ---------------------------------------------------------------------------------------------
// SQLite shim
//
// `better-sqlite3` is present in this checkout but its NATIVE binding is not compiled (the repo is
// disk-constrained — see data-api/package.json), so `require('better-sqlite3')` throws locally. The
// storage under test is plain SQL, so we back schema.ts with Node's built-in `node:sqlite` (Node 24)
// through the require cache. schema.ts is loaded UNMODIFIED and runs its REAL DDL/queries against a
// REAL SQLite file — only the driver differs.
// ---------------------------------------------------------------------------------------------

function installSqliteShim(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite')

  class ShimDatabase {
    private readonly db: InstanceType<typeof DatabaseSync>
    constructor(filename: string) {
      this.db = new DatabaseSync(filename)
    }
    prepare(sql: string) {
      const stmt = this.db.prepare(sql)
      return {
        run: (...p: unknown[]) => stmt.run(...p),
        get: (...p: unknown[]) => stmt.get(...p),
        all: (...p: unknown[]) => stmt.all(...p),
      }
    }
    exec(sql: string): void {
      this.db.exec(sql)
    }
    pragma(source: string): void {
      this.db.exec(`PRAGMA ${source}`)
    }
    transaction<F extends (...args: never[]) => unknown>(fn: F): F {
      return ((...args: never[]) => {
        this.db.exec('BEGIN')
        try {
          const out = fn(...args)
          this.db.exec('COMMIT')
          return out
        } catch (e) {
          this.db.exec('ROLLBACK')
          throw e
        }
      }) as F
    }
    close(): void {
      this.db.close()
    }
  }

  const id = require.resolve('better-sqlite3')
  require.cache[id] = { id, filename: id, loaded: true, exports: ShimDatabase } as unknown as NodeModule
}

// ---------------------------------------------------------------------------------------------
// tiny assert harness
// ---------------------------------------------------------------------------------------------

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures += 1
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected, `expected ${String(expected)}, got ${String(actual)}`)
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const server = await startServer()

  // Env MUST be set before any module reads it (provider list + budget are memoised on first use).
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookswap-budget-test-'))
  process.env.INDEXER_DB_PATH = path.join(dbDir, 'indexer.db')
  process.env.WEB3_RPC_4663 = server.url
  process.env.V3_SCAN_FROM_BLOCK_4663 = String(FROM_BLOCK)
  process.env.V3_LOG_CHUNK_4663 = String(CHUNK)
  // Deliberately HIGHER than the budget, so the BUDGET is what stops the scan (not the chunk cap).
  process.env.V3_MAX_CHUNKS_4663 = '50'

  installSqliteShim() // MUST precede the schema.ts require (see installSqliteShim)

  /* eslint-disable @typescript-eslint/no-var-requires */
  const rpc = require('../src/rpc') as typeof import('../src/rpc')
  const onchain = require('../src/onchain') as typeof import('../src/onchain')
  const schema = require('../src/indexer/schema') as typeof import('../src/indexer/schema')
  /* eslint-enable @typescript-eslint/no-var-requires */

  const provider = rpc.createFailoverProvider([server.url], CHAIN_ID, '4663 (test)')

  // -------------------------------------------------------------------------------------------
  console.log('\n(a) chain 4663: the 9th eth_getLogs in a window is refused LOCALLY, never sent')
  // -------------------------------------------------------------------------------------------
  eq('default budget for 4663 is 8', rpc.GET_LOGS_BUDGET_BY_CHAIN[4663], 8)

  let refusedAt = -1
  let refusalError: unknown
  for (let i = 1; i <= 9; i++) {
    try {
      await provider.getLogs({ address: TOKEN1, fromBlock: 500_000 + i, toBlock: 500_000 + i })
    } catch (err) {
      if (refusedAt === -1) {
        refusedAt = i
        refusalError = err
      }
    }
  }
  eq('first refusal is the 9th call', refusedAt, 9)
  eq('exactly 8 eth_getLogs reached the server', calls.eth_getLogs, 8)
  check('refusal is a GetLogsBudgetExhaustedError', rpc.isGetLogsBudgetExhausted(refusalError))
  check(
    'classifyRpcError treats it as terminal (no failover / no retry)',
    rpc.classifyRpcError(refusalError).failover === false,
  )
  const snap = rpc.getLogsBudgetSnapshots().find((s) => s.chainId === CHAIN_ID)
  check('budget reports 0 available + a retryAfter', snap?.available === 0 && (snap?.retryAfterMs ?? 0) > 0,
    `available=${snap?.available} retryAfterMs=${snap?.retryAfterMs}`)

  // -------------------------------------------------------------------------------------------
  console.log('\n(b) cheap foreground reads are NOT budgeted — eth_call passes while getLogs is empty')
  // -------------------------------------------------------------------------------------------
  const callsBefore = calls.eth_call ?? 0
  let callErrors = 0
  for (let i = 0; i < 5; i++) {
    try {
      await provider.call({ to: TOKEN1, data: '0x70a08231' + '0'.repeat(64) })
    } catch {
      callErrors += 1
    }
  }
  eq('all 5 eth_call succeeded while the getLogs budget was exhausted', callErrors, 0)
  eq('all 5 eth_call reached the server', (calls.eth_call ?? 0) - callsBefore, 5)
  const blockBefore = calls.eth_blockNumber ?? 0
  await provider.send('eth_blockNumber', [])
  eq('eth_blockNumber also passes freely', (calls.eth_blockNumber ?? 0) - blockBefore, 1)
  eq('getLogs budget still spent (nothing refunded)', calls.eth_getLogs, 8)

  // -------------------------------------------------------------------------------------------
  console.log('\n(c) the v3 scan YIELDS on budget exhaustion and PERSISTS its cursor (no throw)')
  // -------------------------------------------------------------------------------------------
  rpc.resetGetLogsBudgets() // simulate the next 60s window
  getLogsRanges.length = 0
  const sentBefore = calls.eth_getLogs ?? 0

  const pass1 = await onchain.getV3Pools(CHAIN_ID)
  check('getV3Pools resolved instead of throwing', Array.isArray(pass1))
  eq('the pass spent exactly the 8-call budget', (calls.eth_getLogs ?? 0) - sentBefore, 8)
  check(
    'it did NOT run to the 50-chunk cap (the budget stopped it first)',
    (calls.eth_getLogs ?? 0) - sentBefore < 50,
  )

  const db = schema.getDb()
  const scanKey = `v3factory:0xaa1f5bd529be345e7fb77934554112e5ecd7d7f3`
  const cursor1 = schema.getScanCursor(db, CHAIN_ID, scanKey)
  const expected1 = FROM_BLOCK + 8 * CHUNK - 1 // 8 windows of CHUNK blocks, starting at FROM_BLOCK
  eq('cursor persisted at the last fully-attempted block', cursor1, expected1)
  eq('scan started at the configured fromBlock', getLogsRanges[0]?.from, FROM_BLOCK)

  const discovered = schema.getV3DiscoveredPools(db, CHAIN_ID)
  eq('the PoolCreated discovery was persisted', discovered.length, 1)
  eq('persisted pool address matches the log', discovered[0]?.pool, POOL.toLowerCase())
  eq('persisted fee matches the log', discovered[0]?.fee, 3000)
  // The fake pool has zero balances, so getV3Pools honestly returns nothing for it — the DISCOVERY is
  // still persisted. (No fabricated pool is ever returned.)
  eq('empty pool is honestly excluded from the response', pass1.length, 0)

  // -------------------------------------------------------------------------------------------
  console.log('\n(d) the next pass RESUMES from the cursor instead of rescanning')
  // -------------------------------------------------------------------------------------------
  rpc.resetGetLogsBudgets() // next window
  getLogsRanges.length = 0
  const sentBefore2 = calls.eth_getLogs ?? 0

  await onchain.getV3Pools(CHAIN_ID)
  eq('second pass resumed at cursor + 1', getLogsRanges[0]?.from, expected1 + 1)
  check(
    'second pass did NOT rescan the first window',
    getLogsRanges.every((r) => r.from > expected1),
    `lowest fromBlock was ${Math.min(...getLogsRanges.map((r) => r.from))}`,
  )
  eq('second pass also spent exactly one budget', (calls.eth_getLogs ?? 0) - sentBefore2, 8)
  const cursor2 = schema.getScanCursor(db, CHAIN_ID, scanKey)
  eq('cursor advanced by another 8 windows', cursor2, expected1 + 8 * CHUNK)
  check('cursor moves forward monotonically', (cursor2 ?? 0) > (cursor1 ?? 0))

  // -------------------------------------------------------------------------------------------
  console.log('\n(e) other chains keep a much larger (but still bounded) default budget')
  // -------------------------------------------------------------------------------------------
  eq('default for non-measured chains', rpc.DEFAULT_GET_LOGS_BUDGET, 60)
  const otherChain = 57073
  for (let i = 0; i < 12; i++) {
    rpc.consumeGetLogsBudget(otherChain) // would have thrown on 4663 after 8
  }
  const otherSnap = rpc.getLogsBudgetSnapshots().find((s) => s.chainId === otherChain)
  eq('chain 57073 capacity is 60', otherSnap?.capacity, 60)
  check('12 getLogs on 57073 are fine', (otherSnap?.available ?? 0) >= 47, `available=${otherSnap?.available}`)

  // -------------------------------------------------------------------------------------------
  schema.closeDb()
  await server.close()
  fs.rmSync(dbDir, { recursive: true, force: true })

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
  console.log(`server saw: ${JSON.stringify(calls)}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('test harness crashed', err)
  process.exit(1)
})
