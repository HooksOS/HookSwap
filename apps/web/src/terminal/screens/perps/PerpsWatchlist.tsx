import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { EMPTY } from '~/terminal/screens/perps/perpsCatalog'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import type { PerpMarketView } from '~/terminal/perps/engine/marketView'
import type { ResolvedMarketName } from '~/terminal/perps/factory/useMarketNames'

const MONO = terminalFonts.mono

function shortenAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
}

/**
 * Markets watchlist — the live market directory (engine `GET /markets`, on-chain registry
 * fallback). Each row = the derived market NAME ("ETH-PERP", from the market's Chainlink
 * refFeed description) + a secondary line (collateral symbol · tier · short address). When a
 * name can't be derived, the primary is the honest short-address fallback ("MKT 0x…") the
 * enriched `m.label` already carries. Per-row price / 24h change render an honest '—' (the
 * engine has no per-market ticker endpoint yet); identity is REAL on-chain/engine data, never
 * fabricated. Selecting a row drives the rest of the desk.
 */
export function PerpsWatchlist({
  markets,
  names,
  selected,
  onSelect,
}: {
  markets: PerpMarketView[]
  /** Lowercased market address → derived name (collateral symbol lives here too). */
  names?: ReadonlyMap<string, ResolvedMarketName>
  selected?: string
  onSelect: (market: PerpMarketView) => void
}): JSX.Element {
  const isMobile = useIsMobileViewport()
  return (
    <div style={{ fontFamily: MONO }}>
      {markets.map((m) => {
        const on = m.address.toLowerCase() === selected?.toLowerCase()
        const resolved = names?.get(m.address.toLowerCase())
        const tierLabel = m.tier === 1 ? 'perm' : m.tier === 0 ? 'curated' : undefined
        // When we derived a name, the primary shows it → surface the collateral + short
        // address as secondary (disambiguates markets that share a feed, e.g. ETH-PERP ×N).
        // Otherwise keep the leverage · tier subrow.
        const sub = resolved
          ? [
              resolved.collateralSymbol ? `${resolved.collateralSymbol} collateral` : undefined,
              tierLabel,
              shortenAddr(m.address),
            ]
              .filter(Boolean)
              .join(' · ')
          : [m.catalogMaxLeverage ? `${m.catalogMaxLeverage}×` : undefined, tierLabel]
              .filter(Boolean)
              .join(' · ')
        return (
          <button
            key={m.address}
            type="button"
            onClick={() => onSelect(m)}
            title={
              resolved
                ? `${resolved.name}${resolved.refFeedDescription ? ` · feed ${resolved.refFeedDescription}` : ''} · ${m.address}`
                : m.address
            }
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
