/**
 * EMBED routing — in-process smart-order-router (HookSwap fork of @uniswap/smart-order-router).
 *
 * Computes routes directly against the deployed HookSwap v2/v3 pools + per-chain RPC, and maps
 * the SOR `SwapRoute` into the classic routing-api response shape (`RoutingApiQuoteResponse`) so
 * `translate.ts` maps it to the Trading API shape unchanged — exactly like PROXY mode, minus the
 * routing-api hop.
 *
 * Requires (see package.json + the fork override): `@uniswap/smart-order-router` (fork, which
 * carries the deployed factory/quoter/router addresses for chainIds 999/4663/4326/57073/196/4217),
 * `@uniswap/sdk-core` (fork, which defines those ChainIds), and `ethers@^5`.
 *
 * Returns `undefined` when no route is found (→ the handler emits a Trading-API 404 NO_ROUTE_FOUND).
 * Never fabricates a price.
 */
import {
  AlphaRouter,
  StaticV2SubgraphProvider,
  StaticV3SubgraphProvider,
  SwapType,
  UniswapMulticallProvider,
  V3PoolProvider,
  type SwapRoute,
  type SwapOptions,
} from '@uniswap/smart-order-router'
import { CurrencyAmount, Percent, Token, TradeType, type Currency } from '@uniswap/sdk-core'
import { Protocol } from '@uniswap/router-sdk'
import { Actions, URVersion, V4Planner } from '@uniswap/v4-sdk'
import { ethers } from 'ethers'
import type { ChainConfig } from './chains'
import { HOOKSWAP_FEE_BIPS, HOOKSWAP_FEE_RECIPIENT, resolveRpcUrl } from './chains'
import { patchMinHopPriceCalldata } from './urCalldata'
import type {
  QuoteExactRouteParams,
  RoutingApiPoolInRoute,
  RoutingApiQuoteResponse,
  RoutingProvider,
} from './routingClient'

const ERC20_DECIMALS_ABI = ['function decimals() view returns (uint8)', 'function symbol() view returns (string)']

/** Native sentinels the interface/Trading-API use for "the chain's native currency". */
const NATIVE_ADDRESSES = new Set([
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '0x0000000000000000000000000000000000000000',
  'eth',
  'native',
])

function isNativeAddress(address: string): boolean {
  return NATIVE_ADDRESSES.has(address.toLowerCase())
}

// ---------------------------------------------------------------------------
// Uniswap v4 single-hop quoting (direct on-chain, separate from the SOR v2/v3 path).
// ---------------------------------------------------------------------------

/** v4 uses address(0) for the native currency; it always sorts as currency0. */
const V4_ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

/** Universal Router `V4_SWAP` command (top bit = FLAG_ALLOW_REVERT, unset here). */
const UR_COMMAND_V4_SWAP = 0x10

/**
 * Universal Router entrypoint used to assemble v4 swap calldata. The deadline variant
 * (selector 0x3593564c) matches every deployed HookSwap UR + the canonical Sepolia v4 UR.
 */
const UR_EXECUTE_IFACE = new ethers.utils.Interface([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline)',
])

/**
 * Chains whose v4 Universal Router is a NON-standard `minHopPriceX36` fork whose `V4_SWAP`
 * (0x10) action decoding has NOT been verified on-chain yet. We DO NOT emit v4 swap calldata
 * for these — quote-only until a testnet swap proves the deployed fork's V4_SWAP layout.
 * `patchMinHopPriceCalldata` only patches v2/v3 commands (0x00/0x01/0x08/0x09), NOT 0x10, so it
 * cannot make RH v4 calldata correct either. Robinhood (4663): v4 UR 0x8876…C0904 is such a fork.
 * (Sepolia/Ink/MegaETH/XLayer/Tempo v4 URs are standard → calldata is emitted.)
 */
const V4_SWAP_CALLDATA_UNVERIFIED_CHAINS = new Set<number>([4663])

