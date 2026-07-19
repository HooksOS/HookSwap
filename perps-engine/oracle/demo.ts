// Smoke demo: load routes, query each market's mark price. No mock data — a
// route with no liquidity / bad address returns { ok:false, reason }.
//
//   PERPS_RPC_196=<xlayer-rpc> node --loader ts-node/esm oracle/demo.ts
//
// Uses config/routes.json if present, else config/routes.example.json.

import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { SpotOracleAdapter } from "./index";
import { loadRoutes } from "./routes";

const here = dirname(fileURLToPath(import.meta.url));
const routesPath = join(here, "..", "config", "routes.json");
const path = existsSync(routesPath) ? routesPath : join(here, "..", "config", "routes.example.json");

async function main() {
  const routes = loadRoutes(path);
  const oracle = new SpotOracleAdapter(routes);
  for (const r of routes) {
    const mp = await oracle.getMarkPrice(r.market);
    const human = mp.ok ? (Number(mp.price1e18) / 1e18).toPrecision(8) : "—";
    console.log(
      `${r.market.padEnd(10)} ${r.protocol.padEnd(12)} ok=${mp.ok} price=${human} ` +
        `${mp.ok ? mp.source : mp.reason}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
