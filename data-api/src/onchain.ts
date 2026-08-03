/**
 * On-chain readers for the HookSwap data-api (Phase 1: current-state only).
 *
 * Everything here is a LIVE read from the chain's public/hosted RPC via ethers v5 — no cache DB,
 * no historical data, no fabricated values.
 *
 * Pool discovery (getV2Pairs) unions TWO real on-chain sources and dedupes by pair address:
 *   1. Factory enumeration — `allPairsLength()` + `allPairs(i)`. This is the AUTHORITATIVE list of
 *      every v2 pair the chain's HookSwap factory has actually created, so it surfaces pools whose
 *      non-native token is NOT in our static `seededTokens` list (e.g. XLayer's on-chain HKT/WOKB
 *      pools, which would otherwise be invisible). Bounded by MAX_ENUMERATED_PAIRS.
 *   2. Seeded-set CREATE2 — for each {wrapped-native, seeded-token} combination we CREATE2-compute
 *      the canonical pair address. Cheap, needs no round-trips, and guarantees a curated pool is
 *      found even in the unlikely case enumeration is unavailable on a given RPC.
 * Each candidate is then verified with a live `getCode` / `getReserves()` / `token0()` / `token1()`;
 * pools with no code or zero reserves are skipped honestly (nothing to show / route). Token metadata
 * for enumerated (non-curated) tokens is read live on-chain via ERC-20 — never fabricated.
 */

import { BigNumber, ethers } from 'ethers'
import { ChainConfig, getChain, resolveRpcUrls, V2_PAIR_INIT_CODE_HASH } from './chains'
import { createFailoverProvider, isGetLogsBudgetExhausted, MAX_GET_LOGS_RANGE } from './rpc'
// Cursor + discovered-pool persistence for the INCREMENTAL v3 factory scan (see scanV3PoolCreated).
// schema.ts imports nothing from this module, so there is no import cycle.
import {
  getDb,
  getScanCursor,
  getV3DiscoveredPools,
  setScanCursor,
  SqliteDatabase,
  upsertV3DiscoveredPools,
} from './indexer/schema'

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]
const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]
const V2_FACTORY_ABI = [
  'function allPairsLength() view returns (uint256)',
  'function allPairs(uint256) view returns (address)',
  'function getPair(address,address) view returns (address)',
]
// HookSwapTokenFactory (self-service, fixed-supply ERC-20 launcher). Enumeration views verified against
// contracts/token-factory/src/HookSwapTokenFactory.sol (allTokens()/allTokensLength()/tokenAt(i)).
const TOKEN_FACTORY_ABI = [
  'function allTokens() view returns (address[])',
  'function allTokensLength() view returns (uint256)',
  'function tokenAt(uint256) view returns (address)',
]
// HookOSV3Launcher (launchpad). Enumeration + the launch struct verified against
// locker-indexer/src/launchpad/abi.ts + indexer.ts: launchCount() → N, getLaunch(id) for ids 0..N-1,
// the struct's FIRST field is the launched token address (the rest is pool/creator/tokenId/... — unused here).
// NOTE: getLaunch returns a Solidity STRUCT — the ABI MUST declare it as a `tuple(...)` single return
// (a flat multi-return signature FAILS to decode because the struct is head-offset ABI-encoded due to its
// dynamic `string metadataURI`; verified on-chain 2026-07-24 with cast — flat form errors, tuple decodes).
const LAUNCHER_ABI = [
  'function launchCount() view returns (uint256)',
  'function getLaunch(uint256) view returns (tuple(address token, address pool, address creator, uint256 tokenId, uint24 feeTier, uint8 dex, address locker, uint8 pair, address pairToken, string metadataURI, uint256 createdAt))',
]
// UniswapV3Factory has NO on-chain pool enumerator (no allPools()), so the only way to discover v3
// pools is to scan its `PoolCreated` event log. token0/token1/fee are indexed; tickSpacing/pool are
// in data. This is the canonical event (topic 0x783cca1c…, verified 2026-07-10 against ethers).
const V3_FACTORY_EVENT_ABI = [
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
]
const v3FactoryIface = new ethers.utils.Interface(V3_FACTORY_EVENT_ABI)

const providerCache = new Map<number, ethers.providers.BaseProvider>()

/**
 * Ordered, deduped RPC endpoint list for a chain: the comma-separated `WEB3_RPC_<chainId>` env override
 * if set, otherwise the chain's built-in public list. See chains.ts `resolveRpcUrls` + rpc.ts.
 */
function rpcUrlsFor(chain: ChainConfig): string[] {
  return resolveRpcUrls(chain)
}

