/**
 * Multi-RPC auto-failover for the HookSwap data-api.
 *
 * WHY THIS EXISTS: HookSwap ran every chain read through a single hosted (Alchemy) key. When that key
 * went over quota every chain returned HTTP 429 at once and ALL on-chain reads went dark. Directive
 * (Reggie, 2026-08-02): **public RPCs only, with up to 5 auto-fallback endpoints per chain, no Alchemy
 * anywhere**. So each chain now carries an ORDERED list of live-tested public endpoints, and every
 * JSON-RPC call walks that list until one answers.
 *
 * CONTRACT (identical in trading-api-adapter/src/rpc.ts — the two services are deployed separately, so
 * the module is duplicated rather than shared via a package; keep them in sync):
 *   1. Requests try index 0 first; on failure advance to the next; wrap around. Never hard-fail while
 *      any endpoint is still reachable.
 *   2. `WEB3_RPC_<chainId>` accepts a COMMA-SEPARATED list (a single URL keeps working). Unset/empty →
 *      the built-in public list.
 *   3. Failover triggers: connection errors/timeouts, HTTP 4xx/5xx, JSON-RPC codes 429 / -32005 /
 *      -32001 / -32601, and any message matching RETRYABLE_MESSAGE_RE. A genuine `execution reverted`
 *      is an ANSWER from a healthy endpoint, NOT a failure — it does not fail over.
 *   4. A failed endpoint is marked unhealthy for RPC_COOLDOWN_MS and skipped until it expires.
 *   5. One log line per failover (endpoint, chain, reason).
 *
 * Nothing here fabricates data: if every endpoint fails, the last error is rethrown and callers degrade
 * exactly as they did before (empty lists / undefined, never invented values).
 */

import { ethers } from 'ethers'

/**
 * Per-request RPC timeout (ms). ethers v5 defaults ConnectionInfo.timeout to 120_000ms, which is LONGER
 * than nginx's default 60s `proxy_read_timeout` in front of this service. Capping each RPC call at 8s
 * (a) keeps total handler time under nginx's window and (b) lets the graceful fallbacks fire instead of
 * the whole service wedging on a degraded RPC (observed 2026-07-15). Healthy calls run ~1.5s (~5x headroom).
 * With failover, a hard-down endpoint costs at most one timeout before the next is tried.
 */
export const RPC_TIMEOUT_MS = 8_000

/** How long a failed endpoint is skipped before it is retried (ms). */
export const RPC_COOLDOWN_MS = 60_000

/**
 * Hard cap on the block span of any single `eth_getLogs` call.
 *
 * Several endpoints in the validated table hard-refuse ranges above their own cap and drpc free plans
 * refuse >10000. Caps measured live 2026-08-02: XLayer's `rpc.xlayer.tech` / `xlayerrpc.okx.com` = 100
 * blocks, Stable's `rpc.stable.xyz` / `stable.drpc.org` = 500, HyperEVM's `hyperliquid.rpc.blxrbdn.com`
 * = 1000. All three are BELOW 2000, so 2000 alone is not sufficient — every log scan additionally
 * BISECTS on error (onchain.getLogsBisecting / indexer.getLogsAdaptive), which makes the backfill
 * endpoint-agnostic. Those tight endpoints are also ordered late in their chain's list, so they are
 * only reached once the wide-range primaries are down. Do NOT raise this without re-testing the table.
 *
 * NOTE: drpc's practical limiter is RESULT COUNT (20000 logs), not block range — a 2000-block window
 * on a busy address can still be refused, which is the other reason the bisector is mandatory.
 */
export const MAX_GET_LOGS_RANGE = 2_000

