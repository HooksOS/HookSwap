/**
 * HookSwap Terminal — shared "Ledger" composition donut.
 *
 * A conic-gradient donut + legend, factored from PortfolioScreen's `AllocationDonut`
 * so the Locker / Farms / Vesting analytics views share ONE donut style. Percentages
 * and numbers use IBM Plex Mono; labels use IBM Plex Sans. Honest states: loading →
 * skeleton legend; no positive slices → an honest empty note (never a fabricated ring).
 * Callers pass real, already-computed slice values — this component only renders them.
 */
import { useMemo } from 'react'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

export interface DonutSlice {
  label: string
  /** Non-negative magnitude; slices with value ≤ 0 are omitted from the ring + legend. */
  value: number
  color: string
  /** Optional secondary text shown before the percent (e.g. a formatted count). */
  hint?: string
}

export function LedgerDonut({
  slices,
  loading = false,
  size = 116,
  centerLabel,
  centerValue,
  emptyText = 'No data yet.',
}: {
  slices?: DonutSlice[]
  loading?: boolean
  size?: number
  centerLabel?: string
  centerValue?: string
  emptyText?: string
}): JSX.Element {
  const visible = useMemo(() => (slices ?? []).filter((s) => s.value > 0), [slices])
  const total = useMemo(() => visible.reduce((sum, s) => sum + s.value, 0), [visible])

  const gradient = useMemo(() => {
    if (total <= 0) {
      return undefined
    }
    let acc = 0
    const stops = visible.map((s) => {
      const start = (acc / total) * 100
      acc += s.value
      const end = (acc / total) * 100
      return `${s.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`
    })
    return `conic-gradient(${stops.join(',')})`
  }, [visible, total])

  const hole = Math.round(size * 0.32)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0 }}>
      <div style={{ position: 'relative', flexShrink: 0, width: size, height: size }}>
        <div
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: loading || !gradient ? terminalColors.line2 : gradient,
          }}
        />
        {/* Donut hole — optional big number in the middle */}
        <div
          style={{
            position: 'absolute',
            inset: hole,
            borderRadius: '50%',
            background: terminalColors.bg,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {!loading && centerValue ? (
            <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: terminalColors.ink, letterSpacing: '-0.02em' }}>
              {centerValue}
            </span>
          ) : null}
          {!loading && centerLabel ? (
            <span
              style={{
                fontFamily: SANS,
                fontSize: 9.5,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: terminalColors.faint,
                marginTop: 2,
              }}
            >
              {centerLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
        {loading ? (
          Array.from({ length: 3 }, (_, i) => (
            <div key={i} style={{ height: 12, width: '70%', borderRadius: 4, background: terminalColors.line2 }} />
          ))
        ) : visible.length === 0 ? (
          <span style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt, lineHeight: 1.5 }}>{emptyText}</span>
        ) : (
          visible.map((s) => {
            const pct = total > 0 ? (s.value / total) * 100 : 0
            return (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                <span
                  style={{
                    fontFamily: SANS,
                    fontSize: 12.5,
                    color: terminalColors.ink2,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.label}
                </span>
                {s.hint ? <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>{s.hint}</span> : null}
                <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: terminalColors.ink, minWidth: 42, textAlign: 'right' }}>
                  {pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
