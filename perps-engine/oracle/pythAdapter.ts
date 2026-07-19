// Pyth source adapter — external price feed (RWA / tokenized stocks / fx).
//
// Pyth is a PULL oracle: fresh prices must be posted on-chain (updatePriceFeeds,
// funded by a Hermes VAA) before an on-chain read. This adapter reads the
// already-posted price via IPyth.getPriceNoOlderThan(id, maxStaleSecs), which
// REVERTS if no sufficiently-fresh price exists on-chain — we surface that as
// { ok:false, reason:"STALE_OR_UNPOSTED" } rather than fabricating a number.
//
// The Pyth `Price` is { price (int64), conf, expo (int32), publishTime }, where
// the real value = price * 10^expo (expo is typically negative). We normalize to
// a 1e18 mark price. Registered in the AdapterRegistry under "pyth".
//
// TODO(hermes): for chains where prices are NOT continuously posted on-chain, run
// an off-chain Hermes price service (https://hermes.pyth.network) to either post
// the VAA before reading, or read the price off-chain — implement that as an
// `api` source or a Hermes-specific adapter. This on-chain path needs no key.

import type { ISourceAdapter, MarkPrice, OracleSource, PythSource } from "./types";
import { PYTH_ABI } from "./abis";
import { clientFor } from "./rpc";
import { pow10, ONE_1E18, invert1e18 } from "./math";

const DEFAULT_MAX_STALE_SECS = 60;

/** Normalize a Pyth (price, expo) pair to a 1e18 fixed point. No floats. */
function pythToE18(price: bigint, expo: number): bigint {
  if (price <= 0n) return 0n;
  // value = price * 10^expo ; want value * 1e18 = price * 10^(18 + expo)
  const shift = 18 + expo;
  if (shift >= 0) return price * pow10(shift);
  return price / pow10(-shift);
}

export class PythAdapter implements ISourceAdapter {
  readonly sourceType = "pyth" as const;

  async getMarkPrice(source: OracleSource): Promise<MarkPrice> {
    const s = source as PythSource;
    const debug = `pyth:${s.priceId.slice(0, 10)}…`;
    const age = BigInt(s.maxStaleSecs ?? DEFAULT_MAX_STALE_SECS);
    try {
      const client = clientFor(s.chainId);
      const res = (await client.readContract({
        address: s.pythContract,
        abi: PYTH_ABI,
        functionName: "getPriceNoOlderThan",
        args: [s.priceId, age],
      })) as unknown as { price: bigint; conf: bigint; expo: number; publishTime: bigint };

      if (res.price <= 0n) {
        return { price1e18: 0n, ok: false, source: debug, reason: "NON_POSITIVE_PRICE" };
      }

      let price1e18 = pythToE18(res.price, Number(res.expo));
      if (s.invert) price1e18 = invert1e18(price1e18);
      if (price1e18 === 0n || price1e18 > ONE_1E18 * ONE_1E18) {
        return { price1e18: 0n, ok: false, source: debug, reason: "PRICE_OUT_OF_RANGE" };
      }

      return { price1e18, ok: true, source: `${debug} publishTime=${res.publishTime}` };
    } catch (err) {
      // getPriceNoOlderThan reverts when the on-chain price is stale/unposted.
      return {
        price1e18: 0n,
        ok: false,
        source: debug,
        reason: `STALE_OR_UNPOSTED:${(err as Error).message}`,
      };
    }
  }
}
