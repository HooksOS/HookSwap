// HookSwapPerps matching-engine entrypoint.

import { ENV } from "./env.js";
import { matcherAccount, fetchMarketRefFeed } from "./chain.js";
import { initMarks, markPrice, registerRefFeedMark, hasMark, marksConfigured } from "./mark.js";
import { MatchingEngine } from "./engine.js";
import { MarkStore } from "./marketData.js";
import { Persistence } from "./persist.js";
import { startServer } from "./server.js";
import type { Trade } from "./types.js";

/**
 * Discover each market's on-chain OracleGuard refFeed and auto-register it as the
 * market's mark source. Idempotent — only new/changed feeds register. Called on
 * boot and on each registry refresh so freshly-launched markets get a mark.
 */
async function syncMarketMarks(engine: MatchingEngine): Promise<number> {
  let registered = 0;
  for (const m of engine.markets()) {
    try {
      const refFeed = await fetchMarketRefFeed(m.market);
      if (refFeed && registerRefFeedMark(m.market, refFeed, ENV.chainId)) registered++;
    } catch (e) {
      console.warn(`[marks] refFeed lookup failed for ${m.market}:`, (e as Error).message);
    }
  }
  return registered;
}

/** Sample the mark for every market that has a configured source into the ring buffer. */
async function sampleMarks(engine: MatchingEngine, marks: MarkStore): Promise<void> {
  for (const m of engine.markets()) {
    if (!hasMark(m.market)) continue;
    try {
      const p = await markPrice(m.market);
      if (p && p > 0n) {
        marks.record(m.market, p); // unified series (candles / change24h)
        marks.recordIndex(m.market, p); // true oracle index (Chainlink refFeed)
      }
    } catch {
      /* transient RPC error — skip this sample, never fabricate */
    }
  }
}

async function main(): Promise<void> {
  const marksCfg = initMarks();
  console.log(
    `[perps-engine] boot: chainId=${ENV.chainId} registry=${ENV.marketRegistry} ` +
      `matcher=${matcherAccount?.address ?? "NONE (settle disabled)"} ` +
      `liveSettle=${ENV.liveSettle} configMarks=${marksCfg.configured} (${marksCfg.path})`,
  );

  const engine = new MatchingEngine();
  await engine.init();
  console.log(`[perps-engine] loaded ${engine.markets().length} markets from registry`);

  // Mark-data store + persistence (load prior orderbook/trades/mark history).
  const marks = new MarkStore();
  const persistence = new Persistence(engine, marks);
  const loaded = persistence.load();
  console.log(
    `[perps-engine] restored ${loaded.orders} orders, ${loaded.trades} trades, ${loaded.marks} mark series`,
  );

  // Auto-register marks from OracleGuard refFeeds, then take an initial sample.
  const registered = await syncMarketMarks(engine);
  console.log(`[perps-engine] auto-registered ${registered} refFeed marks (marksConfigured=${marksConfigured()})`);
  await sampleMarks(engine, marks);

  // Trade prints feed the mark series (last-trade contributes to candles/change).
  engine.on("trade", (t: Trade) => {
    try {
      if (t.matchPrice > 0n) marks.record(t.market, t.matchPrice, t.ts);
    } catch {
      /* ignore */
    }
  });

  // Periodic mark sampling (paced — bounds RPC on drpc).
  setInterval(() => {
    void sampleMarks(engine, marks);
  }, ENV.markSampleMs).unref();

  // Re-sync marks when the registry refresh may have added markets.
  if (ENV.marketRefreshMs > 0) {
    setInterval(() => {
      void syncMarketMarks(engine);
    }, ENV.marketRefreshMs).unref();
  }

  // Persist orderbook/trades/marks (debounced on change + periodic flush).
  persistence.start();

  await startServer(engine, marks);
}

main().catch((e) => {
  console.error("[perps-engine] fatal:", e?.stack || e);
  process.exit(1);
});