/**
 * The per-chain provider. Multi-endpoint auto-failover lives in src/rpc.ts (FailoverProvider): every
 * JSON-RPC call walks the chain's ordered endpoint list, marking a failing endpoint unhealthy for a
 * 60s cooldown and advancing to the next, so a single provider's quota blowout (the 2026-08-02 Alchemy
 * 429 that took every chain down) can no longer blank on-chain reads. Each call is also bounded by
 * RPC_TIMEOUT_MS so a slow RPC fails fast into the next endpoint instead of hanging past nginx's 60s
 * proxy_read_timeout (which used to wedge the whole service — observed 2026-07-15).
 */
export function getProvider(chainId: number): ethers.providers.BaseProvider {
  const cached = providerCache.get(chainId)
  if (cached) {
    return cached
  }
  const chain = getChain(chainId)
  if (!chain) {
    throw new Error(`unsupported chainId ${chainId}`)
  }
  const provider = createFailoverProvider(rpcUrlsFor(chain), chainId, `${chainId} (${chain.name})`)
  providerCache.set(chainId, provider)
  return provider
}

export interface TokenMeta {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
  /** true for the chain's wrapped-native token. */
  isWrappedNative: boolean
}

/** Build the static token registry (wrapped-native + seeded tokens) for a chain, keyed by lowercased address. */
function staticRegistry(chain: ChainConfig): Map<string, TokenMeta> {
  const reg = new Map<string, TokenMeta>()
  reg.set(chain.wrappedNative.address.toLowerCase(), {
    chainId: chain.chainId,
    address: chain.wrappedNative.address,
    symbol: chain.wrappedNative.symbol,
    name: chain.wrappedNative.name,
    decimals: chain.wrappedNative.decimals,
    isWrappedNative: true,
  })
  for (const t of chain.seededTokens ?? []) {
    reg.set(t.address.toLowerCase(), {
      chainId: chain.chainId,
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      isWrappedNative: false,
    })
  }
  // The chain's USD-anchor stablecoin is a real, verified token — register it so its metadata
  // (esp. decimals, which drive USD math) comes from config without a live ERC-20 round-trip.
  if (chain.stablecoin) {
    reg.set(chain.stablecoin.address.toLowerCase(), {
      chainId: chain.chainId,
      address: chain.stablecoin.address,
      symbol: chain.stablecoin.symbol,
      name: chain.stablecoin.symbol,
      decimals: chain.stablecoin.decimals,
      isWrappedNative: false,
    })
  }
  return reg
}

/** Resolve token metadata: static registry first (verified), else a live on-chain ERC-20 read. */
export async function getTokenMeta(chainId: number, address: string): Promise<TokenMeta> {
  const chain = getChain(chainId)
  if (!chain) {
    throw new Error(`unsupported chainId ${chainId}`)
  }
  const known = staticRegistry(chain).get(address.toLowerCase())
  if (known) {
    return known
  }
  const c = new ethers.Contract(address, ERC20_ABI, getProvider(chainId))
  const [symbol, name, decimals] = await Promise.all([
    c.symbol().catch(() => ''),
    c.name().catch(() => ''),
    c.decimals().then((d: number) => Number(d)).catch(() => 18),
  ])
  return { chainId, address, symbol, name, decimals, isWrappedNative: false }
}

/**
 * Live ERC-20 `balanceOf(owner)` for one token on a chain — the raw on-chain balance (BigNumber, in the
 * token's base units). Throws on RPC/contract error so callers can decide how to degrade (the portfolio
 * handler catches per-token and skips, never fabricating a balance).
 */
export async function getErc20Balance(chainId: number, token: string, owner: string): Promise<BigNumber> {
  const c = new ethers.Contract(token, ERC20_ABI, getProvider(chainId))
  return (await c.balanceOf(owner)) as BigNumber
}

/** Live native-coin balance (`eth_getBalance`) for an address on a chain — raw wei (BigNumber). */
export async function getNativeBalance(chainId: number, owner: string): Promise<BigNumber> {
  return getProvider(chainId).getBalance(owner)
}

/**
 * Live ERC-20 `totalSupply()` for one token on a chain — the raw on-chain supply (BigNumber, base units).
 * Used for v2 LP positions: the pair contract is itself an ERC-20 whose totalSupply is the pool's total LP
 * tokens, needed to compute an owner's proportional underlying-reserve share. Throws on RPC/contract error
 * so callers can degrade (the positions handler catches per-pair and skips, never fabricating a supply).
 */
export async function getErc20TotalSupply(chainId: number, token: string): Promise<BigNumber> {
  const c = new ethers.Contract(token, ERC20_ABI, getProvider(chainId))
  return (await c.totalSupply()) as BigNumber
}

