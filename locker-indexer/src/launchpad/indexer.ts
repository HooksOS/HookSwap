// Launchpad indexer: enumerate every HookOSV3Launcher launch on every HookSwap
// chain that has a launcher configured (Robinhood-only today), via PURE RPC. For
// each chain:
//   1) launchCount() → N,
//   2) getLaunch(id) for ids 0..N-1 (chunked multicall) → the launch struct,
//   3) name()/symbol()/decimals()/totalSupply() on each launch token (the struct
//      carries neither name nor symbol),
//   4) FeeVault.isPermanentlyLocked(token) → LP-lock flag,
//   5) USD price via the shared pricing module (Robinhood-only) → marketCapUsd.
// Produces normalized `Launch` entities + a `LaunchpadStats` aggregate.
//
// Reuses the locker's chain config (RPC + Multicall3) and pricing.ts. Same
// discipline as the farms indexer:
//   FACTS ONLY — every value is a real on-chain read. `marketCapUsd` / `valueUsd`
//   are OMITTED (never fabricated) whenever the launch token has no honest price
//   (only Robinhood resolves USD today). A chain whose RPC fails does not crash the
//   cycle — it is marked stale and its last-known launches are retained. A chain
//   with no configured launcher honestly reports zero launches (never invented).

import { createPublicClient, formatUnits, getAddress, http, type PublicClient } from "viem";
import { CHAINS, MULTICALL3, launchpadConfig, type ChainConfig } from "../chains.js";
import { ENV } from "../env.js";
import { priceUsdBatch } from "../pricing.js";
import { ERC20_FULL_ABI, FEEVAULT_ABI, LAUNCHER_ABI } from "./abi.js";

const ZERO = "0x0000000000000000000000000000000000000000";

// ----------------------------------------------------------------- entity types

export interface Amount {
  /** Base-unit integer as a decimal string (no precision loss). */
  raw: string;
  /** Human-readable amount (raw / 10**decimals). */
  formatted: string;
}

export interface LaunchToken {
  addr: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: Amount;
}

export interface Launch {
  chainId: number;
  chainName: string;
  /** Launch id in the launcher's registry (0-based). */
  id: number;
  token: LaunchToken;
  /** The seeded v3 pool address. */
  pool: `0x${string}`;
  creator: `0x${string}`;
  /** The pool position-manager NFT id the launch minted. */
  tokenId: string;
  /** v3 fee tier (e.g. 3000 = 0.3%). */
  feeTier: number;
  /** DEX enum index the launch seeded on. */
  dex: number;
  /** The pair enum index the launch quoted against. */
  pair: number;
  pairToken: `0x${string}`;
  metadataURI: string;
  /** Unix seconds the launch was created. */
  createdAt: number;
  /** FeeVault.isPermanentlyLocked(token).locked — LP principal locked forever. Omitted if unreadable. */
  lpLocked?: boolean;
  /** unlockTime from isPermanentlyLocked (0 when permanently locked). Omitted if unreadable. */
  lpUnlockTime?: number;
  /** totalSupply × USD price. Omitted when the token has no honest price. */
  marketCapUsd?: number;
}

export interface LaunchpadChainStatus {
  chainId: number;
  name: string;
  launcher: `0x${string}`;
  feeVault: `0x${string}`;
  rpcUrl: string;
  reachable: boolean;
  /** true when this cycle failed but prior data is being retained. */
  stale: boolean;
  error?: string;
  launchCount: number;
  lastIndexedAt: number | null; // ms epoch of last successful index
}

export interface LaunchpadStats {
  totalLaunches: number;
  /** Launches whose LP is permanently locked (from the FeeVault). */
  lpLockedLaunches: number;
  /** Sum of priced launch market caps. Omitted when nothing could be priced. */
  totalMarketCapUsd?: number;
  chains: number;
  reachableChains: number;
}

export interface LaunchpadSnapshot {
  generatedAt: number; // ms epoch
  stats: LaunchpadStats;
  chains: LaunchpadChainStatus[];
  launches: Launch[];
}

// ------------------------------------------------------------ per-chain results

