import { CSSProperties } from 'react'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
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
  const isMobile = useIsMobileViewport()

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

  // Mobile: native card rows instead of a 9-column table (no sideways scroll).
  if (isMobile) {
    if (!positions.length) {
      return (
        <div style={{ padding: '26px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
          {!connected ? 'Connect wallet to trade' : loading ? 'Loading positions…' : 'No open positions'}
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {positions.map((p, i) => {
          const isPending = pendingPairId !== undefined && pendingPairId === p.pairId
          const otherPending = pendingPairId !== undefined && !isPending
          const disabled = !onClose || closeDisabled || isPending || otherPending
          return (
            <div
              key={i}
              style={{
                padding: '13px 14px',
                borderBottom: `1px solid ${terminalColors.line3}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {/* Header: market + side badge · uPnL */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: terminalColors.ink }}>{p.market}</span>
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
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 13,
                    fontWeight: 600,
                    color: p.uPnl.startsWith('-') ? terminalColors.redDown : terminalColors.brandGreen,
                  }}
                >
                  {p.uPnl}
                </span>
              </div>
              {/* Stat grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '9px 12px' }}>
                <CardStat label="Size" value={p.size} />
                <CardStat label="Entry" value={p.entry} />
                <CardStat label="Mark" value={p.mark} />
                <CardStat label="Liq." value={p.liq} />
                <CardStat label="Margin" value={p.margin} />
              </div>
              {/* Close — full-width, ≥44px tap target */}
              <button
                type="button"
                onClick={onClose && !disabled ? () => onClose(p) : undefined}
                disabled={disabled}
                style={{
                  fontFamily: MONO,
                  fontSize: 12,
                  minHeight: 44,
                  color: isPending ? terminalColors.ink3 : terminalColors.ink2,
                  border: `1px solid ${terminalColors.line}`,
                  borderRadius: 8,
                  background: terminalColors.bg,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled && !isPending ? 0.5 : 1,
                }}
              >
                {isPending ? 'Closing…' : 'Close position'}
              </button>
            </div>
          )
        })}
      </div>
    )
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

/** A labelled stat inside a mobile position/order card. */
function CardStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: terminalColors.faint }}>
        {label}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 12.5, color: terminalColors.ink }}>{value}</span>
    </div>
  )
}
