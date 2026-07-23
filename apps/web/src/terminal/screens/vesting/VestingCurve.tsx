/**
 * HookSwap Terminal — Vesting curve graph (Ledger aesthetic).
 *
 * A real-data cliff + linear vesting curve for one on-chain schedule, matching the
 * contract's `vestedAmount(t)` exactly (`contracts/vesting/src/HookSwapVesting.sol`):
 *   • 0 before `start + cliff`
 *   • `total * (t - start) / duration` between cliff-end and `start + duration`
 *   • `total` after `start + duration`
 *
 * DATA POLICY (facts-only, no fabricated data): the curve SHAPE is the contract's
 * schedule (start / cliff / duration), and the "now" dot sits at the schedule's REAL
 * on-chain vested amount (`vested / total`) — not a client re-derivation of the amount.
 * The allocation bar splits the REAL claimed / claimable / locked figures. Nothing here
 * invents a value; a degenerate schedule (duration 0, total 0) renders an honest "—".
 *
 * Presentational-only; feed it a decoded `VestingScheduleRow`.
 */
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import type { VestingScheduleRow } from '~/terminal/vesting/useMySchedules'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

/** unix seconds → "Aug 20, 2026". */
function fmtDate(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return '—'
  }
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Percent 0–100 → a tight label (e.g. "42.1%", "<0.1%", "100%"). */
function fmtPct(pct: number): string {
  if (!Number.isFinite(pct)) {
    return '—'
  }
  if (pct <= 0) {
    return '0%'
  }
  if (pct > 0 && pct < 0.1) {
    return '<0.1%'
  }
  if (pct >= 100) {
    return '100%'
  }
  return `${pct.toFixed(1).replace(/\.0$/, '')}%`
}

/** Exact bigint ratio → float fraction 0..1 (basis-point precision, never overflows). */
function frac(part: bigint, whole: bigint): number {
  if (whole <= 0n) {
    return 0
  }
  const bps = (part * 1_000_000n) / whole
  return Math.max(0, Math.min(1, Number(bps) / 1_000_000))
}

