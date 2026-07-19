/**
 * HookSwapPerps — minimal PerpMarket read ABI for the trading desk.
 *
 * Hand-written to EXACTLY match the deployed `contracts/perps/src/factory/PerpMarket.sol`
 * signatures. Consumed by the engine hooks (usePlaceOrder / usePositions) via wagmi
 * `useReadContract(s)` for the on-chain surfaces the matching engine does NOT own:
 *   • `nonces(trader)`            — EIP-712 order nonce (replay guard).
 *   • `getUserBalance(trader)`    — deposited collateral (available / locked) → deposit guard.
 *   • `marketMaxLeverage()`       — per-market leverage cap (value * 1e4); 0 = unset.
 *   • `getTokenDecimals(token)`   — collateral decimals for honest amount formatting.
 *   • `tokenPrices(token)`        — current mark price (1e18) the matcher writes.
 *   • `getUserPairIds(trader)`    — pair ids the trader is long/short in.
 *   • `getPairedPosition(pairId)` — the on-chain PairedPosition struct.
 *   • `getUnrealizedPnL(pairId)`  — long/short uPnL (net of funding), in collateral units.
 *
 * FACTS-ONLY: every entry mirrors a real view function on the contract. The EIP-712
 * ORDER_TYPEHASH the signing flow reproduces is:
 *   Order(address trader,address token,bool isLong,uint256 size,uint256 leverage,
 *         uint256 price,uint256 deadline,uint256 nonce,uint8 orderType)
 * with domain ("HookSwapPerps","1") — see PerpMarket.sol:87-89 + constructor:286.
 */

export const perpMarketReadAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'trader', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getUserBalance',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'available', type: 'uint256' },
      { name: 'locked', type: 'uint256' },
    ],
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
    name: 'getTokenDecimals',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'tokenPrices',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getUserPairIds',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'getPairedPosition',
    stateMutability: 'view',
    inputs: [{ name: 'pairId', type: 'uint256' }],
    outputs: [
      {
        name: 'position',
        type: 'tuple',
        components: [
          { name: 'pairId', type: 'uint256' },
          { name: 'longTrader', type: 'address' },
          { name: 'shortTrader', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'size', type: 'uint256' },
          { name: 'entryPrice', type: 'uint256' },
          { name: 'longCollateral', type: 'uint256' },
          { name: 'shortCollateral', type: 'uint256' },
          { name: 'longLeverage', type: 'uint256' },
          { name: 'shortLeverage', type: 'uint256' },
          { name: 'openTime', type: 'uint256' },
          { name: 'lastFundingSettled', type: 'uint256' },
          { name: 'accFundingLong', type: 'int256' },
          { name: 'accFundingShort', type: 'int256' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getUnrealizedPnL',
    stateMutability: 'view',
    inputs: [{ name: 'pairId', type: 'uint256' }],
    outputs: [
      { name: 'longPnL', type: 'int256' },
      { name: 'shortPnL', type: 'int256' },
    ],
  },
] as const

/** PerpMarket.PositionStatus enum ordering (must match the contract). */
export enum PositionStatus {
  Active = 0,
  Closed = 1,
  Liquidated = 2,
}

/** PerpMarket.OrderType enum ordering (must match the contract). */
export enum OrderType {
  Market = 0,
  Limit = 1,
}

/** Price precision on the contract — every mark / entry / order price is value * 1e18. */
export const PRICE_PRECISION = 18

/** Order size precision — base-asset size is value * 1e18. */
export const SIZE_PRECISION = 18

/** LEVERAGE_PRECISION — order.leverage = value * 1e4. */
export const LEVERAGE_PRECISION = 10_000

/** Raw tuple shape decoded from `getPairedPosition`. */
export interface RawPairedPosition {
  pairId: bigint
  longTrader: string
  shortTrader: string
  token: string
  size: bigint
  entryPrice: bigint
  longCollateral: bigint
  shortCollateral: bigint
  longLeverage: bigint
  shortLeverage: bigint
  openTime: bigint
  lastFundingSettled: bigint
  accFundingLong: bigint
  accFundingShort: bigint
  status: number
}
