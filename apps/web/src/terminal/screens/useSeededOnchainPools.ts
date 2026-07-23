/**
 * HookSwap Terminal — on-chain seeded-pool fallback for the Markets "Pools" table.
 *
 * WHY THIS EXISTS (facts, verified 2026-07-23):
 *   The Markets table is fed by the self-hosted data-api (`data.hookswap.org/v2`
 *   ListTopPools), queried across ALL enabled chains. That backend DOES index the
 *   seeded pools on Robinhood (4663), Ink (57073), MegaETH (4326) and XLayer (196)
 *   — but returns EMPTY for Stable (988) and HyperEVM (999) (verified by direct
 *   ListTopPools calls). So real, on-chain-verified pools on those two chains never
 *   appeared in the UI, because nothing indexes them yet.
 *
 *   Rather than block on a backend/indexer redeploy (Reggie-only), this hook reads
 *   the known-seeded v2 pairs DIRECTLY on-chain (`getReserves` via each chain's RPC,
 *   through wagmi) and shapes them into `PoolStat` rows the Markets table already
 *   renders. The MarketsScreen merge dedupes by `chainId:poolId`, so a pool the
 *   backend serves ALWAYS wins (richer stats) and this fallback only fills the gaps.
 *   Registering every real seeded stablecoin pool (not just the two gaps) keeps the
 *   table correct even if the backend regresses on a chain.
 *
 * DATA POLICY (no fabrication):
 *   • Pool existence + tokens: on-chain-verified addresses from
 *     `contracts/deployments/pools-seeded.json` (each `status:0x1`, reserves read
 *     on-chain this session).
 *   • TVL (USD): derived from REAL on-chain reserves. A side whose symbol is a known
 *     USD stablecoin is valued at $1 (standard peg). For a stable/native pair the
 *     native side is valued at the pool-implied price (⇒ TVL = 2 × stable-side USD);
 *     for a stable/stable pair TVL = sum of both sides. If NEITHER side is a known
 *     stable, TVL is left `undefined` → the table renders an honest "—".
 *   • Price / 24H / volume / fees / sparkline: NOT known on-chain here → honest "—".
 *
 * Reserve → token mapping: UniswapV2 orders `token0 < token1` by address, and
 * `getReserves` returns `(reserve0, reserve1)` in that order. We map each registered
 * token to a reserve by comparing addresses (no extra `token0()` call) — verified
 * against on-chain `token0()` for the Stable + HyperEVM pairs.
 */
import { useMemo } from 'react'
import type { ContractFunctionParameters } from 'viem'
import { DEFAULT_TICK_SPACING } from 'uniswap/src/constants/pools'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainUrlParam } from '~/utils/params/chainParams'
import { calculateApr } from '~/appGraphql/data/pools/useTopPools'
import type { Address } from '~/chains'
import { useReadContracts } from 'wagmi'
import { formatUnits } from '~/chains'
import type { PoolStat } from '~/types/explore'

