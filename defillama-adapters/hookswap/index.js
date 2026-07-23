/*
 * HookSwap — TVL adapter (DefiLlama-Adapters convention)
 * =====================================================
 * Target location in DefiLlama's monorepo:  DefiLlama-Adapters/projects/hookswap/index.js
 * Adapter system:                           TVL   (github.com/DefiLlama/DefiLlama-Adapters)
 *
 * HookSwap on-chain is a standard Uniswap **v2 + v3** fork stack (supportsV4:false — NO v4/hooks
 * on-chain). It runs its OWN factories/routers per chain; every address below is copied verbatim from
 * this repo's contracts/deployments/<chain>.json and MUST be treated as the source of truth.
 *
 * DATA SOURCE = raw on-chain reads (the idiomatic DefiLlama path), NOT a subgraph and NOT the
 * HookSwap data-api. `getUniTVL` enumerates every v2 pair via allPairsLength()/allPairs() on the
 * factory and sums pair reserves; DefiLlama prices the underlying tokens with its own coins service.
 * Only genuinely-priced reserves contribute USD TVL — unpriced test tokens (no market) count $0.
 * That is honest, not fabricated.
 *
 * REAL LIQUIDITY confirmed on-chain 2026-07-23 (this repo: contracts/deployments/pools-seeded.json).
 * Every enabled chain below has at least one live v2 pair of the chain's wrapped-native against a
 * REAL stablecoin (dust/proof depth — routing-proven, not deep liquidity). Priced pairs:
 *   Robinhood 4663 : WETH/USDG    (pair 0xF7ddC383…, ~0.0083 WETH : 16.29 USDG, priced)
 *   MegaETH   4326 : WETH/USDm    (pair 0xAD12931B…)   [BLOCKED — see MegaETH note below]
 *   Ink       57073: WETH/USD₮0   (pair 0xB738BBaC…)
 *   XLayer    196  : STT/WOKB     (pre-existing seeded pool; STT is a test token → priced $0, WOKB priced)
 *   HyperEVM  999  : WHYPE/USDC   (pair 0x8628AfE8…, real HyperEVM USDC 0xb88339cb…)
 *   Stable    988  : WgUSDT/USDT0 (pair 0x7F902372…)
 *   Tempo     4217 : NONE — AA-native tokens revert on approve()/transfer() → no v2 pool. Left OFF.
 */

const { getUniTVL } = require('../helper/unknownTokens')

// -------------------------------------------------------------------------------------------------
// CHAIN KEY -> v2 UniswapV2Factory.
//
// The KEY here MUST be a key in @defillama/sdk's build/providers.json — that is what carries the
// chainId + RPC used for the on-chain reads. Verified live 2026-07-23 against
// https://unpkg.com/@defillama/sdk/build/providers.json:
//   robinhoodchain -> chainId 4663, rpc https://rpc.mainnet.chain.robinhood.com   ✅ present
//   ink            -> chainId 57073, rpc https://rpc-qnd.inkonchain.com (+others)  ✅ present
//   xlayer         -> chainId 196,   rpc https://xlayerrpc.okx.com (+others)       ✅ present
//   hyperliquid    -> chainId 999,   rpc https://rpc.hyperliquid.xyz/evm (+others) ✅ present  (== HookSwap "HyperEVM")
//   stable         -> chainId 988,   rpc https://rpc.stable.xyz (+sentio)          ✅ present
//
// Factory addresses are verbatim from contracts/deployments/<chain>.json (do NOT edit from memory).
// Note the factory differs on HyperEVM + Stable (non-deterministic nonce at deploy time).
// -------------------------------------------------------------------------------------------------
const V2_FACTORIES = {
  robinhoodchain: '0xD1Cf664944173140AFc302c169eFD55c24966B45', // robinhood.json  v2Factory (4663)
  ink:            '0xD1Cf664944173140AFc302c169eFD55c24966B45', // ink.json        v2Factory (57073)
  xlayer:         '0xD1Cf664944173140AFc302c169eFD55c24966B45', // xlayer.json     v2Factory (196) — canonical nonce-0 factory (a duplicate 0xBe3729d0… at nonce 1 is unused)
  hyperliquid:    '0xB92598Fa464B96FEC394a17A269Ad18060Ec60B2', // hyperevm.json   v2Factory (999)
  stable:         '0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA', // stable.json     v2Factory (988)
}

