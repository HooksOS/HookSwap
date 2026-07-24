/**
 * Honest translation between the classic routing-api schema and the Trading API schema.
 *
 * NO price data is invented here. Every amount/route field in the output is copied straight
 * from the routing-api response. If routing-api returns no route, the caller returns a 404 —
 * this module is never asked to synthesize a quote.
 */

import {
  ClassicQuote,
  PoolInRoute,
  QuoteRequest,
  QuoteResponse,
  Routing,
  TokenInRoute,
  TradeType,
  V2PoolInRoute,
  V3PoolInRoute,
  V4PoolInRoute,
} from './tradingApiTypes'
import { RoutingApiPoolInRoute, RoutingApiQuoteResponse } from './routingClient'

function toTokenInRoute(t: { chainId: number; decimals: string; address: string; symbol?: string }): TokenInRoute {
  return {
    address: t.address,
    chainId: t.chainId,
    symbol: t.symbol,
    decimals: t.decimals, // Trading API TokenInRoute.decimals is a *string* — routing-api already gives a string.
  }
}

function toPoolInRoute(p: RoutingApiPoolInRoute): PoolInRoute {
  if (p.type === 'v4-pool') {
    // v4 pools have no ERC20 pair `address`; identity is the PoolKey (fee/tickSpacing/hooks).
    const v4: V4PoolInRoute = {
      type: 'v4-pool',
      tokenIn: toTokenInRoute(p.tokenIn),
      tokenOut: toTokenInRoute(p.tokenOut),
      fee: p.fee,
      tickSpacing: p.tickSpacing,
      hooks: p.hooks,
      sqrtRatioX96: p.sqrtRatioX96,
      liquidity: p.liquidity,
      tickCurrent: p.tickCurrent,
      amountIn: p.amountIn,
      amountOut: p.amountOut,
    }
    return v4
  }
  if (p.type === 'v3-pool') {
    const v3: V3PoolInRoute = {
      type: 'v3-pool',
      address: p.address,
      tokenIn: toTokenInRoute(p.tokenIn),
      tokenOut: toTokenInRoute(p.tokenOut),
      sqrtRatioX96: p.sqrtRatioX96,
      liquidity: p.liquidity,
      tickCurrent: p.tickCurrent,
      fee: p.fee,
      amountIn: p.amountIn,
      amountOut: p.amountOut,
    }
    return v3
  }
  const v2: V2PoolInRoute = {
    type: 'v2-pool',
    address: p.address,
    tokenIn: toTokenInRoute(p.tokenIn),
    tokenOut: toTokenInRoute(p.tokenOut),
    reserve0: p.reserve0 ? { token: { address: p.reserve0.token.address }, quotient: p.reserve0.quotient } : undefined,
    reserve1: p.reserve1 ? { token: { address: p.reserve1.token.address }, quotient: p.reserve1.quotient } : undefined,
    amountIn: p.amountIn,
    amountOut: p.amountOut,
  }
  return v2
}

/**
 * Map a routing-api classic quote into the Trading API QuoteResponse (routing = CLASSIC).
 *
 * For EXACT_INPUT: request.amount is the input amount, routing-api `quote` is the output amount.
 * For EXACT_OUTPUT: request.amount is the output amount, routing-api `quote` is the input amount.
 */
export function toTradingApiQuoteResponse(params: {
  request: QuoteRequest
  routing: RoutingApiQuoteResponse
  requestId: string
}): QuoteResponse {
  const { request, routing, requestId } = params
  const isExactIn = request.type === TradeType.EXACT_INPUT

  const inputAmount = isExactIn ? request.amount : routing.quote
  const outputAmount = isExactIn ? routing.quote : request.amount

  const route: PoolInRoute[][] = (routing.route ?? []).map((hop) => hop.map(toPoolInRoute))

  const quote: ClassicQuote = {
    chainId: request.tokenInChainId,
    swapper: request.swapper,
    tradeType: request.type,
    input: { token: request.tokenIn, amount: inputAmount },
    output: { token: request.tokenOut, amount: outputAmount, recipient: request.recipient ?? request.swapper },
    slippage: request.slippageTolerance,
    route,
    routeString: routing.routeString,
    quoteId: routing.quoteId ?? requestId,
    gasUseEstimate: routing.gasUseEstimate,
    gasFeeUSD: routing.gasUseEstimateUSD,
    gasPrice: routing.gasPriceWei,
    blockNumber: routing.blockNumber,
    // LIVE HookSwap output-token fee (PAY_PORTION). Copied straight from routing — never invented.
    // Present only when the built calldata actually skims the fee (embedRouter gates it), so the
    // interface's fee display + client-side FeeOptions match the on-chain behavior exactly.
    portionBips: routing.portionBips,
    portionAmount: routing.portionAmount,
    portionRecipient: routing.portionRecipient,
  }

  return {
    requestId,
    routing: Routing.CLASSIC,
    quote,
    // permit2 message is assembled by the /swap step (not implemented here). Interface treats
    // null as "no permit needed / handle at swap time".
    permitData: null,
  }
}
