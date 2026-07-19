/**
 * Per-chain config for the HookSwap gateway-schema adapter.
 *
 * Maps the interface's two chain identifiers — the numeric EVM chainId AND the gateway GraphQL
 * `Chain` enum name (e.g. ROBINHOOD, ETHEREUM_SEPOLIA) — to the self-hosted v3-subgraph GraphQL
 * URL for that chain.
 *
 * Sources of truth:
 *   - Chain enum names: packages/api/src/clients/graphql/schema.graphql `enum Chain`.
 *   - chainIds + which chains HookSwap deploys on: HookSwap/CLAUDE.md LOCKED DECISIONS + trading-api-adapter/src/chains.ts.
 *   - Subgraph URL pattern + <chain> slugs: v3-subgraph/hookswap/SELF-HOST.md §4
 *     (`http://graph-node:8000/subgraphs/name/hookswap-v3-<chain>`).
 *
 * The interface sends operations keyed by the `Chain` enum (e.g. `topV3Pools(chain: ROBINHOOD ...)`),
 * so resolvers look chains up by enum name; the numeric chainId is used to read the SUBGRAPH_URL_<id>
 * env var and to emit the numeric `chainId` fields the interface expects where relevant.
 */

/** Gateway GraphQL `Chain` enum values HookSwap serves from its own subgraphs. */
export type GatewayChain =
  | 'ETHEREUM_SEPOLIA'
  | 'INK'
  | 'MEGAETH'
  | 'ROBINHOOD'
  | 'XLAYER'
  | 'HYPEREVM'
  | 'TEMPO'

export interface ChainConfig {
  chainId: number
  /** gateway GraphQL `Chain` enum name the interface uses in query variables. */
  gatewayChain: GatewayChain
  /** short slug used in the subgraph deployment name `hookswap-v3-<slug>` (SELF-HOST.md §4). */
  subgraphSlug: string
  /** env var carrying this chain's subgraph GraphQL URL. */
  subgraphEnvVar: string
  /**
   * Wrapped-native ERC-20 address (lowercase) for this chain. The v3-subgraph keys tokens by their
   * ERC-20 address and has NO entity for the native asset, so a native-token request is resolved
   * against the wrapped-native token (its USD price equals the native's). Undefined for chains with
   * no wrapped-native (e.g. Tempo, whose gas is paid in pathUSD) — native there stays `null`.
   * Sources: HookSwap/CLAUDE.md deploy table + trading-api-adapter/src/chains.ts.
   */
  wrappedNative?: string
  /**
   * Optional env var carrying an EVM JSON-RPC URL for this chain. Only used by `isV3SubgraphStale`
   * to read the chain head (`eth_blockNumber`) and compare it to the subgraph's indexed block. Left
   * unset means the staleness check degrades to `_meta.hasIndexingErrors` only (no head-lag signal).
   */
  rpcEnvVar: string
}

export const CHAINS: ChainConfig[] = [
  { chainId: 11155111, gatewayChain: 'ETHEREUM_SEPOLIA', subgraphSlug: 'sepolia', subgraphEnvVar: 'SUBGRAPH_URL_11155111', rpcEnvVar: 'RPC_URL_11155111', wrappedNative: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14' },
  { chainId: 57073, gatewayChain: 'INK', subgraphSlug: 'ink', subgraphEnvVar: 'SUBGRAPH_URL_57073', rpcEnvVar: 'RPC_URL_57073', wrappedNative: '0x4200000000000000000000000000000000000006' },
  { chainId: 4326, gatewayChain: 'MEGAETH', subgraphSlug: 'megaeth', subgraphEnvVar: 'SUBGRAPH_URL_4326', rpcEnvVar: 'RPC_URL_4326', wrappedNative: '0x4200000000000000000000000000000000000006' },
  { chainId: 4663, gatewayChain: 'ROBINHOOD', subgraphSlug: 'robinhood', subgraphEnvVar: 'SUBGRAPH_URL_4663', rpcEnvVar: 'RPC_URL_4663', wrappedNative: '0x4200000000000000000000000000000000000006' },
  { chainId: 196, gatewayChain: 'XLAYER', subgraphSlug: 'xlayer', subgraphEnvVar: 'SUBGRAPH_URL_196', rpcEnvVar: 'RPC_URL_196', wrappedNative: '0xe538905cf8410324e03a5a23c1c177a474d59b2b' },
  { chainId: 999, gatewayChain: 'HYPEREVM', subgraphSlug: 'hyperevm', subgraphEnvVar: 'SUBGRAPH_URL_999', rpcEnvVar: 'RPC_URL_999', wrappedNative: '0x5555555555555555555555555555555555555555' },
  { chainId: 4217, gatewayChain: 'TEMPO', subgraphSlug: 'tempo', subgraphEnvVar: 'SUBGRAPH_URL_4217', rpcEnvVar: 'RPC_URL_4217' },
]

const BY_CHAIN_ENUM = new Map<string, ChainConfig>(CHAINS.map((c) => [c.gatewayChain, c]))
const BY_CHAIN_ID = new Map<number, ChainConfig>(CHAINS.map((c) => [c.chainId, c]))

export function getChainByEnum(chain: string | undefined | null): ChainConfig | undefined {
  if (!chain) {
    return undefined
  }
  return BY_CHAIN_ENUM.get(chain)
}

export function getChainById(chainId: number): ChainConfig | undefined {
  return BY_CHAIN_ID.get(chainId)
}

/**
 * Resolve the subgraph GraphQL URL for a chain from env. Returns undefined if this chain has no
 * SUBGRAPH_URL_<id> configured — the caller then falls back to the upstream proxy (never fabricates).
 */
export function resolveSubgraphUrl(chain: ChainConfig): string | undefined {
  const url = process.env[chain.subgraphEnvVar]
  return url && url.trim().length > 0 ? url.trim() : undefined
}

/**
 * Resolve the EVM JSON-RPC URL for a chain from env, or undefined if none is configured. Used only
 * by the `isV3SubgraphStale` head-lag check; when undefined the check degrades to indexing-errors
 * only (never fabricates a head block).
 */
export function resolveRpcUrl(chain: ChainConfig): string | undefined {
  const url = process.env[chain.rpcEnvVar]
  return url && url.trim().length > 0 ? url.trim() : undefined
}

/** True if we have a subgraph URL configured for the given gateway Chain enum value. */
export function isSubgraphServeableChain(chain: string | undefined | null): boolean {
  const cfg = getChainByEnum(chain)
  return Boolean(cfg && resolveSubgraphUrl(cfg))
}
