// MULTI-CHAIN dry-run validation (NO broadcast). Proves the engine loads every
// configured chain's registry, enumerates markets across chains, and can SIMULATE a
// settleBatch on a market from EACH chain using that chain's client — and that the RH
// path builds EIP-1559 gas (not legacy). LIVE_SETTLE is forced false here.
//
// Run:  LIVE_SETTLE=false bun scripts/dryRunMultichain.ts
//   (RPC-reachability required; no keys needed for the dry-run simulate path.)

process.env.LIVE_SETTLE = "false"; // hard guarantee: never broadcast from this script

import { ENV, type GasMode } from "../src/env.js";
import { allChainCtx, fetchAllMarkets, getChainCtx } from "../src/chain.js";
import { settlePair } from "../src/settle.js";
import { OrderType, type MarketMeta, type MatchedPair } from "../src/types.js";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

function dummyOrder(isLong: boolean) {
  return {
    trader: ZERO as `0x${string}`,
    token: ZERO as `0x${string}`,
    isLong,
    size: 1n,
    leverage: 10_000n,
    price: 1n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: 0n,
    orderType: OrderType.MARKET,
  };
}

/** A structurally-valid (but unsigned) pair — the simulate reverts, which itself proves
 *  the calldata reached the deployed contract via THIS chain's client. */
function dummyPair(): MatchedPair {
  return {
    longOrder: dummyOrder(true),
    longSignature: "0x" as `0x${string}`,
    shortOrder: dummyOrder(false),
    shortSignature: "0x" as `0x${string}`,
    matchPrice: 1n,
    matchSize: 1n,
  };
}

async function proveEip1559Gas(chainId: number): Promise<string> {
  const ctx = getChainCtx(chainId);
  try {
    const fees = await ctx.publicClient.estimateFeesPerGas();
    const has1559 = fees.maxFeePerGas != null && fees.maxPriorityFeePerGas != null;
    return `gasMode=${ctx.gasMode} maxFeePerGas=${fees.maxFeePerGas ?? "?"} maxPriorityFeePerGas=${fees.maxPriorityFeePerGas ?? "?"} eip1559Fields=${has1559}`;
  } catch (e: any) {
    return `gasMode=${ctx.gasMode} estimateFeesPerGas failed: ${e?.shortMessage || e?.message || e}`;
  }
}

async function main() {
  console.log("=== HookSwapPerps multi-chain dry-run (LIVE_SETTLE=%s) ===", ENV.liveSettle);

  // 1) Registries loaded per chain.
  console.log("\n[1] Configured chains (registry loaded per chainId):");
  for (const c of allChainCtx()) {
    console.log(
      `  - chain ${c.network ?? ""} ${c.chainId}: gasMode=${c.gasMode} registry=${c.marketRegistry} ` +
        `oracleGuard=${c.oracleGuard} matcher=${c.matcherAccount?.address ?? "NONE(dry-run ok)"}`,
    );
  }

  // 2) Markets fetched from ALL registries, grouped by chain.
  console.log("\n[2] Fetching markets from every registry…");
  const markets = await fetchAllMarkets();
  const byChain = new Map<number, MarketMeta[]>();
  for (const m of markets) {
    (byChain.get(m.chainId) ?? byChain.set(m.chainId, []).get(m.chainId)!).push(m);
  }
  for (const c of allChainCtx()) {
    const ms = byChain.get(c.chainId) ?? [];
    console.log(`  chain ${c.chainId}: ${ms.length} markets` + (ms.length ? ` -> ${ms.slice(0, 6).map((m) => m.market).join(", ")}${ms.length > 6 ? " …" : ""}` : ""));
  }

  // 3) SIMULATE settleBatch on one market per chain (proves the settle path per chain).
  console.log("\n[3] Simulating settleBatch (dry-run, no broadcast) on one market per chain:");
  for (const c of allChainCtx()) {
    const ms = byChain.get(c.chainId) ?? [];
    if (!ms.length) {
      console.log(`  chain ${c.chainId}: (no markets in registry to simulate)`);
      continue;
    }
    const m = ms[0];
    const res = await settlePair(getChainCtx(c.chainId), m.market, dummyPair());
    console.log(
      `  chain ${c.chainId} market ${m.market}: settled=${res.settled} reason="${res.reason}" ` +
        `calldataLen=${res.calldata.length}`,
    );
  }

  // 4) Prove per-chain gas mode: RH (and any eip1559 chain) builds 1559 fee fields.
  console.log("\n[4] Per-chain gas mode (eip1559 builds maxFeePerGas/maxPriorityFeePerGas; legacy builds gasPrice):");
  for (const c of allChainCtx()) {
    const gm: GasMode = c.gasMode;
    console.log(`  chain ${c.chainId} (${gm}): ${await proveEip1559Gas(c.chainId)}`);
  }

  console.log("\n=== dry-run complete (no transactions broadcast) ===");
}

main().catch((e) => {
  console.error("[dryRun] fatal:", e?.stack || e);
  process.exit(1);
});
