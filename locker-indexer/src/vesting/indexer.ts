// Vesting indexer: enumerate every vesting schedule on every HookSwap chain that
// has a HookSwapVestingManager, via PURE RPC. For each chain:
//   1) vestingCount() → N,
//   2) getScheduleData(id) for ids 0..N-1 (chunked multicall) → the 10-field tuple,
//   3) releasable() on each child contract (chunked multicall) → live claimable,
//   4) symbol()/decimals() for every vesting token,
//   5) USD prices via the shared pricing module (Robinhood-only today).
// Produces normalized `VestingSchedule` entities + a `VestingStats` aggregate.
//
// Reuses the locker's chain config (RPC + Multicall3) and pricing.ts. Same
// discipline as the farms indexer:
//   FACTS ONLY — every value is a real on-chain read. `valueUsd` is OMITTED (never
//   fabricated) whenever the vesting token has no honest price (only Robinhood
//   resolves USD today). A chain whose RPC fails does not crash the cycle — it is
//   marked stale and its last-known schedules are retained.

import { createPublicClient, formatUnits, getAddress, http, type PublicClient } from "viem";
import { CHAINS, MULTICALL3, vestingManager, type ChainConfig } from "../chains.js";
import { ENV } from "../env.js";
import { priceUsdBatch } from "../pricing.js";
import { ERC20_META_ABI, VESTING_CHILD_ABI, VESTING_MANAGER_ABI } from "./abi.js";

const ZERO = "0x0000000000000000000000000000000000000000";

// ----------------------------------------------------------------- entity types

export interface Amount {
  /** Base-unit integer as a decimal string (no precision loss). */
  raw: string;
  /** Human-readable amount (raw / 10**decimals). */
  formatted: string;
}

export interface VestingToken {
  addr: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface VestingSchedule {
  chainId: number;
  chainName: string;
  /** Schedule id in the manager's registry (0-based). */
  id: number;
  /** The per-schedule HookSwapVesting child contract. */
  contractAddress: `0x${string}`;
  token: VestingToken;
  beneficiary: `0x${string}`;
  creator: `0x${string}`;
  /** Absolute unix start (seconds). */
  start: number;
  /** Cliff duration (seconds relative to start). */
  cliff: number;
  /** Total vesting duration (seconds relative to start). */
  duration: number;
  /** start + cliff (absolute unix seconds). */
  cliffTime: number;
  /** start + duration (absolute unix seconds). */
  endTime: number;
  totalAmount: Amount;
  released: Amount;
  /** releasable() on the child — vested-but-unreleased, claimable right now. */
  claimable: Amount;
  /** released + claimable — total vested to date. */
  vested: Amount;
  /** 100 × vested / totalAmount (0 when totalAmount is 0). */
  pctVested: number;
  /** "cliff" before cliffTime · "vesting" while streaming · "complete" at/after endTime. */
  status: "cliff" | "vesting" | "complete";
  /** USD value of the still-locked (unvested) principal. Omitted when unpriceable. */
  valueUsd?: number;
}

export interface VestingChainStatus {
  chainId: number;
  name: string;
  manager: `0x${string}`;
  rpcUrl: string;
  reachable: boolean;
  /** true when this cycle failed but prior data is being retained. */
  stale: boolean;
  error?: string;
  scheduleCount: number;
  activeCount: number;
  tvlUsd?: number;
  lastIndexedAt: number | null; // ms epoch of last successful index
}

export interface VestingStats {
  totalSchedules: number;
  /** Schedules not yet fully vested (status !== "complete"). */
  activeSchedules: number;
  /** Sum of priced still-locked value. Omitted when nothing could be priced. */
  totalLockedUsd?: number;
  chains: number;
  reachableChains: number;
}

export interface VestingSnapshot {
  generatedAt: number; // ms epoch
  stats: VestingStats;
  chains: VestingChainStatus[];
  schedules: VestingSchedule[];
}

// ------------------------------------------------------------ per-chain results

interface TokenMeta {
  symbol: string;
  decimals: number;
}

interface VestingChainResult {
  status: VestingChainStatus;
  schedules: VestingSchedule[];
}

/** Raw on-chain schedule tuple (before token metadata / releasable / pricing). */
interface RawSchedule {
  id: number;
  token: `0x${string}`;
  beneficiary: `0x${string}`;
  creator: `0x${string}`;
  start: bigint;
  cliff: bigint;
  duration: bigint;
  totalAmount: bigint;
  released: bigint;
  contractAddress: `0x${string}`;
}

// ---------------------------------------------------------------------- helpers

function amt(raw: bigint, decimals: number): Amount {
  return { raw: raw.toString(), formatted: formatUnits(raw, decimals) };
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

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function safeAddr(a: string | undefined | null): `0x${string}` {
  if (!a || typeof a !== "string") return ZERO as `0x${string}`;
  try {
    return getAddress(a);
  } catch {
    return a.toLowerCase() as `0x${string}`;
  }
}

function toBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string" && v.length) {
    try {
      return BigInt(v);
    } catch {
      return 0n;
    }
  }
  return 0n;
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
      { address: t, abi: ERC20_META_ABI, functionName: "symbol" as const },
      { address: t, abi: ERC20_META_ABI, functionName: "decimals" as const },
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
        dr?.status === "success" && dr.result != null ? Number(dr.result as number | bigint) : 18;
      out.set(t.toLowerCase(), { symbol, decimals: Number.isFinite(decimals) ? decimals : 18 });
    });
  }
  return out;
}

