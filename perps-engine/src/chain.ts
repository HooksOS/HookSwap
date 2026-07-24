// Per-chain viem client registry + on-chain reads (MarketRegistry enumeration,
// nonces, balances, positions) and the per-chain matcher wallet used for settleBatch.
//
// MULTI-CHAIN: instead of module-level singletons bound to one RPC, every chain in
// ENV.chains gets a ChainCtx { publicClient, walletClient, matcherAccount,
// marketRegistry, oracleGuard, gasMode }. getChainCtx(chainId) resolves the ctx; a
// market's chainId comes from its MarketRegistry (fetchAllMarkets tags each market).
// Every settlement/read helper takes a chainId and uses THAT chain's clients.

import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ENV, type ChainConfig, type GasMode } from "./env.js";
import { MARKET_REGISTRY_ABI, ORACLE_GUARD_ABI, PERP_MARKET_ABI } from "./abis.js";
import type { MarketMeta, Order } from "./types.js";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/** Everything needed to read + settle on a single chain. */
export interface ChainCtx {
  chainId: number;
  network?: string;
  publicClient: PublicClient;
  /** Null when this chain has no matcher key configured (settle disabled for it). */
  matcherAccount: Account | null;
  walletClient: WalletClient | null;
  marketRegistry: `0x${string}`;
  oracleGuard: `0x${string}`;
  gasMode: GasMode;
}

function buildCtx(cfg: ChainConfig): ChainCtx {
  const publicClient: PublicClient = createPublicClient({ transport: http(cfg.rpcUrl) });
  const matcherAccount: Account | null = cfg.matcherKey ? privateKeyToAccount(cfg.matcherKey) : null;
  const walletClient: WalletClient | null = matcherAccount
    ? createWalletClient({ account: matcherAccount, transport: http(cfg.rpcUrl) })
    : null;
  return {
    chainId: cfg.chainId,
    network: cfg.network,
    publicClient,
    matcherAccount,
    walletClient,
    marketRegistry: cfg.marketRegistry,
    oracleGuard: cfg.oracleGuard,
    gasMode: cfg.gasMode,
  };
}

// One ctx per configured chain, built once at module load.
const REGISTRY = new Map<number, ChainCtx>(ENV.chains.map((c) => [c.chainId, buildCtx(c)]));

/** All configured chain contexts. */
export function allChainCtx(): ChainCtx[] {
  return [...REGISTRY.values()];
}

/** Resolve a chain's ctx, or throw if the chainId is not configured. */
export function getChainCtx(chainId: number): ChainCtx {
  const ctx = REGISTRY.get(chainId);
  if (!ctx) throw new Error(`chainId ${chainId} is not configured (add it to config/chains.json)`);
  return ctx;
}

/** The configured matcher address for a chain, or null when settle is disabled there. */
export function matcherAddressFor(chainId: number): `0x${string}` | null {
  return REGISTRY.get(chainId)?.matcherAccount?.address ?? null;
}

/** Enumerate all markets from ONE chain's registry (paginated read), tagged with chainId. */
async function fetchMarketsForChain(ctx: ChainCtx): Promise<MarketMeta[]> {
  const { publicClient, marketRegistry, chainId } = ctx;
  const count = (await publicClient.readContract({
    address: marketRegistry,
    abi: MARKET_REGISTRY_ABI,
    functionName: "marketCount",
  })) as bigint;

  if (count === 0n) return [];

  const rows = (await publicClient.readContract({
    address: marketRegistry,
    abi: MARKET_REGISTRY_ABI,
    functionName: "getMarkets",
    args: [0n, count],
  })) as ReadonlyArray<{
    market: `0x${string}`;
    creator: `0x${string}`;
    collateral: `0x${string}`;
    marketId: `0x${string}`;
    tier: number;
    status: number;
    createdAt: bigint;
  }>;

  const out: MarketMeta[] = [];
  for (const r of rows) {
    let marketMaxLeverage = 0n;
    let maxLeverageAbs = 100n * 10_000n; // MAX_LEVERAGE fallback (100x * 1e4)
    try {
      [marketMaxLeverage, maxLeverageAbs] = (await Promise.all([
        publicClient.readContract({
          address: r.market,
          abi: PERP_MARKET_ABI,
          functionName: "marketMaxLeverage",
        }),
        publicClient.readContract({
          address: r.market,
          abi: PERP_MARKET_ABI,
          functionName: "MAX_LEVERAGE",
        }),
      ])) as [bigint, bigint];
    } catch {
      /* keep fallbacks if a clone predates these getters */
    }
    out.push({
      chainId,
      market: r.market,
      marketId: r.marketId,
      collateral: r.collateral,
      tier: r.tier,
      status: r.status,
      marketMaxLeverage,
      maxLeverageAbs,
    });
  }
  return out;
}

/**
 * Enumerate markets from EVERY configured chain's registry, tagging each with its
 * chainId. A single chain's RPC failure is logged and skipped so one bad chain
 * never blocks the others.
 */
export async function fetchAllMarkets(): Promise<MarketMeta[]> {
  const results = await Promise.all(
    allChainCtx().map(async (ctx) => {
      try {
        return await fetchMarketsForChain(ctx);
      } catch (e: any) {
        console.error(`[chain ${ctx.chainId}] market fetch failed:`, e?.shortMessage || e?.message || e);
        return [] as MarketMeta[];
      }
    }),
  );
  return results.flat();
}

/** On-chain sequential nonce for a trader on a market (settle reverts on mismatch). */
export async function onchainNonce(
  chainId: number,
  market: `0x${string}`,
  trader: `0x${string}`,
): Promise<bigint> {
  return (await getChainCtx(chainId).publicClient.readContract({
    address: market,
    abi: PERP_MARKET_ABI,
    functionName: "nonces",
    args: [trader],
  })) as bigint;
}

