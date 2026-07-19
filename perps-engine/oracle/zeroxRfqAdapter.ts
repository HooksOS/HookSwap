// 0x RFQ source adapter — STUB (documented). OPTIONAL spot-reference for
// tokenized-stock markets whose spot venue is 0x RFQ (e.g. NVDA↔USDG on
// Robinhood Chain, resolving the "0x" venue in the DEX-integration requirement).
//
// IMPORTANT: this is NOT the authoritative mark for a stock perp — the Chainlink
// per-stock proxy feed is (see chainlinkAdapter.ts + EXTENSIBILITY.md). This
// adapter exists so the engine can OPTIONALLY cross-check the Chainlink mark
// against a live executable RFQ quote, or price a market that has 0x RFQ
// liquidity but no Chainlink feed yet.
//
// WHY IT'S A STUB: 0x RFQ prices come from an off-chain quote endpoint
// (indicative or firm), keyed by a sell/buy token pair and size. The exact
// endpoint + auth + response shape are deployment-specific.
//
// IMPLEMENTATION PLAN (when wired):
//  1. GET the 0x RFQ/swap quote endpoint for { sellToken, buyToken, chainId, size }.
//  2. price1e18 = (buyAmount / sellAmount) decimal-normalized (reuse the api
//     adapter's decimalToE18 helper); invert if the perp tracks buyToken.
//  3. Staleness: reject if the quote's validTo/expiry has passed.
// Registered in the AdapterRegistry under "zerox-rfq".

import type { ISourceAdapter, MarkPrice, OracleSource, ZeroxRfqSource } from "./types";

export class ZeroxRfqAdapter implements ISourceAdapter {
  readonly sourceType = "zerox-rfq" as const;

  async getMarkPrice(source: OracleSource): Promise<MarkPrice> {
    const s = source as ZeroxRfqSource;
    return {
      price1e18: 0n,
      ok: false,
      source: `zerox-rfq:${s.sellToken}->${s.buyToken}`,
      reason:
        "ZEROX_RFQ_NOT_IMPLEMENTED: optional spot-reference only (Chainlink feed is the " +
        "authoritative stock mark). Needs the 0x RFQ quote endpoint + key; see zeroxRfqAdapter.ts.",
    };
  }
}