module.exports = {
  methodology:
    'TVL = the on-chain token reserves of every HookSwap v2 (UniswapV2Factory) pair on each enabled ' +
    'chain, enumerated via allPairsLength()/allPairs() on the factory and priced by DefiLlama. ' +
    'HookSwap is an own-deployed Uniswap v2+v3 fork (supportsV4:false — no hooks). Enabled chains: ' +
    'Robinhood (4663), Ink (57073), XLayer (196), HyperEVM (chainId 999, sdk key "hyperliquid"), and ' +
    'Stable (988). v3 (UniswapV3Factory) is deployed on every chain but holds no confirmed liquidity, ' +
    'so the v3 export is intentionally disabled (a full PoolCreated log scan would return nothing). ' +
    'Test/unlisted tokens with no market price contribute $0.',
}

for (const [chain, factory] of Object.entries(V2_FACTORIES)) {
  module.exports[chain] = {
    tvl: getUniTVL({
      chain,
      factory,
      useDefaultCoreAssets: true, // no-op if the chain isn't in coreAssets.json -> raw reserve sum (still correct)
    }),
  }
}

// -------------------------------------------------------------------------------------------------
// CHAIN-SLUG DISCREPANCY (Robinhood) — must be reconciled with DefiLlama maintainers in the PR.
//   @defillama/sdk providers.json (carries RPC + chainId 4663) uses key  "robinhoodchain".
//   DefiLlama-Adapters projects/helper/chains.json instead lists the slug "robinhood".
// getUniTVL resolves the RPC via the sdk, so the module.exports key here is set to the sdk key
// "robinhoodchain" (the ONLY slug proven to carry the RPC). If DefiLlama's TVL harness attributes
// the chain from chains.json ("robinhood") it must alias the two. This is isolated to the map key
// above, so aligning is a 1-line change. (Verified live 2026-07-23: providers.json has
// "robinhoodchain" and NOT "robinhood".)
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// MEGAETH (4326) — HAS a real v2 pool (WETH/USDm, pair 0xAD12931B2ff618C4aFEA9d9BCB7508Ccb51fF674,
// v2Factory 0xD1Cf664944173140AFc302c169eFD55c24966B45), but is BLOCKED on a DefiLlama-side change:
//   @defillama/sdk providers.json has NO entry for chainId 4326 / no "megaeth" key (verified live
//   2026-07-23), so getUniTVL('megaeth') cannot resolve an RPC/chainId. NOTE: DefiLlama-Adapters'
//   projects/helper/chains.json DOES list "megaeth", but that list alone does not carry the RPC —
//   the sdk providers.json is what resolves on-chain reads, and it lacks 4326.
//
// TO UNBLOCK (one-file PR to DefiLlama/chainlist): add
//   constants/additionalChainRegistry/chainid-4326.js  (ready-to-submit copy committed in this repo
//   at defillama-adapters/chainlist/chainid-4326.js) — name/rpc(https://mainnet.megaeth.com/rpc)/
//   chainId 4326. Once merged + the sdk picks it up, uncomment the line below (confirm the resulting
//   sdk key — likely "megaeth"):
//
//   // V2_FACTORIES.megaeth = '0xD1Cf664944173140AFc302c169eFD55c24966B45'
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// TEMPO (4217) — intentionally OFF. Two independent reasons:
//   (1) NO usable pool: Tempo's account-abstraction-native tokens (pathUSD/USDC.e) revert on
//       approve() and on plain EOA transfer(), and v2Factory.createPair failed → no v2 pair exists
//       (contracts/deployments/pools-seeded.json → "blocked": tempo_4217).
//   (2) chainId 4217 / "tempo" is absent from @defillama/sdk providers.json anyway.
// v2Factory (for the record) = 0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4 (tempo.json).
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// v3 (all chains) — DISABLED. v3 factories are deployed but hold no confirmed liquidity, so enabling
// uniV3Export would run a per-chain PoolCreated log scan (needs the exact v3Factory deploy block) that
// returns nothing. To enable once v3 liquidity is seeded, merge v2 + v3 via mergeExports, e.g.:
//
//   const { uniV3Export } = require('../helper/uniswapV3')
//   const { mergeExports } = require('../helper/utils')
//   const v3 = uniV3Export({ robinhoodchain: { factory: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3', fromBlock: <deployBlock> } })
//   module.exports = mergeExports([{ ...v2map... }, v3])
//
// v3Factory per chain (contracts/deployments/<chain>.json):
//   robinhood 0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3 | ink 0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3
//   megaeth   0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3 | xlayer 0xAB34Bb3767020059A35e71D03f13E9e4fbCD07aC
//   hyperevm  0x45DB3eaE624dBcA631A9C6C1406DA0B8F6Fb275A | stable 0xf486e625C892C0739A16A3A49B37fD52374B30CB
// -------------------------------------------------------------------------------------------------