/** Read one chain's vesting schedules fully. Throws on RPC failure (caller catches → stale). */
async function indexChainVesting(
  cfg: ChainConfig,
  manager: `0x${string}`,
  nowSec: number,
): Promise<VestingSchedule[]> {
  const client: PublicClient = createPublicClient({ transport: http(cfg.rpcUrl) });

  // 1) vestingCount() — throws on a dead RPC (→ chain marked stale by caller).
  const count = (await client.readContract({
    address: manager,
    abi: VESTING_MANAGER_ABI,
    functionName: "vestingCount",
  })) as bigint;
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return [];

  // 2) getScheduleData(id) for ids 0..n-1 (chunked multicall, allowFailure).
  const ids = Array.from({ length: n }, (_v, i) => i);
  const raws: RawSchedule[] = [];
  for (const ch of chunk(ids, ENV.batchSize)) {
    const contracts = ch.map((id) => ({
      address: manager,
      abi: VESTING_MANAGER_ABI,
      functionName: "getScheduleData" as const,
      args: [BigInt(id)] as const,
    }));
    const res = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts,
    });
    ch.forEach((id, i) => {
      const r = res[i];
      if (r?.status !== "success" || r.result == null) return;
      // getScheduleData has 10 flat named outputs → viem returns a positional tuple.
      const t = r.result as readonly unknown[];
      const token = safeAddr(t[1] as string);
      const contractAddress = safeAddr(t[9] as string);
      // A schedule whose token / child reads reverted is dropped (can't normalize honestly).
      if (token === ZERO || contractAddress === ZERO) return;
      raws.push({
        id,
        token,
        beneficiary: safeAddr(t[2] as string),
        creator: safeAddr(t[3] as string),
        start: toBig(t[4]),
        cliff: toBig(t[5]),
        duration: toBig(t[6]),
        totalAmount: toBig(t[7]),
        released: toBig(t[8]),
        contractAddress,
      });
    });
  }
  if (raws.length === 0) return [];

  // 3) releasable() on each child (live claimable), chunked multicall.
  const releasableByChild = new Map<string, bigint>();
  for (const ch of chunk(raws, ENV.batchSize)) {
    const contracts = ch.map((r) => ({
      address: r.contractAddress,
      abi: VESTING_CHILD_ABI,
      functionName: "releasable" as const,
    }));
    const res = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts,
    });
    ch.forEach((r, i) => {
      const rr = res[i];
      if (rr?.status === "success" && rr.result != null) {
        releasableByChild.set(r.contractAddress.toLowerCase(), toBig(rr.result));
      }
    });
  }

  // 4) token metadata (symbol/decimals) for every vesting token.
  const tokenSet = new Set<string>();
  for (const r of raws) tokenSet.add(r.token.toLowerCase());
  const tokenAddrs = [...tokenSet] as `0x${string}`[];
  const meta = await readTokenMeta(client, tokenAddrs);

  // 5) USD prices for every token (only Robinhood resolves; others → undefined).
  let prices = new Map<string, number | undefined>();
  try {
    prices = await priceUsdBatch(cfg.chainId, tokenAddrs);
  } catch {
    prices = new Map();
  }
  const priceOf = (t: `0x${string}`): number | undefined => prices.get(t.toLowerCase());
  const metaOf = (t: `0x${string}`): TokenMeta =>
    meta.get(t.toLowerCase()) ?? { symbol: shortAddr(t), decimals: 18 };

  // 6) normalize.
  const schedules: VestingSchedule[] = raws.map((r) => {
    const m = metaOf(r.token);
    const claimableRaw = releasableByChild.get(r.contractAddress.toLowerCase()) ?? 0n;
    const vestedRaw = r.released + claimableRaw;
    const cliffTime = Number(r.start + r.cliff);
    const endTime = Number(r.start + r.duration);

    const status: "cliff" | "vesting" | "complete" =
      nowSec < cliffTime ? "cliff" : nowSec >= endTime ? "complete" : "vesting";

    const totalHuman = Number(formatUnits(r.totalAmount, m.decimals));
    const vestedHuman = Number(formatUnits(vestedRaw, m.decimals));
    const pctVested = totalHuman > 0 ? Math.min(100, (vestedHuman / totalHuman) * 100) : 0;

    // Still-locked (unvested) principal, valued only when the token prices honestly.
    const lockedRaw = r.totalAmount > vestedRaw ? r.totalAmount - vestedRaw : 0n;
    const lockedHuman = Number(formatUnits(lockedRaw, m.decimals));
    const price = priceOf(r.token);
    const valueUsd =
      price !== undefined && Number.isFinite(price) ? lockedHuman * price : undefined;

    const schedule: VestingSchedule = {
      chainId: cfg.chainId,
      chainName: cfg.name,
      id: r.id,
      contractAddress: safeAddr(r.contractAddress),
      token: { addr: safeAddr(r.token), symbol: m.symbol, decimals: m.decimals },
      beneficiary: safeAddr(r.beneficiary),
      creator: safeAddr(r.creator),
      start: Number(r.start),
      cliff: Number(r.cliff),
      duration: Number(r.duration),
      cliffTime,
      endTime,
      totalAmount: amt(r.totalAmount, m.decimals),
      released: amt(r.released, m.decimals),
      claimable: amt(claimableRaw, m.decimals),
      vested: amt(vestedRaw, m.decimals),
      pctVested,
      status,
    };
    if (valueUsd !== undefined) schedule.valueUsd = valueUsd;
    return schedule;
  });

  return schedules;
}

