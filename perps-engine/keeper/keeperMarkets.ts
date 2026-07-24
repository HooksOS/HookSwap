// Market enumeration, reference-feed resolution, mark computation, and active-
// position scanning — the read layer both keepers share. PER-CHAIN.
//
// Every read takes a chainId and runs against that chain's client (via read()).
// fetchAllMarkets enumerates EVERY configured chain's registry, tagging each market
// with its chainId; the keepers then thread that chainId through every call.

import { getAddress } from "viem";
import {
  CHAINLINK_ABI,
  MARKET_REGISTRY_ABI,
  ORACLE_GUARD_ABI,
  PERP_MARKET_ABI,
  type OnchainPosition,
} from "./keeperAbi.js";
import { CFG, allKeeperChains, getKeeperCtx, read } from "./keeperChain.js";

const ZERO = "0x0000000000000000000000000000000000000000";

export interface KeeperMarket {
  chainId: number;
  market: `0x${string}`;
  collateral: `0x${string}`;
  status: number;
}

/** Enumerate markets from ONE chain's registry, honoring the optional allowlist. */
async function fetchMarketsForChain(chainId: number, allow: Set<string> | null): Promise<KeeperMarket[]> {
  const registry = getKeeperCtx(chainId).marketRegistry;
  const count = (await read(chainId, (c) =>
    c.readContract({ address: registry, abi: MARKET_REGISTRY_ABI, functionName: "marketCount" }),
  )) as bigint;
  if (count === 0n) return [];

  const rows = (await read(chainId, (c) =>
    c.readContract({ address: registry, abi: MARKET_REGISTRY_ABI, functionName: "getMarkets", args: [0n, count] }),
  )) as ReadonlyArray<{ market: `0x${string}`; collateral: `0x${string}`; status: number }>;

  const out: KeeperMarket[] = [];
  for (const r of rows) {
    if (allow && !allow.has(r.market.toLowerCase())) continue;
    out.push({ chainId, market: getAddress(r.market), collateral: getAddress(r.collateral), status: Number(r.status) });
  }
  return out;
}

/** Enumerate markets from EVERY configured chain's registry (tagged with chainId). */
export async function fetchAllMarkets(): Promise<KeeperMarket[]> {
  const allow = CFG.onlyMarkets
    ? new Set(
        CFG.onlyMarkets
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((a) => a.toLowerCase()),
      )
    : null;

  const results = await Promise.all(
    allKeeperChains().map(async (ctx) => {
      try {
        return await fetchMarketsForChain(ctx.chainId, allow);
      } catch {
        return [] as KeeperMarket[];
      }
    }),
  );
  return results.flat();
}

// refFeed cache keyed by chainId:market (addresses could theoretically repeat across chains).
const refFeedCache = new Map<string, `0x${string}` | null>();

/** The market's Chainlink reference feed (from its chain's OracleGuard), cached. */
export async function refFeedFor(chainId: number, market: `0x${string}`): Promise<`0x${string}` | null> {
  const k = `${chainId}:${market.toLowerCase()}`;
  if (refFeedCache.has(k)) return refFeedCache.get(k)!;
  const oracleGuard = getKeeperCtx(chainId).oracleGuard;
  let feed: `0x${string}` | null = null;
  try {
    const cfg = (await read(chainId, (c) =>
      c.readContract({ address: oracleGuard, abi: ORACLE_GUARD_ABI, functionName: "getMarketConfig", args: [market] }),
    )) as { refFeed: `0x${string}` };
    if (cfg?.refFeed && cfg.refFeed.toLowerCase() !== ZERO) feed = getAddress(cfg.refFeed);
  } catch {
    feed = null;
  }
  refFeedCache.set(k, feed);
  return feed;
}

export interface MarkResult {
  price1e18: bigint;
  ok: boolean;
  reason: string;
}

