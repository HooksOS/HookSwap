/**
 * HookSwapPerps — place order (chain reads + EIP-712 sign + POST /orders).
 *
 * The P2P order flow: read the trader's on-chain state (deposited collateral, nonce, the
 * market's leverage cap + collateral decimals), build the exact `Order` struct, sign it with
 * the market's EIP-712 domain, and POST {order, signature} to the matching engine. No Permit2,
 * no approval — collateral must already be deposited (guarded below).
 *
 * EIP-712 (must match PerpMarket.sol:87-89 + constructor:286 byte-for-byte):
 *   domain = { name:"HookSwapPerps", version:"1", chainId, verifyingContract: MARKET ADDRESS }
 *   Order(address trader,address token,bool isLong,uint256 size,uint256 leverage,
 *         uint256 price,uint256 deadline,uint256 nonce,uint8 orderType)
 *   price 1e18 · leverage *1e4 · orderType 0=MARKET (price 0) / 1=LIMIT · nonce = nonces(trader).
 *
 * Honest states: no market/engine → cannot submit; balance 0 → "deposit collateral" guard;
 * engine POST failure → surfaced error. Never fabricates an orderId/txHash.
 */
import { useCallback, useMemo, useState } from 'react'
import { formatUnits, parseUnits, type Hex } from 'viem'
import { useReadContract, useSignTypedData } from 'wagmi'
import type { Address } from '~/chains'
import { cancelTypedData, EngineError, perpsEngine, type PlaceOrderResult } from '~/terminal/perps/engine/client'
import type { PerpMarketView } from '~/terminal/perps/engine/marketView'
import { LEVERAGE_PRECISION, OrderType, perpMarketReadAbi, PRICE_PRECISION, SIZE_PRECISION } from '~/terminal/perps/engine/perpMarketAbi'

/** Absolute platform leverage fallback when the market's on-chain cap is unset (0). */
const DEFAULT_MAX_LEVERAGE_X = 20

/** Order validity window (seconds) — mirrors a sane market-order deadline. */
const DEADLINE_SECONDS = 300

const ORDER_TYPES = {
  Order: [
    { name: 'trader', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'isLong', type: 'bool' },
    { name: 'size', type: 'uint256' },
    { name: 'leverage', type: 'uint256' },
    { name: 'price', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'orderType', type: 'uint8' },
  ],
} as const

export type PlaceOrderStatus = 'idle' | 'signing' | 'submitting' | 'submitted' | 'error'

export interface PlaceOrderInput {
  side: 'long' | 'short'
  orderType: 'Market' | 'Limit'
  /** Base-asset size as a decimal string, e.g. "0.5". */
  sizeStr: string
  /** Whole-x leverage. */
  leverage: number
  /** Limit price as a decimal string (ignored for Market). */
  limitPriceStr?: string
}

export interface UsePlaceOrder {
  /** Deposited collateral available to trade (raw), or undefined while loading. */
  availableRaw?: bigint
  /** Human available balance, e.g. "12.50". */
  availableFormatted?: string
  /** False when the trader has 0 deposited collateral → deposit guard. */
  hasCollateral: boolean
  /** Collateral token decimals (default 18 until read). */
  decimals: number
  /** Effective max leverage (on-chain cap, else catalog, else platform default). */
  maxLeverageX: number
  /** EIP-712 order nonce (nonces(trader)). */
  nonce?: bigint

  /** True when this input would produce a valid, submittable order. */
  canSubmit: boolean
  /** Human reason the order can't be submitted (guard text), when canSubmit is false. */
  disabledReason?: string

  status: PlaceOrderStatus
  result?: PlaceOrderResult
  error?: string
  submit: (input: PlaceOrderInput) => Promise<void>
  cancel: (orderId: string) => Promise<void>
  reset: () => void
}

function toMessage(e: unknown): string {
  if (e instanceof EngineError) {
    return e.unreachable ? 'Matching engine unreachable' : e.message
  }
  if (e && typeof e === 'object' && 'shortMessage' in e && typeof (e as { shortMessage: unknown }).shortMessage === 'string') {
    return (e as { shortMessage: string }).shortMessage
  }
  if (e instanceof Error) {
    return e.message.split('\n')[0]
  }
  return 'Order failed'
}

