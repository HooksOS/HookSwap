/**
 * HookSwapPerps — self-service market factory + registry ABIs + deployed addresses.
 *
 * Minimal, hand-written ABIs matching the EXACT signatures of the deployed contracts
 * (`contracts/perps/src/factory/PerpMarketFactory.sol` + `MarketRegistry.sol` +
 * `OracleGuard.sol` struct). Consumed by `useCreateMarket` / `useMarkets` via wagmi's
 * `useReadContract(s)` / `useWriteContract`.
 *
 * FACTS-ONLY: every entry mirrors a real function / event / struct on the contract.
 *
 * Factory (`PerpMarketFactory`):
 *   • `createMarket(collateral, decimals, creator, feeRate, maxLeverage, marketId, tier,
 *     oracleCfg) payable returns (address market)` — permissionlessly launch an isolated
 *     perp market. `feeRate` is clamped to [MIN_FEE=2, MAX_FEE=15] bps; `maxLeverage` is
 *     value*1e4 (LEVERAGE_PRECISION), clamped to PLATFORM_MAX_LEVERAGE (20x). `marketId`
 *     is `keccak256(utf8Bytes(label))`. `tier` is MarketRegistry.Tier (0=CURATED,
 *     1=PERMISSIONLESS). `msg.value` must cover the on-chain `listingFee` (read below).
 *   • `listingFee() view returns (uint256)` — native listing fee forwarded to treasury.
 *   • `MarketCreated(market indexed, creator indexed, collateral indexed, marketId, tier,
 *     feeRate, maxLeverage)` — the deployed clone address is the first indexed topic.
 *
 * OracleGuard.OracleConfig (the `oracleCfg` tuple, exact field order):
 *   { bytes32 sourceType, address venue, address refFeed, uint256 maxDeviationBps,
 *     uint256 maxStaleness, uint256 minLiquidity, bool dualSourceRequired }
 *   The venue must be allowlisted in OracleGuard for its sourceType or createMarket reverts.
 *
 * Registry (`MarketRegistry`):
 *   • `marketCount() view returns (uint256)` — total markets registered.
 *   • `getMarkets(start, count) view returns (MarketInfo[])` — paginated directory read.
 *   • `markets(uint256) view returns (...)` — the public array getter (indexed access).
 *     MarketInfo = { address market, address creator, address collateral, bytes32 marketId,
 *       uint8 tier, uint8 status, uint256 createdAt }.
 */

import { UniverseChainId } from 'uniswap/src/features/chains/types'
import type { Address } from '~/chains'

/* ------------------------------------------------------------------ factory ABI */

