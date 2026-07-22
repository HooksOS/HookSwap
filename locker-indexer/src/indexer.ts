// Core indexer: enumerate every lock on every HookSwap chain via RPC, read token
// metadata, price to USD (via pricing.ts), and produce normalized entities +
// aggregates + global stats. Refreshes on an interval; the latest snapshot is held
// in memory and served read-only by server.ts.
//
// FACTS ONLY: every value comes from a real on-chain read. Unpriced tokens report
// native amounts with valueUsd omitted (never a fabricated USD figure). A chain
// whose RPC fails does not crash the cycle — it is marked stale and its last known
// locks are retained until it recovers.

import { createPublicClient, formatUnits, getAddress, http, type PublicClient } from "viem";
import { CHAINS, MULTICALL3, type ChainConfig } from "./chains.js";
import { ERC20_ABI, LOCKER_MANAGER_ABI } from "./abi.js";
import { ENV } from "./env.js";
import { priceUsdBatch } from "./pricing.js";

// ----------------------------------------------------------------- entity types

export interface Amount {
  /** Base-unit integer as a decimal string (no precision loss). */
  raw: string;
  /** Human-readable amount (raw / 10**decimals). */
  formatted: string;
}

export interface LpLeg {
  token: `0x${string}`;
  symbol: string;
  decimals: number;
  /** Reserve of this token attributable to the locked LP amount. */
  balance: Amount;
  valueUsd?: number;
}

export interface Lock {
  chainId: number;
  chainName: string;
  id: number;
  /** The per-lock HookSwapTokenLocker child holding the tokens. */
  lockerContract: `0x${string}`;
  /** The locked token (LP token when isLpToken). */
  token: `0x${string}`;
  symbol: string;
  decimals: number;
  isLpToken: boolean;
  owner: `0x${string}`;
  createdBy: `0x${string}`;
  createdAt: number; // unix seconds
  unlockTime: number; // unix seconds
  amount: Amount; // locked balance
  totalSupply: Amount;
  /** locked balance as a percentage of token total supply (null if supply 0). */
  lockedPctOfSupply: number | null;
  /** USD value of the locked amount, or omitted when unpriceable. */
  valueUsd?: number;
  status: "locked" | "unlockable";
  /** Present for LP locks (isLpToken): the two underlying legs. */
  lp?: { token0: LpLeg; token1: LpLeg };
}

export interface TokenAgg {
  chainId: number;
  chainName: string;
  token: `0x${string}`;
  symbol: string;
  decimals: number;
  totalLockedAmount: Amount;
  totalSupply: Amount;
  lockedPctOfSupply: number | null;
  tvlUsd?: number; // omitted if the token is unpriced
  lockCount: number;
}

export interface PoolAgg {
  chainId: number;
  chainName: string;
  /** The LP (pair) token address. */
  pair: `0x${string}`;
  symbol: string;
  token0: `0x${string}`;
  token1: `0x${string}`;
  token0Symbol: string;
  token1Symbol: string;
  totalLockedAmount: Amount; // summed LP-token amount locked
  tvlUsd?: number; // omitted if either underlying leg is unpriced
  lockCount: number;
}

export interface ChainStatus {
  chainId: number;
  name: string;
  manager: `0x${string}`;
  rpcUrl: string;
  reachable: boolean;
  /** true when this cycle failed but prior data is being retained. */
  stale: boolean;
  error?: string;
  lockCount: number;
  tvlUsd?: number;
  lastIndexedAt: number | null; // ms epoch of last successful index
}

/**
 * Native-denominated locked total for one (chain, token). No USD is ever involved
 * here — this is the real on-chain summed locked amount (raw base units + a
 * human-readable form), so chains with no USD price anchor (e.g. HOOK on Robinhood)
 * still have a real, plottable locked figure. Excludes LP locks (those aggregate
 * into pools); one entry per non-LP token per chain.
 */
export interface NativeLockedToken {
  chainId: number;
  chainName: string;
  token: `0x${string}`;
  symbol: string;
  decimals: number;
  /** Summed locked amount across all locks of this token on this chain (raw + formatted). */
  totalLocked: Amount;
  lockCount: number;
}

