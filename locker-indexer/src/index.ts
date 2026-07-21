// HookSwap Locker data service — entrypoint.
//
// Boot: load prior daily TVL history, start the cross-chain refresh loop (recording
// one TVL point per day as cycles complete), then start the read API.

import { ENV } from "./env.js";
import { CHAINS } from "./chains.js";
import { LockerIndexer } from "./indexer.js";
import { TvlHistory } from "./persist.js";
import { startServer } from "./server.js";

async function main(): Promise<void> {
  console.log(
    `[locker-indexer] boot: port=${ENV.port} chains=${CHAINS.length} ` +
      `refreshMs=${ENV.refreshMs} tvlHistory=${ENV.tvlHistoryFile}`,
  );

  const history = new TvlHistory();
  const loaded = history.load();
  console.log(`[locker-indexer] restored ${loaded} daily TVL points`);

  const indexer = new LockerIndexer();

  // Record a daily TVL point after every completed cycle (deduped by UTC date).
  indexer.start((snap) => {
    try {
      history.record(snap);
    } catch (e) {
      console.warn("[locker-indexer] tvl record failed:", (e as Error).message);
    }
    const s = snap.stats;
    console.log(
      `[locker-indexer] cycle: ${s.totalLocks} locks, ` +
        `${s.reachableChains}/${s.chains} chains reachable, ` +
        `TVL=${s.totalTvlUsd !== undefined ? `$${s.totalTvlUsd.toFixed(2)}` : "n/a"} ` +
        `(${s.pricedLocks} priced / ${s.unpricedLocks} unpriced)`,
    );
  });

  await startServer(indexer, history);
}

main().catch((e) => {
  console.error("[locker-indexer] fatal:", e?.stack || e);
  process.exit(1);
});
