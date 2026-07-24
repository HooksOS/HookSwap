// Market data store: per-market mark-price ring buffer + candle builder + ticker
// assembly. Fed by a periodic sampler (index.ts) that reads each market's mark
// (Chainlink refFeed via the oracle registry) every ENV.markSampleMs, and by
// trade prints from the matching engine. Everything here is derived from REAL
// samples/trades — never a fabricated price. Honest nulls where not yet computable.

import { getAddress } from "viem";
import { ENV } from "./env.js";
import { fetchOpenInterest } from "./chain.js";
import type { Trade } from "./types.js";

const ONE_1E18 = 10n ** 18n;
const DAY_MS = 24 * 60 * 60 * 1000;
// 48h of 30s samples ≈ 5760; cap generously so candles + 24h stats always have data.
const SAMPLE_CAP = 8_000;
// A mark sample: unix ms + price (1e18) as a decimal string (JSON-friendly).
export interface MarkSample {
  t: number;
  p: string;
}

export interface Candle {
  /** Bucket start, unix ms. */
  t: number;
  /** OHLC, quote-per-base scaled 1e18 (decimal strings). */
  o: string;
  h: string;
  l: string;
  c: string;
  /** Quote notional traded in the bucket (1e18), from trade prints. "0" if none. */
  v: string;
}

export const CANDLE_INTERVALS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "1h": 3_600_000,
};

function key(market: string): string {
  try {
    return getAddress(market as `0x${string}`);
  } catch {
    return market;
  }
}

/** Per-market ring buffer of mark samples + derived stats. */
export class MarkStore {
  private samples = new Map<string, MarkSample[]>();
  private oiCache = new Map<string, { at: number; value: bigint | null }>();
  // Latest ORACLE index sample (Chainlink refFeed / configured source) per market —
  // kept separate from trade prints so the ticker can serve a true `indexPrice`.
  private index = new Map<string, MarkSample>();

  /**
   * Record the latest oracle index price (1e18) for a market — the Chainlink
   * refFeed / configured-source price the deviation guard enforces. Distinct from
   * `record`, which also folds in trade prints for the candle/change series.
   */
  recordIndex(market: string, price1e18: bigint, at: number = Date.now()): void {
    if (price1e18 <= 0n) return;
    this.index.set(key(market), { t: at, p: price1e18.toString() });
  }

  /** Latest oracle index price (1e18), or null when the market has no configured source. */
  indexLatest(market: string): bigint | null {
    const s = this.index.get(key(market));
    return s ? BigInt(s.p) : null;
  }

  /** Record a fresh mark sample (price 1e18). Ignores non-positive prices. */
  record(market: string, price1e18: bigint, at: number = Date.now()): void {
    if (price1e18 <= 0n) return;
    const k = key(market);
    const arr = this.samples.get(k) ?? [];
    // Guard against clock/duplicate: keep monotonically non-decreasing timestamps.
    if (arr.length && at <= arr[arr.length - 1].t) at = arr[arr.length - 1].t + 1;
    arr.push({ t: at, p: price1e18.toString() });
    if (arr.length > SAMPLE_CAP) arr.splice(0, arr.length - SAMPLE_CAP);
    this.samples.set(k, arr);
  }

  /** Latest mark sample for a market, or undefined. */
  latest(market: string): MarkSample | undefined {
    const arr = this.samples.get(key(market));
    return arr && arr.length ? arr[arr.length - 1] : undefined;
  }

  /** Latest mark price (1e18) or null. */
  latestPrice(market: string): bigint | null {
    const s = this.latest(market);
    return s ? BigInt(s.p) : null;
  }

  /**
   * 24h percentage change from the mark series, or null until there is enough
   * history (a sample at least MIN_HISTORY_MS old). Uses the oldest sample within
   * the trailing 24h window as the reference.
   */
  change24h(market: string): number | null {
    const arr = this.samples.get(key(market));
    if (!arr || arr.length < 2) return null;
    const now = arr[arr.length - 1].t;
    const MIN_HISTORY_MS = 5 * 60_000; // require ≥5m of history before quoting a % change
    const windowStart = now - DAY_MS;
    // Oldest sample within [now-24h, now].
    const ref = arr.find((s) => s.t >= windowStart) ?? arr[0];
    if (now - ref.t < MIN_HISTORY_MS) return null;
    const last = BigInt(arr[arr.length - 1].p);
    const base = BigInt(ref.p);
    if (base <= 0n) return null;
    // pct = (last - base) / base * 100, computed in float from the ratio.
    return (Number(last - base) / Number(base)) * 100;
  }