export function usePlaceOrder({
  market,
  trader,
  chainId,
}: {
  market?: PerpMarketView
  trader?: Address
  chainId?: number
}): UsePlaceOrder {
  const marketAddress = market?.address
  const collateral = market?.collateral
  const enabled = Boolean(marketAddress && trader)

  const nonceRead = useReadContract({
    address: marketAddress,
    chainId,
    abi: perpMarketReadAbi,
    functionName: 'nonces',
    args: trader ? [trader] : undefined,
    query: { enabled },
  })
  const nonce = nonceRead.data as bigint | undefined

  const balanceRead = useReadContract({
    address: marketAddress,
    chainId,
    abi: perpMarketReadAbi,
    functionName: 'getUserBalance',
    args: trader ? [trader] : undefined,
    query: { enabled, refetchInterval: 15_000 },
  })
  const availableRaw = balanceRead.data ? (balanceRead.data as readonly [bigint, bigint])[0] : undefined

  const decimalsRead = useReadContract({
    address: marketAddress,
    chainId,
    abi: perpMarketReadAbi,
    functionName: 'getTokenDecimals',
    args: collateral ? [collateral] : undefined,
    query: { enabled: Boolean(marketAddress && collateral) },
  })
  const decimals = decimalsRead.data !== undefined ? Number(decimalsRead.data as number) : 18

  const capRead = useReadContract({
    address: marketAddress,
    chainId,
    abi: perpMarketReadAbi,
    functionName: 'marketMaxLeverage',
    query: { enabled: Boolean(marketAddress) },
  })
  const capRaw = capRead.data as bigint | undefined
  const maxLeverageX = useMemo(() => {
    if (capRaw !== undefined && capRaw > 0n) {
      return Math.max(1, Number(capRaw / BigInt(LEVERAGE_PRECISION)))
    }
    return market?.catalogMaxLeverage ?? DEFAULT_MAX_LEVERAGE_X
  }, [capRaw, market?.catalogMaxLeverage])

  const availableFormatted = availableRaw !== undefined ? Number(formatUnits(availableRaw, decimals)).toLocaleString('en-US', { maximumFractionDigits: 4 }) : undefined
  const hasCollateral = availableRaw !== undefined && availableRaw > 0n

  const { signTypedDataAsync } = useSignTypedData()

  const [status, setStatus] = useState<PlaceOrderStatus>('idle')
  const [result, setResult] = useState<PlaceOrderResult | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const reset = useCallback(() => {
    setStatus('idle')
    setResult(undefined)
    setError(undefined)
  }, [])

  const submit = useCallback(
    async (input: PlaceOrderInput): Promise<void> => {
      if (!marketAddress || !trader || !collateral || nonce === undefined) {
        setError('Not ready')
        setStatus('error')
        return
      }
      // Validate + build raw args.
      let size: bigint
      try {
        size = parseUnits(input.sizeStr || '0', SIZE_PRECISION)
      } catch {
        setError('Invalid size')
        setStatus('error')
        return
      }
      if (size <= 0n) {
        setError('Enter a size')
        setStatus('error')
        return
      }
      let price = 0n
      if (input.orderType === 'Limit') {
        try {
          price = parseUnits(input.limitPriceStr || '0', PRICE_PRECISION)
        } catch {
          setError('Invalid limit price')
          setStatus('error')
          return
        }
        if (price <= 0n) {
          setError('Enter a limit price')
          setStatus('error')
          return
        }
      }
      const levX = Math.round(input.leverage)
      if (!Number.isFinite(levX) || levX < 1 || levX > maxLeverageX) {
        setError(`Leverage must be 1–${maxLeverageX}×`)
        setStatus('error')
        return
      }
      if (!hasCollateral) {
        setError('Deposit collateral to trade')
        setStatus('error')
        return
      }

      const leverage = BigInt(levX) * BigInt(LEVERAGE_PRECISION)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)
      const orderTypeEnum = input.orderType === 'Limit' ? OrderType.Limit : OrderType.Market
      const isLong = input.side === 'long'

      const message = {
        trader,
        token: collateral,
        isLong,
        size,
        leverage,
        price,
        deadline,
        nonce,
        orderType: orderTypeEnum,
      }

      setError(undefined)
      setResult(undefined)
      setStatus('signing')
      let signature: Hex
      try {
        signature = await signTypedDataAsync({
          domain: {
            name: 'HookSwapPerps',
            version: '1',
            chainId: chainId ?? 0,
            verifyingContract: marketAddress,
          },
          types: ORDER_TYPES,
          primaryType: 'Order',
          message,
        })
      } catch (e) {
        setError(toMessage(e))
        setStatus('error')
        return
      }

      setStatus('submitting')
      try {
        const res = await perpsEngine.placeOrder({
          market: marketAddress,
          order: {
            trader,
            token: collateral,
            isLong,
            size: size.toString(),
            leverage: leverage.toString(),
            price: price.toString(),
            deadline: deadline.toString(),
            nonce: nonce.toString(),
            orderType: orderTypeEnum,
          },
          signature,
        })
        setResult(res)
        setStatus('submitted')
        void nonceRead.refetch()
        void balanceRead.refetch()
      } catch (e) {
        setError(toMessage(e))
        setStatus('error')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [marketAddress, trader, collateral, nonce, maxLeverageX, hasCollateral, chainId, signTypedDataAsync],
  )

  const cancel = useCallback(
    async (orderId: string): Promise<void> => {
      if (!marketAddress || !trader) {
        setError('Not ready')
        return
      }
      try {
        // Authenticated cancel: sign the EIP-712 Cancel proving wallet ownership.
        const signature = await signTypedDataAsync(
          cancelTypedData({ market: marketAddress, orderId, trader, chainId: chainId ?? 0 }),
        )
        await perpsEngine.cancelOrder(orderId, signature)
      } catch (e) {
        setError(toMessage(e))
      }
    },
    [marketAddress, trader, chainId, signTypedDataAsync],
  )

  const busy = status === 'signing' || status === 'submitting'
  const disabledReason = !enabled
    ? 'Select a market'
    : nonce === undefined
      ? 'Loading account…'
      : !hasCollateral
        ? 'Deposit collateral to trade'
        : busy
          ? 'Submitting…'
          : undefined

  return {
    availableRaw,
    availableFormatted,
    hasCollateral,
    decimals,
    maxLeverageX,
    nonce,
    canSubmit: enabled && nonce !== undefined && hasCollateral && !busy,
    disabledReason,
    status,
    result,
    error,
    submit,
    cancel,
    reset,
  }
}
