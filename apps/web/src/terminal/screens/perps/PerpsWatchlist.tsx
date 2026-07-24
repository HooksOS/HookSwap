import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { EMPTY } from '~/terminal/screens/perps/perpsCatalog'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import type { PerpMarketView } from '~/terminal/perps/engine/marketView'

const MONO = terminalFonts.mono

/**
 * Markets watchlist — the live market directory (engine `GET /markets`, on-chain registry
 * fallback). Each row = symbol + tier/lev subrow. Per-row price / 24h change render an
 * honest '—' (the fixed engine contract has no per-market ticker endpoint yet — see the
 * PerpsScreen note); the row identity is REAL on-chain/engine data, never fabricated.
 * Selecting a row drives the rest of the desk.
 */
export function PerpsWatchlist({
  markets,
  selected,
  onSelect,
}: {
  markets: PerpMarketView[]
  selected?: string
  onSelect: (market: PerpMarketView) => void
}): JSX.Element {
  const isMobile = useIsMobileViewport()
  return (
    <div style={{ fontFamily: MONO }}>
      {markets.map((m) => {
        const on = m.address.toLowerCase() === selected?.toLowerCase()
        const sub = [m.catalogMaxLeverage ? `${m.catalogMaxLeverage}×` : undefined, m.tier === 1 ? 'perm' : m.tier === 0 ? 'curated' : undefined]
          .filter(Boolean)
          .join(' · ')
        return (
          <button
            key={m.address}
            type="button"
            onClick={() => onSelect(m)}
            style={{
              display: 'flex',
              width: '100%',
              alignItems: 'center',
              justifyContent: 'space-between',
              // Mobile: ≥44px tap target (native card-row feel); dense on desktop.
              padding: isMobile ? '11px 14px' : '8px 12px',
              minHeight: isMobile ? 48 : undefined,
              borderBottom: `1px solid ${terminalColors.line3}`,
              cursor: 'pointer',
              textAlign: 'left',
              border: 'none',
              background: on ? terminalColors.greenBg : 'transparent',
              boxShadow: on ? `inset 2px 0 0 ${terminalColors.brandGreen}` : 'none',
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: terminalColors.ink }}>{m.label}</div>
              <div style={{ fontSize: 9.5, color: terminalColors.ink3 }}>{sub || '—'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: terminalColors.ink3 }}>{EMPTY}</div>
              <div style={{ fontSize: 9.5, color: terminalColors.ink3 }}>{EMPTY}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