/**
 * Canonical v4 periphery `IV4Quoter` single-hop interface (state-modifying → call via callStatic).
 * Takes ONE `QuoteExactSingleParams` struct: `{ PoolKey poolKey; bool zeroForOne; uint128 exactAmount;
 * bytes hookData; }` where `PoolKey = (address currency0, address currency1, uint24 fee,
 * int24 tickSpacing, address hooks)`. Returns `(uint256 amount, uint256 gasEstimate)` — `amount` is
 * the OUTPUT for quoteExactInputSingle and the required INPUT for quoteExactOutputSingle.
 */
const V4_QUOTER_ABI = [
  'function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amount, uint256 gasEstimate)',
  'function quoteExactOutputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amount, uint256 gasEstimate)',
]

/** Standard hookless fee tiers enumerated when no v4 pool is explicitly configured for a pair. */
const V4_STD_FEE_TIERS: Array<{ fee: number; tickSpacing: number }> = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
]

interface V4PoolKey {
  currency0: string
  currency1: string
  fee: number
  tickSpacing: number
  hooks: string
}

/**
 * Pick the better of two classic-quote responses. For EXACT_INPUT the larger `quote` (output amount)
 * wins; for EXACT_OUTPUT the smaller `quote` (required input) wins. Returns whichever exists when
 * only one is present, or undefined when neither is.
 */
function pickBetterQuote(
  a: RoutingApiQuoteResponse | undefined,
  b: RoutingApiQuoteResponse | undefined,
  tradeType: TradeType,
): RoutingApiQuoteResponse | undefined {
  if (!a) return b
  if (!b) return a
  const av = ethers.BigNumber.from(a.quote)
  const bv = ethers.BigNumber.from(b.quote)
  if (tradeType === TradeType.EXACT_INPUT) return av.gte(bv) ? a : b
  return av.lte(bv) ? a : b
}

interface ChainContext {
  router: AlphaRouter
  provider: ethers.providers.JsonRpcProvider
}

export class EmbedRoutingProvider implements RoutingProvider {
  readonly mode = 'embed' as const

  private readonly chainContexts = new Map<number, ChainContext>()
  /** chainId → tokenAddress(lowercase) → decimals. On-chain reads are cached for the process. */
  private readonly decimalsCache = new Map<number, Map<string, number>>()

  private getChainContext(chain: ChainConfig): ChainContext {
    let ctx = this.chainContexts.get(chain.chainId)
    if (!ctx) {
      const provider = new ethers.providers.JsonRpcProvider(resolveRpcUrl(chain), chain.chainId)
      const multicall2Provider = new UniswapMulticallProvider(chain.chainId, provider)
      // HookSwap chains have no hosted subgraph — use static (on-chain-derived) pool
      // discovery so the router finds our deployed v2/v3 pools via the factory + bases.
      const v3PoolProvider = new V3PoolProvider(chain.chainId, multicall2Provider)
      const router = new AlphaRouter({
        chainId: chain.chainId,
        provider,
        multicall2Provider,
        v2SubgraphProvider: new StaticV2SubgraphProvider(chain.chainId),
        v3SubgraphProvider: new StaticV3SubgraphProvider(chain.chainId, v3PoolProvider),
      })
      ctx = { router, provider }
      this.chainContexts.set(chain.chainId, ctx)
    }
    return ctx
  }

  private async getDecimals(chain: ChainConfig, provider: ethers.providers.JsonRpcProvider, address: string): Promise<number> {
    const key = address.toLowerCase()
    let perChain = this.decimalsCache.get(chain.chainId)
    if (!perChain) {
      perChain = new Map()
      this.decimalsCache.set(chain.chainId, perChain)
    }
    const cached = perChain.get(key)
    if (cached !== undefined) {
      return cached
    }
    const erc20 = new ethers.Contract(address, ERC20_DECIMALS_ABI, provider)
    const decimals = Number(await erc20.decimals())
    perChain.set(key, decimals)
    return decimals
  }

