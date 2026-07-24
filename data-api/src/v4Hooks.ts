/**
 * HookSwap-native v4 HOOK ALLOWLIST — the provenance gate for Uniswap-v4 pool discovery.
 *
 * WHY THIS EXISTS
 * ---------------
 * Uniswap v4 is a SHARED SINGLETON: every chain has ONE canonical `PoolManager`, and EVERY project's
 * pools (HookSwap's + the whole rest of the chain's ecosystem) are initialized on it. On Robinhood the
 * canonical PoolManager `0x8366a39c…` has ~10,855 `Initialize` events, the vast majority FOREIGN
 * (Robinhood-ecosystem / other projects). Indexing them all buries HookSwap's own pools in Markets.
 *
 * Unlike v2/v3 — where HookSwap deployed its OWN factories (`0xD1Cf66…` / `0xAa1f5B…` etc.), so a pool's
 * factory address alone proves provenance — v4 has no per-project factory. The ONLY on-chain provenance
 * signal for a v4 pool is its `PoolKey.hooks` address (emitted in `Initialize`). So a v4 pool is
 * "HookSwap-native" iff its `hooks` is a HookSwap-OWNED hook contract.
 *
 * MECHANISM (never disable v4 wholesale — just gate by this list)
 * ---------------------------------------------------------------
 *  - INGEST: a v4 pool is only persisted when its `Initialize.hooks` is allowlisted for that chain.
 *  - SERVE:  already-stored v4 rows are re-checked against the allowlist so a prior unfiltered backfill's
 *            foreign rows stop showing immediately (plus a one-time purge — see purgeForeignV4Pools).
 *  - A chain with NO known HookSwap v4 hook → EMPTY list → ALL its v4 pools excluded (correct: HookSwap
 *    has no native v4 there). When HookSwap deploys a new v4 hook, adding its address here surfaces it.
 *
 * PROVENANCE — every address below is VERIFIED HookSwap-owned (facts-only; on-chain + repo/SDK sourced).
 * Never add a hook you cannot verify is HookSwap's.
 *
 * Robinhood (4663) — the only chain with HookSwap v4 hooks today:
 *   - 0x0a09eedc… — the flagship $HOOK/WETH v4 pool's actual on-chain `hooks` (poolId
 *       0x49437c07…, currency1 = $HOOK 0x85d4e6F1…, 1,226 swaps). VERIFIED on-chain 2026-07-24 (cast:
 *       Initialize of that pool → hooks=0x0a09eedc…). Same ERC-1967/UUPS proxy bytecode family as the
 *       three SDK hooks below, and the same pool's LP is custodied by HookSwap's LPFeeSplitter — a solid
 *       provenance chain to HookSwap's launchpad.
 *   - 0x45F98307… — StockTaxHook (StockRewardLauncherV4's v4 beforeSwap/afterSwap tax hook). Source:
 *       @hookos/sdk STOCK_REWARD_ADDRESSES.taxHook (chain 4663). HookSwap's own launchpad SDK.
 *   - 0xA71B7482… — LaunchHook, the shared permissionless v4 hook attached to every RHLaunchpad pool.
 *       Source: @hookos/sdk QUICK_LAUNCH_ADDRESSES.launchHook (chain 4663).
 *   - 0xa3df1c29… — LPFeeSplitter. In-repo HookSwap contract (apps/web/.../launchpad/addresses.ts,
 *       locker-indexer RECOGNIZED_LP_CUSTODY). NOTE: on-chain it is the flagship $HOOK LP-POSITION
 *       CUSTODIAN / fee-splitter, NOT the pool's `hooks` (the pool's hook is 0x0a09eedc… above), so it
 *       does not currently match any pool's `hooks`. Kept here defensively — it is verifiably a HookSwap
 *       contract, so allowlisting it can never surface a foreign pool.
 *
 * MegaETH (4326) / Ink (57073) / XLayer (196) / Sepolia (11155111): no HookSwap v4 hook has been
 * deployed/verified (HookSwap's v4 launchpad hooks are Robinhood-only; the @hookos/sdk StockReward +
 * QuickLaunch suites are 4663-only, and the HookOS V3 launcher on other chains is v3, not v4). → no
 * entry → every v4 pool on those chains is excluded until a real HookSwap v4 hook is added here.
 */

/** Per-chain HookSwap v4 hook allowlist. Addresses lowercased (compared case-insensitively). */
export const HOOKSWAP_V4_HOOKS: Record<number, string[]> = {
  // Robinhood (4663)
  4663: [
    '0x0a09eedc282c7cd4360bdf3cc683112da1a780cc', // flagship $HOOK/WETH v4 pool hook (on-chain verified)
    '0x45f983076500a670eb12b2f3aa6863d53dc880cc', // StockTaxHook (@hookos/sdk STOCK_REWARD_ADDRESSES.taxHook)
    '0xa71b7482439c4f147abfe23cba5312770f31c0c4', // LaunchHook / RHLaunchpad (@hookos/sdk QUICK_LAUNCH_ADDRESSES.launchHook)
    '0xa3df1c2969452ad3f0c3ca041430e2a8ee2ffa80', // LPFeeSplitter (HookSwap custodian; defensive — not a live pool hook)
  ],
  // MegaETH (4326), Ink (57073), XLayer (196), Sepolia (11155111): no verified HookSwap v4 hook → all v4 excluded.
}

/**
 * Is `hooks` a HookSwap-owned v4 hook on `chainId`? Case-insensitive. Returns false for the zero hook,
 * any foreign hook, and every chain with no allowlist entry (→ all its v4 pools are excluded). This is
 * the single provenance predicate used by BOTH the ingest filter and the serve-side guards.
 */
export function isHookSwapV4Hook(chainId: number, hooks: string | undefined | null): boolean {
  if (!hooks) {
    return false
  }
  const allow = HOOKSWAP_V4_HOOKS[chainId]
  if (!allow || allow.length === 0) {
    return false
  }
  return allow.includes(hooks.toLowerCase())
}
