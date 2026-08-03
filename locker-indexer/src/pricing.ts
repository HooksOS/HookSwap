/**
 * HookSwap Locker indexer — USD pricing module.
 *
 * ⚠️ CONTRACT (do not change these signatures — the indexer core imports them):
 *   - `priceUsdBatch(chainId, tokens)` → Map keyed by LOWERCASED token address →
 *     USD price per whole token (number), or `undefined` when no honest price
 *     source exists for that token on that chain. NEVER fabricate a price.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW WE PRICE (mirrors the HookSwap data-api USD surface — data-api/src/chains.ts
 * + data-api/src/indexer/metrics.ts, which is the single source of truth for USD
 * on this DEX). There is NO external oracle. Everything flows from live on-chain
 * v2 pool reserves against ONE per-chain stablecoin anchor:
 *
 *   usdPerNative(chain) = USDG-per-WETH from the wrapped-native/stablecoin v2 pool
 *                         (CREATE2-computed pair addr → getReserves), decimals-adjusted.
 *   priceUsd(token)     = priceInNative(token) × usdPerNative
 *                       where priceInNative = WETH-per-token from the token/WETH v2 pool.
 *   priceUsd(USDG)      = 1.0            (the stablecoin IS the USD unit)
 *   priceUsd(WETH)      = usdPerNative   (wrapped-native valued at the anchor rate)
 *   direct token/USDG   = USDG-per-token (already USD; used when a token↔stable pool exists)
 *
 * A best-effort v3 fallback (factory.getPool → slot0 sqrtPriceX96, liquidity>0) is
 * tried only when no v2 pool resolves the leg.
 *
 * HONESTY: only chains with a configured, on-chain-verified `stablecoin` can yield
 * a USD price. Today that is ONLY Robinhood (4663) → USDG. On every other HookSwap
 * chain there is no verified stablecoin anchor, so `usdPerNative` is undefined and
 * every token honestly returns `undefined` (native-only; no fabricated USD). Any RPC
 * / read failure for a single token maps that token to `undefined` and never throws
 * the batch. The anchor is fetched at most once per call.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  createPublicClient,
  getAddress,
  getCreate2Address,
  keccak256,
  encodePacked,
  type PublicClient,
  type Address,
} from 'viem'
import { failoverHttp, resolveRpcUrls } from './rpc.js'

/** USD price per whole token, or undefined when unpriceable. Keyed by token address (lowercased). */
export type PriceMap = Map<string, number | undefined>

// ─────────────────────────────────────────────────────────────────────────────
// Per-chain config. Copied verbatim from data-api/src/chains.ts (itself copied
// from trading-api-adapter/src/chains.ts → contracts/deployments/<chain>.json).
// Only the fields pricing needs: RPC, wrapped-native, v2/v3 factory, stablecoin.
// RPC: resolved through the shared failover ring (src/rpc.ts). WEB3_RPC_<chainId>
// still wins here (data-api parity) and now accepts a comma-separated list.
// ─────────────────────────────────────────────────────────────────────────────
interface ChainCfg {
  chainId: number
  name: string
  /** Pricing-side env override, checked FIRST. Accepts a comma-separated list. */
  rpcEnvVar: string
  wrappedNative: { address: Address; decimals: number }
  v2Factory: Address
  v3Factory: Address
  /** USD anchor stablecoin. UNSET ⇒ chain cannot produce USD prices (honest undefined). */
  stablecoin?: { address: Address; decimals: number }
}