// -------------------------------------------------------------- aggregation

function buildVestingStats(
  schedules: VestingSchedule[],
  chains: VestingChainStatus[],
): VestingStats {
  let active = 0;
  let locked = 0;
  let anyPriced = false;
  for (const s of schedules) {
    if (s.status !== "complete") active += 1;
    if (s.valueUsd !== undefined) {
      locked += s.valueUsd;
      anyPriced = true;
    }
  }
  return {
    totalSchedules: schedules.length,
    activeSchedules: active,
    totalLockedUsd: anyPriced ? locked : undefined,
    chains: chains.length,
    reachableChains: chains.filter((c) => c.reachable).length,
  };
}

// ----------------------------------------------------------------- the indexer

export class VestingIndexer {
  /** Last result per chain (retained across cycles so a stale chain keeps its data). */
  private byChain = new Map<number, VestingChainResult>();
  private snapshot: VestingSnapshot;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  /** Chains that actually have a configured manager (the only ones we index/report). */
  private readonly targets: { cfg: ChainConfig; manager: `0x${string}` }[] = CHAINS.map((cfg) => ({
    cfg,
    manager: vestingManager(cfg.chainId),
  })).filter((t): t is { cfg: ChainConfig; manager: `0x${string}` } => t.manager !== undefined);

