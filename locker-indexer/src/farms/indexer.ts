// Farms indexer: enumerate every StakingRewards farm on every HookSwap chain via
// PURE RPC (StakingRewardsFactory.allFarms() → child views), read both tokens'
// metadata, price them via the shared pricing module, and produce normalized
// `Farm` entities + a `FarmsStats` aggregate. Refreshes on an interval; the latest
// snapshot is held in memory and served read-only by server.ts.
//
// Reuses the locker's chain config (RPC + Multicall3) and pricing.ts. Same
// discipline as the locker indexer:
//   FACTS ONLY — every value is a real on-chain read. USD/APR are OMITTED (never
//   fabricated) whenever a token has no honest price (only Robinhood resolves USD
//   today) or the farm has zero stake. A chain whose RPC fails does not crash the
//   cycle — it is marked stale and its last-known farms are retained.

import { createPublicClient, formatUnits, getAddress, http, type PublicClient } from "viem";
import { CHAINS, MULTICALL3, farmFactories, type ChainConfig } from "../chains.js";
import { ENV } from "../env.js";
import { priceUsdBatch } from "../pricing.js";
import { ERC20_META_ABI, STAKING_REWARDS_ABI, STAKING_REWARDS_FACTORY_ABI } from "./abi.js";

const SECONDS_PER_YEAR = 31_536_000n;
const ZERO = "0x0000000000000000000000000000000000000000";

// ----------------------------------------------------------------- entity types

export interface Amount {
  /** Base-unit integer as a decimal string (no precision loss). */
  raw: string;
  /** Human-readable amount (raw / 10**decimals). */
  formatted: string;
}

