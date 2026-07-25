import { getEntryGatewayUrl, provideDeviceIdService, provideSessionStorage } from '@universe/api'
import { createRpcConfigResolver, createUniRpcConfigResolver, type RpcConfig } from '@universe/chains'
import { isExtensionApp, REQUEST_SOURCE } from '@universe/environment'
import { FeatureFlags, getFeatureFlag, isStatsigClientRegistered } from '@universe/gating'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { RPCType, type UniverseChainId } from 'uniswap/src/features/chains/types'
import { selectRpcUrl } from 'uniswap/src/features/providers/rpcUrlSelector'
import { isPublicRpcOnlyChain, isUniRpcOnlyChain } from 'uniswap/src/features/providers/unirpcOnlyChains'

export { createRpcConfigResolver } from '@universe/chains'
export type { RpcConfigResolver, RpcConfigResolverInput } from '@universe/chains'

/**
 * Convenience resolver for call sites that can't receive deps via injection.
 * Prefer ProviderManager for provider access — this exists for the edge cases.
 *
 * This file ships to both the web app (Vite) and the browser extension (WXT).
 * The two diverge in session strategy:
 *   - Web app: cookie-based — UniRPC reuses the browser's session cookie via
 *     `credentials: 'include'`, so no per-request header construction is needed.
 *   - Extension: header-based — extensions can't share the web app's cookie jar,
 *     so each request resolves a session/device header pair.
 *
 * Mobile uses the `.native.ts` sibling.
 */
const SHARED_UNI_RPC_CONFIG = {
  // UniRPC-only chains (Arc/Robinhood) always route through UniRPC; everything
  // else is flag-gated. Saga init runs before the Statsig provider mounts; guard
  // so the flag read doesn't trigger StatsigClient.instance()'s broken-fallback
  // branch.
  getFeatureFlag: (chainId: UniverseChainId) =>
    // Public-RPC-only chains (HookSwap chains with a working public RPC and no
    // UniRPC gateway auth — e.g. Robinhood) must never route through UniRPC.
    !isPublicRpcOnlyChain(chainId) &&
    (isUniRpcOnlyChain(chainId) || (isStatsigClientRegistered() && getFeatureFlag(FeatureFlags.UniRpcEnabled))),
  getEntryGatewayUrl,
  requestSource: REQUEST_SOURCE,
} as const

const webResolveUniRpcConfig = createUniRpcConfigResolver({
  ...SHARED_UNI_RPC_CONFIG,
  // HookSwap dedupe (2026-07): the web app NEVER routes browser RPC through
  // Uniswap's UniRPC entry gateway (entry-gateway.backend-prod.api.uniswap.org/rpc/*).
  // HookSwap has no UniRPC gateway session at all, so every /rpc/* call CORS-fails
  // (mainnet/BSC/Base/Arbitrum/etc. were all hitting the gateway because they were
  // not in PUBLIC_RPC_ONLY_CHAINS). Returning false here forces EVERY chain onto the
  // legacy chain-info path, and `selectHookSwapLegacyRpcUrl` (below) then guarantees
  // that path never returns a gateway URL either. Result: zero requests to
  // *.uniswap.org for on-chain reads.
  getFeatureFlag: () => false,
  credentials: 'include',
})

// HookSwap dedupe: for canonical Uniswap chains (mainnet/base/bnb/arbitrum/optimism/
// polygon/…) the chain-info `RPCType.Public` slot is literally the UniRPC gateway URL
// (`getUniRpcEndpointUrl` -> `${entryGateway}/rpc/{id}`). So even with UniRPC disabled
// above, the legacy fall-through would hand that gateway URL straight back — and
// `asUniRpcConfig` would re-promote it to an authenticated UniRPC call. This wrapper
// detects a gateway URL and substitutes the chain's real public endpoint (Default ->
// PublicAlt -> Fallback -> Interface), so NO on-chain read ever reaches uniswap.org.
// HookSwap's own chains already carry a real public RPC in their Public slot, so this
// is a no-op for them.
const GATEWAY_RPC_PREFIX = `${getEntryGatewayUrl()}/rpc/`

const selectHookSwapLegacyRpcUrl = (chainId: UniverseChainId, rpcType: RPCType): RpcConfig | null => {
  const config = selectRpcUrl(chainId, rpcType)
  if (!config || !config.rpcUrl.startsWith(GATEWAY_RPC_PREFIX)) {
    return config
  }
  const info = getChainInfo(chainId)
  const candidates = [
    ...(info.rpcUrls[RPCType.Default]?.http ?? []),
    ...(info.rpcUrls[RPCType.PublicAlt]?.http ?? []),
    ...(info.rpcUrls[RPCType.Fallback]?.http ?? []),
    ...(info.rpcUrls[RPCType.Interface]?.http ?? []),
  ]
  const publicUrl = candidates.find((url) => url && !url.startsWith(GATEWAY_RPC_PREFIX))
  return publicUrl ? { ...config, rpcUrl: publicUrl } : null
}

// Extension is header-based (can't share the web origin's cookie jar).
const resolveExtensionUniRpcHeaders = async (): Promise<Record<string, string>> => {
  const [session, deviceId] = await Promise.all([provideSessionStorage().get(), provideDeviceIdService().getDeviceId()])
  return {
    ...(session?.sessionId && { 'X-Session-ID': session.sessionId }),
    ...(deviceId && { 'X-Device-ID': deviceId }),
  }
}

const extensionResolveUniRpcConfig = createUniRpcConfigResolver({
  ...SHARED_UNI_RPC_CONFIG,
  getRequestHeaders: resolveExtensionUniRpcHeaders,
})

// Public RPCs now point at the entry gateway; when the legacy path returns one,
// authenticate it the same way the primary path does — cookie on web, header on extension.
const asUniRpcConfig = (config: RpcConfig): RpcConfig => {
  if (!config.rpcUrl.startsWith(`${getEntryGatewayUrl()}/rpc/`)) {
    return config
  }
  const promoted: RpcConfig = {
    ...config,
    isUniRpc: true,
    headers: { 'x-request-source': REQUEST_SOURCE, ...config.headers },
  }
  return isExtensionApp
    ? { ...promoted, getRequestHeaders: resolveExtensionUniRpcHeaders }
    : { ...promoted, credentials: 'include' }
}

export const defaultResolveRpcConfig = createRpcConfigResolver({
  resolveUniRpcConfig: isExtensionApp ? extensionResolveUniRpcConfig : webResolveUniRpcConfig,
  // Extension keeps the raw selector (still session-gated via SHARED_UNI_RPC_CONFIG);
  // the web app uses the gateway-stripping wrapper so no legacy fall-through can hit
  // *.uniswap.org.
  selectLegacyRpcUrl: isExtensionApp ? selectRpcUrl : selectHookSwapLegacyRpcUrl,
  asUniRpcConfig,
})
