import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { EMPTY } from '~/terminal/screens/perps/perpsCatalog'

const MONO = terminalFonts.mono

/** One order-book level. Kept for the live feed; empty for now. */
export interface BookLevel {
  price: number
  size: number
}

function HeadRow(): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        padding: '6px 12px',
        color: terminalColors.ink3,
        fontSize: 9.5,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        borderBottom: `1px solid ${terminalColors.line3}`,
      }}
    >
      <span>Price</span>
      <span style={{ textAlign: 'right' }}>Size</span>
      <span style={{ textAlign: 'right' }}>Total</span>
    </div>
  )
}

function LevelRow({ level, side, total, max }: { level: BookLevel; side: 'bid' | 'ask'; total: number; max: number }): JSX.Element {
  const color = side === 'ask' ? terminalColors.redDown : terminalColors.brandGreen
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '2.5px 12px', position: 'relative' }}>
      <span
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: `${(level.size / (max || 1)) * 100}%`,
          background: color,
          opacity: 0.1,
        }}
      />
      <span style={{ color }}>{level.price.toFixed(1)}</span>
      <span style={{ textAlign: 'right' }}>{level.size.toFixed(2)}</span>
      <span style={{ textAlign: 'right' }}>{total.toFixed(2)}</span>
    </div>
  )
}

/** Coarse feed state driving the honest empty message. */
export type OrderBookStatus = 'idle' | 'loading' | 'live' | 'polling' | 'unavailable'

function emptyMessage(status: OrderBookStatus): string {
  switch (status) {
    case 'idle':
      return 'Select a market'
    case 'loading':
      return 'Loading order book…'
    case 'unavailable':
      return 'Order book unavailable'
    default:
      return 'No resting orders'
  }
}

/**
 * Order book — bids (green) / asks (red) with depth bars and a mid spread row.
 * Binds to the engine feed via useOrderbook. With no levels it renders the column
 * header + an honest status note (loading / unavailable / empty). Never invents levels.
 */
export function OrderBook({
  bids = [],
  asks = [],
  status = 'idle',
  spread,
}: {
  bids?: BookLevel[]
  asks?: BookLevel[]
  status?: OrderBookStatus
  spread?: number
}): JSX.Element {
  const empty = !bids.length && !asks.length
  const max = Math.max(1, ...bids.map((b) => b.size), ...asks.map((a) => a.size))

  return (
    <div style={{ fontFamily: MONO, fontSize: 11.5, color: terminalColors.ink }}>
      <HeadRow />
      {empty ? (
        <div style={{ padding: 14, textAlign: 'center', fontSize: 10.5, color: terminalColors.faint }}>
          {emptyMessage(status)}
        </div>
      ) : (
        <>
          {(() => {
            let running = 0
            return asks
              .slice()
              .reverse()
              .map((a, i) => {
                running += a.size
                return <LevelRow key={`a${i}`} level={a} side="ask" total={running} max={max} />
              })
          })()}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 12px',
              borderTop: `1px solid ${terminalColors.line3}`,
              borderBottom: `1px solid ${terminalColors.line3}`,
              fontWeight: 600,
            }}
          >
            <span style={{ color: terminalColors.ink3, fontSize: 10 }}>
              SPREAD {spread !== undefined ? spread.toLocaleString('en-US', { maximumFractionDigits: 2 }) : EMPTY}
            </span>
          </div>
          {(() => {
            let running = 0
            return bids.map((b, i) => {
              running += b.size
              return <LevelRow key={`b${i}`} level={b} side="bid" total={running} max={max} />
            })
          })()}
        </>
      )}
    </div>
  )
}