/**
 * Chainlink-derived mark for a feed on `chainId`, scaled to 1e18. Enforces staleness.
 * Returns ok:false on any failure — never a fabricated price. Equals the on-chain
 * OracleGuard reference, so a mark written from it passes checkDeviation with 0 deviation.
 */
export async function chainlinkMark(chainId: number, feed: `0x${string}`): Promise<MarkResult> {
  try {
    const [decimals, round] = await Promise.all([
      read(chainId, (c) => c.readContract({ address: feed, abi: CHAINLINK_ABI, functionName: "decimals" })),
      read(chainId, (c) => c.readContract({ address: feed, abi: CHAINLINK_ABI, functionName: "latestRoundData" })),
    ]);
    const [, answer, , updatedAt] = round as unknown as [bigint, bigint, bigint, bigint, bigint];
    if (answer <= 0n) return { price1e18: 0n, ok: false, reason: "NON_POSITIVE_ANSWER" };
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (updatedAt === 0n || (now > updatedAt && now - updatedAt > CFG.maxFeedStaleSecs)) {
      return { price1e18: 0n, ok: false, reason: `STALE:${updatedAt === 0n ? "never" : `${now - updatedAt}s`}` };
    }
    const dec = Number(decimals as bigint | number);
    const price1e18 = dec <= 18 ? (answer as bigint) * 10n ** BigInt(18 - dec) : (answer as bigint) / 10n ** BigInt(dec - 18);
    if (price1e18 === 0n) return { price1e18: 0n, ok: false, reason: "ZERO_PRICE" };
    return { price1e18, ok: true, reason: "OK" };
  } catch {
    return { price1e18: 0n, ok: false, reason: `RPC_ERROR` };
  }
}

/** nextPairId - 1, capped, as the upper enumeration bound (ids are [1, last]). */
export async function lastPairId(chainId: number, market: `0x${string}`): Promise<bigint> {
  const next = (await read(chainId, (c) =>
    c.readContract({ address: market, abi: PERP_MARKET_ABI, functionName: "nextPairId" }),
  )) as bigint;
  if (next <= 1n) return 0n;
  const last = next - 1n;
  return last > CFG.pairIdCap ? CFG.pairIdCap : last;
}

// Canonical Multicall3 (same address on Sepolia + every HookSwap chain).
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/** All positions [1, last] read via multicall (allowFailure) on `chainId`. */
export async function fetchAllPositions(
  chainId: number,
  market: `0x${string}`,
  last: bigint,
): Promise<OnchainPosition[]> {
  if (last <= 0n) return [];
  const calls: any[] = [];
  for (let id = 1n; id <= last; id++) {
    calls.push({ address: market, abi: PERP_MARKET_ABI, functionName: "getPairedPosition", args: [id] });
  }
  const results = await read(chainId, (c) =>
    c.multicall({ contracts: calls, allowFailure: true, multicallAddress: MULTICALL3 }),
  );
  const out: OnchainPosition[] = [];
  for (const r of results as any[]) {
    if (r.status !== "success" || !r.result) continue;
    const p = r.result as any;
    out.push({
      pairId: p.pairId,
      longTrader: p.longTrader,
      shortTrader: p.shortTrader,
      token: getAddress(p.token),
      size: p.size,
      entryPrice: p.entryPrice,
      longCollateral: p.longCollateral,
      shortCollateral: p.shortCollateral,
      longLeverage: p.longLeverage,
      shortLeverage: p.shortLeverage,
      openTime: p.openTime,
      lastFundingSettled: p.lastFundingSettled,
      accFundingLong: p.accFundingLong,
      accFundingShort: p.accFundingShort,
      status: Number(p.status),
    });
  }
  return out;
}

/** Current on-chain stored mark for a token on `chainId` (0 if never set). */
export async function storedMark(chainId: number, market: `0x${string}`, token: `0x${string}`): Promise<bigint> {
  return (await read(chainId, (c) =>
    c.readContract({ address: market, abi: PERP_MARKET_ABI, functionName: "tokenPrices", args: [token] }),
  )) as bigint;
}
