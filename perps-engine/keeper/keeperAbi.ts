// Minimal, SELF-CONTAINED ABIs for the keeper's on-chain surface.
//
// Deliberately duplicated (not imported from ../src) so the keeper stays decoupled
// from the concurrently-edited engine `src/*` tree. Source of truth:
//   contracts/perps/src/factory/{PerpMarket,MarketRegistry,OracleGuard}.sol
// These fragments must match those contracts exactly.

// --- PerpMarket PairedPosition tuple (15 fields, order-sensitive) ---
export const PAIRED_POSITION_COMPONENTS = [
  { name: "pairId", type: "uint256" },
  { name: "longTrader", type: "address" },
  { name: "shortTrader", type: "address" },
  { name: "token", type: "address" },
  { name: "size", type: "uint256" },
  { name: "entryPrice", type: "uint256" },
  { name: "longCollateral", type: "uint256" },
  { name: "shortCollateral", type: "uint256" },
  { name: "longLeverage", type: "uint256" },
  { name: "shortLeverage", type: "uint256" },
  { name: "openTime", type: "uint256" },
  { name: "lastFundingSettled", type: "uint256" },
  { name: "accFundingLong", type: "int256" },
  { name: "accFundingShort", type: "int256" },
  { name: "status", type: "uint8" },
] as const;

export const PERP_MARKET_ABI = [
  // ---- reads ----
  {
    type: "function",
    name: "nextPairId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getPairedPosition",
    stateMutability: "view",
    inputs: [{ name: "pairId", type: "uint256" }],
    outputs: [{ type: "tuple", components: PAIRED_POSITION_COMPONENTS }],
  },
  {
    type: "function",
    name: "canLiquidate",
    stateMutability: "view",
    inputs: [{ name: "pairId", type: "uint256" }],
    outputs: [
      { name: "liquidateLong", type: "bool" },
      { name: "liquidateShort", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getUnrealizedPnL",
    stateMutability: "view",
    inputs: [{ name: "pairId", type: "uint256" }],
    outputs: [
      { name: "longPnL", type: "int256" },
      { name: "shortPnL", type: "int256" },
    ],
  },
  {
    type: "function",
    name: "tokenPrices",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "authorizedMatchers",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "FUNDING_INTERVAL",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  // ---- writes ----
  {
    type: "function",
    name: "liquidate",
    stateMutability: "nonpayable",
    inputs: [{ name: "pairId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settleFundingBatch",
    stateMutability: "nonpayable",
    inputs: [{ name: "pairIds", type: "uint256[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "updatePrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setAuthorizedMatcher",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matcher", type: "address" },
      { name: "authorized", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export const MARKET_REGISTRY_ABI = [
  {
    type: "function",
    name: "marketCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getMarkets",
    stateMutability: "view",
    inputs: [
      { name: "start", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "market", type: "address" },
          { name: "creator", type: "address" },
          { name: "collateral", type: "address" },
          { name: "marketId", type: "bytes32" },
          { name: "tier", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "createdAt", type: "uint256" },
        ],
      },
    ],
  },
] as const;

// OracleGuard.getMarketConfig(market) — we read `refFeed` (Chainlink deviation
// reference) and use THAT feed as the market's mark source, so the keeper's mark
// is exactly the price the on-chain deviation breaker (checkDeviation) enforces.
const ORACLE_CONFIG_COMPONENTS = [
  { name: "sourceType", type: "bytes32" },
  { name: "venue", type: "address" },
  { name: "refFeed", type: "address" },
  { name: "maxDeviationBps", type: "uint256" },
  { name: "maxStaleness", type: "uint256" },
  { name: "minLiquidity", type: "uint256" },
  { name: "dualSourceRequired", type: "bool" },
] as const;

export const ORACLE_GUARD_ABI = [
  {
    type: "function",
    name: "getMarketConfig",
    stateMutability: "view",
    inputs: [{ name: "market", type: "address" }],
    outputs: [{ type: "tuple", components: ORACLE_CONFIG_COMPONENTS }],
  },
] as const;

// Chainlink AggregatorV3 — the market's reference feed.
export const CHAINLINK_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

// EIP-712 typed-data (must match PerpMarket ORDER_TYPEHASH + EIP712("HookSwapPerps","1")).
// Used ONLY by the one-off liquidation-proof script (keeper/scripts/forceLiquidation.ts).
export const EIP712_ORDER_TYPES = {
  Order: [
    { name: "trader", type: "address" },
    { name: "token", type: "address" },
    { name: "isLong", type: "bool" },
    { name: "size", type: "uint256" },
    { name: "leverage", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "orderType", type: "uint8" },
  ],
} as const;
export const EIP712_DOMAIN_NAME = "HookSwapPerps";
export const EIP712_DOMAIN_VERSION = "1";

export interface OnchainPosition {
  pairId: bigint;
  longTrader: `0x${string}`;
  shortTrader: `0x${string}`;
  token: `0x${string}`;
  size: bigint;
  entryPrice: bigint;
  longCollateral: bigint;
  shortCollateral: bigint;
  longLeverage: bigint;
  shortLeverage: bigint;
  openTime: bigint;
  lastFundingSettled: bigint;
  accFundingLong: bigint;
  accFundingShort: bigint;
  status: number; // 0 ACTIVE, 1 CLOSED, 2 LIQUIDATED
}
