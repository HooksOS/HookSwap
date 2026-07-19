// Fixed-point / AMM price math for the oracle adapters. All bigint, no floats,
// so the scalar mark price is deterministic and precise at 1e18.

export const ONE_1E18 = 10n ** 18n;
const Q96 = 1n << 96n;
const Q192 = 1n << 192n;
const MAX_UINT256 = (1n << 256n) - 1n;

export function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** floor(a * b / c) with full 512-bit intermediate (bigint is arbitrary precision). */
export function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b) / c;
}

/**
 * Scale a raw integer with `decimals` implied decimal places to a 1e18 fixed
 * point. e.g. a Chainlink answer 178_50000000 with 8 decimals → 178.5e18.
 * Used by the external-feed adapters (Chainlink/Pyth/API). No floats.
 */
export function scaleToE18(value: bigint, decimals: number): bigint {
  if (value <= 0n) return 0n;
  if (decimals === 18) return value;
  if (decimals < 18) return value * pow10(18 - decimals);
  return value / pow10(decimals - 18);
}

/** Reciprocal of a 1e18 price (base-per-quote → quote-per-base). 0 stays 0. */
export function invert1e18(price1e18: bigint): bigint {
  if (price1e18 <= 0n) return 0n;
  return (ONE_1E18 * ONE_1E18) / price1e18;
}

/**
 * v2 constant-product spot price, decimal-normalized to 1e18 (quote per base).
 * @param reserve0/reserve1 raw reserves of token0/token1
 * @param dec0/dec1 token decimals
 * @param quoteIsToken1 true if the QUOTE (numeraire) is token1 (base = token0)
 */
export function v2Price1e18(
  reserve0: bigint,
  reserve1: bigint,
  dec0: number,
  dec1: number,
  quoteIsToken1: boolean,
): bigint {
  if (reserve0 === 0n || reserve1 === 0n) return 0n;
  if (quoteIsToken1) {
    // (reserve1/10^dec1) / (reserve0/10^dec0) * 1e18
    return mulDiv(reserve1 * pow10(dec0), ONE_1E18, reserve0 * pow10(dec1));
  }
  // quote = token0, base = token1
  return mulDiv(reserve0 * pow10(dec1), ONE_1E18, reserve1 * pow10(dec0));
}

/**
 * v3/v4 price from sqrtPriceX96, decimal-normalized to 1e18 (quote per base).
 * Raw ratio token1/token0 = (sqrtP/2^96)^2. Human token0-in-token1 = raw * 10^(dec0-dec1).
 * @param quoteIsToken1 true if QUOTE is token1 (base = token0)
 */
export function sqrtPriceX96ToPrice1e18(
  sqrtPriceX96: bigint,
  dec0: number,
  dec1: number,
  quoteIsToken1: boolean,
): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  const p = sqrtPriceX96 * sqrtPriceX96; // token1/token0 * 2^192
  if (quoteIsToken1) {
    // base = token0, quote = token1: p/2^192 * 10^(dec0-dec1) * 1e18
    return mulDiv(p * pow10(dec0), ONE_1E18, Q192 * pow10(dec1));
  }
  // base = token1, quote = token0: 2^192/p * 10^(dec1-dec0) * 1e18
  return mulDiv(Q192 * pow10(dec1), ONE_1E18, p * pow10(dec0));
}

/**
 * Uniswap v3 TickMath.getSqrtRatioAtTick — canonical port (bit-by-bit),
 * so the TWAP path (avgTick -> sqrtPriceX96 -> price) uses the EXACT same
 * conversion as the spot path (slot0.sqrtPriceX96 -> price). No float pow.
 * Valid for tick in [-887272, 887272].
 */
export function getSqrtRatioAtTick(tick: number): bigint {
  const absTick = BigInt(tick < 0 ? -tick : tick);
  let ratio =
    (absTick & 0x1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  const m = (r: bigint, factor: bigint, bit: bigint) =>
    (absTick & bit) !== 0n ? (r * factor) >> 128n : r;
  ratio = m(ratio, 0xfff97272373d413259a46990580e213an, 0x2n);
  ratio = m(ratio, 0xfff2e50f5f656932ef12357cf3c7fdccn, 0x4n);
  ratio = m(ratio, 0xffe5caca7e10e4e61c3624eaa0941cd0n, 0x8n);
  ratio = m(ratio, 0xffcb9843d60f6159c9db58835c926644n, 0x10n);
  ratio = m(ratio, 0xff973b41fa98c081472e6896dfb254c0n, 0x20n);
  ratio = m(ratio, 0xff2ea16466c96a3843ec78b326b52861n, 0x40n);
  ratio = m(ratio, 0xfe5dee046a99a2a811c461f1969c3053n, 0x80n);
  ratio = m(ratio, 0xfcbe86c7900a88aedcffc83b479aa3a4n, 0x100n);
  ratio = m(ratio, 0xf987a7253ac413176f2b074cf7815e54n, 0x200n);
  ratio = m(ratio, 0xf3392b0822b70005940c7a398e4b70f3n, 0x400n);
  ratio = m(ratio, 0xe7159475a2c29b7443b29c7fa6e889d9n, 0x800n);
  ratio = m(ratio, 0xd097f3bdfd2022b8845ad8f792aa5825n, 0x1000n);
  ratio = m(ratio, 0xa9f746462d870fdf8a65dc1f90e061e5n, 0x2000n);
  ratio = m(ratio, 0x70d869a156d2a1b890bb3df62baf32f7n, 0x4000n);
  ratio = m(ratio, 0x31be135f97d08fd981231505542fcfa6n, 0x8000n);
  ratio = m(ratio, 0x9aa508b5b7a84e1c677de54f3e99bc9n, 0x10000n);
  ratio = m(ratio, 0x5d6af8dedb81196699c329225ee604n, 0x20000n);
  ratio = m(ratio, 0x2216e584f5fa1ea926041bedfe98n, 0x40000n);
  ratio = m(ratio, 0x48a170391f7dc42444e8fa2n, 0x80000n);
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  // sqrtPriceX96 = ratio >> 32, rounding up.
  const shifted = ratio >> 32n;
  return (ratio & ((1n << 32n) - 1n)) === 0n ? shifted : shifted + 1n;
}

/** Arithmetic-mean tick over a window, from two tickCumulative snapshots. */
export function meanTick(tickCumulatives: readonly bigint[], windowSecs: number): number {
  const delta = tickCumulatives[1] - tickCumulatives[0];
  const w = BigInt(windowSecs);
  // Round toward negative infinity, matching Uniswap OracleLibrary.consult.
  let avg = delta / w;
  if (delta < 0n && delta % w !== 0n) avg -= 1n;
  return Number(avg);
}

// Re-export for adapters that want the Q96 constant.
export { Q96 };
