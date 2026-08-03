// Multi-RPC auto-failover transport for the whole perps stack (engine, keeper, bot,
// oracle). ONE implementation, imported by every resolver — no per-service copies.
//
// ─────────────────────────────────────────────────────────────────────────────
// READ paths  → full failover. Try endpoint[cursor]; on a retriable failure mark
//               that endpoint with a ~60s cooldown, advance, wrap around, retry.
//               A second pass ignores cooldowns so a fully-degraded chain still
//               gets one last try on every endpoint before giving up.
//
// WRITE paths → DELIBERATELY NOT failed over. See "WRITE SAFETY" below.
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ WRITE SAFETY (the critical constraint — the engine/keeper/bot SIGN AND SEND
// settlement, liquidation, funding and deposit transactions):
//
//   1. `eth_sendRawTransaction` / `eth_sendTransaction` are PINNED to a single
//      endpoint and attempted EXACTLY ONCE. There is NO cross-endpoint retry and
//      NO same-endpoint retry (the per-URL http transport is built with
//      retryCount: 0). A broadcast that fails ambiguously (timeout, socket error,
//      HTTP 5xx) may still have reached the mempool, so re-submitting it anywhere
//      risks a duplicate/divergent-nonce tx. We surface the error instead.
//
//   2. `eth_getTransactionCount` (the nonce read) is served from the SAME pinned
//      endpoint as the send. It MAY fail over — it is an idempotent read — but a
//      failover also RE-PINS the write endpoint, so the nonce and the broadcast
//      that follows it always come from one consistent node. viem re-reads the
//      pending nonce on every writeContract call (it caches nothing), so each
//      signing round starts from that one node's view.
//
//   3. `eth_getTransactionReceipt` / `eth_getTransactionByHash` prefer the pinned
//      endpoint (that node saw the broadcast) but may fail over WITHOUT re-pinning,
//      so receipt polling survives an endpoint dying mid-wait.
//
//   4. Ambiguous send failures are tagged on the thrown error
//      (`hookswapSendAmbiguous = true`, `hookswapRpcEndpoint = <url>`) so callers
//      can tell "definitely rejected by the node" from "may have landed".
//      Nothing in this tree auto-resends: src/settle.ts and keeper/keeperChain.ts
//      return a structured failure and the next attempt is a FRESH round that
//      re-simulates and re-reads the on-chain nonce first. On top of that,
//      PerpMarket enforces a per-trader sequential `nonces` value, so a settle
//      that already landed reverts on a duplicate rather than double-settling.
//
// Net effect: broadcasts stay on ONE endpoint per signing round; only reads roam.

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";
import { resolveRpcList } from "./endpoints.js";

// ── tunables ────────────────────────────────────────────────────────────────

function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/** How long a failed endpoint is skipped before being tried again. */
const COOLDOWN_MS = num(process.env.PERPS_RPC_COOLDOWN_MS, 60_000);
/** Per-request timeout on a single endpoint (keep short — we have alternatives). */
const REQUEST_TIMEOUT_MS = num(process.env.PERPS_RPC_TIMEOUT_MS, 12_000);

// ── method classification ───────────────────────────────────────────────────

/** Broadcasts. Pinned to one endpoint, attempted once, NEVER retried elsewhere. */
const SEND_METHODS = new Set(["eth_sendRawTransaction", "eth_sendTransaction"]);
/** Nonce reads. Served from the pinned write endpoint; failover RE-PINS. */
const NONCE_METHODS = new Set(["eth_getTransactionCount"]);
/** Tx-lifecycle reads. Prefer the pinned endpoint; failover allowed, no re-pin. */
const TX_LIFECYCLE_METHODS = new Set([
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
]);

// ── error classification ────────────────────────────────────────────────────

/**
 * Errors that mean "this endpoint answered, and the answer is final" — a contract
 * revert, a rejected tx, bad params. Failing over on these would be wrong (it hides
 * a real error behind N identical retries) and, for sends, dangerous.
 */
const TERMINAL_RE =
  /execution reverted|revert|insufficient funds|nonce too low|nonce too high|already known|replacement transaction underpriced|intrinsic gas|gas required exceeds|invalid opcode|out of gas|max fee per gas less than block base fee|transaction underpriced|known transaction/i;

/**
 * Failover triggers: connection errors / timeouts, HTTP 4xx+5xx, the JSON-RPC
 * rate-limit / unavailable / unsupported-method codes, and provider-quota text.
 */
const RETRIABLE_TEXT_RE =
  /capacity|rate limit|rate-limited|ratelimit|too many requests|exceeds|exceeded|quota|not available|unavailable|payment required|does not exist|method not found|unsupported method|fetch failed|socket hang up|network error|timed? ?out|timeout|econnreset|econnrefused|enotfound|eai_again|ehostunreach|etimedout|aborted|502|503|504/i;

const RETRIABLE_RPC_CODES = new Set([429, -32005, -32001, -32601]);

function collectStrings(e: any): string {
  const parts: string[] = [];
  let cur = e;
  for (let i = 0; i < 5 && cur; i++) {
    if (typeof cur === "string") parts.push(cur);
    else {
      for (const k of ["shortMessage", "details", "message", "name", "reason", "code"]) {
        const v = (cur as any)?.[k];
        if (v != null) parts.push(String(v));
      }
    }
    cur = (cur as any)?.cause;
  }
  return parts.join(" | ");
}

/** All numeric HTTP statuses / JSON-RPC codes found anywhere on the error chain. */
function collectCodes(e: any): number[] {
  const out: number[] = [];
  let cur = e;
  for (let i = 0; i < 5 && cur; i++) {
    for (const k of ["status", "statusCode", "code"]) {
      const v = (cur as any)?.[k];
      if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    }
    cur = (cur as any)?.cause;
  }
  return out;
}

/** True when the failure justifies moving to the next endpoint. */
export function isRetriableRpcError(e: any): boolean {
  const text = collectStrings(e);
  // A node that gave a definitive answer must NOT be failed over.
  if (TERMINAL_RE.test(text)) return false;

  const codes = collectCodes(e);
  for (const c of codes) {
    if (RETRIABLE_RPC_CODES.has(c)) return true;
    // Any HTTP status in the 4xx/5xx range.
    if (c >= 400 && c < 600) return true;
  }
  if (RETRIABLE_TEXT_RE.test(text)) return true;
  // Bare transport failures (viem HttpRequestError with no status, TypeError from
  // fetch, AbortError) carry no useful code — treat an unclassified error from the
  // transport layer as retriable so a dead host never wedges the whole stack.
  const name = String(e?.name || "");
  if (/HttpRequestError|TimeoutError|AbortError|TypeError|FetchError/.test(name)) return true;
  return false;
}

/**
 * True when a BROADCAST failure leaves it UNKNOWN whether the tx reached the
 * mempool (timeout / socket / HTTP error) as opposed to being definitively
 * rejected by the node (a JSON-RPC error object with a code). Callers must
 * re-read on-chain state before considering any resend when this is true.
 */
export function isAmbiguousSendError(e: any): boolean {
  const text = collectStrings(e);
  if (TERMINAL_RE.test(text)) return false; // node rejected it outright
  const codes = collectCodes(e);
  // An HTTP-level status (or none at all) = the node may never have parsed it, or
  // may have accepted it and failed to answer. Unknown either way.
  if (codes.some((c) => c >= 400 && c < 600)) return true;
  if (codes.some((c) => RETRIABLE_RPC_CODES.has(c))) return true;
  return !codes.some((c) => c < 0); // negative code = a real JSON-RPC rejection
}

// ── the provider ────────────────────────────────────────────────────────────

interface Endpoint {
  url: string;
  request: (args: { method: string; params?: any }) => Promise<any>;
  cooldownUntil: number;
  failures: number;
  lastReason: string;
}

function nowMs(): number {
  return Date.now();
}

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

export interface FailoverStatus {
  chainId: number;
  label: string;
  endpoints: { url: string; healthy: boolean; failures: number; lastReason: string }[];
  current: string;
  pinnedWrite: string | null;
}

export class FailoverProvider {
  readonly chainId: number;
  readonly label: string;
  private readonly endpoints: Endpoint[];
  /** Rolling read cursor — the endpoint that last served a read successfully. */
  private cursor = 0;
  /** Sticky endpoint for broadcasts + the nonce read that precedes them. */
  private pinned: Endpoint | null = null;

  constructor(chainId: number, urls: string[], label?: string) {
    if (urls.length === 0) throw new Error(`FailoverProvider: no endpoints for chain ${chainId}`);
    this.chainId = chainId;
    this.label = label || String(chainId);
    this.endpoints = urls.map((url) => {
      // retryCount: 0 — this module owns retry/failover policy. Letting viem retry
      // a 429 three times on a dead endpoint just delays the failover, and letting
      // it retry eth_sendRawTransaction is exactly the double-submit we must avoid.
      const { request } = http(url, { timeout: REQUEST_TIMEOUT_MS, retryCount: 0 })({});
      return {
        url,
        request: request as Endpoint["request"],
        cooldownUntil: 0,
        failures: 0,
        lastReason: "",
      };
    });
    log(
      `[rpc] chain=${this.label} ${this.endpoints.length} endpoint(s): ` +
        this.endpoints.map((e) => e.url).join(" > "),
    );
  }

  /** EIP-1193-style entrypoint handed to viem's `custom` transport. */
  request = async (args: { method: string; params?: any }): Promise<any> => {
    const method = String(args?.method || "");
    if (SEND_METHODS.has(method)) return this.sendPinned(args);
    if (NONCE_METHODS.has(method)) return this.failover(args, { pin: true, startAtPin: true });
    if (TX_LIFECYCLE_METHODS.has(method)) return this.failover(args, { startAtPin: true });
    return this.failover(args, {});
  };

  // -- reads -----------------------------------------------------------------

  private indexOf(ep: Endpoint | null): number {
    if (!ep) return -1;
    return this.endpoints.indexOf(ep);
  }

  private async failover(
    args: { method: string; params?: any },
    opts: { pin?: boolean; startAtPin?: boolean },
  ): Promise<any> {
    const n = this.endpoints.length;
    const startIdx = opts.startAtPin ? (this.indexOf(this.pinned) >= 0 ? this.indexOf(this.pinned) : this.cursor) : this.cursor;

    let lastErr: any = new Error(`[rpc] chain=${this.label} no endpoint attempted`);
    // Pass 0 respects cooldowns; pass 1 ignores them (last-ditch, all endpoints cold).
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const idx = (startIdx + i) % n;
        const ep = this.endpoints[idx];
        if (pass === 0 && ep.cooldownUntil > nowMs()) continue;
        try {
          const res = await ep.request(args);
          ep.failures = 0;
          ep.cooldownUntil = 0;
          this.cursor = idx;
          if (opts.pin && this.pinned !== ep) {
            const from = this.pinned?.url;
            this.pinned = ep;
            if (from && from !== ep.url) {
              log(`[rpc] chain=${this.label} write endpoint RE-PINNED ${from} -> ${ep.url}`);
            }
          }
          return res;
        } catch (e: any) {
          if (!isRetriableRpcError(e)) throw e; // definitive answer — surface it
          this.markFailed(ep, e, args.method, idx, n, startIdx, i);
          lastErr = e;
        }
      }
    }
    throw lastErr;
  }

  private markFailed(
    ep: Endpoint,
    e: any,
    method: string,
    idx: number,
    n: number,
    startIdx: number,
    i: number,
  ): void {
    ep.failures += 1;
    const reason = shortErr(e);
    ep.lastReason = reason;
    const wasCold = ep.cooldownUntil > nowMs();
    ep.cooldownUntil = nowMs() + COOLDOWN_MS;
    if (!wasCold) {
      const next = this.endpoints[(startIdx + i + 1) % n];
      log(
        `[rpc] FAILOVER chain=${this.label} endpoint=${ep.url} method=${method} ` +
          `reason="${reason}" -> next=${next.url} (cooldown ${Math.round(COOLDOWN_MS / 1000)}s)`,
      );
    }
  }

  // -- writes ----------------------------------------------------------------

  /** The endpoint broadcasts are pinned to; picks the first healthy one if unset. */
  private writeEndpoint(): Endpoint {
    if (this.pinned && this.pinned.cooldownUntil <= nowMs()) return this.pinned;
    const healthy = this.endpoints.find((e) => e.cooldownUntil <= nowMs());
    const chosen = healthy ?? this.endpoints[0];
    if (this.pinned !== chosen) {
      if (this.pinned) {
        log(`[rpc] chain=${this.label} write endpoint RE-PINNED ${this.pinned.url} -> ${chosen.url}`);
      }
      this.pinned = chosen;
    }
    return chosen;
  }

  /**
   * ⚠️ BROADCAST — single endpoint, single attempt, NO failover. See the WRITE
   * SAFETY block at the top of this file. On failure the endpoint is cooled down
   * (so the NEXT signing round re-pins elsewhere via the nonce read) and the error
   * is annotated + rethrown; it is NEVER re-broadcast from here.
   */
  private async sendPinned(args: { method: string; params?: any }): Promise<any> {
    const ep = this.writeEndpoint();
    try {
      const res = await ep.request(args);
      ep.failures = 0;
      ep.cooldownUntil = 0;
      return res;
    } catch (e: any) {
      const ambiguous = isAmbiguousSendError(e);
      if (isRetriableRpcError(e)) {
        ep.failures += 1;
        ep.lastReason = shortErr(e);
        ep.cooldownUntil = nowMs() + COOLDOWN_MS;
      }
      try {
        e.hookswapRpcEndpoint = ep.url;
        e.hookswapSendAmbiguous = ambiguous;
      } catch {
        /* frozen error object — annotation is best-effort */
      }
      log(
        `[rpc] BROADCAST FAILED (NOT retried on another endpoint) chain=${this.label} ` +
          `endpoint=${ep.url} method=${args.method} ambiguous=${ambiguous} reason="${shortErr(e)}"` +
          (ambiguous
            ? " — the tx MAY have reached the mempool; re-read the nonce / query the hash before any resend"
            : ""),
      );
      throw e;
    }
  }

  // -- introspection ---------------------------------------------------------

  status(): FailoverStatus {
    const t = nowMs();
    return {
      chainId: this.chainId,
      label: this.label,
      endpoints: this.endpoints.map((e) => ({
        url: e.url,
        healthy: e.cooldownUntil <= t,
        failures: e.failures,
        lastReason: e.lastReason,
      })),
      current: this.endpoints[this.cursor]?.url ?? "",
      pinnedWrite: this.pinned?.url ?? null,
    };
  }

  /** Ordered endpoint URLs (for logs / diagnostics). */
  urls(): string[] {
    return this.endpoints.map((e) => e.url);
  }
}