/** CREATE2 v2 pair address for (tokenA, tokenB) under the given factory. Order-independent. */
export function computePairAddress(factory: string, tokenA: string, tokenB: string): string {
  const [token0, token1] =
    tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA]
  const salt = ethers.utils.keccak256(
    ethers.utils.solidityPack(['address', 'address'], [token0, token1]),
  )
  return ethers.utils.getCreate2Address(factory, salt, V2_PAIR_INIT_CODE_HASH)
}

export interface V2PairData {
  chainId: number
  /** pair contract address (on-chain, canonical CREATE2). Used as the proto Pool.pool_id. */
  pairAddress: string
  token0: TokenMeta
  token1: TokenMeta
  /** raw reserves aligned to token0 / token1. */
  reserve0: BigNumber
  reserve1: BigNumber
}

/** Upper bound on factory pairs enumerated per chain (guards against an unbounded allPairs loop). */
const MAX_ENUMERATED_PAIRS = 1000

/**
 * Enumerate ALL v2 pairs from a chain's factory (allPairsLength + allPairs(i)). This is the
 * authoritative on-chain list of every pair the factory created — it surfaces pools whose tokens
 * are NOT in our static `seededTokens` set. Bounded by `max`. Returns lowercased addresses. On any
 * RPC/contract error returns [] (caller still has the seeded-combo candidates), never throws.
 */
export async function enumerateV2Pairs(chainId: number, max = MAX_ENUMERATED_PAIRS): Promise<string[]> {
  const chain = getChain(chainId)
  if (!chain) {
    throw new Error(`unsupported chainId ${chainId}`)
  }
  try {
    const factory = new ethers.Contract(chain.v2Factory, V2_FACTORY_ABI, getProvider(chainId))
    const len: BigNumber = await factory.allPairsLength()
    const n = Math.min(len.toNumber(), max)
    const addrs = await Promise.all(
      Array.from({ length: n }, (_, i) => factory.allPairs(i) as Promise<string>),
    )
    return addrs.map((a) => a.toLowerCase())
  } catch {
    return []
  }
}

// ---------- ecosystem token enumeration (factory + launchpad) ----------

/** Upper bound on ecosystem tokens enumerated per source (guards an unbounded allTokens/getLaunch loop). */
const MAX_ENUMERATED_ECOSYSTEM_TOKENS = 2000

/**
 * Enumerate token addresses (lowercased) from a chain's HookSwapTokenFactory. Prefers the single-call
 * `allTokens()`; falls back to `allTokensLength()` + `tokenAt(i)` if that view isn't present on the deploy.
 * Bounded by `max`. On any RPC/contract error returns [] (never throws).
 */
async function enumerateFactoryTokens(chainId: number, factory: string, max = MAX_ENUMERATED_ECOSYSTEM_TOKENS): Promise<string[]> {
  const c = new ethers.Contract(factory, TOKEN_FACTORY_ABI, getProvider(chainId))
  try {
    const all: string[] = await c.allTokens()
    return all.slice(0, max).map((a) => a.toLowerCase())
  } catch {
    // allTokens() unavailable / reverted — fall back to length + index reads.
  }
  try {
    const len: BigNumber = await c.allTokensLength()
    const n = Math.min(len.toNumber(), max)
    const addrs = await Promise.all(Array.from({ length: n }, (_, i) => c.tokenAt(i) as Promise<string>))
    return addrs.map((a) => a.toLowerCase())
  } catch {
    return []
  }
}

/**
 * Enumerate launched-token addresses (lowercased) from a chain's HookOSV3Launcher: `launchCount()` then
 * `getLaunch(id)` for ids 0..N-1, taking the struct's `token` field. Bounded by `max`. Individual launch
 * reads that revert are dropped; on a top-level error returns [] (never throws).
 */
async function enumerateLauncherTokens(chainId: number, launcher: string, max = MAX_ENUMERATED_ECOSYSTEM_TOKENS): Promise<string[]> {
  try {
    const c = new ethers.Contract(launcher, LAUNCHER_ABI, getProvider(chainId))
    const count: BigNumber = await c.launchCount()
    const n = Math.min(count.toNumber(), max)
    const tokens = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        c.getLaunch(i)
          .then((l: { token: string }) => l.token)
          .catch(() => ethers.constants.AddressZero),
      ),
    )
    return tokens
      .filter((a) => a && a.toLowerCase() !== ethers.constants.AddressZero.toLowerCase())
      .map((a) => a.toLowerCase())
  } catch {
    return []
  }
}

