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
// in parallel; a chain's own nonces never collide).
//
// RPC: reads auto-fail over across an ORDERED LIST of public endpoints (was a single
// primary + single fallback). The list comes from src/rpc/endpoints.ts; the transport
// from src/rpc/failover.ts. WRITES (liquidate / updatePrice / settleFundingBatch) stay
// PINNED to one endpoint and are never re-broadcast elsewhere — see the WRITE SAFETY
// block in src/rpc/failover.ts.

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { type Account, type Hash, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveRpcList } from "../src/rpc/endpoints.js";
import {
  createFailoverPublicClient,
  createFailoverWalletClient,
} from "../src/rpc/failover.js";

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
  /** ORDERED endpoint list this chain fails over across. */
  rpcUrls: string[];
  /**
   * Failover-backed read client (tries every endpoint in `rpcUrls`).
   * NOTE: `fallbackClient` is the SAME client now — the failover is inside the
   * transport, so a separate "secondary" client is redundant. Kept as a field so
   * existing call sites compile unchanged.
   */
  primaryClient: PublicClient;
  fallbackClient: PublicClient;
  keeperAccount: Account | null;
  walletClient: WalletClient | null;
}

// NOTE: the per-chain endpoint LISTS live in src/rpc/endpoints.ts (PUBLIC_RPCS).
// The old private single-URL DEFAULT_RPCS map that used to sit here is gone — it
// duplicated (and drifted from) the engine's and the oracle's copies, and pinned
// Sepolia to the now-blacklisted publicnode endpoint.

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
  /** ORDERED endpoint list (already resolved + blacklist-filtered). */
  rpcUrls: string[];
  marketRegistry: `0x${string}`;
  oracleGuard: `0x${string}`;
  gasMode: GasMode;
  keeperKey: `0x${string}` | "";
}): KeeperChainCtx {
  const label = e.network ? `${e.network}/${e.chainId}` : `keeper/${e.chainId}`;
  // ONE shared FailoverProvider per (chain, url list) — the read client and the
  // wallet client use the same instance so the pinned write endpoint (and the
  // nonce read that precedes each broadcast) stay on one consistent node.
  const client: PublicClient = createFailoverPublicClient(e.chainId, e.rpcUrls, label);
  const keeperAccount: Account | null = e.keeperKey ? privateKeyToAccount(e.keeperKey) : null;
  const walletClient: WalletClient | null = keeperAccount
    ? createFailoverWalletClient(keeperAccount, e.chainId, e.rpcUrls, label)
    : null;
  return {
    chainId: e.chainId,
    network: e.network,
    marketRegistry: e.marketRegistry,
    oracleGuard: e.oracleGuard,
    gasMode: e.gasMode,
    rpcUrls: e.rpcUrls,
    primaryClient: client,
    // Same client — failover now lives inside the transport (N endpoints), so the
    // old "one spare client" pattern is subsumed.
    fallbackClient: client,
    keeperAccount,
    walletClient,
  };
}

/**
 * Ordered endpoint list for a keeper chain. Every source may be a single URL or a
 * COMMA-SEPARATED list; precedence rpcUrlEnv → rpcUrls → rpcUrl → rpcFallbackEnv →
 * rpcFallback → the built-in PUBLIC_RPCS list.
 */
function resolveRpcUrls(chainId: number, e: any): string[] {
  return resolveRpcList(chainId, {
    sources: [
      e?.rpcUrlEnv ? process.env[String(e.rpcUrlEnv)] : undefined,
      e?.rpcUrls,
      e?.rpcUrl,
      e?.rpcFallbackEnv ? process.env[String(e.rpcFallbackEnv)] : undefined,
      e?.rpcFallback,
    ],
  });
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
        rpcUrls: resolveRpcUrls(chainId, e),
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
      // All of these accept a comma-separated list; anything they omit is topped
      // up from PUBLIC_RPCS[chainId].
      rpcUrls: resolveRpcList(chainId, {
        sources: [
          process.env.PERPS_RPC_URL,
          process.env[`PERPS_RPC_${chainId}`],
          process.env.SEPOLIA_RPC_URL,
          process.env.SEPOLIA_RPC_FALLBACK,
        ],
      }),
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

/**
 * Read on a chain. Endpoint failover is now handled INSIDE the transport (it walks
 * the whole ordered endpoint list, cooling down failures), so this is a thin
 * wrapper: one extra whole-list retry for a read that still failed everywhere.
 */
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
  /**
   * True when the broadcast failed in a way that leaves it UNKNOWN whether the tx
   * reached the mempool (timeout / socket / HTTP error) rather than being
   * definitively rejected by the node. The keeper does NOT resend in that case —
   * the next loop iteration re-simulates and re-reads on-chain state first.
   */
  ambiguous?: boolean;
}

/**
 * A node-side gas/balance rejection is NOT a contract revert, but viem reports it as one.
 *
 * Real case (Sepolia, 2026-08-03): the keeper wallet held 0.000075 ETH and could not pay for a
 * 153k-gas tx. `eth_call` succeeded; only `eth_estimateGas` WITH maxFeePerGas failed, and the RPCs
 * disagreed on how to say so — drpc `-32003 "out of gas: gas required exceeds"`, tenderly and
 * thirdweb a bare `code 3 "execution reverted"` with NO revert data. viem wrapped all three as
 * `ContractFunctionRevertedError`, so the old code below (which fell through to `cause.name`)
 * printed "ContractFunctionRevertedError" once a minute for 13 days while the actual contract call
 * was fine. That sent an operator hunting a contract bug that did not exist.
 *
 * Rule: only call it a revert when there is decodable revert DATA. An empty-data "revert" is the
 * node refusing the transaction, so surface the underlying message instead. Chain-agnostic — the
 * same misreport would occur on Robinhood.
 */
