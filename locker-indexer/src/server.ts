// Raw node:http JSON API (no express) with permissive CORS. Serves the in-memory
// snapshot produced by LockerIndexer + the daily TVL history. Read-only.
//
// Modeled on perps-engine/src/server.ts.

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { ENV } from "./env.js";
import { chainName } from "./chains.js";
import type { LockerIndexer, Lock } from "./indexer.js";
import type { TvlHistory } from "./persist.js";
import type { FarmsIndexer, Farm } from "./farms/indexer.js";
import type { FarmsTvlHistory } from "./farms/store.js";
import type { VestingIndexer, VestingSchedule } from "./vesting/indexer.js";
import type { VestingTvlHistory } from "./vesting/store.js";
import type { LaunchpadIndexer, Launch } from "./launchpad/indexer.js";

function json(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function sortLocks(locks: Lock[], sort: string | null): Lock[] {
  const arr = [...locks];
  if (sort === "created") {
    arr.sort((a, b) => b.createdAt - a.createdAt);
  } else {
    // default: TVL desc, then raw amount desc (unpriced sink below priced).
    arr.sort((a, b) => {
      const dv = (b.valueUsd ?? -1) - (a.valueUsd ?? -1);
      if (dv !== 0) return dv;
      const ba = BigInt(a.amount.raw);
      const bb = BigInt(b.amount.raw);
      return bb > ba ? 1 : bb < ba ? -1 : 0;
    });
  }
  return arr;
}

function sortFarms(farms: Farm[], sort: string | null): Farm[] {
  const arr = [...farms];
  if (sort === "apr") {
    // APR desc; unpriced/undefined APR sinks below priced.
    arr.sort((a, b) => (b.aprPct ?? -1) - (a.aprPct ?? -1));
  } else {
    // default: TVL desc, then staked raw amount desc (unpriced sink below priced).
    arr.sort((a, b) => {
      const dv = (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1);
      if (dv !== 0) return dv;
      const ba = BigInt(a.tvlStaked.raw);
      const bb = BigInt(b.tvlStaked.raw);
      return bb > ba ? 1 : bb < ba ? -1 : 0;
    });
  }
  return arr;
}

function sortVesting(schedules: VestingSchedule[], sort: string | null): VestingSchedule[] {
  const arr = [...schedules];
  if (sort === "created") {
    arr.sort((a, b) => b.start - a.start);
  } else if (sort === "ending") {
    // Soonest to finish first (already-complete sink to the bottom).
    arr.sort((a, b) => a.endTime - b.endTime);
  } else if (sort === "pct") {
    arr.sort((a, b) => b.pctVested - a.pctVested);
  } else {
    // default: locked USD value desc, then total raw amount desc (unpriced sink below).
    arr.sort((a, b) => {
      const dv = (b.valueUsd ?? -1) - (a.valueUsd ?? -1);
      if (dv !== 0) return dv;
      const ba = BigInt(a.totalAmount.raw);
      const bb = BigInt(b.totalAmount.raw);
      return bb > ba ? 1 : bb < ba ? -1 : 0;
    });
  }
  return arr;
}

function sortLaunches(launches: Launch[], sort: string | null): Launch[] {
  const arr = [...launches];
  if (sort === "created") {
    arr.sort((a, b) => b.createdAt - a.createdAt);
  } else {
    // default: market cap desc, then createdAt desc (unpriced sink below priced).
    arr.sort((a, b) => {
      const dv = (b.marketCapUsd ?? -1) - (a.marketCapUsd ?? -1);
      if (dv !== 0) return dv;
      return b.createdAt - a.createdAt;
    });
  }
  return arr;
}

export async function startServer(
  indexer: LockerIndexer,
  history: TvlHistory,
  farmsIndexer: FarmsIndexer,
  farmsHistory: FarmsTvlHistory,
  vestingIndexer: VestingIndexer,
  vestingHistory: VestingTvlHistory,
  launchpadIndexer: LaunchpadIndexer,
): Promise<void> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || "/", `http://localhost:${ENV.port}`);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = req.method || "GET";

      if (method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        return res.end();
      }
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });

      const snap = indexer.getSnapshot();

      // GET /health
      if (path === "/health") {
        return json(res, 200, {
          ok: true,
          generatedAt: snap.generatedAt,
          refreshMs: ENV.refreshMs,
          chains: snap.chains.map((c) => ({
            chainId: c.chainId,
            name: c.name,
            reachable: c.reachable,
            stale: c.stale,
            lockCount: c.lockCount,
            lastIndexedAt: c.lastIndexedAt,
            error: c.error,
          })),
        });
      }

      // GET /stats
      if (path === "/stats") {
        return json(res, 200, {
          generatedAt: snap.generatedAt,
          ...snap.stats,
          perChain: snap.chains,
        });
      }

      // GET /locks?chainId=&sort=tvl|created&limit=&offset=
      if (path === "/locks") {
        const chainIdParam = url.searchParams.get("chainId");
        let locks = snap.locks;
        if (chainIdParam) {
          const cid = Number(chainIdParam);
          locks = locks.filter((l) => l.chainId === cid);
        }
        locks = sortLocks(locks, url.searchParams.get("sort"));
        const total = locks.length;
        const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
        const limitRaw = Number(url.searchParams.get("limit") || 100) || 100;
        const limit = Math.min(Math.max(1, limitRaw), 1000);
        return json(res, 200, {
          total,
          offset,
          limit,
          locks: locks.slice(offset, offset + limit),
        });
      }

      // GET /tokens
      if (path === "/tokens") {
        return json(res, 200, { total: snap.tokens.length, tokens: snap.tokens });
      }

      // GET /pools
      if (path === "/pools") {
        return json(res, 200, { total: snap.pools.length, pools: snap.pools });
      }

      // GET /tvl-history
      if (path === "/tvl-history") {
        return json(res, 200, { points: history.series() });
      }

      // GET /token/:chainId/:address
      let m = path.match(/^\/token\/(\d+)\/(0x[0-9a-fA-F]{40})$/);
      if (m) {
        const cid = Number(m[1]);
        const addr = m[2];
        const agg = snap.tokens.find((t) => t.chainId === cid && eqAddr(t.token, addr));
        const locks = snap.locks.filter(
          (l) => l.chainId === cid && !l.isLpToken && eqAddr(l.token, addr),
        );
        if (!agg && locks.length === 0) {
          return json(res, 404, {
            error: "no token locks found",
            chainId: cid,
            chainName: chainName(cid),
            token: addr,
          });
        }
        return json(res, 200, { token: agg ?? null, locks: sortLocks(locks, "tvl") });
      }

      // GET /pool/:chainId/:address
      m = path.match(/^\/pool\/(\d+)\/(0x[0-9a-fA-F]{40})$/);
      if (m) {
        const cid = Number(m[1]);
        const addr = m[2];
        const agg = snap.pools.find((p) => p.chainId === cid && eqAddr(p.pair, addr));
        const locks = snap.locks.filter(
          (l) => l.chainId === cid && l.isLpToken && eqAddr(l.token, addr),
        );
        if (!agg && locks.length === 0) {
          return json(res, 404, {
            error: "no pool locks found",
            chainId: cid,
            chainName: chainName(cid),
            pair: addr,
          });
        }
        return json(res, 200, { pool: agg ?? null, locks: sortLocks(locks, "tvl") });
      }

      // GET /lock/:chainId/:id
      m = path.match(/^\/lock\/(\d+)\/(\d+)$/);
      if (m) {
        const cid = Number(m[1]);
        const id = Number(m[2]);
        const lock = snap.locks.find((l) => l.chainId === cid && l.id === id);
        if (!lock) {
          return json(res, 404, { error: "lock not found", chainId: cid, id });
        }
        return json(res, 200, { lock });
      }

      // ─────────────────────────────────────────────── FARMS endpoints ──────────
      const farmSnap = farmsIndexer.getSnapshot();

      // GET /farms/stats — global farms stats + per-chain breakdown.
      if (path === "/farms/stats") {
        return json(res, 200, {
          generatedAt: farmSnap.generatedAt,
          ...farmSnap.stats,
          perChain: farmSnap.chains,
        });
      }

      // GET /farms/tvl-history — the daily farms-TVL snapshot series (oldest → newest).
      if (path === "/farms/tvl-history") {
        return json(res, 200, { points: farmsHistory.series() });
      }

      // GET /farms?chainId=&sort=tvl|apr&limit=&offset=
      if (path === "/farms") {
        const chainIdParam = url.searchParams.get("chainId");
        let farms = farmSnap.farms;
        if (chainIdParam) {
          const cid = Number(chainIdParam);
          farms = farms.filter((f) => f.chainId === cid);
        }
        farms = sortFarms(farms, url.searchParams.get("sort"));
        const total = farms.length;
        const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
        const limitRaw = Number(url.searchParams.get("limit") || 100) || 100;
        const limit = Math.min(Math.max(1, limitRaw), 1000);
        return json(res, 200, {
          total,
          offset,
          limit,
          farms: farms.slice(offset, offset + limit),
        });
      }

      // GET /farm/:chainId/:address — one farm's detail (powers the shareable page). 404 if none.
      m = path.match(/^\/farm\/(\d+)\/(0x[0-9a-fA-F]{40})$/);
      if (m) {
        const cid = Number(m[1]);
        const addr = m[2];
        const farm = farmSnap.farms.find((f) => f.chainId === cid && eqAddr(f.farm, addr));
        if (!farm) {
          return json(res, 404, {
            error: "farm not found",
            chainId: cid,
            chainName: chainName(cid),
            farm: addr,
          });
        }
        return json(res, 200, { farm });
      }

      // ─────────────────────────────────────────────── VESTING endpoints ────────
      const vestSnap = vestingIndexer.getSnapshot();

      // GET /vesting/stats — global vesting stats + per-chain breakdown.
      if (path === "/vesting/stats") {
        return json(res, 200, {
          generatedAt: vestSnap.generatedAt,
          ...vestSnap.stats,
          perChain: vestSnap.chains,
        });
      }

      // GET /vesting/tvl-history — the daily vesting locked-value snapshot series.
      if (path === "/vesting/tvl-history") {
        return json(res, 200, { points: vestingHistory.series() });
      }

      // GET /vesting?chainId=&sort=tvl|created|ending|pct&limit=&offset=
      if (path === "/vesting") {
        const chainIdParam = url.searchParams.get("chainId");
        let schedules = vestSnap.schedules;
        if (chainIdParam) {
          const cid = Number(chainIdParam);
          schedules = schedules.filter((s) => s.chainId === cid);
        }
        schedules = sortVesting(schedules, url.searchParams.get("sort"));
        const total = schedules.length;
        const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
        const limitRaw = Number(url.searchParams.get("limit") || 100) || 100;
        const limit = Math.min(Math.max(1, limitRaw), 1000);
        return json(res, 200, {
          total,
          offset,
          limit,
          schedules: schedules.slice(offset, offset + limit),
        });
      }

      // GET /vesting/:chainId/:id — one schedule's detail. 404 if none.
      m = path.match(/^\/vesting\/(\d+)\/(\d+)$/);
      if (m) {
        const cid = Number(m[1]);
        const id = Number(m[2]);
        const schedule = vestSnap.schedules.find((s) => s.chainId === cid && s.id === id);
        if (!schedule) {
          return json(res, 404, {
            error: "vesting schedule not found",
            chainId: cid,
            chainName: chainName(cid),
            id,
          });
        }
        return json(res, 200, { schedule });
      }

      // ─────────────────────────────────────────────── LAUNCHPAD endpoints ──────
      const launchSnap = launchpadIndexer.getSnapshot();

      // GET /launches/stats — global launchpad stats + per-chain breakdown.
      if (path === "/launches/stats") {
        return json(res, 200, {
          generatedAt: launchSnap.generatedAt,
          ...launchSnap.stats,
          perChain: launchSnap.chains,
        });
      }

      // GET /launches?chainId=&sort=mcap|created&limit=&offset=
      if (path === "/launches") {
        const chainIdParam = url.searchParams.get("chainId");
        let launches = launchSnap.launches;
        if (chainIdParam) {
          const cid = Number(chainIdParam);
          launches = launches.filter((l) => l.chainId === cid);
        }
        launches = sortLaunches(launches, url.searchParams.get("sort"));
        const total = launches.length;
        const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
        const limitRaw = Number(url.searchParams.get("limit") || 100) || 100;
        const limit = Math.min(Math.max(1, limitRaw), 1000);
        return json(res, 200, {
          total,
          offset,
          limit,
          launches: launches.slice(offset, offset + limit),
        });
      }

      // GET /launch/:chainId/:token — the shareable launch page (by token address).
      m = path.match(/^\/launch\/(\d+)\/(0x[0-9a-fA-F]{40})$/);
      if (m) {
        const cid = Number(m[1]);
        const addr = m[2];
        const launch = launchSnap.launches.find(
          (l) => l.chainId === cid && eqAddr(l.token.addr, addr),
        );
        if (!launch) {
          return json(res, 404, {
            error: "launch not found",
            chainId: cid,
            chainName: chainName(cid),
            token: addr,
          });
        }
        return json(res, 200, { launch });
      }

      // GET /launch/:chainId/:id — same launch page by numeric launch id.
      m = path.match(/^\/launch\/(\d+)\/(\d+)$/);
      if (m) {
        const cid = Number(m[1]);
        const id = Number(m[2]);
        const launch = launchSnap.launches.find((l) => l.chainId === cid && l.id === id);
        if (!launch) {
          return json(res, 404, {
            error: "launch not found",
            chainId: cid,
            chainName: chainName(cid),
            id,
          });
        }
        return json(res, 200, { launch });
      }

      return json(res, 404, { error: "not found", path });
    } catch (e: any) {
      console.error("[server] error:", e?.stack || e);
      return json(res, 500, { error: e?.message || "internal error" });
    }
  });

  await new Promise<void>((resolve) => server.listen(ENV.port, resolve));
  console.log(`[locker-indexer] listening on :${ENV.port} (refresh every ${ENV.refreshMs}ms)`);
}