  /**
   * Build OHLC candles from mark samples + trade prints, bucketed by interval.
   * Price = quote-per-base 1e18 (strings). Volume = quote notional from trades.
   * Empty until data accrues (honest).
   */
  buildCandles(market: string, intervalMs: number, limit: number, trades: Trade[]): Candle[] {
    const k = key(market);
    const marks = this.samples.get(k) ?? [];
    if (!marks.length && !trades.length) return [];

    // Bucket -> aggregation. Prices from BOTH mark samples and trade prints.
    interface Agg {
      t: number;
      o: bigint;
      h: bigint;
      l: bigint;
      c: bigint;
      v: bigint;
      firstT: number;
      lastT: number;
    }
    const buckets = new Map<number, Agg>();

    const fold = (t: number, price: bigint, notional: bigint): void => {
      if (price <= 0n) return;
      const b = Math.floor(t / intervalMs) * intervalMs;
      const agg = buckets.get(b);
      if (!agg) {
        buckets.set(b, { t: b, o: price, h: price, l: price, c: price, v: notional, firstT: t, lastT: t });
        return;
      }
      if (price > agg.h) agg.h = price;
      if (price < agg.l) agg.l = price;
      if (t <= agg.firstT) {
        agg.o = price;
        agg.firstT = t;
      }
      if (t >= agg.lastT) {
        agg.c = price;
        agg.lastT = t;
      }
      agg.v += notional;
    };

    for (const s of marks) fold(s.t, BigInt(s.p), 0n);
    for (const tr of trades) {
      const price = tr.matchPrice;
      const notional = (tr.matchSize * tr.matchPrice) / ONE_1E18;
      fold(tr.ts, price, notional);
    }

    const ordered = [...buckets.values()].sort((a, b) => a.t - b.t);
    const sliced = ordered.slice(Math.max(0, ordered.length - limit));
    return sliced.map((a) => ({
      t: a.t,
      o: a.o.toString(),
      h: a.h.toString(),
      l: a.l.toString(),
      c: a.c.toString(),
      v: a.v.toString(),
    }));
  }

  /** Open interest with a short TTL cache (bounds RPC). Null when unreadable. */
  async openInterest(chainId: number, market: `0x${string}`): Promise<bigint | null> {
    const k = key(market);
    const cached = this.oiCache.get(k);
    if (cached && Date.now() - cached.at < ENV.oiRefreshMs) return cached.value;
    const value = await fetchOpenInterest(chainId, market);
    this.oiCache.set(k, { at: Date.now(), value });
    return value;
  }

  /** Serialize the full mark history for persistence. */
  snapshot(): Record<string, MarkSample[]> {
    const out: Record<string, MarkSample[]> = {};
    for (const [k, arr] of this.samples) out[k] = arr;
    return out;
  }

  /** Restore mark history from a persisted snapshot (on boot). */
  restore(data: Record<string, MarkSample[]> | undefined): void {
    if (!data) return;
    for (const [k, arr] of Object.entries(data)) {
      if (Array.isArray(arr)) this.samples.set(key(k), arr.slice(-SAMPLE_CAP));
    }
  }
}

/**
 * Volume traded over the trailing 24h, in quote notional (1e18), from settled
 * trade prints. null when there are no trades in the window (honest — 0 volume is
 * itself real, so we return "0" only when a market has traded but not in 24h; use
 * null only when the market has never traded).
 */
export function volume24h(trades: Trade[]): string | null {
  if (!trades.length) return null;
  const cutoff = Date.now() - DAY_MS;
  let vol = 0n;
  let any = false;
  for (const t of trades) {
    if (t.ts < cutoff) continue;
    vol += (t.matchSize * t.matchPrice) / ONE_1E18;
    any = true;
  }
  return any ? vol.toString() : "0";
}

/** Next funding boundary (top of the next UTC hour) in unix ms — the 1h schedule. */
export function nextFundingTime(now: number = Date.now()): number {
  return Math.ceil((now + 1) / 3_600_000) * 3_600_000;
}