export interface FarmToken {
  addr: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface Farm {
  chainId: number;
  chainName: string;
  /** The StakingRewardsFactory that deployed this farm. */
  factory: `0x${string}`;
  /** The StakingRewards child contract address. */
  farm: `0x${string}`;
  stakingToken: FarmToken;
  rewardToken: FarmToken;
  /** totalSupply() — the staked balance (TVL in staking-token units). */
  tvlStaked: Amount;
  /** USD value of the staked total. Omitted when the staking token has no price. */
  tvlUsd?: number;
  /** rewardRate() — reward tokens streamed per SECOND over the active period. */
  rewardRatePerSec: Amount;
  /** rewardsDuration() — configured period length, seconds. */
  rewardsDuration: number;
  /** periodFinish() — unix seconds the current reward period ends. */
  periodFinish: number;
  /** max(0, periodFinish − now) × rewardRatePerSec — reward tokens still to stream. */
  rewardsRemaining: Amount;
  /** getRewardForDuration() — total reward budget for the period (= rate × duration). */
  rewardBudget: Amount;
  /** "active" while now < periodFinish, else "ended". */
  status: "active" | "ended";
  /** Annualized reward yield %, omitted when either USD price is missing or nothing is staked. */
  aprPct?: number;
}

export interface FarmChainStatus {
  chainId: number;
  name: string;
  /** Configured factories for this chain (possibly several). */
  factories: `0x${string}`[];
  rpcUrl: string;
  reachable: boolean;
  /** true when this cycle failed but prior data is being retained. */
  stale: boolean;
  error?: string;
  farmCount: number;
  activeFarmCount: number;
  tvlUsd?: number;
  lastIndexedAt: number | null; // ms epoch of last successful index
}

export interface FarmsStats {
  totalFarms: number;
  activeFarms: number;
  /** Sum of priced farm TVL. Omitted when nothing could be priced. */
  totalTvlUsd?: number;
  chains: number;
  reachableChains: number;
}

export interface FarmsSnapshot {
  generatedAt: number; // ms epoch
  stats: FarmsStats;
  chains: FarmChainStatus[];
  farms: Farm[];
}

// ------------------------------------------------------------ per-chain results

interface TokenMeta {
  symbol: string;
  decimals: number;
}

interface FarmChainResult {
  status: FarmChainStatus;
  farms: Farm[];
}

/** Raw on-chain reads for one farm (before token metadata / pricing). */
interface RawFarm {
  factory: `0x${string}`;
  farm: `0x${string}`;
  stakingToken: `0x${string}`;
  rewardsToken: `0x${string}`;
  totalSupply: bigint;
  rewardRate: bigint;
  rewardsDuration: bigint;
  periodFinish: bigint;
  rewardForDuration: bigint;
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

// The 7 child views read per farm, in fixed order (used to slice the multicall).
const FARM_VIEWS = [
  "stakingToken",
  "rewardsToken",
  "totalSupply",
  "rewardRate",
  "rewardsDuration",
  "periodFinish",
  "getRewardForDuration",
] as const;

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

/** Read one chain's farms fully. Throws on RPC failure (caller catches → marks stale). */
async function indexChainFarms(
  cfg: ChainConfig,
  factories: `0x${string}`[],
  nowSec: number,
): Promise<Farm[]> {
  const client: PublicClient = createPublicClient({ transport: http(cfg.rpcUrl) });

  // 1) allFarms() on EVERY configured factory; union the children (first factory
  //    to list a farm owns it). A factory that reverts is best-effort skipped —
  //    a total-chain RPC failure still throws below and marks the chain stale.
  const farmToFactory = new Map<string, `0x${string}`>();
  let anyFactorySucceeded = false;
  for (const factory of factories) {
    try {
      const list = (await client.readContract({
        address: factory,
        abi: STAKING_REWARDS_FACTORY_ABI,
        functionName: "allFarms",
      })) as readonly `0x${string}`[];
      anyFactorySucceeded = true;
      for (const f of list) {
        const key = f.toLowerCase();
        if (!farmToFactory.has(key)) farmToFactory.set(key, factory);
      }
    } catch (e) {
      // A single factory reverting (e.g. wrong ABI / self-destructed) shouldn't
      // hide the others. Re-throw only if NO factory has succeeded yet, so a dead
      // RPC surfaces as a stale chain rather than a silent empty set.
      if (!anyFactorySucceeded && factory === factories[factories.length - 1]) {
        throw e;
      }
    }
  }

  const farmAddrs = [...farmToFactory.keys()] as `0x${string}`[];
  if (farmAddrs.length === 0) return [];

  // 2) the 7 child views for every farm (chunked multicall, allowFailure).
  const perBatch = Math.max(1, Math.floor(ENV.batchSize / FARM_VIEWS.length));
  const raws: RawFarm[] = [];
  for (const ch of chunk(farmAddrs, perBatch)) {
    const contracts = ch.flatMap((farm) =>
      FARM_VIEWS.map((fn) => ({
        address: farm,
        abi: STAKING_REWARDS_ABI,
        functionName: fn,
      })),
    );
    const res = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts,
    });
    ch.forEach((farm, i) => {
      const base = i * FARM_VIEWS.length;
      const get = <T>(off: number, fallback: T): T => {
        const r = res[base + off];
        return r?.status === "success" && r.result != null ? (r.result as T) : fallback;
      };
      const stakingToken = get<`0x${string}`>(0, ZERO as `0x${string}`);
      const rewardsToken = get<`0x${string}`>(1, ZERO as `0x${string}`);
      // A farm whose core token reads reverted is dropped (can't be normalized honestly).
      if (stakingToken === ZERO || rewardsToken === ZERO) return;
      raws.push({
        factory: farmToFactory.get(farm.toLowerCase()) ?? (ZERO as `0x${string}`),
        farm,
        stakingToken,
        rewardsToken,
        totalSupply: BigInt(get<bigint | number | string>(2, 0)),
        rewardRate: BigInt(get<bigint | number | string>(3, 0)),
        rewardsDuration: BigInt(get<bigint | number | string>(4, 0)),
        periodFinish: BigInt(get<bigint | number | string>(5, 0)),
        rewardForDuration: BigInt(get<bigint | number | string>(6, 0)),
      });
    });
  }
  if (raws.length === 0) return [];

