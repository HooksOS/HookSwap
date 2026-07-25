/**
 * Header market selector — the symbol itself is the switcher.
 *
 * The watchlist column has always been able to change markets, but nothing marked
 * it as interactive: it reads as a static ticker, so "how do I pick a market?" was
 * a fair question even from someone who built the thing. Every trading UI puts the
 * selector on the symbol in the title, so that is where this goes.
 *
 * It also surfaces what actually distinguishes these markets. Several are all
 * "ETH-PERP" on the same feed, and the only real differences are the COLLATERAL
 * they settle in (WETH vs USDG — a per-market on-chain property set at creation,
 * not a user choice) and the tier. Both are shown per row.
 */
import { useEffect, useRef, useState } from 'react'
import type { PerpMarketView } from '~/terminal/perps/engine/marketView'
import type { ResolvedMarketName } from '~/terminal/perps/factory/useMarketNames'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

function shorten(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export function MarketSelect({
  markets,
  names,
  selected,
  onSelect,
}: {
  markets: PerpMarketView[]
  names?: ReadonlyMap<string, ResolvedMarketName>
  selected?: PerpMarketView
  onSelect: (m: PerpMarketView) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  // Close on outside click / Escape — a dropdown that traps the user is worse than
  // no dropdown.
  useEffect(() => {
    if (!open) {
      return undefined
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = selected?.label ?? 'Select market'
  const q = query.trim().toLowerCase()
  const shown = q
    ? markets.filter((m) => {
        const n = names?.get(m.address.toLowerCase())
        return (
          (m.label ?? '').toLowerCase().includes(q) ||
          m.address.toLowerCase().includes(q) ||
          (n?.collateralSymbol ?? '').toLowerCase().includes(q)
        )
      })
    : markets

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch market"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: MONO,
          fontSize: 19,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: terminalColors.ink,
          background: 'transparent',
          border: `1px solid ${open ? terminalColors.greenBorder : 'transparent'}`,
          borderRadius: 9,
          padding: '3px 9px 3px 7px',
          cursor: 'pointer',
        }}
      >
        {label}
        <span style={{ fontSize: 11, color: terminalColors.ink3, transform: open ? 'rotate(180deg)' : undefined }}>
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 60,
            minWidth: 320,
            maxHeight: 380,
            overflowY: 'auto',
            background: terminalColors.panel,
            border: `1px solid ${terminalColors.line}`,
            borderRadius: 12,
            boxShadow: '0 12px 34px rgba(0,0,0,0.28)',
            padding: 6,
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol, collateral or address…"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontFamily: SANS,
              fontSize: 12.5,
              color: terminalColors.ink,
              background: terminalColors.panel2,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 8,
              padding: '7px 10px',
              marginBottom: 6,
              outline: 'none',
            }}
          />

          {shown.length === 0 ? (
            <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3, padding: '10px 8px' }}>
              No market matches “{query}”.
            </div>
          ) : (
            shown.map((m) => {
              const on = m.address.toLowerCase() === selected?.address.toLowerCase()
              const n = names?.get(m.address.toLowerCase())
              const tier = m.tier === 1 ? 'permissionless' : m.tier === 0 ? 'curated' : undefined
              return (
                <button
                  key={m.address}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    onSelect(m)
                    setOpen(false)
                    setQuery('')
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: on ? terminalColors.greenBg : 'transparent',
                    border: `1px solid ${on ? terminalColors.greenBorder : 'transparent'}`,
                    borderRadius: 9,
                    padding: '8px 10px',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 13,
                      fontWeight: 600,
                      color: on ? terminalColors.greenDeep : terminalColors.ink,
                    }}
                  >
                    {n?.name ?? m.label ?? shorten(m.address)}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.ink3, marginTop: 2 }}>
                    {[
                      // Collateral is THE differentiator between otherwise-identical
                      // markets, so it leads the sub-line.
                      n?.collateralSymbol ? `${n.collateralSymbol} margin` : undefined,
                      tier,
                      shorten(m.address),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </button>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