/**
 * Discover a chain's ECOSYSTEM tokens — every self-service-factory-created token AND every launchpad
 * launch — independent of whether the token has a pool. Both the token factory and the launcher are
 * cleanly enumerable on-chain (allTokens / launchCount+getLaunch). Metadata for each discovered token is
 * read LIVE on-chain via ERC-20 (getTokenMeta), exactly like pool-token discovery. Tokens whose metadata
 * calls revert (no symbol) are skipped — never fabricated. Sources with no configured address for the
 * chain are skipped. Returns TokenMeta[]; on any error returns whatever was gathered (never throws).
 */
export async function enumerateEcosystemTokens(chainId: number): Promise<TokenMeta[]> {
  const chain = getChain(chainId)
  if (!chain) {
    throw new Error(`unsupported chainId ${chainId}`)
  }
  const sources: Array<Promise<string[]>> = []
  if (chain.tokenFactory) {
    sources.push(enumerateFactoryTokens(chainId, chain.tokenFactory))
  }
  if (chain.launcher) {
    sources.push(enumerateLauncherTokens(chainId, chain.launcher))
  }
  if (sources.length === 0) {
    return []
  }
  const lists = await Promise.all(sources)
  const addresses = Array.from(new Set<string>(lists.flat()))
  const metas = await Promise.all(
    addresses.map((addr) => getTokenMeta(chainId, addr).catch(() => undefined)),
  )
  // Keep only tokens with an honest on-chain symbol; a reverting/non-ERC20 token yields '' → dropped.
  return metas.filter((m): m is TokenMeta => !!m && m.symbol.length > 0)
}

/** Seeded-set CREATE2 candidate pair addresses (lowercased) for a chain's curated token combos. */
function seededComboCandidates(chain: ChainConfig): string[] {
  const tokens = [
    chain.wrappedNative.address,
    ...(chain.seededTokens ?? []).map((t) => t.address),
    // Include the USD-anchor stablecoin so the wrapped-native/stablecoin ANCHOR pool is CREATE2-found
    // even on a chain whose RPC won't serve factory enumeration — the anchor is what every USD value
    // depends on. (Enumeration remains the primary source; this is belt-and-suspenders.)
    ...(chain.stablecoin ? [chain.stablecoin.address] : []),
  ]
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      out.push(computePairAddress(chain.v2Factory, tokens[i], tokens[j]).toLowerCase())
    }
  }
  return out
}

/**
 * Discover live v2 pools for a chain. Candidate pair addresses come from the union of (1) factory
 * enumeration (authoritative on-chain list) and (2) seeded-set CREATE2 combos, deduped. Each candidate
 * is verified with a live getCode / getReserves / token0 / token1; pools with no code or zero reserves
 * are skipped. Returns only REAL, on-chain-verified pools with live reserves.
 */
export async function getV2Pairs(chainId: number): Promise<V2PairData[]> {
  const chain = getChain(chainId)
  if (!chain) {
    throw new Error(`unsupported chainId ${chainId}`)
  }
  const provider = getProvider(chainId)

  const [enumerated, seeded] = await Promise.all([
    enumerateV2Pairs(chainId),
    Promise.resolve(seededComboCandidates(chain)),
  ])
  const candidates = Array.from(new Set<string>([...enumerated, ...seeded]))

  const results: V2PairData[] = []
  await Promise.all(
    candidates.map(async (pairAddress) => {
      try {
        // No contract deployed at the address => pool doesn't exist (seeded combo never created).
        const code = await provider.getCode(pairAddress)
        if (!code || code === '0x') {
          return
        }
        const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider)
        const [reserves, token0Addr, token1Addr] = await Promise.all([
          pair.getReserves(),
          pair.token0(),
          pair.token1(),
        ])
        const reserve0: BigNumber = reserves.reserve0
        const reserve1: BigNumber = reserves.reserve1
        // Empty pool: no liquidity, nothing to display/route. Skip honestly.
        if (reserve0.isZero() && reserve1.isZero()) {
          return
        }
        const [token0, token1] = await Promise.all([
          getTokenMeta(chainId, token0Addr),
          getTokenMeta(chainId, token1Addr),
        ])
        results.push({ chainId, pairAddress: ethers.utils.getAddress(pairAddress), token0, token1, reserve0, reserve1 })
      } catch {
        // RPC hiccup or non-conforming contract at that address — skip this pool, never fabricate.
        return
      }
    }),
  )
  return results
}

// ---------- v3 pool discovery (PoolCreated event scan) ----------

export interface V3PoolData {
  chainId: number
  /** v3 pool contract address (used as the proto Pool.pool_id). */
  poolAddress: string
  token0: TokenMeta
  token1: TokenMeta
  /** v3 fee, in hundredths of a bip (pips) — the same unit the proto feeTier expects (e.g. 3000 = 0.30%). */
  fee: number
  /** live ERC-20 balance of the pool contract, aligned to token0 / token1 (real on-chain liquidity). */
  balance0: BigNumber
  balance1: BigNumber
}

