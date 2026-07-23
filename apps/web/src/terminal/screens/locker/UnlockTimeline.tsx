/**
 * HookSwap Locker — Unlock timeline / countdown bar.
 *
 * A real-data graph for the proof-of-lock detail page: a horizontal progress bar
 * spanning `lockedOn → now → unlockTime`, filled by the fraction of the lock
 * period already elapsed, with a "now" marker and a live countdown. Everything is
 * derived from the lock's own on-chain timestamps (createdAt / unlockTime) — nothing
 * is fabricated. When the lock is already unlockable the bar reads 100% + an honest
 * "Unlocked" state.
 *
 * Styled with the Ledger primitives' palette (terminalColors / terminalFonts) to
 * match `LedgerTvlChart` / `LedgerDonut`.
 */
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

/** unix seconds → "Aug 20, 2026". */
function fmtDate(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return '—'
  }
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Human-friendly remaining/elapsed duration, e.g. "142 days", "5 hours", "3 min". */
function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  if (d >= 1) {
    return `${d.toLocaleString('en-US')} day${d === 1 ? '' : 's'}`
  }
  const h = Math.floor(s / 3600)
  if (h >= 1) {
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  const m = Math.floor(s / 60)
  if (m >= 1) {
    return `${m} min`
  }
  return '< 1 min'
}

export function UnlockTimeline({
  createdAt,
  unlockTime,
  unlockable,
}: {
  createdAt: number
  unlockTime: number
  /** From the indexer status — treat as the source of truth for the unlocked state. */
  unlockable: boolean
}): JSX.Element {
  const now = Math.floor(Date.now() / 1000)
  const span = Math.max(1, unlockTime - createdAt)
  const elapsed = Math.min(span, Math.max(0, now - createdAt))
  const pct = unlockable ? 100 : Math.max(0, Math.min(100, (elapsed / span) * 100))
  const remaining = Math.max(0, unlockTime - now)

  const accent = unlockable ? terminalColors.warn : terminalColors.brandGreen
  const track = terminalColors.panel2
  const fillBg = unlockable ? terminalColors.warnBg : terminalColors.greenBg

  return (
    <div style={{ marginTop: 20 }}>
      {/* header: label + live countdown */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <span
          style={{
            fontFamily: SANS,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: terminalColors.faint,
          }}
        >
          Unlock timeline
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em', color: accent }}>
          {unlockable ? '🔓 Unlocked' : `${fmtDuration(remaining)} remaining`}
        </span>
      </div>

      {/* progress track with elapsed fill + now marker */}
      <div
        style={{
          position: 'relative',
          height: 12,
          borderRadius: 999,
          background: track,
          overflow: 'hidden',
          border: `1px solid ${terminalColors.line2}`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${pct}%`,
            background: fillBg,
            borderRight: pct > 0 && pct < 100 ? `2px solid ${accent}` : undefined,
            transition: 'width 300ms ease',
          }}
        />
      </div>

      {/* endpoints + percent */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: terminalColors.ink }}>{fmtDate(createdAt)}</span>
          <span style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 1 }}>Locked on</span>
        </div>
        <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.ink3 }}>
          {pct >= 100 ? '100' : pct.toFixed(pct < 1 ? 2 : 0)}% elapsed
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: accent }}>{fmtDate(unlockTime)}</span>
          <span style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 1 }}>
            {unlockable ? 'Unlocked' : 'Unlocks'}
          </span>
        </div>
      </div>
    </div>
  )
}
