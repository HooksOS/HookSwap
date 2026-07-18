/**
 * HookSwap Terminal — B2 Swap left "Markets" InstrumentPanel (LIVE token list).
 *
 * Desk / Daylight redesign: a dense mono market list wrapped in the shared
 * `InstrumentPanel` (uppercase-mono header bar + hairline frame on cool paper).
 * Each row is a pure mono line — symbol + sub (chain) on the left, live USD price
 * over a colored 24h delta on the right; the selected row gets a green left tick
 * (inset box-shadow) + a soft-green fill. Clicking a row hands a real sdk-core
 * `Currency` back to the swap ticket as the output token.
 *
 * DATA POLICY (no mock data — handoff hard rule):
 *   • Rows join the app's real `useListTokens(chainId)` feed — the same list that
 *     powers `/explore`. Price / 24h change come straight from each token's `stats`.
 *     Loading renders honest skeleton rows; a chain the backend doesn't index comes
 *     back empty → honest "No markets" state; query failure → honest error line. NO
 *     fabricated rows, prices, or deltas ever.
 */
import type { MultichainToken } from '@uniswap/client-data-api/dist/data/v1/types_pb'
import type { Currency } from '@uniswap/sdk-core'
import { useMemo } from 'react'
import type { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import { currencyId } from 'uniswap/src/utils/currencyId'
import { NumberType } from 'utilities/src/format/types'
import { gqlToCurrency } from '~/appGraphql/data/util'
import { TokenSortMethod } from '~/components/Tokens/constants'
import { useListTokens } from '~/features/Explore/state/listTokens/useListTokens'
import type { UseListTokensOptions } from '~/features/Explore/state/listTokens/types'
import { multichainTokenToDisplayToken } from '~/features/Explore/state/listTokens/utils/multichainTokenToDisplayToken'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5, 6, 7]

/** Signed percent, 2 decimals: 2.4 → "+2.40%", -3.4 → "-3.40%". */
function formatSignedPct(value: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}%`
}

/* --------------------------------------------------------------- row model */

interface MarketRow {
  key: string
  currency: Currency
  id: string
  symbol: string
  /** Secondary line under the symbol — the chain label (real, from currency.chainId). */
  secondary: string
  price: number | undefined
  change1d: number | undefined
}

/**
 * Convert a `MultichainToken` → real sdk-core `Currency` via the app's existing
 * helpers: `multichainTokenToDisplayToken` (picks the deployment on `chainId`) →
 * `gqlToCurrency` (native-aware). Returns undefined when the token has no
 * deployment on `chainId`.
 */
function toRow(token: MultichainToken, chainId: UniverseChainId): MarketRow | undefined {
  const display = multichainTokenToDisplayToken({ mcToken: token, exploreChainId: chainId })
  if (!display) {
    return undefined
  }
  const currency = gqlToCurrency(display)
  if (!currency) {
    return undefined
  }
  const id = currencyId(currency)
  const stats = token.stats
  return {
    key: token.multichainId || id,
    currency,
    id,
    symbol: token.symbol || currency.symbol || '—',
    secondary: getChainLabel(chainId),
    price: stats?.price,
    change1d: stats?.priceChange1d,
  }
}

/* ------------------------------------------------------------------- row */

function MarketRowView({
  row,
  active,
  onSelect,
}: {
  row: MarketRow
  active: boolean
  onSelect: () => void
}): JSX.Element {
  const { convertFiatAmountFormatted } = useLocalizationContext()

  const priceText =
    row.price !== undefined && row.price > 0 ? convertFiatAmountFormatted(row.price, NumberType.FiatTokenPrice) : '—'

  const hasChange = row.change1d !== undefined
  const changeColor = !hasChange
    ? terminalColors.faint
    : (row.change1d as number) >= 0
      ? terminalColors.greenUp
      : terminalColors.redDown

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 6,
        alignItems: 'center',
        padding: '10px 14px',
        borderBottom: `1px solid ${terminalColors.line3}`,
        background: active ? terminalColors.greenBg : 'transparent',
        boxShadow: active ? `inset 2px 0 0 ${terminalColors.brandGreen}` : undefined,
        cursor: 'pointer',
      }}
    >
      {/* PAIR: symbol + chain sub */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: 12.5,
            color: terminalColors.ink,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {row.symbol}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            color: terminalColors.ink3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {row.secondary}
        </div>
      </div>

      {/* PRICE: price over 24h delta */}
      <div style={{ textAlign: 'right', minWidth: 0 }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 12.5,
            color: priceText === '—' ? terminalColors.faint : terminalColors.ink,
            whiteSpace: 'nowrap',
          }}
        >
          {priceText}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 600,
            color: changeColor,
            whiteSpace: 'nowrap',
          }}
        >
          {hasChange ? formatSignedPct(row.change1d as number) : '—'}
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- panel */

const LIST_OPTIONS: UseListTokensOptions = {
  sortMethod: TokenSortMethod.VOLUME,
  sortAscending: false,
}

export function TerminalMarketsPanel({
  chainId,
  activeCurrency,
  onSelectCurrency,
}: {
  chainId: UniverseChainId
  activeCurrency: Maybe<Currency>
  onSelectCurrency: (currency: Currency) => void
}): JSX.Element {
  const { topTokens, isLoading, isError } = useListTokens(chainId, LIST_OPTIONS)

  const rows = useMemo<MarketRow[]>(() => {
    const out: MarketRow[] = []
    for (const token of topTokens) {
      const row = toRow(token, chainId)
      if (row) {
        out.push(row)
      }
    }
    return out
  }, [topTokens, chainId])

  const activeId = activeCurrency ? currencyId(activeCurrency) : undefined
  const showSkeleton = isLoading && rows.length === 0
  const countLabel = isLoading && topTokens.length === 0 ? '—' : `${topTokens.length} pairs`

  return (
    <InstrumentPanel
      title="Markets"
      meta={[countLabel]}
      flush
      style={{ width: 236, flexShrink: 0 }}
    >
      {/* Body: skeleton while loading, then live rows / honest empty / error */}
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 640, overflowY: 'auto' }}>
        {showSkeleton ? (
          SKELETON_ROWS.map((i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 6,
                alignItems: 'center',
                padding: '10px 14px',
                borderBottom: `1px solid ${terminalColors.line3}`,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ height: 9, width: 58, borderRadius: 3, background: terminalColors.line2 }} />
                <span style={{ height: 8, width: 40, borderRadius: 3, background: terminalColors.line3 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
                <span style={{ height: 9, width: 46, borderRadius: 3, background: terminalColors.line2 }} />
                <span style={{ height: 8, width: 30, borderRadius: 3, background: terminalColors.line3 }} />
              </div>
            </div>
          ))
        ) : rows.length > 0 ? (
          rows.map((row) => (
            <MarketRowView
              key={row.key}
              row={row}
              active={activeId !== undefined && row.id === activeId}
              onSelect={() => onSelectCurrency(row.currency)}
            />
          ))
        ) : (
          <div
            style={{
              padding: '22px 14px',
              fontFamily: SANS,
              fontSize: 11.5,
              lineHeight: 1.5,
              color: terminalColors.ink3,
              textAlign: 'center',
            }}
          >
            {isError ? 'Markets unavailable right now.' : 'No markets on this network yet.'}
          </div>
        )}
      </div>
    </InstrumentPanel>
  )
}