interface TokenMeta {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
}

interface LaunchpadChainResult {
  status: LaunchpadChainStatus;
  launches: Launch[];
}

/** Raw on-chain launch struct (before token enrichment / lock / pricing). */
interface RawLaunch {
  id: number;
  token: `0x${string}`;
  pool: `0x${string}`;
  creator: `0x${string}`;
  tokenId: bigint;
  feeTier: number;
  dex: number;
  pair: number;
  pairToken: `0x${string}`;
  metadataURI: string;
  createdAt: bigint;
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

/** name/symbol/decimals/totalSupply for a set of tokens (tolerant of missing/reverting). */
async function readTokenMeta(
  client: PublicClient,
  tokens: `0x${string}`[],
): Promise<Map<string, TokenMeta>> {
  const out = new Map<string, TokenMeta>();
  if (tokens.length === 0) return out;
  const perToken = 4;
  const perBatch = Math.max(1, Math.floor(ENV.batchSize / perToken));
  for (const ch of chunk(tokens, perBatch)) {
    const contracts = ch.flatMap((t) => [
      { address: t, abi: ERC20_FULL_ABI, functionName: "name" as const },
      { address: t, abi: ERC20_FULL_ABI, functionName: "symbol" as const },
      { address: t, abi: ERC20_FULL_ABI, functionName: "decimals" as const },
      { address: t, abi: ERC20_FULL_ABI, functionName: "totalSupply" as const },
    ]);
    const res = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts,
    });
    ch.forEach((t, i) => {
      const base = i * perToken;
      const nr = res[base];
      const sr = res[base + 1];
      const dr = res[base + 2];
      const tsr = res[base + 3];
      const name =
        nr?.status === "success" && typeof nr.result === "string" && nr.result.length
          ? (nr.result as string)
          : shortAddr(t);
      const symbol =
        sr?.status === "success" && typeof sr.result === "string" && sr.result.length
          ? (sr.result as string)
          : shortAddr(t);
      const decimals =
        dr?.status === "success" && dr.result != null ? Number(dr.result as number | bigint) : 18;
      const totalSupply = tsr?.status === "success" && tsr.result != null ? toBig(tsr.result) : 0n;
      out.set(t.toLowerCase(), {
        name,
        symbol,
        decimals: Number.isFinite(decimals) ? decimals : 18,
        totalSupply,
      });
    });
  }
  return out;
}

