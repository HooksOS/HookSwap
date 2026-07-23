/**
 * HookSwap Terminal — Bridge chain registry.
 *
 * The selectable chain list is fetched LIVE from Relay's GET /chains (see
 * {@link useBridgeChains}) so it is always complete and future-proof — every
 * Relay-supported chain is selectable as origin AND destination, with no
 * hardcoded subset to maintain. XLayer (196) is simply absent from Relay's list
 * (it is not a Relay-supported chain), which is the correct behaviour — no
 * special-casing needed.
 *
 * The only static data here is the PIN ORDER: HookSwap's own chains (+ ETH/Base
 * as the primary funding sources) are surfaced at the top of the selectors so
 * users can bridge INTO HookSwap chains easily.
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchRelayChains, type RelayChain } from '~/terminal/bridge/relayClient'

/**
 * HookSwap's own chains, pinned to the top of the chain selectors (in this
 * order), followed by the primary funding chains. Any of these that Relay does
 * not currently return are silently skipped.
 */
export const HOOKSWAP_CHAIN_IDS: readonly number[] = [
  4663, // Robinhood Chain
  988, // Stable
  4326, // MegaETH
  57073, // Ink
  999, // HyperEVM
  4217, // Tempo
] as const

/** Primary funding origins pinned after the HookSwap chains. */
export const PINNED_FUNDING_CHAIN_IDS: readonly number[] = [
  1, // Ethereum
  8453, // Base
] as const

/** Full pin order: HookSwap chains first, then ETH/Base. */
export const PINNED_CHAIN_IDS: readonly number[] = [...HOOKSWAP_CHAIN_IDS, ...PINNED_FUNDING_CHAIN_IDS]

/** True when `id` is one of HookSwap's own chains (used for the "HookSwap" badge). */
export function isHookSwapChain(id: number): boolean {
  return HOOKSWAP_CHAIN_IDS.includes(id)
}

/** Human-friendly label for a Relay chain entry. */
export function chainLabel(chain: RelayChain): string {
  return chain.displayName || chain.name || `Chain ${chain.id}`
}

/**
 * Order chains for a selector: pinned (HookSwap + ETH/Base) first in pin order,
 * then the rest alphabetically by label.
 */
export function orderChains(chains: RelayChain[]): RelayChain[] {
  const byId = new Map(chains.map((c) => [c.id, c]))
  const pinned: RelayChain[] = []
  for (const id of PINNED_CHAIN_IDS) {
    const c = byId.get(id)
    if (c) {
      pinned.push(c)
      byId.delete(id)
    }
  }
  const rest = [...byId.values()].sort((a, b) => chainLabel(a).localeCompare(chainLabel(b)))
  return [...pinned, ...rest]
}

/* ------------------------------------------------------------- module cache */

// Cache the Relay chain catalogue for the browser session — it changes rarely and
// every selector/quote reads from it. Shared across hook instances.
let cachedChains: RelayChain[] | undefined
let inflight: Promise<RelayChain[]> | undefined

async function loadChainsOnce(): Promise<RelayChain[]> {
  if (cachedChains) {
    return cachedChains
  }
  if (!inflight) {
    inflight = fetchRelayChains()
      .then((chains) => {
        cachedChains = chains
        return chains
      })
      .finally(() => {
        inflight = undefined
      })
  }
  return inflight
}

export interface UseBridgeChains {
  /** All Relay-supported chains, ordered (pinned first). */
  chains: RelayChain[]
  loading: boolean
  error?: string
  /** Lookup a loaded chain by id. */
  byId: (id?: number) => RelayChain | undefined
}

/**
 * Live Relay chain catalogue, ordered with HookSwap chains pinned. Cached for the
 * session. Honest loading/error states (empty list + `error` when /chains fails).
 */
export function useBridgeChains(): UseBridgeChains {
  const [chains, setChains] = useState<RelayChain[]>(cachedChains ?? [])
  const [loading, setLoading] = useState(!cachedChains)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (cachedChains) {
      setChains(cachedChains)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    loadChainsOnce()
      .then((loaded) => {
        if (active) {
          setChains(loaded)
          setError(undefined)
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load chains')
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  const ordered = useMemo(() => orderChains(chains), [chains])
  const map = useMemo(() => new Map(chains.map((c) => [c.id, c])), [chains])

  return useMemo(
    () => ({
      chains: ordered,
      loading,
      error,
      byId: (id?: number) => (id === undefined ? undefined : map.get(id)),
    }),
    [ordered, loading, error, map],
  )
}
