// HookSwapPerps KEEPER — entrypoint. Runs the liquidation loop and the funding
// loop on independent cadences, sharing one dedicated keeper key (serialized sends).
//
// Auth model (verified against contracts/perps/src/factory/PerpMarket.sol):
//   - liquidate()          : PERMISSIONLESS (pays the caller a reward).
//   - settleFundingBatch() : onlyAuthorizedMatcher.
//   - updatePrice()        : onlyAuthorizedMatcher.
// So the keeper wallet must be an AUTHORIZED MATCHER for funding + mark refresh.
// It is authorized once by the market owner via setAuthorizedMatcher(keeper,true).
// Liquidation works regardless.
//
// Run: `tsx keeper/keeperMain.ts`  (systemd: hookswap-perps-keeper.service)

import { writeFileSync } from "fs";
import { PERP_MARKET_ABI } from "./keeperAbi.js";
import { CFG, allKeeperChains, getKeeperCtx, log, read } from "./keeperChain.js";
import { fetchAllMarkets, type KeeperMarket } from "./keeperMarkets.js";
import { runLiquidationSweep, type LiquidationRecord } from "./liquidationKeeper.js";
import { runFundingSweep, type FundingRecord } from "./fundingKeeper.js";

let markets: KeeperMarket[] = [];
const liquidations: LiquidationRecord[] = [];
const fundings: FundingRecord[] = [];

function persist(): void {
  if (!CFG.resultsFile) return;
  try {
    writeFileSync(
      CFG.resultsFile,
      JSON.stringify(
        {
          chains: allKeeperChains().map((c) => ({
            chainId: c.chainId,
            network: c.network ?? null,
            keeper: c.keeperAccount?.address ?? null, // public address only
            gasMode: c.gasMode,
          })),
          updatedAt: new Date().toISOString(),
          markets: markets.map((m) => `${m.chainId}:${m.market}`),
          liquidations: liquidations.slice(-50),
          fundings: fundings.slice(-50),
        },
        null,
        2,
      ),
    );
  } catch (e: any) {
    log(`[persist] ${e?.message || e}`);
  }
}

async function refreshMarkets(): Promise<void> {
  try {
    const next = await fetchAllMarkets();
    if (next.length) {
      markets = next;
      log(`[markets] tracking ${markets.length}: ${markets.map((m) => `${m.chainId}:${m.market}`).join(", ")}`);
    }
  } catch (e: any) {
    log(`[markets] refresh error: ${e?.shortMessage || e?.message || e}`);
  }
}

/** Report keeper authorization on each tracked market (matcher-gated calls need it). */
async function reportAuth(): Promise<void> {
  for (const m of markets) {
    const keeperAddr = getKeeperCtx(m.chainId).keeperAccount?.address;
    if (!keeperAddr) continue;
    try {
      const authed = (await read(m.chainId, (c) =>
        c.readContract({
          address: m.market,
          abi: PERP_MARKET_ABI,
          functionName: "authorizedMatchers",
          args: [keeperAddr],
        }),
      )) as boolean;
      log(`[auth] ${m.chainId}:${m.market} keeper authorizedMatcher=${authed}` + (authed ? "" : " (funding+mark refresh will revert Unauthorized until authorized)"));
    } catch {
      /* ignore */
    }
  }
}

async function liquidationLoop(): Promise<void> {
  for (;;) {
    try {
      const recs = await runLiquidationSweep(markets);
      if (recs.length) {
        liquidations.push(...recs);
        persist();
      }
    } catch (e: any) {
      log(`[liq] loop error: ${e?.message || e}`);
    }
    await new Promise((r) => setTimeout(r, CFG.liquidationLoopMs));
  }
}

async function fundingLoop(): Promise<void> {
  for (;;) {
    try {
      const recs = await runFundingSweep(markets);
      if (recs.length) {
        fundings.push(...recs);
        persist();
      }
    } catch (e: any) {
      log(`[funding] loop error: ${e?.message || e}`);
    }
    await new Promise((r) => setTimeout(r, CFG.fundingLoopMs));
  }
}

async function marketRefreshLoop(): Promise<void> {
  for (;;) {
    await new Promise((r) => setTimeout(r, CFG.marketRefreshMs));
    await refreshMarkets();
  }
}

async function main(): Promise<void> {
  log("[boot] HookSwapPerps keeper starting");
  const chains = allKeeperChains();
  const withKey = chains.filter((c) => c.keeperAccount);
  if (withKey.length === 0) {
    log("[boot] FATAL: no chain has a valid keeper key — set KEEPER_PRIVATE_KEY (or the per-chain keeperKeyEnv) in keeper/.env (mode 600). Exiting.");
    process.exit(1);
  }
  for (const c of chains) {
    log(
      `[boot] chain ${c.network ?? ""} ${c.chainId}: keeper=${c.keeperAccount?.address ?? "NONE (skipped)"} ` +
        `registry=${c.marketRegistry} oracleGuard=${c.oracleGuard} gasMode=${c.gasMode}`,
    );
  }
  log(`[boot] liqLoop=${CFG.liquidationLoopMs}ms fundingLoop=${CFG.fundingLoopMs}ms markRefreshBps=${CFG.markRefreshBps}`);

  await refreshMarkets();
  await reportAuth();
  persist();

  await Promise.all([liquidationLoop(), fundingLoop(), marketRefreshLoop()]);
}

main().catch((e) => {
  log(`[fatal] ${e?.message || e}`);
  process.exit(1);
});
