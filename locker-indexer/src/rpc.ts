/**
 * HookSwap Locker indexer — shared multi-RPC auto-failover transport.
 *
 * WHY: the service used ONE endpoint per chain (an Alchemy key in prod). When that
 * key went over quota every chain returned HTTP 429 → 0/7 chains reachable, 0 locks,
 * 0 farms. Directive (Reggie, 2026-08-02): PUBLIC RPCs ONLY, up to 5-6 auto-fallback
 * endpoints per chain, no Alchemy anywhere.
 *
 * This module is the SINGLE RPC resolver for the whole service. It replaces BOTH of
 * the previously separate resolvers:
 *   - chains.ts  `resolveRpc(def)`      (locks / farms / vesting / launchpad)
 *   - pricing.ts `makeClient(chain)`    (USD pricing)
 *
 * Behaviour:
 *   1. Each chain has an ORDERED list of public endpoints (RPC_ENDPOINTS below).
 *      Requests start at the last-known-good endpoint, advance on failure and wrap
 *      around the ring.
 *   2. Any env override may be a COMMA-SEPARATED list (a single URL still works).
 *   3. Failover triggers: connection errors/timeouts, HTTP 4xx/5xx, JSON-RPC
 *      429 / -32005 / -32001 / -32601, or /capacity|rate limit|too many requests|
 *      exceeds|not available|payment required/i. A genuine contract revert is NOT a
 *      failover trigger (it is deterministic — every endpoint would return it).
 *   4. A failed endpoint is cooldown-marked (~60s) and skipped until it expires.
 *      Cooldown state is module-global (keyed chainId|url) so every client in the
 *      process — locks, farms, vesting, launchpad, pricing — shares what it learned.
 *   5. eth_getLogs block ranges are split into <= 2000-block sub-requests.
 *
 * IMPLEMENTATION CHOICE — custom ring, NOT viem's `fallback()`:
 *   viem's `fallback([http(a), http(b)])` (node_modules/viem/_esm/clients/transports/
 *   fallback.js) always restarts at index 0 on EVERY request and has no cooldown, so
 *   with a dead/429 first endpoint every single multicall pays a full timeout on the
 *   dead host first — exactly the failure mode we are fixing (this service issues
 *   hundreds of reads per cycle). Its `rank` option does add dynamic ordering but it
 *   probes with `net_listening`, which most of these public endpoints do not
 *   implement (→ every transport scores 0 stability), and it starts an unbounded
 *   recursive timer per client. It also gives no per-failover logging and no control
 *   over which errors advance. So this module keeps viem's `http()` transports for
 *   the actual wire calls and implements the ring + cooldown + classification itself.
 */

import { custom, http, type EIP1193RequestFn, type Transport } from "viem";

