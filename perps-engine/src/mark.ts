// Mark-price bridge to the config-driven oracle registry (perps-engine/oracle).
//
// The engine keys markets by on-chain ADDRESS; the oracle registry keys by a
// `market` string. We register each configured market under its ADDRESS so
// getMarkPrice(<address>) resolves the scalar 1e18 mark price. Markets without a
// configured oracle source simply have no mark (ok:false) and the matcher falls
// back to the maker's limit price for matchPrice — never a fabricated number.

import { existsSync, readFileSync } from "fs";
import { getAddress } from "viem";
import { SpotOracleAdapter, loadMarkets, type MarketConfig } from "../oracle/index.js";
import { ENV } from "./env.js";

let adapter: SpotOracleAdapter | null = null;
// address (checksummed) -> oracle market key used in the adapter
const addressToKey = new Map<string, string>();
// checksummed market address -> refFeed it was auto-registered against (dedupe).
const autoRegistered = new Map<string, string>();

/**
 * Load optional engine oracle config: a JSON file whose entries are MarketConfig
 * objects whose `market` field is the ON-CHAIN market ADDRESS. Absent file => no
 * marks configured (fallback pricing only). Never throws on a missing file.
 */
export function initMarks(): { configured: number; path: string } {
  const path = ENV.engineMarketsPath;
  if (!path || !existsSync(path)) {
    adapter = new SpotOracleAdapter([]);
    return { configured: 0, path: path || "(none)" };
  }
  const markets: MarketConfig[] = loadMarkets(path);
  adapter = new SpotOracleAdapter(markets);
  for (const m of markets) {
    try {
      addressToKey.set(getAddress(m.market as `0x${string}`), m.market);
    } catch {
      addressToKey.set(m.market, m.market);
    }
  }
  return { configured: markets.length, path };
}

/**
 * Mark price for a market address, scaled 1e18, or null if no source configured
 * or the source could not produce a usable price.
 */
export async function markPrice(market: `0x${string}`): Promise<bigint | null> {
  if (!adapter) return null;
  const key = addressToKey.get(getAddress(market));
  if (!key) return null;
  try {
    const r = await adapter.getMarkPrice(key);
    return r.ok ? r.price1e18 : null;
  } catch {
    return null;
  }
}

export function marksConfigured(): number {
  return addressToKey.size;
}

/**
 * Auto-register a market's mark source from its on-chain OracleGuard `refFeed`
 * (a Chainlink AggregatorV3 feed). The engine then resolves getMarkPrice(<market
 * address>) to that feed's price (8-dec → 1e18, handled by ChainlinkAdapter). This
 * is the SAME price the on-chain deviation breaker enforces — no manual config,
 * never fabricated. Idempotent: a no-op if the same feed is already registered.
 * Returns true if a (new) registration happened.
 */
export function registerRefFeedMark(
  market: `0x${string}`,
  refFeed: `0x${string}`,
  chainId: number,
): boolean {
  if (!adapter) adapter = new SpotOracleAdapter([]);
  let key: string;
  try {
    key = getAddress(market);
  } catch {
    key = market;
  }
  if (autoRegistered.get(key)?.toLowerCase() === refFeed.toLowerCase()) return false;
  adapter.setMarket({
    market: key,
    assetClass: "crypto",
    oracle: { sourceType: "chainlink", chainId, feed: refFeed },
  });
  addressToKey.set(key, key);
  autoRegistered.set(key, refFeed);
  return true;
}

/** True when the market has a configured mark source (config file or auto refFeed). */
export function hasMark(market: `0x${string}`): boolean {
  try {
    return addressToKey.has(getAddress(market));
  } catch {
    return false;
  }
}
