import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { EMPTY, PERP_INSTRUMENTS, PerpInstrument } from '~/terminal/screens/perps/perpsCatalog'

const MONO = terminalFonts.mono

/**
 * Markets watchlist — the perp instrument catalog (symbol + max-lev·venue
 * subrow). Price / 24h change render an honest '—' until the live feed exists;
 * the row identity is static config, not fabricated market data. Selecting a row
 * drives the rest of the desk.
 */
export function PerpsWatchlist({
  selected,
  onSelect,
}: {
  selected: string
  onSelect: (instrument: PerpInstrument) => void
}): JSX.Element {
  return (
    <div style={{ fontFamily: MONO }}>
      {PERP_INSTRUMENTS.map((inst) => {
        const on = inst.symbol === selected
        return (
          <button
            key={inst.symbol}
            type="button"
            onClick={() => onSelect(inst)}
            style={{
              display: 'flex',
              width: '100%',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderBottom: `1px solid ${terminalColors.line3}`,
              cursor: 'pointer',
              textAlign: 'left',
              border: 'none',
              background: on ? terminalColors.greenBg : 'transparent',
              boxShadow: on ? `inset 2px 0 0 ${terminalColors.brandGreen}` : 'none',
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: terminalColors.ink }}>{inst.symbol}</div>
              <div style={{ fontSize: 9.5, color: terminalColors.ink3 }}>
                {inst.maxLeverage}× · {inst.venue}
              </div>
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