export interface GlobalStats {
  totalLocks: number;
  /** Sum of priced lock values. Omitted when no lock could be priced. */
  totalTvlUsd?: number;
  /** How many locks contributed a USD value (price coverage transparency). */
  pricedLocks: number;
  unpricedLocks: number;
  newLocks24h: number;
  chains: number;
  reachableChains: number;
  /**
   * Per-(chain, token) native-denominated locked totals (never a USD figure).
   * Enables a real native locked curve/aggregate on unpriceable chains. Empty
   * array when there are no non-LP token locks.
   */
  nativeLockedByToken: NativeLockedToken[];
}

export interface LockerSnapshot {
  generatedAt: number; // ms epoch
  stats: GlobalStats;
  chains: ChainStatus[];
  locks: Lock[];
  tokens: TokenAgg[];
  pools: PoolAgg[];
}

// ------------------------------------------------------------ per-chain results

interface TokenMeta {
  symbol: string;
  decimals: number;
}

interface ChainResult {
  status: ChainStatus;
  locks: Lock[];
}

const ZERO = "0x0000000000000000000000000000000000000000";

function amt(raw: bigint, decimals: number): Amount {
  return { raw: raw.toString(), formatted: formatUnits(raw, decimals) };
}

function pctOfSupply(balance: bigint, totalSupply: bigint): number | null {
  if (totalSupply <= 0n) return null;
  // bigint ratio scaled to 6 dp, then to a percentage.
  return Number((balance * 1_000_000n) / totalSupply) / 1_000_000 * 100;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Raw shapes returned by getTokenLockData / getLpData (viem decodes tuples as objects).
interface RawLock {
  isLpToken: boolean;
  id: number;
  contractAddress: `0x${string}`;
  lockOwner: `0x${string}`;
  token: `0x${string}`;
  createdBy: `0x${string}`;
  createdAt: number;
  unlockTime: number;
  balance: bigint;
  totalSupply: bigint;
}
interface RawLp {
  hasLpData: boolean;
  id: number;
  token0: `0x${string}`;
  token1: `0x${string}`;
  balance0: bigint;
  balance1: bigint;
  price0: bigint;
  price1: bigint;
}

/** Read one chain fully. Throws on RPC failure (caller catches → marks stale). */
async function indexChain(cfg: ChainConfig, nowSec: number): Promise<Lock[]> {
  const client: PublicClient = createPublicClient({ transport: http(cfg.rpcUrl) });

  const count = (await client.readContract({
    address: cfg.manager,
    abi: LOCKER_MANAGER_ABI,
    functionName: "tokenLockerCount",
  })) as number;

  const total = Number(count);
  if (total <= 0) return [];

  const ids = Array.from({ length: total }, (_, i) => i);

  // 1) getTokenLockData for every id (chunked multicall).
  const rawLocks: RawLock[] = [];
  for (const ch of chunk(ids, ENV.batchSize)) {
    const res = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts: ch.map((id) => ({
        address: cfg.manager,
        abi: LOCKER_MANAGER_ABI,
        functionName: "getTokenLockData" as const,
        args: [id],
      })),
    });
    for (const r of res) {
      if (r.status !== "success" || !r.result) continue;
      const t = r.result as readonly unknown[]; // multiple named returns decode as a tuple/array
      rawLocks.push({
        isLpToken: Boolean(t[0]),
        id: Number(t[1]),
        contractAddress: t[2] as `0x${string}`,
        lockOwner: t[3] as `0x${string}`,
        token: t[4] as `0x${string}`,
        createdBy: t[5] as `0x${string}`,
        createdAt: Number(t[6]),
        unlockTime: Number(t[7]),
        balance: BigInt((t[8] ?? 0) as bigint | number | string),
        totalSupply: BigInt((t[9] ?? 0) as bigint | number | string),
      });
    }
  }
  if (rawLocks.length === 0) return [];

  // 2) getLpData for LP locks.
  const lpLocks = rawLocks.filter((l) => l.isLpToken);
  const lpById = new Map<number, RawLp>();
  for (const ch of chunk(lpLocks, ENV.batchSize)) {
    const res = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts: ch.map((l) => ({
        address: cfg.manager,
        abi: LOCKER_MANAGER_ABI,
        functionName: "getLpData" as const,
        args: [l.id],
      })),
    });
    res.forEach((r, i) => {
      if (r.status !== "success" || !r.result) return;
      const t = r.result as readonly unknown[];
      const lp: RawLp = {
        hasLpData: Boolean(t[0]),
        id: Number(t[1]),
        token0: t[2] as `0x${string}`,
        token1: t[3] as `0x${string}`,
        balance0: BigInt((t[4] ?? 0) as bigint | number | string),
        balance1: BigInt((t[5] ?? 0) as bigint | number | string),
        price0: BigInt((t[6] ?? 0) as bigint | number | string),
        price1: BigInt((t[7] ?? 0) as bigint | number | string),
      };
      if (lp.hasLpData) lpById.set(ch[i].id, lp);
    });
  }

  // 3) collect every token needing symbol/decimals: the lock token + LP legs.
  const tokenSet = new Set<string>();
  for (const l of rawLocks) {
    if (l.token && l.token !== ZERO) tokenSet.add(l.token.toLowerCase());
  }
  for (const lp of lpById.values()) {
    if (lp.token0 && lp.token0 !== ZERO) tokenSet.add(lp.token0.toLowerCase());
    if (lp.token1 && lp.token1 !== ZERO) tokenSet.add(lp.token1.toLowerCase());
  }
  const tokenAddrs = [...tokenSet] as `0x${string}`[];
  const meta = await readTokenMeta(client, tokenAddrs);

  // 4) USD prices for every token (lock tokens + LP legs).
  let prices = new Map<string, number | undefined>();
  try {
    prices = await priceUsdBatch(cfg.chainId, tokenAddrs);
  } catch {
    // pricing is best-effort; a failure here => everything unpriced this cycle.
    prices = new Map();
  }
  const priceOf = (t: `0x${string}`): number | undefined => prices.get(t.toLowerCase());
  const metaOf = (t: `0x${string}`): TokenMeta =>
    meta.get(t.toLowerCase()) ?? { symbol: shortAddr(t), decimals: 18 };

  // 5) normalize.
  const locks: Lock[] = [];
  for (const l of rawLocks) {
    const tm = metaOf(l.token);
    const price = priceOf(l.token);
    const formattedNum = Number(formatUnits(l.balance, tm.decimals));
    let valueUsd: number | undefined =
      price !== undefined ? formattedNum * price : undefined;

    const lock: Lock = {
      chainId: cfg.chainId,
      chainName: cfg.name,
      id: Number(l.id),
      lockerContract: safeAddr(l.contractAddress),
      token: safeAddr(l.token),
      symbol: tm.symbol,
      decimals: tm.decimals,
      isLpToken: l.isLpToken,
      owner: safeAddr(l.lockOwner),
      createdBy: safeAddr(l.createdBy),
      createdAt: Number(l.createdAt),
      unlockTime: Number(l.unlockTime),
      amount: amt(l.balance, tm.decimals),
      totalSupply: amt(l.totalSupply, tm.decimals),
      lockedPctOfSupply: pctOfSupply(l.balance, l.totalSupply),
      status: Number(l.unlockTime) <= nowSec ? "unlockable" : "locked",
    };

    const lp = lpById.get(Number(l.id));
    if (lp) {
      const m0 = metaOf(lp.token0);
      const m1 = metaOf(lp.token1);
      const p0 = priceOf(lp.token0);
      const p1 = priceOf(lp.token1);
      const b0 = Number(formatUnits(lp.balance0, m0.decimals));
      const b1 = Number(formatUnits(lp.balance1, m1.decimals));
      const leg0Usd = p0 !== undefined ? b0 * p0 : undefined;
      const leg1Usd = p1 !== undefined ? b1 * p1 : undefined;
      lock.lp = {
        token0: {
          token: safeAddr(lp.token0),
          symbol: m0.symbol,
          decimals: m0.decimals,
          balance: amt(lp.balance0, m0.decimals),
          valueUsd: leg0Usd,
        },
        token1: {
          token: safeAddr(lp.token1),
          symbol: m1.symbol,
          decimals: m1.decimals,
          balance: amt(lp.balance1, m1.decimals),
          valueUsd: leg1Usd,
        },
      };
      // LP USD is honest only when BOTH legs price; else omit.
      valueUsd =
        leg0Usd !== undefined && leg1Usd !== undefined ? leg0Usd + leg1Usd : undefined;
    }

    if (valueUsd !== undefined) lock.valueUsd = valueUsd;
    locks.push(lock);
  }

  return locks;
}

