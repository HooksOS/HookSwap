// Generic HTTP price-source adapter — last-resort external feed for RWA/stocks
// whose price is only available from an allowlisted (ideally signed) HTTP API.
//
// Design guarantees:
//  - Host allowlist: the configured URL's host MUST equal `allowedHost`, else refuse.
//  - No secrets in config: an auth header is pulled from an ENV var by name.
//  - Staleness: if `timestampPath` is set, a stale response yields { ok:false }.
//  - Never fabricate: any parse/network/allowlist failure returns { ok:false }.
// Registered in the AdapterRegistry under "api".

import type { ApiSource, ISourceAdapter, MarkPrice, OracleSource } from "./types";
import { ONE_1E18, invert1e18 } from "./math";

const DEFAULT_MAX_STALE_SECS = 60;

/** Read a dot-path (e.g. "data.price") out of a parsed JSON object. */
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Parse a decimal string/number into a 1e18 bigint without float drift. */
function decimalToE18(value: string): bigint | null {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  const neg = value.startsWith("-");
  const [intPart, fracPart = ""] = value.replace("-", "").split(".");
  const frac = (fracPart + "0".repeat(18)).slice(0, 18);
  const scaled = BigInt(intPart) * ONE_1E18 + BigInt(frac || "0");
  return neg ? -scaled : scaled;
}

export class ApiAdapter implements ISourceAdapter {
  readonly sourceType = "api" as const;

  async getMarkPrice(source: OracleSource): Promise<MarkPrice> {
    const s = source as ApiSource;
    const debug = `api:${s.allowedHost}`;
    try {
      const url = new URL(s.url);
      if (url.host !== s.allowedHost) {
        return { price1e18: 0n, ok: false, source: debug, reason: `HOST_NOT_ALLOWED:${url.host}` };
      }

      const headers: Record<string, string> = { accept: "application/json" };
      if (s.authHeaderEnv) {
        const secret = process.env[s.authHeaderEnv];
        if (!secret) {
          // No key configured -> refuse rather than call an authed endpoint blind.
          return { price1e18: 0n, ok: false, source: debug, reason: `NO_AUTH_ENV:${s.authHeaderEnv}` };
        }
        headers["authorization"] = secret;
      }

      // TODO(signing): when `s.signerEnv` is set, verify a signed price attestation
      // (recover the signer over the price+timestamp payload and require it match
      // process.env[s.signerEnv]) before trusting the value. Provider-specific;
      // wire the exact scheme (EIP-191 / EIP-712 / provider JWT) for the source.

      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        return { price1e18: 0n, ok: false, source: debug, reason: `HTTP_${resp.status}` };
      }
      const body = (await resp.json()) as unknown;

      const rawPrice = getPath(body, s.pricePath);
      if (rawPrice === undefined || rawPrice === null) {
        return { price1e18: 0n, ok: false, source: debug, reason: `PRICE_PATH_MISSING:${s.pricePath}` };
      }
      let price1e18 = decimalToE18(String(rawPrice));
      if (price1e18 === null || price1e18 <= 0n) {
        return { price1e18: 0n, ok: false, source: debug, reason: "BAD_PRICE" };
      }

      if (s.timestampPath) {
        const ts = Number(getPath(body, s.timestampPath));
        const maxStale = s.maxStaleSecs ?? DEFAULT_MAX_STALE_SECS;
        const nowSecs = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(ts) || nowSecs - ts > maxStale) {
          return { price1e18: 0n, ok: false, source: debug, reason: `STALE:${nowSecs - ts}s` };
        }
      }

      if (s.invert) price1e18 = invert1e18(price1e18);
      if (price1e18 === 0n) return { price1e18: 0n, ok: false, source: debug, reason: "ZERO_PRICE" };
      return { price1e18, ok: true, source: debug };
    } catch (err) {
      return { price1e18: 0n, ok: false, source: debug, reason: `FETCH_ERROR:${(err as Error).message}` };
    }
  }
}
