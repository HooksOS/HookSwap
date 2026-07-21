// Daily TVL-snapshot persistence — appends one point per calendar day (UTC) to a
// JSON file so the "TVL over time" chart accrues going forward. Deduped by date
// (the day's point is updated in place on each write until the day rolls over).
// Atomic writes (temp + rename); load-on-boot. Never throws into the hot path.
//
// Modeled on perps-engine/src/persist.ts.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { ENV } from "./env.js";
import type { LockerSnapshot } from "./indexer.js";

const SNAPSHOT_VERSION = 1;

export interface PerChainTvl {
  chainId: number;
  name: string;
  totalLocks: number;
  tvlUsd?: number;
  reachable: boolean;
}

export interface TVLSnapshot {
  /** UTC calendar date, YYYY-MM-DD (the dedupe key). */
  dateISO: string;
  /** ms epoch of the most recent write for this date. */
  updatedAt: number;
  totalTvlUsd?: number;
  totalLocks: number;
  perChain: PerChainTvl[];
}

interface HistoryFile {
  version: number;
  points: TVLSnapshot[];
}

export class TvlHistory {
  private points: TVLSnapshot[] = [];

  constructor(private readonly path: string = ENV.tvlHistoryFile) {}

  /** Load prior history from disk. No-op if absent/corrupt. */
  load(): number {
    if (!existsSync(this.path)) return 0;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as HistoryFile;
      if (!parsed || parsed.version !== SNAPSHOT_VERSION || !Array.isArray(parsed.points)) {
        return 0;
      }
      this.points = parsed.points;
      return this.points.length;
    } catch (e) {
      console.warn("[persist] TVL history load failed (starting fresh):", (e as Error).message);
      return 0;
    }
  }

  /** The full daily series, oldest → newest. */
  series(): TVLSnapshot[] {
    return this.points;
  }

  /**
   * Record today's TVL from a live snapshot. If a point already exists for today
   * (UTC) it is updated in place; otherwise a new day-point is appended. Persists
   * to disk atomically. Pass `dateISO` to control the day (defaults to today UTC).
   */
  record(snap: LockerSnapshot, dateISO: string = new Date().toISOString().slice(0, 10)): void {
    const point: TVLSnapshot = {
      dateISO,
      updatedAt: Date.now(),
      totalTvlUsd: snap.stats.totalTvlUsd,
      totalLocks: snap.stats.totalLocks,
      perChain: snap.chains.map((c) => ({
        chainId: c.chainId,
        name: c.name,
        totalLocks: c.lockCount,
        tvlUsd: c.tvlUsd,
        reachable: c.reachable,
      })),
    };
    const idx = this.points.findIndex((p) => p.dateISO === dateISO);
    if (idx >= 0) this.points[idx] = point;
    else this.points.push(point);
    this.points.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    this.saveNow();
  }

  private saveNow(): void {
    try {
      const dir = dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const file: HistoryFile = { version: SNAPSHOT_VERSION, points: this.points };
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
      renameSync(tmp, this.path);
    } catch (e) {
      console.warn("[persist] TVL history save failed:", (e as Error).message);
    }
  }
}