const CHAINS: Record<number, ChainCfg> = {
  // Robinhood (4663) — the ONLY chain with a verified USD stablecoin (USDG, 6dp).
  4663: {
    chainId: 4663,
    name: 'Robinhood',
    rpcEnvVar: 'WEB3_RPC_4663',
    wrappedNative: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v3Factory: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
    stablecoin: { address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', decimals: 6 },
  },
  // MegaETH (4326) — no verified stablecoin anchor ⇒ all tokens undefined.
  4326: {
    chainId: 4326,
    name: 'MegaETH',
    rpcEnvVar: 'WEB3_RPC_4326',
    wrappedNative: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v3Factory: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
  },
  // Ink (57073) — no verified stablecoin anchor.
  57073: {
    chainId: 57073,
    name: 'Ink',
    rpcEnvVar: 'WEB3_RPC_57073',
    wrappedNative: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v3Factory: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
  },
  // XLayer (196) — no verified stablecoin anchor (has WOKB pools but no USD anchor).
  196: {
    chainId: 196,
    name: 'XLayer',
    rpcEnvVar: 'WEB3_RPC_196',
    wrappedNative: { address: '0xe538905cf8410324e03A5A23C1c177a474D59b2b', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v3Factory: '0xAB34Bb3767020059A35e71D03f13E9e4fbCD07aC',
  },
  // HyperEVM (999) — no verified stablecoin anchor.
  999: {
    chainId: 999,
    name: 'HyperEVM',
    rpcEnvVar: 'WEB3_RPC_999',
    wrappedNative: { address: '0x5555555555555555555555555555555555555555', decimals: 18 },
    v2Factory: '0xB92598Fa464B96FEC394a17A269Ad18060Ec60B2',
    v3Factory: '0x45DB3eaE624dBcA631A9C6C1406DA0B8F6Fb275A',
  },
  // Stable (988) — the SECOND chain that can produce real USD prices. Its wrapped
  // native IS a dollar stablecoin (WgUSDT, 18dp) and USDT0 (6dp) is the same dollar
  // as a 6-decimal ERC-20, so the reserve anchor is a true USD anchor rather than a
  // proxy. Addresses from contracts/deployments/stable.json; both token decimals
  // read on-chain 2026-07-25 (WgUSDT=18, USDT0=6).
  988: {
    chainId: 988,
    name: 'Stable',
    rpcEnvVar: 'WEB3_RPC_988',
    wrappedNative: { address: '0x817997ca8394e26cce3de3a076a4889b27dbf9de', decimals: 18 },
    v2Factory: '0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA',
    v3Factory: '0xf486e625C892C0739A16A3A49B37fD52374B30CB',
    stablecoin: { address: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', decimals: 6 },
  },
  // Sepolia (11155111) — canonical Uniswap stack; no verified stablecoin anchor configured.
  11155111: {
    chainId: 11155111,
    name: 'Sepolia',
    rpcEnvVar: 'WEB3_RPC_11155111',
    wrappedNative: { address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', decimals: 18 },
    v2Factory: '0xF62c03E08ada871A0bEb309762E260a7a6a880E6',
    v3Factory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
  },
  // NOTE: Tempo (4217) is intentionally omitted — its wrapped-native is null (gas paid in
  // pathUSD ERC-20), so the reserve-anchor model does not apply; its tokens honestly return
  // undefined via the "unsupported chain" path below.
}

/**
 * v2 pair init-code hash — CANONICAL Uniswap v2, verified == HookSwap's deployed v2 factory
 * (CLAUDE.md 2026-07-03 & on-chain-confirmed on XLayer 2026-07-08: computed pair == on-chain pair).
 */
const V2_PAIR_INIT_CODE_HASH = '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f' as const

/** v3 fee tiers to probe (1bp/5bp/30bp/100bp), in probe order. */
const V3_FEE_TIERS = [500, 3000, 10000, 100] as const

// ── minimal ABIs (viem const tuples) ─────────────────────────────────────────
const ERC20_ABI = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const

const V2_PAIR_ABI = [
  {
    type: 'function',
    name: 'getReserves',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }],
  },
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

const V3_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }],
    outputs: [{ type: 'address' }],
  },
] as const

const V3_POOL_ABI = [
  {
    type: 'function',
    name: 'slot0',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'uint160' }, // sqrtPriceX96
      { type: 'int24' },
      { type: 'uint16' },
      { type: 'uint16' },
      { type: 'uint16' },
      { type: 'uint8' },
      { type: 'bool' },
    ],
  },
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
] as const

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// ── low-level helpers ────────────────────────────────────────────────────────

/**
 * Pricing client — SAME multi-RPC failover ring as the indexers (src/rpc.ts).
 * This used to be a second, independent single-URL resolver; both resolvers are now
 * unified so one env override (or one endpoint outage) is learned service-wide.
 * Precedence: WEB3_RPC_<id> → the friendly alias (e.g. XLAYER_RPC_URL) →
 * LOCKER_RPC_<id> → the built-in public list. Any of them may be a comma-list.
 */
