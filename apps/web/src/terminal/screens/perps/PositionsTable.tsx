import { CSSProperties } from 'react'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono

/** One open perp position, decoded from an on-chain `PairedPosition`. */
export interface PerpPosition {
  /** On-chain pairId — the argument `closePair(uint256)` takes. */
  pairId: bigint
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
  loading = false,
  onClose,
  pendingPairId,
  closeDisabled = false,
}: {
  positions?: PerpPosition[]
  connected: boolean
  loading?: boolean
  onClose?: (position: PerpPosition) => void
  /** The pairId whose close tx is in flight — that row's button shows a pending state. */
  pendingPairId?: bigint
  /** True when the close flow can't run at all (no wallet / wrong chain / no market). */
  closeDisabled?: boolean
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
                {(() => {
                  const isPending = pendingPairId !== undefined && pendingPairId === p.pairId
                  // A different row's close is in flight → lock the others while it settles.
                  const otherPending = pendingPairId !== undefined && !isPending
                  const disabled = !onClose || closeDisabled || isPending || otherPending
                  return (
                    <button
                      type="button"
                      onClick={onClose && !disabled ? () => onClose(p) : undefined}
                      disabled={disabled}
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        color: isPending ? terminalColors.ink3 : terminalColors.ink2,
                        border: `1px solid ${terminalColors.line}`,
                        borderRadius: 6,
                        padding: '3px 9px',
                        background: terminalColors.bg,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled && !isPending ? 0.5 : 1,
                      }}
                    >
                      {isPending ? 'Closing…' : 'Close'}
                    </button>
                  )
                })()}
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={COLUMNS.length} style={{ padding: '26px 14px', textAlign: 'center', fontSize: 11, color: terminalColors.faint }}>
              {!connected ? 'Connect wallet to trade' : loading ? 'Loading positions…' : 'No open positions'}
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