/** Read one chain's launches fully. Throws on RPC failure (caller catches → stale). */
async function indexChainLaunches(
  cfg: ChainConfig,
  launcher: `0x${string}`,
  feeVault: `0x${string}`,
): Promise<Launch[]> {
  const client: PublicClient = createPublicClient({ transport: http(cfg.rpcUrl) });

  // 1) launchCount() — throws on a dead RPC (→ chain marked stale by caller).
  const count = (await client.readContract({
    address: launcher,
    abi: LAUNCHER_ABI,
    functionName: "launchCount",
  })) as bigint;
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return [];

  // 2) getLaunch(id) for ids 0..n-1 (chunked multicall, allowFailure).
  const ids = Array.from({ length: n }, (_v, i) => i);
  const raws: RawLaunch[] = [];
  for (const ch of chunk(ids, ENV.batchSize)) {
    const contracts = ch.map((id) => ({
      address: launcher,
      abi: LAUNCHER_ABI,
      functionName: "getLaunch" as const,
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
      // Single tuple output with named components → viem returns an object.
      const s = r.result as {
        token: string;
        pool: string;
        creator: string;
        tokenId: bigint;
        feeTier: number | bigint;
        dex: number | bigint;
        locker: string;
        pair: number | bigint;
        pairToken: string;
        metadataURI: string;
        createdAt: bigint;
      };
      const token = safeAddr(s.token);
      if (token === ZERO) return; // unreadable launch → dropped (can't normalize honestly)
      raws.push({
        id,
        token,
        pool: safeAddr(s.pool),
        creator: safeAddr(s.creator),
        tokenId: toBig(s.tokenId),
        feeTier: Number(s.feeTier ?? 0),
        dex: Number(s.dex ?? 0),
        pair: Number(s.pair ?? 0),
        pairToken: safeAddr(s.pairToken),
        metadataURI: typeof s.metadataURI === "string" ? s.metadataURI : "",
        createdAt: toBig(s.createdAt),
      });
    });
  }
  if (raws.length === 0) return [];

  // 3) token metadata (name/symbol/decimals/totalSupply) for every launch token.
  const tokenAddrs = [...new Set(raws.map((r) => r.token.toLowerCase()))] as `0x${string}`[];
  const meta = await readTokenMeta(client, tokenAddrs);

  // 4) FeeVault.isPermanentlyLocked(token) for every launch token (best-effort).
  const lockByToken = new Map<string, { locked: boolean; unlockTime: number }>();
  if (feeVault !== ZERO) {
    for (const ch of chunk(tokenAddrs, ENV.batchSize)) {
      const contracts = ch.map((t) => ({
        address: feeVault,
        abi: FEEVAULT_ABI,
        functionName: "isPermanentlyLocked" as const,
        args: [t] as const,
      }));
      const res = await client.multicall({
        multicallAddress: MULTICALL3,
        allowFailure: true,
        contracts,
      });
      ch.forEach((t, i) => {
        const rr = res[i];
        if (rr?.status === "success" && Array.isArray(rr.result)) {
          const [locked, unlockTime] = rr.result as readonly [boolean, bigint | number];
          lockByToken.set(t.toLowerCase(), {
            locked: Boolean(locked),
            unlockTime: Number(unlockTime ?? 0),
          });
        }
      });
    }
  }

  // 5) USD prices for every launch token (only Robinhood resolves; others → undefined).
  let prices = new Map<string, number | undefined>();
  try {
    prices = await priceUsdBatch(cfg.chainId, tokenAddrs);
  } catch {
    prices = new Map();
  }
  const priceOf = (t: `0x${string}`): number | undefined => prices.get(t.toLowerCase());
  const metaOf = (t: `0x${string}`): TokenMeta =>
    meta.get(t.toLowerCase()) ?? {
      name: shortAddr(t),
      symbol: shortAddr(t),
      decimals: 18,
      totalSupply: 0n,
    };

  // 6) normalize.
  const launches: Launch[] = raws.map((r) => {
    const m = metaOf(r.token);
    const lock = lockByToken.get(r.token.toLowerCase());
    const price = priceOf(r.token);
    const supplyHuman = Number(formatUnits(m.totalSupply, m.decimals));
    const marketCapUsd =
      price !== undefined && Number.isFinite(price) ? supplyHuman * price : undefined;

    const launch: Launch = {
      chainId: cfg.chainId,
      chainName: cfg.name,
      id: r.id,
      token: {
        addr: safeAddr(r.token),
        name: m.name,
        symbol: m.symbol,
        decimals: m.decimals,
        totalSupply: amt(m.totalSupply, m.decimals),
      },
      pool: safeAddr(r.pool),
      creator: safeAddr(r.creator),
      tokenId: r.tokenId.toString(),
      feeTier: r.feeTier,
      dex: r.dex,
      pair: r.pair,
      pairToken: safeAddr(r.pairToken),
      metadataURI: r.metadataURI,
      createdAt: Number(r.createdAt),
    };
    if (lock) {
      launch.lpLocked = lock.locked;
      launch.lpUnlockTime = lock.unlockTime;
    }
    if (marketCapUsd !== undefined) launch.marketCapUsd = marketCapUsd;
    return launch;
  });

  return launches;
}

// -------------------------------------------------------------- aggregation

function buildLaunchpadStats(
  launches: Launch[],
  chains: LaunchpadChainStatus[],
): LaunchpadStats {
  let lpLocked = 0;
  let mcap = 0;
  let anyPriced = false;
  for (const l of launches) {
    if (l.lpLocked) lpLocked += 1;
    if (l.marketCapUsd !== undefined) {
      mcap += l.marketCapUsd;
      anyPriced = true;
    }
  }
  return {
    totalLaunches: launches.length,
    lpLockedLaunches: lpLocked,
    totalMarketCapUsd: anyPriced ? mcap : undefined,
    chains: chains.length,
    reachableChains: chains.filter((c) => c.reachable).length,
  };
}

// ----------------------------------------------------------------- the indexer

export class LaunchpadIndexer {
  /** Last result per chain (retained across cycles so a stale chain keeps its data). */
  private byChain = new Map<number, LaunchpadChainResult>();
  private snapshot: LaunchpadSnapshot;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  /** Chains that actually have a configured launcher (the only ones we index/report). */
  private readonly targets: {
    cfg: ChainConfig;
    launcher: `0x${string}`;
    feeVault: `0x${string}`;
  }[] = CHAINS.map((cfg) => {
    const c = launchpadConfig(cfg.chainId);
    return c ? { cfg, launcher: c.launcher, feeVault: c.feeVault } : undefined;
  }).filter(
    (t): t is { cfg: ChainConfig; launcher: `0x${string}`; feeVault: `0x${string}` } =>
      t !== undefined,
  );

  constructor() {
    const chains: LaunchpadChainStatus[] = this.targets.map(({ cfg, launcher, feeVault }) => ({
      chainId: cfg.chainId,
      name: cfg.name,
      launcher,
      feeVault,
      rpcUrl: cfg.rpcUrl,
      reachable: false,
      stale: false,
      launchCount: 0,
      lastIndexedAt: null,
    }));
    this.snapshot = {
      generatedAt: Date.now(),
      stats: buildLaunchpadStats([], chains),
      chains,
      launches: [],
    };
  }

  getSnapshot(): LaunchpadSnapshot {
    return this.snapshot;
  }

  /** Run one full cross-chain refresh. Never throws (per-chain errors are contained). */
  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.all(
        this.targets.map(async ({ cfg, launcher, feeVault }) => {
          try {
            const launches = await withTimeout(
              indexChainLaunches(cfg, launcher, feeVault),
              ENV.chainTimeoutMs,
              `${cfg.name} launchpad index`,
            );
            this.byChain.set(cfg.chainId, {
              launches,
              status: {
                chainId: cfg.chainId,
                name: cfg.name,
                launcher,
                feeVault,
                rpcUrl: cfg.rpcUrl,
                reachable: true,
                stale: false,
                launchCount: launches.length,
                lastIndexedAt: Date.now(),
              },
            });
          } catch (e) {
            const prev = this.byChain.get(cfg.chainId);
            const msg = (e as Error).message || "rpc error";
            console.warn(`[launchpad] ${cfg.name} (${cfg.chainId}) failed: ${msg}`);
            this.byChain.set(cfg.chainId, {
              launches: prev?.launches ?? [],
              status: {
                chainId: cfg.chainId,
                name: cfg.name,
                launcher,
                feeVault,
                rpcUrl: cfg.rpcUrl,
                reachable: false,
                stale: Boolean(prev?.launches?.length),
                error: msg,
                launchCount: prev?.launches?.length ?? 0,
                lastIndexedAt: prev?.status.lastIndexedAt ?? null,
              },
            });
          }
        }),
      );

      const chains = this.targets.map(
        ({ cfg, launcher, feeVault }) =>
          this.byChain.get(cfg.chainId)?.status ?? {
            chainId: cfg.chainId,
            name: cfg.name,
            launcher,
            feeVault,
            rpcUrl: cfg.rpcUrl,
            reachable: false,
            stale: false,
            launchCount: 0,
            lastIndexedAt: null,
          },
      );
      const launches = this.targets.flatMap(
        ({ cfg }) => this.byChain.get(cfg.chainId)?.launches ?? [],
      );

      this.snapshot = {
        generatedAt: Date.now(),
        stats: buildLaunchpadStats(launches, chains),
        chains,
        launches,
      };
    } finally {
      this.running = false;
    }
  }

  /** Start the refresh loop (runs one immediately, then every ENV.refreshMs). */
  start(onCycle?: (snap: LaunchpadSnapshot) => void): void {
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
