// The matching engine: per-market in-memory orderbooks, crossing logic, and the
// settle trigger. Emits 'orderbook' | 'trade' | 'fill' events per market for WS.
//
// v1 is single-process, in-memory (NOT HA). Books are lost on restart; on-chain
// positions are the source of truth for what actually settled.

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { getAddress } from "viem";
import { ENV } from "./env.js";
import { fetchMarkets, onchainNonce } from "./chain.js";
import { markPrice } from "./mark.js";
import { settlePair } from "./settle.js";
import { OrderType, type MarketMeta, type MatchedPair, type Order, type StoredOrder, type Trade } from "./types.js";

const MAX_PRICE = (1n << 256n) - 1n;

export interface SubmitResult {
  orderId: string;
  status: "open" | "matched";
  txHash: `0x${string}` | null;
  fills: Trade[];
}

interface Book {
  meta: MarketMeta;
  orders: Map<string, StoredOrder>;
  trades: Trade[]; // recent fills (capped)
}

const TRADE_HISTORY_CAP = 500;

// ---- Persistence wire shapes (bigints as decimal strings) --------------------

interface SerializedOrder {
  trader: `0x${string}`;
  token: `0x${string}`;
  isLong: boolean;
  size: string;
  leverage: string;
  price: string;
  deadline: string;
  nonce: string;
  orderType: number;
}
interface SerializedStoredOrder {
  orderId: string;
  market: `0x${string}`;
  order: SerializedOrder;
  signature: `0x${string}`;
  remaining: string;
  status: StoredOrder["status"];
  receivedAt: number;
}
interface SerializedTrade {
  market: `0x${string}`;
  longTrader: `0x${string}`;
  shortTrader: `0x${string}`;
  token: `0x${string}`;
  matchPrice: string;
  matchSize: string;
  takerIsLong?: boolean;
  txHash: `0x${string}` | null;
  settled: boolean;
  reason?: string;
  calldata?: `0x${string}`;
  ts: number;
}
export interface SerializedBook {
  market: string;
  orders: SerializedStoredOrder[];
  trades: SerializedTrade[];
}

function serializeStoredOrder(o: StoredOrder): SerializedStoredOrder {
  return {
    orderId: o.orderId,
    market: o.market,
    order: {
      trader: o.order.trader,
      token: o.order.token,
      isLong: o.order.isLong,
      size: o.order.size.toString(),
      leverage: o.order.leverage.toString(),
      price: o.order.price.toString(),
      deadline: o.order.deadline.toString(),
      nonce: o.order.nonce.toString(),
      orderType: o.order.orderType,
    },
    signature: o.signature,
    remaining: o.remaining.toString(),
    status: o.status,
    receivedAt: o.receivedAt,
  };
}

function deserializeStoredOrder(s: SerializedStoredOrder): StoredOrder {
  return {
    orderId: s.orderId,
    market: s.market,
    order: {
      trader: s.order.trader,
      token: s.order.token,
      isLong: s.order.isLong,
      size: BigInt(s.order.size),
      leverage: BigInt(s.order.leverage),
      price: BigInt(s.order.price),
      deadline: BigInt(s.order.deadline),
      nonce: BigInt(s.order.nonce),
      orderType: s.order.orderType as StoredOrder["order"]["orderType"],
    },
    signature: s.signature,
    remaining: BigInt(s.remaining),
    status: s.status,
    receivedAt: s.receivedAt,
  };
}

function deserializeTrade(s: SerializedTrade, market: `0x${string}`): Trade {
  return {
    market: (s.market ?? market) as `0x${string}`,
    longTrader: s.longTrader,
    shortTrader: s.shortTrader,
    token: s.token,
    matchPrice: BigInt(s.matchPrice),
    matchSize: BigInt(s.matchSize),
    takerIsLong: s.takerIsLong ?? false,
    txHash: s.txHash ?? null,
    settled: s.settled,
    reason: s.reason,
    calldata: s.calldata,
    ts: s.ts,
  };
}

export class MatchingEngine extends EventEmitter {
  private books = new Map<string, Book>(); // key: checksummed market address
  private ready = false;

