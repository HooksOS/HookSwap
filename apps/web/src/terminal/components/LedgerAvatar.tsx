/**
 * HookSwap Terminal — shared "Ledger" hue avatar.
 *
 * A deterministic circular token/pair avatar whose hue is derived from a seed string
 * (address / pair key), used by BOTH the Locker and Farms Ledger rows so identical
 * seeds render an identical colour across views. Purely presentational.
 */
import { terminalFonts } from '~/terminal/theme/tokens'

/** Deterministic legible avatar colour from a seed string (stable hue). */
export function ledgerAvatarColor(seed: string): string {
  let h = 0
  const s = seed.toLowerCase()
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 360
  }
  return `hsl(${h}, 52%, 42%)`
}

export function LedgerAvatar({
  seed,
  initials,
  size = 34,
}: {
  seed: string
  initials: string
  size?: number
}): JSX.Element {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: ledgerAvatarColor(seed),
        color: '#fff',
        fontFamily: terminalFonts.mono,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '-0.02em',
      }}
    >
      {initials}
    </div>
  )
}
