// HookSwap Locker data service — entrypoint.
//
// Boot: load prior daily TVL history, start the cross-chain refresh loop (recording
// one TVL point per day as cycles complete), then start the read API.

import { ENV } from "./env.js";
import { CHAINS, farmFactories } from "./chains.js";
import { LockerIndexer } from "./indexer.js";
import { TvlHistory } from "./persist.js";
import { FarmsIndexer } from "./farms/indexer.js";
import { FarmsTvlHistory } from "./farms/store.js";
import { VestingIndexer } from "./vesting/indexer.js";
import { VestingTvlHistory } from "./vesting/store.js";
import { LaunchpadIndexer } from "./launchpad/indexer.js";
import { startServer } from "./server.js";

async function main(): Promise<void> {
  const farmChains = CHAINS.filter((c) => farmFactories(c.chainId).length > 0).length;
  console.log(
    `[locker-indexer] boot: port=${ENV.port} chains=${CHAINS.length} ` +
      `farmChains=${farmChains} refreshMs=${ENV.refreshMs} tvlHistory=${ENV.tvlHistoryFile}`,
  );

  const history = new TvlHistory();
  const loaded = history.load();
  console.log(`[locker-indexer] restored ${loaded} daily TVL points`);

  const farmsHistory = new FarmsTvlHistory();
  const farmsLoaded = farmsHistory.load();
  console.log(`[locker-indexer] restored ${farmsLoaded} daily farms-TVL points`);

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

  // Farms module — same shared refresh cadence, independent per-chain isolation.
  const farmsIndexer = new FarmsIndexer();
  farmsIndexer.start((snap) => {
    try {
      farmsHistory.record(snap);
    } catch (e) {
      console.warn("[farms] tvl record failed:", (e as Error).message);
    }
    const s = snap.stats;
    console.log(
      `[farms] cycle: ${s.totalFarms} farms (${s.activeFarms} active), ` +
        `${s.reachableChains}/${s.chains} chains reachable, ` +
        `TVL=${s.totalTvlUsd !== undefined ? `$${s.totalTvlUsd.toFixed(2)}` : "n/a"}`,
    );
  });

  // Vesting module — same shared refresh cadence, independent per-chain isolation.
  const vestingHistory = new VestingTvlHistory();
  const vestingLoaded = vestingHistory.load();
  console.log(`[locker-indexer] restored ${vestingLoaded} daily vesting-TVL points`);

  const vestingIndexer = new VestingIndexer();
  vestingIndexer.start((snap) => {
    try {
      vestingHistory.record(snap);
    } catch (e) {
      console.warn("[vesting] tvl record failed:", (e as Error).message);
    }
    const s = snap.stats;
    console.log(
      `[vesting] cycle: ${s.totalSchedules} schedules (${s.activeSchedules} active), ` +
        `${s.reachableChains}/${s.chains} chains reachable, ` +
        `locked=${s.totalLockedUsd !== undefined ? `$${s.totalLockedUsd.toFixed(2)}` : "n/a"}`,
    );
  });

  // LaunchPad module — same shared cadence, independent per-chain isolation.
  const launchpadIndexer = new LaunchpadIndexer();
  launchpadIndexer.start((snap) => {
    const s = snap.stats;
    console.log(
      `[launchpad] cycle: ${s.totalLaunches} launches (${s.lpLockedLaunches} LP-locked), ` +
        `${s.reachableChains}/${s.chains} chains reachable, ` +
        `mcap=${s.totalMarketCapUsd !== undefined ? `$${s.totalMarketCapUsd.toFixed(2)}` : "n/a"}`,
    );
  });

  await startServer(
    indexer,
    history,
    farmsIndexer,
    farmsHistory,
    vestingIndexer,
    vestingHistory,
    launchpadIndexer,
  );
}

main().catch((e) => {
  console.error("[locker-indexer] fatal:", e?.stack || e);
  process.exit(1);
});
