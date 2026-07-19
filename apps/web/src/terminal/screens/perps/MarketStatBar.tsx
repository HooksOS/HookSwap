import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { EMPTY } from '~/terminal/screens/perps/perpsCatalog'
import type { PerpMarketView } from '~/terminal/perps/engine/marketView'

const MONO = terminalFonts.mono

/**
 * Market stat bar — pair + badge, big mark price, 24h change, mark/index, funding,
 * open interest, 24h volume. Mirrors the `.mktbar` in the Pro Desk reference exactly.
 *
 * DATA POLICY: pair identity + max-leverage badge come from the selected market view
 * (engine/registry — real). The big MARK price binds to the engine feed (last trade /
 * order-book mid) when live, else an honest '—'. 24h change / index / funding / open
 * interest / 24h volume render '—' because the FIXED engine contract exposes no ticker
 * endpoint for them yet (see the note in PerpsScreen) — never fabricated.
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

export function MarketStatBar({
  market,
  markPrice,
  maxLeverageX,
}: {
  market?: PerpMarketView
  markPrice?: number
  maxLeverageX?: number
}): JSX.Element {
  const symbol = market?.label ?? 'PERP'
  const lev = maxLeverageX ?? market?.catalogMaxLeverage
  const markStr = markPrice !== undefined ? markPrice.toLocaleString('en-US', { maximumFractionDigits: 2 }) : EMPTY

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
        <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: terminalColors.ink }}>{symbol}</span>
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
          Perp{lev ? ` · ${lev}×` : ''}
        </span>
      </div>
      {/* Big mark price — binds to the engine feed; honest '—' until a trade prints. */}
      <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, color: markPrice !== undefined ? terminalColors.ink : terminalColors.ink3 }}>
        {markStr}
      </div>
      <Stat k="24h Change" v={EMPTY} color={terminalColors.ink3} />
      <Stat k="Mark / Index" v={`${markStr} / ${EMPTY}`} />
      <Stat k="Funding / 1h" v={EMPTY} color={terminalColors.warn} />
      <Stat k="Open Interest" v={EMPTY} />
      <Stat k="24h Volume" v={EMPTY} />
    </div>
  )
}
