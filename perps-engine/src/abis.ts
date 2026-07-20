// Minimal ABIs for the on-chain surface the engine touches.
// Source of truth: contracts/perps/src/factory/{PerpMarket,MarketRegistry}.sol.

// Order + MatchedPair tuple components (must match PerpMarket.Order / MatchedPair).
const ORDER_COMPONENTS = [
  { name: "trader", type: "address" },
  { name: "token", type: "address" },
  { name: "isLong", type: "bool" },
  { name: "size", type: "uint256" },
  { name: "leverage", type: "uint256" },
  { name: "price", type: "uint256" },
  { name: "deadline", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "orderType", type: "uint8" },
] as const;

const MATCHED_PAIR_COMPONENTS = [
  { name: "longOrder", type: "tuple", components: ORDER_COMPONENTS },
  { name: "longSignature", type: "bytes" },
  { name: "shortOrder", type: "tuple", components: ORDER_COMPONENTS },
  { name: "shortSignature", type: "bytes" },
  { name: "matchPrice", type: "uint256" },
  { name: "matchSize", type: "uint256" },
] as const;

const PAIRED_POSITION_COMPONENTS = [
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
  {
    type: "function",
    name: "settleBatch",
    stateMutability: "nonpayable",
    inputs: [{ name: "pairs", type: "tuple[]", components: MATCHED_PAIR_COMPONENTS }],
    outputs: [],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserBalance",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "available", type: "uint256" },
      { name: "locked", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getUserPairIds",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256[]" }],
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
    name: "getOrderHash",
    stateMutability: "view",
    inputs: [{ name: "order", type: "tuple", components: ORDER_COMPONENTS }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "getFilledAmount",
    stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "nextPairId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "marketMaxLeverage",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_LEVERAGE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "feeRate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "authorizedMatchers",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "bool" }],
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

// EIP-712 typed-data (must match PerpMarket ORDER_TYPEHASH + EIP712("HookSwapPerps","1")).
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

// Off-chain-only auth for DELETE /orders/:orderId. NOT an on-chain typehash — the
// engine recovers this to prove the caller owns the order before cancelling it.
// Signed over the SAME per-market domain as Order (verifyingContract = market), so a
// cancel sig is bound to one market. `orderId` is a unique single-use UUID, so a
// replayed sig only ever re-cancels that same (already-gone) order — idempotent.
export const EIP712_CANCEL_TYPES = {
  Cancel: [
    { name: "orderId", type: "string" },
    { name: "trader", type: "address" },
  ],
} as const;

// OracleGuard.getMarketConfig(market) — the on-chain per-market oracle config the
// factory registered at createMarket. We read `refFeed` (the Chainlink deviation
// reference feed) and use THAT feed as the engine's mark source, so the mark is the
// exact price the on-chain deviation breaker (checkDeviation) enforces.
// Source: contracts/perps/src/factory/OracleGuard.sol.
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
