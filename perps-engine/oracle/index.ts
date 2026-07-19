// HookSwapPerps multi-DEX oracle adapter — entry point.
//
// SpotOracleAdapter implements ISpotOracleAdapter.getMarkPrice(market) by
// dispatching a per-market OracleRoute to the sub-adapter for its protocol
// (v2 reserves / v3 tick-TWAP / v4 stub). The matching engine consumes the
// scalar `price1e18` as the mark price — no Settlement.sol involvement.

import type { ISpotOracleAdapter, ISubAdapter, MarkPrice, OracleProtocol, OracleRoute } from "./types";
import { V2Adapter } from "./v2Adapter";
import { V3Adapter } from "./v3Adapter";
import { V4Adapter } from "./v4Adapter";

function buildSubAdapters(): Record<OracleProtocol, ISubAdapter> {
  const v2 = (p: OracleProtocol) => new V2Adapter(p);
  const v3 = (p: OracleProtocol) => new V3Adapter(p);
  const v4 = (p: OracleProtocol) => new V4Adapter(p);
  return {
    "hookswap-v2": v2("hookswap-v2"),
    "uniswap-v2": v2("uniswap-v2"),
    "pancake-v2": v2("pancake-v2"),
    "hookswap-v3": v3("hookswap-v3"),
    "uniswap-v3": v3("uniswap-v3"),
    "pancake-v3": v3("pancake-v3"),
    "uniswap-v4": v4("uniswap-v4"),
    "pancake-v4": v4("pancake-v4"),
  };
}

export class SpotOracleAdapter implements ISpotOracleAdapter {
  private readonly subs: Record<OracleProtocol, ISubAdapter>;
  private readonly routes: Map<string, OracleRoute>;

  constructor(routes: OracleRoute[]) {
    this.subs = buildSubAdapters();
    this.routes = new Map(routes.map((r) => [r.market, r]));
  }

  /** Register / replace a market route at runtime. */
  setRoute(route: OracleRoute): void {
    this.routes.set(route.market, route);
  }

  hasRoute(market: string): boolean {
    return this.routes.has(market);
  }

  async getMarkPrice(market: string): Promise<MarkPrice> {
    const route = this.routes.get(market);
    if (!route) {
      return { price1e18: 0n, ok: false, reason: `NO_ROUTE:${market}` };
    }
    const sub = this.subs[route.protocol];
    if (!sub) {
      return { price1e18: 0n, ok: false, reason: `NO_ADAPTER:${route.protocol}` };
    }
    return sub.price(route);
  }
}

export * from "./types";
export { loadHookSwapDeployments, getHookSwapChain, computeHookSwapV2Pair } from "./deployments";
export { loadRoutes } from "./routes";
