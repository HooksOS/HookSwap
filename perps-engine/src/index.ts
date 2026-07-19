// HookSwapPerps matching-engine entrypoint.

import { ENV } from "./env.js";
import { matcherAccount } from "./chain.js";
import { initMarks } from "./mark.js";
import { MatchingEngine } from "./engine.js";
import { startServer } from "./server.js";

async function main() {
  const marks = initMarks();
  console.log(
    `[perps-engine] boot: chainId=${ENV.chainId} registry=${ENV.marketRegistry} ` +
      `matcher=${matcherAccount?.address ?? "NONE (settle disabled)"} ` +
      `liveSettle=${ENV.liveSettle} marks=${marks.configured} (${marks.path})`,
  );

  const engine = new MatchingEngine();
  await engine.init();
  console.log(`[perps-engine] loaded ${engine.markets().length} markets from registry`);

  await startServer(engine);
}

main().catch((e) => {
  console.error("[perps-engine] fatal:", e?.stack || e);
  process.exit(1);
});
