// Engine runtime configuration — all from env, no secrets in code.
//
// MATCHER_PRIVATE_KEY is read ONCE here and never logged. LIVE_SETTLE gates the
// real on-chain settleBatch broadcast (default false → simulate only). Flip with
// a single env change (see README-engine.md).

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Minimal .env loader (no dotenv dep). Loads perps-engine/.env if present, without
// overriding vars already set in the process environment (systemd/env wins).
(function loadDotEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.PERPS_ENV_FILE,
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

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v == null) return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export const ENV = {
  chainId: Number(process.env.PERPS_CHAIN_ID || 11155111),
  rpcUrl: (process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org").trim(),
  marketRegistry: (process.env.MARKET_REGISTRY ||
    "0xEDE278469694e951676973B7b9e193a98463DAC2").trim() as `0x${string}`,
  /** Present only when settlement is possible; NEVER logged. */
  matcherKey: (process.env.MATCHER_PRIVATE_KEY || "").trim(),
  /** false = assemble + simulate settleBatch (no broadcast). true = mine it. */
  liveSettle: bool(process.env.LIVE_SETTLE, false),
  port: Number(process.env.PORT || 4100),
  /** Optional JSON mapping on-chain market address -> oracle source (mark price). */
  engineMarketsPath: process.env.PERPS_ENGINE_MARKETS || "",
  /** How often (ms) to refresh the market list from the registry. */
  marketRefreshMs: Number(process.env.PERPS_MARKET_REFRESH_MS || 60_000),
} as const;

/** Normalize the matcher key to 0x-prefixed 32-byte hex, or "" if unset/invalid. */
export function normalizedMatcherKey(): `0x${string}` | "" {
  const k = ENV.matcherKey.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(k)) return "";
  return `0x${k}` as `0x${string}`;
}
