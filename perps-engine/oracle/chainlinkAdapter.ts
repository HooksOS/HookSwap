// Chainlink source adapter — external price feed for markets that are NOT
// AMM-priced (tokenized stocks like AAPL-PERP, RWA like XAU/gold, fx pairs).
//
// Reads AggregatorV3Interface.latestRoundData() and normalizes `answer` (which
// is quote-per-base at the feed's `decimals()`) to a 1e18 mark price. Enforces
// staleness (`updatedAt`) — on ANY failure returns { ok:false }, never a
// fabricated price. Registered in the AdapterRegistry under "chainlink".

import type { ChainlinkSource, ISourceAdapter, MarkPrice, OracleSource } from "./types";
import { CHAINLINK_AGGREGATOR_ABI } from "./abis";
import { clientFor } from "./rpc";
import { scaleToE18, invert1e18 } from "./math";

const DEFAULT_MAX_STALE_SECS = 3600; // 1h — most equity/RWA feeds heartbeat slower than crypto

export class ChainlinkAdapter implements ISourceAdapter {
  readonly sourceType = "chainlink" as const;

  async getMarkPrice(source: OracleSource): Promise<MarkPrice> {
    const s = source as ChainlinkSource;
    const debug = `chainlink:${s.feed}`;
    try {
      const client = clientFor(s.chainId);
      const feed = { address: s.feed, abi: CHAINLINK_AGGREGATOR_ABI } as const;

      // Robinhood Chain per-stock proxies are 8-decimals; config may supply it
      // to skip the decimals() call, else read it on-chain.
      const [decimals, round] = await Promise.all([
        s.decimals !== undefined
          ? Promise.resolve(s.decimals)
          : client.readContract({ ...feed, functionName: "decimals" }),
        client.readContract({ ...feed, functionName: "latestRoundData" }),
      ]);

      // latestRoundData -> [roundId, answer, startedAt, updatedAt, answeredInRound]
      const [, answer, , updatedAt] = round as unknown as [bigint, bigint, bigint, bigint, bigint];

      if (answer <= 0n) {
        return { price1e18: 0n, ok: false, source: debug, reason: "NON_POSITIVE_ANSWER" };
      }

      const maxStale = BigInt(s.maxStaleSecs ?? DEFAULT_MAX_STALE_SECS);
      const nowSecs = BigInt(Math.floor(Date.now() / 1000));
      if (updatedAt === 0n || nowSecs - updatedAt > maxStale) {
        const age = updatedAt === 0n ? "never" : `${nowSecs - updatedAt}s`;
        return { price1e18: 0n, ok: false, source: debug, reason: `STALE:${age}` };
      }

      let price1e18 = scaleToE18(answer, Number(decimals));
      if (s.invert) price1e18 = invert1e18(price1e18);
      if (price1e18 === 0n) return { price1e18: 0n, ok: false, source: debug, reason: "ZERO_PRICE" };

      return { price1e18, ok: true, source: `${debug} updatedAt=${updatedAt}` };
    } catch (err) {
      return { price1e18: 0n, ok: false, source: debug, reason: `RPC_ERROR:${(err as Error).message}` };
    }
  }
}
