/**
 * HookSwap's live chain set + viem chain definitions.
 *
 * FACTS-ONLY: chain ids, RPCs, native currencies and explorers below are the values
 * locked in the HookSwap working doc (CLAUDE.md → LOCKED DECISIONS + deploy table) and
 * the in-repo chain definitions. Sepolia is the canonical validation chain.
 */
import type { Chain } from 'viem'

/** The chain ids HookSwap ships on. */
export const HOOKSWAP_CHAIN_IDS = {
  Sepolia: 11155111,
  HyperEvm: 999,
  MegaETH: 4326,
  Ink: 57073,
  XLayer: 196,
  Robinhood: 4663,
  Tempo: 4217,
} as const

export type HookSwapChainId = (typeof HOOKSWAP_CHAIN_IDS)[keyof typeof HOOKSWAP_CHAIN_IDS]

export const HOOKSWAP_CHAIN_ID_LIST: number[] = Object.values(HOOKSWAP_CHAIN_IDS)

export function isHookSwapChain(chainId: number): chainId is HookSwapChainId {
  return HOOKSWAP_CHAIN_ID_LIST.includes(chainId)
}

/** Public default RPC per chain (overridable via the client's `rpcUrl` option). */
export const DEFAULT_RPC: Record<number, string> = {
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  999: 'https://rpc.hyperliquid.xyz/evm',
  4326: 'https://megaeth.drpc.org',
  57073: 'https://rpc-gel.inkonchain.com',
  196: 'https://rpc.xlayer.tech',
  4663: 'https://rpc.mainnet.chain.robinhood.com',
  4217: 'https://rpc.tempo.xyz',
}

/**
 * Minimal viem `Chain` definitions for the HookSwap set. These are intentionally light
 * (id + name + native currency + default RPC) — enough for viem's `createPublicClient`.
 * Tempo pays gas in an ERC-20 (pathUSD); its `nativeCurrency` here is a placeholder for
 * viem's type only and is not used for pricing.
 */
export const HOOKSWAP_CHAINS: Record<number, Chain> = {
  11155111: {
    id: 11155111,
    name: 'Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [DEFAULT_RPC[11155111]] } },
  } as Chain,
  999: {
    id: 999,
    name: 'HyperEVM',
    nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 },
    rpcUrls: { default: { http: [DEFAULT_RPC[999]] } },
  } as Chain,
  4326: {
    id: 4326,
    name: 'MegaETH',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [DEFAULT_RPC[4326]] } },
  } as Chain,
  57073: {
    id: 57073,
    name: 'Ink',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [DEFAULT_RPC[57073]] } },
  } as Chain,
  196: {
    id: 196,
    name: 'X Layer',
    nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
    rpcUrls: { default: { http: [DEFAULT_RPC[196]] } },
  } as Chain,
  4663: {
    id: 4663,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [DEFAULT_RPC[4663]] } },
  } as Chain,
  4217: {
    id: 4217,
    name: 'Tempo',
    nativeCurrency: { name: 'pathUSD', symbol: 'pathUSD', decimals: 18 },
    rpcUrls: { default: { http: [DEFAULT_RPC[4217]] } },
  } as Chain,
}

/** Resolve a viem `Chain` for a HookSwap chain id, or `undefined` if not in the set. */
export function getHookSwapChain(chainId: number): Chain | undefined {
  return HOOKSWAP_CHAINS[chainId]
}
