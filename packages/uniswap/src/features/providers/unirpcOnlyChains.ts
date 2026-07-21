import { UniverseChainId } from 'uniswap/src/features/chains/types'

/**
 * Private/unlaunched chains whose only RPC access path is authenticated UniRPC —
 * access is gated at the entry gateway and there is no public fallback endpoint.
 *
 * These bypass the UniRpcEnabled feature flag (see the resolver wiring in
 * resolveRpcConfig.web.ts / .native.ts): when the flag is off the resolver would
 * otherwise fall back to the legacy chain-info URL, which for these chains points
 * at the gateway *without* session auth (no cookie on web; no X-Session-ID /
 * X-Device-ID headers on extension/native) and is rejected with a 401.
 *
 * Removable once these chains launch and have public RPC endpoints.
 */
const UNIRPC_ONLY_CHAINS: ReadonlySet<UniverseChainId> = new Set([UniverseChainId.Arc])

export function isUniRpcOnlyChain(chainId: UniverseChainId): boolean {
  return UNIRPC_ONLY_CHAINS.has(chainId)
}

/**
 * The inverse of UNIRPC_ONLY_CHAINS: chains that must NEVER route browser-side
 * on-chain reads through Uniswap's UniRPC entry gateway, and must always use the
 * public RPC URL in their chain-info instead.
 *
 * HookSwap ships on chains that have a real, working public RPC but has NO
 * Uniswap-hosted UniRPC gateway session (no cookie on web; no session/device
 * headers on native/extension). The upstream web resolver forces UniRPC for
 * *every* chain (see resolveRpcConfig.web.ts `getFeatureFlag: () => !isE2eTestEnv()`),
 * so without this carve-out every browser read for these chains hits the gateway
 * and 401s/CORS-fails — which silently broke Robinhood swap balances ("Bal —")
 * and Locker/Referrals ("Failed to load") even though the contracts + public RPC
 * work fine directly (verified via `cast call`).
 *
 * Listing a chain here makes the resolver skip UniRPC and fall through to the
 * chain-info Public RPC (e.g. https://rpc.mainnet.chain.robinhood.com), which is
 * never promoted back to UniRPC by `asUniRpcConfig` (it isn't an entry-gateway URL).
 *
 * Sepolia is included because it is HookSwapPerps' canonical chain: its browser reads
 * (MarketRegistry directory, per-market listing fee / bond, balances, positions) all
 * 401/CORS-failed through the gateway — the "Couldn't read the market registry" state.
 * Unlike Robinhood, Sepolia's Public RPC previously WAS the gateway URL, so it also needed
 * a real public endpoint (see mainnet.ts Sepolia rpcUrls[Public]).
 *
 * NOTE: the other HookSwap custom chains (Ink/HyperEVM/XLayer/MegaETH/Tempo) have the same
 * gateway-less situation and are candidates to add here if they exhibit it too.
 */
const PUBLIC_RPC_ONLY_CHAINS: ReadonlySet<UniverseChainId> = new Set([
  UniverseChainId.Robinhood,
  UniverseChainId.Sepolia,
])

export function isPublicRpcOnlyChain(chainId: UniverseChainId): boolean {
  return PUBLIC_RPC_ONLY_CHAINS.has(chainId)
}
