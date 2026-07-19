import { CSSProperties } from 'react'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono

/** One open perp position. Kept for the live feed; empty for now. */
export interface PerpPosition {
  market: string
  side: 'long' | 'short'
  size: string
  entry: string
  mark: string
  liq: string
  uPnl: string
  margin: string
}

const COLUMNS = ['Market', 'Side', 'Size', 'Entry', 'Mark', 'Liq.', 'uPnL', 'Margin', ''] as const

/**
 * Positions table — market / side / size / entry / mark / liq / uPnL / margin /
 * close. Renders honest empty states: disconnected → "Connect wallet to trade",
 * connected → "No open positions". Never invents a position.
 */
export function PositionsTable({
  positions = [],
  connected,
}: {
  positions?: PerpPosition[]
  connected: boolean
}): JSX.Element {
  const th = {
    fontFamily: MONO,
    fontSize: 9.5,
    letterSpacing: '0.09em',
    textTransform: 'uppercase' as const,
    color: terminalColors.ink3,
    padding: '8px 14px',
    borderBottom: `1px solid ${terminalColors.line}`,
    fontWeight: 600,
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: 12, color: terminalColors.ink }}>
      <thead>
        <tr>
          {COLUMNS.map((c, i) => (
            <th key={i} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {positions.length ? (
          positions.map((p, i) => (
            <tr key={i}>
              <td style={cell('left')}>{p.market}</td>
              <td style={cell('right')}>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: 4,
                    color: p.side === 'long' ? terminalColors.brandGreen : terminalColors.redDown,
                    background: p.side === 'long' ? terminalColors.greenBg : terminalColors.redBg,
                  }}
                >
                  {p.side}
                </span>
              </td>
              <td style={cell('right')}>{p.size}</td>
              <td style={cell('right')}>{p.entry}</td>
              <td style={cell('right')}>{p.mark}</td>
              <td style={cell('right')}>{p.liq}</td>
              <td style={{ ...cell('right'), color: p.uPnl.startsWith('-') ? terminalColors.redDown : terminalColors.brandGreen }}>
                {p.uPnl}
              </td>
              <td style={cell('right')}>{p.margin}</td>
              <td style={cell('right')}>
                <button
                  type="button"
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: terminalColors.ink2,
                    border: `1px solid ${terminalColors.line}`,
                    borderRadius: 6,
                    padding: '3px 9px',
                    background: terminalColors.bg,
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={COLUMNS.length} style={{ padding: '26px 14px', textAlign: 'center', fontSize: 11, color: terminalColors.faint }}>
              {connected ? 'No open positions' : 'Connect wallet to trade'}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function cell(align: 'left' | 'right'): CSSProperties {
  return { textAlign: align, padding: '10px 14px', borderBottom: `1px solid ${terminalColors.line3}` }
}
