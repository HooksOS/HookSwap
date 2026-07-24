/**
 * HookSwap Terminal — per-fee-tier USD TVL for a token pair, from the self-hosted
 * DATA-API (data.hookswap.org), which now indexes v3.
 *
 * Reuses the app's real REST hook `useGetPoolsByTokens` (→ `listPools` over
 * `dataApiGetTransport`, whose base URL is the HookSwap data-api via the
 * `DATA_API_BASE_URL_V2_OVERRIDE` env). This is the SAME transport the Terminal
 * Markets/Explore tables use — NOT the hosted Uniswap subgraph (which doesn't serve
 * custom chains).
 *
 * DATA POLICY (no fabrication): TVL is returned ONLY for fee tiers the data-api
 * actually indexes; a tier with no indexed pool → `undefined` → the card renders an
 * honest "—". Existence is still proven on-chain by `useV3FeeTierPools`; this hook
 * only enriches with USD depth where the indexer has it.
 */
import { ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { useMemo } from 'react'
import { useGetPoolsByTokens } from 'uniswap/src/data/rest/getPools'

export interface V3FeeTierTvl {
  /** feeTier (hundredths of a bip) → total USD TVL of the indexed v3 pool. */
  tvlByFee: Record<number, number | undefined>
  isLoading: boolean
}

/**
 * @param token0Address / token1Address — checksummed or lowercase ERC-20 addresses
 *   (WRAPPED — native must be passed as its WETH-equivalent). Order does not matter.
 */
export function useV3FeeTierTvl({
  chainId,
  token0Address,
  token1Address,
}: {
  chainId?: number
  token0Address?: string
  token1Address?: string
}): V3FeeTierTvl {
  const enabled = Boolean(chainId && token0Address && token1Address)
  const { data, isLoading } = useGetPoolsByTokens(
    { chainId: chainId ?? 0, token0: token0Address ?? '', token1: token1Address },
    enabled,
  )

  const tvlByFee = useMemo<Record<number, number | undefined>>(() => {
    const out: Record<number, number | undefined> = {}
    for (const pool of data?.pools ?? []) {
      if (pool.protocolVersion !== ProtocolVersion.V3) {
        continue
      }
      const tvl = Number(pool.totalLiquidityUsd)
      if (Number.isFinite(tvl) && tvl > 0) {
        // Keep the largest indexed TVL if the backend returns duplicates for a tier.
        const prev = out[pool.fee]
        out[pool.fee] = prev === undefined ? tvl : Math.max(prev, tvl)
      }
    }
    return out
  }, [data])

  return { tvlByFee, isLoading: enabled && isLoading }
}