// ─────────────────────────────────────────────────────────────────────────────
// Validated public endpoints — live-tested 2026-08-02. ORDER MATTERS (index 0 is
// tried first). Do not add endpoints that have not been live-verified.
//
// ⛔ BLACKLIST — these return HTTP 200 with WRONG data, so a caller cannot tell a
// failure from an empty result. NEVER add them to any list:
//   https://megaeth.blockscout.com/api/eth-rpc      — silently drops logs, 1000-result
//                                                     cap, no error surfaced
//   https://robinhood.drpc.org                      — correct chainId, but every other
//                                                     method is missing
//   https://robinhoodchain.blockscout.com/api/eth-rpc — 429 with `result:null` and NO
//                                                     `error` field (undetectable)
//   https://ethereum-sepolia-rpc.publicnode.com     — 403 on eth_getLogs and on
//                                                     archive eth_call
// ─────────────────────────────────────────────────────────────────────────────
export const RPC_ENDPOINTS: Record<number, readonly string[]> = {
  // XLayer
  196: [
    "https://xlayer.drpc.org",
    "https://196.rpc.thirdweb.com",
    "https://rpc.xlayer.tech",
    "https://xlayerrpc.okx.com",
  ],
  // Stable
  988: [
    "https://stable-mainnet.rpc.sentio.xyz",
    "https://rpc.stable.xyz",
    "https://stable.drpc.org",
  ],
  // HyperEVM — the official endpoint is LAST on purpose: it rate-limits hard.
  999: [
    "https://hyperliquid.drpc.org",
    "https://rpc.hyperlend.finance",
    "https://hyperliquid.rpc.blxrbdn.com",
    "https://hyperliquid-json-rpc.stakely.io",
    "https://999.rpc.thirdweb.com",
    "https://rpc.hyperliquid.xyz/evm",
  ],
  // Tempo
  4217: ["https://rpc.tempo.xyz", "https://rpc.mainnet.tempo.xyz", "https://tempo.drpc.org"],
  // MegaETH (megaeth.blockscout.com is BLACKLISTED — see above)
  4326: [
    "https://mainnet.megaeth.com/rpc",
    "https://megaeth.drpc.org",
    "https://4326.rpc.thirdweb.com",
  ],
  // Robinhood — this is the ONLY endpoint that works. The two other known
  // candidates are BLACKLISTED (see above). Single-entry list = no failover here.
  4663: ["https://rpc.mainnet.chain.robinhood.com"],
  // Ink
  57073: [
    "https://ink.gateway.tenderly.co",
    "https://rpc-qnd.inkonchain.com",
    "https://ink.drpc.org",
    "https://rpc-gel.inkonchain.com",
    "https://57073.rpc.thirdweb.com",
  ],
  // Sepolia (ethereum-sepolia-rpc.publicnode.com is BLACKLISTED — see above)
  11155111: [
    "https://sepolia.drpc.org",
    "https://sepolia.gateway.tenderly.co",
    "https://11155111.rpc.thirdweb.com",
  ],
};

/**
 * Friendly per-chain env override names, checked (in order) before
 * `LOCKER_RPC_<chainId>`. Every one accepts a comma-separated list.
 */
export const RPC_ENV_ALIASES: Record<number, readonly string[]> = {
  196: ["XLAYER_RPC_URL"],
  988: ["STABLE_RPC_URL"],
  999: ["HYPEREVM_RPC_URL"],
  4217: ["TEMPO_RPC_URL"],
  4326: ["MEGAETH_RPC_URL"],
  4663: ["ROBINHOOD_RPC_URL"],
  57073: ["INK_RPC_URL"],
  11155111: ["SEPOLIA_RPC_URL"],
};

/** Max blocks per eth_getLogs request (public endpoints reject wider ranges). */
export const MAX_GET_LOGS_RANGE = 2000;

/** How long a failed endpoint is skipped before it is retried. */
const COOLDOWN_MS = Number(process.env.LOCKER_RPC_COOLDOWN_MS) > 0
  ? Number(process.env.LOCKER_RPC_COOLDOWN_MS)
  : 60_000;

/** Per-request HTTP timeout against a single endpoint. */
const REQUEST_TIMEOUT_MS = Number(process.env.LOCKER_RPC_TIMEOUT_MS) > 0
  ? Number(process.env.LOCKER_RPC_TIMEOUT_MS)
  : 15_000;

/**
 * Extra full-ring passes after the first sweep fails, with exponential backoff.
 * Matters most for single-endpoint chains (Robinhood 4663), where the ring cannot
 * absorb a transient 429 by moving on — there is nowhere to move to.
 */
const RETRY_PASSES = Number(process.env.LOCKER_RPC_RETRY_PASSES) >= 0
  ? Number(process.env.LOCKER_RPC_RETRY_PASSES)
  : 2;
