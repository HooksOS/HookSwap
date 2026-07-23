/**
 * HookSwap Terminal — Relay API client (cross-chain bridge).
 *
 * Thin, typed wrapper over the Relay REST API (https://api.relay.link). All data
 * is fetched LIVE — no mock quotes, no hardcoded chain lists. Verified endpoints:
 *   • GET  /chains                        → full supported-chain catalogue
 *   • POST /quote                         → executable bridge route (+ app fee)
 *   • GET  /intents/status?requestId=…    → fill status of a submitted intent
 *
 * The HookSwap app fee is injected into every quote via `appFees` (→ treasury).
 */
import { buildAppFees, RELAY_API_BASE } from '~/terminal/bridge/addresses'

/* --------------------------------------------------------------- chains */

/** A currency as described by Relay's chain catalogue / quote payloads. */
export interface RelayCurrencyMeta {
  id?: string
  symbol?: string
  name?: string
  address?: string
  decimals?: number
  supportsBridging?: boolean
  metadata?: { logoURI?: string; verified?: boolean }
}

/** One chain entry from GET /chains. */
export interface RelayChain {
  id: number
  name?: string
  displayName?: string
  /** Native gas currency (zero-address `currency.address`). */
  currency?: RelayCurrencyMeta
  /** A short list of featured bridgeable ERC-20s on this chain. */
  erc20Currencies?: RelayCurrencyMeta[]
  iconUrl?: string
  logoUrl?: string
  depositEnabled?: boolean
  disabled?: boolean
  vmType?: string
}

/** GET /chains — the full live catalogue of Relay-supported chains. */
export async function fetchRelayChains(signal?: AbortSignal): Promise<RelayChain[]> {
  const res = await fetch(`${RELAY_API_BASE}/chains`, { signal })
  if (!res.ok) {
    throw new Error(`Relay /chains failed (${res.status})`)
  }
  const body = (await res.json()) as { chains?: RelayChain[] } | RelayChain[]
  const chains = Array.isArray(body) ? body : body.chains ?? []
  // Only EVM chains that can actually receive a deposit — honest selectability.
  return chains.filter((c) => c.depositEnabled !== false && c.disabled !== true)
}

/* --------------------------------------------------------------- currencies */

