// Runtime configuration — all from env, sensible defaults, no secrets in code.
// Modeled on perps-engine/src/env.ts (minimal .env loader, process env wins).

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Minimal .env loader (no dotenv dep). Loads locker-indexer/.env if present,
// without overriding vars already set in the environment (systemd/env wins).
(function loadDotEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.LOCKER_ENV_FILE,
    join(here, "..", ".env"),
    join(process.cwd(), ".env"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    }
    break;
  }
})();

function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

const here = dirname(fileURLToPath(import.meta.url));

export const ENV = {
  /** HTTP JSON API port. */
  port: num(process.env.PORT, 4200),
  /** How often (ms) the full cross-chain re-index runs. Default 5 min. */
  refreshMs: num(process.env.LOCKER_REFRESH_MS, 5 * 60_000),
  /**
   * Per-chain read timeout (ms). An RPC slower than this marks that chain stale
   * for the cycle without stalling the others.
   */
  chainTimeoutMs: num(process.env.LOCKER_CHAIN_TIMEOUT_MS, 45_000),
  /**
   * Max lock ids fetched per multicall batch (bounds calldata / response size on
   * public RPCs). Ids are chunked; large lockers span several batches.
   */
  batchSize: num(process.env.LOCKER_BATCH_SIZE, 200),
  /** JSON file the daily TVL snapshot series is appended to (survives restart). */
  tvlHistoryFile:
    process.env.LOCKER_TVL_HISTORY_FILE ||
    join(here, "..", "data", "tvl-history.json"),
} as const;