// ============================================================================================
// `eth_getLogs` BUDGET (per-chain token bucket)
// ============================================================================================
/**
 * WHY THIS EXISTS (measured live on the production box 2026-08-03, treat as fact):
 * Robinhood (4663) has exactly ONE working public RPC and it weights `eth_getLogs` FAR more heavily
 * than cheap reads. Measured against `https://rpc.mainnet.chain.robinhood.com`:
 *   - 400 sequential `eth_blockNumber` at 9.2 req/s → no limit hit
 *   - 80 CONCURRENT `eth_blockNumber`               → no limit hit
 *   - **13 sequential `eth_getLogs` (2000-block windows) → HTTP 429 `Too Many Requests`**
 * i.e. the getLogs budget is ~12 per 60s window (the 429 body elsewhere says "limit will reset in 60
 * seconds"), while cheap methods are effectively unmetered.
 *
 * Meanwhile data-api's v3 `PoolCreated` scan issued up to 190 `eth_getLogs` per cache miss, which
 * exhausted that budget in seconds and KEPT it exhausted. Proven blast radius: it starved every OTHER
 * service on the chain — locker-indexer reported Robinhood unreachable, and perps-engine/bot/keeper all
 * got `429 Rate Limit Hit` on plain reads. Pausing data-api + the perps containers for 100s made the
 * endpoint serve 5/5 again immediately.
 *
 * SO: `eth_getLogs` — and ONLY `eth_getLogs` — is metered per chain by the token bucket below, enforced
 * inside FailoverProvider.send so EVERY caller (onchain.ts discovery, indexer/ingest.ts backfill, any
 * future scan) is covered rather than each re-deriving its own limit. Cheap foreground reads
 * (`eth_call`, `eth_blockNumber`, `eth_getBalance`, …) are NEVER budgeted, so a background scan can no
 * longer starve a user-facing quote/balance read.
 *
 * When the bucket is empty a call is REFUSED LOCALLY (no request is sent) with a
 * GetLogsBudgetExhaustedError. Callers must treat that as "yield, persist progress, resume next pass"
 * — never as a retryable RPC error (see isGetLogsBudgetExhausted; the log bisectors in onchain.ts /
 * indexer/ingest.ts rethrow it instead of splitting the range, which would be a hot loop).
 */

/** Fallback `eth_getLogs` budget per window for chains with no measured limit (they served 2000-block windows fine). */
export const DEFAULT_GET_LOGS_BUDGET = 60

/**
 * Per-chain `eth_getLogs` budget overrides (calls per GET_LOGS_WINDOW_MS).
 *
 * 4663 (Robinhood): measured ceiling is ~12/60s and that ceiling is SHARED with locker-indexer,
 * perps-engine, perps-bot and perps-keeper, which all read the same single endpoint. 8 is data-api's
 * deliberately conservative slice — under the measured 429 threshold with room left for those services.
 * Lower it further via `GETLOGS_BUDGET_4663` if the other services still see 429s.
 */
export const GET_LOGS_BUDGET_BY_CHAIN: Readonly<Record<number, number>> = {
  4663: 8,
}

/** Refill window for the bucket (ms). Matches the endpoints' "limit will reset in 60 seconds". */
export const DEFAULT_GET_LOGS_WINDOW_MS = 60_000

/** Thrown INSTEAD of sending an `eth_getLogs` when the chain's budget is exhausted. Nothing was sent. */
export class GetLogsBudgetExhaustedError extends Error {
  /** brand — survives cross-module/duplicated-class boundaries where `instanceof` would not. */
  readonly isGetLogsBudgetExhausted = true
  constructor(
    readonly chainId: number,
    /** ms until at least one call is available again (from the continuous refill). */
    readonly retryAfterMs: number,
    readonly capacity: number,
    readonly windowMs: number,
  ) {
    super(
      `[rpc] chain ${chainId}: eth_getLogs budget exhausted (${capacity} per ${Math.round(
        windowMs / 1000,
      )}s); retry in ${Math.ceil(retryAfterMs / 1000)}s`,
    )
    this.name = 'GetLogsBudgetExhaustedError'
  }
}

