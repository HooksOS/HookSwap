/**
 * HookSwapPerps — open (resting) orders table.
 *
 * Renders the engine's `EngineOpenOrder` rows (side / type / size / price / leverage / age)
 * with a per-row Cancel button. All numbers use IBM Plex Mono; green = long, red = short.
 * Honest states only — disconnected → "Connect wallet", wrong chain → "Switch to Sepolia",
 * loading → "Loading orders…", empty → "No open orders". Never invents an order.
 *
 * Units mirror the rest of the desk: size/remaining/price are 1e18-scaled decimal strings,
 * leverage is 1e4-scaled (see SIZE/PRICE/LEVERAGE_PRECISION in perpMarketAbi). MARKET orders
 * carry no limit price → shown as '—'.
 */
import { CSSProperties } from 'react'
import { formatUnits } from 'viem'
import type { EngineOpenOrder } from '~/terminal/perps/engine/client'
import { LEVERAGE_PRECISION, PRICE_PRECISION, SIZE_PRECISION } from '~/terminal/perps/engine/perpMarketAbi'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono

const COLUMNS = ['Side', 'Type', 'Size', 'Price', 'Lev.', 'Age', ''] as const

function fmtScaled(raw: string, decimals: number, maxFrac: number): string {
  try {
    const n = Number(formatUnits(BigInt(raw), decimals))
    if (!Number.isFinite(n)) {
      return '—'
    }
    return n.toLocaleString('en-US', { maximumFractionDigits: maxFrac })
  } catch {
    return '—'
  }
}

/** Size cell — show `remaining / size` only when partially filled, else just the size. */
function fmtSize(order: EngineOpenOrder): string {
  const size = fmtScaled(order.size, SIZE_PRECISION, 4)
  if (order.remaining !== order.size) {
    return `${fmtScaled(order.remaining, SIZE_PRECISION, 4)} / ${size}`
  }
  return size
}

function fmtPrice(order: EngineOpenOrder): string {
  // MARKET orders have no limit price (engine sends 0).
  if (order.orderType === 'MARKET') {
    return '—'
  }
  return fmtScaled(order.price, PRICE_PRECISION, 2)
}

function fmtLeverage(raw: string): string {
  // leverage is 1e4-scaled (LEVERAGE_PRECISION) — mirror usePlaceOrder's `/ BigInt(LEVERAGE_PRECISION)`.
  try {
    const n = Number(BigInt(raw)) / LEVERAGE_PRECISION
    if (!Number.isFinite(n)) {
      return '—'
    }
    return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}x`
  } catch {
    return '—'
  }
}

/** Relative age from a unix-ms `receivedAt`. */
function fmtAge(receivedAt: number): string {
  if (!Number.isFinite(receivedAt) || receivedAt <= 0) {
    return '—'
  }
  const s = Math.max(0, Math.floor((Date.now() - receivedAt) / 1000))
  if (s < 60) {
    return `${s}s`
  }
  const m = Math.floor(s / 60)
  if (m < 60) {
    return `${m}m`
  }
  const h = Math.floor(m / 60)
  if (h < 24) {
    return `${h}h`
  }
  return `${Math.floor(h / 24)}d`
}

/**
 * Open orders table. Mirrors PositionsTable styling. The Cancel button shows "Canceling…"
 * while this row's `orderId === pendingOrderId`; other rows lock while any cancel is in flight.
 */
export function OpenOrdersTable({
  orders = [],
  connected,
  wrongChain = false,
  loading = false,
  onCancel,
  pendingOrderId,
  cancelDisabled = false,
}: {
  orders?: EngineOpenOrder[]
  connected: boolean
  wrongChain?: boolean
  loading?: boolean
  onCancel?: (order: EngineOpenOrder) => void
  /** The orderId whose cancel is in flight — that row's button shows a pending state. */
  pendingOrderId?: string
  /** True when the cancel flow can't run at all (no wallet / wrong chain / no market / engine down). */
  cancelDisabled?: boolean
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

  const emptyText = !connected
    ? 'Connect wallet to view orders'
    : wrongChain
      ? 'Switch to Sepolia to view orders'
      : loading
        ? 'Loading orders…'
        : 'No open orders'

  // Mobile: native card rows instead of a 7-column table (no sideways scroll).
  if (isMobile) {
    if (!orders.length) {
      return (
        <div style={{ padding: '26px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
          {emptyText}
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {orders.map((o) => {
          const isPending = pendingOrderId !== undefined && pendingOrderId === o.orderId
          const otherPending = pendingOrderId !== undefined && !isPending
          const disabled = !onCancel || cancelDisabled || isPending || otherPending
          return (
            <div
              key={o.orderId}
              style={{
                padding: '13px 14px',
                borderBottom: `1px solid ${terminalColors.line3}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {/* Header: side badge + type · age */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: 4,
                      color: o.side === 'long' ? terminalColors.brandGreen : terminalColors.redDown,
                      background: o.side === 'long' ? terminalColors.greenBg : terminalColors.redBg,
                    }}
                  >
                    {o.side}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: terminalColors.ink }}>{o.orderType}</span>
                </span>
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: terminalColors.ink3 }}>{fmtAge(o.receivedAt)}</span>
              </div>
              {/* Stat grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '9px 12px' }}>
                <OrderCardStat label="Size" value={fmtSize(o)} />
                <OrderCardStat label="Price" value={fmtPrice(o)} />
                <OrderCardStat label="Lev." value={fmtLeverage(o.leverage)} />
              </div>
              {/* Cancel — full-width, ≥44px tap target */}
              <button
                type="button"
                onClick={onCancel && !disabled ? () => onCancel(o) : undefined}
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
                {isPending ? 'Canceling…' : 'Cancel order'}
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
        {orders.length ? (
          orders.map((o) => (
            <tr key={o.orderId}>
              <td style={cell('left')}>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: 4,
                    color: o.side === 'long' ? terminalColors.brandGreen : terminalColors.redDown,
                    background: o.side === 'long' ? terminalColors.greenBg : terminalColors.redBg,
                  }}
                >
                  {o.side}
                </span>
              </td>
              <td style={cell('right')}>{o.orderType}</td>
              <td style={cell('right')}>{fmtSize(o)}</td>
              <td style={cell('right')}>{fmtPrice(o)}</td>
              <td style={cell('right')}>{fmtLeverage(o.leverage)}</td>
              <td style={{ ...cell('right'), color: terminalColors.ink3 }}>{fmtAge(o.receivedAt)}</td>
              <td style={cell('right')}>
                {(() => {
                  const isPending = pendingOrderId !== undefined && pendingOrderId === o.orderId
                  // A different row's cancel is in flight → lock the others while it settles.
                  const otherPending = pendingOrderId !== undefined && !isPending
                  const disabled = !onCancel || cancelDisabled || isPending || otherPending
                  return (
                    <button
                      type="button"
                      onClick={onCancel && !disabled ? () => onCancel(o) : undefined}
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
                      {isPending ? 'Canceling…' : 'Cancel'}
                    </button>
                  )
                })()}
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={COLUMNS.length} style={{ padding: '26px 14px', textAlign: 'center', fontSize: 11, color: terminalColors.faint }}>
              {emptyText}
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

/** A labelled stat inside a mobile open-order card. */
function OrderCardStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: terminalColors.faint }}>
        {label}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 12.5, color: terminalColors.ink }}>{value}</span>
    </div>
  )
}