/** Minimal UniswapV2 pair ABI — just the reserves read. */
const PAIR_ABI = [
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { name: '_reserve0', type: 'uint112' },
      { name: '_reserve1', type: 'uint112' },
      { name: '_blockTimestampLast', type: 'uint32' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

/** Symbols valued at $1 for on-chain TVL (case-insensitive). Real USD stablecoins only. */
const STABLE_SYMBOLS: ReadonlySet<string> = new Set([
  'USDT0',
  'USD₮0',
  'USDG',
  'USDM',
  'USDC',
  'WGUSDT',
  'USDT',
  'DAI',
])

interface SeededTokenMeta {
  address: Address
  symbol: string
  name: string
  decimals: number
}

interface SeededPool {
  chainId: UniverseChainId
  /** The on-chain v2 pair address. */
  poolId: Address
  /** Display order (native first, stable second) — reserve mapping is by address, not this. */
  tokenA: SeededTokenMeta
  tokenB: SeededTokenMeta
  /** v2 = fixed 0.30% (3000 in hundredths-of-a-bip). */
  feeAmount: number
}

/**
 * Real, on-chain-verified seeded v2 pools (contracts/deployments/pools-seeded.json).
 * Registering all of them (not only the backend gaps) makes the table resilient to a
 * backend regression; the MarketsScreen merge dedupes so backend rows win.
 */
const SEEDED_POOLS: readonly SeededPool[] = [
  // Stable (988) — WgUSDT / USDT0 (both stablecoins). BACKEND GAP.
  {
    chainId: UniverseChainId.Stable,
    poolId: '0x7F9023729F92ecb5aCbe9A4d9F9463fCDf5b2B9f',
    tokenA: { address: '0x817997ca8394e26cce3de3a076a4889b27dbf9de', symbol: 'WgUSDT', name: 'Wrapped Gas USDT', decimals: 18 },
    tokenB: { address: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', symbol: 'USDT0', name: 'USDT0', decimals: 6 },
    feeAmount: 3000,
  },
  // HyperEVM (999) — WHYPE / USDC. BACKEND GAP.
  {
    chainId: UniverseChainId.HyperEvm,
    poolId: '0x8628AfE800ca8C26F1d4Dc41e2B02C85e0B19Fc3',
    tokenA: { address: '0x5555555555555555555555555555555555555555', symbol: 'WHYPE', name: 'Wrapped HYPE', decimals: 18 },
    tokenB: { address: '0xb88339cb7199b77e23db6e890353e22632ba630f', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    feeAmount: 3000,
  },
  // Robinhood (4663) — WETH / USDG. Backend-served; kept for resilience (deduped away).
  {
    chainId: UniverseChainId.Robinhood,
    poolId: '0xF7ddC3837eAF447689a365f5f6f6B7C2AcdB72D7',
    tokenA: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    tokenB: { address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', symbol: 'USDG', name: 'Global Dollar', decimals: 6 },
    feeAmount: 3000,
  },
  // Ink (57073) — WETH / USD₮0. Backend-served; kept for resilience (deduped away).
  {
    chainId: UniverseChainId.Ink,
    poolId: '0xB738BBaC16121D11B1F59AbC619A359413503d12',
    tokenA: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    tokenB: { address: '0x0200C29006150606B650577BBE7B6248F58470c1', symbol: 'USD₮0', name: 'USD₮0', decimals: 6 },
    feeAmount: 3000,
  },
  // MegaETH (4326) — WETH / USDm. Backend-served; kept for resilience (deduped away).
  {
    chainId: UniverseChainId.MegaETH,
    poolId: '0xAD12931B2ff618C4aFEA9d9BCB7508Ccb51fF674',
    tokenA: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    tokenB: { address: '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7', symbol: 'USDm', name: 'MegaUSD', decimals: 18 },
    feeAmount: 3000,
  },
]

function isStable(symbol: string): boolean {
  return STABLE_SYMBOLS.has(symbol.toUpperCase())
}

/**
 * USD TVL from real reserves. `reserveA`/`reserveB` are the on-chain reserves already
 * mapped to tokenA/tokenB. Returns `undefined` when no side is a known stablecoin
 * (⇒ honest "—"); never fabricated.
 */
function computeTvlUsd(
  tokenA: SeededTokenMeta,
  tokenB: SeededTokenMeta,
  reserveA: bigint,
  reserveB: bigint,
): number | undefined {
  const aHuman = Number(formatUnits(reserveA, tokenA.decimals))
  const bHuman = Number(formatUnits(reserveB, tokenB.decimals))
  const aStable = isStable(tokenA.symbol)
  const bStable = isStable(tokenB.symbol)
  if (aStable && bStable) {
    return aHuman + bHuman
  }
  if (aStable) {
    return aHuman * 2 // mirror the non-stable side at the pool-implied price
  }
  if (bStable) {
    return bHuman * 2
  }
  return undefined
}

/**
 * USD TVL for a seeded pool from its (optional) on-chain reserves, or `undefined` when
 * reserves aren't loaded / no stablecoin side exists. `reserve0`/`reserve1` are the raw
 * `getReserves` outputs (reserve0 ↔ the lower token address).
 */
function poolTvl(pool: SeededPool, reserve0?: bigint, reserve1?: bigint): number | undefined {
  if (reserve0 === undefined || reserve1 === undefined) {
    return undefined
  }
  // UniswapV2: reserve0 ↔ lower token address. Map reserves to tokenA/tokenB by address.
  const aIsToken0 = pool.tokenA.address.toLowerCase() < pool.tokenB.address.toLowerCase()
  const reserveA = aIsToken0 ? reserve0 : reserve1
  const reserveB = aIsToken0 ? reserve1 : reserve0
  return computeTvlUsd(pool.tokenA, pool.tokenB, reserveA, reserveB)
}

/** Shape a seeded pool + its precomputed on-chain `tvl` into a `PoolStat` row. */
function toPoolStat(pool: SeededPool, tvl: number | undefined): PoolStat {
  // Use the chain's URL-param string (e.g. "stable", "hyperevm") as the token `chain`.
  // `gqlToCurrency` resolves it via `getChainIdFromChainUrlParam`, so real currencies
  // (logos, native-unwrap) build for chains that have NO GraphQL backendChain enum
  // (Stable/HyperEVM map to UnknownChain). Row-level chainId comes from `chainById`.
  const chain = getChainUrlParam(pool.chainId)

  return {
    id: pool.poolId,
    chain,
    protocolVersion: 'v2',
    token0: {
      chain,
      address: pool.tokenA.address,
      symbol: pool.tokenA.symbol,
      name: pool.tokenA.name,
      decimals: pool.tokenA.decimals,
      logo: undefined,
    },
    token1: {
      chain,
      address: pool.tokenB.address,
      symbol: pool.tokenB.symbol,
      name: pool.tokenB.name,
      decimals: pool.tokenB.decimals,
      logo: undefined,
    },
    totalLiquidity: tvl !== undefined ? { value: tvl } : undefined,
    volume1Day: undefined,
    volume30Day: undefined,
    // No tracked volume on-chain here ⇒ APR 0% (honest; calculateApr returns Percent(0)).
    apr: calculateApr({ volume24h: undefined, tvl, feeTier: pool.feeAmount }),
    feeTier: {
      feeAmount: pool.feeAmount,
      tickSpacing: DEFAULT_TICK_SPACING,
      isDynamic: false,
    },
  } as unknown as PoolStat
}

/**
 * Reads the seeded v2 pools on-chain (getReserves across each chain's RPC via wagmi)
 * and returns them as `PoolStat` rows for the Markets table. Rows appear immediately
 * (TVL "—" until reserves resolve), then fill with real TVL once the reads land.
 */
export function useSeededOnchainPools(): {
  pools: PoolStat[]
  isLoading: boolean
  /** Lowercased pair address → chainId, so MarketsScreen can resolve the row's chain. */
  chainById: ReadonlyMap<string, UniverseChainId>
  /**
   * Lowercased pair address → on-chain-derived USD TVL. Used to backfill TVL on
   * backend-indexed pools that ship without stats (e.g. Ink / MegaETH). Only present
   * when reserves loaded AND a stablecoin side exists.
   */
  tvlByAddress: ReadonlyMap<string, number>
} {
  const { data, isLoading } = useReadContracts({
    // `chainId` is a valid per-contract field wagmi reads at runtime; cast to viem's base
    // ContractFunctionParameters because our `UniverseChainId` is wider than wagmi's
    // configured-chains id union (which the strict `chainId?` field expects).
    contracts: SEEDED_POOLS.map((pool) => ({
      address: pool.poolId,
      chainId: pool.chainId,
      abi: PAIR_ABI,
      functionName: 'getReserves' as const,
    })) as unknown as readonly ContractFunctionParameters[],
    // Reserves change slowly for dust proof-pools; keep it cheap.
    query: { staleTime: 30_000 },
  })

  const { pools, tvlByAddress } = useMemo(() => {
    const tvlMap = new Map<string, number>()
    const built = SEEDED_POOLS.map((pool, i) => {
      const entry = data?.[i]
      let tvl: number | undefined
      if (entry?.status === 'success') {
        const [reserve0, reserve1] = entry.result as readonly [bigint, bigint, number]
        tvl = poolTvl(pool, reserve0, reserve1)
      }
      if (tvl !== undefined) {
        tvlMap.set(pool.poolId.toLowerCase(), tvl)
      }
      // Read pending/failed or no stable side → real pool with an honest "—" TVL.
      return toPoolStat(pool, tvl)
    })
    return { pools: built, tvlByAddress: tvlMap as ReadonlyMap<string, number> }
  }, [data])

  // Static registry mapping — stable identity for the consumer's memo deps.
  const chainById = useMemo(
    () => new Map<string, UniverseChainId>(SEEDED_POOLS.map((pool) => [pool.poolId.toLowerCase(), pool.chainId])),
    [],
  )

  return { pools, isLoading, chainById, tvlByAddress }
}
