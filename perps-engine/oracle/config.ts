// Market config loading + per-sourceType validation.
//
// A MARKET is fully described by config. Two on-disk shapes are accepted and
// normalized to MarketConfig[]:
//   1. NEW  — config/markets.json: [{ market, assetClass, oracle:{sourceType,…},
//             collateralToken?, maxLeverage? }]  (or { markets: [...] }).
//   2. LEGACY — config/routes.json: flat AMM routes (see routes.ts). Each is
//             lifted to a crypto market with an AMM oracle.
// Validation checks SHAPE per sourceType, never on-chain existence.

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getAddress } from "viem";
import type {
  AmmSourceType,
  AssetClass,
  MarketConfig,
  OracleSource,
  SourceType,
  V4SourceType,
} from "./types";
import { loadRoutes, routeToMarket } from "./routes";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MARKETS_PATH = join(__dirname, "..", "config", "markets.json");

// v4 singleton sources are validated separately (PoolKey fields, not poolAddress).
const V4_SOURCE_TYPES: V4SourceType[] = ["uniswap-v4", "pancake-v4", "hook-v4"];
// v2/v3 standalone-pool sources (poolAddress + quoteToken).
const AMM_SOURCE_TYPES: AmmSourceType[] = [
  "hookswap-v2",
  "hookswap-v3",
  "uniswap-v2",
  "uniswap-v3",
  "pancake-v2",
  "pancake-v3",
  ...V4_SOURCE_TYPES,
];
const ALL_SOURCE_TYPES: SourceType[] = [
  ...AMM_SOURCE_TYPES,
  "chainlink",
  "pyth",
  "api",
  "zerox-rfq",
];
const ASSET_CLASSES: AssetClass[] = ["crypto", "stock", "rwa", "fx"];

