// Keeper runtime config + viem clients + a serialized, nonce-safe on-chain sender.
//
// The keeper uses a DEDICATED key (KEEPER_PRIVATE_KEY) — separate from the engine
// matcher / counterparty bot — so keeper txs (updatePrice / settleFundingBatch /
// liquidate) never collide with the engine's settleBatch nonce. Reads never throw
// out of the loops: an RPC failure falls back to a secondary RPC, then surfaces as
// a logged skip.

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

// --- Minimal .env loader (systemd env wins; no dotenv dep) ---
(function loadDotEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.KEEPER_ENV_FILE,
    join(here, ".env"),
    join(here, "..", ".env"),
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

export const CFG = {
  chainId: num(process.env.PERPS_CHAIN_ID, 11155111),
  rpcUrl: (process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org").trim(),
  // Sparingly-used fallback RPC (task guidance: drpc primary, 1rpc fallback).
  rpcFallback: (process.env.SEPOLIA_RPC_FALLBACK || "https://1rpc.io/sepolia").trim(),
  marketRegistry: (process.env.MARKET_REGISTRY ||
    "0xEDE278469694e951676973B7b9e193a98463DAC2").trim() as `0x${string}`,
  oracleGuard: (process.env.ORACLE_GUARD ||
    "0x3D2ee857AE129688fA43E378dAE85b60803bfFD1").trim() as `0x${string}`,
  /** NEVER logged. */
  keeperKey: (process.env.KEEPER_PRIVATE_KEY || "").trim(),
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
  // Legacy gas price for Sepolia (predictable + cheap).
  gasPrice: BigInt(num(process.env.KEEPER_GAS_PRICE_WEI, 2_000_000_000)),
  // How many pair ids to settle funding for per settleFundingBatch tx.
  fundingBatchSize: num(process.env.KEEPER_FUNDING_BATCH, 50),
  // Upper bound on pair-id enumeration (nascent markets are tiny).
  pairIdCap: BigInt(num(process.env.KEEPER_PAIR_ID_CAP, 5_000)),
  // Optional explicit market allowlist (comma-separated). Empty = all registry markets.
  onlyMarkets: (process.env.KEEPER_ONLY_MARKETS || "").trim(),
  resultsFile: (process.env.KEEPER_RESULTS_FILE || "").trim(),
} as const;

export function normalizedKeeperKey(): `0x${string}` | "" {
  const k = CFG.keeperKey.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(k)) return "";
  return `0x${k}` as `0x${string}`;
}

const key = normalizedKeeperKey();
export const keeperAccount: Account | null = key ? privateKeyToAccount(key) : null;

export const primaryClient: PublicClient = createPublicClient({ transport: http(CFG.rpcUrl) });
const fallbackClient: PublicClient = createPublicClient({ transport: http(CFG.rpcFallback) });

export const walletClient: WalletClient | null = keeperAccount
  ? createWalletClient({ account: keeperAccount, transport: http(CFG.rpcUrl) })
  : null;

export function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

/** Read with a single fallback-RPC retry on transient/rate-limit failures. */
export async function read<T>(fn: (c: PublicClient) => Promise<T>): Promise<T> {
  try {
    return await fn(primaryClient);
  } catch (e) {
    // One sparing retry on the fallback RPC.
    try {
      return await fn(fallbackClient);
    } catch {
      throw e;
    }
  }
}

// Serialize ALL keeper sends so nonces never collide within the process.
let sendChain: Promise<unknown> = Promise.resolve();

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

/**
 * Simulate-then-send a write, serialized against every other keeper send, with
 * legacy gas. Returns a structured result; NEVER throws (callers stay loop-safe).
 */
export function send(
  address: `0x${string}`,
  abi: any,
  functionName: string,
  args: readonly unknown[],
): Promise<SendResult> {
  const run = async (): Promise<SendResult> => {
    const wallet = walletClient;
    const account = keeperAccount;
    if (!wallet || !account) return { txHash: null, mined: false, reason: "NO_KEEPER_KEY" };
    try {
      const { request } = await primaryClient.simulateContract({
        account,
        address,
        abi,
        functionName,
        args: args as any,
      });
      const hash = await wallet.writeContract({
        ...(request as any),
        gasPrice: CFG.gasPrice,
      });
      const receipt = await primaryClient.waitForTransactionReceipt({ hash });
      return {
        txHash: hash,
        mined: receipt.status === "success",
        reason: receipt.status === "success" ? "MINED" : "REVERTED_ONCHAIN",
      };
    } catch (e) {
      return { txHash: null, mined: false, reason: shortReason(e) };
    }
  };
  const next = sendChain.then(run, run);
  sendChain = next.catch(() => {});
  return next;
}
