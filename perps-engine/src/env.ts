// Engine runtime configuration — all from env / a chains JSON, no secrets in code.
//
// Matcher keys are read ONCE (per chain, by env-var NAME from the chains config)
// and never logged. LIVE_SETTLE gates the real on-chain settleBatch broadcast
// (default false → simulate only). Flip with a single env change (see README-engine.md).
//
// MULTI-CHAIN: the engine matches + settles markets across several chains at once.
// Each chain is described by a ChainConfig (chainId, rpcUrl, marketRegistry,
// oracleGuard, matcherKeyEnv, gasMode). Source order:
//   1. PERPS_CHAINS_CONFIG=<path> (or config/chains.json if present) — the array.
//   2. BACKWARD-COMPAT fallback — synthesize ONE chain from the legacy single-chain
//      env vars (PERPS_CHAIN_ID / SEPOLIA_RPC_URL / MARKET_REGISTRY / ORACLE_GUARD /
//      MATCHER_PRIVATE_KEY) so existing single-chain deploys keep working unchanged.

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

const HERE = dirname(fileURLToPath(import.meta.url));

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v == null) return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export type GasMode = "eip1559" | "legacy";

/** One chain the engine matches + settles on, fully described by config. */
export interface ChainConfig {
  chainId: number;
  /** Optional human label (sepolia / robinhood) for logs. */
  network?: string;
  /** Resolved RPC URL (rpcUrlEnv override already applied, else literal, else public default). */
  rpcUrl: string;
  marketRegistry: `0x${string}`;
  oracleGuard: `0x${string}`;
  /** ENV VAR NAME holding this chain's matcher private key (never the key itself). */
  matcherKeyEnv: string;
  /** Resolved, normalized matcher key (0x 32-byte hex) or "" when unset/invalid. NEVER logged. */
  matcherKey: `0x${string}` | "";
  /** eip1559 = maxFeePerGas/maxPriorityFeePerGas (RH + default); legacy = gasPrice (rare chains). */
  gasMode: GasMode;
}

// Public fallback RPCs (kept in sync with oracle/rpc.ts DEFAULT_RPCS). Used only
// when a chain entry supplies neither a literal rpcUrl nor an rpcUrlEnv override.
const DEFAULT_RPCS: Record<number, string> = {
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  4663: "https://rpc.mainnet.chain.robinhood.com",
  999: "https://rpc.hyperliquid.xyz/evm",
  57073: "https://rpc-gel.inkonchain.com",
  196: "https://rpc.xlayer.tech",
};

/** Normalize a matcher key (read from an env var) to 0x-prefixed 32-byte hex, or "". */
function normalizeKey(raw: string | undefined): `0x${string}` | "" {
  const k = (raw || "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(k)) return "";
  return `0x${k}` as `0x${string}`;
}

function normalizeGasMode(v: unknown): GasMode {
  return String(v).toLowerCase() === "legacy" ? "legacy" : "eip1559";
}

/** Resolve one raw chains.json entry into a ChainConfig (throws on missing required fields). */
function resolveChainEntry(e: any, i: number): ChainConfig {
  const ctx = `chains[${i}]`;
  const chainId = Number(e?.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`${ctx}.chainId invalid: ${e?.chainId}`);
  const marketRegistry = String(e?.marketRegistry || "").trim();
  const oracleGuard = String(e?.oracleGuard || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(marketRegistry)) throw new Error(`${ctx}.marketRegistry invalid`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(oracleGuard)) throw new Error(`${ctx}.oracleGuard invalid`);

  // RPC precedence: rpcUrlEnv (env var value) > literal rpcUrl > public default.
  const fromEnv = e?.rpcUrlEnv ? (process.env[String(e.rpcUrlEnv)] || "").trim() : "";
  const literal = String(e?.rpcUrl || "").trim();
  const rpcUrl = fromEnv || literal || DEFAULT_RPCS[chainId] || "";
  if (!rpcUrl) throw new Error(`${ctx}: no rpcUrl (set rpcUrl, rpcUrlEnv, or a known default for ${chainId})`);

  const matcherKeyEnv = String(e?.matcherKeyEnv || "MATCHER_PRIVATE_KEY").trim();
  return {
    chainId,
    network: e?.network ? String(e.network) : undefined,
    rpcUrl,
    marketRegistry: marketRegistry as `0x${string}`,
    oracleGuard: oracleGuard as `0x${string}`,
    matcherKeyEnv,
    matcherKey: normalizeKey(process.env[matcherKeyEnv]),
    gasMode: normalizeGasMode(e?.gasMode),
  };
}

/**
 * Load the chains config. Tries PERPS_CHAINS_CONFIG, then config/chains.json.
 * Absent → returns null (caller synthesizes the single-chain fallback).
 */
function loadChainsConfig(): ChainConfig[] | null {
  const explicit = (process.env.PERPS_CHAINS_CONFIG || "").trim();
  const candidates = [explicit, join(HERE, "..", "config", "chains.json")].filter(Boolean) as string[];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const arr = Array.isArray(raw) ? raw : raw?.chains;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error(`chains config ${path} must be an array or { chains: [...] } (non-empty)`);
    }
    return arr.map(resolveChainEntry);
  }
  return null;
}

