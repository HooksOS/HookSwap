import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono

/** One printed trade. Kept for the live feed; empty for now. */
export interface Trade {
  price: number
  size: number
  time: string
  side: 'buy' | 'sell'
}

/**
 * Trades feed — recent prints (green buy / red sell). With no feed (current
 * honest state) renders the header + a "No trades yet" note. Never invents fills.
 */
export function TradesFeed({ trades = [] }: { trades?: Trade[] }): JSX.Element {
  return (
    <div style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.ink }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr auto',
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
        <span style={{ textAlign: 'right' }}>Time</span>
      </div>
      {trades.length ? (
        trades.map((tr, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', padding: '2.5px 12px' }}>
            <span style={{ color: tr.side === 'buy' ? terminalColors.brandGreen : terminalColors.redDown }}>
              {tr.price.toFixed(1)}
            </span>
            <span style={{ textAlign: 'right' }}>{tr.size.toFixed(2)}</span>
            <span style={{ textAlign: 'right', color: terminalColors.ink3 }}>{tr.time}</span>
          </div>
        ))
      ) : (
        <div style={{ padding: 14, textAlign: 'center', fontSize: 10.5, color: terminalColors.faint }}>No trades yet</div>
      )}
    </div>
  )
}