export function shortErr(e: any): string {
  const s = e?.shortMessage || e?.details || e?.message || String(e);
  return String(s).replace(/\s+/g, " ").trim().slice(0, 160);
}

// ── shared cache + client factories ─────────────────────────────────────────

const providers = new Map<string, FailoverProvider>();

/**
 * Cached provider for (chainId, endpoint list). The SAME provider is shared by a
 * chain's public and wallet clients so the write pin (and therefore the nonce
 * source) is consistent across both.
 */
export function getFailoverProvider(
  chainId: number,
  urls: string[],
  label?: string,
): FailoverProvider {
  const key = `${chainId}|${urls.join(",")}`;
  const hit = providers.get(key);
  if (hit) return hit;
  const p = new FailoverProvider(chainId, urls, label);
  providers.set(key, p);
  return p;
}

/** All providers built so far (diagnostics / health endpoints). */
export function allFailoverProviders(): FailoverProvider[] {
  return [...providers.values()];
}

/** viem transport backed by the failover provider. */
export function failoverTransport(provider: FailoverProvider) {
  return custom({ request: provider.request as any }, { retryCount: 0, key: `failover-${provider.label}` });
}

/** PublicClient with full read failover across `urls`. */
export function createFailoverPublicClient(
  chainId: number,
  urls: string[],
  label?: string,
): PublicClient {
  return createPublicClient({
    transport: failoverTransport(getFailoverProvider(chainId, urls, label)),
  }) as PublicClient;
}

/**
 * WalletClient sharing the chain's failover provider. Reads (incl. the nonce)
 * fail over; `eth_sendRawTransaction` does NOT (see WRITE SAFETY above).
 */
export function createFailoverWalletClient(
  account: Account,
  chainId: number,
  urls: string[],
  label?: string,
): WalletClient {
  return createWalletClient({
    account,
    transport: failoverTransport(getFailoverProvider(chainId, urls, label)),
  }) as WalletClient;
}

/** Convenience: resolve the list from env/defaults and build a PublicClient. */
export function publicClientForChain(
  chainId: number,
  sources: (string | readonly string[] | undefined | null)[] = [],
  label?: string,
): PublicClient {
  return createFailoverPublicClient(chainId, resolveRpcList(chainId, { sources }), label);
}