/**
 * Block-range window per `eth_getLogs` call, per chain.
 *
 * Base value is MAX_GET_LOGS_RANGE (2_000, lowered from 9_500 on 2026-08-02): on the public-only
 * endpoint lists several endpoints hard-refuse wider ranges (drpc free plans refuse >10000; XLayer's
 * rpc.xlayer.tech/xlayerrpc.okx.com cap at 100; Stable's rpc.stable.xyz/stable.drpc.org cap at 500),
 * and a refused range used to silently skip a window of pools.
 *
 * Env-overridable (added 2026-08-03): `V3_LOG_CHUNK_<chainId>` → `V3_LOG_CHUNK` → the base value. It is
 * clamped to MAX_GET_LOGS_RANGE because anything wider is refused outright by the tight endpoints.
 */
function v3LogChunk(chainId: number): number {
  const raw = process.env[`V3_LOG_CHUNK_${chainId}`] ?? process.env.V3_LOG_CHUNK
  if (raw && /^\d+$/.test(raw.trim()) && Number(raw.trim()) > 0) {
    return Math.min(Number(raw.trim()), MAX_GET_LOGS_RANGE)
  }
  return MAX_GET_LOGS_RANGE
}

/**
 * Hard cap on `eth_getLogs` chunks per discovery pass.
 *
 * ⚠️ HISTORY — this is the number that took Robinhood down. It was 40, then raised to **190** alongside
 * the 9_500 → 2_000 chunk shrink to keep the same ~380k-block span. But Robinhood's single public RPC
 * refuses at ~12 `eth_getLogs` per 60s (measured; see rpc.ts), so a single cache miss issued ~190 calls,
 * blew the whole endpoint budget, and starved locker-indexer + perps-engine/bot/keeper of ordinary
 * reads. 40 would ALSO blow a 12-call budget — reverting is not a fix.
 *
 * The fix is the pair of changes made 2026-08-03: (a) rpc.ts meters eth_getLogs per chain, and (b) the
 * scan is now CURSOR-RESUMABLE (scan_cursor), so it no longer needs to cover the whole span in one
 * pass. Default **6** chunks/pass therefore sits UNDER Robinhood's 8-call data-api budget, leaving
 * headroom for the indexer's own scans, and still converges across passes (6 × 2_000 = 12k blocks per
 * pass, persisted). Env-overridable: `V3_MAX_CHUNKS_<chainId>` → `V3_MAX_CHUNKS` → 6.
 */
const DEFAULT_V3_MAX_CHUNKS = 6
function v3MaxChunks(chainId: number): number {
  const raw = process.env[`V3_MAX_CHUNKS_${chainId}`] ?? process.env.V3_MAX_CHUNKS
  if (raw && /^\d+$/.test(raw.trim()) && Number(raw.trim()) > 0) {
    return Number(raw.trim())
  }
  return DEFAULT_V3_MAX_CHUNKS
}

/**
 * Resolve the block to start the v3 `PoolCreated` scan from. UniswapV3Factory has no on-chain pool
 * enumerator, so discovery is a log scan — and a full-history scan on every request would hammer the
 * public RPC. We therefore REQUIRE an explicit start block (the factory deploy block), from either
 * env `V3_SCAN_FROM_BLOCK_<chainId>` or `chain.v3DeployBlock`. When neither is set we return
 * `undefined` and getV3Pools honestly returns [] rather than doing an unbounded scan. No v3 liquidity
 * is seeded on any chain yet (all seed scripts are v2, verified 2026-07-10), so [] is the correct
 * current answer; this lights up the moment a deploy block is configured after v3 pools are seeded.
 */
function resolveV3FromBlock(chain: ChainConfig): number | undefined {
  const env = process.env[`V3_SCAN_FROM_BLOCK_${chain.chainId}`]
  if (env && /^\d+$/.test(env.trim())) {
    return Number(env.trim())
  }
  if (typeof chain.v3DeployBlock === 'number') {
    return chain.v3DeployBlock
  }
  return undefined
}

/**
 * `eth_getLogs` that bisects the block range on error, down to a single block, and returns the union.
 * Mirrors the indexer's `getLogsAdaptive`. Needed because the public RPC lists include endpoints with
 * per-query block-range or result-count caps tighter than our chunk size; failing over reaches them, and
 * a rejected window would otherwise be silently dropped. Throws only when a SINGLE-block query fails.
 */