/** symbol()/decimals() for a set of tokens via multicall (tolerant of missing/reverting). */
async function readTokenMeta(
  client: PublicClient,
  tokens: `0x${string}`[],
): Promise<Map<string, TokenMeta>> {
  const out = new Map<string, TokenMeta>();
  if (tokens.length === 0) return out;

  for (const ch of chunk(tokens, ENV.batchSize)) {
    const contracts = ch.flatMap((t) => [
      { address: t, abi: ERC20_ABI, functionName: "symbol" as const },
      { address: t, abi: ERC20_ABI, functionName: "decimals" as const },
    ]);
    const res = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts,
    });
    ch.forEach((t, i) => {
      const sr = res[i * 2];
      const dr = res[i * 2 + 1];
      const symbol =
        sr?.status === "success" && typeof sr.result === "string" && sr.result.length
          ? (sr.result as string)
          : shortAddr(t);
      const decimals =
        dr?.status === "success" && dr.result != null
          ? Number(dr.result as number | bigint)
          : 18;
      out.set(t.toLowerCase(), { symbol, decimals: Number.isFinite(decimals) ? decimals : 18 });
    });
  }
  return out;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Checksum an address, tolerating missing/bad input (falls back gracefully). */
function safeAddr(a: string | undefined | null): `0x${string}` {
  if (!a || typeof a !== "string") return ZERO as `0x${string}`;
  try {
    return getAddress(a);
  } catch {
    return a.toLowerCase() as `0x${string}`;
  }
}

