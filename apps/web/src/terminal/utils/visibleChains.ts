/**
 * Data-layer chain visibility — hide TESTNET data on the live mainnet DEX.
 *
 * PROBLEM: HookSwap's data-api indexes Sepolia (11155111) alongside the mainnets, so
 * Sepolia's test markets / pools / tokens / TVL leak into every cross-chain DATA surface
 * (ticker tape, Markets list, search, perps directory) and confuse users on a mainnet.
 *
 * THE RULE (generic, NOT hardcoded to one chain): a testnet chain's DATA is shown only
 * when the connected wallet is ON that testnet. On a mainnet (the normal case) every
 * testnet id is excluded from the aggregated data surfaces. When the wallet connects to
 * a testnet (the testing path), that testnet's data shows normally again.
 *
 * This is the DATA-layer twin of `isChainDexLive` in TerminalApp.tsx, which already
 * excludes testnets from the mainnet chain SWITCHER via `isTestnetChain`. The chain
 * SWITCHER is intentionally NOT gated here — Sepolia stays selectable so a tester can
 * connect to it; only DATA is hidden by default.
 */
import type { MultichainToken } from '@uniswap/client-data-api/dist/data/v1/types_pb'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { isTestnetChain } from 'uniswap/src/features/chains/utils'
import { useAccount } from '~/hooks/useAccount'

/** Cheap guard so an out-of-range id never throws inside `getChainInfo`. */
function safeIsTestnet(chainId: number): boolean {
  try {
    return isTestnetChain(chainId as UniverseChainId)
  } catch {
    // Unknown id — treat as non-testnet (don't hide something we can't classify).
    return false
  }
}

/**
 * True when data for `chainId` should be visible given the wallet's connected chain.
 * - Unknown/undefined chain → visible (honest — never hide what we can't classify).
 * - Mainnet chain → always visible.
 * - Testnet chain → visible ONLY when the wallet is connected to that same testnet.
 */
export function isChainDataVisible(chainId: number | undefined, connectedChainId: number | undefined): boolean {
  if (chainId === undefined) {
    return true
  }
  if (!safeIsTestnet(chainId)) {
    return true
  }
  return connectedChainId === chainId
}

/**
 * True when a MultichainToken should surface. A token is visible when AT LEAST ONE of
 * its per-chain deployments is on a visible chain — so a token that lives on both a
 * mainnet and Sepolia stays visible (its mainnet side is real), while a Sepolia-only
 * test token is hidden on a mainnet. Tokens with no chain breakdown are left visible.
 */
export function isTokenDataVisible(
  token: Pick<MultichainToken, 'chainTokens'>,
  connectedChainId: number | undefined,
): boolean {
  const chainTokens = token.chainTokens ?? []
  if (chainTokens.length === 0) {
    return true
  }
  return chainTokens.some((ct) => isChainDataVisible(ct.chainId, connectedChainId))
}

/**
 * Hook form — reads the connected wallet chain once and returns stable predicates for
 * gating any data surface. `showSepolia` mirrors the task's `connectedWalletChainId ===
 * UniverseChainId.Sepolia` for callers that want the boolean directly.
 */
export function useVisibleChains(): {
  connectedChainId: number | undefined
  showSepolia: boolean
  isChainVisible: (chainId: number | undefined) => boolean
  isTokenVisible: (token: Pick<MultichainToken, 'chainTokens'>) => boolean
} {
  const { chainId: connectedChainId } = useAccount()
  return {
    connectedChainId,
    showSepolia: connectedChainId === UniverseChainId.Sepolia,
    isChainVisible: (chainId) => isChainDataVisible(chainId, connectedChainId),
    isTokenVisible: (token) => isTokenDataVisible(token, connectedChainId),
  }
}