async function getLogsBisecting(
  provider: ethers.providers.BaseProvider,
  filter: { address: string; topics: (string | string[])[] },
  fromBlock: number,
  toBlock: number,
): Promise<ethers.providers.Log[]> {
  try {
    return await provider.getLogs({ ...filter, fromBlock, toBlock })
  } catch (err) {
    // BUDGET REFUSAL: nothing was sent and both halves would be refused too — bisecting here would be a
    // hot loop that burns CPU and log lines while the budget stays empty. Propagate so the caller yields.
    if (isGetLogsBudgetExhausted(err)) {
      throw err
    }
    if (fromBlock >= toBlock) {
      throw err // single block already — a real failure
    }
    const mid = Math.floor((fromBlock + toBlock) / 2)
    const [a, b] = await Promise.all([
      getLogsBisecting(provider, filter, fromBlock, mid),
      getLogsBisecting(provider, filter, mid + 1, toBlock),
    ])
    return a.concat(b)
  }
}

/** A v3 pool as emitted by a decoded `PoolCreated` log. */
interface V3Created {
  pool: string
  token0: string
  token1: string
  fee: number
}

/** scan_cursor key for a chain's v3 factory scan. Factory-scoped: a factory change starts a fresh scan. */
function v3ScanKey(factory: string): string {
  return `v3factory:${factory.toLowerCase()}`
}

/**
 * The SQLite handle, or undefined if the store is unavailable.
 *
 * The cursor/discovery persistence is an OPTIMISATION, not a correctness requirement: if the DB can't
 * be opened this degrades to the previous stateless behaviour (scan from `fromBlock`, keep only what
 * this pass found) rather than failing the request.
 */
function tryGetDb(): SqliteDatabase | undefined {
  try {
    return getDb()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[data-api] v3 scan: indexer DB unavailable, scanning without a cursor`, err)
    return undefined
  }
}

/**
 * INCREMENTAL, RESUMABLE scan of the v3 factory's `PoolCreated` logs. Never throws.
 *
 * Each pass starts at `max(fromBlock, cursor + 1)` and advances at most `v3MaxChunks` windows, then
 * PERSISTS how far it got (scan_cursor) and everything it found (v3_discovered_pools). So the cost is
 * paid ONCE across passes and converges on `latest`, instead of the old behaviour where every cache
 * miss rescanned the whole span from scratch — which on Robinhood meant up to 190 `eth_getLogs` per
 * miss, forever, exhausting the endpoint's ~12/60s getLogs budget and starving every other service.
 *
 * Yields early and cleanly when the rpc.ts budget is exhausted: the cursor keeps the progress made so
 * far, so the next pass resumes rather than repeating. Returns only the pools found in THIS pass —
 * getV3Pools unions them with the persisted set.
 */
async function scanV3PoolCreated(chainId: number, factory: string, fromBlock: number): Promise<V3Created[]> {
  const provider = getProvider(chainId)
  const found: V3Created[] = []
  const topic = v3FactoryIface.getEventTopic('PoolCreated')
  let latest: number
  try {
    latest = await provider.getBlockNumber()
  } catch {
    return found
  }

  const db = tryGetDb()
  const scanKey = v3ScanKey(factory)
  let cursor: number | undefined
  if (db) {
    try {
      cursor = getScanCursor(db, chainId, scanKey)
    } catch {
      cursor = undefined // fresh/locked DB — scan from fromBlock, persist as we go.
    }
  }
  // Resume from the cursor when it is at or beyond the configured start (a cursor BEHIND fromBlock, e.g.
  // after V3_SCAN_FROM_BLOCK was moved forward, must not drag the scan backwards).
  let start = cursor !== undefined ? Math.max(fromBlock, cursor + 1) : fromBlock
  const passStart = start
  const maxChunks = v3MaxChunks(chainId)
  const chunkSize = v3LogChunk(chainId)
  let chunks = 0
  let yieldedForBudget = false

  while (start <= latest && chunks < maxChunks) {
    const end = Math.min(start + chunkSize - 1, latest)
    try {
      // ADAPTIVE: bisect on error rather than dropping the whole window. With public-only RPC lists the
      // failover can land on an endpoint that caps ranges tighter than the chunk (live-tested
      // 2026-08-02: HyperEVM's hyperliquid.rpc.blxrbdn.com refuses >1000 blocks, Stable's rpc.stable.xyz
      // >500, XLayer's rpc.xlayer.tech >100), which used to silently skip every pool in that window.
      const logs = await getLogsBisecting(provider, { address: factory, topics: [topic] }, start, end)
      for (const log of logs) {
        try {
          const parsed = v3FactoryIface.parseLog(log)
          found.push({
            pool: parsed.args.pool as string,
            token0: parsed.args.token0 as string,
            token1: parsed.args.token1 as string,
            // ethers v5 decodes indexed uint24 as a plain number (not BigNumber) → BigNumber.from normalizes.
            fee: BigNumber.from(parsed.args.fee).toNumber(),
          })
        } catch {
          // Non-conforming log at this address — skip it, never fabricate a pool.
        }
      }
    } catch (err) {
      if (isGetLogsBudgetExhausted(err)) {
        // BUDGET YIELD: stop this pass HERE without advancing past the unscanned window, so the cursor
        // keeps `start - 1` and the next pass re-attempts exactly this window. No retry, no spin — the
        // one throttle line comes from rpc.ts (once per window), so this stays quiet.
        yieldedForBudget = true
        break
      }
      // RPC rejected this range (or a transient error) — skip the window, keep scanning the rest.
      // (Advancing past it is the pre-existing policy: the indexer's own backfill is the full-history path.)
    }
    start = end + 1
    chunks += 1
  }

  // Persist BOTH halves of the progress. Cursor first-class: `start - 1` is the last block fully
  // attempted this pass. Only written when it actually advanced (setScanCursor is monotonic anyway).
  if (db) {
    try {
      if (found.length > 0) {
        upsertV3DiscoveredPools(
          db,
          found.map((c) => ({
            chainId,
            pool: c.pool,
            token0: c.token0,
            token1: c.token1,
            fee: c.fee,
            blockNumber: 0,
          })),
        )
      }
      if (start > passStart) {
        setScanCursor(db, chainId, scanKey, start - 1)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[data-api] v3 scan chain ${chainId}: failed to persist cursor/pools (will rescan)`, err)
    }
  }

  if (start <= latest) {
    // Honest partial — but NOT the old permanent truncation: the cursor means the next pass picks up
    // exactly here, so the scan converges instead of re-paying for the same blocks forever.
    // eslint-disable-next-line no-console
    console.warn(
      `[data-api] v3 scan chain ${chainId} yielded at block ${start - 1}/${latest} ` +
        `(${yieldedForBudget ? 'eth_getLogs budget exhausted' : `chunk cap ${maxChunks}`}); ` +
        `cursor persisted${db ? '' : ' (NO DB — progress lost, will rescan)'}, resumes next pass`,
    )
  }
  return found
}

