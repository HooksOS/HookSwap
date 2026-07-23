// 0x RFQ / Swap-API source adapter — OPTIONAL spot-reference for markets whose
// spot venue is 0x RFQ (e.g. NVDA↔USDG on Robinhood Chain, resolving the "0x"
// venue in the DEX-integration requirement).
//
// IMPORTANT: this is NOT the authoritative mark for a stock perp — the Chainlink
// per-stock proxy feed is (see chainlinkAdapter.ts + EXTENSIBILITY.md). This
// adapter exists so the engine can OPTIONALLY cross-check the Chainlink mark
// against a live executable RFQ quote, or price a market that has 0x liquidity
// but no Chainlink feed yet.
//
// HOW IT PRICES: GET the 0x Swap API v2 indicative-price endpoint
//     {base}/swap/permit2/price?chainId=&sellToken=&buyToken=&sellAmount=
// with a 1-whole-unit `sellAmount` probe, then
//     price1e18 (quote-per-base) = (buyAmount/10^buyDec) / (sellAmount/10^sellDec) * 1e18
// (all bigint, no float drift). sellToken = base the perp tracks, buyToken = the
// numeraire; set `invert` if the perp instead tracks buyToken.
//
// SAFETY (facts-only):
//  - Host allowlist: the resolved 0x host MUST be on ZEROX_ALLOWED_HOSTS
//    (default "api.0x.org"), else refuse.
//  - No secrets in config: the API key is read from an ENV var by name
//    (default ZEROX_API_KEY). Missing key -> { ok:false, reason:"not_configured" }
//    so it is honestly-unavailable, never a crash and never a fabricated price.
//  - Any non-200 / malformed / non-positive amount -> { ok:false }.
// Registered in the AdapterRegistry under "zerox-rfq".

import { getAddress, type Address } from "viem";
import type { ISourceAdapter, MarkPrice, OracleSource, ZeroxRfqSource } from "./types";
import { ERC20_ABI } from "./abis";
import { clientFor } from "./rpc";
import { ONE_1E18, mulDiv, pow10, invert1e18 } from "./math";

const DEFAULT_ZEROX_BASE = "https://api.0x.org";
const DEFAULT_API_KEY_ENV = "ZEROX_API_KEY";
const DEFAULT_ALLOWED_HOSTS = ["api.0x.org"];
// 0x native-asset sentinel + the zero address are treated as 18-decimals.
const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

function allowedHosts(): string[] {
  const fromEnv = process.env.ZEROX_ALLOWED_HOSTS;
  if (fromEnv && fromEnv.trim()) return fromEnv.split(",").map((h) => h.trim()).filter(Boolean);
  return DEFAULT_ALLOWED_HOSTS;
}

/** decimals() for a token; native sentinel / zero address -> 18. */
async function tokenDecimals(
  client: ReturnType<typeof clientFor>,
  token: Address,
  override?: number,
): Promise<number> {
  if (override !== undefined) return override;
  const low = token.toLowerCase();
  if (low === NATIVE_SENTINEL || low === ZERO_ADDR) return 18;
  const d = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" });
  return Number(d);
}

export class ZeroxRfqAdapter implements ISourceAdapter {
  readonly sourceType = "zerox-rfq" as const;

  async getMarkPrice(source: OracleSource): Promise<MarkPrice> {
    const s = source as ZeroxRfqSource;
    const sellToken = getAddress(s.sellToken);
    const buyToken = getAddress(s.buyToken);
    const debug = `zerox-rfq:${sellToken}->${buyToken}@${s.chainId}`;

    // API key — never from config, always from ENV by name. Absent => honest.
    const keyEnv = s.apiKeyEnv ?? DEFAULT_API_KEY_ENV;
    const apiKey = process.env[keyEnv];
    if (!apiKey) {
      return { price1e18: 0n, ok: false, source: debug, reason: `not_configured:${keyEnv}` };
    }

    try {
      const base = s.quoteUrl ?? DEFAULT_ZEROX_BASE;
      const url = new URL("/swap/permit2/price", base);
      if (!allowedHosts().includes(url.host)) {
        return { price1e18: 0n, ok: false, source: debug, reason: `HOST_NOT_ALLOWED:${url.host}` };
      }

      const client = clientFor(s.chainId);
      const [sellDec, buyDec] = await Promise.all([
        tokenDecimals(client, sellToken, s.sellDecimals),
        tokenDecimals(client, buyToken, s.buyDecimals),
      ]);

      // 1-whole-unit probe of the base (sell) token.
      const sellAmount = pow10(sellDec);
      url.searchParams.set("chainId", String(s.chainId));
      url.searchParams.set("sellToken", sellToken);
      url.searchParams.set("buyToken", buyToken);
      url.searchParams.set("sellAmount", sellAmount.toString());

      const resp = await fetch(url, {
        headers: { accept: "application/json", "0x-api-key": apiKey, "0x-version": "v2" },
      });
      if (!resp.ok) {
        return { price1e18: 0n, ok: false, source: debug, reason: `HTTP_${resp.status}` };
      }
      const body = (await resp.json()) as { buyAmount?: string; sellAmount?: string };

      const buyAmountRaw = body?.buyAmount;
      const sellAmountRaw = body?.sellAmount ?? sellAmount.toString();
      if (typeof buyAmountRaw !== "string" || !/^\d+$/.test(buyAmountRaw)) {
        return { price1e18: 0n, ok: false, source: debug, reason: "BAD_BUY_AMOUNT" };
      }
      if (!/^\d+$/.test(sellAmountRaw)) {
        return { price1e18: 0n, ok: false, source: debug, reason: "BAD_SELL_AMOUNT" };
      }
      const buyAmount = BigInt(buyAmountRaw);
      const sellAmountResp = BigInt(sellAmountRaw);
      if (buyAmount <= 0n || sellAmountResp <= 0n) {
        return { price1e18: 0n, ok: false, source: debug, reason: "NON_POSITIVE_AMOUNT" };
      }

      // quote-per-base = (buy/10^buyDec) / (sell/10^sellDec) * 1e18
      let price1e18 = mulDiv(buyAmount * pow10(sellDec), ONE_1E18, sellAmountResp * pow10(buyDec));
      if (s.invert) price1e18 = invert1e18(price1e18);
      if (price1e18 === 0n) return { price1e18: 0n, ok: false, source: debug, reason: "ZERO_PRICE" };

      return { price1e18, ok: true, source: `${debug} (0x price probe)` };
    } catch (err) {
      return { price1e18: 0n, ok: false, source: debug, reason: `FETCH_ERROR:${(err as Error).message}` };
    }
  }
}
