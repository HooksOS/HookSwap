/**
 * Shared chain types for the HookSwap AI Knowledge Platform.
 *
 * These mirror the DEX's `contracts/deployments/<chain>.json` shape so the chain registry
 * (`packages/chains`) can be a typed, config-extensible source of truth. NOTHING here is
 * fabricated — the concrete values live in `packages/chains/src/chains.ts`, sourced from the
 * real on-chain deployments.
 */

/** Numeric EVM chain id. Kept as a plain number so config can add unlimited chains. */
export type ChainId = number

/** The HookSwap-owned v2 + v3 + Universal Router stack deployed on a chain. */
export interface ContractSet {
  weth9: string
  permit2: string
  v2Factory: string
  v2Router02: string
  v2PairInitCodeHash: string
  v3Factory: string
  v3QuoterV2?: string
  swapRouter02?: string
  nonfungiblePositionManager?: string
  tickLens?: string
  v3Migrator?: string
  v3Staker?: string
  multicall2?: string
  poolInitCodeHash?: string
  universalRouter?: string
  /** Block the v3 factory was deployed at — start block for `PoolCreated` log scans. */
  v3DeployBlock?: number
}

/** Static, verified token metadata (never invented). */
export interface TokenInfo {
  address: string
  symbol: string
  name: string
  decimals: number
}

/** How a chain's gas is denominated. Most chains are native; some (Tempo) use an ERC-20. */
export type GasModel = 'native' | 'erc20'

/** A canonical chain definition. Extensible by config — add a chain by adding one of these. */
export interface ChainConfig {
  chainId: ChainId
  /** machine key, lowercase, stable (e.g. `robinhood`). Matches deployments filename. */
  key: string
  /** human display name (e.g. `Robinhood`). */
  name: string
  /** env var read for the RPC URL; falls back to `publicRpc`. */
  rpcEnvVar: string
  publicRpc: string
  /** optional websocket RPC for live event subscription. */
  publicWsRpc?: string
  /** user-facing block explorer base URL (no trailing slash). */
  explorerUrl: string
  /** native currency of the chain. */
  native: {
    symbol: string
    name: string
    decimals: number
  }
  gasModel: GasModel
  /** wrapped-native token; `null` when the chain has no wrapped-native at the interface layer (Tempo). */
  wrappedNative: TokenInfo | null
  /** the chain's canonical USD stablecoin (the USD price anchor). Only when on-chain-verified. */
  stablecoin?: TokenInfo
  /** deployed HookSwap contract stack. */
  contracts: ContractSet
  /** additional known-real tokens (e.g. a chain's seeded test token). Verified metadata only. */
  seededTokens?: TokenInfo[]
  /** true = primary/production chain; Sepolia is the mandatory validation chain. */
  role: 'primary' | 'secondary' | 'validation'
  /** whether HookSwap has this chain live for trading. */
  live: boolean
  testnet: boolean
}
