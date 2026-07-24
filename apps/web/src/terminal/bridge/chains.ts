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
import { RELAY_NATIVE_ADDRESS } from '~/terminal/bridge/addresses'
import {
  fetchRelayChains,
  fetchRelayCurrencies,
  type RelayChain,
  type RelayCurrencyMeta,
} from '~/terminal/bridge/relayClient'

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

/* ---------------------------------------------------- per-chain currency logos */

// GET /chains lists a chain's native + featured ERC-20s but WITHOUT logos
// (`metadata` is null there — verified live). POST /currencies/v2 returns the same
// tokens WITH `metadata.logoURI` (verified: native + top ERC-20s, incl. logos), so we
// use it as the token-selector's default list and as an address→logo lookup to give the
// selected token its real icon. Cached per chain for the browser session.
const currencyCache = new Map<number, RelayCurrencyMeta[]>()
const currencyInflight = new Map<number, Promise<RelayCurrencyMeta[]>>()

async function loadCurrenciesOnce(chainId: number): Promise<RelayCurrencyMeta[]> {
  const cached = currencyCache.get(chainId)
  if (cached) {
    return cached
  }
  let p = currencyInflight.get(chainId)
  if (!p) {
    // No search term ⇒ Relay returns the chain's default/top verified tokens (with logos).
    p = fetchRelayCurrencies(chainId)
      .then((list) => {
        currencyCache.set(chainId, list)
        return list
      })
      .finally(() => {
        currencyInflight.delete(chainId)
      })
    currencyInflight.set(chainId, p)
  }
  return p
}

export interface UseChainCurrencies {
  /** The chain's default verified tokens (native + top ERC-20s), each carrying a logo. */
  currencies: RelayCurrencyMeta[]
  /** Lowercased token address (native ⇒ zero address) → `metadata.logoURI`. */
  logoByAddress: Map<string, string>
}

/**
 * The default token list for a chain, fetched from Relay /currencies/v2 (which — unlike
 * /chains — includes `metadata.logoURI`). Returns both the list (for the token selector)
 * and an address→logo map (to give the currently-selected token its real icon). Cached
 * per chain; empty (graceful) for chains Relay doesn't serve.
 */
export function useChainCurrencies(chainId?: number): UseChainCurrencies {
  const [currencies, setCurrencies] = useState<RelayCurrencyMeta[]>(
    chainId !== undefined ? currencyCache.get(chainId) ?? [] : [],
  )

  useEffect(() => {
    if (chainId === undefined) {
      setCurrencies([])
      return
    }
    const cached = currencyCache.get(chainId)
    if (cached) {
      setCurrencies(cached)
      return
    }
    let active = true
    loadCurrenciesOnce(chainId)
      .then((list) => {
        if (active) {
          setCurrencies(list)
        }
      })
      .catch(() => {
        if (active) {
          setCurrencies([])
        }
      })
    return () => {
      active = false
    }
  }, [chainId])

  const logoByAddress = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of currencies) {
      const logo = c.metadata?.logoURI
      if (logo) {
        m.set((c.address ?? RELAY_NATIVE_ADDRESS).toLowerCase(), logo)
      }
    }
    return m
  }, [currencies])

  return useMemo(() => ({ currencies, logoByAddress }), [currencies, logoByAddress])
}
