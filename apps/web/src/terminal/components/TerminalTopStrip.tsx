import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useListTokens } from '~/features/Explore/state/listTokens/useListTokens'
import { TickerTape, type TickerItem } from '~/terminal/components/TickerTape'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { isHiddenTokenSymbol } from '~/terminal/utils/hiddenTokens'

/**
 * The Terminal "top": a live token ticker tape + a status strip (TOKEN FEED / GAS /
 * BLOCK / ROUTING), mounted as the TerminalShell `subBar` so EVERY inner screen
 * (swap, markets, perps, …) shows the same top as the landing/proposal — not just
 * the landing. Data-bound + honest: prices are live (test/seed tokens filtered);
 * GAS/BLOCK have no client source so they read "—"; feed state reflects the query.
 */
const MONO = terminalFonts.mono

function fmtUsd(v?: number): string {
  if (v == null || !isFinite(v)) {
    return '—'
  }
  if (v >= 1000) {
    return `$${(v / 1000).toFixed(2)}K`
  }
  if (v >= 1) {
    return `$${v.toFixed(2)}`
  }
  return `$${v.toFixed(4)}`
}

function fmtPct(v?: number): string {
  if (v == null || !isFinite(v)) {
    return '—'
  }
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

export function TerminalTopStrip(): JSX.Element {
  const navigate = useNavigate()
  const { topTokens, isLoading, isError } = useListTokens(undefined)

  const items: TickerItem[] = useMemo(
    () =>
      (topTokens ?? [])
        .filter((t) => !isHiddenTokenSymbol(t.symbol) && typeof t.stats?.price === 'number')
        .slice(0, 12)
        .map((t) => ({
          symbol: t.symbol,
          price: fmtUsd(t.stats?.price),
          change: t.stats?.priceChange1d != null ? fmtPct(t.stats.priceChange1d) : '—',
          up: t.stats?.priceChange1d == null ? null : t.stats.priceChange1d >= 0,
        })),
    [topTokens],
  )

  const feed = isError ? 'OFFLINE' : items.length ? 'LIVE' : isLoading ? 'SETTLING' : 'SETTLING'
  const emptyLabel = isError
    ? 'Token feed unavailable right now.'
    : isLoading
      ? 'Loading token feed…'
      : 'No token prices yet — builds as trading activity accrues.'

  return (
    <>
      <TickerTape items={items} emptyLabel={emptyLabel} onSelect={() => navigate('/swap')} />
      <div
        style={{
          borderBottom: `1px solid ${terminalColors.line}`,
          background: terminalColors.bg,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          height: 32,
          padding: '0 var(--tm-gutter)',
          fontFamily: MONO,
          fontSize: 11,
          color: terminalColors.ink3,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 6,
              height: 6,
              background: feed === 'LIVE' ? terminalColors.brandGreen : feed === 'OFFLINE' ? terminalColors.redDown : terminalColors.warn,
            }}
          />
          TOKEN FEED · {feed}
        </span>
        <span>GAS —</span>
        <span>BLOCK —</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: terminalColors.brandGreen }}>
          ● ROUTING · EMBED
        </span>
      </div>
    </>
  )
}
