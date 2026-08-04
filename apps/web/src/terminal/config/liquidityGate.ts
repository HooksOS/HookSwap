/**
 * HookSwap Terminal — protocol-liquidity feature gate.
 *
 * HookSwap's own seeded liquidity has been withdrawn from every chain, so any
 * surface that depends on PROTOCOL-supplied liquidity would either fail
 * (swap quotes → NO_ROUTE) or report a near-zero protocol TVL. Those surfaces
 * render an honest "COMING SOON" state instead.
 *
 * Surfaces where the USER supplies the liquidity are deliberately NOT gated and
 * stay fully live: create pool / add + remove liquidity / positions, farms,
 * locker, vesting, launchpad, portfolio. Those write straight to the deployed
 * V2/V3 routers and never read the protocol pool feed.
 *
 * Flip both flags back to `true` once liquidity is re-seeded. Same shape as
 * `hooksGate.ts` — a hard constant, not a `FeatureFlags` entry, so it cannot be
 * switched on by a stale remote config.
 */

/** Swap / quote / routing surfaces (swap ticket, token trade ticket, embed widget). */
export const SWAP_LIVE = false

/** Protocol-wide TVL / volume / depth / analytics surfaces. */
export const PROTOCOL_STATS_LIVE = false

/** Hook returning whether swap surfaces should render live (vs. gated). */
export function useSwapLive(): boolean {
  return SWAP_LIVE
}

/** Hook returning whether protocol-stats surfaces should render live (vs. gated). */
export function useProtocolStatsLive(): boolean {
  return PROTOCOL_STATS_LIVE
}
