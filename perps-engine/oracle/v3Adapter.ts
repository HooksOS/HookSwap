// v3 sub-adapter — concentrated-liquidity price.
// Default: arithmetic-mean-tick TWAP over [twapWindow, 0] via observe(),
// converted through the canonical TickMath port (1.0001^tick). Falls back to
// slot0 spot if the pool lacks TWAP history (observe reverts / cardinality 1).
// Covers hookswap-v3, uniswap-v3, pancake-v3 (identical UniswapV3Pool ABI).

import { getAddress } from "viem";
import type { ISubAdapter, MarkPrice, OracleProtocol, OracleRoute } from "./types";
import { V3_POOL_ABI, ERC20_ABI } from "./abis";
import { clientFor } from "./rpc";
import { sqrtPriceX96ToPrice1e18, getSqrtRatioAtTick, meanTick } from "./math";

const DEFAULT_TWAP_WINDOW = 1800; // 30 min

export class V3Adapter implements ISubAdapter {
  constructor(public readonly protocol: OracleProtocol) {}

  async price(route: OracleRoute): Promise<MarkPrice> {
    const window = route.twapWindow ?? DEFAULT_TWAP_WINDOW;
    const source = `${route.protocol}:${route.poolAddress} twap=${window}s`;
    try {
      const client = clientFor(route.chainId);
      const pool = { address: route.poolAddress, abi: V3_POOL_ABI } as const;

      const [token0, token1] = await Promise.all([
        client.readContract({ ...pool, functionName: "token0" }),
        client.readContract({ ...pool, functionName: "token1" }),
      ]);

      const quote = getAddress(route.quoteToken);
      const t0 = getAddress(token0 as `0x${string}`);
      const t1 = getAddress(token1 as `0x${string}`);
      const quoteIsToken1 = quote === t1;
      if (!quoteIsToken1 && quote !== t0) {
        return { price1e18: 0n, ok: false, source, reason: "QUOTE_NOT_IN_POOL" };
      }

      const [dec0, dec1] = await Promise.all([
        client.readContract({ address: t0, abi: ERC20_ABI, functionName: "decimals" }),
        client.readContract({ address: t1, abi: ERC20_ABI, functionName: "decimals" }),
      ]);

      // Preferred: TWAP arithmetic-mean tick.
      let sqrtPriceX96: bigint;
      let mode = "twap";
      try {
        const res = (await client.readContract({
          ...pool,
          functionName: "observe",
          args: [[window, 0]],
        })) as unknown as [readonly bigint[], readonly bigint[]];
        const avgTick = meanTick(res[0], window);
        sqrtPriceX96 = getSqrtRatioAtTick(avgTick);
      } catch {
        // Fallback: slot0 spot (pool has no observation window yet).
        const slot0 = (await client.readContract({ ...pool, functionName: "slot0" })) as unknown as [
          bigint,
          number,
        ];
        sqrtPriceX96 = slot0[0];
        mode = "spot-fallback";
      }

      if (sqrtPriceX96 === 0n) {
        return { price1e18: 0n, ok: false, source, reason: "NO_LIQUIDITY" };
      }

      const price1e18 = sqrtPriceX96ToPrice1e18(sqrtPriceX96, Number(dec0), Number(dec1), quoteIsToken1);
      if (price1e18 === 0n) return { price1e18: 0n, ok: false, source, reason: "ZERO_PRICE" };
      return { price1e18, ok: true, source: `${source} (${mode})` };
    } catch (err) {
      return { price1e18: 0n, ok: false, source, reason: `RPC_ERROR:${(err as Error).message}` };
    }
  }
}
