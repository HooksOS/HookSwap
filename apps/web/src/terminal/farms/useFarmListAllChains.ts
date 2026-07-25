/**
 * All-chain farm discovery.
 *
 * STACK-WIDE RULE: on-chain data is shown for EVERY chain the feature is deployed
 * on, regardless of which chain the wallet happens to sit on. A user with farms on
 * Ink should see them while connected to Robinhood — previously the Manage tab
 * showed only the connected chain's farms and rendered an empty state everywhere
 * else, which reads as "you have no farms" rather than "you are on the wrong chain".
 *
 * Mirrors the vesting reference implementation (`useMySchedulesAllChains`):
 *
 *   • The chain list comes from the feature's OWN address map, so a chain the
 *     factory isn't deployed on simply contributes no rows — deployment truth,
 *     not a hand-maintained list.
 *   • The list is a MODULE CONSTANT. `useFarmList` is a hook, so it is called once
 *     per entry inside a `.map` — that only satisfies the rules of hooks because
 *     the array's length and order can never change between renders. Never derive
 *     this list from state, props, or a filtered/async value.
 *   • Results merge PROGRESSIVELY: a chain still loading contributes nothing but
 *     does not block chains that have already resolved.
 *
 * Writes still belong to the row's own chain — callers pair each row with a
 * `SwitchChainButton` when the wallet is elsewhere.
 */
import { useMemo } from 'react'
import type { Address } from 'viem'
import type { UniverseChainId } from 'uniswap/src/features/chains/types'
import { supportedChainIdsFromMap } from '~/terminal/components/SwitchChainButton'
import { isChainDataVisible } from '~/terminal/utils/visibleChains'
import { FARM_FACTORY_ADDRESSES } from '~/terminal/farms/addresses'
import { useFarmList } from '~/terminal/farms/useFarm'

/** Fixed, module-level chain list — see the rules-of-hooks note above. */
const CHAINS: UniverseChainId[] = supportedChainIdsFromMap(FARM_FACTORY_ADDRESSES)

export interface FarmRef {
  chainId: UniverseChainId
  farm: Address
}

export interface UseFarmListAllChains {
  /** undefined = nothing has resolved yet; [] = genuinely no farms anywhere. */
  farms?: FarmRef[]
  /** True while at least one visible chain is still loading. */
  isLoading: boolean
  /** True only if EVERY visible chain errored — a single bad RPC is not a failure. */
  error: boolean
  /** Chains that errored, so the UI can name them instead of silently dropping them. */
  erroredChains: UniverseChainId[]
  refetch: () => void
}

export function useFarmListAllChains({
  connectedChainId,
}: {
  connectedChainId?: number
}): UseFarmListAllChains {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- CHAINS is a module constant: fixed length + order every render.
  const perChain = CHAINS.map((chainId) => ({ chainId, res: useFarmList({ chainId }) }))

  // Testnet chains are hidden unless the wallet is on one (shared gate, same as
  // every other multichain surface).
  const visible = perChain.filter(({ chainId }) => isChainDataVisible(chainId, connectedChainId))

  const farmsKey = visible.map(({ res }) => (res.farms ? res.farms.join(',') : '')).join('|')
  const errorKey = visible.map(({ res }) => (res.error ? '1' : '0')).join('')
  const loadingKey = visible.map(({ res }) => (res.isLoading ? '1' : '0')).join('')

  const farms = useMemo(() => {
    const anyResolved = visible.some(({ res }) => res.farms !== undefined)
    if (!anyResolved) {
      return undefined
    }
    const merged: FarmRef[] = []
    for (const { chainId, res } of visible) {
      for (const farm of res.farms ?? []) {
        merged.push({ chainId, farm })
      }
    }
    // Deterministic order so rows don't reshuffle as chains resolve at different speeds.
    merged.sort((a, b) => (a.chainId !== b.chainId ? a.chainId - b.chainId : a.farm.localeCompare(b.farm)))
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps -- string keys stand in for the per-chain arrays
  }, [farmsKey, loadingKey])

  const erroredChains = useMemo(
    () => visible.filter(({ res }) => res.error).map(({ chainId }) => chainId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [errorKey],
  )

  return {
    farms,
    isLoading: visible.some(({ res }) => res.isLoading),
    // Only a total failure is an error; one unreachable chain must not blank the list.
    error: visible.length > 0 && visible.every(({ res }) => res.error),
    erroredChains,
    refetch: () => {
      for (const { res } of visible) {
        res.refetch()
      }
    },
  }
}
