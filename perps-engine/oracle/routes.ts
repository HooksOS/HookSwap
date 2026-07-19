// Legacy flat AMM route loading + validation (the pre-registry config shape).
//
// Retained for back-compat: `loadRoutes` reads a JSON array of flat OracleRoute
// entries (config/routes.json), and `routeToMarket` lifts one to a MarketConfig
// (assetClass:"crypto", AMM oracle). New configs should use config/markets.json
// + loadMarkets() (config.ts). HookSwap chains can still derive a v2 pair via
// computeHookSwapV2Pair() (deployments.ts) instead of a literal poolAddress.

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getAddress } from "viem";
import type { MarketConfig, OracleProtocol, OracleRoute } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROUTES_PATH = join(__dirname, "..", "config", "routes.json");

const VALID_PROTOCOLS: OracleProtocol[] = [
  "hookswap-v2",
  "hookswap-v3",
  "uniswap-v2",
  "uniswap-v3",
  "pancake-v2",
  "pancake-v3",
  "uniswap-v4",
  "pancake-v4",
];

function validate(r: any, i: number): OracleRoute {
  if (!r || typeof r !== "object") throw new Error(`route[${i}] not an object`);
  if (typeof r.market !== "string") throw new Error(`route[${i}].market missing`);
  if (typeof r.chainId !== "number") throw new Error(`route[${i}].chainId missing`);
  if (!VALID_PROTOCOLS.includes(r.protocol)) throw new Error(`route[${i}].protocol invalid: ${r.protocol}`);
  if (typeof r.poolAddress !== "string") throw new Error(`route[${i}].poolAddress missing`);
  if (typeof r.quoteToken !== "string") throw new Error(`route[${i}].quoteToken missing`);
  return {
    market: r.market,
    chainId: r.chainId,
    protocol: r.protocol,
    poolAddress: getAddress(r.poolAddress),
    quoteToken: getAddress(r.quoteToken),
    twapWindow: typeof r.twapWindow === "number" ? r.twapWindow : undefined,
  };
}

/** Load + validate legacy flat routes from a JSON array (or { routes: [...] }). */
export function loadRoutes(path: string = DEFAULT_ROUTES_PATH): OracleRoute[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const arr = Array.isArray(raw) ? raw : raw.routes;
  if (!Array.isArray(arr)) throw new Error("routes file must be an array or { routes: [...] }");
  return arr.map(validate);
}

/** Lift a legacy flat AMM route into the richer MarketConfig shape. */
export function routeToMarket(route: OracleRoute): MarketConfig {
  return {
    market: route.market,
    assetClass: "crypto",
    oracle: {
      sourceType: route.protocol,
      chainId: route.chainId,
      poolAddress: route.poolAddress,
      quoteToken: route.quoteToken,
      twapWindow: route.twapWindow,
    },
  };
}