  async init(): Promise<void> {
    await this.refreshMarkets();
    this.ready = true;
    if (ENV.marketRefreshMs > 0) {
      setInterval(() => {
        this.refreshMarkets().catch((e) => console.error("[engine] market refresh failed:", e?.message || e));
      }, ENV.marketRefreshMs).unref();
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  private key(market: string): string {
    return getAddress(market as `0x${string}`);
  }

  async refreshMarkets(): Promise<void> {
    const metas = await fetchMarkets();
    for (const m of metas) {
      const k = this.key(m.market);
      const existing = this.books.get(k);
      if (existing) {
        existing.meta = m; // keep book, refresh meta
      } else {
        this.books.set(k, { meta: m, orders: new Map(), trades: [] });
      }
    }
  }

  markets(): MarketMeta[] {
    return [...this.books.values()].map((b) => b.meta);
  }

  getMeta(market: string): MarketMeta | undefined {
    try {
      return this.books.get(this.key(market))?.meta;
    } catch {
      return undefined;
    }
  }

  hasMarket(market: string): boolean {
    try {
      return this.books.has(this.key(market));
    } catch {
      return false;
    }
  }

  private book(market: string): Book {
    const b = this.books.get(this.key(market));
    if (!b) throw new Error(`unknown market ${market}`);
    return b;
  }

  // ---- Orderbook aggregation (for GET /orderbook) ----------------------------

  orderbook(market: string): {
    market: string;
    bids: { price: string; size: string; orders: number }[];
    asks: { price: string; size: string; orders: number }[];
  } {
    const b = this.book(market);
    const bidLevels = new Map<string, { size: bigint; orders: number }>();
    const askLevels = new Map<string, { size: bigint; orders: number }>();
    for (const o of b.orders.values()) {
      if (o.status !== "open" || o.remaining <= 0n) continue;
      const levels = o.order.isLong ? bidLevels : askLevels;
      const key = o.order.price.toString();
      const lvl = levels.get(key) || { size: 0n, orders: 0 };
      lvl.size += o.remaining;
      lvl.orders += 1;
      levels.set(key, lvl);
    }
    const bids = [...bidLevels.entries()]
      .map(([price, v]) => ({ price, size: v.size.toString(), orders: v.orders, _p: BigInt(price) }))
      .sort((a, z) => (z._p > a._p ? 1 : z._p < a._p ? -1 : 0)) // desc
      .map(({ _p, ...r }) => r);
    const asks = [...askLevels.entries()]
      .map(([price, v]) => ({ price, size: v.size.toString(), orders: v.orders, _p: BigInt(price) }))
      .sort((a, z) => (a._p > z._p ? 1 : a._p < z._p ? -1 : 0)) // asc
      .map(({ _p, ...r }) => r);
    return { market: this.key(market), bids, asks };
  }

  openOrders(market: string, trader?: `0x${string}`): StoredOrder[] {
    const b = this.book(market);
    const t = trader ? getAddress(trader) : undefined;
    return [...b.orders.values()].filter(
      (o) => o.status === "open" && o.remaining > 0n && (!t || getAddress(o.order.trader) === t),
    );
  }

  recentTrades(market: string, limit: number): Trade[] {
    const b = this.book(market);
    return b.trades.slice(-limit).reverse();
  }

  /** All retained trades for a market (chronological), for volume/candle aggregation. */
  allTrades(market: string): Trade[] {
    try {
      return this.book(market).trades;
    } catch {
      return [];
    }
  }

  /** Trades at/after `sinceMs` (chronological). */
  tradesSince(market: string, sinceMs: number): Trade[] {
    return this.allTrades(market).filter((t) => t.ts >= sinceMs);
  }

  /** Resolve an orderId to its owning market + trader (for cancel authorization). */
  getOrderOwner(orderId: string): { market: `0x${string}`; trader: `0x${string}` } | undefined {
    for (const [k, b] of this.books) {
      const o = b.orders.get(orderId);
      if (o) return { market: k as `0x${string}`, trader: o.order.trader };
    }
    return undefined;
  }

  cancel(orderId: string): { ok: boolean; reason?: string; market?: string } {
    for (const [k, b] of this.books) {
      const o = b.orders.get(orderId);
      if (!o) continue;
      if (o.status !== "open" || o.remaining !== o.order.size) {
        return { ok: false, reason: "order already (partially) filled or not open", market: k };
      }
      o.status = "cancelled";
      b.orders.delete(orderId);
      this.emit(`orderbook:${k}`, this.orderbook(k));
      this.emit("changed");
      return { ok: true, market: k };
    }
    return { ok: false, reason: "orderId not found" };
  }

  // ---- Matching --------------------------------------------------------------

  async submit(
    market: `0x${string}`,
    order: Order,
    signature: `0x${string}`,
  ): Promise<SubmitResult> {
    const k = this.key(market);
    const b = this.book(k);

    // Best-effort on-chain nonce check (a mismatch guarantees a settle revert).
    try {
      const chainNonce = await onchainNonce(k as `0x${string}`, order.trader);
      if (order.nonce !== chainNonce) {
        throw new Error(
          `order.nonce ${order.nonce} != on-chain nonce ${chainNonce} for ${order.trader}`,
        );
      }
    } catch (e: any) {
      if (/!= on-chain nonce/.test(e?.message || "")) throw e; // hard mismatch
      // transient RPC error — proceed but note it
      console.warn("[engine] nonce read failed, proceeding:", e?.message || e);
    }

    const stored: StoredOrder = {
      orderId: randomUUID(),
      market: k as `0x${string}`,
      order,
      signature,
      remaining: order.size,
      status: "open",
      receivedAt: Date.now(),
    };

    const fills = await this.match(b, stored);

    let lastTxHash: `0x${string}` | null = null;
    for (const f of fills) if (f.txHash) lastTxHash = f.txHash;

    if (stored.remaining > 0n) {
      b.orders.set(stored.orderId, stored); // rest on the book
    } else {
      stored.status = "matched";
    }

    this.emit(`orderbook:${k}`, this.orderbook(k));
    this.emit("changed");

    return {
      orderId: stored.orderId,
      status: fills.length > 0 ? "matched" : "open",
      txHash: lastTxHash,
      fills,
    };
  }

  /** Effective crossing price for a side (market orders cross anything). */
  private effPrice(o: Order, isLongSide: boolean): bigint {
    if (o.orderType === OrderType.MARKET) return isLongSide ? MAX_PRICE : 0n;
    return o.price;
  }

  /** Pick matchPrice respecting both limits: maker price, else taker, else mark. */
  private async pickMatchPrice(
    market: `0x${string}`,
    longO: Order,
    shortO: Order,
    maker: Order,
  ): Promise<bigint | null> {
    let mp: bigint | null = null;
    if (maker.orderType === OrderType.LIMIT) mp = maker.price;
    else {
      const taker = maker === longO ? shortO : longO;
      if (taker.orderType === OrderType.LIMIT) mp = taker.price;
      else mp = await markPrice(market); // both market -> need an oracle mark
    }
    if (mp == null || mp <= 0n) return null;
    // Enforce signed limits (contract will too).
    if (longO.orderType === OrderType.LIMIT && mp > longO.price) return null;
    if (shortO.orderType === OrderType.LIMIT && mp < shortO.price) return null;
    return mp;
  }

  private async match(b: Book, taker: StoredOrder): Promise<Trade[]> {
    const fills: Trade[] = [];
    const takerIsLong = taker.order.isLong;

    // Resting opposite side, best-first for the taker.
    const resting = [...b.orders.values()]
      .filter((o) => o.status === "open" && o.remaining > 0n && o.order.isLong !== takerIsLong)
      .sort((a, z) => {
        // taker long -> match cheapest shorts first (asc); taker short -> priciest longs first (desc)
        const pa = a.order.price;
        const pz = z.order.price;
        if (takerIsLong) return pa > pz ? 1 : pa < pz ? -1 : a.receivedAt - z.receivedAt;
        return pz > pa ? 1 : pz < pa ? -1 : a.receivedAt - z.receivedAt;
      });

    for (const rest of resting) {
      if (taker.remaining <= 0n) break;

      // Self-trade prevention: never cross two orders from the SAME trader (a
      // self-match settles nothing real and would revert / wash on-chain). Skip
      // this resting order and leave BOTH resting; continue scanning others.
      if (getAddress(rest.order.trader) === getAddress(taker.order.trader)) continue;

      const longO = takerIsLong ? taker.order : rest.order;
      const shortO = takerIsLong ? rest.order : taker.order;

      const effLong = this.effPrice(longO, true);
      const effShort = this.effPrice(shortO, false);
      if (effLong < effShort) break; // sorted best-first: no further crosses

      const mp = await this.pickMatchPrice(b.meta.market, longO, shortO, rest.order);
      if (mp == null) continue; // can't price this pair (e.g. both market, no mark)

      const matchSize = taker.remaining < rest.remaining ? taker.remaining : rest.remaining;

      const pair: MatchedPair = {
        longOrder: longO,
        longSignature: takerIsLong ? taker.signature : rest.signature,
        shortOrder: shortO,
        shortSignature: takerIsLong ? rest.signature : taker.signature,
        matchPrice: mp,
        matchSize,
      };

      const res = await settlePair(b.meta.market, pair);

      // Consume the book when: live+mined, OR dry-run (simulate mode always consumes
      // logically so matching is observable without real balances).
      const consume = ENV.liveSettle ? res.settled : true;

      const trade: Trade = {
        market: b.meta.market,
        longTrader: longO.trader,
        shortTrader: shortO.trader,
        token: longO.token,
        matchPrice: mp,
        matchSize,
        takerIsLong,
        txHash: res.txHash,
        settled: res.settled,
        reason: res.reason,
        calldata: res.calldata,
        ts: Date.now(),
      };

      if (consume) {
        taker.remaining -= matchSize;
        rest.remaining -= matchSize;
        if (rest.remaining <= 0n) {
          rest.status = "matched";
          b.orders.delete(rest.orderId);
        }
        b.trades.push(trade);
        if (b.trades.length > TRADE_HISTORY_CAP) b.trades.splice(0, b.trades.length - TRADE_HISTORY_CAP);
        fills.push(trade);
        this.emit(`trade:${this.key(b.meta.market)}`, this.serializeTrade(trade));
        this.emit(`fill:${this.key(b.meta.market)}`, this.serializeTrade(trade));
        // Unkeyed 'trade' — market-data sampler + persistence subscribe to all fills.
        this.emit("trade", trade);
      } else {
        // Live broadcast failed — leave the book untouched, surface the reason, stop.
        fills.push(trade);
        this.emit(`trade:${this.key(b.meta.market)}`, this.serializeTrade(trade));
        break;
      }
    }
    return fills;
  }

  // ---- Persistence (snapshot / restore of books + trades) --------------------

  /** Serialize every book's resting orders + retained trades (bigints → strings). */
  snapshotBooks(): SerializedBook[] {
    const out: SerializedBook[] = [];
    for (const [k, b] of this.books) {
      out.push({
        market: k,
        orders: [...b.orders.values()].map(serializeStoredOrder),
        trades: b.trades.map((t) => this.serializeTrade(t)),
      });
    }
    return out;
  }

  /**
   * Restore resting orders + trades into EXISTING books (call after init(), which
   * loads markets from the registry). Rows for unknown markets are skipped. Only
   * still-open orders are re-seated onto the book; trades repopulate history.
   */
  restoreBooks(rows: SerializedBook[] | undefined): { orders: number; trades: number } {
    let orders = 0;
    let trades = 0;
    if (!rows) return { orders, trades };
    for (const row of rows) {
      let b: Book;
      try {
        b = this.book(row.market);
      } catch {
        continue; // market no longer in the registry
      }
      for (const so of row.orders ?? []) {
        try {
          const stored = deserializeStoredOrder(so);
          if (stored.status === "open" && stored.remaining > 0n) {
            b.orders.set(stored.orderId, stored);
            orders++;
          }
        } catch {
          /* skip malformed persisted order */
        }
      }
      for (const t of row.trades ?? []) {
        try {
          b.trades.push(deserializeTrade(t, row.market as `0x${string}`));
          trades++;
        } catch {
          /* skip malformed persisted trade */
        }
      }
      if (b.trades.length > TRADE_HISTORY_CAP) b.trades.splice(0, b.trades.length - TRADE_HISTORY_CAP);
    }
    return { orders, trades };
  }

  serializeTrade(t: Trade) {
    return {
      market: t.market,
      longTrader: t.longTrader,
      shortTrader: t.shortTrader,
      token: t.token,
      matchPrice: t.matchPrice.toString(),
      matchSize: t.matchSize.toString(),
      takerIsLong: t.takerIsLong,
      txHash: t.txHash,
      settled: t.settled,
      reason: t.reason,
      calldata: t.calldata,
      ts: t.ts,
    };
  }
}