export function VestingCurve({ row }: { row: VestingScheduleRow }): JSX.Element {
  const { start, cliff, duration, totalAmount, released, releasable, vested } = row
  const end = start + duration
  const cliffEnd = start + cliff
  const now = Math.floor(Date.now() / 1000)
  const span = Math.max(1, end - start)

  // Degenerate schedule → honest placeholder (contract requires duration > 0, but guard).
  if (duration <= 0 || totalAmount <= 0n) {
    return (
      <div
        style={{
          height: 120,
          borderRadius: 12,
          border: `1px dashed ${terminalColors.line}`,
          background: terminalColors.panel,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: SANS,
          fontSize: 12,
          color: terminalColors.ink3,
        }}
      >
        Vesting curve unavailable for this schedule.
      </div>
    )
  }

  // Curve control points in normalized [0,1]² — x is time-fraction over [start,end],
  // y is value-fraction. Mirrors the contract's piecewise `vestedAmount`.
  const cliffXf = Math.max(0, Math.min(1, cliff / duration))
  const pts: Array<[number, number]> =
    cliff <= 0 ? [[0, 0], [1, 1]] : [[0, 0], [cliffXf, 0], [cliffXf, cliffXf], [1, 1]]

  // SVG uses a 0..100 box with preserveAspectRatio="none" (x stretches to width). y is
  // inverted (f=1 → top). Stroke stays crisp via vector-effect non-scaling-stroke.
  const toXY = ([xf, f]: [number, number]): string => `${(xf * 100).toFixed(3)},${((1 - f) * 100).toFixed(3)}`
  const linePath = `M ${pts.map(toXY).join(' L ')}`
  const areaPath = `${linePath} L 100,100 L 0,100 Z`

  // "Now" position: x from real elapsed time, y from the REAL on-chain vested fraction.
  const nowXf = Math.max(0, Math.min(1, (now - start) / span))
  const vestedFrac = frac(vested, totalAmount)
  const pctVested = vestedFrac * 100

  const started = now >= start
  const complete = now >= end
  const inCliff = now < cliffEnd

  // Allocation bar segments (real amounts): claimed / claimable / locked, of total.
  const claimedPct = frac(released, totalAmount) * 100
  const claimablePct = frac(releasable, totalAmount) * 100
  const lockedPct = Math.max(0, 100 - claimedPct - claimablePct)

  return (
    <div>
      {/* header: label + %vested */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <span
          style={{
            fontFamily: SANS,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: terminalColors.faint,
          }}
        >
          Vesting curve
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em', color: complete ? terminalColors.ink3 : terminalColors.greenDeep }}>
          {fmtPct(pctVested)} vested{complete ? ' · complete' : inCliff ? ' · in cliff' : ''}
        </span>
      </div>

      {/* plot */}
      <div style={{ position: 'relative', height: 132, borderRadius: 12, border: `1px solid ${terminalColors.line2}`, background: terminalColors.panel, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: '8px 0' }}>
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: 'block' }}>
            <defs>
              <linearGradient id={`vfill-${String(row.id)}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={terminalColors.brandGreen} stopOpacity="0.16" />
                <stop offset="100%" stopColor={terminalColors.brandGreen} stopOpacity="0.02" />
              </linearGradient>
              <clipPath id={`vclip-${String(row.id)}`}>
                <rect x="0" y="0" width={(nowXf * 100).toFixed(3)} height="100" />
              </clipPath>
            </defs>
            {/* full theoretical schedule area (faint) */}
            <path d={areaPath} fill={terminalColors.line3} />
            {/* elapsed portion (stronger green fill), clipped to now */}
            <path d={areaPath} fill={`url(#vfill-${String(row.id)})`} clipPath={`url(#vclip-${String(row.id)})`} />
            <path d={areaPath} fill={terminalColors.greenBg} clipPath={`url(#vclip-${String(row.id)})`} opacity={0.5} />
            {/* the curve line */}
            <path d={linePath} fill="none" stroke={terminalColors.brandGreen} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
        </div>

        {/* cliff marker (gold dashed) */}
        {cliff > 0 && cliffXf > 0.02 && cliffXf < 0.98 ? (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${cliffXf * 100}%`, width: 0, borderLeft: `1px dashed ${terminalColors.warn}`, opacity: 0.8 }} />
        ) : null}

        {/* now marker + dot on the real vested point */}
        {started && !complete ? (
          <>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${nowXf * 100}%`, width: 0, borderLeft: `1.5px solid ${terminalColors.greenDeep}` }} />
            <div
              style={{
                position: 'absolute',
                left: `${nowXf * 100}%`,
                top: `calc(8px + ${(1 - vestedFrac) * 100}% - ${(1 - vestedFrac) * 16}px)`,
                width: 10,
                height: 10,
                marginLeft: -5,
                marginTop: -5,
                borderRadius: '50%',
                background: terminalColors.brandGreen,
                border: `2px solid ${terminalColors.bg}`,
                boxShadow: terminalColors.greenBorder ? `0 0 0 2px ${terminalColors.greenBorder}` : undefined,
              }}
            />
          </>
        ) : null}
      </div>

      {/* endpoint axis */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8, gap: 8 }}>
        <AxisLabel caption="Start" value={fmtDate(start)} align="left" />
        {cliff > 0 ? (
          <AxisLabel caption="Cliff" value={fmtDate(cliffEnd)} align="center" tone="warn" />
        ) : null}
        <AxisLabel caption={complete ? 'Ended' : 'Ends'} value={fmtDate(end)} align="right" />
      </div>

      {/* allocation bar — real claimed / claimable / locked split */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: terminalColors.panel2 }}>
          {claimedPct > 0 ? <div title="Claimed" style={{ width: `${claimedPct}%`, background: terminalColors.ink3 }} /> : null}
          {claimablePct > 0 ? <div title="Claimable now" style={{ width: `${claimablePct}%`, background: terminalColors.greenUp }} /> : null}
          {lockedPct > 0 ? <div title="Locked" style={{ width: `${lockedPct}%`, background: 'transparent' }} /> : null}
        </div>
        <div style={{ display: 'flex', gap: '4px 16px', flexWrap: 'wrap', marginTop: 8 }}>
          <LegendDot color={terminalColors.ink3} label="Claimed" />
          <LegendDot color={terminalColors.greenUp} label="Claimable" />
          <LegendDot color={terminalColors.line} label="Locked" ring />
        </div>
      </div>
    </div>
  )
}

function AxisLabel({
  caption,
  value,
  align,
  tone,
}: {
  caption: string
  value: string
  align: 'left' | 'center' | 'right'
  tone?: 'warn'
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', minWidth: 0 }}>
      <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: tone === 'warn' ? terminalColors.warn : terminalColors.ink, whiteSpace: 'nowrap' }}>{value}</span>
      <span style={{ fontFamily: SANS, fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: terminalColors.faint, marginTop: 1 }}>{caption}</span>
    </div>
  )
}

function LegendDot({ color, label, ring }: { color: string; label: string; ring?: boolean }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: ring ? 'transparent' : color,
          border: ring ? `1.5px solid ${color}` : undefined,
        }}
      />
      <span style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.ink3 }}>{label}</span>
    </span>
  )
}
