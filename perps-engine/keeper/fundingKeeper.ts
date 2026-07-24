// FUNDING KEEPER — periodically settles funding for every ACTIVE position so the
// funding accrual (accFundingLong/Short) stays current between trades.
//
// Per market, per sweep: enumerate ACTIVE positions whose `lastFundingSettled` is
// older than FUNDING_INTERVAL (5 min) and call settleFundingBatch([...]) in batches.
// settleFundingBatch is matcher-gated and price-independent (it never reads a mark),
// so it needs no updatePrice. The contract's own `_settleFunding` aligns to whole
// FUNDING_INTERVAL periods and advances lastFundingSettled, so re-running is safe
// (idempotent within a period — no double charge).

import { PERP_MARKET_ABI } from "./keeperAbi.js";
import { CFG, log, read, send } from "./keeperChain.js";
import { fetchAllPositions, lastPairId, type KeeperMarket } from "./keeperMarkets.js";

const FUNDING_INTERVAL = 300n; // 5 minutes (PerpMarket.FUNDING_INTERVAL constant)

export interface FundingRecord {
  chainId: number;
  market: `0x${string}`;
  pairIds: string[];
  txHash: string | null;
  mined: boolean;
  reason: string;
  ts: string;
}

async function latestBlockTs(chainId: number): Promise<bigint> {
  const b = await read(chainId, (c) => c.getBlock({ blockTag: "latest" }));
  return b.timestamp;
}

/** One funding sweep across the given markets (across chains). Returns any settleFundingBatch txs. */
export async function runFundingSweep(markets: KeeperMarket[]): Promise<FundingRecord[]> {
  const records: FundingRecord[] = [];
  // Per-chain "now" — block timestamps differ across chains; cache one read per chain.
  const nowByChain = new Map<number, bigint>();
  const nowFor = async (chainId: number): Promise<bigint> => {
    const cached = nowByChain.get(chainId);
    if (cached != null) return cached;
    let ts: bigint;
    try {
      ts = await latestBlockTs(chainId);
    } catch {
      ts = BigInt(Math.floor(Date.now() / 1000));
    }
    nowByChain.set(chainId, ts);
    return ts;
  };

  for (const m of markets) {
    try {
      const nowTs = await nowFor(m.chainId);
      const last = await lastPairId(m.chainId, m.market);
      if (last <= 0n) continue;
      const positions = await fetchAllPositions(m.chainId, m.market, last);

      // Due = ACTIVE and at least one whole funding period has elapsed since the
      // last settlement (so the tx actually advances accrual — not a no-op).
      const due = positions
        .filter((p) => p.status === 0 && nowTs > p.lastFundingSettled && nowTs - p.lastFundingSettled >= FUNDING_INTERVAL)
        .map((p) => p.pairId);
      if (due.length === 0) continue;

      // Batch to keep each tx's gas bounded.
      for (let i = 0; i < due.length; i += CFG.fundingBatchSize) {
        const batch = due.slice(i, i + CFG.fundingBatchSize);
        const r = await send(m.chainId, m.market, PERP_MARKET_ABI, "settleFundingBatch", [batch]);
        records.push({
          chainId: m.chainId,
          market: m.market,
          pairIds: batch.map((x) => x.toString()),
          txHash: r.txHash,
          mined: r.mined,
          reason: r.reason,
          ts: new Date().toISOString(),
        });
        log(
          `[funding] ${m.chainId}:${m.market} settleFundingBatch([${batch.length} pairs]) -> ${r.reason}` +
            (r.txHash ? ` tx=${r.txHash}` : ""),
        );
      }
    } catch (e: any) {
      log(`[funding] market ${m.chainId}:${m.market} sweep error: ${e?.shortMessage || e?.message || e}`);
    }
  }
  return records;
}
