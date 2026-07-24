/**
 * HookSwap Terminal — client-side Uniswap-v3 CREATE-position (mint) flow.
 *
 * MIRRORS the existing v2 `useCreateV2Pool` philosophy: a self-contained CLIENT-SIDE
 * hook that talks straight to chain via wagmi — NO hosted liquidity service (the stock
 * `useCreatePositionQuery` REST backend does not serve HookSwap's custom chains).
 *
 * REUSES the stock v3 MATH (never re-implements AMM math):
 *   • `@uniswap/v3-sdk` `Pool` / `Position` / `nearestUsableTick` / `TickMath` /
 *     `tickToPrice` — tick↔price, single-sided detection, auto-balanced deposit.
 *   • The interface's own `tryParsePrice` / `tryParseTick` (state/mint/v3/utils) for the
 *     initial-price → sqrt/tick and custom min/max-price → usable-tick conversions.
 *   • `NonfungiblePositionManager.addCallParameters(position, { createPool, … })` to
 *     build the `createAndInitializePoolIfNecessary` + `mint` (multicall) calldata
 *     locally — the exact stock encoder, sent as a raw tx to the own NPM.
 *
 * Approvals are plain ERC-20 `approve` to the NPM (NOT Permit2) — the stock NPM `mint`
 * pulls via `transferFrom`, so this is the correct + simplest path (same as the v2
 * router approval model). A native side is paid as `msg.value` (SDK `useNative`) and
 * needs no approval.
 *
 * ORIENTATION: all price/range inputs are in **token1-per-token0** terms (sorted SDK
 * order). The screen owns display inversion and passes already-oriented values here.
 */
import { CurrencyAmount, Percent, type Currency, type NativeCurrency, type Token } from '@uniswap/sdk-core'
import { FeeAmount, nearestUsableTick, NonfungiblePositionManager, Pool, Position, TICK_SPACINGS, TickMath, tickToPrice } from '@uniswap/v3-sdk'
import { useEffect, useMemo, useState } from 'react'
import { useReadContract, useReadContracts, useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, parseUnits, type Address, type Hash } from '~/chains'
import { useGetTransactionDeadline } from '~/hooks/useTransactionDeadline'
import { tryParsePrice, tryParseTick } from '~/state/mint/v3/utils'
import { assume0xAddress } from '~/utils/wagmi'
import { v3PoolAbi } from '~/terminal/liquidity/abis'
import { getV3Addresses } from '~/terminal/liquidity/v3Addresses'

export type V3DepositField = 'TOKEN0' | 'TOKEN1'

export interface V3RangeInput {
  /** Full-range position (min tick … max tick). */
  fullRange: boolean
  /** Lower bound price (token1 per token0) — ignored when fullRange. */
  minPrice?: string
  /** Upper bound price (token1 per token0) — ignored when fullRange. */
  maxPrice?: string
}

export interface UseCreateV3Position {
  /** Chain has a v3 stack (factory + NPM) wired. */
  ready: boolean
  /** Deterministic pool address for the selected (pair, fee). */
  poolAddress?: Address
  /** Pool is initialized on-chain (slot0.sqrtPrice > 0). When false, the user sets the price. */
  poolExists: boolean
  poolLoading: boolean

  /** Sorted SDK tokens (token0 < token1 by address). */
  token0?: Token
  token1?: Token
  /** Current pool price (token1 per token0), or the user's initial price when creating. */
  currentPrice?: string

  /** Selected ticks after clamping to usable spacing. */
  tickLower?: number
  tickUpper?: number
  /** Selected range as prices (token1 per token0). At-limit bounds render as 0 / ∞. */
  priceLower?: string
  priceUpper?: string
  atLimitLower: boolean
  atLimitUpper: boolean

  /** Which token amounts the range demands (out-of-range ⇒ a single side). */
  deposit0Disabled: boolean
  deposit1Disabled: boolean
  /** The dependent amount (formatted) derived from the independent input. */
  dependentAmount?: string
  dependentField?: V3DepositField

  /** Raw desired amounts fed to the mint (bigint), when inputs are valid. */
  amount0Raw?: bigint
  amount1Raw?: bigint

