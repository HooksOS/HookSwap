// v4 source adapter — STUB (documented). HookSwap is supportsV4:false today
// (see CLAUDE.md LOCKED DECISION: "v4: EXCLUDE"), so no HookSwap v4 pools exist.
// This is scaffolded so the DEX-integration requirement (Uniswap v4 everywhere,
// Pancake v4/Infinity on BSC) can be turned on WITHOUT touching the engine or
// Settlement.sol — only this file + a market config entry.
//
// WHY IT CAN'T BE LIVE YET:
//  - Uniswap v4 is a SINGLETON PoolManager: pools are not standalone contracts,
//    they are keyed by PoolId = keccak256(abi.encode(PoolKey{currency0,currency1,
//    fee,tickSpacing,hooks})). Spot price is read via the periphery `StateView`
//    contract's getSlot0(poolId) -> (sqrtPriceX96, tick, ...), NOT from the pool
//    address. TWAP requires a hook that exposes an oracle (v4 has no built-in
//    observe()); e.g. a Truncated/Geomean-oracle hook. So a v4 source needs BOTH
//    the StateView address AND (for TWAP) the oracle-hook address per chain.
//  - Pancake v4 (Infinity) is likewise a singleton Vault + CLPoolManager /
//    BinPoolManager; price is read from its own StateView-equivalent by PoolId.
//
// IMPLEMENTATION PLAN (when v4 is unblocked):
//  1. Add a `V4Source` union member with { stateView, poolId, oracleHook? }
//     (or reuse poolAddress = StateView + add poolId).
//  2. getSlot0(poolId) -> sqrtPriceX96 -> reuse sqrtPriceX96ToPrice1e18() (same
//     math as v3; concentrated liquidity is identical Q64.96).
//  3. For TWAP, read the oracle hook's observe()-equivalent -> meanTick ->
//     getSqrtRatioAtTick() (same TickMath as v3Adapter).
// The decimal-normalization + orientation logic is already shared in math.ts,
// so v4 reuses ~all of it. NONE of this touches Settlement.sol.

import type { AmmSourceType, AmmSource, ISourceAdapter, MarkPrice, OracleSource } from "./types";

export class V4Adapter implements ISourceAdapter {
  constructor(public readonly sourceType: AmmSourceType) {}

  async getMarkPrice(source: OracleSource): Promise<MarkPrice> {
    const s = source as AmmSource;
    return {
      price1e18: 0n,
      ok: false,
      source: `${s.sourceType}:${s.poolAddress ?? "singleton"}`,
      reason:
        "V4_NOT_IMPLEMENTED: HookSwap is supportsV4:false. v4 is a singleton PoolManager " +
        "(read via StateView.getSlot0(poolId)); needs {stateView,poolId,oracleHook?} source fields. " +
        "See v4Adapter.ts header for the wiring plan.",
    };
  }
}
