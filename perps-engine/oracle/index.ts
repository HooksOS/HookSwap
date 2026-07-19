// HookSwapPerps pluggable oracle — entry point.
//
// SpotOracleAdapter implements ISpotOracleAdapter.getMarkPrice(market) by:
//   1. looking up the market's MarketConfig (config-driven registry), then
//   2. dispatching its oracle source to the adapter registered for that
//      `sourceType` (AMM v2/v3/v4 OR Chainlink/Pyth/API/0x-RFQ).
// The matching engine consumes the scalar `price1e18` as the mark price — no
// Settlement.sol involvement. Adding a market/venue/RWA/stock is config + an
// off-chain adapter module, never a contract redeploy (see EXTENSIBILITY.md).

import type { ISpotOracleAdapter, MarketConfig, MarkPrice, OracleRoute } from "./types";
import { AdapterRegistry, defaultRegistry } from "./registry";
import { routeToMarket } from "./routes";

export class SpotOracleAdapter implements ISpotOracleAdapter {
  private readonly registry: AdapterRegistry;
  private readonly markets: Map<string, MarketConfig>;

  /**
   * @param markets  fully-described markets (from loadMarkets()).
   * @param registry adapter registry; defaults to the full shipped set.
   */
  constructor(markets: MarketConfig[], registry: AdapterRegistry = defaultRegistry()) {
    this.registry = registry;
    this.markets = new Map(markets.map((m) => [m.market, m]));
  }

  /** Register / replace a market at runtime. */
  setMarket(market: MarketConfig): void {
    this.markets.set(market.market, market);
  }

  /** Back-compat: register a legacy flat AMM route (lifted to a MarketConfig). */
  setRoute(route: OracleRoute): void {
    this.setMarket(routeToMarket(route));
  }

  hasMarket(market: string): boolean {
    return this.markets.has(market);
  }

  getMarket(market: string): MarketConfig | undefined {
    return this.markets.get(market);
  }

  async getMarkPrice(market: string): Promise<MarkPrice> {
    const cfg = this.markets.get(market);
    if (!cfg) {
      return { price1e18: 0n, ok: false, reason: `NO_MARKET:${market}` };
    }
    const adapter = this.registry.get(cfg.oracle.sourceType);
    if (!adapter) {
      return { price1e18: 0n, ok: false, reason: `NO_ADAPTER:${cfg.oracle.sourceType}` };
    }
    return adapter.getMarkPrice(cfg.oracle);
  }
}

export * from "./types";
export { AdapterRegistry, defaultRegistry } from "./registry";
export { loadMarkets } from "./config";
export { loadRoutes, routeToMarket } from "./routes";
export { loadHookSwapDeployments, getHookSwapChain, computeHookSwapV2Pair } from "./deployments";

// Individual adapters (for custom registries / plugins).
export { V2Adapter } from "./v2Adapter";
export { V3Adapter } from "./v3Adapter";
export { V4Adapter } from "./v4Adapter";
export { ChainlinkAdapter } from "./chainlinkAdapter";
export { PythAdapter } from "./pythAdapter";
export { ApiAdapter } from "./apiAdapter";
export { ZeroxRfqAdapter } from "./zeroxRfqAdapter";
