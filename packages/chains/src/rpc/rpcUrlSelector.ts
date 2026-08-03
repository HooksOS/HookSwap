import { logger } from 'utilities/src/logger/logger'
import { FLASHBOTS_RPC_URL } from './FlashbotsCommon'
import { RPCType, UniverseChainId } from './types'
import type { RpcChainInfo } from './types'

// Types of configurations for RPC providers
export interface RpcConfig {
  rpcUrl: string
  /**
   * Remaining public endpoints for the same chain, in priority order, EXCLUDING
   * `rpcUrl`. Consumers that can fail over (createViemClient, createEthersProvider)
   * should try `rpcUrl` first and walk this list on error.
   *
   * Only populated for public reads. It is deliberately absent for
   * `RPCType.Private` (a private/Flashbots tx must never be rebroadcast to public
   * endpoints) and for UniRPC configs (the gateway does server-side failover).
   */
  fallbackRpcUrls?: string[]
  /**
   * Set when this config targets the UniRPC entry gateway. Consumers should
   * branch on this flag (not on header presence) to decide whether to apply
   * UniRPC-specific transport behavior (session auth, 6s timeout, id:0 patch).
   */
  isUniRpc?: boolean
  shouldUseFlashbots?: boolean
  flashbotsConfig?: FlashbotsConfig
  /** Static headers to include in RPC requests (e.g., x-request-source for UniRPC) */
  headers?: Record<string, string>
  /** Async callback resolved per-request for dynamic headers (e.g., session auth) */
  getRequestHeaders?: () => Promise<Record<string, string>>
  /** Fetch credentials mode — 'include' for cookie-based session auth on web */
  credentials?: 'include'
}

export interface FlashbotsConfig {
  refundPercent: number
  calldataHintsEnabled: boolean
}

export interface RpcUrlSelectorCtx {
  getChainInfo: (chainId: UniverseChainId) => RpcChainInfo
  getFlashbotsEnabled: () => boolean
  getFlashbotsRefundPercent: () => number
  getCalldataHintsEnabled: () => boolean
}

export type RpcUrlSelector = (chainId: UniverseChainId, rpcType?: RPCType) => RpcConfig | null

/**
 * Public read slots, in the order a client should fail over through them. Mirrors
 * `orderedTransportUrls` in apps/web/src/connection/wagmiConfig.ts, minus the Private
 * slot (never used as a fallback for a public read).
 */
const PUBLIC_FALLBACK_RPC_TYPES = [
  RPCType.Public,
  RPCType.PublicAlt,
  RPCType.Default,
  RPCType.Fallback,
  RPCType.Interface,
] as const

/**
 * Every other public endpoint configured for `chainId`, deduped and with `primaryUrl`
 * removed. Chain info commonly repeats the same ordered list across slots, so the dedupe
 * is what keeps the failover chain short.
 */
function collectFallbackRpcUrls(ctx: RpcUrlSelectorCtx, chainId: UniverseChainId, primaryUrl: string): string[] {
  const { rpcUrls } = ctx.getChainInfo(chainId)
  const seen = new Set<string>([primaryUrl])
  const urls: string[] = []
  for (const rpcType of PUBLIC_FALLBACK_RPC_TYPES) {
    for (const url of rpcUrls[rpcType]?.http ?? []) {
      if (url && !seen.has(url)) {
        seen.add(url)
        urls.push(url)
      }
    }
  }
  return urls
}

/**
 * Creates a selector that picks the appropriate RPC URL based on chain ID and RPC type.
 * All external dependencies (chain registry, gating experiments) are injected via ctx.
 */
export function createRpcUrlSelector(ctx: RpcUrlSelectorCtx): RpcUrlSelector {
  return (chainId: UniverseChainId, rpcType: RPCType = RPCType.Public): RpcConfig | null => {
    try {
      // Handle private RPC providers
      if (rpcType === RPCType.Private) {
        const privateRPCUrl = ctx.getChainInfo(chainId).rpcUrls[RPCType.Private]?.http[0]
        if (!privateRPCUrl) {
          throw new Error(`No private RPC available for chain ${chainId}`)
        }

        if (chainId === UniverseChainId.Mainnet && ctx.getFlashbotsEnabled()) {
          return {
            rpcUrl: FLASHBOTS_RPC_URL,
            shouldUseFlashbots: true,
            flashbotsConfig: {
              refundPercent: ctx.getFlashbotsRefundPercent(),
              calldataHintsEnabled: ctx.getCalldataHintsEnabled(),
            },
          }
        }

        return { rpcUrl: privateRPCUrl }
      }

      // Handle public RPC providers
      try {
        const publicRPCUrl = ctx.getChainInfo(chainId).rpcUrls[RPCType.Public]?.http[0]
        if (publicRPCUrl) {
          return { rpcUrl: publicRPCUrl, fallbackRpcUrls: collectFallbackRpcUrls(ctx, chainId, publicRPCUrl) }
        }
        throw new Error(`No public RPC available for chain ${chainId}`)
      } catch (error) {
        // Fall back to alternative public RPC URL if available
        const altPublicRPCUrl = ctx.getChainInfo(chainId).rpcUrls[RPCType.PublicAlt]?.http[0]
        if (altPublicRPCUrl) {
          return { rpcUrl: altPublicRPCUrl, fallbackRpcUrls: collectFallbackRpcUrls(ctx, chainId, altPublicRPCUrl) }
        }
        throw error
      }
    } catch (error) {
      logger.error(error, {
        tags: { file: 'rpcUrlSelector', function: 'selectRpcUrl' },
        extra: { chainId, rpcType },
      })
      return null
    }
  }
}