  // 3) token metadata (symbol/decimals) for every staking + reward token.
  const tokenSet = new Set<string>();
  for (const r of raws) {
    tokenSet.add(r.stakingToken.toLowerCase());
    tokenSet.add(r.rewardsToken.toLowerCase());
  }
  const tokenAddrs = [...tokenSet] as `0x${string}`[];
  const meta = await readTokenMeta(client, tokenAddrs);

  // 4) USD prices for every token (only Robinhood resolves; others → undefined).
  let prices = new Map<string, number | undefined>();
  try {
    prices = await priceUsdBatch(cfg.chainId, tokenAddrs);
  } catch {
    prices = new Map();
  }
  const priceOf = (t: `0x${string}`): number | undefined => prices.get(t.toLowerCase());
  const metaOf = (t: `0x${string}`): TokenMeta =>
    meta.get(t.toLowerCase()) ?? { symbol: shortAddr(t), decimals: 18 };

  // 5) normalize.
  const nowBig = BigInt(nowSec);
  const farms: Farm[] = raws.map((r) => {
    const sm = metaOf(r.stakingToken);
    const rm = metaOf(r.rewardsToken);
    const stakeUsd = priceOf(r.stakingToken);
    const rewardUsd = priceOf(r.rewardsToken);

    const secsLeft = r.periodFinish > nowBig ? r.periodFinish - nowBig : 0n;
    const rewardsRemainingRaw = secsLeft * r.rewardRate;

    const stakedHuman = Number(formatUnits(r.totalSupply, sm.decimals));
    const rewardRateHuman = Number(formatUnits(r.rewardRate, rm.decimals));

    // TVL-USD: honest only when the staking token prices (Robinhood-only today).
    const tvlUsd =
      stakeUsd !== undefined && Number.isFinite(stakeUsd)
        ? stakedHuman * stakeUsd
        : undefined;

    // APR = rewardRate/sec × rewardUsd × secondsPerYear ÷ (stakedHuman × stakeUsd).
    // Omitted unless BOTH prices exist AND there is stake to divide by (no fake APR).
    let aprPct: number | undefined;
    if (
      stakeUsd !== undefined &&
      rewardUsd !== undefined &&
      stakeUsd > 0 &&
      stakedHuman > 0 &&
      Number.isFinite(rewardRateHuman)
    ) {
      const yearlyRewardUsd = rewardRateHuman * rewardUsd * Number(SECONDS_PER_YEAR);
      const stakedUsd = stakedHuman * stakeUsd;
      const apr = (yearlyRewardUsd / stakedUsd) * 100;
      if (Number.isFinite(apr) && apr >= 0) aprPct = apr;
    }

    const farm: Farm = {
      chainId: cfg.chainId,
      chainName: cfg.name,
      factory: safeAddr(r.factory),
      farm: safeAddr(r.farm),
      stakingToken: { addr: safeAddr(r.stakingToken), symbol: sm.symbol, decimals: sm.decimals },
      rewardToken: { addr: safeAddr(r.rewardsToken), symbol: rm.symbol, decimals: rm.decimals },
      tvlStaked: amt(r.totalSupply, sm.decimals),
      rewardRatePerSec: amt(r.rewardRate, rm.decimals),
      rewardsDuration: Number(r.rewardsDuration),
      periodFinish: Number(r.periodFinish),
      rewardsRemaining: amt(rewardsRemainingRaw, rm.decimals),
      rewardBudget: amt(r.rewardForDuration, rm.decimals),
      status: r.periodFinish > nowBig ? "active" : "ended",
    };
    if (tvlUsd !== undefined) farm.tvlUsd = tvlUsd;
    if (aprPct !== undefined) farm.aprPct = aprPct;
    return farm;
  });

  return farms;
}

// -------------------------------------------------------------- aggregation

function buildFarmsStats(farms: Farm[], chains: FarmChainStatus[]): FarmsStats {
  let active = 0;
  let tvl = 0;
  let anyPriced = false;
  for (const f of farms) {
    if (f.status === "active") active += 1;
    if (f.tvlUsd !== undefined) {
      tvl += f.tvlUsd;
      anyPriced = true;
    }
  }
  return {
    totalFarms: farms.length,
    activeFarms: active,
    totalTvlUsd: anyPriced ? tvl : undefined,
    chains: chains.length,
    reachableChains: chains.filter((c) => c.reachable).length,
  };
}