  // Allowance gates (per ERC-20 side — a native side has no gate).
  needsToken0Approval: boolean
  needsToken1Approval: boolean
  token0Approving: boolean
  token1Approving: boolean
  approveToken0: () => Promise<void>
  approveToken1: () => Promise<void>

  // Mint.
  inputsValid: boolean
  canMint: boolean
  mint: () => Promise<void>
  isWritePending: boolean
  mintHash?: Hash
  isConfirming: boolean
  isDone: boolean
  error?: string
  reset: () => void
}

/** parseUnits guarded against empty/invalid; returns undefined instead of throwing. */
function tryRaw(amount?: string, decimals?: number): bigint | undefined {
  if (!amount || decimals === undefined) {
    return undefined
  }
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) {
    return undefined
  }
  try {
    const raw = parseUnits(amount, decimals)
    return raw > 0n ? raw : undefined
  } catch {
    return undefined
  }
}

export function useCreateV3Position({
  chainId,
  owner,
  currencyA,
  currencyB,
  feeAmount,
  range,
  initialPrice,
  independentField,
  typedValue,
  slippageBips = 50,
}: {
  chainId?: number
  owner?: Address
  /** First selected currency (may be native). */
  currencyA?: Currency
  /** Second selected currency (may be native). */
  currencyB?: Currency
  feeAmount: FeeAmount
  range: V3RangeInput
  /** Starting price (token1 per token0) — only used when the pool does not exist yet. */
  initialPrice?: string
  independentField: V3DepositField
  typedValue: string
  slippageBips?: number
}): UseCreateV3Position {
  const v3 = getV3Addresses(chainId)
  const ready = Boolean(v3)

  /* ------------------------------------------------------ sort tokens (SDK order) */

  const tokenA = currencyA?.wrapped
  const tokenB = currencyB?.wrapped
  const sorted = useMemo(() => {
    if (!tokenA || !tokenB || tokenA.equals(tokenB)) {
      return undefined
    }
    const [token0, token1] = tokenA.sortsBefore(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA]
    // Map each sorted token back to the display currency (to detect native side).
    const currency0 = token0.equals(tokenA) ? currencyA : currencyB
    const currency1 = token1.equals(tokenA) ? currencyA : currencyB
    return { token0, token1, currency0, currency1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenA?.address, tokenB?.address, chainId])

  const token0 = sorted?.token0
  const token1 = sorted?.token1

  /* ------------------------------------------------------ on-chain pool state */

  const poolAddress = useMemo(() => {
    if (!v3 || !token0 || !token1) {
      return undefined
    }
    try {
      return assume0xAddress(Pool.getAddress(token0, token1, feeAmount, undefined, v3.v3Factory))
    } catch {
      return undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v3?.v3Factory, token0?.address, token1?.address, feeAmount])

  const poolReads = useReadContracts({
    allowFailure: true,
    contracts: poolAddress
      ? [
          { address: poolAddress, chainId, abi: v3PoolAbi, functionName: 'slot0' },
          { address: poolAddress, chainId, abi: v3PoolAbi, functionName: 'liquidity' },
        ]
      : [],
    query: { enabled: Boolean(poolAddress) },
  })
  const slot0 = poolReads.data?.[0]?.status === 'success' ? (poolReads.data[0].result as readonly [bigint, number, ...unknown[]]) : undefined
  const onchainLiquidity = poolReads.data?.[1]?.status === 'success' ? (poolReads.data[1].result as bigint) : undefined
  const sqrtPriceX96 = slot0?.[0]
  const currentTick = slot0?.[1]
  const poolExists = Boolean(sqrtPriceX96 && sqrtPriceX96 > 0n)
  const poolLoading = Boolean(poolAddress) && poolReads.isLoading

  /* ------------------------------------------------------ build SDK Pool */

  const pool = useMemo(() => {
    if (!token0 || !token1) {
      return undefined
    }
    // Existing pool → from on-chain slot0 + liquidity.
    if (poolExists && sqrtPriceX96 && currentTick !== undefined) {
      try {
        return new Pool(token0, token1, feeAmount, sqrtPriceX96.toString(), (onchainLiquidity ?? 0n).toString(), currentTick)
      } catch {
        return undefined
      }
    }
    // New pool → mock from the user's initial price (token1 per token0). Mirrors the
    // stock `createMockV3Pool`: initial-price → nearest tick → sqrtRatio, zero liquidity.
    const price = tryParsePrice({ baseToken: token0, quoteToken: token1, value: initialPrice })
    if (!price) {
      return undefined
    }
    const tickForPrice = tryParseTick({ baseToken: token0, quoteToken: token1, feeAmount, value: initialPrice })
    if (tickForPrice === undefined) {
      return undefined
    }
    try {
      const initialSqrt = TickMath.getSqrtRatioAtTick(tickForPrice)
      return new Pool(token0, token1, feeAmount, initialSqrt.toString(), '0', tickForPrice)
    } catch {
      return undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token0?.address, token1?.address, feeAmount, poolExists, sqrtPriceX96?.toString(), currentTick, onchainLiquidity?.toString(), initialPrice])

  const currentPrice = useMemo(() => {
    if (poolExists && currentTick !== undefined && token0 && token1) {
      try {
        return tickToPrice(token0, token1, currentTick).toSignificant(6)
      } catch {
        return undefined
      }
    }
    return initialPrice || undefined
  }, [poolExists, currentTick, token0, token1, initialPrice])

  /* ------------------------------------------------------ ticks */

  const spacing = TICK_SPACINGS[feeAmount]
  const { tickLower, tickUpper } = useMemo(() => {
    if (range.fullRange) {
      return {
        tickLower: nearestUsableTick(TickMath.MIN_TICK, spacing),
        tickUpper: nearestUsableTick(TickMath.MAX_TICK, spacing),
      }
    }
    let lower = tryParseTick({ baseToken: token0, quoteToken: token1, feeAmount, value: range.minPrice })
    let upper = tryParseTick({ baseToken: token0, quoteToken: token1, feeAmount, value: range.maxPrice })
    if (lower !== undefined && upper !== undefined && lower > upper) {
      ;[lower, upper] = [upper, lower]
    }
    return { tickLower: lower, tickUpper: upper }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.fullRange, range.minPrice, range.maxPrice, token0?.address, token1?.address, feeAmount, spacing])

  const minUsable = nearestUsableTick(TickMath.MIN_TICK, spacing)
  const maxUsable = nearestUsableTick(TickMath.MAX_TICK, spacing)
  const atLimitLower = tickLower !== undefined && tickLower <= minUsable
  const atLimitUpper = tickUpper !== undefined && tickUpper >= maxUsable

  const priceLower = useMemo(() => {
    if (tickLower === undefined || !token0 || !token1 || atLimitLower) {
      return undefined
    }
    try {
      return tickToPrice(token0, token1, tickLower).toSignificant(6)
    } catch {
      return undefined
    }
  }, [tickLower, token0, token1, atLimitLower])
  const priceUpper = useMemo(() => {
    if (tickUpper === undefined || !token0 || !token1 || atLimitUpper) {
      return undefined
    }
    try {
      return tickToPrice(token0, token1, tickUpper).toSignificant(6)
    } catch {
      return undefined
    }
  }, [tickUpper, token0, token1, atLimitUpper])

  // Out-of-range single-sided detection (mirrors stock getFieldsDisabled).
  const poolTick = pool?.tickCurrent
  const deposit0Disabled = Boolean(tickUpper !== undefined && poolTick !== undefined && poolTick >= tickUpper)
  const deposit1Disabled = Boolean(tickLower !== undefined && poolTick !== undefined && poolTick <= tickLower)

  /* ------------------------------------------------------ derive dependent amount + final position */

  const independentToken = independentField === 'TOKEN0' ? token0 : token1
  const independentRaw = tryRaw(typedValue, independentToken?.decimals)

  const derived = useMemo(() => {
    if (!pool || !token0 || !token1 || tickLower === undefined || tickUpper === undefined || independentRaw === undefined) {
      return undefined
    }
    try {
      let position: Position
      if (independentField === 'TOKEN0') {
        position = Position.fromAmount0({ pool, tickLower, tickUpper, amount0: independentRaw.toString(), useFullPrecision: true })
      } else {
        position = Position.fromAmount1({ pool, tickLower, tickUpper, amount1: independentRaw.toString() })
      }
      const amount0Raw = BigInt(position.mintAmounts.amount0.toString())
      const amount1Raw = BigInt(position.mintAmounts.amount1.toString())
      // The dependent side (the one the user did NOT type).
      const dependentField: V3DepositField = independentField === 'TOKEN0' ? 'TOKEN1' : 'TOKEN0'
      const dependentToken = dependentField === 'TOKEN0' ? token0 : token1
      const dependentRaw = dependentField === 'TOKEN0' ? amount0Raw : amount1Raw
      const dependentAmount = CurrencyAmount.fromRawAmount(dependentToken, dependentRaw.toString()).toSignificant(8)
      return { position, amount0Raw, amount1Raw, dependentField, dependentAmount }
    } catch {
      return undefined
    }
  }, [pool, token0, token1, tickLower, tickUpper, independentRaw, independentField])

  const amount0Raw = derived?.amount0Raw
  const amount1Raw = derived?.amount1Raw

  /* ------------------------------------------------------ native + approvals */

  const currency0IsNative = Boolean(sorted?.currency0?.isNative)
  const currency1IsNative = Boolean(sorted?.currency1?.isNative)
  const nativeCurrency: NativeCurrency | undefined = currency0IsNative
    ? (sorted?.currency0 as NativeCurrency)
    : currency1IsNative
      ? (sorted?.currency1 as NativeCurrency)
      : undefined

  const npm = v3?.positionManager
  const token0Erc20 = !currency0IsNative ? (token0?.address as Address | undefined) : undefined
  const token1Erc20 = !currency1IsNative ? (token1?.address as Address | undefined) : undefined

  const token0AllowanceRead = useReadContract({
    address: token0Erc20 ? assume0xAddress(token0Erc20) : undefined,
    chainId,
    abi: erc20Abi,
    functionName: 'allowance',
    args: owner && npm ? [owner, assume0xAddress(npm)] : undefined,
    query: { enabled: Boolean(token0Erc20 && owner && npm) },
  })
  const token1AllowanceRead = useReadContract({
    address: token1Erc20 ? assume0xAddress(token1Erc20) : undefined,
    chainId,
    abi: erc20Abi,
    functionName: 'allowance',
    args: owner && npm ? [owner, assume0xAddress(npm)] : undefined,
    query: { enabled: Boolean(token1Erc20 && owner && npm) },
  })
  const token0Allowance = token0AllowanceRead.data as bigint | undefined
  const token1Allowance = token1AllowanceRead.data as bigint | undefined

  const needsToken0Approval = Boolean(token0Erc20 && amount0Raw !== undefined && amount0Raw > 0n && token0Allowance !== undefined && token0Allowance < amount0Raw)
  const needsToken1Approval = Boolean(token1Erc20 && amount1Raw !== undefined && amount1Raw > 0n && token1Allowance !== undefined && token1Allowance < amount1Raw)

  /* ------------------------------------------------------ writes */

  const { writeContractAsync } = useWriteContract()
  const { sendTransactionAsync, isPending: isSendPending } = useSendTransaction()
  const getDeadline = useGetTransactionDeadline()

  const [token0ApproveHash, setToken0ApproveHash] = useState<Hash | undefined>()
  const [token1ApproveHash, setToken1ApproveHash] = useState<Hash | undefined>()
  const [mintHash, setMintHash] = useState<Hash | undefined>()
  const [error, setError] = useState<string | undefined>()

  const token0ApproveReceipt = useWaitForTransactionReceipt({ hash: token0ApproveHash, chainId })
  const token1ApproveReceipt = useWaitForTransactionReceipt({ hash: token1ApproveHash, chainId })
  const mintReceipt = useWaitForTransactionReceipt({ hash: mintHash, chainId })

  const token0Approving = Boolean(token0ApproveHash) && token0ApproveReceipt.isLoading
  const token1Approving = Boolean(token1ApproveHash) && token1ApproveReceipt.isLoading
  const isConfirming = Boolean(mintHash) && mintReceipt.isLoading
  const isDone = Boolean(mintHash) && mintReceipt.isSuccess

  useEffect(() => {
    if (token0ApproveReceipt.isSuccess) {
      void token0AllowanceRead.refetch()
      setToken0ApproveHash(undefined)
    }
  }, [token0ApproveReceipt.isSuccess, token0AllowanceRead])
  useEffect(() => {
    if (token1ApproveReceipt.isSuccess) {
      void token1AllowanceRead.refetch()
      setToken1ApproveHash(undefined)
    }
  }, [token1ApproveReceipt.isSuccess, token1AllowanceRead])
  useEffect(() => {
    if (mintReceipt.isSuccess) {
      void poolReads.refetch()
    }
  }, [mintReceipt.isSuccess, poolReads])

  const approveSide = async (
    erc20?: Address,
    amountRaw?: bigint,
    setHash?: (h: Hash) => void,
  ): Promise<void> => {
    if (!erc20 || !npm || amountRaw === undefined) {
      return
    }
    setError(undefined)
    try {
      const hash = await writeContractAsync({
        address: assume0xAddress(erc20),
        chainId,
        abi: erc20Abi,
        functionName: 'approve',
        args: [assume0xAddress(npm), amountRaw],
      })
      setHash?.(hash)
    } catch (e) {
      setError(toMessage(e))
    }
  }

  const approveToken0 = (): Promise<void> => approveSide(token0Erc20, amount0Raw, setToken0ApproveHash)
  const approveToken1 = (): Promise<void> => approveSide(token1Erc20, amount1Raw, setToken1ApproveHash)

  const inputsValid = Boolean(
    ready &&
      owner &&
      npm &&
      pool &&
      derived?.position &&
      tickLower !== undefined &&
      tickUpper !== undefined &&
      tickLower < tickUpper &&
      // When creating a fresh pool, an initial price is required.
      (poolExists || currentPrice),
  )
  const canMint = Boolean(inputsValid && !needsToken0Approval && !needsToken1Approval && !isSendPending)

  const mint = async (): Promise<void> => {
    if (!canMint || !npm || !owner || !derived?.position) {
      return
    }
    setError(undefined)
    let deadline: bigint
    try {
      deadline = (await getDeadline())?.toBigInt() ?? BigInt(Math.floor(Date.now() / 1000) + 1200)
    } catch {
      deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)
    }
    try {
      const { calldata, value } = NonfungiblePositionManager.addCallParameters(derived.position, {
        recipient: owner,
        createPool: !poolExists,
        slippageTolerance: new Percent(slippageBips, 10_000),
        deadline: deadline.toString(),
        useNative: nativeCurrency,
      })
      const hash = await sendTransactionAsync({
        to: assume0xAddress(npm),
        data: calldata as `0x${string}`,
        value: BigInt(value),
        chainId,
      })
      setMintHash(hash)
    } catch (e) {
      setError(toMessage(e))
    }
  }

  const reset = (): void => {
    setMintHash(undefined)
    setToken0ApproveHash(undefined)
    setToken1ApproveHash(undefined)
    setError(undefined)
  }

  return {
    ready,
    poolAddress,
    poolExists,
    poolLoading,
    token0,
    token1,
    currentPrice,
    tickLower,
    tickUpper,
    priceLower,
    priceUpper,
    atLimitLower,
    atLimitUpper,
    deposit0Disabled,
    deposit1Disabled,
    dependentAmount: derived?.dependentAmount,
    dependentField: derived?.dependentField,
    amount0Raw,
    amount1Raw,
    needsToken0Approval,
    needsToken1Approval,
    token0Approving,
    token1Approving,
    approveToken0,
    approveToken1,
    inputsValid,
    canMint,
    mint,
    isWritePending: isSendPending,
    mintHash,
    isConfirming,
    isDone,
    error,
    reset,
  }
}

/** Best-effort human-readable error, dropping the giant viem stack. */
function toMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'shortMessage' in e && typeof (e as { shortMessage: unknown }).shortMessage === 'string') {
    return (e as { shortMessage: string }).shortMessage
  }
  if (e instanceof Error) {
    return e.message.split('\n')[0]
  }
  return 'Transaction failed'
}