export const perpMarketFactoryAbi = [
  {
    type: 'function',
    name: 'createMarket',
    stateMutability: 'payable',
    inputs: [
      { name: 'collateral', type: 'address' },
      { name: 'decimals', type: 'uint8' },
      { name: 'creator', type: 'address' },
      { name: 'feeRate', type: 'uint256' },
      { name: 'maxLeverage', type: 'uint256' },
      { name: 'marketId', type: 'bytes32' },
      { name: 'tier', type: 'uint8' },
      {
        name: 'oracleCfg',
        type: 'tuple',
        components: [
          { name: 'sourceType', type: 'bytes32' },
          { name: 'venue', type: 'address' },
          { name: 'refFeed', type: 'address' },
          { name: 'maxDeviationBps', type: 'uint256' },
          { name: 'maxStaleness', type: 'uint256' },
          { name: 'minLiquidity', type: 'uint256' },
          { name: 'dualSourceRequired', type: 'bool' },
        ],
      },
    ],
    outputs: [{ name: 'market', type: 'address' }],
  },
  {
    type: 'function',
    name: 'listingFee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'PLATFORM_MAX_LEVERAGE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MIN_FEE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MAX_FEE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    // Tier-aware creation bond (factory v3). createMarket requires
    // msg.value >= listingFee + minBond(tier). tier: 0=CURATED, 1=PERMISSIONLESS.
    type: 'function',
    name: 'minBond',
    stateMutability: 'view',
    inputs: [{ name: 'tier', type: 'uint8' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'MarketCreated',
    inputs: [
      { name: 'market', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'collateral', type: 'address', indexed: true },
      { name: 'marketId', type: 'bytes32', indexed: false },
      { name: 'tier', type: 'uint8', indexed: false },
      { name: 'feeRate', type: 'uint256', indexed: false },
      { name: 'maxLeverage', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
] as const

/* ------------------------------------------------------------------ registry ABI */

export const marketRegistryAbi = [
  {
    type: 'function',
    name: 'marketCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getMarkets',
    stateMutability: 'view',
    inputs: [
      { name: 'start', type: 'uint256' },
      { name: 'count', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'page',
        type: 'tuple[]',
        components: [
          { name: 'market', type: 'address' },
          { name: 'creator', type: 'address' },
          { name: 'collateral', type: 'address' },
          { name: 'marketId', type: 'bytes32' },
          { name: 'tier', type: 'uint8' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'markets',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [
      { name: 'market', type: 'address' },
      { name: 'creator', type: 'address' },
      { name: 'collateral', type: 'address' },
      { name: 'marketId', type: 'bytes32' },
      { name: 'tier', type: 'uint8' },
      { name: 'status', type: 'uint8' },
      { name: 'createdAt', type: 'uint256' },
    ],
  },
] as const

/* ------------------------------------------------------------------ feeRouter ABI (optional) */

export const feeRouterAbi = [
  {
    type: 'function',
    name: 'marketCreator',
    stateMutability: 'view',
    inputs: [{ name: 'market', type: 'address' }],
    outputs: [{ type: 'address' }],
  },
] as const

/* ------------------------------------------------------------------ deployed addresses */

/** The full self-service perps deployment on a chain (all addresses share one deploy). */
export interface PerpsFactoryDeployment {
  factory: Address
  registry: Address
  feeRouter: Address
  oracleGuard: Address
  paramGuard: Address
  /** Slashable creation-bond escrow (factory v3). */
  bondManager: Address
  /** Per-market insurance sub-accounts (factory v3). */
  insuranceHub: Address
  /** Default collateral offered in the wizard (WETH on the chain). */
  weth: Address
  /** Default Chainlink ETH/USD reference feed used by the default oracle config. */
  ethUsdRefFeed: Address
}

/**
 * Per-chain deployed HookSwapPerps factory suite. Sepolia (11155111) is the canonical
 * validation chain (mandatory-deploy-on-Sepolia-first rule) and is the ONLY chain with a
 * live deploy today. Other HookSwap chains are intentionally absent → the wizard renders an
 * honest "not deployed on this chain" state and prompts a switch to Sepolia. Do NOT invent
 * an address for a chain that hasn't been deployed.
 */
export const PERPS_FACTORY_ADDRESSES: Partial<Record<UniverseChainId, PerpsFactoryDeployment>> = {
  [UniverseChainId.Sepolia]: {
    // Factory v4 (guards WIRED into settle: oracle breaker + limit price + insurance
    // coverage) — SECURITY_REVIEW H-1/H-2/M-1 fix. See factory-sepolia.json → guardWiring.
    factory: '0xa1A8C5A2D5527abfD2E46F4FaCebC6BC00C1a79a',
    registry: '0xEDE278469694e951676973B7b9e193a98463DAC2',
    feeRouter: '0xfA91D73B30b719491109Ae1C3993620c813393A4',
    oracleGuard: '0x3d2ee857ae129688fa43e378dae85b60803bffd1',
    paramGuard: '0xa9ba33018a1238bf3a59f5cf6f25e7538b9a2d33',
    bondManager: '0x9146Eb0bcB3CF09bd7924787415595a182F07eE8',
    insuranceHub: '0xEAA01a0b3f31aBde9e72A779F9A79E12072e6048',
    weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
    ethUsdRefFeed: '0x694AA1769357215DE4FAC081bf1f309aDC325306',
  },
}

/** The chain the factory is canonically deployed + validated on (Sepolia). */
export const PERPS_FACTORY_HOME_CHAIN: UniverseChainId = UniverseChainId.Sepolia

/**
 * Deployed perps-factory suite for a chain, or `undefined` when it isn't deployed there
 * yet. Callers treat a missing deployment as an honest "not deployed" state.
 */
export function getPerpsFactoryDeployment(chainId?: number): PerpsFactoryDeployment | undefined {
  if (chainId === undefined) {
    return undefined
  }
  return PERPS_FACTORY_ADDRESSES[chainId as UniverseChainId]
}
