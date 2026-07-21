// Daily VESTING-TVL snapshot persistence — appends one point per calendar day
// (UTC) to a JSON file so the "still-locked vesting value over time" chart accrues
// going forward. Deduped by date (the day's point is updated in place until the day
// rolls over). Atomic writes (temp + rename); load-on-boot. Never throws into the
// hot path.
//
// Mirrors src/farms/store.ts (FarmsTvlHistory), but keyed on VestingSnapshot.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { ENV } from "../env.js";
import type { VestingSnapshot } from "./indexer.js";

const SNAPSHOT_VERSION = 1;

export interface PerChainVestingTvl {
  chainId: number;
  name: string;
  totalSchedules: number;
  activeSchedules: number;
  tvlUsd?: number;
  reachable: boolean;
}

export interface VestingTVLSnapshot {
  /** UTC calendar date, YYYY-MM-DD (the dedupe key). */
  dateISO: string;
  /** ms epoch of the most recent write for this date. */
  updatedAt: number;
  totalLockedUsd?: number;
  totalSchedules: number;
  activeSchedules: number;
  perChain: PerChainVestingTvl[];
}

interface HistoryFile {
  version: number;
  points: VestingTVLSnapshot[];
}

export class VestingTvlHistory {
  private points: VestingTVLSnapshot[] = [];

  constructor(private readonly path: string = ENV.vestingTvlHistoryFile) {}

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
      console.warn("[vesting persist] history load failed (starting fresh):", (e as Error).message);
      return 0;
    }
  }

  /** The full daily series, oldest → newest. */
  series(): VestingTVLSnapshot[] {
    return this.points;
  }

  /**
   * Record today's vesting locked-value from a live snapshot. Updates in place if a
   * point for today (UTC) exists; otherwise appends. Persists to disk atomically.
   */
  record(snap: VestingSnapshot, dateISO: string = new Date().toISOString().slice(0, 10)): void {
    const point: VestingTVLSnapshot = {
      dateISO,
      updatedAt: Date.now(),
      totalLockedUsd: snap.stats.totalLockedUsd,
      totalSchedules: snap.stats.totalSchedules,
      activeSchedules: snap.stats.activeSchedules,
      perChain: snap.chains.map((c) => ({
        chainId: c.chainId,
        name: c.name,
        totalSchedules: c.scheduleCount,
        activeSchedules: c.activeCount,
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
      console.warn("[vesting persist] history save failed:", (e as Error).message);
    }
  }
}
