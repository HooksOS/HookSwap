/*
 * MegaETH mainnet — ready-to-submit DefiLlama chain registration.
 * ==============================================================
 * WHY THIS FILE EXISTS: MegaETH mainnet (chainId 4326) has a REAL HookSwap v2 pool (WETH/USDm, pair
 * 0xAD12931B2ff618C4aFEA9d9BCB7508Ccb51fF674, v2Factory 0xD1Cf664944173140AFc302c169eFD55c24966B45 —
 * see this repo's contracts/deployments/pools-seeded.json), but chainId 4326 is ABSENT from
 * @defillama/sdk's build/providers.json (verified live 2026-07-23: no "megaeth" key, no key with
 * chainId 4326). Because both the TVL adapter (getUniTVL, resolves RPC via the sdk) and the
 * volume/fees adapter (dimension-adapters, no MEGAETH_RPC in helpers/env.ts either) rely on that
 * registry to resolve an RPC + chainId, MegaETH cannot be enabled until DefiLlama registers the chain.
 *
 * TO ENABLE MEGAETH: submit this file to DefiLlama/chainlist as
 *   constants/additionalChainRegistry/chainid-4326.js
 * (this is the exact `export const data = {...}` structure that repo's other chainid-*.js files use).
 * Once merged and the sdk build picks it up, uncomment the megaeth lines in:
 *   - defillama-adapters/hookswap/index.js      (V2_FACTORIES.megaeth = '0xD1Cf6649…')
 *   - defillama-adapters/dexs/hookswap/index.ts (CONFIG[CHAIN.MEGAETH] = { factory, start })
 *
 * Every field below is VERIFIED — chainId from a live eth_chainId (0x10e6 == 4326) against
 * https://mainnet.megaeth.com/rpc, and the RPCs / explorer / native symbol from this repo's own
 * chain definition packages/uniswap/src/features/chains/evm/info/megaeth.ts.
 */
export const data = {
  "name": "MegaETH",
  "chain": "MegaETH",
  "rpc": [
    "https://mainnet.megaeth.com/rpc",
    "https://megaeth.drpc.org"
  ],
  "features": [{ "name": "EIP155" }],
  "faucets": [],
  "nativeCurrency": {
    "name": "Ether",
    "symbol": "ETH",
    "decimals": 18
  },
  "infoURL": "https://megaeth.com/",
  "shortName": "megaeth",
  "chainId": 4326,
  "networkId": 4326,
  "explorers": [
    {
      "name": "MegaETH Explorer",
      "url": "https://megaeth.blockscout.com",
      "standard": "EIP3091"
    }
  ]
}
