// Minimal ABIs for the oracle sub-adapters (viem-typed via `as const`).

export const ERC20_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

// Uniswap/Pancake v2 pair (constant-product).
export const V2_PAIR_ABI = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;

// Uniswap/Pancake v3 pool (concentrated).
export const V3_POOL_ABI = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "observe",
    stateMutability: "view",
    inputs: [{ name: "secondsAgos", type: "uint32[]" }],
    outputs: [
      { name: "tickCumulatives", type: "int56[]" },
      { name: "secondsPerLiquidityCumulativeX128s", type: "uint160[]" },
    ],
  },
] as const;

// Chainlink AggregatorV3Interface (external price feed — RWA/stocks/fx).
export const CHAINLINK_AGGREGATOR_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
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

// Pyth receiver (IPyth) — on-chain pull oracle. getPriceNoOlderThan reverts if
// no fresh on-chain price exists (prices are posted via updatePriceFeeds/Hermes).
export const PYTH_ABI = [
  {
    type: "function",
    name: "getPriceNoOlderThan",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "age", type: "uint256" },
    ],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "price", type: "int64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "int32" },
          { name: "publishTime", type: "uint256" },
        ],
      },
    ],
  },
] as const;