/** True when `err` is a local budget refusal (nothing was sent) — caller should YIELD, not retry/bisect. */
export function isGetLogsBudgetExhausted(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { isGetLogsBudgetExhausted?: boolean }).isGetLogsBudgetExhausted)
}

export interface GetLogsBudgetSnapshot {
  chainId: number
  /** calls per window; 0 = budget DISABLED for this chain. */
  capacity: number
  windowMs: number
  /** whole calls currently available. */
  available: number
  /** ms until the next call is available (0 when one is available now). */
  retryAfterMs: number
}

/**
 * Continuous-refill token bucket: capacity `capacity`, refilling at `capacity / windowMs` tokens per ms.
 * Continuous (rather than a fixed window that resets in one step) so an exhausted scan trickles back in
 * instead of stampeding the endpoint the instant the window flips.
 */
class GetLogsBudget {
  private tokens: number
  private lastRefillMs = Date.now()
  /** epoch ms of the last emitted throttle log — refusals are logged at most once per window. */
  private lastLogMs = 0
  private suppressedSinceLog = 0

  constructor(readonly chainId: number, readonly capacity: number, readonly windowMs: number) {
    this.tokens = capacity
  }

  private refill(now: number): void {
    if (now <= this.lastRefillMs) {
      return
    }
    const perMs = this.capacity / this.windowMs
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.lastRefillMs) * perMs)
    this.lastRefillMs = now
  }

  /** Consume one call. `retryAfterMs` is set only when refused. */
  tryConsume(now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    if (this.capacity <= 0) {
      return { allowed: true, retryAfterMs: 0 } // explicitly disabled via env
    }
    this.refill(now)
    if (this.tokens >= 1) {
      this.tokens -= 1
      return { allowed: true, retryAfterMs: 0 }
    }
    const perMs = this.capacity / this.windowMs
    return { allowed: false, retryAfterMs: Math.ceil((1 - this.tokens) / perMs) }
  }

  /**
   * ONE log line per window while throttling (not one per refused request) — a starved scan can refuse
   * hundreds of times a second, and per-request logging is exactly the spam that hides the real signal.
   */
  logThrottle(retryAfterMs: number, now = Date.now()): void {
    if (now - this.lastLogMs < this.windowMs) {
      this.suppressedSinceLog += 1
      return
    }
    const suppressed = this.suppressedSinceLog
    this.lastLogMs = now
    this.suppressedSinceLog = 0
    // eslint-disable-next-line no-console
    console.warn(
      `[rpc] chain ${this.chainId}: eth_getLogs THROTTLED — budget ${this.capacity}/${Math.round(
        this.windowMs / 1000,
      )}s exhausted, next call in ~${Math.ceil(retryAfterMs / 1000)}s` +
        (suppressed > 0 ? ` (${suppressed} further refusals suppressed since the last line)` : '') +
        '; scans yield and resume from their persisted cursor',
    )
  }

  snapshot(now = Date.now()): GetLogsBudgetSnapshot {
    this.refill(now)
    const perMs = this.capacity / this.windowMs
    return {
      chainId: this.chainId,
      capacity: this.capacity,
      windowMs: this.windowMs,
      available: Math.floor(this.tokens),
      retryAfterMs: this.capacity <= 0 || this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) / perMs),
    }
  }
}

const budgets = new Map<number, GetLogsBudget>()

/** Parse a non-negative integer env var; undefined when unset/blank/malformed (never throws). */
function envInt(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw || !/^\d+$/.test(raw.trim())) {
    return undefined
  }
  return Number(raw.trim())
}

/**
 * The chain's `eth_getLogs` budget, created on first use.
 *
 * Resolution order (all env-overridable, per chain first):
 *   capacity: `GETLOGS_BUDGET_<chainId>` → GET_LOGS_BUDGET_BY_CHAIN[chainId] → `GETLOGS_BUDGET_DEFAULT`
 *             → DEFAULT_GET_LOGS_BUDGET. **`0` explicitly DISABLES the budget for that chain.**
 *   window:   `GETLOGS_WINDOW_MS_<chainId>` → `GETLOGS_WINDOW_MS_DEFAULT` → DEFAULT_GET_LOGS_WINDOW_MS.
 */
