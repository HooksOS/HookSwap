/**
 * Blocklist of test / liquidity-seed placeholder tokens that must NEVER surface in any user-facing
 * token, pool, or search GraphQL response served by this gateway adapter.
 *
 * These symbols come from the on-chain seed configs (SeedLiquidity / SeedPools) — tHOOK ("Test Hook
 * Token"), tUSDC, tROBIN, STT / SeedTestToken — they are mint test tokens, not real assets, so they
 * are filtered out of every local resolver that returns tokens or pools (see resolvers.ts). Filtering
 * is by SYMBOL, case-insensitively.
 */

/** Lowercased symbols to hide from every token/pool/search response. */
const HIDDEN_TOKEN_SYMBOLS: ReadonlySet<string> = new Set<string>([
  'thook',
  'tusdc',
  'trobin',
  'stt',
  'seedtesttoken',
])

/** True if a token symbol is a blocked test/seed placeholder (case-insensitive; nullish -> false). */
export function isHiddenTokenSymbol(symbol: string | null | undefined): boolean {
  if (!symbol) {
    return false
  }
  return HIDDEN_TOKEN_SYMBOLS.has(symbol.trim().toLowerCase())
}

/** True if EITHER side of a pair is a blocked test/seed placeholder token. */
export function pairHasHiddenToken(sym0: string | null | undefined, sym1: string | null | undefined): boolean {
  return isHiddenTokenSymbol(sym0) || isHiddenTokenSymbol(sym1)
}