// ----------------------------------------------------------------- the indexer

export class FarmsIndexer {
  /** Last result per chain (retained across cycles so a stale chain keeps its data). */
  private byChain = new Map<number, FarmChainResult>();
  private snapshot: FarmsSnapshot;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  /** Chains that actually have a configured factory (the only ones we index/report). */
  private readonly targets: { cfg: ChainConfig; factories: `0x${string}`[] }[] = CHAINS.map(
    (cfg) => ({ cfg, factories: farmFactories(cfg.chainId) }),
  ).filter((t) => t.factories.length > 0);

  constructor() {
    const chains: FarmChainStatus[] = this.targets.map(({ cfg, factories }) => ({
      chainId: cfg.chainId,
      name: cfg.name,
      factories,
      rpcUrl: cfg.rpcUrl,
      reachable: false,
      stale: false,
      farmCount: 0,
      activeFarmCount: 0,
      lastIndexedAt: null,
    }));
    this.snapshot = {
      generatedAt: Date.now(),
      stats: buildFarmsStats([], chains),
      chains,
      farms: [],
    };
  }

  getSnapshot(): FarmsSnapshot {
    return this.snapshot;
  }

  /** Run one full cross-chain refresh. Never throws (per-chain errors are contained). */
  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      await Promise.all(
        this.targets.map(async ({ cfg, factories }) => {
          try {
            const farms = await withTimeout(
              indexChainFarms(cfg, factories, nowSec),
              ENV.chainTimeoutMs,
              `${cfg.name} farms index`,
            );
            const tvl = farms.reduce((s, f) => s + (f.tvlUsd ?? 0), 0);
            const hasTvl = farms.some((f) => f.tvlUsd !== undefined);
            this.byChain.set(cfg.chainId, {
              farms,
              status: {
                chainId: cfg.chainId,
                name: cfg.name,
                factories,
                rpcUrl: cfg.rpcUrl,
                reachable: true,
                stale: false,
                farmCount: farms.length,
                activeFarmCount: farms.filter((f) => f.status === "active").length,
                tvlUsd: hasTvl ? tvl : undefined,
                lastIndexedAt: Date.now(),
              },
            });
          } catch (e) {
            const prev = this.byChain.get(cfg.chainId);
            const msg = (e as Error).message || "rpc error";
            console.warn(`[farms] ${cfg.name} (${cfg.chainId}) failed: ${msg}`);
            this.byChain.set(cfg.chainId, {
              farms: prev?.farms ?? [],
              status: {
                chainId: cfg.chainId,
                name: cfg.name,
                factories,
                rpcUrl: cfg.rpcUrl,
                reachable: false,
                stale: Boolean(prev?.farms?.length),
                error: msg,
                farmCount: prev?.farms?.length ?? 0,
                activeFarmCount: prev?.status.activeFarmCount ?? 0,
                tvlUsd: prev?.status.tvlUsd,
                lastIndexedAt: prev?.status.lastIndexedAt ?? null,
              },
            });
          }
        }),
      );

      const chains = this.targets.map(
        ({ cfg, factories }) =>
          this.byChain.get(cfg.chainId)?.status ?? {
            chainId: cfg.chainId,
            name: cfg.name,
            factories,
            rpcUrl: cfg.rpcUrl,
            reachable: false,
            stale: false,
            farmCount: 0,
            activeFarmCount: 0,
            lastIndexedAt: null,
          },
      );
      const farms = this.targets.flatMap(({ cfg }) => this.byChain.get(cfg.chainId)?.farms ?? []);

      this.snapshot = {
        generatedAt: Date.now(),
        stats: buildFarmsStats(farms, chains),
        chains,
        farms,
      };
    } finally {
      this.running = false;
    }
  }

  /** Start the refresh loop (runs one immediately, then every ENV.refreshMs). */
  start(onCycle?: (snap: FarmsSnapshot) => void): void {
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