export function getLogsBudgetFor(chainId: number): GetLogsBudget {
  const existing = budgets.get(chainId)
  if (existing) {
    return existing
  }
  const capacity =
    envInt(`GETLOGS_BUDGET_${chainId}`) ??
    GET_LOGS_BUDGET_BY_CHAIN[chainId] ??
    envInt('GETLOGS_BUDGET_DEFAULT') ??
    DEFAULT_GET_LOGS_BUDGET
  const windowMs =
    envInt(`GETLOGS_WINDOW_MS_${chainId}`) ?? envInt('GETLOGS_WINDOW_MS_DEFAULT') ?? DEFAULT_GET_LOGS_WINDOW_MS
  const budget = new GetLogsBudget(chainId, capacity, Math.max(1, windowMs))
  budgets.set(chainId, budget)
  return budget
}

/** Current budget state for every chain touched so far (ops/health surface + tests). */
export function getLogsBudgetSnapshots(): GetLogsBudgetSnapshot[] {
  return Array.from(budgets.values()).map((b) => b.snapshot())
}

/** Drop all buckets so the next call re-reads env. TESTS ONLY (and after a config reload). */
export function resetGetLogsBudgets(): void {
  budgets.clear()
}

/**
 * Consume one `eth_getLogs` from the chain's budget, or throw GetLogsBudgetExhaustedError without
 * sending anything. Exported so a non-FailoverProvider code path can opt in to the same meter.
 */
export function consumeGetLogsBudget(chainId: number): void {
  const budget = getLogsBudgetFor(chainId)
  const { allowed, retryAfterMs } = budget.tryConsume()
  if (allowed) {
    return
  }
  budget.logThrottle(retryAfterMs)
  throw new GetLogsBudgetExhaustedError(chainId, retryAfterMs, budget.capacity, budget.windowMs)
}

/**
 * ⛔ RPC BLACKLIST — endpoints that answer HTTP 200 with WRONG data.
 *
 * These are far more dangerous than a dead endpoint: a dead endpoint fails over, but a silently-wrong
 * one poisons pool discovery / balances / TVL with data that LOOKS valid. Every entry below was
 * live-tested 2026-08-02. Never add any of these to a chain's list, and env-supplied URLs are filtered
 * against this list at parse time.
 */
export const BLACKLISTED_RPCS: ReadonlyArray<{ url: string; reason: string }> = [
  {
    url: 'https://megaeth.blockscout.com/api/eth-rpc',
    reason: 'silently DROPS logs and caps results at 1000 with no error (HTTP 200, truncated result)',
  },
  {
    url: 'https://robinhood.drpc.org',
    reason: 'returns a correct eth_chainId but every other method answers "does not exist"',
  },
  {
    url: 'https://robinhoodchain.blockscout.com/api/eth-rpc',
    reason: 'HTTP 429 delivered as `result: null` with NO `error` field — indistinguishable from an empty answer',
  },
  {
    url: 'https://ethereum-sepolia-rpc.publicnode.com',
    reason: '403 on eth_getLogs and on any archive eth_call',
  },
  // NOTE (not blacklisted): https://sepolia.gateway.tenderly.co silently TRUNCATES eth_getLogs above
  // 10000 blocks. It is safe here only because MAX_GET_LOGS_RANGE chunks at 2000.
]

const BLACKLIST_KEYS = new Map(BLACKLISTED_RPCS.map((b) => [normalizeRpcUrl(b.url), b.reason]))

/** Normalize a URL for blacklist comparison: lowercase, no trailing slash, no query/hash. */
function normalizeRpcUrl(url: string): string {
  return url.trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '')
}

