// Engine domain types.

export enum OrderType {
  MARKET = 0,
  LIMIT = 1,
}

/** A signed order exactly as the contract's Order struct expects (bigints). */
export interface Order {
  trader: `0x${string}`;
  token: `0x${string}`;
  isLong: boolean;
  size: bigint; // base units, contract precision (1e18)
  leverage: bigint; // leverage * 1e4 (LEVERAGE_PRECISION)
  price: bigint; // quote-per-base * 1e18
  deadline: bigint; // unix seconds
  nonce: bigint;
  orderType: OrderType;
}

export interface StoredOrder {
  orderId: string;
  market: `0x${string}`;
  order: Order;
  signature: `0x${string}`;
  /** Unfilled size remaining (base units). */
  remaining: bigint;
  status: "open" | "matched" | "cancelled";
  receivedAt: number;
}

export interface Trade {
  market: `0x${string}`;
  longTrader: `0x${string}`;
  shortTrader: `0x${string}`;
  token: `0x${string}`;
  matchPrice: bigint;
  matchSize: bigint;
  /** On-chain settle tx hash when LIVE_SETTLE, else null (simulate-only). */
  txHash: `0x${string}` | null;
  /** true when settlement (send or simulate) succeeded. */
  settled: boolean;
  reason?: string;
  /** Assembled settleBatch([pair]) calldata for this fill (observability). */
  calldata?: `0x${string}`;
  ts: number;
}

/** A crossed long+short pair ready for settleBatch. */
export interface MatchedPair {
  longOrder: Order;
  longSignature: `0x${string}`;
  shortOrder: Order;
  shortSignature: `0x${string}`;
  matchPrice: bigint;
  matchSize: bigint;
}

export interface MarketMeta {
  market: `0x${string}`;
  marketId: `0x${string}`;
  collateral: `0x${string}`;
  tier: number; // 0 CURATED, 1 PERMISSIONLESS
  status: number; // 0 ACTIVE, 1 PAUSED, 2 DELISTED
  /** On-chain per-market leverage cap (*1e4); 0 = unset -> MAX_LEVERAGE. */
  marketMaxLeverage: bigint;
  maxLeverageAbs: bigint; // MAX_LEVERAGE constant (*1e4)
}