  /** Build the SOR `Currency` for a token address on a chain (native → the chain's wrapped-native). */
  private async resolveCurrency(
    chain: ChainConfig,
    provider: ethers.providers.JsonRpcProvider,
    address: string,
  ): Promise<Currency> {
    // Route native through wrapped-native (v2/v3 pools hold WETH-equivalents). The Universal
    // Router unwraps on the way out; the interface handles native display.
    if (isNativeAddress(address)) {
      const wn = chain.wrappedNative
      return new Token(chain.chainId, wn.address, wn.decimals, wn.symbol, wn.name)
    }
    const decimals = await this.getDecimals(chain, provider, address)
    return new Token(chain.chainId, address, decimals)
  }

  async quoteExactRoute(params: QuoteExactRouteParams): Promise<RoutingApiQuoteResponse | undefined> {
    const { chain } = params
    const tradeType = params.tradeType === 'exactIn' ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT

    // Split the requested protocols: v2/v3 go to the in-process SOR (AlphaRouter); v4 uses the
    // direct on-chain single-hop V4Quoter path. Both run independently; we return the better quote.
    const v2v3Protocols = params.protocols.filter((p): p is 'v2' | 'v3' => p === 'v2' || p === 'v3')
    const wantsV4 = params.protocols.includes('v4') && Boolean(chain.v4Quoter)

    const [v2v3Result, v4Result] = await Promise.all([
      v2v3Protocols.length ? this.quoteV2V3(params, v2v3Protocols) : Promise.resolve(undefined),
      wantsV4 ? this.quoteV4Single(chain, params).catch(() => undefined) : Promise.resolve(undefined),
    ])

    return pickBetterQuote(v2v3Result, v4Result, tradeType)
  }

  /** v2/v3 routing via the in-process SOR (unchanged behavior, extracted from quoteExactRoute). */
  private async quoteV2V3(
    params: QuoteExactRouteParams,
    protocolNames: Array<'v2' | 'v3'>,
  ): Promise<RoutingApiQuoteResponse | undefined> {
    const { chain } = params
    const { router, provider } = this.getChainContext(chain)

    const [tokenIn, tokenOut] = await Promise.all([
      this.resolveCurrency(chain, provider, params.tokenInAddress),
      this.resolveCurrency(chain, provider, params.tokenOutAddress),
    ])

    const tradeType = params.tradeType === 'exactIn' ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT
    // For EXACT_INPUT the amount is denominated in tokenIn; for EXACT_OUTPUT in tokenOut.
    const amountCurrency = tradeType === TradeType.EXACT_INPUT ? tokenIn : tokenOut
    const quoteCurrency = tradeType === TradeType.EXACT_INPUT ? tokenOut : tokenIn
    const amount = CurrencyAmount.fromRawAmount(amountCurrency, params.amount)

    const protocols = protocolNames.map((p) => (p === 'v2' ? Protocol.V2 : Protocol.V3))

    // Only assemble swap calldata (Universal Router) when we know the recipient.
    let swapConfig: SwapOptions | undefined
    if (params.recipient) {
      swapConfig = {
        type: SwapType.UNIVERSAL_ROUTER,
        // UniversalRouterVersion.V2_0 ('2.0') — matches HookSwap's deployed UR
        // (supportedURVersions _2_0). Hardcoded to avoid importing universal-router-sdk
        // (whose dep chain fails to resolve from the interface node_modules at runtime).
        // Only read when assembling swap calldata; the quote path ignores it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        version: '2.0' as any,
        recipient: params.recipient,
        slippageTolerance: new Percent(Math.round((params.slippageTolerancePct ?? 0.5) * 100), 10_000),
        deadlineOrPreviousBlockhash: Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 1800),
        // LIVE HookSwap swap fee: skims HOOKSWAP_FEE_BIPS/10000 of the OUTPUT token to the treasury.
        // The SOR passes this to SwapRouter.swapCallParameters → an appended PAY_PORTION command
        // (0x06) in the UR calldata. PAY_PORTION's input layout (token, recipient, bips) differs from
        // the V2/V3 swap commands, so patchMinHopPriceCalldata leaves it untouched (see urCalldata.ts).
        fee: { fee: new Percent(HOOKSWAP_FEE_BIPS, 10_000), recipient: HOOKSWAP_FEE_RECIPIENT },
      }
    }

