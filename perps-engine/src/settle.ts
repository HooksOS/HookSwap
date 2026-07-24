// settleBatch assembly + broadcast, gated by LIVE_SETTLE. PER-CHAIN.
//
// LIVE_SETTLE=false (default): assemble calldata + viem simulateContract (no
//   broadcast). Proves the matcher is authorized and the pair decodes/validates
//   up to the point a real settle would (balance/nonce). NEVER sends.
// LIVE_SETTLE=true: simulate, then writeContract with PER-CHAIN gas, wait for receipt.
//
// GAS (per chain, from ChainCtx.gasMode):
//   - eip1559 (RH + default): maxFeePerGas / maxPriorityFeePerGas from
//     estimateFeesPerGas(). Robinhood is EIP-1559 (~0.12 gwei) — a legacy gasPrice
//     below block base fee reverts "max fee per gas less than block base fee".
//   - legacy: gasPrice from getGasPrice() (only for chains that require it).
//
// One-liner to go live: set LIVE_SETTLE=true in the env and restart. See README.

import { encodeFunctionData, type Hash } from "viem";
import { PERP_MARKET_ABI } from "./abis.js";
import { ENV } from "./env.js";
import type { ChainCtx } from "./chain.js";
import type { MatchedPair } from "./types.js";

export interface SettleResult {
  /** Encoded settleBatch([pair]) calldata (always present). */
  calldata: `0x${string}`;
  /** Mined tx hash when broadcast, else null (simulate-only). */
  txHash: Hash | null;
  /** true = simulate passed (dry-run) OR receipt status success (live). */
  settled: boolean;
  /** Human-readable outcome, e.g. SIMULATED_OK / MINED / revert reason. */
  reason: string;
}

function toTuple(p: MatchedPair) {
  return {
    longOrder: p.longOrder,
    longSignature: p.longSignature,
    shortOrder: p.shortOrder,
    shortSignature: p.shortSignature,
    matchPrice: p.matchPrice,
    matchSize: p.matchSize,
  };
}

function shortReason(e: any): string {
  // Prefer a decoded custom-error name / signature; fall back to the message.
  const name = e?.cause?.data?.errorName || e?.data?.errorName;
  if (name) return String(name);
  const s = e?.shortMessage || e?.details || e?.message || String(e);
  return String(s).replace(/\s+/g, " ").trim().slice(0, 240);
}

/**
 * Per-chain gas fields for a write. eip1559 → maxFeePerGas/maxPriorityFeePerGas;
 * legacy → gasPrice. Estimation failures return {} (viem's own defaults apply).
 */
async function gasOverrides(ctx: ChainCtx): Promise<Record<string, bigint>> {
  try {
    if (ctx.gasMode === "legacy") {
      const gasPrice = await ctx.publicClient.getGasPrice();
      return { gasPrice };
    }
    const fees = await ctx.publicClient.estimateFeesPerGas();
    const out: Record<string, bigint> = {};
    if (fees.maxFeePerGas != null) out.maxFeePerGas = fees.maxFeePerGas;
    if (fees.maxPriorityFeePerGas != null) out.maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
    return out;
  } catch {
    return {};
  }
}

// Serialize live broadcasts PER CHAIN so nonces don't collide within a chain, while
// different chains settle independently (their nonces are separate).
const sendChains = new Map<number, Promise<unknown>>();
function serialize<T>(chainId: number, fn: () => Promise<T>): Promise<T> {
  const prev = sendChains.get(chainId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  sendChains.set(chainId, next.catch(() => {}));
  return next;
}

/** Assemble settleBatch([pair]) calldata and either simulate (default) or send, on ctx's chain. */
export async function settlePair(
  ctx: ChainCtx,
  market: `0x${string}`,
  pair: MatchedPair,
): Promise<SettleResult> {
  const args = [[toTuple(pair)]] as const;
  const calldata = encodeFunctionData({
    abi: PERP_MARKET_ABI,
    functionName: "settleBatch",
    args: args as any,
  });

  if (!ENV.liveSettle) {
    // Dry run: simulate against the real deployed market (no broadcast).
    try {
      await ctx.publicClient.simulateContract({
        account: ctx.matcherAccount ?? undefined,
        address: market,
        abi: PERP_MARKET_ABI,
        functionName: "settleBatch",
        args: args as any,
      });
      return { calldata, txHash: null, settled: true, reason: "SIMULATED_OK" };
    } catch (e) {
      // Expected until traders have on-chain deposits (e.g. InsufficientBalance).
      return { calldata, txHash: null, settled: false, reason: `SIMULATE_REVERT: ${shortReason(e)}` };
    }
  }

  // LIVE path.
  const wallet = ctx.walletClient;
  const account = ctx.matcherAccount;
  if (!wallet || !account) {
    return { calldata, txHash: null, settled: false, reason: "NO_MATCHER_KEY" };
  }

  return serialize(ctx.chainId, async () => {
    try {
      const { request } = await ctx.publicClient.simulateContract({
        account,
        address: market,
        abi: PERP_MARKET_ABI,
        functionName: "settleBatch",
        args: args as any,
      });
      const gas = await gasOverrides(ctx);
      const hash = await wallet.writeContract({ ...(request as any), ...gas });
      // Bounded wait: a stuck/dropped tx throws on timeout (caught below as a
      // failure) rather than hanging the serialized settle queue head-of-line.
      const receipt = await ctx.publicClient.waitForTransactionReceipt({
        hash,
        timeout: ENV.receiptTimeoutMs,
      });
      return {
        calldata,
        txHash: hash,
        settled: receipt.status === "success",
        reason: receipt.status === "success" ? "MINED" : "REVERTED_ONCHAIN",
      };
    } catch (e) {
      return { calldata, txHash: null, settled: false, reason: `SEND_FAILED: ${shortReason(e)}` };
    }
  });
}