/**
 * Discover live v3 pools for a chain via a `PoolCreated` log scan (gated on a configured start block —
 * see resolveV3FromBlock). Each pool is verified with live ERC-20 `balanceOf(pool)` on both tokens;
 * pools holding zero of both are skipped (no liquidity, nothing to show/route). Token metadata is read
 * live on-chain. Returns only REAL, on-chain-verified pools. Returns [] when no start block is
 * configured or on any error — never throws, never fabricates.
 */
export async function getV3Pools(chainId: number): Promise<V3PoolData[]> {
  const chain = getChain(chainId)
  if (!chain) {
    throw new Error(`unsupported chainId ${chainId}`)
  }
  if (!chain.v3Factory || /^0x0+$/.test(chain.v3Factory)) {
    return []
  }
  const fromBlock = resolveV3FromBlock(chain)
  if (fromBlock === undefined) {
    return []
  }
  const provider = getProvider(chainId)
  const created = await scanV3PoolCreated(chainId, chain.v3Factory, fromBlock)
  // A (token0,token1,fee) triple maps to exactly one pool address; dedupe by address defensively.
  const byAddr = new Map<string, V3Created>()
  // Seed with every pool discovered by PREVIOUS passes. The scan is incremental (see scanV3PoolCreated),
  // so this pass only sees the window it scanned; without the persisted set, pools found earlier would
  // disappear from the response whenever the cache missed. Every row is a real decoded PoolCreated log.
  const db = tryGetDb()
  if (db) {
    try {
      for (const row of getV3DiscoveredPools(db, chainId)) {
        byAddr.set(row.pool.toLowerCase(), { pool: row.pool, token0: row.token0, token1: row.token1, fee: row.fee })
      }
    } catch {
      // Store unavailable — fall back to just this pass's discoveries (honest subset, never fabricated).
    }
  }
  for (const c of created) {
    byAddr.set(c.pool.toLowerCase(), c)
  }

  const results: V3PoolData[] = []
  await Promise.all(
    Array.from(byAddr.values()).map(async (c) => {
      try {
        const t0 = new ethers.Contract(c.token0, ERC20_ABI, provider)
        const t1 = new ethers.Contract(c.token1, ERC20_ABI, provider)
        const [balance0, balance1] = await Promise.all([
          t0.balanceOf(c.pool) as Promise<BigNumber>,
          t1.balanceOf(c.pool) as Promise<BigNumber>,
        ])
        // Empty pool (no tokens deposited) — skip honestly, same policy as the v2 zero-reserve skip.
        if (balance0.isZero() && balance1.isZero()) {
          return
        }
        const [token0, token1] = await Promise.all([
          getTokenMeta(chainId, c.token0),
          getTokenMeta(chainId, c.token1),
        ])
        results.push({
          chainId,
          poolAddress: ethers.utils.getAddress(c.pool),
          token0,
          token1,
          fee: c.fee,
          balance0,
          balance1,
        })
      } catch {
        // RPC hiccup / non-ERC20 token — skip this pool, never fabricate.
      }
    }),
  )
  return results
}

