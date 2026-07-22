/**
 * `swap` — the HookSwap Trading adapter module (`trading.hookswap.org`).
 *
 * Wraps the deployed adapter's Trading-API-shaped endpoints as typed methods. Quoting needs
 * NO wallet — `quote()` / `indicativeQuote()` only need token addresses + an amount. Building
 * an executable transaction needs the ClassicQuote echoed back (`buildSwap`) and the swapper's
 * approval state (`checkApproval`).
 *
 * The adapter runs the in-process Smart Order Router (embed mode) and returns REAL classic
 * v2/v3 routes + Universal Router calldata, or an honest 404 (`NO_ROUTE_FOUND`) until on-chain
 * liquidity exists. This module never fabricates a price or a transaction — a 404 surfaces as
 * an `HttpApiError` with `status: 404` and `errorCode: 'NO_ROUTE_FOUND'`.
 *
 * Default base: `https://trading.hookswap.org` (override via the client `tradingBaseUrl`).
 */
import { httpJson } from '../http.js'
import type {
  ApprovalRequest,
  ApprovalResponse,
  CreateSwapRequest,
  CreateSwapResponse,
  GetSwappableTokensResponse,
  QuoteRequest,
  QuoteResponse,
} from './swap-types.js'

export class SwapModule {
  /** The resolved trading adapter base URL (e.g. `https://trading.hookswap.org`). */
  readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  /**
   * `POST /v1/quote` — a real classic v2/v3 route + amounts for the requested swap.
   * Throws `HttpApiError{status:404, errorCode:'NO_ROUTE_FOUND'}` when no route/liquidity exists.
   */
  quote(req: QuoteRequest, signal?: AbortSignal): Promise<QuoteResponse> {
    return httpJson<QuoteResponse>(this.baseUrl, '/v1/quote', { body: req, signal })
  }

  /**
   * `POST /v1/indicative_quote` — identical response shape to `quote()` (routingPreference=FASTEST),
   * used for the fast display estimate. Same honest-404 behavior.
   */
  indicativeQuote(req: QuoteRequest, signal?: AbortSignal): Promise<QuoteResponse> {
    return httpJson<QuoteResponse>(this.baseUrl, '/v1/indicative_quote', { body: req, signal })
  }

  /**
   * `POST /v1/swap` — build the executable Universal Router transaction for a quote. Pass back
   * the exact `ClassicQuote` object `quote()` returned (with `swapper` set). Returns a real,
   * sendable `TransactionRequest`; throws `HttpApiError{status:404}` if no calldata could be built.
   */
  buildSwap(req: CreateSwapRequest, signal?: AbortSignal): Promise<CreateSwapResponse> {
    return httpJson<CreateSwapResponse>(this.baseUrl, '/v1/swap', { body: req, signal })
  }

  /**
   * `POST /v1/check_approval` — whether `walletAddress` must approve `token` to Permit2 before
   * swapping. `approval` is the real approve() tx when the on-chain allowance is short, or `null`
   * when the token is already approved / is native. No fabrication — the allowance is read on-chain.
   */
  checkApproval(req: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalResponse> {
    return httpJson<ApprovalResponse>(this.baseUrl, '/v1/check_approval', { body: req, signal })
  }

  /**
   * `GET /v1/swappable_tokens?tokenIn=<addr>&tokenInChainId=<id>` — tokens the adapter can route
   * `tokenIn` against on the given chain.
   */
  swappableTokens(tokenIn: string, tokenInChainId: number, signal?: AbortSignal): Promise<GetSwappableTokensResponse> {
    return httpJson<GetSwappableTokensResponse>(this.baseUrl, '/v1/swappable_tokens', {
      params: { tokenIn, tokenInChainId },
      signal,
    })
  }
}
