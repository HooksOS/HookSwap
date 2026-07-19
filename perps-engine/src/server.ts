// HTTP (JSON) + WebSocket server. Implements the HookSwapPerps engine API exactly
// as specified for the frontend. See README-engine.md for the full contract.

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { getAddress } from "viem";
import { WebSocketServer, type WebSocket } from "ws";
import { ENV } from "./env.js";
import { matcherAccount } from "./chain.js";
import { fetchPositions } from "./chain.js";
import { MatchingEngine } from "./engine.js";
import { OrderError, parseOrder, parseSignature, sanityCheck, verifySigner } from "./order.js";
import { marksConfigured } from "./mark.js";
import type { MarketMeta, StoredOrder } from "./types.js";

const TIER_NAMES = ["CURATED", "PERMISSIONLESS"];
const STATUS_NAMES = ["ACTIVE", "PAUSED", "DELISTED"];

function json(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function marketView(m: MarketMeta) {
  return {
    market: m.market,
    marketId: m.marketId,
    collateral: m.collateral,
    tier: TIER_NAMES[m.tier] ?? m.tier,
    status: STATUS_NAMES[m.status] ?? m.status,
    maxLeverage: (m.marketMaxLeverage === 0n ? m.maxLeverageAbs : m.marketMaxLeverage).toString(),
  };
}

function orderView(o: StoredOrder) {
  return {
    orderId: o.orderId,
    market: o.market,
    trader: o.order.trader,
    token: o.order.token,
    side: o.order.isLong ? "long" : "short",
    size: o.order.size.toString(),
    remaining: o.remaining.toString(),
    leverage: o.order.leverage.toString(),
    price: o.order.price.toString(),
    orderType: o.order.orderType === 1 ? "LIMIT" : "MARKET",
    deadline: o.order.deadline.toString(),
    nonce: o.order.nonce.toString(),
    status: o.status,
    receivedAt: o.receivedAt,
  };
}

function reqMarket(url: URL): `0x${string}` {
  const m = url.searchParams.get("market");
  if (!m) throw new OrderError("missing ?market=<address>");
  try {
    return getAddress(m);
  } catch {
    throw new OrderError(`invalid market address: ${m}`);
  }
}

export async function startServer(engine: MatchingEngine): Promise<void> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://localhost:${ENV.port}`);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = req.method || "GET";

      if (method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        return res.end();
      }

      // GET /health
      if (method === "GET" && path === "/health") {
        return json(res, 200, {
          ok: engine.isReady(),
          chainId: ENV.chainId,
          markets: engine.markets().length,
          matcher: matcherAccount?.address ?? null,
          liveSettle: ENV.liveSettle,
          marksConfigured: marksConfigured(),
        });
      }

      // GET /markets
      if (method === "GET" && path === "/markets") {
        return json(res, 200, engine.markets().map(marketView));
      }

      // GET /orderbook?market=
      if (method === "GET" && path === "/orderbook") {
        const market = reqMarket(url);
        if (!engine.hasMarket(market)) return json(res, 404, { error: "unknown market" });
        return json(res, 200, engine.orderbook(market));
      }

      // POST /orders
      if (method === "POST" && path === "/orders") {
        const body = await readBody(req);
        const marketRaw = body.market ?? url.searchParams.get("market");
        if (!marketRaw) throw new OrderError("missing 'market' (order signatures are per-market; include the market address)");
        let market: `0x${string}`;
        try {
          market = getAddress(marketRaw);
        } catch {
          throw new OrderError(`invalid market address: ${marketRaw}`);
        }
        const meta = engine.getMeta(market);
        if (!meta) return json(res, 404, { error: "unknown market" });
        if (meta.status !== 0) return json(res, 409, { error: `market not ACTIVE (${STATUS_NAMES[meta.status]})` });

        const order = parseOrder(body.order);
        const signature = parseSignature(body.signature);
        sanityCheck(order, { marketMaxLeverage: meta.marketMaxLeverage, maxLeverageAbs: meta.maxLeverageAbs });
        await verifySigner(market, order, signature);

        const result = await engine.submit(market, order, signature);
        return json(res, 200, {
          orderId: result.orderId,
          status: result.status,
          txHash: result.txHash,
          fills: result.fills.map((f) => engine.serializeTrade(f)),
        });
      }

      // DELETE /orders/:orderId
      if (method === "DELETE" && path.startsWith("/orders/")) {
        const orderId = decodeURIComponent(path.slice("/orders/".length));
        const r = engine.cancel(orderId);
        if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
        return json(res, 200, { ok: true, orderId });
      }

      // GET /orders?trader=&market=
      if (method === "GET" && path === "/orders") {
        const market = reqMarket(url);
        if (!engine.hasMarket(market)) return json(res, 404, { error: "unknown market" });
        const traderRaw = url.searchParams.get("trader");
        let trader: `0x${string}` | undefined;
        if (traderRaw) {
          try {
            trader = getAddress(traderRaw);
          } catch {
            throw new OrderError(`invalid trader address: ${traderRaw}`);
          }
        }
        return json(res, 200, engine.openOrders(market, trader).map(orderView));
      }

      // GET /positions?trader=&market=
      if (method === "GET" && path === "/positions") {
        const market = reqMarket(url);
        const traderRaw = url.searchParams.get("trader");
        if (!traderRaw) throw new OrderError("missing ?trader=<address>");
        let trader: `0x${string}`;
        try {
          trader = getAddress(traderRaw);
        } catch {
          throw new OrderError(`invalid trader address: ${traderRaw}`);
        }
        const positions = await fetchPositions(market, trader);
        return json(res, 200, { market, trader, positions });
      }

      // GET /trades?market=&limit=
      if (method === "GET" && path === "/trades") {
        const market = reqMarket(url);
        if (!engine.hasMarket(market)) return json(res, 404, { error: "unknown market" });
        const limit = Math.min(Number(url.searchParams.get("limit") || 50) || 50, 500);
        return json(res, 200, {
          market: getAddress(market),
          trades: engine.recentTrades(market, limit).map((t) => engine.serializeTrade(t)),
        });
      }

      return json(res, 404, { error: "not found", path });
    } catch (e: any) {
      if (e instanceof OrderError) return json(res, 400, { error: e.message });
      console.error("[server] error:", e?.stack || e);
      return json(res, 500, { error: e?.message || "internal error" });
    }
  });

  // ---- WebSocket: /stream?market= -------------------------------------------
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://localhost:${ENV.port}`);
    if (url.pathname.replace(/\/+$/, "") !== "/stream") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wireStream(ws, url));
  });

  function wireStream(ws: WebSocket, url: URL) {
    const marketRaw = url.searchParams.get("market");
    let market: string;
    try {
      market = getAddress((marketRaw || "") as `0x${string}`);
    } catch {
      ws.send(JSON.stringify({ type: "error", error: "invalid or missing ?market=" }));
      ws.close();
      return;
    }
    if (!engine.hasMarket(market)) {
      ws.send(JSON.stringify({ type: "error", error: "unknown market" }));
      ws.close();
      return;
    }

    const obKey = `orderbook:${market}`;
    const trKey = `trade:${market}`;
    const flKey = `fill:${market}`;
    const onOb = (ob: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: "orderbook", ...(ob as object) }));
    const onTr = (t: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: "trade", trade: t }));
    const onFl = (t: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: "fill", fill: t }));

    engine.on(obKey, onOb);
    engine.on(trKey, onTr);
    engine.on(flKey, onFl);

    // Snapshot on connect.
    ws.send(JSON.stringify({ type: "orderbook", ...engine.orderbook(market) }));

    ws.on("close", () => {
      engine.off(obKey, onOb);
      engine.off(trKey, onTr);
      engine.off(flKey, onFl);
    });
    ws.on("error", () => {
      engine.off(obKey, onOb);
      engine.off(trKey, onTr);
      engine.off(flKey, onFl);
    });
  }

  await new Promise<void>((resolve) => server.listen(ENV.port, resolve));
  console.log(`[perps-engine] listening on :${ENV.port} (chainId ${ENV.chainId}, liveSettle=${ENV.liveSettle})`);
}