    let route: SwapRoute | null
    try {
      route = await router.route(amount, quoteCurrency, tradeType, swapConfig, { protocols })
    } catch {
      // SOR throws on some no-liquidity / provider errors — treat as "no route" (honest 404).
      return undefined
    }
    if (!route) {
      return undefined
    }

    // The fee is in the calldata only when swapConfig was built (recipient known) → gate the
    // displayed portion fields on the same condition so we never advertise an unapplied fee.
    return mapSwapRouteToResponse(route, tradeType, Boolean(swapConfig))
  }

  /**
   * Direct on-chain Uniswap v4 SINGLE-HOP quote via the canonical `IV4Quoter` (per-chain
   * `chain.v4Quoter`). Enumerates candidate PoolKeys — configured `chain.v4Pools` for the pair first,
   * else hookless standard fee tiers — and `callStatic`s each, keeping the best (highest output for
   * exactIn / lowest input for exactOut). Returns a classic quote response with a single `v4-pool`
   * route hop, or `undefined` when no candidate pool quotes (honest — never fabricates a price).
   *
   * When `params.recipient` is set (same gate as the v2/v3 path) AND the chain's v4 UR is standard,
   * assembles executable UR `V4_SWAP` calldata (`@uniswap/v4-sdk` `V4Planner`) into `methodParameters`.
   *
   * TODO(HookSwap fee, v4): the LIVE 0.2% output fee is NOT applied on this v4 path. Applying it
   * requires appending a v4 `Actions.TAKE_PORTION` to the V4Planner action list (v4's PAY_PORTION
   * analogue) and a corresponding `TAKE` remainder — NOT the v2/v3 UR-level PAY_PORTION command.
   * v4 is quote-only in practice today (near-zero v4 liquidity; RH v4 gated) so no fee is emitted
   * here and portionBips is deliberately left UNSET — display never claims a fee the v4 calldata
   * won't take. Wire TAKE_PORTION when a v4 swap is proven on-chain.
   * Robinhood's v4 UR is an unverified min-hop fork → gated to quote-only (see
   * `V4_SWAP_CALLDATA_UNVERIFIED_CHAINS`). If calldata assembly throws, we still return the quote
   * WITHOUT `methodParameters` — never a fabricated/guessed calldata.
   */
  private async quoteV4Single(
    chain: ChainConfig,
    params: QuoteExactRouteParams,
  ): Promise<RoutingApiQuoteResponse | undefined> {
    const tokenInAddr = params.tokenInAddress
    const tokenOutAddr = params.tokenOutAddress
    const tradeType = params.tradeType
    const amountRaw = params.amount
    if (!chain.v4Quoter) {
      return undefined
    }
    const { provider } = this.getChainContext(chain)
    const quoter = new ethers.Contract(chain.v4Quoter, V4_QUOTER_ABI, provider)

    // Candidate v4 currency addresses per side. Native → address(0). Wrapped-native → try BOTH the
    // wrapped token AND native (v4 pools commonly hold native rather than the wrapper).
    const inCandidates = this.v4CurrencyCandidates(chain, tokenInAddr)
    const outCandidates = this.v4CurrencyCandidates(chain, tokenOutAddr)

    // Decimals for the route metadata (native uses chain.nativeDecimals; no on-chain read for it).
    const [inDecimals, outDecimals] = await Promise.all([
      this.v4CurrencyDecimals(chain, provider, tokenInAddr),
      this.v4CurrencyDecimals(chain, provider, tokenOutAddr),
    ])

    const exactAmount = ethers.BigNumber.from(amountRaw)

    let best:
      | {
          amount: ethers.BigNumber
          gas?: ethers.BigNumber
          poolKey: V4PoolKey
          currencyIn: string
          currencyOut: string
          zeroForOne: boolean
        }
      | undefined

    for (const cin of inCandidates) {
      for (const cout of outCandidates) {
        if (cin.toLowerCase() === cout.toLowerCase()) {
          continue
        }
        // v4 currency0 < currency1 by address; native (address 0) always sorts first.
        const zeroForOne = cin.toLowerCase() < cout.toLowerCase()
        const currency0 = zeroForOne ? cin : cout
        const currency1 = zeroForOne ? cout : cin

        for (const poolKey of this.candidatePoolKeys(chain, currency0, currency1)) {
          const args = { poolKey, zeroForOne, exactAmount: exactAmount.toString(), hookData: '0x' }
          try {
            const res =
              tradeType === 'exactIn'
                ? await quoter.callStatic.quoteExactInputSingle(args)
                : await quoter.callStatic.quoteExactOutputSingle(args)
            const amount = ethers.BigNumber.from(res.amount ?? res[0])
            const gas = res.gasEstimate != null ? ethers.BigNumber.from(res.gasEstimate) : undefined
            if (amount.isZero()) {
              continue
            }
            const better = !best || (tradeType === 'exactIn' ? amount.gt(best.amount) : amount.lt(best.amount))
            if (better) {
              best = { amount, gas, poolKey, currencyIn: cin, currencyOut: cout, zeroForOne }
            }
          } catch {
            // Pool doesn't exist / reverts (no liquidity) → skip this candidate.
          }
        }
      }
    }

    if (!best) {
      return undefined
    }

    const poolRoute: RoutingApiPoolInRoute = {
      type: 'v4-pool',
      address: '', // v4 pools have no ERC20 pair address; identity is the PoolKey below.
      tokenIn: { chainId: chain.chainId, decimals: String(inDecimals), address: best.currencyIn },
      tokenOut: { chainId: chain.chainId, decimals: String(outDecimals), address: best.currencyOut },
      fee: String(best.poolKey.fee),
      tickSpacing: String(best.poolKey.tickSpacing),
      hooks: best.poolKey.hooks,
      amountIn: tradeType === 'exactIn' ? exactAmount.toString() : best.amount.toString(),
      amountOut: tradeType === 'exactIn' ? best.amount.toString() : exactAmount.toString(),
    }

    // `quote` is the computed side: output amount (exactIn) or required input amount (exactOut);
    // `quoteDecimals` is that side's currency decimals — matching the SOR mapping contract.
    const quoteDecimals = tradeType === 'exactIn' ? outDecimals : inDecimals

    // Assemble executable UR `V4_SWAP` calldata only when we know the recipient (same gate as the
    // v2/v3 path) and the chain has a v4-capable UR. RH's v4 UR is an unverified min-hop fork → gated.
    let methodParameters: { calldata: string; value: string; to: string } | undefined
    if (params.recipient && chain.universalRouterV4 && !V4_SWAP_CALLDATA_UNVERIFIED_CHAINS.has(chain.chainId)) {
      try {
        methodParameters = this.buildV4SwapCalldata(chain, best, tradeType, exactAmount, params)
      } catch {
        // Honest: assembly failed → return the quote WITHOUT calldata (never emit guessed calldata).
        methodParameters = undefined
      }
    }

    return {
      quoteId: undefined,
      quote: best.amount.toString(),
      quoteDecimals: String(quoteDecimals),
      quoteGasAdjusted: best.amount.toString(), // no gas-USD pool for v4 yet → unadjusted (honest).
      gasUseEstimate: best.gas?.toString(),
      gasUseEstimateUSD: undefined,
      gasPriceWei: undefined,
      blockNumber: undefined,
      route: [[poolRoute]],
      routeString: undefined,
      methodParameters,
    }
  }

  /**
   * Build Universal Router `V4_SWAP` calldata for a single-hop v4 route using `@uniswap/v4-sdk`
   * `V4Planner` (UR 2.0 action encoding). Action sequence:
   *   exactIn  → SWAP_EXACT_IN_SINGLE(poolKey, zeroForOne, amountIn,  amountOutMinimum, hookData='0x')
   *              + SETTLE_ALL(inputCurrency,  amountIn)
   *              + TAKE_ALL(outputCurrency, amountOutMinimum)
   *   exactOut → SWAP_EXACT_OUT_SINGLE(poolKey, zeroForOne, amountOut, amountInMaximum,  hookData='0x')
   *              + SETTLE_ALL(inputCurrency,  amountInMaximum)
   *              + TAKE_ALL(outputCurrency, amountOut)
   * finalize() → abi.encode(bytes actions, bytes[] params) = the single V4_SWAP input.
   * Wrapped in UR `execute(bytes commands=0x10, bytes[] inputs=[actions|params], uint256 deadline)`.
   * Native (address(0)) is used directly (v4 does not wrap). `value` = native input amount, else 0.
   */
  private buildV4SwapCalldata(
    chain: ChainConfig,
    best: { poolKey: V4PoolKey; currencyIn: string; currencyOut: string; zeroForOne: boolean; amount: ethers.BigNumber },
    tradeType: 'exactIn' | 'exactOut',
    exactAmount: ethers.BigNumber,
    params: QuoteExactRouteParams,
  ): { calldata: string; value: string; to: string } {
    // Slippage in basis points (default 0.5%). amountOutMinimum = out·(1-slip); amountInMaximum = in·(1+slip).
    const bps = Math.max(0, Math.min(10_000, Math.round((params.slippageTolerancePct ?? 0.5) * 100)))
    const amountIn = tradeType === 'exactIn' ? exactAmount : best.amount
    const amountOut = tradeType === 'exactIn' ? best.amount : exactAmount
    const amountOutMinimum = amountOut.mul(10_000 - bps).div(10_000)
    const amountInMaximum = amountIn.mul(10_000 + bps).div(10_000)

    const poolKeyStruct = {
      currency0: best.poolKey.currency0,
      currency1: best.poolKey.currency1,
      fee: best.poolKey.fee,
      tickSpacing: best.poolKey.tickSpacing,
      hooks: best.poolKey.hooks,
    }

    const planner = new V4Planner()
    if (tradeType === 'exactIn') {
      planner.addAction(
        Actions.SWAP_EXACT_IN_SINGLE,
        [
          {
            poolKey: poolKeyStruct,
            zeroForOne: best.zeroForOne,
            amountIn: amountIn.toString(),
            amountOutMinimum: amountOutMinimum.toString(),
            hookData: '0x',
          },
        ],
        URVersion.V2_0,
      )
      planner.addAction(Actions.SETTLE_ALL, [best.currencyIn, amountIn.toString()])
      planner.addAction(Actions.TAKE_ALL, [best.currencyOut, amountOutMinimum.toString()])
    } else {
      planner.addAction(
        Actions.SWAP_EXACT_OUT_SINGLE,
        [
          {
            poolKey: poolKeyStruct,
            zeroForOne: best.zeroForOne,
            amountOut: amountOut.toString(),
            amountInMaximum: amountInMaximum.toString(),
            hookData: '0x',
          },
        ],
        URVersion.V2_0,
      )
      planner.addAction(Actions.SETTLE_ALL, [best.currencyIn, amountInMaximum.toString()])
      planner.addAction(Actions.TAKE_ALL, [best.currencyOut, amountOut.toString()])
    }

    const v4Input = planner.finalize() // abi.encode(bytes actions, bytes[] params)
    const commands = ethers.utils.hexlify([UR_COMMAND_V4_SWAP])
    const deadline = ethers.BigNumber.from(Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 1800))
    const calldata = UR_EXECUTE_IFACE.encodeFunctionData('execute', [commands, [v4Input], deadline])

    // `value` = native (address(0)) input the UR must be sent. For exactOut the max is amountInMaximum;
    // NOTE: a native-input exactOut leaves any unspent ETH in the router (no SWEEP refund appended) —
    // acceptable for the validated exactIn path; exactOut native refund is a follow-up.
    const inputIsNative = isNativeAddress(best.currencyIn)
    const value = inputIsNative ? (tradeType === 'exactIn' ? amountIn : amountInMaximum).toString() : '0'

    // Standard v4 URs: patch is a safe no-op for V4_SWAP (0x10); mirrors the v2/v3 calldata path.
    const patched = patchMinHopPriceCalldata(calldata)

    return { calldata: patched, value, to: chain.universalRouterV4 as string }
  }

  /** v4 currency candidates for a token side (native → [0]; wrapped-native → [wrapped, 0]; else [token]). */
  private v4CurrencyCandidates(chain: ChainConfig, address: string): string[] {
    if (isNativeAddress(address)) {
      return [V4_ADDRESS_ZERO]
    }
    if (address.toLowerCase() === chain.wrappedNative.address.toLowerCase()) {
      return [ethers.utils.getAddress(chain.wrappedNative.address), V4_ADDRESS_ZERO]
    }
    return [ethers.utils.getAddress(address)]
  }

  /** Decimals for a v4 currency (native → chain.nativeDecimals; wrapped-native → its decimals; else on-chain). */
  private async v4CurrencyDecimals(
    chain: ChainConfig,
    provider: ethers.providers.JsonRpcProvider,
    address: string,
  ): Promise<number> {
    if (isNativeAddress(address)) {
      return chain.nativeDecimals
    }
    if (address.toLowerCase() === chain.wrappedNative.address.toLowerCase()) {
      return chain.wrappedNative.decimals
    }
    return this.getDecimals(chain, provider, address)
  }

  /**
   * Candidate PoolKeys for a sorted (currency0, currency1) pair: configured `chain.v4Pools` matching
   * the pair (order-insensitive) if any — these carry real hook addresses (e.g. HOOK on Robinhood) —
   * else the hookless standard fee tiers. Never invents a hooked pool key.
   */
  private candidatePoolKeys(chain: ChainConfig, currency0: string, currency1: string): V4PoolKey[] {
    const configured = (chain.v4Pools ?? []).filter((p) => {
      const a = p.currency0.toLowerCase()
      const b = p.currency1.toLowerCase()
      const c0 = currency0.toLowerCase()
      const c1 = currency1.toLowerCase()
      return (a === c0 && b === c1) || (a === c1 && b === c0)
    })
    if (configured.length) {
      return configured.map((p) => ({ currency0, currency1, fee: p.fee, tickSpacing: p.tickSpacing, hooks: p.hooks }))
    }
    return V4_STD_FEE_TIERS.map((t) => ({ currency0, currency1, fee: t.fee, tickSpacing: t.tickSpacing, hooks: V4_ADDRESS_ZERO }))
  }
}