// -------------------------------------------------------------- aggregation

function buildTokenAggs(locks: Lock[]): TokenAgg[] {
  const map = new Map<string, TokenAgg & { _rawSum: bigint; _allPriced: boolean; _anyLock: boolean }>();
  for (const l of locks) {
    if (l.isLpToken) continue; // LP locks aggregate into pools
    const key = `${l.chainId}:${l.token.toLowerCase()}`;
    let a = map.get(key);
    if (!a) {
      a = {
        chainId: l.chainId,
        chainName: l.chainName,
        token: l.token,
        symbol: l.symbol,
        decimals: l.decimals,
        totalLockedAmount: { raw: "0", formatted: "0" },
        totalSupply: l.totalSupply,
        lockedPctOfSupply: null,
        lockCount: 0,
        _rawSum: 0n,
        _allPriced: true,
        _anyLock: false,
      };
      map.set(key, a);
    }
    a._rawSum += BigInt(l.amount.raw);
    a.lockCount += 1;
    a._anyLock = true;
    if (l.valueUsd !== undefined) a.tvlUsd = (a.tvlUsd ?? 0) + l.valueUsd;
    else a._allPriced = false;
    // keep the largest observed total supply (should be identical across locks)
    if (BigInt(l.totalSupply.raw) > BigInt(a.totalSupply.raw)) a.totalSupply = l.totalSupply;
  }
  const out: TokenAgg[] = [];
  for (const a of map.values()) {
    a.totalLockedAmount = amt(a._rawSum, a.decimals);
    a.lockedPctOfSupply = pctOfSupply(a._rawSum, BigInt(a.totalSupply.raw));
    if (!a._allPriced) a.tvlUsd = undefined; // honest: partial pricing => no aggregate TVL
    const { _rawSum, _allPriced, _anyLock, ...clean } = a;
    out.push(clean);
  }
  return out.sort((x, y) => (y.tvlUsd ?? -1) - (x.tvlUsd ?? -1) || y.lockCount - x.lockCount);
}

