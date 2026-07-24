// Keeper runtime config + PER-CHAIN viem clients + a serialized, nonce-safe sender.
//
// MULTI-CHAIN: the keeper sweeps liquidation + funding across EVERY configured
// chain. Each chain gets a KeeperChainCtx (primary+fallback client, wallet, keeper
// account, registry, oracleGuard, gasMode). Source order matches the engine:
//   1. PERPS_CHAINS_CONFIG=<path> or config/chains.json (with a `keeperKeyEnv` per
//      entry naming the env var that holds THAT chain's keeper key).
//   2. BACKWARD-COMPAT — synthesize ONE chain from the legacy keeper env vars.
//
// The keeper uses a DEDICATED key per chain (separate from the engine matcher / bot)
// so keeper txs (updatePrice / settleFundingBatch / liquidate) never collide with the
// engine's settleBatch nonce. Sends are serialized PER CHAIN (independent chains run
// in parallel; a chain's own nonces never collide). Reads fall back to a secondary RPC.

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HERE = dirname(fileURLToPath(import.meta.url));

// --- Minimal .env loader (systemd env wins; no dotenv dep) ---
(function loadDotEnv() {
  const candidates = [
    process.env.KEEPER_ENV_FILE,
    join(HERE, ".env"),
    join(HERE, "..", ".env"),
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

/** GLOBAL policy knobs (cadences, thresholds) — NOT per-chain connection details. */
export const CFG = {
  // Loop cadences.
  liquidationLoopMs: num(process.env.KEEPER_LIQ_LOOP_MS, 25_000),
  fundingLoopMs: num(process.env.KEEPER_FUNDING_LOOP_MS, 60_000),
  marketRefreshMs: num(process.env.KEEPER_MARKET_REFRESH_MS, 120_000),
  // Mark-refresh policy: refresh the on-chain mark only when it is 0 or drifts
  // beyond this many bps from the Chainlink reference (kept well inside the
  // OracleGuard band so a valid, in-band mark always exists for canLiquidate).
  markRefreshBps: BigInt(num(process.env.KEEPER_MARK_REFRESH_BPS, 250)),
  // Max chainlink round age (s) before the keeper treats the feed as unusable.
  maxFeedStaleSecs: BigInt(num(process.env.KEEPER_MAX_FEED_STALE, 86_400)),
  // Default LEGACY gas price (wei) — used only on chains whose gasMode is 'legacy'.
  gasPrice: BigInt(num(process.env.KEEPER_GAS_PRICE_WEI, 2_000_000_000)),
  // Max ms to wait for a tx receipt before treating the wait as failed.
  receiptTimeoutMs: num(process.env.KEEPER_RECEIPT_TIMEOUT_MS, 120_000),
  // How many pair ids to settle funding for per settleFundingBatch tx.
  fundingBatchSize: num(process.env.KEEPER_FUNDING_BATCH, 50),
  // Upper bound on pair-id enumeration (nascent markets are tiny).
  pairIdCap: BigInt(num(process.env.KEEPER_PAIR_ID_CAP, 5_000)),
  // Optional explicit market allowlist (comma-separated). Empty = all registry markets.
  onlyMarkets: (process.env.KEEPER_ONLY_MARKETS || "").trim(),
  resultsFile: (process.env.KEEPER_RESULTS_FILE || "").trim(),
} as const;

export type GasMode = "eip1559" | "legacy";

export interface KeeperChainCtx {
  chainId: number;
  network?: string;
  marketRegistry: `0x${string}`;
  oracleGuard: `0x${string}`;
  gasMode: GasMode;
  primaryClient: PublicClient;
  fallbackClient: PublicClient;
  keeperAccount: Account | null;
  walletClient: WalletClient | null;
}

// Public fallback RPCs (kept in sync with oracle/rpc.ts DEFAULT_RPCS).
const DEFAULT_RPCS: Record<number, string> = {
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  4663: "https://rpc.mainnet.chain.robinhood.com",
  999: "https://rpc.hyperliquid.xyz/evm",
  57073: "https://rpc-gel.inkonchain.com",
  196: "https://rpc.xlayer.tech",
};

function normalizeKey(raw: string | undefined): `0x${string}` | "" {
  const k = (raw || "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(k)) return "";
  return `0x${k}` as `0x${string}`;
}

function normalizeGasMode(v: unknown, dflt: GasMode): GasMode {
  const s = String(v ?? "").toLowerCase();
  if (s === "legacy") return "legacy";
  if (s === "eip1559") return "eip1559";
  return dflt;
}

function buildCtx(e: {
  chainId: number;
  network?: string;
  rpcUrl: string;
  rpcFallback?: string;
  marketRegistry: `0x${string}`;
  oracleGuard: `0x${string}`;
  gasMode: GasMode;
  keeperKey: `0x${string}` | "";
}): KeeperChainCtx {
  const primaryClient: PublicClient = createPublicClient({ transport: http(e.rpcUrl) });
  const fallbackClient: PublicClient = createPublicClient({
    transport: http(e.rpcFallback || e.rpcUrl),
  });
  const keeperAccount: Account | null = e.keeperKey ? privateKeyToAccount(e.keeperKey) : null;
  const walletClient: WalletClient | null = keeperAccount
    ? createWalletClient({ account: keeperAccount, transport: http(e.rpcUrl) })
    : null;
  return {
    chainId: e.chainId,
    network: e.network,
    marketRegistry: e.marketRegistry,
    oracleGuard: e.oracleGuard,
    gasMode: e.gasMode,
    primaryClient,
    fallbackClient,
    keeperAccount,
    walletClient,
  };
}

function resolveRpc(chainId: number, rpcUrlEnv: string | undefined, rpcUrl: string | undefined): string {
  const fromEnv = rpcUrlEnv ? (process.env[rpcUrlEnv] || "").trim() : "";
  const url = fromEnv || (rpcUrl || "").trim() || DEFAULT_RPCS[chainId] || "";
  if (!url) throw new Error(`keeper: no RPC for chainId ${chainId}`);
  return url;
}

function loadChainsFromConfig(): KeeperChainCtx[] | null {
  const explicit = (process.env.PERPS_CHAINS_CONFIG || "").trim();
  const candidates = [explicit, join(HERE, "..", "config", "chains.json")].filter(Boolean) as string[];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const arr = Array.isArray(raw) ? raw : raw?.chains;
    if (!Array.isArray(arr) || arr.length === 0) throw new Error(`keeper chains config ${path} empty/invalid`);
    return arr.map((e: any, i: number) => {
      const chainId = Number(e?.chainId);
      if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`chains[${i}].chainId invalid`);
      // keeperKeyEnv names the env var holding this chain's keeper key; fall back to
      // the global KEEPER_PRIVATE_KEY when an entry omits it.
      const keeperKeyEnv = String(e?.keeperKeyEnv || "KEEPER_PRIVATE_KEY").trim();
      return buildCtx({
        chainId,
        network: e?.network ? String(e.network) : undefined,
        rpcUrl: resolveRpc(chainId, e?.rpcUrlEnv, e?.rpcUrl),
        rpcFallback: e?.rpcFallbackEnv
          ? (process.env[String(e.rpcFallbackEnv)] || "").trim() || String(e?.rpcFallback || "").trim()
          : String(e?.rpcFallback || "").trim(),
        marketRegistry: String(e?.marketRegistry).trim() as `0x${string}`,
        oracleGuard: String(e?.oracleGuard).trim() as `0x${string}`,
        gasMode: normalizeGasMode(e?.gasMode, "eip1559"),
        keeperKey: normalizeKey(process.env[keeperKeyEnv]),
      });
    });
  }
  return null;
}

/** BACKWARD-COMPAT single chain from the legacy keeper env vars (default Sepolia, legacy gas). */
function synthesizeSingleChain(): KeeperChainCtx[] {
  const chainId = num(process.env.PERPS_CHAIN_ID, 11155111);
  return [
    buildCtx({
      chainId,
      network: process.env.PERPS_NETWORK || undefined,
      rpcUrl: (process.env.SEPOLIA_RPC_URL || DEFAULT_RPCS[chainId] || "https://sepolia.drpc.org").trim(),
      rpcFallback: (process.env.SEPOLIA_RPC_FALLBACK || "https://1rpc.io/sepolia").trim(),
      marketRegistry: (process.env.MARKET_REGISTRY ||
        "0xEDE278469694e951676973B7b9e193a98463DAC2").trim() as `0x${string}`,
      oracleGuard: (process.env.ORACLE_GUARD ||
        "0x3D2ee857AE129688fA43E378dAE85b60803bfFD1").trim() as `0x${string}`,
      // Preserve the legacy keeper's Sepolia behavior (legacy gasPrice) unless overridden.
      gasMode: normalizeGasMode(process.env.KEEPER_GAS_MODE, "legacy"),
      keeperKey: normalizeKey(process.env.KEEPER_PRIVATE_KEY),
    }),
  ];
}

const CHAINS: KeeperChainCtx[] = loadChainsFromConfig() ?? synthesizeSingleChain();
const REGISTRY = new Map<number, KeeperChainCtx>(CHAINS.map((c) => [c.chainId, c]));

export function allKeeperChains(): KeeperChainCtx[] {
  return [...REGISTRY.values()];
}
export function getKeeperCtx(chainId: number): KeeperChainCtx {
  const ctx = REGISTRY.get(chainId);
  if (!ctx) throw new Error(`keeper: chainId ${chainId} not configured`);
  return ctx;
}

export function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

/** Read on a chain with a single fallback-RPC retry on transient/rate-limit failures. */
export async function read<T>(chainId: number, fn: (c: PublicClient) => Promise<T>): Promise<T> {
  const ctx = getKeeperCtx(chainId);
  try {
    return await fn(ctx.primaryClient);
  } catch (e) {
    try {
      return await fn(ctx.fallbackClient);
    } catch {
      throw e;
    }
  }
}

// Serialize keeper sends PER CHAIN so a chain's nonces never collide, while different
// chains send independently.
const sendChains = new Map<number, Promise<unknown>>();

export interface SendResult {
  txHash: Hash | null;
  mined: boolean;
  reason: string;
}

export function shortReason(e: any): string {
  const name = e?.cause?.data?.errorName || e?.data?.errorName || e?.cause?.name;
  if (name) return String(name);
  const s = e?.shortMessage || e?.details || e?.message || String(e);
  return String(s).replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Per-chain gas fields: legacy → gasPrice; eip1559 → maxFeePerGas/maxPriorityFeePerGas. */
async function gasOverrides(ctx: KeeperChainCtx): Promise<Record<string, bigint>> {
  if (ctx.gasMode === "legacy") return { gasPrice: CFG.gasPrice };
  try {
    const fees = await ctx.primaryClient.estimateFeesPerGas();
    const out: Record<string, bigint> = {};
    if (fees.maxFeePerGas != null) out.maxFeePerGas = fees.maxFeePerGas;
    if (fees.maxPriorityFeePerGas != null) out.maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
    return out;
  } catch {
    return {};
  }
}

/**
 * Simulate-then-send a write on `chainId`, serialized against every other send on THAT
 * chain, with per-chain gas. Returns a structured result; NEVER throws (loop-safe).
 */
export function send(
  chainId: number,
  address: `0x${string}`,
  abi: any,
  functionName: string,
  args: readonly unknown[],
): Promise<SendResult> {
  const run = async (): Promise<SendResult> => {
    const ctx = getKeeperCtx(chainId);
    const wallet = ctx.walletClient;
    const account = ctx.keeperAccount;
    if (!wallet || !account) return { txHash: null, mined: false, reason: "NO_KEEPER_KEY" };
    try {
      const { request } = await ctx.primaryClient.simulateContract({
        account,
        address,
        abi,
        functionName,
        args: args as any,
      });
      const gas = await gasOverrides(ctx);
      const hash = await wallet.writeContract({ ...(request as any), ...gas });
      const receipt = await ctx.primaryClient.waitForTransactionReceipt({
        hash,
        timeout: CFG.receiptTimeoutMs,
      });
      return {
        txHash: hash,
        mined: receipt.status === "success",
        reason: receipt.status === "success" ? "MINED" : "REVERTED_ONCHAIN",
      };
    } catch (e) {
      return { txHash: null, mined: false, reason: shortReason(e) };
    }
  };
  const prev = sendChains.get(chainId) ?? Promise.resolve();
  const next = prev.then(run, run);
  sendChains.set(chainId, next.catch(() => {}));
  return next;
}