function addr(v: unknown, ctx: string): `0x${string}` {
  if (typeof v !== "string") throw new Error(`${ctx}: expected address string`);
  return getAddress(v);
}
function num(v: unknown, ctx: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${ctx}: expected number`);
  return v;
}
function str(v: unknown, ctx: string): string {
  if (typeof v !== "string" || v.length === 0) throw new Error(`${ctx}: expected non-empty string`);
  return v;
}

/** Validate + normalize an `oracle` block by its sourceType. */
function validateOracle(o: any, ctx: string): OracleSource {
  if (!o || typeof o !== "object") throw new Error(`${ctx}.oracle missing`);
  const sourceType = o.sourceType as SourceType;
  if (!ALL_SOURCE_TYPES.includes(sourceType)) {
    throw new Error(`${ctx}.oracle.sourceType invalid: ${o.sourceType}`);
  }

  // v4 singleton source: PoolKey fields (no standalone poolAddress).
  if (V4_SOURCE_TYPES.includes(sourceType as V4SourceType)) {
    return {
      sourceType: sourceType as V4SourceType,
      chainId: num(o.chainId, `${ctx}.oracle.chainId`),
      currency0: addr(o.currency0, `${ctx}.oracle.currency0`),
      currency1: addr(o.currency1, `${ctx}.oracle.currency1`),
      fee: num(o.fee, `${ctx}.oracle.fee`),
      tickSpacing: num(o.tickSpacing, `${ctx}.oracle.tickSpacing`),
      hooks: addr(o.hooks ?? "0x0000000000000000000000000000000000000000", `${ctx}.oracle.hooks`),
      quoteToken: addr(o.quoteToken, `${ctx}.oracle.quoteToken`),
      stateView: o.stateView ? addr(o.stateView, `${ctx}.oracle.stateView`) : undefined,
      poolManager: o.poolManager ? addr(o.poolManager, `${ctx}.oracle.poolManager`) : undefined,
      twapWindow: typeof o.twapWindow === "number" ? o.twapWindow : undefined,
    };
  }

  // v2/v3 standalone-pool source.
  if (AMM_SOURCE_TYPES.includes(sourceType as AmmSourceType)) {
    return {
      sourceType: sourceType as Exclude<AmmSourceType, V4SourceType>,
      chainId: num(o.chainId, `${ctx}.oracle.chainId`),
      poolAddress: addr(o.poolAddress, `${ctx}.oracle.poolAddress`),
      quoteToken: addr(o.quoteToken, `${ctx}.oracle.quoteToken`),
      twapWindow: typeof o.twapWindow === "number" ? o.twapWindow : undefined,
    };
  }

  switch (sourceType) {
    case "chainlink":
      return {
        sourceType,
        chainId: num(o.chainId, `${ctx}.oracle.chainId`),
        feed: addr(o.feed ?? o.proxyAddress, `${ctx}.oracle.feed`),
        decimals: typeof o.decimals === "number" ? o.decimals : undefined,
        invert: o.invert === true,
        maxStaleSecs: typeof o.maxStaleSecs === "number" ? o.maxStaleSecs : undefined,
      };
    case "pyth":
      return {
        sourceType,
        chainId: num(o.chainId, `${ctx}.oracle.chainId`),
        pythContract: addr(o.pythContract, `${ctx}.oracle.pythContract`),
        priceId: str(o.priceId, `${ctx}.oracle.priceId`) as `0x${string}`,
        invert: o.invert === true,
        maxStaleSecs: typeof o.maxStaleSecs === "number" ? o.maxStaleSecs : undefined,
      };
    case "api":
      return {
        sourceType,
        url: str(o.url, `${ctx}.oracle.url`),
        allowedHost: str(o.allowedHost, `${ctx}.oracle.allowedHost`),
        pricePath: str(o.pricePath, `${ctx}.oracle.pricePath`),
        timestampPath: typeof o.timestampPath === "string" ? o.timestampPath : undefined,
        maxStaleSecs: typeof o.maxStaleSecs === "number" ? o.maxStaleSecs : undefined,
        authHeaderEnv: typeof o.authHeaderEnv === "string" ? o.authHeaderEnv : undefined,
        signerEnv: typeof o.signerEnv === "string" ? o.signerEnv : undefined,
        invert: o.invert === true,
      };
    case "zerox-rfq":
      return {
        sourceType,
        chainId: num(o.chainId, `${ctx}.oracle.chainId`),
        sellToken: addr(o.sellToken, `${ctx}.oracle.sellToken`),
        buyToken: addr(o.buyToken, `${ctx}.oracle.buyToken`),
        quoteUrl: typeof o.quoteUrl === "string" ? o.quoteUrl : undefined,
        apiKeyEnv: typeof o.apiKeyEnv === "string" ? o.apiKeyEnv : undefined,
        sellDecimals: typeof o.sellDecimals === "number" ? o.sellDecimals : undefined,
        buyDecimals: typeof o.buyDecimals === "number" ? o.buyDecimals : undefined,
        invert: o.invert === true,
      };
    default: {
      // Exhaustiveness guard — a new FeedSourceType must add a case above.
      const _never: never = sourceType as never;
      throw new Error(`${ctx}.oracle.sourceType unhandled: ${String(_never)}`);
    }
  }
}

function validateMarket(m: any, i: number): MarketConfig {
  const ctx = `market[${i}]`;
  if (!m || typeof m !== "object") throw new Error(`${ctx} not an object`);
  const market = str(m.market, `${ctx}.market`);
  const assetClass = m.assetClass as AssetClass;
  if (!ASSET_CLASSES.includes(assetClass)) {
    throw new Error(`${ctx}.assetClass invalid: ${m.assetClass}`);
  }
  return {
    market,
    assetClass,
    oracle: validateOracle(m.oracle, ctx),
    collateralToken: m.collateralToken ? addr(m.collateralToken, `${ctx}.collateralToken`) : undefined,
    maxLeverage: typeof m.maxLeverage === "number" ? m.maxLeverage : undefined,
  };
}

/**
 * Load markets from JSON. Accepts the new market schema ({ markets:[…] } or a
 * bare array) OR the legacy flat-route schema ({ routes:[…] }), normalizing both
 * to MarketConfig[]. Falls back to config/markets.json.
 */
export function loadMarkets(path: string = DEFAULT_MARKETS_PATH): MarketConfig[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));

  // Legacy flat-route file -> lift each route to a crypto market.
  if (raw && !Array.isArray(raw) && Array.isArray(raw.routes)) {
    return loadRoutes(path).map(routeToMarket);
  }

  const arr = Array.isArray(raw) ? raw : raw.markets;
  if (!Array.isArray(arr)) {
    throw new Error("markets file must be an array, { markets: [...] }, or a legacy { routes: [...] }");
  }
  return arr.map(validateMarket);
}
