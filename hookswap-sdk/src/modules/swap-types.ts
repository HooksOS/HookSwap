/**
 * Wire types for the HookSwap Trading adapter (`trading.hookswap.org`) — a headless mirror
 * of `trading-api-adapter/src/tradingApiTypes.ts` (itself a subset of the Uniswap Trading API
 * schema the interface calls). Endpoints served by the adapter:
 *
 *   POST /v1/quote              → QuoteResponse            (real classic v2/v3 route via the in-process SOR)
 *   POST /v1/indicative_quote   → QuoteResponse            (identical shape; routingPreference=FASTEST)
 *   POST /v1/swap               → CreateSwapResponse       (Universal Router calldata; never fabricated)
 *   POST /v1/check_approval     → ApprovalResponse         (real ERC20→Permit2 allowance read)
 *   GET  /v1/swappable_tokens   → GetSwappableTokensResponse
 *
 * DATA POLICY: the adapter returns an honest Trading-API-shaped 404 (`NO_ROUTE_FOUND`) when no
 * route/liquidity exists — never a made-up price or transaction.
 */

export type ChainId = number

export enum TradeType {
  EXACT_INPUT = 'EXACT_INPUT',
  EXACT_OUTPUT = 'EXACT_OUTPUT',
}

export enum Routing {
  CLASSIC = 'CLASSIC',
  WRAP = 'WRAP',
  UNWRAP = 'UNWRAP',
}

export enum ProtocolItems {
  V2 = 'V2',
  V3 = 'V3',
  V4 = 'V4',
}

export enum RoutingPreference {
  BEST_PRICE = 'BEST_PRICE',
  FASTEST = 'FASTEST',
}

/** POST /v1/quote body. Only fields the adapter reads are strongly typed. */
export interface QuoteRequest {
  type: TradeType
  /** raw base-unit amount as a string, e.g. "1000000000000000000". */
  amount: string
  tokenInChainId: ChainId
  tokenOutChainId: ChainId
  /** token address (0x…) or native sentinel. */
  tokenIn: string
  tokenOut: string
  /** the wallet doing the swap; used for calldata generation. */
  swapper: string
  slippageTolerance?: number
  routingPreference?: RoutingPreference
  protocols?: ProtocolItems[]
  recipient?: string
  deadline?: number
  [k: string]: unknown
}

export interface TokenInRoute {
  address?: string
  chainId?: ChainId
  symbol?: string
  /** Trading API types this as a string. */
  decimals?: string
  buyFeeBps?: string
  sellFeeBps?: string
}

export interface V3PoolInRoute {
  type?: string
  address?: string
  tokenIn?: TokenInRoute
  tokenOut?: TokenInRoute
  sqrtRatioX96?: string
  liquidity?: string
  tickCurrent?: string
  fee?: string
  amountIn?: string
  amountOut?: string
}

export interface V2Reserve {
  token?: TokenInRoute
  quotient?: string
}

export interface V2PoolInRoute {
  type?: string
  address?: string
  tokenIn?: TokenInRoute
  tokenOut?: TokenInRoute
  reserve0?: V2Reserve
  reserve1?: V2Reserve
  amountIn?: string
  amountOut?: string
}

export type PoolInRoute = V2PoolInRoute | V3PoolInRoute

export interface QuoteInput {
  amount?: string
  token?: string
  maximumAmount?: string
}

export interface QuoteOutput {
  amount?: string
  token?: string
  recipient?: string
  minimumAmount?: string
}

export interface ClassicQuote {
  input?: QuoteInput
  output?: QuoteOutput
  swapper?: string
  chainId?: ChainId
  slippage?: number
  tradeType?: TradeType
  gasFee?: string
  gasFeeUSD?: string
  route?: PoolInRoute[][]
  routeString?: string
  quoteId?: string
  gasUseEstimate?: string
  blockNumber?: string
  gasPrice?: string
  priceImpact?: number
  portionBips?: number
  portionAmount?: string
  [k: string]: unknown
}

export interface QuoteResponse {
  requestId: string
  quote: ClassicQuote
  routing: Routing
  permitData: null | Record<string, unknown>
}

/** POST /v1/swap body — echo back the exact `ClassicQuote` /v1/quote returned. */
export interface CreateSwapRequest {
  quote: ClassicQuote
  signature?: string
  permitData?: Record<string, unknown> | null
  deadline?: number
  simulateTransaction?: boolean
  [k: string]: unknown
}

/** A real, sendable EVM transaction. */
export interface TransactionRequest {
  to: string
  from: string
  data: string
  value: string
  chainId: ChainId
  gasLimit?: string
  gasPrice?: string
}

export interface CreateSwapResponse {
  requestId: string
  swap: TransactionRequest
  gasFee?: Record<string, unknown>
  gasEstimates?: Record<string, unknown>[]
}

/** POST /v1/check_approval body. */
export interface ApprovalRequest {
  walletAddress: string
  /** input token address (0x…) or native sentinel. */
  token: string
  /** raw base-unit amount to be spent (string). */
  amount: string
  chainId: ChainId
  tokenOut?: string
  tokenOutChainId?: ChainId
  [k: string]: unknown
}

export interface ApprovalResponse {
  requestId: string
  /** the ERC20→Permit2 approve() tx, or null when the existing allowance already covers `amount`. */
  approval: TransactionRequest | null
  /** a revoke tx (adapter never revokes → null). */
  cancel: TransactionRequest | null
  gasFee?: string
  cancelGasFee?: string
}

export interface SwappableToken {
  address: string
  chainId: ChainId
  name: string
  symbol: string
  decimals: number
  project?: Record<string, unknown>
  isSpam?: boolean
}

export interface GetSwappableTokensResponse {
  requestId: string
  tokens: SwappableToken[]
}