/**
 * Map an SOR `SwapRoute` into the classic routing-api response `translate.ts` already consumes.
 * When `feeApplied` is true (swapConfig carried the HookSwap `fee`), the OUTPUT-token PAY_PORTION
 * fee is surfaced as portionBips/portionAmount/portionRecipient. portionAmount is computed from the
 * GROSS output (`route.trade.outputAmount`, always the output side for BOTH trade types) as
 * output·bips/10000 (floor) — the same base the on-chain PAY_PORTION skims.
 */
function mapSwapRouteToResponse(route: SwapRoute, tradeType: TradeType, feeApplied: boolean): RoutingApiQuoteResponse {
  const routes: RoutingApiPoolInRoute[][] = route.route.map((r) => {
    // Each `r` is a RouteWithValidQuote whose `.route.pools` (v3) or `.route.pairs` (v2) are the hops.
    const pools = (r.route as { pools?: unknown[]; pairs?: unknown[] }).pools ?? (r.route as { pairs?: unknown[] }).pairs ?? []
    return pools.map((pool) => poolToRoutePool(pool as Record<string, unknown>))
  })

  const quote = route.quote.quotient.toString()
  const quoteGasAdjusted = route.quoteGasAdjusted.quotient.toString()

  // Output-token fee: only when it's actually in the calldata. `route.trade.outputAmount` is the
  // output currency amount regardless of exactIn/exactOut, matching what PAY_PORTION skims on-chain.
  let portionBips: number | undefined
  let portionAmount: string | undefined
  let portionRecipient: string | undefined
  if (feeApplied && route.methodParameters) {
    const grossOutput = ethers.BigNumber.from(route.trade.outputAmount.quotient.toString())
    portionBips = HOOKSWAP_FEE_BIPS
    portionAmount = grossOutput.mul(HOOKSWAP_FEE_BIPS).div(10_000).toString()
    portionRecipient = HOOKSWAP_FEE_RECIPIENT
  }

  return {
    quoteId: undefined,
    quote,
    quoteDecimals: route.quote.currency.decimals.toString(),
    quoteGasAdjusted,
    gasUseEstimate: route.estimatedGasUsed.toString(),
    gasUseEstimateUSD: route.estimatedGasUsedUSD?.toExact?.(),
    gasPriceWei: route.gasPriceWei?.toString(),
    blockNumber: route.blockNumber?.toString(),
    route: routes,
    routeString: undefined,
    methodParameters: route.methodParameters
      ? {
          // The SDK emits canonical 5-field UR swap inputs; the deployed HookSwap UR fork decodes
          // 6 (trailing minHopPriceX36[]). Re-encode to match, else every swap reverts at decode.
          // The appended PAY_PORTION command (from the `fee` option) is NOT a swap command, so the
          // shim passes it through byte-for-byte (guarded in urCalldata.ts).
          calldata: patchMinHopPriceCalldata(route.methodParameters.calldata),
          value: route.methodParameters.value,
          to: route.methodParameters.to,
        }
      : undefined,
    portionBips,
    portionAmount,
    portionRecipient,
  }
  // tradeType retained for callers/telemetry; response shape is symmetric for exactIn/exactOut.
  void tradeType
}

