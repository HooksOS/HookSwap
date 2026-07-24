/**
 * HookSwap Terminal — minimal Uniswap-v3 pool ABI for CREATE-position reads.
 * Only the two views we need to detect existence + current price on-chain:
 *   • slot0()   — sqrtPriceX96 + current tick (zero sqrtPrice ⇒ pool not initialized).
 *   • liquidity() — in-range liquidity (used to build the SDK Pool entity).
 * Hand-written to match the deployed own-stack UniswapV3Pool (canonical bytecode).
 */
export const v3PoolAbi = [
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'liquidity',
    outputs: [{ name: '', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const
