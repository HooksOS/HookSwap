// HookSwapPerps — multi-DEX oracle adapter: shared types.
//
// The P2P matching engine (Settlement.sol model) consumes a SCALAR mark price
// OFF-CHAIN. This adapter layer turns any supported spot venue (v2 reserves /
// v3 tick-TWAP / v4 slot0) into a single decimal-normalized `price1e18`.
// There is NO Settlement.sol change — the engine reads getMarkPrice() and uses
// the result as the exit/liquidation/funding reference price.

/** A mark price scaled to 1e18 (quote token per 1 base token). */
export interface MarkPrice {
  /** Quote-per-base, scaled to 1e18. Valid only when `ok` is true. */
  price1e18: bigint;
  /** true = usable price; false = adapter could not produce one (see `reason`). */
  ok: boolean;
  /** Debug provenance, e.g. "hookswap-v3:0xabc… twap=1800s". */
  source?: string;
  /** Populated when ok=false (e.g. "STALE", "NO_LIQUIDITY", "RPC_ERROR"). */
  reason?: string;
}

/**
 * The common adapter contract the engine programs against.
 * Every venue (v2/v3/v4, HookSwap/Uniswap/Pancake) is reachable through this.
 */
export interface ISpotOracleAdapter {
  /**
   * Resolve the mark price for a perp market symbol (e.g. "ETH-PERP").
   * Returns { ok:false } instead of throwing on any recoverable failure so the
   * engine can fall back / hold, never settle on a fabricated number.
   */
  getMarkPrice(market: string): Promise<MarkPrice>;
}

/** DEX protocols the oracle route layer understands. v4 = documented stubs. */
export type OracleProtocol =
  | "hookswap-v2"
  | "hookswap-v3"
  | "uniswap-v2"
  | "uniswap-v3"
  | "pancake-v2"
  | "pancake-v3"
  | "uniswap-v4" // stub — HookSwap is supportsV4:false today; see v4Adapter.ts
  | "pancake-v4"; // stub — Pancake Infinity singleton; see v4Adapter.ts

/**
 * Per-market oracle route config. One market resolves through exactly one route
 * (the engine may hold several routes per market for cross-checking, out of scope here).
 */
export interface OracleRoute {
  /** Perp market symbol this route prices, e.g. "ETH-PERP". */
  market: string;
  /** EVM chain the spot pool lives on (e.g. 11155111 Sepolia, 4663 Robinhood). */
  chainId: number;
  /** Spot venue + version. */
  protocol: OracleProtocol;
  /** The spot pool / pair contract address. */
  poolAddress: `0x${string}`;
  /**
   * Which of the pool's two tokens is the QUOTE (numeraire) — usually a stable
   * or WETH. The OTHER token is the base the perp tracks. Orientation is derived
   * from this vs. the pool's token0/token1, so no manual `invert` flag is needed.
   */
  quoteToken: `0x${string}`;
  /**
   * TWAP window in seconds for v3/v4 (arithmetic-mean-tick over [window, 0]).
   * Ignored by v2 (spot reserves). Defaults to 1800 (30 min) if omitted.
   */
  twapWindow?: number;
}

/** Sub-adapter interface: given a route, produce a price. */
export interface ISubAdapter {
  readonly protocol: OracleProtocol;
  price(route: OracleRoute): Promise<MarkPrice>;
}