/** POST /currencies/v2 — search bridgeable tokens on a chain (token selector). */
export async function fetchRelayCurrencies(
  chainId: number,
  term?: string,
  signal?: AbortSignal,
): Promise<RelayCurrencyMeta[]> {
  const res = await fetch(`${RELAY_API_BASE}/currencies/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chainIds: [chainId], term: term || undefined, limit: 20, verified: true }),
    signal,
  })
  if (!res.ok) {
    throw new Error(`Relay /currencies failed (${res.status})`)
  }
  const body = (await res.json()) as RelayCurrencyMeta[] | { currencies?: RelayCurrencyMeta[] }
  return Array.isArray(body) ? body : body.currencies ?? []
}

/* --------------------------------------------------------------- quote */

export type RelayTradeType = 'EXACT_INPUT' | 'EXACT_OUTPUT' | 'EXPECTED_OUTPUT'

export interface RelayQuoteRequest {
  user: string
  recipient: string
  originChainId: number
  destinationChainId: number
  originCurrency: string
  destinationCurrency: string
  /** Amount in the origin currency's smallest units (base units). */
  amount: string
  tradeType?: RelayTradeType
}

/** A currency amount as returned inside quote `details` / `fees`. */
export interface RelayCurrencyAmount {
  currency?: RelayCurrencyMeta
  amount?: string
  amountFormatted?: string
  amountUsd?: string
  minimumAmount?: string
}

/** One transaction/signature the wallet must submit. */
export interface RelayStepItem {
  status?: string
  data?: {
    from?: string
    to?: string
    data?: string
    value?: string
    chainId?: number
    gas?: string
    maxFeePerGas?: string
    maxPriorityFeePerGas?: string
  }
  /** Poll target for the resulting intent (carries the requestId). */
  check?: { endpoint?: string; method?: string }
}

export interface RelayStep {
  id?: string
  action?: string
  description?: string
  kind?: string // "transaction" | "signature"
  items?: RelayStepItem[]
}

export interface RelayQuoteResponse {
  steps?: RelayStep[]
  fees?: {
    gas?: RelayCurrencyAmount
    relayer?: RelayCurrencyAmount
    relayerGas?: RelayCurrencyAmount
    relayerService?: RelayCurrencyAmount
    app?: RelayCurrencyAmount
  }
  details?: {
    currencyIn?: RelayCurrencyAmount
    currencyOut?: RelayCurrencyAmount
    totalImpact?: { usd?: string; percent?: string }
    swapImpact?: { usd?: string; percent?: string }
    rate?: string
    slippageTolerance?: {
      origin?: { percent?: string }
      destination?: { percent?: string }
    }
    timeEstimate?: number
  }
}

/** Raised when Relay reports no executable route for the requested pair/amount. */
export class RelayNoRouteError extends Error {
  constructor(message = 'No bridge route for this pair/amount') {
    super(message)
    this.name = 'RelayNoRouteError'
  }
}

/**
 * POST /quote — fetch an executable bridge route. The HookSwap app fee is always
 * attached via `appFees` (→ treasury). A "no route" / unsupported-pair response
 * is surfaced as {@link RelayNoRouteError} (not a silent failure).
 */
export async function fetchRelayQuote(
  req: RelayQuoteRequest,
  signal?: AbortSignal,
): Promise<RelayQuoteResponse> {
  const res = await fetch(`${RELAY_API_BASE}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...req,
      tradeType: req.tradeType ?? 'EXACT_INPUT',
      appFees: buildAppFees(),
    }),
    signal,
  })

  if (!res.ok) {
    // Relay returns a JSON error body — surface its message honestly.
    let detail = ''
    try {
      const err = (await res.json()) as { message?: string; error?: string }
      detail = err.message || err.error || ''
    } catch {
      /* non-JSON body */
    }
    if (res.status === 404 || /no\s?route|no\s?quote|unsupported|not\s?found|liquidity/i.test(detail)) {
      throw new RelayNoRouteError(detail || undefined)
    }
    throw new Error(detail || `Relay /quote failed (${res.status})`)
  }

  const quote = (await res.json()) as RelayQuoteResponse
  if (!quote.steps || quote.steps.length === 0) {
    throw new RelayNoRouteError()
  }
  return quote
}

/* --------------------------------------------------------------- status */

export type RelayIntentStatus =
  | 'unknown'
  | 'pending'
  | 'received'
  | 'success'
  | 'failure'
  | 'fallback'
  | 'refund'

export interface RelayStatusResponse {
  status: RelayIntentStatus
  details?: string
  txHashes?: string[]
  destinationChainId?: number
  inTxHashes?: string[]
}

/**
 * Extract the intent `requestId` and its status poll URL from a quote's steps.
 * Relay carries these in the deposit item's `check.endpoint`
 * (`/intents/status?requestId=0x…`) — verified live.
 */
export function extractRequestId(quote: RelayQuoteResponse): string | undefined {
  for (const step of quote.steps ?? []) {
    for (const item of step.items ?? []) {
      const endpoint = item.check?.endpoint
      if (endpoint) {
        const match = endpoint.match(/requestId=([0-9a-zA-Zx]+)/)
        if (match) {
          return match[1]
        }
      }
    }
  }
  return undefined
}

/** GET /intents/status?requestId=… — the current fill status of a submitted intent. */
export async function fetchRelayStatus(
  requestId: string,
  signal?: AbortSignal,
): Promise<RelayStatusResponse> {
  const res = await fetch(`${RELAY_API_BASE}/intents/status?requestId=${encodeURIComponent(requestId)}`, {
    signal,
  })
  if (!res.ok) {
    throw new Error(`Relay /intents/status failed (${res.status})`)
  }
  return (await res.json()) as RelayStatusResponse
}
