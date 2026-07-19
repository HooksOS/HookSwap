/**
 * HookSwapPerps — instrument catalog + shared display helpers.
 *
 * DATA POLICY (no mock data — handoff hard rule):
 *   The HookSwapPerps matching-engine backend is NOT deployed yet. This module
 *   defines ONLY the intended instrument *catalog* — a pair label + its max
 *   leverage + settlement venue — which is static configuration, NOT market data.
 *   Every price / change / mark / index / funding / OI / volume / book / trade /
 *   position surface renders an HONEST empty ('—' / "unavailable" / skeleton)
 *   state until the live feed exists. Nothing in this file fabricates a price.
 */

export interface PerpInstrument {
  /** Market symbol, e.g. "BTC-PERP". */
  symbol: string
  /** Underlying base asset ticker (chart / ticket size unit), e.g. "BTC". */
  base: string
  /** Quote / margin asset the market settles in. */
  quote: string
  /** Max leverage offered on this market (config, not a live value). */
  maxLeverage: number
  /** Settlement venue label for the watchlist subrow (e.g. "v3"). */
  venue: string
}

/**
 * Planned HookSwapPerps instrument catalog. These are the markets the desk is
 * built to list — they carry NO live pricing here; the terminal binds price /
 * change / depth to the matching-engine feed once deployed.
 */
export const PERP_INSTRUMENTS: PerpInstrument[] = [
  { symbol: 'BTC-PERP', base: 'BTC', quote: 'USDG', maxLeverage: 100, venue: 'v3' },
  { symbol: 'ETH-PERP', base: 'ETH', quote: 'USDG', maxLeverage: 100, venue: 'v3' },
  { symbol: 'SOL-PERP', base: 'SOL', quote: 'USDG', maxLeverage: 50, venue: 'v3' },
  { symbol: 'HYPE-PERP', base: 'HYPE', quote: 'USDG', maxLeverage: 25, venue: 'v2' },
  { symbol: 'WIF-PERP', base: 'WIF', quote: 'USDG', maxLeverage: 20, venue: 'v2' },
]

/** Placeholder glyph rendered for every not-yet-available numeric surface. */
export const EMPTY = '—'
