// LIQUIDATION KEEPER — keeps every market solvent by auto-closing underwater
// positions.
//
// Per market, per sweep:
//   1. Scan ACTIVE positions.
//   2. Ensure a valid, in-band on-chain mark exists for each traded token: if the
//      stored mark is 0 or has drifted > KEEPER_MARK_REFRESH_BPS from the market's
//      Chainlink reference, push a fresh Chainlink-derived mark via updatePrice
//      (matcher-gated; the pushed price equals the reference so it passes the H-1
//      OracleGuard band with 0 deviation). Otherwise leave the fresh mark in place.
//   3. Re-read canLiquidate(pairId) (which the contract evaluates against the stored
//      mark) and liquidate(pairId) any side that is underwater. Liquidation is
//      PERMISSIONLESS and pays the keeper a reward.
//
// A revert on any single market/pair is logged and skipped — the loop never dies.

import { PERP_MARKET_ABI } from "./keeperAbi.js";
import { CFG, log, read, send } from "./keeperChain.js";
import {
  chainlinkMark,
  fetchAllPositions,
  lastPairId,
  refFeedFor,
  storedMark,
  type KeeperMarket,
} from "./keeperMarkets.js";

export interface LiquidationRecord {
  chainId: number;
  market: `0x${string}`;
  pairId: string;
  side: "long" | "short";
  txHash: string | null;
  mined: boolean;
  reason: string;
  ts: string;
}

const BPS = 10_000n;

/** True if `stored` needs a refresh toward `mark` (0 or drifted past the band tolerance). */
function needsMarkRefresh(stored: bigint, mark: bigint): boolean {
  if (stored === 0n) return true;
  const diff = stored > mark ? stored - mark : mark - stored;
  return (diff * BPS) / mark > CFG.markRefreshBps;
}

/** One liquidation sweep across the given markets. Returns any liquidations attempted. */
export async function runLiquidationSweep(markets: KeeperMarket[]): Promise<LiquidationRecord[]> {
  const records: LiquidationRecord[] = [];

  for (const m of markets) {
    try {
      const last = await lastPairId(m.chainId, m.market);
      if (last <= 0n) continue;
      const positions = await fetchAllPositions(m.chainId, m.market, last);
      const active = positions.filter((p) => p.status === 0);
      if (active.length === 0) continue;

      // 1) Ensure a valid, in-band mark for each traded token.
      const feed = await refFeedFor(m.chainId, m.market);
      if (feed) {
        const tokens = [...new Set(active.map((p) => p.token))];
        for (const token of tokens) {
          const mark = await chainlinkMark(m.chainId, feed);
          if (!mark.ok) {
            log(`[liq] ${m.chainId}:${m.market} token=${token} feed unusable (${mark.reason}) — skip mark refresh`);
            continue;
          }
          const stored = await storedMark(m.chainId, m.market, token);
          if (needsMarkRefresh(stored, mark.price1e18)) {
            const r = await send(m.chainId, m.market, PERP_MARKET_ABI, "updatePrice", [token, mark.price1e18]);
            log(
              `[liq] ${m.chainId}:${m.market} updatePrice(${token}, ${mark.price1e18}) stored=${stored} -> ${r.reason}` +
                (r.txHash ? ` tx=${r.txHash}` : ""),
            );
          }
        }
      }

      // 2) Liquidate any underwater side (canLiquidate reads the stored mark).
      for (const p of active) {
        let liqLong = false;
        let liqShort = false;
        try {
          [liqLong, liqShort] = await liquidateCheck(m.chainId, m.market, p.pairId);
        } catch {
          continue;
        }
        if (!liqLong && !liqShort) continue;
        const side: "long" | "short" = liqLong ? "long" : "short";
        const r = await send(m.chainId, m.market, PERP_MARKET_ABI, "liquidate", [p.pairId]);
        const rec: LiquidationRecord = {
          chainId: m.chainId,
          market: m.market,
          pairId: p.pairId.toString(),
          side,
          txHash: r.txHash,
          mined: r.mined,
          reason: r.reason,
          ts: new Date().toISOString(),
        };
        records.push(rec);
        log(
          `[liq] ${m.chainId}:${m.market} pair=${p.pairId} ${side} LIQUIDATE -> ${r.reason}` +
            (r.txHash ? ` tx=${r.txHash}` : ""),
        );
      }
    } catch (e: any) {
      log(`[liq] market ${m.chainId}:${m.market} sweep error: ${e?.shortMessage || e?.message || e}`);
    }
  }
  return records;
}

// Read-only canLiquidate via the shared per-chain retrying reader.
async function liquidateCheck(
  chainId: number,
  market: `0x${string}`,
  pairId: bigint,
): Promise<readonly [boolean, boolean]> {
  return (await read(chainId, (c) =>
    c.readContract({ address: market, abi: PERP_MARKET_ABI, functionName: "canLiquidate", args: [pairId] }),
  )) as readonly [boolean, boolean];
}