export async function userBalance(
  chainId: number,
  market: `0x${string}`,
  trader: `0x${string}`,
): Promise<{ available: bigint; locked: bigint }> {
  const [available, locked] = (await getChainCtx(chainId).publicClient.readContract({
    address: market,
    abi: PERP_MARKET_ABI,
    functionName: "getUserBalance",
    args: [trader],
  })) as [bigint, bigint];
  return { available, locked };
}

export async function isAuthorizedMatcher(
  chainId: number,
  market: `0x${string}`,
  who: `0x${string}`,
): Promise<boolean> {
  return (await getChainCtx(chainId).publicClient.readContract({
    address: market,
    abi: PERP_MARKET_ABI,
    functionName: "authorizedMatchers",
    args: [who],
  })) as boolean;
}

export interface OnchainPosition {
  pairId: string;
  longTrader: `0x${string}`;
  shortTrader: `0x${string}`;
  token: `0x${string}`;
  size: string;
  entryPrice: string;
  longCollateral: string;
  shortCollateral: string;
  longLeverage: string;
  shortLeverage: string;
  openTime: string;
  status: number; // 0 ACTIVE, 1 CLOSED, 2 LIQUIDATED
}

/** Read a trader's on-chain PairedPositions from a market. */
export async function fetchPositions(
  chainId: number,
  market: `0x${string}`,
  trader: `0x${string}`,
): Promise<OnchainPosition[]> {
  const publicClient = getChainCtx(chainId).publicClient;
  const pairIds = (await publicClient.readContract({
    address: market,
    abi: PERP_MARKET_ABI,
    functionName: "getUserPairIds",
    args: [trader],
  })) as bigint[];

  const positions = await Promise.all(
    pairIds.map((id) =>
      publicClient.readContract({
        address: market,
        abi: PERP_MARKET_ABI,
        functionName: "getPairedPosition",
        args: [id],
      }),
    ),
  );

  return positions.map((p: any) => ({
    pairId: p.pairId.toString(),
    longTrader: p.longTrader,
    shortTrader: p.shortTrader,
    token: p.token,
    size: p.size.toString(),
    entryPrice: p.entryPrice.toString(),
    longCollateral: p.longCollateral.toString(),
    shortCollateral: p.shortCollateral.toString(),
    longLeverage: p.longLeverage.toString(),
    shortLeverage: p.shortLeverage.toString(),
    openTime: p.openTime.toString(),
    status: Number(p.status),
  }));
}

/**
 * Read a market's Chainlink reference feed from its chain's OracleGuard.getMarketConfig.
 * Returns the feed address, or null when the market has no refFeed (0x0) or the read
 * fails. This is the SAME feed the on-chain deviation breaker enforces, so using it as
 * the mark source keeps the engine mark in lock-step with the guard.
 */
export async function fetchMarketRefFeed(
  chainId: number,
  market: `0x${string}`,
): Promise<`0x${string}` | null> {
  try {
    const ctx = getChainCtx(chainId);
    const cfg = (await ctx.publicClient.readContract({
      address: ctx.oracleGuard,
      abi: ORACLE_GUARD_ABI,
      functionName: "getMarketConfig",
      args: [market],
    })) as { refFeed: `0x${string}` };
    if (!cfg?.refFeed || cfg.refFeed.toLowerCase() === ZERO_ADDR) return null;
    return cfg.refFeed;
  } catch {
    return null;
  }
}

/**
 * Open interest = the sum of ACTIVE PairedPosition sizes on-chain. Enumerates
 * pair ids [0, nextPairId] via multicall (allowFailure) and sums `size` where
 * status == 0 (ACTIVE). Returns null when it cannot be read. A best-effort cap
 * bounds the read for pathological markets; nascent markets are tiny.
 */
const OI_ID_CAP = 5_000n;
// Canonical Multicall3 (same address on Sepolia + every HookSwap chain). Passed
// explicitly because publicClient is created without a `chain` (transport only).
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
export async function fetchOpenInterest(
  chainId: number,
  market: `0x${string}`,
): Promise<bigint | null> {
  try {
    const publicClient = getChainCtx(chainId).publicClient;
    const next = (await publicClient.readContract({
      address: market,
      abi: PERP_MARKET_ABI,
      functionName: "nextPairId",
    })) as bigint;
    if (next <= 0n) return 0n;
    const last = next > OI_ID_CAP ? OI_ID_CAP : next;
    const calls = [] as { address: `0x${string}`; abi: typeof PERP_MARKET_ABI; functionName: "getPairedPosition"; args: [bigint] }[];
    for (let id = 0n; id <= last; id++) {
      calls.push({ address: market, abi: PERP_MARKET_ABI, functionName: "getPairedPosition", args: [id] });
    }
    const results = await publicClient.multicall({
      contracts: calls,
      allowFailure: true,
      multicallAddress: MULTICALL3,
    });
    let oi = 0n;
    for (const r of results) {
      if (r.status !== "success" || !r.result) continue;
      const p = r.result as { size: bigint; status: number };
      if (Number(p.status) === 0 && p.size > 0n) oi += p.size;
    }
    return oi;
  } catch {
    return null;
  }
}

export async function orderHashOnchain(
  chainId: number,
  market: `0x${string}`,
  order: Order,
): Promise<`0x${string}`> {
  return (await getChainCtx(chainId).publicClient.readContract({
    address: market,
    abi: PERP_MARKET_ABI,
    functionName: "getOrderHash",
    args: [order as any],
  })) as `0x${string}`;
}