/** If `url` is blacklisted, return WHY (for logging); otherwise undefined. */
export function blacklistReason(url: string): string | undefined {
  return BLACKLIST_KEYS.get(normalizeRpcUrl(url))
}

/**
 * JSON-RPC error codes that mean "this endpoint can't serve you right now" → fail over.
 *   429     — rate limited (some providers put the HTTP status in the JSON-RPC code field)
 *   -32005  — limit exceeded (standard "request rate exceeded" / "block range too large")
 *   -32001  — resource not found / method unavailable on this plan
 *   -32601  — method not found (endpoint doesn't implement it; another might)
 */
const RETRYABLE_RPC_CODES = new Set([429, -32005, -32001, -32601])

/** Message substrings that mean the endpoint is refusing/limiting us, regardless of the code shape. */
const RETRYABLE_MESSAGE_RE = /capacity|rate limit|rate-limit|too many requests|exceeds|not available|payment required/i

/**
 * A revert is an ANSWER from a HEALTHY endpoint — every other endpoint would return the same revert, so
 * failing over just burns the whole list. JSON-RPC code 3 is the standard "execution reverted" (with
 * ABI-encoded revert data); other clients report it as -32000 with an "execution reverted" message.
 */
const REVERT_RE = /execution reverted/i

export interface RpcErrorClassification {
  /** true → this endpoint is unhealthy, advance to the next. false → terminal answer, stop. */
  failover: boolean
  /** short human reason, used in the single failover log line. */
  reason: string
}

/**
 * Decide whether an error from one endpoint should trigger failover. Errs on the side of failing over:
 * anything that is not a recognised terminal answer (revert / bad client argument) is treated as an
 * endpoint failure, because a wrong "healthy" verdict silently blanks chain data.
 */