/**
 * Spot price of a token DENOMINATED IN THE WRAPPED-NATIVE, derived from a pool's live reserves.
 * price(token) = reserve(wrappedNative) / reserve(token), both normalized by decimals.
 *
 * There is NO USD oracle on these chains, so we return the native-denominated ratio ONLY (and
 * `usd: undefined`). Callers must NOT put this ratio into a USD-semantic proto field — see handlers.ts.
 */
export interface SpotPrice {
  tokenAddress: string
  /** price of 1 token expressed in units of the wrapped-native, from live reserves. */
  priceInNative: number
  /** always undefined in Phase 1 — no USD reference exists on these chains. Kept explicit, never faked. */
  usd: undefined
}

/** Minimal UniswapV3Pool state ABI — slot0 (price/tick) + current in-range liquidity. */
const V3_POOL_STATE_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
]

export interface V3LiveState {
  sqrtPriceX96: string
  tick: number
  liquidity: string
  /** live ERC-20 balances of the pool contract (raw base units), aligned to token0 / token1 — exact TVL basis. */
  balance0: string
  balance1: string
}

/**
 * Live-read a v3 pool's slot0 price + in-range liquidity + its two token balances. The pool's token
 * BALANCES are the EXACT TVL basis (a concentrated-liquidity pool holds the real tokens), while
 * `sqrtPriceX96` is the EXACT price (balances alone do NOT give price). Returns undefined on any RPC/
 * contract error (caller keeps the last snapshot rather than fabricating). Never throws.
 */
export async function readV3LiveState(
  chainId: number,
  pool: string,
  token0: string,
  token1: string,
): Promise<V3LiveState | undefined> {
  try {
    const provider = getProvider(chainId)
    const poolC = new ethers.Contract(pool, V3_POOL_STATE_ABI, provider)
    const t0 = new ethers.Contract(token0, ERC20_ABI, provider)
    const t1 = new ethers.Contract(token1, ERC20_ABI, provider)
    const [slot0, liquidity, balance0, balance1] = await Promise.all([
      poolC.slot0(),
      poolC.liquidity() as Promise<BigNumber>,
      t0.balanceOf(pool) as Promise<BigNumber>,
      t1.balanceOf(pool) as Promise<BigNumber>,
    ])
    return {
      sqrtPriceX96: (slot0.sqrtPriceX96 as BigNumber).toString(),
      tick: Number(slot0.tick),
      liquidity: liquidity.toString(),
      balance0: balance0.toString(),
      balance1: balance1.toString(),
    }
  } catch {
    return undefined
  }
}

export async function getSpotPrices(chainId: number): Promise<SpotPrice[]> {
  const chain = getChain(chainId)
  if (!chain) {
    throw new Error(`unsupported chainId ${chainId}`)
  }
  const wnative = chain.wrappedNative.address.toLowerCase()
  const pairs = await getV2Pairs(chainId)
  const prices: SpotPrice[] = []
  for (const p of pairs) {
    const t0IsNative = p.token0.address.toLowerCase() === wnative
    const t1IsNative = p.token1.address.toLowerCase() === wnative
    if (!t0IsNative && !t1IsNative) {
      // Neither side is the wrapped-native — can't express in native terms from this pool alone. Skip.
      continue
    }
    const nativeTok = t0IsNative ? p.token0 : p.token1
    const otherTok = t0IsNative ? p.token1 : p.token0
    const nativeReserve = t0IsNative ? p.reserve0 : p.reserve1
    const otherReserve = t0IsNative ? p.reserve1 : p.reserve0
    const nativeHuman = Number(ethers.utils.formatUnits(nativeReserve, nativeTok.decimals))
    const otherHuman = Number(ethers.utils.formatUnits(otherReserve, otherTok.decimals))
    if (otherHuman === 0) {
      continue
    }
    prices.push({ tokenAddress: otherTok.address, priceInNative: nativeHuman / otherHuman, usd: undefined })
  }
  return prices
}
