// v4 source adapter — SINGLETON-PoolManager spot price via StateView.getSlot0.
//
// Unlike v2/v3, a v4 pool is NOT a standalone contract: it lives inside a
// singleton PoolManager, keyed by
//     poolId = keccak256(abi.encode(PoolKey{currency0,currency1,fee,tickSpacing,hooks}))
// and its state is read through the periphery `StateView` contract:
//     StateView.getSlot0(poolId) -> (sqrtPriceX96, tick, protocolFee, lpFee).
// The sqrtPriceX96 is Q64.96 exactly like v3, so we reuse the shared
// sqrtPriceX96ToPrice1e18() decimal-normalization (concentrated-liquidity math
// is identical). NO Settlement.sol involvement — turning v4 on is this module +
// a market config entry only.
//
// MULTI-PROTOCOL / MULTI-CHAIN (locked DEX-integration requirement):
//  - Covers uniswap-v4 (all chains), pancake-v4 / Infinity (BSC), and HookSwap's
//    own v4 ("hook-v4") on the HookSwap chains — the ONE adapter serves all three
//    because the StateView.getSlot0 ABI + PoolId hashing are identical.
//  - The StateView (and PoolManager) address is resolved per (chain, protocol):
//    the V4Source config value wins; else the per-chain fallback table
//    (v4Deployments.ts). Missing both -> { ok:false }, never a hardcoded DEX.
//
// v4 has no built-in observe(); TWAP would require an oracle-hook, so this path
// reads slot0 SPOT only (twapWindow is reserved on V4Source, ignored here).
// Any missing address / revert / uninitialized pool returns { ok:false } — this
// adapter never fabricates a price.

import { encodeAbiParameters, getAddress, keccak256, type Address } from "viem";
import type { ISourceAdapter, MarkPrice, OracleSource, V4Source, V4SourceType } from "./types";
import { V4_STATE_VIEW_ABI, ERC20_ABI } from "./abis";
import { clientFor } from "./rpc";
import { sqrtPriceX96ToPrice1e18 } from "./math";
import { getV4Deployment } from "./v4Deployments";

const NATIVE = getAddress("0x0000000000000000000000000000000000000000");

/**
 * PoolId = keccak256(abi.encode(PoolKey)). Matches Uniswap v4 PoolIdLibrary.toId
 * (`keccak256(poolKey, 0xa0)` — the 5 fields as consecutive 32-byte memory words),
 * which is byte-identical to abi.encode(currency0,currency1,fee,tickSpacing,hooks).
 * Currencies MUST be the canonical PoolKey order (currency0 < currency1).
 */
export function computeV4PoolId(
  currency0: Address,
  currency1: Address,
  fee: number,
  tickSpacing: number,
  hooks: Address,
): `0x${string}` {
  const encoded = encodeAbiParameters(
    [
      { type: "address" }, // currency0
      { type: "address" }, // currency1
      { type: "uint24" }, //  fee
      { type: "int24" }, //   tickSpacing
      { type: "address" }, // hooks
    ],
    [currency0, currency1, fee, tickSpacing, hooks],
  );
  return keccak256(encoded);
}

/** decimals() for a currency; native (address(0)) is 18 by convention. */
async function currencyDecimals(client: ReturnType<typeof clientFor>, token: Address): Promise<number> {
  if (token === NATIVE) return 18;
  const d = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" });
  return Number(d);
}

export class V4Adapter implements ISourceAdapter {
  constructor(public readonly sourceType: V4SourceType) {}

  async getMarkPrice(source: OracleSource): Promise<MarkPrice> {
    const s = source as V4Source;
    const debug = `${s.sourceType}:${s.chainId}`;
    try {
      // Canonical PoolKey order: currency0 < currency1 (v4 requirement).
      const a = getAddress(s.currency0);
      const b = getAddress(s.currency1);
      const [currency0, currency1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
      const hooks = getAddress(s.hooks);

      const quote = getAddress(s.quoteToken);
      const quoteIsToken1 = quote === currency1;
      if (!quoteIsToken1 && quote !== currency0) {
        return { price1e18: 0n, ok: false, source: debug, reason: "QUOTE_NOT_IN_POOL" };
      }

      // Resolve StateView per (chain, protocol): config value first, else fallback.
      const fallback = getV4Deployment(s.sourceType, s.chainId);
      const stateView = s.stateView ? getAddress(s.stateView) : fallback?.stateView;
      if (!stateView) {
        return {
          price1e18: 0n,
          ok: false,
          source: debug,
          reason: `STATEVIEW_UNKNOWN: set source.stateView for ${s.sourceType} on chain ${s.chainId}`,
        };
      }

      const poolId = computeV4PoolId(currency0, currency1, s.fee, s.tickSpacing, hooks);
      const client = clientFor(s.chainId);

      const [dec0, dec1] = await Promise.all([
        currencyDecimals(client, currency0),
        currencyDecimals(client, currency1),
      ]);

      const slot0 = (await client.readContract({
        address: stateView,
        abi: V4_STATE_VIEW_ABI,
        functionName: "getSlot0",
        args: [poolId],
      })) as unknown as readonly [bigint, number, number, number];

      const sqrtPriceX96 = slot0[0];
      if (sqrtPriceX96 === 0n) {
        // sqrtPriceX96 == 0 => pool never initialized under this PoolKey.
        return {
          price1e18: 0n,
          ok: false,
          source: `${debug} poolId=${poolId}`,
          reason: "POOL_UNINITIALIZED",
        };
      }

      const price1e18 = sqrtPriceX96ToPrice1e18(sqrtPriceX96, dec0, dec1, quoteIsToken1);
      if (price1e18 === 0n) {
        return { price1e18: 0n, ok: false, source: `${debug} poolId=${poolId}`, reason: "ZERO_PRICE" };
      }
      return { price1e18, ok: true, source: `${debug} stateView=${stateView} poolId=${poolId} (spot)` };
    } catch (err) {
      return { price1e18: 0n, ok: false, source: debug, reason: `RPC_ERROR:${(err as Error).message}` };
    }
  }
}
