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

/**
 * PerpMarket WRITE ABI — the collateral entry/exit functions the desk needs.
 *
 * Matches `contracts/perps/src/factory/PerpMarket.sol` EXACTLY:
 *   • `depositETH() payable`            — wrap msg.value → WETH, credit `available` (no approval).
 *   • `deposit(address token,uint256)`  — pull ERC-20 `amount` (native decimals) → credit `available`.
 *   • `withdraw(address token,uint256)` — transfer out `amount` in STANDARD (1e18) units from `available`.
 *   • `weth() view`                     — the market's wrapped-native (depositETH target).
 *   • `supportedTokens(token) view`     — whether a token is an accepted collateral.
 *
 * BALANCE UNITS: the on-chain ledger (`getUserBalance`, and `withdraw`'s amount) is always
 * STANDARD_DECIMALS = 18 (PerpMarket.sol:84), regardless of collateral token decimals. ERC-20
 * `deposit` takes the amount in the TOKEN's native decimals (safeTransferFrom pulls it, then
 * normalizes to 18). ETH `depositETH` takes msg.value in wei (ETH = 18).
 */
export const perpMarketWriteAbi = [
  {
    type: 'function',
    name: 'depositETH',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    // PerpMarket.sol:763 `closePair(uint256 pairId) external nonReentrant whenNotPaused`.
    // Caller MUST be the pair's long or short trader; the pair must be ACTIVE; the market not
    // paused. Exit price is the stored on-chain mark `tokenPrices[pos.token]` (no price arg).
    type: 'function',
    name: 'closePair',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'pairId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'weth',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'supportedTokens',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const

/** Minimal ERC-20 ABI for the WETH-collateral deposit path (balance / allowance / approve). */
export const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
] as const

/** The on-chain collateral ledger is always 18-decimal standard units. */
export const STANDARD_DECIMALS = 18

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
