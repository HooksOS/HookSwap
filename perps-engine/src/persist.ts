// Light persistence: a single JSON snapshot of the orderbook (resting orders),
// trades, and mark history — written debounced on change + on an interval, loaded
// on boot so a restart survives. Single-process, no external DB. Writes are atomic
// (temp file + rename). Never throws into the hot path; persistence failures log
// and are non-fatal (on-chain state remains the source of truth).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ENV } from "./env.js";
import type { MatchingEngine, SerializedBook } from "./engine.js";
import type { MarkStore, MarkSample } from "./marketData.js";

const SNAPSHOT_VERSION = 1;

interface Snapshot {
  version: number;
  savedAt: number;
  books: SerializedBook[];
  marks: Record<string, MarkSample[]>;
}

function defaultStatePath(): string {
  if (ENV.stateFile) return ENV.stateFile;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "data", "engine-state.json");
}

export class Persistence {
  private readonly path: string;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private intervalTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly engine: MatchingEngine,
    private readonly marks: MarkStore,
    path: string = defaultStatePath(),
  ) {
    this.path = path;
  }

  /** Load a prior snapshot into the engine + mark store. No-op if absent/corrupt. */
  load(): { orders: number; trades: number; marks: number } {
    if (!existsSync(this.path)) return { orders: 0, trades: 0, marks: 0 };
    try {
      const snap = JSON.parse(readFileSync(this.path, "utf8")) as Snapshot;
      if (!snap || snap.version !== SNAPSHOT_VERSION) return { orders: 0, trades: 0, marks: 0 };
      const { orders, trades } = this.engine.restoreBooks(snap.books);
      this.marks.restore(snap.marks);
      const marks = snap.marks ? Object.keys(snap.marks).length : 0;
      return { orders, trades, marks };
    } catch (e) {
      console.warn("[persist] load failed (starting fresh):", (e as Error).message);
      return { orders: 0, trades: 0, marks: 0 };
    }
  }

  /** Write the snapshot now (atomic). */
  saveNow(): void {
    try {
      const dir = dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const snap: Snapshot = {
        version: SNAPSHOT_VERSION,
        savedAt: Date.now(),
        books: this.engine.snapshotBooks(),
        marks: this.marks.snapshot(),
      };
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(snap), "utf8");
      renameSync(tmp, this.path);
    } catch (e) {
      console.warn("[persist] save failed:", (e as Error).message);
    }
  }

  /** Debounced save — coalesces bursts of book/mark changes into one write. */
  scheduleSave(delayMs = 1_500): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.saveNow();
    }, delayMs);
    this.saveTimer.unref?.();
  }

  /** Wire engine change events + a periodic flush. */
  start(flushMs = 60_000): void {
    this.engine.on("changed", () => this.scheduleSave());
    this.engine.on("trade", () => this.scheduleSave());
    this.intervalTimer = setInterval(() => this.saveNow(), flushMs);
    this.intervalTimer.unref?.();
  }
}
