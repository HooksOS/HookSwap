import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { EMPTY, PerpInstrument } from '~/terminal/screens/perps/perpsCatalog'

const MONO = terminalFonts.mono

/**
 * Market stat bar — pair + badge, big mark price, 24h change, mark/index,
 * funding, open interest, 24h volume. Mirrors the `.mktbar` in the Pro Desk
 * reference exactly (26px gaps, 12/18 padding, hairline bottom border).
 *
 * All live numbers render an honest '—' until the matching-engine feed exists;
 * only the pair identity + max-leverage badge (static catalog) are shown.
 */
function Stat({ k, v, color }: { k: string; v: string; color?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: terminalColors.ink3,
        }}
      >
        {k}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: color ?? terminalColors.ink }}>{v}</span>
    </div>
  )
}

export function MarketStatBar({ instrument }: { instrument: PerpInstrument }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 26,
        padding: '12px 18px',
        background: terminalColors.bg,
        borderBottom: `1px solid ${terminalColors.line}`,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: terminalColors.ink }}>
          {instrument.symbol}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: terminalColors.brandGreen,
            background: terminalColors.greenBg,
            border: `1px solid ${terminalColors.greenBorder}`,
            borderRadius: 5,
            padding: '2px 6px',
          }}
        >
          Perp · {instrument.maxLeverage}×
        </span>
      </div>
      {/* Big mark price — honest empty until the feed exists. */}
      <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, color: terminalColors.ink3 }}>{EMPTY}</div>
      <Stat k="24h Change" v={EMPTY} color={terminalColors.ink3} />
      <Stat k="Mark / Index" v={`${EMPTY} / ${EMPTY}`} />
      <Stat k="Funding / 1h" v={EMPTY} color={terminalColors.warn} />
      <Stat k="Open Interest" v={EMPTY} />
      <Stat k="24h Volume" v={EMPTY} />
    </div>
  )
}