function makeClient(chain: ChainCfg): PublicClient {
  const urls = resolveRpcUrls(chain.chainId, [chain.rpcEnvVar])
  return createPublicClient({ transport: failoverHttp(chain.chainId, chain.name, urls) })
}

/** CREATE2 v2 pair address for (a,b) under a factory. Order-independent (sorts token0<token1). */
function computePairAddress(factory: Address, a: Address, b: Address): Address {
  const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
  const salt = keccak256(encodePacked(['address', 'address'], [getAddress(t0), getAddress(t1)]))
  return getCreate2Address({ from: factory, salt, bytecodeHash: V2_PAIR_INIT_CODE_HASH })
}

/**
 * Reserve ratio from a v2 pool: how many whole `quote` tokens 1 whole `base` token is worth,
 * i.e. price of `base` denominated in `quote` = (quoteReserveHuman / baseReserveHuman).
 * Returns undefined when the pair has no code / no reserves / a zero side / on any read error.
 */
async function v2Ratio(
  client: PublicClient,
  factory: Address,
  base: Address,
  baseDec: number,
  quote: Address,
  quoteDec: number,
): Promise<number | undefined> {
  try {
    const pair = computePairAddress(factory, base, quote)
    const [reserves, token0] = await Promise.all([
      client.readContract({ address: pair, abi: V2_PAIR_ABI, functionName: 'getReserves' }),
      client.readContract({ address: pair, abi: V2_PAIR_ABI, functionName: 'token0' }),
    ])
    const [reserve0, reserve1] = reserves as readonly [bigint, bigint, number]
    const baseIs0 = (token0 as string).toLowerCase() === base.toLowerCase()
    const baseRaw = baseIs0 ? reserve0 : reserve1
    const quoteRaw = baseIs0 ? reserve1 : reserve0
    const baseHuman = Number(baseRaw) / 10 ** baseDec
    const quoteHuman = Number(quoteRaw) / 10 ** quoteDec
    if (!(baseHuman > 0) || !(quoteHuman > 0)) return undefined
    const ratio = quoteHuman / baseHuman
    return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined
  } catch {
    return undefined
  }
}

/**
 * Best-effort v3 price of `base` in `quote` (whole tokens), from the deepest-tier pool found.
 * Requires the pool to exist and have non-zero in-range liquidity. Returns undefined otherwise.
 */
async function v3Ratio(
  client: PublicClient,
  v3Factory: Address,
  base: Address,
  baseDec: number,
  quote: Address,
  quoteDec: number,
): Promise<number | undefined> {
  const baseIs0 = base.toLowerCase() < quote.toLowerCase()
  const dec0 = baseIs0 ? baseDec : quoteDec
  const dec1 = baseIs0 ? quoteDec : baseDec
  for (const fee of V3_FEE_TIERS) {
    try {
      const pool = (await client.readContract({
        address: v3Factory,
        abi: V3_FACTORY_ABI,
        functionName: 'getPool',
        args: [base, quote, fee],
      })) as Address
      if (!pool || pool.toLowerCase() === ZERO_ADDRESS) continue
      const [slot0, liquidity] = await Promise.all([
        client.readContract({ address: pool, abi: V3_POOL_ABI, functionName: 'slot0' }),
        client.readContract({ address: pool, abi: V3_POOL_ABI, functionName: 'liquidity' }),
      ])
      if ((liquidity as bigint) <= 0n) continue
      const sqrtPriceX96 = (slot0 as readonly [bigint, ...unknown[]])[0]
      if (sqrtPriceX96 <= 0n) continue
      // raw price of token0 in token1 (smallest units) = (sqrtPriceX96 / 2^96)^2
      const sqrt = Number(sqrtPriceX96) / 2 ** 96
      const rawPrice0In1 = sqrt * sqrt
      // whole-token price of token0 in token1 = rawPrice0In1 × 10^dec0 / 10^dec1
      const price0In1 = rawPrice0In1 * 10 ** dec0 / 10 ** dec1
      if (!Number.isFinite(price0In1) || price0In1 <= 0) continue
      // want price of `base` in `quote`
      const ratio = baseIs0 ? price0In1 : 1 / price0In1
      if (Number.isFinite(ratio) && ratio > 0) return ratio
    } catch {
      // try next fee tier
    }
  }
  return undefined
}

