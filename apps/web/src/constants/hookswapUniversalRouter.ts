import { UNIVERSAL_ROUTER_ADDRESS, UniversalRouterVersion } from '@uniswap/universal-router-sdk'
import { UniverseChainId } from 'uniswap/src/features/chains/types'

/**
 * HookSwap-aware Universal Router address resolver.
 *
 * The upstream `@uniswap/universal-router-sdk` `CHAIN_CONFIGS` has NO entry for the
 * HookSwap custom chains, so `UNIVERSAL_ROUTER_ADDRESS()` either THROWS
 * ("Universal Router not deployed on chain" — 999/4663/4326/57073) or returns a
 * wrong/zero address (196/4217). This wrapper returns the REAL deployed
 * HookSwap-owned Universal Router for those chains (from
 * `contracts/deployments/<chain>.json`) and delegates every other chain
 * (Mainnet, Sepolia, canonical L2s) to the SDK unchanged.
 *
 * NOTE (validate before GA): the deployed UR is the newer v4+Across fork (11-field
 * RouterParameters, v4 fields zeroed). The address is correct here, but the swap
 * CALLDATA is produced by this SDK's `SwapRouter.swapCallParameters` — its command
 * set must match what the deployed router accepts. Confirm the deployed
 * `supportedURVersions` (`_2_0`) against the calldata on a testnet swap before
 * enabling execution on the custom chains. Address resolution ≠ version compat.
 */
const HOOKSWAP_UNIVERSAL_ROUTER: Partial<Record<UniverseChainId, string>> = {
  [UniverseChainId.MegaETH]: '0x3D30133F4d4A80684F02d8310faF572E3dc193b3',
  [UniverseChainId.Robinhood]: '0x3D30133F4d4A80684F02d8310faF572E3dc193b3',
  [UniverseChainId.Ink]: '0x3D30133F4d4A80684F02d8310faF572E3dc193b3',
  [UniverseChainId.XLayer]: '0x6d8a0783213B3b06648DB3708a89732af3661005',
  [UniverseChainId.HyperEvm]: '0xD9d4795F2A12305a12C36455ADAD011F2D6143AB',
  [UniverseChainId.Tempo]: '0x62aE013cb2b232C20094B466C94bb39714eF661E',
  [UniverseChainId.Stable]: '0x35dB40f22143651159056285E92c113ECE65E7e2',
}

/**
 * Drop-in replacement for the SDK's `UNIVERSAL_ROUTER_ADDRESS(version, chainId)`.
 * For HookSwap custom chains the `version` arg is intentionally ignored (there is a
 * single deployed UR per chain); for all others it delegates to the SDK verbatim.
 */
export function hookswapUniversalRouterAddress(version: UniversalRouterVersion, chainId: number): string {
  const own = HOOKSWAP_UNIVERSAL_ROUTER[chainId as UniverseChainId]
  return own ?? UNIVERSAL_ROUTER_ADDRESS(version, chainId)
}

/**
 * Canonical Uniswap **v4-capable** Universal Routers, per chain — on-chain verified
 * (each `poolManager()` resolves to that chain's v4 PoolManager). See
 * `V4-ENABLEMENT-PLAN.md` §4. HookSwap's OWN URs (`HOOKSWAP_UNIVERSAL_ROUTER` above)
 * were deployed with `v4PoolManager = address(0)` and CANNOT execute `V4_SWAP`, so a
 * **v4 route must use the canonical v4 UR here**, not the own UR. v2/v3 routes keep
 * using the own UR. (Sepolia delegates to the SDK, but is pinned here for clarity.)
 */
const HOOKSWAP_V4_UNIVERSAL_ROUTER: Partial<Record<UniverseChainId, string>> = {
  [UniverseChainId.Robinhood]: '0x8876789976dEcBfCbBbe364623C63652db8C0904',
  [UniverseChainId.Ink]: '0x112908dac86e20e7241b0927479ea3bf935d1fa0',
  [UniverseChainId.MegaETH]: '0x47837eb80db5908eabba9105626d9b348bea7b02',
  [UniverseChainId.XLayer]: '0xda00ae15d3a71466517129255255db7c0c0956d3',
  [UniverseChainId.Tempo]: '0xa2dc7d0266f0cc50b3eeaf36c9bfcecff1beea91',
  [UniverseChainId.Sepolia]: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b',
}

/** Universal Router address to use for a **v4** route on `chainId` (undefined = chain has no canonical Uniswap v4). */
export function hookswapV4UniversalRouterAddress(chainId: number): string | undefined {
  return HOOKSWAP_V4_UNIVERSAL_ROUTER[chainId as UniverseChainId]
}

/**
 * Universal Routers that are the Robinhood **`minHopPriceX36` fork** (non-canonical:
 * V2/V3 swap inputs decode 6 fields, not 5). BOTH the RH v2/v3 UR (`0x3D3013…`) and
 * the RH v4 UR (`0x8876…`) are this fork — verified on-chain. The adapter's
 * `patchMinHopPriceCalldata` shim MUST run for these and MUST NOT run for standard
 * URs (Sepolia/Ink/MegaETH/XLayer/Tempo). Gate the shim on THIS, not on own-vs-canonical.
 */
const MINHOP_FORK_UNIVERSAL_ROUTERS: ReadonlySet<string> = new Set(
  ['0x3D30133F4d4A80684F02d8310faF572E3dc193b3', '0x8876789976dEcBfCbBbe364623C63652db8C0904'].map((a) =>
    a.toLowerCase(),
  ),
)

/** True if `routerAddress` is a Robinhood `minHopPriceX36`-fork UR that needs the 6-field calldata shim. */
export function isMinHopForkUniversalRouter(routerAddress: string): boolean {
  return MINHOP_FORK_UNIVERSAL_ROUTERS.has(routerAddress.toLowerCase())
}