const RETRY_BACKOFF_MS = Number(process.env.LOCKER_RPC_RETRY_BACKOFF_MS) > 0
  ? Number(process.env.LOCKER_RPC_RETRY_BACKOFF_MS)
  : 400;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Env parsing / resolution
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a comma-separated RPC override into an ordered, de-duplicated URL list. */
export function parseRpcList(value: string | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const part of value.split(",")) {
    const url = part.trim();
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * Ordered endpoint list for a chain.
 *
 * Precedence: `priorityEnvNames` (e.g. the pricing-side `WEB3_RPC_<id>`) →
 * `RPC_ENV_ALIASES[chainId]` (e.g. `XLAYER_RPC_URL`) → `LOCKER_RPC_<chainId>` →
 * the built-in public list. The FIRST env var that is set and non-empty wins
 * outright (its comma-list becomes the whole ordered list).
 */
export function resolveRpcUrls(chainId: number, priorityEnvNames: string[] = []): string[] {
  const names = [
    ...priorityEnvNames,
    ...(RPC_ENV_ALIASES[chainId] ?? []),
    `LOCKER_RPC_${chainId}`,
  ];
  for (const name of names) {
    const urls = parseRpcList(process.env[name]);
    if (urls.length > 0) return urls;
  }
  return [...(RPC_ENDPOINTS[chainId] ?? [])];
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure classification
// ─────────────────────────────────────────────────────────────────────────────

/** JSON-RPC codes that mean "this endpoint won't serve you" → try the next one. */
const FAILOVER_RPC_CODES = new Set([429, -32005, -32001, -32601]);

const FAILOVER_MESSAGE_RE =
  /capacity|rate limit|too many requests|exceeds|not available|payment required/i;

/** Transport/network level failures (no HTTP response at all). */
const NETWORK_MESSAGE_RE =
  /fetch failed|network error|socket hang up|timed out|timeout|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|UND_ERR|aborted|Failed to fetch/i;

/** A deterministic on-chain revert — every endpoint returns it, so NEVER fail over. */
const REVERT_MESSAGE_RE = /execution reverted|reverted with|ContractFunctionRevertedError/i;

interface ErrFacts {
  codes: number[];
  statuses: number[];
  messages: string[];
  names: string[];
}

function collectErrFacts(err: unknown, facts: ErrFacts, depth = 0): ErrFacts {
  if (!err || depth > 6) return facts;
  const e = err as Record<string, unknown>;
  if (typeof e.code === "number") facts.codes.push(e.code);
  if (typeof e.status === "number") facts.statuses.push(e.status);
  if (typeof e.name === "string") facts.names.push(e.name);
  for (const k of ["shortMessage", "details", "message"]) {
    const v = e[k];
    if (typeof v === "string" && v) facts.messages.push(v);
  }
  if (e.cause) collectErrFacts(e.cause, facts, depth + 1);
  return facts;
}

/**
 * Should this error advance to the next endpoint?
 *
 * TRUE for: connection errors/timeouts, HTTP 4xx/5xx, JSON-RPC 429/-32005/-32001/
 * -32601, or a message matching the capacity/rate-limit/quota regex.
 * FALSE for a deterministic contract revert (checked FIRST — a revert reason such
 * as "transfer amount exceeds balance" would otherwise match /exceeds/ and pointlessly
 * hammer every endpoint with a request that can only ever revert).
 */
export function isFailoverError(err: unknown): boolean {
  const facts = collectErrFacts(err, { codes: [], statuses: [], messages: [], names: [] });
  const text = facts.messages.join(" | ");

  // Deterministic revert → do not fail over.
  if (facts.codes.includes(3) || REVERT_MESSAGE_RE.test(text)) return false;

  if (facts.codes.some((c) => FAILOVER_RPC_CODES.has(c))) return true;
  if (facts.statuses.some((s) => s >= 400)) return true;
  if (FAILOVER_MESSAGE_RE.test(text)) return true;
  if (NETWORK_MESSAGE_RE.test(text)) return true;
  if (facts.names.some((n) => n === "TimeoutError" || n === "HttpRequestError")) return true;
  // Unknown shape: treat as transport trouble and try the next endpoint rather
  // than failing the whole chain on one flaky host.
  return true;
}

/** Short, single-line reason for the failover log. */
function reasonOf(err: unknown): string {
  const facts = collectErrFacts(err, { codes: [], statuses: [], messages: [], names: [] });
  const bits: string[] = [];
  if (facts.statuses.length) bits.push(`http=${facts.statuses[0]}`);
  if (facts.codes.length) bits.push(`code=${facts.codes[0]}`);
  const msg = (facts.messages[0] ?? String(err)).replace(/\s+/g, " ").slice(0, 160);
  bits.push(msg);
  return bits.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// The ring: per-chain cursor + per-endpoint cooldown, shared process-wide.
// ─────────────────────────────────────────────────────────────────────────────

/** chainId → index of the last endpoint that answered successfully. */
const cursors = new Map<number, number>();
/** `${chainId}|${url}` → epoch ms until which the endpoint is skipped. */
const cooldownUntil = new Map<string, number>();

function cooldownKey(chainId: number, url: string): string {
  return `${chainId}|${url}`;
}

function isCoolingDown(chainId: number, url: string): boolean {
  const until = cooldownUntil.get(cooldownKey(chainId, url));
  return until !== undefined && until > Date.now();
}

function markFailed(chainId: number, label: string, url: string, next: string, err: unknown): void {
  const key = cooldownKey(chainId, url);
  const wasCooling = isCoolingDown(chainId, url);
  cooldownUntil.set(key, Date.now() + COOLDOWN_MS);
  // One line per failover, deduped to at most one per endpoint per cooldown window
  // so a sustained outage cannot flood the log with hundreds of identical lines.
  if (!wasCooling) {
    console.warn(
      `[rpc-failover] chain=${chainId} (${label}) endpoint=${url} → ${next} ` +
        `cooldown=${Math.round(COOLDOWN_MS / 1000)}s reason: ${reasonOf(err)}`,
    );
  }
}

/** Endpoints to try, starting at the chain's cursor and wrapping around. */
function ringOrder(chainId: number, urls: string[]): number[] {
  const start = (cursors.get(chainId) ?? 0) % urls.length;
  const order: number[] = [];
  for (let i = 0; i < urls.length; i++) order.push((start + i) % urls.length);
  return order;
}

// ─────────────────────────────────────────────────────────────────────────────
// eth_getLogs range capping
// ─────────────────────────────────────────────────────────────────────────────

function hexToBigInt(v: unknown): bigint | undefined {
  if (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v);
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  return undefined;
}

/**
 * Split an eth_getLogs filter into <= MAX_GET_LOGS_RANGE-block windows.
 * Returns `undefined` when the range cannot be split (block tags like "latest",
 * a blockHash filter, or an already-small range) → the caller sends it unchanged.
 */
function splitGetLogsParams(params: unknown): unknown[] | undefined {
  if (!Array.isArray(params) || params.length === 0) return undefined;
  const filter = params[0] as Record<string, unknown> | undefined;
  if (!filter || typeof filter !== "object" || filter.blockHash) return undefined;
  const from = hexToBigInt(filter.fromBlock);
  const to = hexToBigInt(filter.toBlock);
  if (from === undefined || to === undefined || to < from) return undefined;
  const span = to - from + 1n;
  if (span <= BigInt(MAX_GET_LOGS_RANGE)) return undefined;

  const out: unknown[] = [];
  for (let start = from; start <= to; start += BigInt(MAX_GET_LOGS_RANGE)) {
    let end = start + BigInt(MAX_GET_LOGS_RANGE) - 1n;
    if (end > to) end = to;
    out.push([{ ...filter, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The transport
// ─────────────────────────────────────────────────────────────────────────────

type InnerTransport = ReturnType<ReturnType<typeof http>>;

/**
 * A viem Transport that auto-fails-over across an ordered list of endpoints.
 *
 * @param chainId  chain id (keys the shared cursor + cooldown state)
 * @param label    human name for logs ("XLayer")
 * @param urls     ordered endpoints; defaults to `resolveRpcUrls(chainId)`
 */
export function failoverHttp(chainId: number, label: string, urls?: string[]): Transport {
  const endpoints = urls && urls.length > 0 ? urls : resolveRpcUrls(chainId);
  if (endpoints.length === 0) {
    throw new Error(
      `No RPC endpoint configured for chain ${chainId} (${label}). ` +
        `Add it to RPC_ENDPOINTS in src/rpc.ts or set LOCKER_RPC_${chainId}.`,
    );
  }

  // One inner http transport instance per endpoint, created lazily and reused
  // (keeps keep-alive sockets warm across the thousands of reads per cycle).
  const inner: (InnerTransport | undefined)[] = new Array(endpoints.length);
  const transportFor = (i: number): InnerTransport => {
    let t = inner[i];
    if (!t) {
      t = http(endpoints[i], { timeout: REQUEST_TIMEOUT_MS, retryCount: 0 })({});
      inner[i] = t;
    }
    return t;
  };

  const dispatch = async (method: string, params: unknown): Promise<unknown> => {
    const order = ringOrder(chainId, endpoints);
    // Prefer endpoints that are not cooling down; if every one is cooling down we
    // still try them all (a total outage must not become a permanent hard failure).
    const hot = order.filter((i) => !isCoolingDown(chainId, endpoints[i]));
    const attempts = hot.length > 0 ? hot : order;

    let lastErr: unknown;
    // Sweep the ring, then retry the whole ring a few times with backoff. The extra
    // passes exist for SINGLE-ENDPOINT chains (Robinhood 4663 has exactly one working
    // public RPC): each inner transport is built with retryCount: 0, so without this a
    // lone transient 429 is an instant hard failure with nowhere to fail over to.
    // Multi-endpoint chains almost always succeed on pass 0 and never reach the sleep.
    for (let pass = 0; pass <= RETRY_PASSES; pass++) {
      if (pass > 0) await sleep(RETRY_BACKOFF_MS * 3 ** (pass - 1));
      for (let n = 0; n < attempts.length; n++) {
        const i = attempts[n];
        try {
          const res = await transportFor(i).request({ method, params } as never);
          cursors.set(chainId, i);
          return res;
        } catch (err) {
          lastErr = err;
          if (!isFailoverError(err)) throw err; // deterministic (e.g. revert) — do not retry elsewhere
          const nextIdx = attempts[n + 1];
          const next = nextIdx === undefined ? "(no endpoints left)" : endpoints[nextIdx];
          markFailed(chainId, label, endpoints[i], next, err);
        }
      }
    }
    throw lastErr;
  };

  const request: EIP1193RequestFn = (async ({ method, params }: { method: string; params?: unknown }) => {
    if (method === "eth_getLogs") {
      const windows = splitGetLogsParams(params);
      if (windows) {
        const out: unknown[] = [];
        for (const w of windows) {
          const part = (await dispatch(method, w)) as unknown[] | null;
          if (Array.isArray(part)) out.push(...part);
        }
        return out;
      }
    }
    return dispatch(method, params);
  }) as EIP1193RequestFn;

  // `retryCount: 0` — the ring already tries every endpoint; viem must not
  // multiply that by its own retry loop.
  return custom({ request }, { key: "hookswap-failover", name: `HookSwap failover (${label})`, retryCount: 0 });
}

/** Debug/health helper: the endpoint a chain is currently pinned to. */
export function rpcActiveEndpoint(chainId: number, urls?: string[]): string | undefined {
  const endpoints = urls && urls.length > 0 ? urls : resolveRpcUrls(chainId);
  if (endpoints.length === 0) return undefined;
  return endpoints[(cursors.get(chainId) ?? 0) % endpoints.length];
}

/** Debug/health helper: which endpoints are currently cooling down. */
export function rpcCooldowns(): { chainId: number; url: string; msRemaining: number }[] {
  const now = Date.now();
  const out: { chainId: number; url: string; msRemaining: number }[] = [];
  for (const [key, until] of cooldownUntil) {
    if (until <= now) continue;
    const [id, url] = key.split("|");
    out.push({ chainId: Number(id), url, msRemaining: until - now });
  }
  return out;
}