/** Price of `base` in `quote` (whole tokens): v2 first, then v3 fallback. */
async function priceInQuote(
  client: PublicClient,
  chain: ChainCfg,
  base: Address,
  baseDec: number,
  quote: Address,
  quoteDec: number,
): Promise<number | undefined> {
  const v2 = await v2Ratio(client, chain.v2Factory, base, baseDec, quote, quoteDec)
  if (v2 !== undefined) return v2
  return v3Ratio(client, chain.v3Factory, base, baseDec, quote, quoteDec)
}

/** Read an ERC-20's decimals; undefined on any error. */
async function tokenDecimals(client: PublicClient, token: Address): Promise<number | undefined> {
  try {
    const d = await client.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' })
    return Number(d)
  } catch {
    return undefined
  }
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Resolve USD prices for a set of tokens on one chain.
 * @param chainId  one of the HookSwap chain ids
 * @param tokens   token contract addresses (any case)
 * @returns map (lowercased address → USD price | undefined). Unknown/unpriceable → undefined.
 */
export async function priceUsdBatch(chainId: number, tokens: `0x${string}`[]): Promise<PriceMap> {
  const out: PriceMap = new Map()
  for (const t of tokens) out.set(t.toLowerCase(), undefined)

  const chain = CHAINS[chainId]
  if (!chain || tokens.length === 0) return out // unsupported chain (or no tokens) → all undefined (honest)

  const client = makeClient(chain)
  const wnative = chain.wrappedNative.address.toLowerCase()
  const stable = chain.stablecoin?.address.toLowerCase()

  // Anchor: USDG-per-WETH from the wrapped-native/stablecoin v2 pool. Fetched at most once per call.
  // undefined when the chain has no configured stablecoin OR the anchor pool isn't seeded on-chain yet.
  let usdPerNative: number | undefined
  if (chain.stablecoin && wnative !== stable) {
    usdPerNative = await priceInQuote(
      client,
      chain,
      chain.wrappedNative.address,
      chain.wrappedNative.decimals,
      chain.stablecoin.address,
      chain.stablecoin.decimals,
    )
  }

  await Promise.all(
    tokens.map(async (raw) => {
      const key = raw.toLowerCase()
      try {
        const token = getAddress(raw)

        // 1. The chain's USD stablecoin → exactly $1.
        if (stable && key === stable) {
          out.set(key, 1.0)
          return
        }

        // 2. Wrapped-native → the anchor USD rate (undefined if no anchor).
        if (key === wnative) {
          out.set(key, usdPerNative)
          return
        }

        // Need the token's decimals to interpret reserves.
        const dec = await tokenDecimals(client, token)
        if (dec === undefined) {
          out.set(key, undefined)
          return
        }

        // 3a. Direct token↔USDG pool → already-USD price (no anchor needed).
        if (chain.stablecoin && stable) {
          const usd = await priceInQuote(
            client,
            chain,
            token,
            dec,
            chain.stablecoin.address,
            chain.stablecoin.decimals,
          )
          if (usd !== undefined && Number.isFinite(usd) && usd > 0) {
            out.set(key, usd)
            return
          }
        }

        // 3b. token↔WETH pool → priceInNative × usdPerNative (needs the anchor).
        if (usdPerNative !== undefined) {
          const priceInNative = await priceInQuote(
            client,
            chain,
            token,
            dec,
            chain.wrappedNative.address,
            chain.wrappedNative.decimals,
          )
          if (priceInNative !== undefined && Number.isFinite(priceInNative) && priceInNative > 0) {
            const usd = priceInNative * usdPerNative
            if (Number.isFinite(usd) && usd > 0) {
              out.set(key, usd)
              return
            }
          }
        }

        // 4. No honest USD path resolved → undefined (already set).
      } catch {
        out.set(key, undefined) // any per-token failure is isolated; never throws the batch
      }
    }),
  )

  return out
}
