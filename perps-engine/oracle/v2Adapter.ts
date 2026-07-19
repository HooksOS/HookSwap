// v2 sub-adapter — constant-product spot price from getReserves().
// Covers hookswap-v2, uniswap-v2, pancake-v2 (identical UniswapV2Pair ABI).

import { getAddress } from "viem";
import type { ISubAdapter, MarkPrice, OracleProtocol, OracleRoute } from "./types";
import { V2_PAIR_ABI, ERC20_ABI } from "./abis";
import { clientFor } from "./rpc";
import { v2Price1e18 } from "./math";

export class V2Adapter implements ISubAdapter {
  constructor(public readonly protocol: OracleProtocol) {}

  async price(route: OracleRoute): Promise<MarkPrice> {
    const source = `${route.protocol}:${route.poolAddress}`;
    try {
      const client = clientFor(route.chainId);
      const pair = { address: route.poolAddress, abi: V2_PAIR_ABI } as const;

      const [token0, token1, reserves] = await Promise.all([
        client.readContract({ ...pair, functionName: "token0" }),
        client.readContract({ ...pair, functionName: "token1" }),
        client.readContract({ ...pair, functionName: "getReserves" }),
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

      const [reserve0, reserve1] = reserves as unknown as [bigint, bigint, number];
      if (reserve0 === 0n || reserve1 === 0n) {
        return { price1e18: 0n, ok: false, source, reason: "NO_LIQUIDITY" };
      }

      const price1e18 = v2Price1e18(reserve0, reserve1, Number(dec0), Number(dec1), quoteIsToken1);
      if (price1e18 === 0n) return { price1e18: 0n, ok: false, source, reason: "ZERO_PRICE" };
      return { price1e18, ok: true, source };
    } catch (err) {
      return { price1e18: 0n, ok: false, source, reason: `RPC_ERROR:${(err as Error).message}` };
    }
  }
}
