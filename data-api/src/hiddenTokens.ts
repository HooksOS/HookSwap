/**
 * Test / seed tokens that must NEVER surface in any data-api response.
 *
 * The liquidity-seed configs (contracts/seed/config/*.json) mint placeholder test
 * tokens — tHOOK, tUSDC, tROBIN, a generic SeedTestToken/STT — purely to prove
 * pools quote. They are not real assets, so they must be filtered out of every
 * user-facing token/pool/search response the interface reads from this service
 * (listTokens, listTopPools, listPools, search, positions, transactions, …).
 * Only real tokens (ETH, USDG, WETH, HYPE, WOKB, …) show. Matched by symbol,
 * case-insensitive. Mirrors apps/web/src/terminal/utils/hiddenTokens.ts.
 */
export const HIDDEN_TOKEN_SYMBOLS: ReadonlySet<string> = new Set([
  'thook',
  'tusdc',
  'trobin',
  'stt',
  'seedtesttoken',
])

/** True when a token symbol is a hidden test/seed token (and must not be shown). */
export function isHiddenTokenSymbol(symbol?: string | null): boolean {
  return symbol ? HIDDEN_TOKEN_SYMBOLS.has(symbol.trim().toLowerCase()) : false
}

/** True when EITHER side of a pair is a hidden test/seed token → hide the whole pool. */
export function pairHasHiddenToken(symbol0?: string | null, symbol1?: string | null): boolean {
  return isHiddenTokenSymbol(symbol0) || isHiddenTokenSymbol(symbol1)
}
