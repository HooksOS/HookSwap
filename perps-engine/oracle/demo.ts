// Smoke demo: load markets, query each market's mark price. No mock data — a
// market with no liquidity / stale feed / bad address returns { ok:false, reason }.
//
//   PERPS_RPC_196=<xlayer-rpc> node --loader ts-node/esm oracle/demo.ts
//
// Config precedence: config/markets.json → config/markets.example.json →
// config/routes.json → config/routes.example.json (legacy flat routes).

import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { SpotOracleAdapter } from "./index";
import { loadMarkets } from "./config";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = join(here, "..", "config");
const candidates = [
  join(cfg, "markets.json"),
  join(cfg, "markets.example.json"),
  join(cfg, "routes.json"),
  join(cfg, "routes.example.json"),
];
const path = candidates.find((p) => existsSync(p));
if (!path) throw new Error("no markets/routes config found in config/");

async function main() {
  const markets = loadMarkets(path!);
  const oracle = new SpotOracleAdapter(markets);
  for (const m of markets) {
    const mp = await oracle.getMarkPrice(m.market);
    const human = mp.ok ? (Number(mp.price1e18) / 1e18).toPrecision(8) : "—";
    console.log(
      `${m.market.padEnd(12)} ${m.assetClass.padEnd(6)} ${m.oracle.sourceType.padEnd(12)} ` +
        `ok=${mp.ok} price=${human} ${mp.ok ? mp.source : mp.reason}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
