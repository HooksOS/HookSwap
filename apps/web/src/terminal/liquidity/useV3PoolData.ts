/**
 * HookSwap Terminal — on-chain v3 pool discovery for the CREATE-position flow.
 *
 * WHY ON-CHAIN (not the hosted subgraph): the stock Uniswap create-position flow
 * fetches pool state from a hosted liquidity/pool REST service that does NOT serve
 * HookSwap's custom chains. So — exactly like the existing v2 `useCreateV2Pool` —
 * we read the truth directly from chain via wagmi: compute the deterministic pool
 * address with the v3-sdk (`Pool.getAddress`, canonical init hash + own factory) and
 * read `slot0()`. A zero `sqrtPriceX96` (or a non-contract) ⇒ the pool for that fee
 * tier does NOT exist yet → the UI honestly says "no pool yet — you set the price".
 *
 * This is authoritative on EVERY HookSwap chain regardless of indexer coverage. USD
 * TVL per tier is a separate, best-effort data-api read (`useV3FeeTierTvl`).
 */
import { Token } from '@uniswap/sdk-core'
import { FeeAmount, nearestUsableTick, Pool, TICK_SPACINGS, TickMath, tickToPrice } from '@uniswap/v3-sdk'
import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { assume0xAddress } from '~/utils/wagmi'
import type { Address } from '~/chains'
import { getV3Addresses } from '~/terminal/liquidity/v3Addresses'
import { v3PoolAbi } from '~/terminal/liquidity/abis'
import { V3_FEE_TIERS } from '~/terminal/liquidity/feeTiers'

export interface V3PoolTierState {
  fee: FeeAmount
  /** Deterministic pool address for (token0, token1, fee) on this chain. */
  poolAddress?: Address
  /** True once slot0 is read AND initialized (sqrtPriceX96 > 0). */
  exists: boolean
  /** Read has resolved (success or revert), so `exists` is meaningful. */
  loaded: boolean
  sqrtPriceX96?: bigint
  tick?: number
  /**
   * Current price of token1 in terms of token0 (base=token0, quote=token1),
   * as a decimal string — only when the pool exists. Honest `undefined` otherwise.
   */
  price?: string
}

const slot0Read = { abi: v3PoolAbi, functionName: 'slot0' } as const

/**
 * Read every canonical fee tier's pool state for a sorted (token0, token1) pair on
 * `chainId`. Returns a stable array in `V3_FEE_TIERS` order. Tokens must be the
 * WRAPPED sdk-core `Token`s (native → WETH) so pool addresses derive correctly.
 */
export function useV3FeeTierPools({
  chainId,
  token0,
  token1,
}: {
  chainId?: number
  token0?: Token
  token1?: Token
}): { tiers: V3PoolTierState[]; isLoading: boolean } {
  const v3 = getV3Addresses(chainId)

  // Deterministic pool address per tier (SDK, canonical init hash + own factory).
  const poolAddresses = useMemo(() => {
    if (!v3 || !token0 || !token1 || token0.equals(token1)) {
      return V3_FEE_TIERS.map(() => undefined as Address | undefined)
    }
    return V3_FEE_TIERS.map((t) => {
      try {
        return assume0xAddress(Pool.getAddress(token0, token1, t.fee, undefined, v3.v3Factory))
      } catch {
        return undefined
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v3?.v3Factory, token0?.address, token1?.address, chainId])

  const enabled = poolAddresses.some(Boolean)
  const contracts = useMemo(
    () =>
      enabled
        ? poolAddresses.map((address) => ({
            ...slot0Read,
            // Addresses derive together (same tokens/factory) → all defined when enabled.
            address: (address ?? ('0x0000000000000000000000000000000000000000' as Address)),
            chainId,
          }))
        : [],
    [poolAddresses, chainId, enabled],
  )

  const { data, isLoading } = useReadContracts({
    contracts,
    allowFailure: true,
    query: { enabled },
  })

  const tiers = useMemo<V3PoolTierState[]>(() => {
    return V3_FEE_TIERS.map((t, i) => {
      const poolAddress = poolAddresses[i]
      const result = data?.[i]
      const loaded = Boolean(result) && result?.status !== undefined
      const slot0 = result?.status === 'success' ? (result.result as readonly [bigint, number, ...unknown[]]) : undefined
      const sqrtPriceX96 = slot0?.[0]
      const tick = slot0?.[1]
      const exists = Boolean(sqrtPriceX96 && sqrtPriceX96 > 0n)

      let price: string | undefined
      if (exists && tick !== undefined && token0 && token1) {
        try {
          price = tickToPrice(token0, token1, tick).toSignificant(6)
        } catch {
          price = undefined
        }
      }

      return {
        fee: t.fee,
        poolAddress,
        exists,
        loaded: loaded || !enabled,
        sqrtPriceX96,
        tick,
        price,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, poolAddresses, token0?.address, token1?.address, enabled])

  return { tiers, isLoading: enabled && isLoading }
}

/** Nearest usable full-range (min/max) ticks for a fee tier's tick spacing. */
export function fullRangeTicks(fee: FeeAmount): { tickLower: number; tickUpper: number } {
  const spacing = TICK_SPACINGS[fee]
  return {
    tickLower: nearestUsableTick(TickMath.MIN_TICK, spacing),
    tickUpper: nearestUsableTick(TickMath.MAX_TICK, spacing),
  }
}