function buildPoolAggs(locks: Lock[]): PoolAgg[] {
  const map = new Map<string, PoolAgg & { _rawSum: bigint; _allPriced: boolean }>();
  for (const l of locks) {
    if (!l.isLpToken || !l.lp) continue;
    const key = `${l.chainId}:${l.token.toLowerCase()}`;
    let a = map.get(key);
    if (!a) {
      a = {
        chainId: l.chainId,
        chainName: l.chainName,
        pair: l.token,
        symbol: l.symbol,
        token0: l.lp.token0.token,
        token1: l.lp.token1.token,
        token0Symbol: l.lp.token0.symbol,
        token1Symbol: l.lp.token1.symbol,
        totalLockedAmount: { raw: "0", formatted: "0" },
        lockCount: 0,
        _rawSum: 0n,
        _allPriced: true,
      };
      map.set(key, a);
    }
    a._rawSum += BigInt(l.amount.raw);
    a.lockCount += 1;
    if (l.valueUsd !== undefined) a.tvlUsd = (a.tvlUsd ?? 0) + l.valueUsd;
    else a._allPriced = false;
  }
  const out: PoolAgg[] = [];
  for (const a of map.values()) {
    a.totalLockedAmount = amt(a._rawSum, 18); // LP tokens are 18-dec
    if (!a._allPriced) a.tvlUsd = undefined;
    const { _rawSum, _allPriced, ...clean } = a;
    out.push(clean);
  }
  return out.sort((x, y) => (y.tvlUsd ?? -1) - (x.tvlUsd ?? -1) || y.lockCount - x.lockCount);
}

/**
 * Native-denominated locked totals per (chain, token) — no pricing, only real
 * on-chain summed amounts. Excludes LP locks (they aggregate into pools). This is
 * the honest fallback for chains with no USD anchor.
 */
function buildNativeLockedByToken(locks: Lock[]): NativeLockedToken[] {
  const map = new Map<
    string,
    {
      chainId: number;
      chainName: string;
      token: `0x${string}`;
      symbol: string;
      decimals: number;
      raw: bigint;
      lockCount: number;
    }
  >();
  for (const l of locks) {
    if (l.isLpToken) continue; // LP locks aggregate into pools, not per-token natives
    const key = `${l.chainId}:${l.token.toLowerCase()}`;
    let a = map.get(key);
    if (!a) {
      a = {
        chainId: l.chainId,
        chainName: l.chainName,
        token: l.token,
        symbol: l.symbol,
        decimals: l.decimals,
        raw: 0n,
        lockCount: 0,
      };
      map.set(key, a);
    }
    a.raw += BigInt(l.amount.raw);
    a.lockCount += 1;
  }
  const out: NativeLockedToken[] = [];
  for (const a of map.values()) {
    out.push({
      chainId: a.chainId,
      chainName: a.chainName,
      token: a.token,
      symbol: a.symbol,
      decimals: a.decimals,
      totalLocked: amt(a.raw, a.decimals),
      lockCount: a.lockCount,
    });
  }
  return out.sort((x, y) => y.lockCount - x.lockCount);
}

function buildStats(locks: Lock[], chains: ChainStatus[], nowSec: number): GlobalStats {
  let priced = 0;
  let unpriced = 0;
  let tvl = 0;
  let new24h = 0;
  const dayAgo = nowSec - 86_400;
  for (const l of locks) {
    if (l.valueUsd !== undefined) {
      priced += 1;
      tvl += l.valueUsd;
    } else {
      unpriced += 1;
    }
    if (l.createdAt >= dayAgo) new24h += 1;
  }
  return {
    totalLocks: locks.length,
    totalTvlUsd: priced > 0 ? tvl : undefined,
    pricedLocks: priced,
    unpricedLocks: unpriced,
    newLocks24h: new24h,
    chains: chains.length,
    reachableChains: chains.filter((c) => c.reachable).length,
    nativeLockedByToken: buildNativeLockedByToken(locks),
  };
}

