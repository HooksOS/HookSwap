/*
 * HookSwap — Volume + Fees adapter (DefiLlama dimension-adapters convention)
 * =========================================================================
 * Target location in DefiLlama's monorepo:  dimension-adapters/dexs/hookswap/index.ts
 * Adapter system:                           Volume + Fees   (github.com/DefiLlama/dimension-adapters)
 *
 * One dimension-adapter file yields BOTH the /dexs (volume) and /fees dashboards: `uniV2Exports`
 * reads on-chain UniswapV2 Swap events from every HookSwap v2 pair per chain and derives dailyVolume,
 * and with the pool fee it derives dailyFees. With `revenueRatio: 0` (HookSwap runs a standard v2
 * fork with the protocol fee switch OFF — feeTo unset) the split is: dailyRevenue = 0 (protocol),
 * dailySupplySideRevenue = 100% of fees (LPs).
 *
 * DATA SOURCE = on-chain Swap event logs (idiomatic for a univ2 fork with no public subgraph).
 * DefiLlama prices the tokens; unpriced test tokens (e.g. XLayer STT) contribute $0 — honest.
 *
 * HookSwap v2 pools charge 0.30% (feeTier 3000) → fees = 0.003 (verified via data.hookswap.org
 * /v1/pools "feeTier":3000, and it's the canonical UniswapV2 constant-product fee).
 *
 * REAL LIQUIDITY confirmed on-chain 2026-07-23 (contracts/deployments/pools-seeded.json). Each
 * enabled chain has ≥1 live v2 pair (wrapped-native / real stablecoin) — dust/proof depth today,
 * grows with seeding. Addresses below are verbatim from contracts/deployments/<chain>.json.
 */

import { uniV2Exports } from '../../helpers/uniswap'
import { CHAIN } from '../../helpers/chains'

// HookSwap v2 swap fee = 0.30% (UniswapV2 constant-product; data-api feeTier 3000).
const FEE = 0.003
// Standard v2 fork, protocol fee switch OFF (feeTo unset) => protocol Revenue share = 0, LPs get 100%.
const REVENUE_RATIO = 0

// -------------------------------------------------------------------------------------------------
// CHAIN KEY -> { v2 factory, start }.
//
// Keys are dimension-adapters CHAIN enum values (helpers/chains.ts, verified live 2026-07-23):
//   CHAIN.ROBINHOOD="robinhood", CHAIN.INK="ink", CHAIN.XLAYER="xlayer",
//   CHAIN.HYPERLIQUID="hyperliquid" (== HookSwap "HyperEVM" chainId 999), CHAIN.STABLE="stable".
// RPC resolution in dimension-adapters (verified live 2026-07-23):
//   robinhood    -> helpers/env.ts ROBINHOOD_RPC = https://rpc.mainnet.chain.robinhood.com
//                   (NOTE the slug discrepancy: @defillama/sdk providers.json carries this chain as
//                    "robinhoodchain"/4663, but dimension-adapters resolves CHAIN.ROBINHOOD="robinhood"
//                    via its own env.ts RPC override — so THIS adapter correctly uses "robinhood".)
//   xlayer       -> helpers/env.ts XLAYER_RPC (+ sdk providers.json "xlayer"/196)
//   hyperliquid  -> helpers/env.ts HYPERLIQUID_RPC (+ sdk providers.json "hyperliquid"/999)
//   ink          -> sdk providers.json "ink"/57073
//   stable       -> sdk providers.json "stable"/988
//
// `start` = a conservative unix-seconds LOWER BOUND for the Swap-log backfill (scan window, not an
// on-chain-verified deploy block). Over-early is safe (finds nothing earlier); each value is before
// the chain's HookSwap v2Factory deploy and after that chain's genesis:
//   robinhood = 1777567931 (Robinhood Chain genesis, block-1 ts, VERIFIED live 2026-04-30 16:52 UTC)
//   ink/xlayer/hyperliquid = 1782864000 (2026-07-01 UTC; HookSwap stack deployed 2026-07-03/04)
//   stable = 1784505600 (2026-07-20 UTC; Stable DEX deployed 2026-07-22)
// -------------------------------------------------------------------------------------------------
const CONFIG: Record<string, { factory: string; start: number }> = {
  [CHAIN.ROBINHOOD]:   { factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45', start: 1777567931 }, // robinhood.json (4663)
  [CHAIN.INK]:         { factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45', start: 1782864000 }, // ink.json (57073)
  [CHAIN.XLAYER]:      { factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45', start: 1782864000 }, // xlayer.json (196) — canonical nonce-0 factory
  [CHAIN.HYPERLIQUID]: { factory: '0xB92598Fa464B96FEC394a17A269Ad18060Ec60B2', start: 1782864000 }, // hyperevm.json (999)
  [CHAIN.STABLE]:      { factory: '0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA', start: 1784505600 }, // stable.json (988)
}

const v2Config = Object.fromEntries(
  Object.entries(CONFIG).map(([chain, { factory, start }]) => [
    chain,
    { factory, fees: FEE, revenueRatio: REVENUE_RATIO, start: String(start) },
  ]),
)

const adapter = uniV2Exports(v2Config, {
  methodology: {
    Volume: 'Sum of the token amounts swapped through every HookSwap v2 pair (UniswapV2 Swap events) on each enabled chain, priced by DefiLlama.',
    Fees: 'Swap volume x 0.30% (the HookSwap v2 pool fee).',
    SupplySideRevenue: 'All 0.30% of swap fees accrue to liquidity providers (standard UniswapV2 fork; the protocol fee switch feeTo is not set).',
    Revenue: 'None taken by the protocol at the v2 pool level (feeTo unset) — revenueRatio = 0.',
  },
})

export default adapter

// -------------------------------------------------------------------------------------------------
// MEGAETH (4326) — HAS a real v2 pool (WETH/USDm, factory 0xD1Cf664944173140AFc302c169eFD55c24966B45),
// and CHAIN.MEGAETH="megaeth" EXISTS in helpers/chains.ts, BUT it is BLOCKED: there is NO megaeth RPC
// wired in dimension-adapters (no MEGAETH_RPC in helpers/env.ts) AND no "megaeth"/4326 entry in
// @defillama/sdk providers.json (both verified live 2026-07-23), so the harness cannot resolve an RPC.
// TO UNBLOCK: register the chain DefiLlama-side (chainlist chainid-4326.js — ready copy at
// defillama-adapters/chainlist/chainid-4326.js) and/or add MEGAETH_RPC=https://mainnet.megaeth.com/rpc
// to dimension-adapters helpers/env.ts, then add:
//   // CONFIG[CHAIN.MEGAETH] = { factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45', start: 1782864000 }
//
// TEMPO (4217) — OFF: no usable pool (AA-native tokens revert on approve/transfer; no v2 pair exists,
//   pools-seeded.json "blocked": tempo_4217) and no RPC resolvable in dimension-adapters/sdk anyway.
//
// v3 — omitted on every chain (no confirmed v3 liquidity). To add later:
//   import { getUniV3LogAdapter } from '../../helpers/uniswap'  // per-chain v3Factory (see hookswap/index.js)
// -------------------------------------------------------------------------------------------------
