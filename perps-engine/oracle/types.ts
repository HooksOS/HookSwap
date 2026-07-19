// HookSwapPerps — pluggable oracle: shared types.
//
// The P2P matching engine (Settlement.sol model) consumes a SCALAR mark price
// OFF-CHAIN. This layer turns any supported PRICE SOURCE — AMM spot venue
// (v2 reserves / v3 tick-TWAP / v4 slot0) OR external price feed
// (Chainlink / Pyth / signed HTTP API) — into a single decimal-normalized
// `price1e18`. There is NO Settlement.sol change: the engine reads
// getMarkPrice() and uses the result as the exit/liquidation/funding/matchPrice
// reference. Adding a market/venue/RWA/stock is config + an off-chain adapter
// module, never a contract redeploy (see EXTENSIBILITY.md).

/** A mark price scaled to 1e18 (quote token per 1 base unit of the market). */
export interface MarkPrice {
  /** Quote-per-base, scaled to 1e18. Valid only when `ok` is true. */
  price1e18: bigint;
  /** true = usable price; false = adapter could not produce one (see `reason`). */
  ok: boolean;
  /** Debug provenance, e.g. "hookswap-v3:0xabc… twap=1800s" or "chainlink:0xfeed…". */
  source?: string;
  /** Populated when ok=false (e.g. "STALE", "NO_LIQUIDITY", "RPC_ERROR"). */
  reason?: string;
}

// ============================================================
// Source types — the registry key
// ============================================================

/** AMM protocols priced from on-chain pool state. v4 = documented stub. */
export type AmmSourceType =
  | "hookswap-v2"
  | "hookswap-v3"
  | "uniswap-v2"
  | "uniswap-v3"
  | "pancake-v2"
  | "pancake-v3"
  | "uniswap-v4" // stub — HookSwap is supportsV4:false today; see v4Adapter.ts
  | "pancake-v4"; // stub — Pancake Infinity singleton; see v4Adapter.ts

/**
 * External price-feed sources for markets that are NOT AMM-priced (RWA, stocks,
 * fx). `zerox-rfq` is an optional SPOT-REFERENCE source (0x RFQ quote), NOT the
 * authoritative mark for a stock perp — the Chainlink feed is (see EXTENSIBILITY.md).
 */
export type FeedSourceType = "chainlink" | "pyth" | "api" | "zerox-rfq";

/**
 * The registry key. Adding a NEW venue/feed type = a new `SourceType` string +
 * a new adapter module registered in the registry (off-chain). The core
 * resolver never changes. Kept as a widenable `string` union so config can
 * reference an adapter registered by a plugin the core doesn't know about.
 */
export type SourceType = AmmSourceType | FeedSourceType;

/**
 * Legacy alias — the pre-registry name for AMM source types. Retained so
 * existing route configs / imports keep compiling.
 * @deprecated use SourceType.
 */
export type OracleProtocol = AmmSourceType;

// ============================================================
// Oracle source configs — one discriminated-union member per source family
// ============================================================

interface OracleSourceCommon {
  /** Selects the adapter in the registry. */
  sourceType: SourceType;
}

/** AMM pool source (v2/v3/v4). Base is the pool token that is NOT `quoteToken`. */
export interface AmmSource extends OracleSourceCommon {
  sourceType: AmmSourceType;
  /** EVM chain the spot pool lives on (e.g. 11155111 Sepolia, 4663 Robinhood). */
  chainId: number;
  /** The spot pool / pair contract address. */
  poolAddress: `0x${string}`;
  /**
   * Which of the pool's two tokens is the QUOTE (numeraire) — usually a stable
   * or WETH. The OTHER token is the base the perp tracks. Orientation vs the
   * pool's token0/token1 is auto-derived, so no manual `invert` flag is needed.
   */
  quoteToken: `0x${string}`;
  /** TWAP window (s) for v3/v4 arithmetic-mean-tick. Ignored by v2. Default 1800. */
  twapWindow?: number;
}

/** Chainlink AggregatorV3 feed (e.g. AAPL/USD, XAU/USD). answer is quote-per-base. */
export interface ChainlinkSource extends OracleSourceCommon {
  sourceType: "chainlink";
  /** Chain the aggregator is deployed on. */
  chainId: number;
  /** AggregatorV3Interface address (a Chainlink price feed / RH per-stock proxy). */
  feed: `0x${string}`;
  /**
   * Optional feed-decimals override. Robinhood Chain per-stock proxies are
   * 8-decimals. If omitted, the adapter reads `decimals()` on-chain (robust but
   * one extra RPC call). Providing it avoids that call.
   */
  decimals?: number;
  /** If the feed is base-per-quote, set true to take the reciprocal. */
  invert?: boolean;
  /** Reject if `updatedAt` is older than this many seconds. Default 3600. */
  maxStaleSecs?: number;
}

/** Pyth on-chain price feed (pull oracle) identified by a 32-byte price id. */
export interface PythSource extends OracleSourceCommon {
  sourceType: "pyth";
  /** Chain the Pyth contract is deployed on. */
  chainId: number;
  /** The Pyth receiver contract (IPyth) address on that chain. */
  pythContract: `0x${string}`;
  /** 32-byte Pyth price feed id (e.g. Equity.US.AAPL/USD). */
  priceId: `0x${string}`;
  /** If the feed is base-per-quote, set true to take the reciprocal. */
  invert?: boolean;
  /** Reject if publishTime is older than this many seconds. Default 60. */
  maxStaleSecs?: number;
}

