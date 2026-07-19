/**
 * HookSwapPerps — market directory (engine-primary, on-chain fallback).
 *
 * Lists tradable markets from the matching engine `GET /markets` (which reads the
 * MarketRegistry). If the engine is unreachable, transparently FALLS BACK to a direct
 * on-chain MarketRegistry read (`~/terminal/perps/factory/useMarkets`) so the desk still
 * lists real markets and only the live-feed panels (book/trades/mark) show their own
 * "engine offline" state. Both sources are real — nothing is fabricated.
 *
 * Returns normalized `PerpMarketView`s. An empty list from a reachable source is an honest
 * "no markets yet — launch one" state, not an error.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { perpsEngine } from '~/terminal/perps/engine/client'
import { fromChainMarket, fromEngineMarket, type PerpMarketView } from '~/terminal/perps/engine/marketView'
import { useMarkets as useChainMarkets } from '~/terminal/perps/factory/useMarkets'

export interface UseEngineMarkets {
  /** Normalized markets from whichever real source resolved; undefined while loading. */
  markets?: PerpMarketView[]
  /** Which source produced the current list. */
  source?: 'engine' | 'chain'
  isLoading: boolean
  /** True only when BOTH the engine and the on-chain registry failed. */
  error: boolean
  /** True when the engine REST call failed (drives the "engine offline" banner). */
  engineUnreachable: boolean
  refetch: () => void
}

export function useMarkets({ chainId }: { chainId?: number }): UseEngineMarkets {
  const engineQuery = useQuery({
    queryKey: ['perps-engine-markets'],
    queryFn: ({ signal }) => perpsEngine.getMarkets(signal),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const engineUnreachable = engineQuery.isError
  const engineMarkets = engineQuery.data

  // On-chain registry fallback — only consulted when the engine has no usable list.
  const chain = useChainMarkets({ chainId })

  return useMemo<UseEngineMarkets>(() => {
    // Prefer the engine when it returned a list (even empty — that's an honest state).
    if (engineMarkets !== undefined) {
      return {
        markets: engineMarkets.map(fromEngineMarket),
        source: 'engine',
        isLoading: false,
        error: false,
        engineUnreachable: false,
        refetch: () => {
          void engineQuery.refetch()
        },
      }
    }

    // Engine still loading, no error yet → loading.
    if (engineQuery.isLoading) {
      return {
        markets: undefined,
        source: undefined,
        isLoading: true,
        error: false,
        engineUnreachable: false,
        refetch: () => void engineQuery.refetch(),
      }
    }

    // Engine failed → on-chain registry.
    const chainViews = chain.markets?.map((r) =>
      fromChainMarket({
        market: r.market,
        collateral: r.collateral,
        marketId: r.marketId,
        tier: r.tier,
        status: r.status,
      }),
    )
    return {
      markets: chainViews,
      source: chainViews ? 'chain' : undefined,
      isLoading: chain.isLoading,
      error: engineUnreachable && chain.error,
      engineUnreachable,
      refetch: () => {
        void engineQuery.refetch()
        chain.refetch()
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineMarkets, engineQuery.isLoading, engineUnreachable, chain.markets, chain.isLoading, chain.error])
}