// ----------------------------------------------------------------- the indexer

export class LockerIndexer {
  /** Last result per chain (retained across cycles so a stale chain keeps its data). */
  private byChain = new Map<number, ChainResult>();
  private snapshot: LockerSnapshot;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor() {
    // seed empty chain statuses so /health & /stats are honest before the first cycle
    const chains: ChainStatus[] = CHAINS.map((c) => ({
      chainId: c.chainId,
      name: c.name,
      manager: c.manager,
      rpcUrl: c.rpcUrl,
      reachable: false,
      stale: false,
      lockCount: 0,
      lastIndexedAt: null,
    }));
    this.snapshot = {
      generatedAt: Date.now(),
      stats: buildStats([], chains, Math.floor(Date.now() / 1000)),
      chains,
      locks: [],
      tokens: [],
      pools: [],
    };
  }

  getSnapshot(): LockerSnapshot {
    return this.snapshot;
  }

  /** Run one full cross-chain refresh. Never throws (per-chain errors are contained). */
  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      await Promise.all(
        CHAINS.map(async (cfg) => {
          try {
            const locks = await withTimeout(
              indexChain(cfg, nowSec),
              ENV.chainTimeoutMs,
              `${cfg.name} index`,
            );
            const tvl = locks.reduce((s, l) => s + (l.valueUsd ?? 0), 0);
            const hasTvl = locks.some((l) => l.valueUsd !== undefined);
            this.byChain.set(cfg.chainId, {
              locks,
              status: {
                chainId: cfg.chainId,
                name: cfg.name,
                manager: cfg.manager,
                rpcUrl: cfg.rpcUrl,
                reachable: true,
                stale: false,
                lockCount: locks.length,
                tvlUsd: hasTvl ? tvl : undefined,
                lastIndexedAt: Date.now(),
              },
            });
          } catch (e) {
            const prev = this.byChain.get(cfg.chainId);
            const msg = (e as Error).message || "rpc error";
            console.warn(`[indexer] ${cfg.name} (${cfg.chainId}) failed: ${msg}`);
            // retain prior locks (if any) but mark stale + unreachable this cycle
            this.byChain.set(cfg.chainId, {
              locks: prev?.locks ?? [],
              status: {
                chainId: cfg.chainId,
                name: cfg.name,
                manager: cfg.manager,
                rpcUrl: cfg.rpcUrl,
                reachable: false,
                stale: Boolean(prev?.locks?.length),
                error: msg,
                lockCount: prev?.locks?.length ?? 0,
                tvlUsd: prev?.status.tvlUsd,
                lastIndexedAt: prev?.status.lastIndexedAt ?? null,
              },
            });
          }
        }),
      );

      // rebuild the served snapshot from all chain results
      const chains = CHAINS.map(
        (c) =>
          this.byChain.get(c.chainId)?.status ?? {
            chainId: c.chainId,
            name: c.name,
            manager: c.manager,
            rpcUrl: c.rpcUrl,
            reachable: false,
            stale: false,
            lockCount: 0,
            lastIndexedAt: null,
          },
      );
      const locks = CHAINS.flatMap((c) => this.byChain.get(c.chainId)?.locks ?? []);

      this.snapshot = {
        generatedAt: Date.now(),
        stats: buildStats(locks, chains, nowSec),
        chains,
        locks,
        tokens: buildTokenAggs(locks),
        pools: buildPoolAggs(locks),
      };
    } finally {
      this.running = false;
    }
  }

  /** Start the refresh loop (runs one immediately, then every ENV.refreshMs). */
  start(onCycle?: (snap: LockerSnapshot) => void): void {
    const run = async () => {
      await this.refresh();
      onCycle?.(this.snapshot);
    };
    void run();
    this.timer = setInterval(() => void run(), ENV.refreshMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