/** Generic allowlisted / signed HTTP price source (last-resort RWA/stock feed). */
export interface ApiSource extends OracleSourceCommon {
  sourceType: "api";
  /** Full URL to GET. Host MUST be on the allowlist (see `allowedHost`). */
  url: string;
  /** Required exact host the URL must resolve to (defence against config drift). */
  allowedHost: string;
  /** Dot-path to the numeric price in the JSON response, e.g. "data.price". */
  pricePath: string;
  /** Optional dot-path to a unix-seconds timestamp for staleness checks. */
  timestampPath?: string;
  /** Reject if the response timestamp is older than this many seconds. Default 60. */
  maxStaleSecs?: number;
  /**
   * Env var name whose value is sent as the `Authorization` header (e.g. an API
   * key / bearer). The secret itself is NEVER stored in config. TODO(key): set
   * the env var in the deploy environment.
   */
  authHeaderEnv?: string;
  /**
   * Env var name whose value is an allowlisted signer address; when set the
   * adapter enforces a signed price attestation. TODO(signing): wire the exact
   * signature scheme for the chosen provider.
   */
  signerEnv?: string;
  /** If the source is base-per-quote, set true to take the reciprocal. */
  invert?: boolean;
}

/**
 * 0x RFQ spot-reference source (e.g. NVDA↔USDG on Robinhood Chain). OPTIONAL
 * cross-check only — a stock perp's AUTHORITATIVE mark is its Chainlink feed.
 * Stub today (see zeroxRfqAdapter.ts): needs the 0x RFQ quote endpoint + a
 * sell/buy token pair.
 */
export interface ZeroxRfqSource extends OracleSourceCommon {
  sourceType: "zerox-rfq";
  chainId: number;
  /** Base (sell) token — the asset the perp tracks. */
  sellToken: `0x${string}`;
  /** Quote (buy) token — the numeraire (e.g. USDG). */
  buyToken: `0x${string}`;
  /** 0x RFQ / swap quote endpoint. TODO(endpoint): supply per deployment. */
  quoteUrl?: string;
  /** Env var holding the 0x API key. TODO(key). */
  apiKeyEnv?: string;
}

/** Discriminated union of every price source the registry can resolve. */
export type OracleSource = AmmSource | ChainlinkSource | PythSource | ApiSource | ZeroxRfqSource;

// ============================================================
// Market config — a market is FULLY described by config
// ============================================================

/** Asset class of the underlying a perp market tracks. */
export type AssetClass = "crypto" | "stock" | "rwa" | "fx";

/**
 * A perp market, fully described by config. Adding a market = a new entry here
 * (+ an on-chain admin `addSupportedToken` only if it introduces a NEW
 * collateral token). NO Settlement redeploy — see EXTENSIBILITY.md.
 */
export interface MarketConfig {
  /** Perp market symbol, e.g. "ETH-PERP", "AAPL-PERP". */
  market: string;
  /** Underlying asset class (informational + UI grouping; no on-chain effect). */
  assetClass: AssetClass;
  /** The price source (selects an adapter by `sourceType`). */
  oracle: OracleSource;
  /**
   * Settlement collateral token for this market (ERC-20 the trader deposits).
   * Must be a Settlement `supportedTokens` entry — add via the admin
   * `addSupportedToken(token, decimals)` call (NOT a redeploy). Optional here
   * because many markets share one canonical collateral (e.g. WETH/USDC).
   */
  collateralToken?: `0x${string}`;
  /**
   * Max leverage the ENGINE offers for this market. Must be <= the on-chain
   * `Settlement.MAX_LEVERAGE` (100x); the contract rejects anything above.
   */
  maxLeverage?: number;
}

// ============================================================
// Adapter contracts
// ============================================================

/**
 * The facade the engine programs against: symbol in, scalar mark price out.
 * Backed by the market registry + adapter registry.
 */
export interface ISpotOracleAdapter {
  /**
   * Resolve the mark price for a perp market symbol (e.g. "ETH-PERP").
   * Returns { ok:false } instead of throwing on any recoverable failure so the
   * engine can hold / fall back, never settle on a fabricated number.
   */
  getMarkPrice(market: string): Promise<MarkPrice>;
}

/**
 * A pluggable source adapter. Every venue/feed (AMM v2/v3/v4, Chainlink, Pyth,
 * API) implements this ONE interface and is registered in the AdapterRegistry
 * under its `sourceType`. Adding a source type = adding one of these modules.
 */
export interface ISourceAdapter {
  /** The registry key this adapter serves. */
  readonly sourceType: SourceType;
  /** Produce a mark price from a resolved source config, or { ok:false }. */
  getMarkPrice(source: OracleSource): Promise<MarkPrice>;
}

// ============================================================
// Legacy route shape (flat AMM route) — pre-registry config, still supported.
// ============================================================

/**
 * Flat per-market AMM route (the pre-registry config shape). Still loadable via
 * loadRoutes(); normalized into a MarketConfig by routeToMarket().
 * @deprecated prefer MarketConfig in config/markets.json.
 */
export interface OracleRoute {
  market: string;
  chainId: number;
  /** AMM protocol (a subset of SourceType). */
  protocol: OracleProtocol;
  poolAddress: `0x${string}`;
  quoteToken: `0x${string}`;
  twapWindow?: number;
}

/**
 * Legacy sub-adapter interface (method `price`). Superseded by ISourceAdapter.
 * @deprecated use ISourceAdapter.
 */
export interface ISubAdapter {
  readonly protocol: OracleProtocol;
  price(route: OracleRoute): Promise<MarkPrice>;
}