/** Map a single v2 Pair or v3 Pool into the classic `RoutingApiPoolInRoute` shape. */
function poolToRoutePool(pool: Record<string, unknown>): RoutingApiPoolInRoute {
  // v3 Pool has `fee` + `sqrtRatioX96` + `liquidity` + `tickCurrent`; v2 Pair has `reserve0/1`.
  const token0 = pool.token0 as { chainId: number; decimals: number; address: string; symbol?: string }
  const token1 = pool.token1 as { chainId: number; decimals: number; address: string; symbol?: string }
  const isV3 = pool.fee !== undefined || pool.sqrtRatioX96 !== undefined

  const base: RoutingApiPoolInRoute = {
    type: isV3 ? 'v3-pool' : 'v2-pool',
    address: (pool.address as string) ?? '',
    tokenIn: { chainId: token0.chainId, decimals: String(token0.decimals), address: token0.address, symbol: token0.symbol },
    tokenOut: { chainId: token1.chainId, decimals: String(token1.decimals), address: token1.address, symbol: token1.symbol },
  }

  if (isV3) {
    base.fee = pool.fee !== undefined ? String(pool.fee) : undefined
    base.sqrtRatioX96 = (pool.sqrtRatioX96 as { toString(): string } | undefined)?.toString()
    base.liquidity = (pool.liquidity as { toString(): string } | undefined)?.toString()
    base.tickCurrent = pool.tickCurrent !== undefined ? String(pool.tickCurrent) : undefined
  } else {
    const r0 = pool.reserve0 as { quotient?: { toString(): string } } | undefined
    const r1 = pool.reserve1 as { quotient?: { toString(): string } } | undefined
    if (r0?.quotient) {
      base.reserve0 = { token: { address: token0.address }, quotient: r0.quotient.toString() }
    }
    if (r1?.quotient) {
      base.reserve1 = { token: { address: token1.address }, quotient: r1.quotient.toString() }
    }
  }

  return base
}
