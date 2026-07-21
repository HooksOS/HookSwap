/**
 * Normalized on-chain entities produced by the blockchain indexer.
 *
 * These are the CANONICAL shapes stored in Postgres (see `ingestion/chain_indexer/schema/`)
 * and served live to the RAG live-stats tool. They mirror what the DEX's data-api actually
 * derives (pools, tokens, reserves→TVL, swap flow→volume, v2 0.30% fee→APR, wallet activity)
 * so the AI's "live stats" reflect reality and are NEVER fabricated.
 *
 * Big integers (amounts, reserves, liquidity) are DECIMAL STRINGS — never JS `number` — to
 * preserve uint112/uint256 precision. Human/USD-derived numbers are `number` and left
 * `undefined` when they cannot be sourced truthfully.
 */

export type ProtocolKind = 'v2' | 'v3'

/** A normalized ERC-20 token as observed on-chain. */
export interface IndexedToken {
  chainId: number
  address: string // lowercased
  symbol: string
  name: string
  decimals: number
  /** true for the chain's wrapped-native. */
  isWrappedNative: boolean
  /** true for the chain's canonical USD stablecoin (the price anchor). */
  isStablecoin: boolean
  /** last time metadata was read on-chain (ISO-8601). */
  firstSeenAt: string
  updatedAt: string
}

/** A normalized liquidity pool (v2 pair or v3 pool). */
export interface IndexedPool {
  chainId: number
  address: string // lowercased pool/pair address
  protocol: ProtocolKind
  token0: string
  token1: string
  /** v3 only: fee tier in pips (e.g. 3000 = 0.30%). v2 pools use the fixed 3000. */
  feeTier: number
  /** block the pool was created at. */
  createdBlock: number
  createdAt: string
  // --- live-derived (from reserves / recent swaps); undefined when unsourceable ---
  reserve0?: string
  reserve1?: string
  /** v3 only: current in-range liquidity (uint128 decimal string). */
  liquidity?: string
  /** v3 only: current sqrtPriceX96. */
  sqrtPriceX96?: string
  /** v3 only: current tick. */
  tick?: number
  /** price of token0 in token1 (decimal-adjusted), native-denominated, from reserves/slot0. */
  spotPrice?: number
  /** full-pool USD TVL (both sides), when a USD anchor exists. */
  tvlUsd?: number
  /** 24h USD swap volume, when a USD anchor exists. */
  volume24hUsd?: number
  /** 24h fee revenue USD = volume24hUsd * feeTier/1e6. */
  fees24hUsd?: number
  /** fee APR percent = (fees24hUsd * 365 / tvlUsd) * 100. */
  aprPercent?: number
  updatedAt: string
}

/** A normalized swap event. */
export interface IndexedSwap {
  chainId: number
  pool: string
  protocol: ProtocolKind
  blockNumber: number
  logIndex: number
  txHash: string
  /** the pair caller (usually router). */
  sender: string
  /** swap output recipient (Swap.to). */
  recipient: string
  /** tx-origin EOA (the real trader wallet), '' when unresolved. Never fabricated. */
  origin: string
  amount0In: string
  amount1In: string
  amount0Out: string
  amount1Out: string
  /** USD notional of the swap when a USD anchor exists. */
  amountUsd?: number
  timestamp: number // unix seconds
}

/** A reserve snapshot (v2 Sync / v3 slot0+liquidity) — powers TVL + price history. */
export interface IndexedReserveSnapshot {
  chainId: number
  pool: string
  blockNumber: number
  logIndex: number
  reserve0: string
  reserve1: string
  /** v3 liquidity, when applicable. */
  liquidity?: string
  timestamp: number
}

/** A normalized liquidity event (mint/burn = add/remove liquidity). */
export interface IndexedLiquidityEvent {
  chainId: number
  pool: string
  protocol: ProtocolKind
  kind: 'mint' | 'burn'
  blockNumber: number
  logIndex: number
  txHash: string
  provider: string
  amount0: string
  amount1: string
  /** LP tokens minted/burned (v2) or liquidity delta (v3). */
  liquidity: string
  /** v3 concentrated range. */
  tickLower?: number
  tickUpper?: number
  timestamp: number
}

/** A v3 concentrated-liquidity position (NFT). */
export interface IndexedPosition {
  chainId: number
  /** NonfungiblePositionManager token id. */
  tokenId: string
  owner: string
  pool: string
  token0: string
  token1: string
  feeTier: number
  tickLower: number
  tickUpper: number
  liquidity: string
  /** true when tickLower <= currentTick < tickUpper. */
  inRange?: boolean
  depositedToken0?: string
  depositedToken1?: string
  updatedAt: string
}

/** Aggregated wallet trading activity (leaderboard / portfolio). */
export interface IndexedWalletActivity {
  chainId: number
  wallet: string
  swapCount: number
  /** total USD volume across swaps, when sourceable. */
  volumeUsd?: number
  firstSeen: number
  lastSeen: number
}

/** A cross-chain bridge transfer observed on-chain (deposit/withdraw). */
export interface IndexedBridgeTransfer {
  /** the chain the event was observed on. */
  chainId: number
  /** counterparty chain, when derivable from the event. */
  counterpartyChainId?: number
  direction: 'in' | 'out'
  bridge: string // bridge/router contract address
  token: string
  amount: string
  from: string
  to: string
  blockNumber: number
  logIndex: number
  txHash: string
  timestamp: number
}

/** A generic decoded contract event (for anything beyond the typed entities above). */
export interface IndexedEvent {
  chainId: number
  address: string
  eventName: string
  blockNumber: number
  logIndex: number
  txHash: string
  /** decoded args as string-serialized values (bigints as decimal strings). */
  args: Record<string, string>
  timestamp: number
}

/** Chain-level rollup — the top-line stats the AI reports per chain. */
export interface ChainStatsSnapshot {
  chainId: number
  poolCount: number
  tokenCount: number
  swaps24h: number
  tvlUsd?: number
  volume24hUsd?: number
  fees24hUsd?: number
  /** USD price of the native token, from the chain's stablecoin anchor pool. */
  usdPerNative?: number
  /** highest block indexed so far. */
  headBlock: number
  updatedAt: string
}

/** Per-pool, per-chain ingest cursor (last fully scanned block). */
export interface IndexCursor {
  chainId: number
  scope: string // e.g. `pool:0xabc` or `factory:v3` or `blocks`
  lastBlock: number
}