export function shortReason(e: any): string {
  const decoded = e?.cause?.data?.errorName || e?.data?.errorName;
  if (decoded) return String(decoded);

  const detail = String(
    e?.cause?.details || e?.details || e?.cause?.shortMessage || e?.shortMessage || e?.message || e,
  )
    .replace(/\s+/g, " ")
    .trim();

  if (/insufficient funds|out of gas|gas required exceeds|exceeds .*balance|max fee per gas less than/i.test(detail)) {
    return `INSUFFICIENT_KEEPER_BALANCE: ${detail.slice(0, 160)}`;
  }
  // No decodable revert data → do NOT report viem's class name as if it were a contract error.
  return detail.slice(0, 200) || String(e?.cause?.name || e?.name || "UnknownError");
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
 *
 * ⚠️ WRITE SAFETY: the broadcast itself (eth_sendRawTransaction) is pinned to ONE
 * RPC endpoint and attempted exactly once — the failover transport never re-sends it
 * on a different endpoint (src/rpc/failover.ts). The pending-nonce read that viem
 * performs immediately before the broadcast is served from that SAME pinned endpoint.
 * A failed send returns { mined:false } (with `ambiguous` set when the outcome is
 * unknown) and is NOT retried here; the next keeper loop re-simulates against fresh
 * on-chain state, so a tx that actually landed is detected rather than duplicated.
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

      // Balance preflight. A keeper that cannot pay for gas fails inside writeContract's
      // estimateGas, and the RPCs disagree on how they say so — drpc returns
      // "out of gas: gas required exceeds", while tenderly and thirdweb return a bare
      // "execution reverted" with NO revert data. Sniffing the message is therefore
      // endpoint-dependent and unreliable; checking the balance is not.
      // Real incident (Sepolia): this wallet sat at 0.000075 ETH for 13.6 days emitting a
      // revert-shaped error every 60s while the contract call itself was fine.
      try {
        const [balance, gasEstimate] = await Promise.all([
          ctx.primaryClient.getBalance({ address: account.address }),
          ctx.primaryClient.estimateContractGas({
            account,
            address,
            abi,
            functionName,
            args: args as any,
          } as any),
        ]);
        const unitPrice = (gas.maxFeePerGas ?? gas.gasPrice ?? 0n) as bigint;
        const needed = gasEstimate * unitPrice;
        if (unitPrice > 0n && balance < needed) {
          return {
            txHash: null,
            mined: false,
            reason:
              `INSUFFICIENT_KEEPER_BALANCE: ${account.address} has ${balance} wei, ` +
              `needs ~${needed} wei (${gasEstimate} gas x ${unitPrice} wei) — fund this wallet`,
          };
        }
      } catch {
        // Preflight is advisory only: if the estimate itself fails, fall through and let the
        // real send produce the authoritative error rather than blocking on a probe.
      }

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
    } catch (e: any) {
      // `hookswapSendAmbiguous` is tagged by the failover transport when the
      // broadcast outcome is unknown (the tx may still be in a mempool).
      const ambiguous = e?.hookswapSendAmbiguous === true;
      if (ambiguous) {
        log(
          `[keeper] chain=${chainId} ${functionName} broadcast AMBIGUOUS on ` +
            `${e?.hookswapRpcEndpoint || "?"} — NOT resending; next loop re-checks on-chain state`,
        );
      }
      // A data-less "execution reverted" is ambiguous between a real revert and the node
      // refusing the tx on funds. The pre-send preflight above can itself fail (RPC 429,
      // estimate error), so classify here too, where we always get an answer: read the
      // balance and compare against what this tx would cost. Endpoint-independent, unlike
      // message sniffing (drpc says "out of gas: gas required exceeds"; tenderly and
      // thirdweb say a bare "execution reverted" for the identical condition).
      const reason = shortReason(e);
      if (/execution reverted|out of gas|insufficient funds|gas required exceeds/i.test(reason)) {
        try {
          const unitPrice = ((await gasOverrides(ctx)) as any).maxFeePerGas
            ?? ((await gasOverrides(ctx)) as any).gasPrice
            ?? 0n;
          const balance = await ctx.primaryClient.getBalance({ address: account.address });
          // 153k gas is the measured cost of settleFundingBatch(5 pairs); use it as a floor
          // so we can classify even when estimateGas is the thing that failed.
          const needed = 153_168n * (unitPrice as bigint);
          if ((unitPrice as bigint) > 0n && balance < needed) {
            return {
              txHash: null,
              mined: false,
              ambiguous,
              reason:
                `INSUFFICIENT_KEEPER_BALANCE: ${account.address} has ${balance} wei, needs ` +
                `~${needed} wei — fund this wallet (underlying: ${reason.slice(0, 80)})`,
            };
          }
        } catch {
          // fall through to the raw reason
        }
      }
      return { txHash: null, mined: false, reason, ambiguous };
    }
  };
  const prev = sendChains.get(chainId) ?? Promise.resolve();
  const next = prev.then(run, run);
  sendChains.set(chainId, next.catch(() => {}));
  return next;
}
