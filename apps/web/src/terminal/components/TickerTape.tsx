import { useMemo } from 'react'

/** One instrument on the tape. All values are pre-formatted strings from a live source. */
export interface TickerItem {
  /** Pair or token symbol, e.g. "ETH/USDG". */
  symbol: string
  /** Formatted price string, e.g. "1,877.65". */
  price: string
  /** Formatted signed change, e.g. "+3.31%". */
  change: string
  /** Direction for colour; null renders neutral. */
  up: boolean | null
}

/**
 * HookSwap Terminal — "Desk" ticker tape.
 *
 * The signature top strip of the Daylight redesign: a continuous marquee of live
 * pairs (mono symbol + price + coloured delta, hairline-separated). Pauses on
 * hover; respects prefers-reduced-motion (CSS). Presentational — the caller
 * supplies real `items`; when empty it shows an honest single-line notice, never
 * fabricated tickers.
 */
export function TickerTape({
  items,
  emptyLabel = 'Token feed unavailable right now.',
}: {
  items: TickerItem[]
  emptyLabel?: string
}): JSX.Element {
  // Duplicate the list so the -50% keyframe wraps seamlessly.
  const doubled = useMemo(() => (items.length ? [...items, ...items] : []), [items])

  if (!doubled.length) {
    return (
      <div className="tm-tape tm-tape--empty">
        <span>{emptyLabel}</span>
      </div>
    )
  }

  return (
    <div className="tm-tape">
      <div className="tm-tape__track">
        {doubled.map((it, i) => (
          <span className="tm-tape__item" key={i}>
            <span className="tm-tape__sym">{it.symbol}</span>
            <span className="tm-tape__price">{it.price}</span>
            <span className={it.up == null ? 'tm-tape__flat' : it.up ? 'tm-tape__up' : 'tm-tape__down'}>
              {it.change}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