export function classifyRpcError(err: unknown): RpcErrorClassification {
  // A LOCAL budget refusal is not an endpoint verdict at all — nothing was sent. Failing over would
  // just re-refuse on every endpoint (the bucket is per CHAIN), so it is terminal by construction.
  if (isGetLogsBudgetExhausted(err)) {
    return { failover: false, reason: 'eth_getLogs budget exhausted (not sent)' }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ethers v5 errors are untyped bags.
  const e = err as any
  const ethersCode: string | undefined = typeof e?.code === 'string' ? e.code : undefined
  const rpcCode: number | undefined =
    typeof e?.error?.code === 'number' ? e.error.code : typeof e?.code === 'number' ? e.code : undefined
  const status: number | undefined =
    typeof e?.status === 'number' ? e.status : typeof e?.statusCode === 'number' ? e.statusCode : undefined
  const message = String(e?.error?.message ?? e?.reason ?? e?.message ?? e?.body ?? e ?? '')

  // ---- terminal answers: the endpoint is fine, the CALL failed ----
  if (rpcCode === 3 || REVERT_RE.test(message)) {
    return { failover: false, reason: 'execution reverted' }
  }
  if (
    ethersCode === ethers.utils.Logger.errors.CALL_EXCEPTION ||
    ethersCode === ethers.utils.Logger.errors.INVALID_ARGUMENT ||
    ethersCode === ethers.utils.Logger.errors.NUMERIC_FAULT
  ) {
    return { failover: false, reason: `client/contract error (${ethersCode})` }
  }

  // ---- endpoint failures ----
  if (rpcCode !== undefined && RETRYABLE_RPC_CODES.has(rpcCode)) {
    return { failover: true, reason: `json-rpc code ${rpcCode}` }
  }
  if (status !== undefined && status >= 400) {
    return { failover: true, reason: `http ${status}` }
  }
  if (RETRYABLE_MESSAGE_RE.test(message)) {
    return { failover: true, reason: `refused: ${message.slice(0, 120)}` }
  }
  if (ethersCode === ethers.utils.Logger.errors.TIMEOUT) {
    return { failover: true, reason: `timeout (${RPC_TIMEOUT_MS}ms)` }
  }
  // Connection errors, SERVER_ERROR, NETWORK_ERROR, DNS failures, malformed JSON, unknown shapes.
  return { failover: true, reason: ethersCode ?? message.slice(0, 120) ?? 'unknown error' }
}

/**
 * Parse a chain's endpoint list.
 *
 * `raw` is the value of `WEB3_RPC_<chainId>`: a single URL OR a comma-separated list (backwards
 * compatible). Unset/empty/all-blacklisted → the built-in `publicRpcs`. Blacklisted and malformed
 * entries are dropped with a warning — never silently kept.
 */
export function parseRpcList(raw: string | undefined, publicRpcs: readonly string[], chainLabel: string): string[] {
  const fromEnv = (raw ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
    .filter((u) => {
      if (!/^https?:\/\//i.test(u)) {
        console.warn(`[rpc] chain ${chainLabel}: ignoring non-http RPC entry from env: ${u}`)
        return false
      }
      const why = blacklistReason(u)
      if (why) {
        console.warn(`[rpc] chain ${chainLabel}: ignoring BLACKLISTED RPC ${u} — ${why}`)
        return false
      }
      return true
    })
  const chosen = fromEnv.length > 0 ? fromEnv : publicRpcs.filter((u) => !blacklistReason(u))
  // Dedupe while preserving order — the order IS the preference.
  return [...new Set(chosen)]
}

interface Endpoint {
  url: string
  provider: ethers.providers.StaticJsonRpcProvider
  /** epoch ms until which this endpoint is skipped; 0 = healthy. */
  unhealthyUntil: number
  failures: number
}

export interface EndpointStatus {
  url: string
  healthy: boolean
  failures: number
  cooldownRemainingMs: number
}

/**
 * A sequential multi-endpoint RPC provider: every JSON-RPC call is tried against each endpoint in the
 * configured order, failing over on any endpoint failure, and only surfacing the last error if ALL
 * endpoints fail. This is what makes a single-provider quota blowout (the 2026-08-02 Alchemy 429) NOT
 * blank on-chain reads.
 *
 * WHY NOT ethers' FallbackProvider: verified 2026-07-24 that with quorum 1 it surfaces a CALL_EXCEPTION
 * from a dead primary instead of failing over (it treats the primary's error as a terminal result), and
 * its quorum/weight machinery fans out redundant calls to every endpoint — exactly the wrong shape when
 * the whole point is to CONSERVE free-tier quota. This wrapper fails over deterministically and only
 * ever touches one endpoint per successful call. It extends StaticJsonRpcProvider (static network from
 * the passed chainId → no per-call eth_chainId round-trip) and overrides `send`, through which every
 * BaseProvider read (call/getLogs/getBalance/getBlockNumber/…) routes.
 */
export class FailoverProvider extends ethers.providers.StaticJsonRpcProvider {
  private readonly endpoints: Endpoint[]
  private readonly chainLabel: string
  /** the chainId as CONFIGURED (not read from `this.network`, which is not resolved inside send()). */
  private readonly chainIdForBudget: number

  constructor(urls: string[], chainId: number, chainLabel?: string) {
    super({ url: urls[0], timeout: RPC_TIMEOUT_MS }, chainId)
    this.chainLabel = chainLabel ?? String(chainId)
    this.chainIdForBudget = chainId
    this.endpoints = urls.map((url) => ({
      url,
      provider: new ethers.providers.StaticJsonRpcProvider({ url, timeout: RPC_TIMEOUT_MS }, chainId),
      unhealthyUntil: 0,
      failures: 0,
    }))
  }

  /** Current health of every endpoint — for the /health surface and the failover test harness. */
  status(): EndpointStatus[] {
    const now = Date.now()
    return this.endpoints.map((e) => ({
      url: e.url,
      healthy: e.unhealthyUntil <= now,
      failures: e.failures,
      cooldownRemainingMs: Math.max(0, e.unhealthyUntil - now),
    }))
  }

  /** The endpoint a call would be attempted against right now (index 0 unless it is cooling down). */
  currentUrl(): string {
    const now = Date.now()
    return (this.endpoints.find((e) => e.unhealthyUntil <= now) ?? this.endpoints[0]).url
  }

  private markUnhealthy(ep: Endpoint, reason: string, nextUrl: string | undefined): void {
    ep.failures += 1
    // Log ONLY on the healthy→unhealthy transition, so a hot loop against a down endpoint emits one
    // line per cooldown window instead of one per request (still exactly one line per failover EVENT).
    if (ep.unhealthyUntil <= Date.now()) {
      console.warn(
        `[rpc] chain ${this.chainLabel}: FAILOVER from ${ep.url} — ${reason}; ` +
          `cooling down ${RPC_COOLDOWN_MS / 1000}s; next → ${nextUrl ?? '(none left)'}`,
      )
    }
    ep.unhealthyUntil = Date.now() + RPC_COOLDOWN_MS
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches ethers v5 JsonRpcProvider.send.
  async send(method: string, params: Array<any>): Promise<any> {
    // METER `eth_getLogs` ONLY — every other method (eth_call, eth_blockNumber, eth_getBalance, …) is
    // cheap on these endpoints and must never be blocked by a background scan's log budget. Enforced
    // here, ahead of endpoint selection, so ALL callers on this chain share one bucket. Throws
    // GetLogsBudgetExhaustedError WITHOUT sending anything when the budget is spent.
    if (method === 'eth_getLogs') {
      consumeGetLogsBudget(this.chainIdForBudget)
    }
    const now = Date.now()
    const healthy = this.endpoints.filter((e) => e.unhealthyUntil <= now)
    const coolingDown = this.endpoints.filter((e) => e.unhealthyUntil > now)
    // Pass 1: healthy endpoints in configured order (index 0 first). Pass 2 wraps around onto the
    // cooling-down ones so we never hard-fail while ANY endpoint might still answer.
    const order = [...healthy, ...coolingDown]
    if (order.length === 0) {
      throw new Error(`[rpc] chain ${this.chainLabel}: no RPC endpoints configured`)
    }

    let lastErr: unknown
    for (let i = 0; i < order.length; i++) {
      const ep = order[i]
      try {
        const result = await ep.provider.send(method, params)
        // A successful call clears the cooldown — the endpoint is demonstrably back.
        ep.unhealthyUntil = 0
        return result
      } catch (e) {
        const { failover, reason } = classifyRpcError(e)
        if (!failover) {
          throw e // terminal answer (revert / bad argument) — every endpoint would say the same.
        }
        lastErr = e
        this.markUnhealthy(ep, `${method}: ${reason}`, order[i + 1]?.url)
      }
    }
    throw lastErr
  }
}

/**
 * Build the provider for a chain. Return type is StaticJsonRpcProvider so callers that need the
 * JsonRpcProvider surface (contracts, multicall) keep working.
 *
 * ALWAYS a FailoverProvider, even for a single endpoint. The old single-endpoint shortcut returned a
 * bare StaticJsonRpcProvider, which bypassed `send` — and therefore the `eth_getLogs` budget. That is
 * exactly backwards for the chain that needs the budget most: **Robinhood (4663) has exactly ONE
 * working public RPC**, so it would have been the only chain left unmetered. With one url the failover
 * loop is a single attempt, i.e. behaviourally identical to the old shortcut apart from the meter.
 */
export function createFailoverProvider(
  urls: string[],
  chainId: number,
  chainLabel?: string,
): ethers.providers.StaticJsonRpcProvider {
  if (urls.length === 0) {
    throw new Error(`[rpc] chain ${chainLabel ?? chainId}: no RPC endpoints configured`)
  }
  return new FailoverProvider(urls, chainId, chainLabel)
}