  constructor() {
    const chains: VestingChainStatus[] = this.targets.map(({ cfg, manager }) => ({
      chainId: cfg.chainId,
      name: cfg.name,
      manager,
      rpcUrl: cfg.rpcUrl,
      reachable: false,
      stale: false,
      scheduleCount: 0,
      activeCount: 0,
      lastIndexedAt: null,
    }));
    this.snapshot = {
      generatedAt: Date.now(),
      stats: buildVestingStats([], chains),
      chains,
      schedules: [],
    };
  }

  getSnapshot(): VestingSnapshot {
    return this.snapshot;
  }

  /** Run one full cross-chain refresh. Never throws (per-chain errors are contained). */
  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      await Promise.all(
        this.targets.map(async ({ cfg, manager }) => {
          try {
            const schedules = await withTimeout(
              indexChainVesting(cfg, manager, nowSec),
              ENV.chainTimeoutMs,
              `${cfg.name} vesting index`,
            );
            const tvl = schedules.reduce((s, v) => s + (v.valueUsd ?? 0), 0);
            const hasTvl = schedules.some((v) => v.valueUsd !== undefined);
            this.byChain.set(cfg.chainId, {
              schedules,
              status: {
                chainId: cfg.chainId,
                name: cfg.name,
                manager,
                rpcUrl: cfg.rpcUrl,
                reachable: true,
                stale: false,
                scheduleCount: schedules.length,
                activeCount: schedules.filter((v) => v.status !== "complete").length,
                tvlUsd: hasTvl ? tvl : undefined,
                lastIndexedAt: Date.now(),
              },
            });
          } catch (e) {
            const prev = this.byChain.get(cfg.chainId);
            const msg = (e as Error).message || "rpc error";
            console.warn(`[vesting] ${cfg.name} (${cfg.chainId}) failed: ${msg}`);
            this.byChain.set(cfg.chainId, {
              schedules: prev?.schedules ?? [],
              status: {
                chainId: cfg.chainId,
                name: cfg.name,
                manager,
                rpcUrl: cfg.rpcUrl,
                reachable: false,
                stale: Boolean(prev?.schedules?.length),
                error: msg,
                scheduleCount: prev?.schedules?.length ?? 0,
                activeCount: prev?.status.activeCount ?? 0,
                tvlUsd: prev?.status.tvlUsd,
                lastIndexedAt: prev?.status.lastIndexedAt ?? null,
              },
            });
          }
        }),
      );

      const chains = this.targets.map(
        ({ cfg, manager }) =>
          this.byChain.get(cfg.chainId)?.status ?? {
            chainId: cfg.chainId,
            name: cfg.name,
            manager,
            rpcUrl: cfg.rpcUrl,
            reachable: false,
            stale: false,
            scheduleCount: 0,
            activeCount: 0,
            lastIndexedAt: null,
          },
      );
      const schedules = this.targets.flatMap(
        ({ cfg }) => this.byChain.get(cfg.chainId)?.schedules ?? [],
      );

      this.snapshot = {
        generatedAt: Date.now(),
        stats: buildVestingStats(schedules, chains),
        chains,
        schedules,
      };
    } finally {
      this.running = false;
    }
  }

  /** Start the refresh loop (runs one immediately, then every ENV.refreshMs). */
  start(onCycle?: (snap: VestingSnapshot) => void): void {
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
