/**
 * HookSwapPerps — ADMIN panel ABIs + constants.
 *
 * Minimal, hand-written ABIs that mirror the EXACT signatures of the deployed perps
 * governance contracts (`contracts/perps/src/factory/{OracleGuard,MarketRegistry,
 * BondManager,ParamGuard,FeeRouter,PerpMarket}.sol`). Two uses:
 *
 *   1. READ surface — batched `useReadContracts` multicalls render live on-chain state
 *      (markets, oracle allowlist, param bounds, bonds, insurance, fee config). Facts only.
 *   2. WRITE fragments — the owner-only functions the panel encodes into Gnosis Safe
 *      Transaction-Builder batches. The panel NEVER sends these; it only encodes calldata
 *      (`to`/`value`/`data`) for the treasury Safe to sign. Every write fragment below is
 *      an `onlyOwner` function verified against the contract source.
 *
 * The owner of every perps contract is the treasury Gnosis Safe (multisig). So an admin
 * action = a Safe batch the panel generates; the real gate is the Safe's owner signatures.
 */

/* ------------------------------------------------------------------ treasury Safe */

/**
 * HookSwap treasury / owner / fee-receiver Gnosis Safe. Owner of every perps contract
 * (factory, registry, oracleGuard, paramGuard, bondManager, insuranceHub, feeRouter, and
 * every market clone). The admin panel reads its `getOwners()` to gate the UI and targets
 * its address as the `chainId` of every generated Safe batch. Same address on every chain
 * (canonical CREATE2 Safe). Verified: memory `treasury-wallet.md` + perps factory configs.
 */
export const HOOKSWAP_TREASURY_SAFE = '0x011d438E3eb3fce848950859591ec037C6529E13' as const

/* ------------------------------------------------------------------ Gnosis Safe (gate) */

/** Minimal Gnosis Safe read surface — the owner allowlist + signature threshold. */
export const safeAbi = [
  {
    type: 'function',
    name: 'getOwners',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getThreshold',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

/* ------------------------------------------------------------------ OracleGuard */

/**
 * OracleGuard read + the `setVenue` allowlist write. `allowedVenue(sourceType, venue)` is
 * the public mapping getter; `getMarketConfig(market)` returns a market's stored config.
 */
export const oracleGuardAdminAbi = [
  {
    type: 'function',
    name: 'allowedVenue',
    stateMutability: 'view',
    inputs: [
      { name: 'sourceType', type: 'bytes32' },
      { name: 'venue', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'factory',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'minLiquidity',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'getMarketConfig',
    stateMutability: 'view',
    inputs: [{ name: 'market', type: 'address' }],
    outputs: [
      {
        name: 'cfg',
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
  },
  // ---- WRITE (onlyOwner) ----
  {
    type: 'function',
    name: 'setVenue',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sourceType', type: 'bytes32' },
      { name: 'venue', type: 'address' },
      { name: 'allowed', type: 'bool' },
    ],
    outputs: [],
  },
] as const

/* ------------------------------------------------------------------ MarketRegistry */

/** MarketRegistry — the `setStatus` kill switch (0=ACTIVE, 1=PAUSED, 2=DELISTED). */
export const marketRegistryAdminAbi = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  // ---- WRITE (onlyOwner) ----
  {
    type: 'function',
    name: 'setStatus',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'market', type: 'address' },
      { name: 'status', type: 'uint8' },
    ],
    outputs: [],
  },
] as const

/* ------------------------------------------------------------------ BondManager */

/** BondManager — per-market bond escrow reads + the `slash` seizure write. */
export const bondManagerAdminAbi = [
  {
    type: 'function',
    name: 'bondOf',
    stateMutability: 'view',
    inputs: [{ name: 'market', type: 'address' }],
    outputs: [
      {
        name: 'bond',
        type: 'tuple',
        components: [
          { name: 'creator', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'postedAt', type: 'uint64' },
          { name: 'slashed', type: 'bool' },
          { name: 'withdrawn', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'treasury',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'withdrawDelay',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalBondsHeld',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  // ---- WRITE (onlyOwner) ----
  {
    type: 'function',
    name: 'slash',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'market', type: 'address' }],
    outputs: [],
  },
] as const

/* ------------------------------------------------------------------ ParamGuard */

/** ParamGuard — governance leverage/fee/margin bounds read + `setBounds` write. */
export const paramGuardAdminAbi = [
  {
    type: 'function',
    name: 'getBounds',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: 'bounds',
        type: 'tuple',
        components: [
          { name: 'maxLeverage', type: 'uint256' },
          { name: 'minMaintenanceMarginBps', type: 'uint256' },
          { name: 'minFeeBps', type: 'uint256' },
          { name: 'maxFeeBps', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  // ---- WRITE (onlyOwner) ----
  {
    type: 'function',
    name: 'setBounds',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_maxLeverage', type: 'uint256' },
      { name: '_minMaintenanceMarginBps', type: 'uint256' },
      { name: '_minFeeBps', type: 'uint256' },
      { name: '_maxFeeBps', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

/* ------------------------------------------------------------------ FeeRouter */

/** FeeRouter — platform/creator/insurance split reads + `setShares` / `setSinks` writes. */
export const feeRouterAdminAbi = [
  {
    type: 'function',
    name: 'platformShareBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'creatorShareBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'platformFloorBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'treasury',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'insuranceHub',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  // ---- WRITE (onlyOwner) ----
  {
    type: 'function',
    name: 'setShares',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_platformBps', type: 'uint256' },
      { name: '_creatorBps', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setSinks',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_treasury', type: 'address' },
      { name: '_insuranceHub', type: 'address' },
    ],
    outputs: [],
  },
] as const

/* ------------------------------------------------------------------ InsuranceHub */

/** InsuranceHub — per-market insurance sub-account balance read (`balanceOf[market][token]`). */
export const insuranceHubAdminAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'market', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

/* ------------------------------------------------------------------ PerpMarket (per-market) */

/**
 * PerpMarket (per-market Settlement clone) — the per-market fee config reads + the three
 * per-market owner writes (`setFeeRate`, `setFeeReceiver`, `setInsuranceFund`). The `to` of
 * these Safe batches is a specific market clone address, NOT a shared contract.
 */
export const perpMarketAdminAbi = [
  {
    type: 'function',
    name: 'feeRate',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'feeReceiver',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'insuranceFund',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'marketMaxLeverage',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  // ---- WRITE (onlyOwner) ----
  {
    type: 'function',
    name: 'setFeeRate',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_feeRate', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setFeeReceiver',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_feeReceiver', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setInsuranceFund',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_insuranceFund', type: 'address' }],
    outputs: [],
  },
] as const

/* ------------------------------------------------------------------ PerpMarketFactory */

/** Factory fee/bond config reads (listingFee + tier-aware minBond). */
export const factoryAdminAbi = [
  {
    type: 'function',
    name: 'listingFee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'minBond',
    stateMutability: 'view',
    inputs: [{ name: 'tier', type: 'uint8' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

// The canonical Chainlink source-type label (`keccak256(utf8Bytes("chainlink"))`) used by the
// oracle allowlist reads/writes is re-exported from the factory hook — single source of truth.
export { CHAINLINK_SOURCE_TYPE } from '~/terminal/perps/factory/useCreateMarket'
