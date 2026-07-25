import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { EMPTY } from '~/terminal/screens/perps/perpsCatalog'
import type { PerpMarketView } from '~/terminal/perps/engine/marketView'
import { MarketSelect } from '~/terminal/screens/perps/MarketSelect'
import type { ResolvedMarketName } from '~/terminal/perps/factory/useMarketNames'

const MONO = terminalFonts.mono

/**
 * Market stat bar — pair + badge, big mark price, 24h change, mark/index, funding,
 * open interest, 24h volume. Mirrors the `.mktbar` in the Pro Desk reference exactly.
 *
 * DATA POLICY: pair identity + max-leverage badge come from the selected market view
 * (engine/registry — real). Every price/stat binds to the engine `GET /ticker` (mark +
 * index from the market's on-chain Chainlink refFeed; 24h change / volume / open
 * interest from mark history + settled trades + on-chain positions). A field renders
 * '—' ONLY where the ticker returned null (not yet computable) — never fabricated.
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

/** Price-style number: up to 2 decimals with thousands separators. */
function fmtPrice(v: number | undefined): string {
  return v !== undefined ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : EMPTY
}

/** Compact number for volume / open interest, e.g. 1.24M, 3.1K. */
function fmtCompact(v: number | undefined): string {
  if (v === undefined) {
    return EMPTY
  }
  return v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })
}

/** Signed percent with sign, e.g. +2.31% / -0.84%. */
function fmtPct(v: number | undefined): string {
  if (v === undefined) {
    return EMPTY
  }
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

export function MarketStatBar({
  market,
  mark,
  indexPrice,
  change24hPct,
  volume24h,
  openInterest,
  fundingRatePct,
  maxLeverageX,
  markets,
  names,
  onSelectMarket,
}: {
  market?: PerpMarketView
  mark?: number
  indexPrice?: number
  change24hPct?: number
  volume24h?: number
  openInterest?: number
  fundingRatePct?: number
  maxLeverageX?: number
  /** When supplied, the symbol becomes a market switcher (see MarketSelect). */
  markets?: PerpMarketView[]
  names?: ReadonlyMap<string, ResolvedMarketName>
  onSelectMarket?: (m: PerpMarketView) => void
}): JSX.Element {
  const symbol = market?.label ?? 'PERP'
  const collateralSymbol = market ? names?.get(market.address.toLowerCase())?.collateralSymbol : undefined
  const lev = maxLeverageX ?? market?.catalogMaxLeverage
  const markStr = fmtPrice(mark)

  const changeColor =
    change24hPct === undefined
      ? terminalColors.ink3
      : change24hPct >= 0
        ? terminalColors.brandGreen
        : terminalColors.redDown
  const base = market?.base ?? ''

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
        {markets && onSelectMarket ? (
          <MarketSelect markets={markets} names={names} selected={market} onSelect={onSelectMarket} />
        ) : (
          <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: terminalColors.ink }}>{symbol}</span>
        )}
        {/* Collateral is a per-market on-chain property (set at createMarket), not a
            user setting — showing it here stops "why is this WETH?" being a mystery. */}
        {collateralSymbol ? (
          <span
            title={`This market settles in ${collateralSymbol}. Collateral is fixed per market.`}
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: terminalColors.ink3,
              background: terminalColors.panel2,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 5,
              padding: '2px 6px',
              whiteSpace: 'nowrap',
            }}
          >
            {collateralSymbol} margin
          </span>
        ) : null}
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
      {/* Big mark price — binds to the ticker; honest '—' until the engine has a mark. */}
      <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, color: mark !== undefined ? terminalColors.ink : terminalColors.ink3 }}>
        {markStr}
      </div>
      <Stat k="24h Change" v={fmtPct(change24hPct)} color={changeColor} />
      <Stat k="Mark / Index" v={`${markStr} / ${fmtPrice(indexPrice)}`} />
      <Stat k="Funding / 1h" v={fundingRatePct !== undefined ? fmtPct(fundingRatePct) : EMPTY} color={terminalColors.warn} />
      <Stat k="Open Interest" v={openInterest !== undefined ? `${fmtCompact(openInterest)}${base ? ` ${base}` : ''}` : EMPTY} />
      <Stat k="24h Volume" v={fmtCompact(volume24h)} />
    </div>
  )
}