const LEGACY_CHAIN_ID = Number(process.env.PERPS_CHAIN_ID || 11155111);
const LEGACY_RPC = (process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org").trim();
const LEGACY_REGISTRY = (process.env.MARKET_REGISTRY ||
  "0xEDE278469694e951676973B7b9e193a98463DAC2").trim() as `0x${string}`;
const LEGACY_ORACLE_GUARD = (process.env.ORACLE_GUARD ||
  "0x3D2ee857AE129688fA43E378dAE85b60803bfFD1").trim() as `0x${string}`;

/** BACKWARD-COMPAT: one chain synthesized from the legacy single-chain env vars. */
function synthesizeSingleChain(): ChainConfig[] {
  const matcherKeyEnv = "MATCHER_PRIVATE_KEY";
  return [
    {
      chainId: LEGACY_CHAIN_ID,
      network: process.env.PERPS_NETWORK || undefined,
      rpcUrl: LEGACY_RPC,
      marketRegistry: LEGACY_REGISTRY,
      oracleGuard: LEGACY_ORACLE_GUARD,
      matcherKeyEnv,
      matcherKey: normalizeKey(process.env[matcherKeyEnv]),
      // Default to eip1559 (fixes the RH "legacy < base fee" revert class). Legacy
      // only where a chain needs it, via PERPS_GAS_MODE=legacy or a chains.json entry.
      gasMode: normalizeGasMode(process.env.PERPS_GAS_MODE || "eip1559"),
    },
  ];
}

const CHAINS: ChainConfig[] = loadChainsConfig() ?? synthesizeSingleChain();

export const ENV = {
  /** All chains the engine matches + settles on. */
  chains: CHAINS,
  /** Legacy single-chain id (first configured chain) — kept for logs/back-compat. */
  chainId: CHAINS[0].chainId,
  rpcUrl: CHAINS[0].rpcUrl,
  marketRegistry: CHAINS[0].marketRegistry,
  oracleGuard: CHAINS[0].oracleGuard,
  /** false = assemble + simulate settleBatch (no broadcast). true = mine it. */
  liveSettle: bool(process.env.LIVE_SETTLE, false),
  /**
   * Max ms to wait for a settle tx receipt before treating the wait as failed
   * (default 120s ≈ 10 Sepolia blocks). A stuck/dropped tx must not hang the
   * serialized settle queue head-of-line; the tx may still mine later and the
   * on-chain state / settle re-check remains authoritative.
   */
  receiptTimeoutMs: Number(process.env.PERPS_RECEIPT_TIMEOUT_MS || 120_000),
  port: Number(process.env.PORT || 4100),
  /** Optional JSON mapping on-chain market address -> oracle source (mark price). */
  engineMarketsPath: process.env.PERPS_ENGINE_MARKETS || "",
  /** How often (ms) to refresh the market list from the registries. */
  marketRefreshMs: Number(process.env.PERPS_MARKET_REFRESH_MS || 60_000),
  /** How often (ms) the mark sampler reads each configured feed into the ring buffer. */
  markSampleMs: Number(process.env.PERPS_MARK_SAMPLE_MS || 30_000),
  /** How often (ms) open-interest is refreshed from chain (cached between). */
  oiRefreshMs: Number(process.env.PERPS_OI_REFRESH_MS || 60_000),
  /** JSON snapshot file for orderbook + trades + mark history (survives restart). */
  stateFile: process.env.PERPS_STATE_FILE || "",
} as const;
