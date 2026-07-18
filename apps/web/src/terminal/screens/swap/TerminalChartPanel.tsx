/**
 * HookSwap Terminal — B2 Swap live price-chart panel (Desk / Daylight redesign).
 *
 * The center pane of the swap desk: a framed `InstrumentPanel` (live dot + green
 * corner registration ticks) whose header names the pair, with a chart-head row
 * (overlapped token logos + pair symbol + live spot/delta + a mono keycap
 * timeframe segmented control), a large area chart, and a mono OHLC row
 * (O / H / L / C / VOL) derived from the displayed series.
 *
 * DATA POLICY (no mock data — handoff hard rule):
 *   • Price series + spot price come from the interface's real token price-history
 *     stack (`useTokenPriceChartPanel` → GraphQL price history) rendered with the
 *     shared `PriceChartBody` (lightweight-charts). Real for backend-indexed chains
 *     (e.g. Mainnet); for chains the hosted GraphQL does not index (Robinhood — the
 *     Terminal's live chain), the 1D timeframe instead renders HookSwap's OWN
 *     data-api native relative price series (`TokenStats.priceHistory1d`) as an
 *     UNLABELED line — no USD axis, since the series is native-denominated. Other
 *     timeframes keep the honest empty state. NO fabricated series is drawn.
 *   • Spot price + 24h % change + OHLC row are all REAL (data-api / GraphQL), with
 *     honest "—" fallbacks; the O/H/L/C row is computed from the SAME series the
 *     chart draws (open = first point, close = last, high/low = window extents),
 *     formatted USD on indexed chains and plain-number on native chains — never a
 *     native ratio under a "$"/USD label.
 *
 * The component reads NO swap-form store and performs NO navigation — it is driven
 * purely by `inputCurrency` / `outputCurrency` props, so it is decoupled + reusable.
 */
import type { TokenStats } from '@uniswap/client-data-api/dist/data/v1/types_pb'
import type { Currency } from '@uniswap/sdk-core'
import type { UTCTimestamp } from 'lightweight-charts'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { WRAPPED_NATIVE_CURRENCY } from 'uniswap/src/constants/tokens'
import type { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel, isUniverseChainId, toGraphQLChain } from 'uniswap/src/features/chains/utils'
import { useTokenMarketStats, useTokenPriceChange } from 'uniswap/src/features/dataApi/tokenDetails/useTokenDetailsData'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import { CurrencyField } from 'uniswap/src/types/currency'
import { currencyId } from 'uniswap/src/utils/currencyId'
import { NumberType } from 'utilities/src/format/types'
import { TimePeriod, toHistoryDuration } from '~/appGraphql/data/util'
import type { PriceChartData } from '~/components/Charts/PriceChart'
import { PriceChartBody } from '~/components/Charts/PriceChart'
import { PriceChartType } from '~/components/Charts/utils'
import { CurrencyLogo } from '~/components/Logo/CurrencyLogo'
import { useListTokens } from '~/features/Explore/state/listTokens/useListTokens'
import type { TokenPriceChartQueryVariables } from '~/hooks/useTokenPriceChartData'
import { toStrictlyAscendingByTime } from '~/hooks/useTokenPriceChartData'
import { useTokenPriceChartPanel } from '~/hooks/useTokenPriceChartPanel'
import { useV2Pair } from '~/hooks/useV2Pairs'
import { getNativeTokenDBAddress } from '~/utils/nativeTokens'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { terminalColors, terminalFonts, terminalShadows } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono

/**
 * Timeframe tabs — each label maps to a REAL `TimePeriod` the price-history backend
 * serves (the hosted data API has no sub-hour granularity, so honest supported
 * durations are used rather than fabricated intraday buckets).
 */
const TIME_OPTIONS = [
  { label: '1H', period: TimePeriod.HOUR },
  { label: '1D', period: TimePeriod.DAY },
  { label: '1W', period: TimePeriod.WEEK },
  { label: '1M', period: TimePeriod.MONTH },
  { label: '1Y', period: TimePeriod.YEAR },
] as const

/* ------------------------------------------------------------- shared chrome */

/** Compact live spot + 24h delta, sat beside the pair symbol in the chart head. */
function PairPrice({
  price,
  change,
  changeColor,
}: {
  price: string
  change: string
  changeColor: string
}): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, marginLeft: 4, whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: terminalColors.ink }}>{price}</span>
      <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: changeColor }}>{change}</span>
    </span>
  )
}

/** Mono OHLC row — O / H / L / C / VOL, honest "—" when the series can't fill a cell. */
function OhlcRow({
  open,
  high,
  low,
  close,
  vol,
}: {
  open: string
  high: string
  low: string
  close: string
  vol: string
}): JSX.Element {
  const cell = (label: string, value: string): JSX.Element => (
    <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.ink3, whiteSpace: 'nowrap' }}>
      {label} <b style={{ color: terminalColors.ink, fontWeight: 600 }}>{value}</b>
    </span>
  )
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, padding: '12px 4px 0' }}>
      {cell('O', open)}
      {cell('H', high)}
      {cell('L', low)}
      {cell('C', close)}
      {cell('VOL', vol)}
    </div>
  )
}

/** Input/output token toggle — mirrors SlideoutChartCard's toggle; only when both exist. */
function TokenToggle({
  inputCurrency,
  outputCurrency,
  selectedField,
  onSelectField,
}: {
  inputCurrency: Currency
  outputCurrency: Currency
  selectedField: CurrencyField
  onSelectField: (field: CurrencyField) => void
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 2, background: terminalColors.panel2, padding: 2, borderRadius: 7 }}>
      {([CurrencyField.INPUT, CurrencyField.OUTPUT] as const).map((field) => {
        const currency = field === CurrencyField.INPUT ? inputCurrency : outputCurrency
        const active = selectedField === field
        return (
          <button
            key={field}
            type="button"
            onClick={() => onSelectField(field)}
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: active ? 600 : 500,
              color: active ? terminalColors.ink : terminalColors.ink2,
              background: active ? terminalColors.bg : 'transparent',
              padding: '3px 8px',
              borderRadius: 5,
              border: 'none',
              cursor: 'pointer',
              boxShadow: active ? terminalShadows.segmentedActive : undefined,
            }}
          >
            {currency.symbol ?? '—'}
          </button>
        )
      })}
    </div>
  )
}

/** Chart-head left group: overlapped token logos + "IN / OUT" title + token toggle. */
function PairHeaderLeft({
  inputCurrency,
  outputCurrency,
  selectedField,
  onSelectField,
}: {
  inputCurrency: Maybe<Currency>
  outputCurrency: Maybe<Currency>
  selectedField: CurrencyField
  onSelectField: (field: CurrencyField) => void
}): JSX.Element {
  const inSym = inputCurrency?.symbol ?? '—'
  const outSym = outputCurrency?.symbol ?? '—'
  const showToggle = !!inputCurrency && !!outputCurrency
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ display: 'flex' }}>
        <CurrencyLogo currency={inputCurrency} size={22} />
        <span style={{ marginLeft: -8 }}>
          <CurrencyLogo currency={outputCurrency} size={22} />
        </span>
      </span>
      <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 16, color: terminalColors.ink, whiteSpace: 'nowrap' }}>
        {inSym} / {outSym}
      </span>
      {showToggle && (
        <TokenToggle
          inputCurrency={inputCurrency}
          outputCurrency={outputCurrency}
          selectedField={selectedField}
          onSelectField={onSelectField}
        />
      )}
    </div>
  )
}

/** Mono keycap timeframe segmented control (well track, active = white keycap). */
function TimeframeSeg({
  timePeriod,
  onChange,
}: {
  timePeriod: TimePeriod
  onChange: (period: TimePeriod) => void
}): JSX.Element {
  return (
    <div
      style={{
        marginLeft: 'auto',
        display: 'inline-flex',
        gap: 2,
        background: terminalColors.panel2,
        borderRadius: 8,
        padding: 3,
      }}
    >
      {TIME_OPTIONS.map(({ label, period }) => {
        const active = period === timePeriod
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(period)}
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              color: active ? terminalColors.ink : terminalColors.ink3,
              background: active ? terminalColors.bg : 'transparent',
              padding: '5px 11px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              boxShadow: active ? terminalShadows.segmentedActive : undefined,
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Honest empty/loading chart state — a grid scaffold + centered message + optional
 * corner spot badge. NO fabricated series is drawn; shown when the price-history
 * feed returns nothing (unindexed chain) or is still loading.
 */
function EmptyChartOverlay({ spotLabel, loading }: { spotLabel: string; loading: boolean }): JSX.Element {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `repeating-linear-gradient(0deg,transparent 0 59px,${terminalColors.line2} 59px 60px), repeating-linear-gradient(90deg,transparent 0 79px,${terminalColors.line2} 79px 80px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 12, color: terminalColors.faint }}>
          {loading ? 'Loading price history…' : 'No price history yet — builds as trades occur'}
        </span>
      </div>
      {spotLabel !== '—' && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 12,
            fontFamily: MONO,
            fontSize: 10.5,
            color: terminalColors.greenUp,
            background: terminalColors.greenBg,
            padding: '2px 5px',
            borderRadius: 4,
          }}
        >
          {spotLabel}
        </div>
      )}
    </>
  )
}

/** Resolve the framed panel's uppercase-mono pair title + chain meta chip. */
function usePanelChrome(inputCurrency: Maybe<Currency>, outputCurrency: Maybe<Currency>): {
  title: string
  meta: string[]
} {
  const inSym = inputCurrency?.symbol ?? '—'
  const outSym = outputCurrency?.symbol ?? '—'
  const chainId = inputCurrency?.chainId ?? outputCurrency?.chainId
  const chainLabel = chainId !== undefined && isUniverseChainId(chainId) ? getChainLabel(chainId) : undefined
  return { title: `${inSym} / ${outSym}`, meta: chainLabel ? [chainLabel] : [] }
}

/** Framed InstrumentPanel + chart-head (pair / price / timeframe) shared by both branches. */
function PanelShell({
  inputCurrency,
  outputCurrency,
  selectedField,
  onSelectField,
  timePeriod,
  onTimePeriodChange,
  priceNode,
  ohlc,
  children,
}: {
  inputCurrency: Maybe<Currency>
  outputCurrency: Maybe<Currency>
  selectedField: CurrencyField
  onSelectField: (field: CurrencyField) => void
  timePeriod: TimePeriod
  onTimePeriodChange: (period: TimePeriod) => void
  priceNode: JSX.Element
  ohlc: JSX.Element
  children: React.ReactNode
}): JSX.Element {
  const { title, meta } = usePanelChrome(inputCurrency, outputCurrency)
  return (
    <InstrumentPanel
      title={title}
      live
      corners
      meta={meta}
      style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
      bodyStyle={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 16 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          rowGap: 10,
          flexWrap: 'wrap',
          paddingBottom: 14,
        }}
      >
        <PairHeaderLeft
          inputCurrency={inputCurrency}
          outputCurrency={outputCurrency}
          selectedField={selectedField}
          onSelectField={onSelectField}
        />
        {priceNode}
        <TimeframeSeg timePeriod={timePeriod} onChange={onTimePeriodChange} />
      </div>
      {children}
      {ohlc}
    </InstrumentPanel>
  )
}

/* ------------------------------------------------------------- live data body */

/**
 * Looks up HookSwap's OWN data-api token stats (the SAME `useListTokens` feed the
 * Markets screen joins) for the charted currency. Returns the native-denominated
 * `TokenStats` sub-message, or `undefined` when the indexer has no entry yet.
 */
function useDataApiTokenStats(currency: Currency): TokenStats | undefined {
  const { topTokens } = useListTokens(undefined)
  return useMemo(() => {
    const wantAddress = currency.isNative ? undefined : currency.address.toLowerCase()
    const wantSymbol = currency.symbol?.toUpperCase()

    // Primary: exact chainId + ERC-20 address match (mirrors MarketsScreen's byKey join).
    if (wantAddress) {
      const wantKey = `${currency.chainId}:${wantAddress}`
      for (const token of topTokens) {
        if (!token.stats) {
          continue
        }
        for (const chainToken of token.chainTokens) {
          if (chainToken.address && `${chainToken.chainId}:${chainToken.address.toLowerCase()}` === wantKey) {
            return token.stats
          }
        }
      }
    }
    // Fallback: symbol match (mirrors MarketsScreen's bySymbol join; covers native).
    if (wantSymbol) {
      for (const token of topTokens) {
        if (token.stats && token.symbol.toUpperCase() === wantSymbol) {
          return token.stats
        }
      }
    }
    return undefined
  }, [topTokens, currency])
}

/**
 * Converts the data-api native relative series (`TokenStats.priceHistory1d`) into
 * lightweight-charts points. Line rendering only uses `time`+`value`; open/high/low/
 * close are set to `value`. Timestamps normalized to seconds. Returns `[]` when there
 * is nothing to plot (fewer than 2 usable points).
 */
function nativePriceHistoryToChartData(stats: TokenStats | undefined): PriceChartData[] {
  const history = stats?.priceHistory1d
  if (!history || history.length < 2) {
    return []
  }
  const points: PriceChartData[] = []
  for (const point of history) {
    if (!Number.isFinite(point.value) || point.value <= 0) {
      continue
    }
    const raw = Number(point.timestamp)
    const timeSec = raw > 1e12 ? Math.floor(raw / 1000) : raw
    const time = timeSec as UTCTimestamp
    const value = point.value
    points.push({ time, value, open: value, high: value, low: value, close: value })
  }
  return toStrictlyAscendingByTime(points)
}

/**
 * Live branch — mounted ONLY when the charted currency exists, so the data hooks
 * (which require a non-null `Currency`) are always called unconditionally here.
 */
function TerminalChartPanelBody({
  chartedCurrency,
  inputCurrency,
  outputCurrency,
  selectedField,
  onSelectField,
  timePeriod,
  onTimePeriodChange,
}: {
  chartedCurrency: Currency
  inputCurrency: Maybe<Currency>
  outputCurrency: Maybe<Currency>
  selectedField: CurrencyField
  onSelectField: (field: CurrencyField) => void
  timePeriod: TimePeriod
  onTimePeriodChange: (period: TimePeriod) => void
}): JSX.Element {
  const { convertFiatAmountFormatted, formatNumberOrString } = useLocalizationContext()

  const variables = useMemo((): TokenPriceChartQueryVariables => {
    const chain = toGraphQLChain(chartedCurrency.chainId as UniverseChainId)
    const address = chartedCurrency.isNative ? getNativeTokenDBAddress(chain) : chartedCurrency.address
    return { chain, address, duration: toHistoryDuration(timePeriod), multichain: false }
  }, [chartedCurrency, timePeriod])

  const { priceQuery, showInvalidSkeleton, stale } = useTokenPriceChartPanel({
    variables,
    priceChartType: PriceChartType.LINE,
    timePeriod,
    currency: chartedCurrency,
  })
  const { entries, loading } = priceQuery

  const chartedCurrencyId = useMemo(() => currencyId(chartedCurrency), [chartedCurrency])
  // 24h % change: prefer HookSwap's own data-api native stat; fall back to GraphQL; else "—".
  const dataApiStats = useDataApiTokenStats(chartedCurrency)
  const graphChange24h = useTokenPriceChange(chartedCurrencyId)
  const change24h = dataApiStats?.priceChange1d ?? graphChange24h
  const { volume } = useTokenMarketStats(chartedCurrencyId)

  // Native 1D relative series from the data-api — plotted UNLABELED on the 1D tab for
  // chains the GraphQL price history does not index (Robinhood). Empty on other tabs.
  const nativeSeries = useMemo(() => nativePriceHistoryToChartData(dataApiStats), [dataApiStats])

  // Chart area needs a concrete pixel height for lightweight-charts — measure the
  // flex region so PriceChartBody always receives a non-zero height.
  const chartRef = useRef<HTMLDivElement>(null)
  const [chartHeight, setChartHeight] = useState(340)
  useLayoutEffect(() => {
    const el = chartRef.current
    if (!el) {
      return
    }
    const update = (): void => setChartHeight(Math.max(el.clientHeight, 1))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // --- Header spot / delta (all REAL, honest "—" when unavailable) ----------
  const spot = entries.at(-1)?.value

  // Native spot fallback for chains with no USD anchor: the latest data-api native
  // priceHistory1d value = the charted token's price in the chain's wrapped-native.
  const quoteSymbol = WRAPPED_NATIVE_CURRENCY[chartedCurrency.chainId]?.symbol
  const nativeHistory = dataApiStats?.priceHistory1d
  const nativeSpotRaw =
    nativeHistory && nativeHistory.length > 0 ? nativeHistory[nativeHistory.length - 1]?.value : undefined
  const nativeSpot =
    typeof nativeSpotRaw === 'number' && Number.isFinite(nativeSpotRaw) && nativeSpotRaw > 0 ? nativeSpotRaw : undefined

  // Live native spot from CURRENT on-chain v2 reserves — deepest fallback for custom
  // chains whose pool HAS reserves but no indexed history yet. Engaged ONLY when the
  // OTHER charted currency IS the chain's wrapped-native, so the price is denominated
  // in the wrapped-native (== `quoteSymbol`) and is NEVER mislabeled.
  const otherCurrency = selectedField === CurrencyField.INPUT ? outputCurrency : inputCurrency
  const wrappedNative = WRAPPED_NATIVE_CURRENCY[chartedCurrency.chainId]
  const otherIsQuote = !!otherCurrency && !!wrappedNative && otherCurrency.wrapped.equals(wrappedNative)
  const [, reservesPair] = useV2Pair(chartedCurrency, otherIsQuote ? otherCurrency : undefined)
  const reservesSpot = useMemo(() => {
    if (!reservesPair) {
      return undefined
    }
    try {
      const price = Number(reservesPair.priceOf(chartedCurrency.wrapped).toSignificant(8))
      return Number.isFinite(price) && price > 0 ? price : undefined
    } catch {
      return undefined
    }
  }, [reservesPair, chartedCurrency])

  // Prefer the GraphQL USD spot ($) on indexed chains; else the data-api native spot;
  // else the LIVE reserves native spot; else honest "—". Native branches are labeled
  // with the quote symbol, never under a "$"/USD label.
  const priceStr =
    spot !== undefined
      ? convertFiatAmountFormatted(spot, NumberType.FiatTokenPrice)
      : nativeSpot !== undefined && quoteSymbol
        ? `${formatNumberOrString({ value: nativeSpot, type: NumberType.SwapPrice })} ${quoteSymbol}`
        : reservesSpot !== undefined && quoteSymbol
          ? `${formatNumberOrString({ value: reservesSpot, type: NumberType.SwapPrice })} ${quoteSymbol}`
          : '—'

  const changeStr = change24h === undefined ? '—' : `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`
  const changeColor =
    change24h === undefined ? terminalColors.ink3 : change24h >= 0 ? terminalColors.greenUp : terminalColors.redDown

  const volStr = volume === undefined ? '—' : convertFiatAmountFormatted(volume, NumberType.FiatTokenStats)

  // Only the 1D indexer window can serve the native series; 1H/1W/1M/1Y stay honest-empty.
  const showNativeSeries = timePeriod === TimePeriod.DAY && nativeSeries.length >= 2

  // --- OHLC row, from the SAME series the chart draws (honest "—" otherwise) --
  // Indexed → USD-formatted; native → plain number (denomination shown by the caption).
  const usedSeries = !showInvalidSkeleton ? entries : showNativeSeries ? nativeSeries : []
  const fmtSeries = (v: number | undefined): string => {
    if (v === undefined || !Number.isFinite(v)) {
      return '—'
    }
    return !showInvalidSkeleton
      ? convertFiatAmountFormatted(v, NumberType.FiatTokenPrice)
      : formatNumberOrString({ value: v, type: NumberType.SwapPrice })
  }
  let ohlcOpen: number | undefined
  let ohlcHigh: number | undefined
  let ohlcLow: number | undefined
  let ohlcClose: number | undefined
  if (usedSeries.length > 0) {
    ohlcOpen = usedSeries[0]?.value
    ohlcClose = usedSeries[usedSeries.length - 1]?.value
    ohlcHigh = usedSeries.reduce((m, e) => Math.max(m, e.value), Number.NEGATIVE_INFINITY)
    ohlcLow = usedSeries.reduce((m, e) => Math.min(m, e.value), Number.POSITIVE_INFINITY)
  }

  return (
    <PanelShell
      inputCurrency={inputCurrency}
      outputCurrency={outputCurrency}
      selectedField={selectedField}
      onSelectField={onSelectField}
      timePeriod={timePeriod}
      onTimePeriodChange={onTimePeriodChange}
      priceNode={<PairPrice price={priceStr} change={changeStr} changeColor={changeColor} />}
      ohlc={
        <OhlcRow
          open={fmtSeries(ohlcOpen)}
          high={fmtSeries(ohlcHigh)}
          low={fmtSeries(ohlcLow)}
          close={fmtSeries(ohlcClose)}
          vol={volStr}
        />
      }
    >
      <div ref={chartRef} style={{ position: 'relative', flex: 1, minHeight: 300, background: terminalColors.bg }}>
        {/* Native-denomination caption — makes the UNLABELED native line explicitly "priced in
            <wrapped-native>". Only on the native branch (GraphQL-unindexed 1D series). */}
        {showInvalidSkeleton && showNativeSeries && quoteSymbol && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: 12,
              zIndex: 1,
              fontFamily: MONO,
              fontSize: 10.5,
              color: terminalColors.ink3,
              background: terminalColors.panel2,
              padding: '2px 6px',
              borderRadius: 4,
              pointerEvents: 'none',
            }}
          >
            Price in {quoteSymbol}
          </div>
        )}
        {!showInvalidSkeleton ? (
          // Indexed chains (e.g. Mainnet): real USD-labeled GraphQL price series.
          <PriceChartBody
            data={entries}
            height={chartHeight}
            type={PriceChartType.LINE}
            stale={stale}
            timePeriod={toHistoryDuration(timePeriod)}
            hideYAxis={false}
            hideXAxis={false}
            hideMinMaxLines
          />
        ) : showNativeSeries ? (
          // GraphQL unindexed (Robinhood) + a data-api 1D native series exists → plot it
          // UNLABELED (hideYAxis + yAxisFormatter guards) so a native ratio is never
          // shown under a "$".
          <PriceChartBody
            data={nativeSeries}
            height={chartHeight}
            type={PriceChartType.LINE}
            stale={false}
            timePeriod={toHistoryDuration(timePeriod)}
            hideYAxis
            hideXAxis={false}
            yAxisFormatter={() => ''}
            hideMinMaxLines
          />
        ) : (
          <EmptyChartOverlay spotLabel={priceStr} loading={loading} />
        )}
      </div>
    </PanelShell>
  )
}

/* ---------------------------------------------------------------- component */

const EMPTY_OHLC = <OhlcRow open="—" high="—" low="—" close="—" vol="—" />

export function TerminalChartPanel({
  inputCurrency,
  outputCurrency,
}: {
  inputCurrency: Maybe<Currency>
  outputCurrency: Maybe<Currency>
}): JSX.Element {
  const [selectedField, setSelectedField] = useState<CurrencyField>(CurrencyField.OUTPUT)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(TimePeriod.DAY)

  const chartedCurrency = selectedField === CurrencyField.INPUT ? inputCurrency : outputCurrency

  if (chartedCurrency) {
    return (
      <TerminalChartPanelBody
        chartedCurrency={chartedCurrency}
        inputCurrency={inputCurrency}
        outputCurrency={outputCurrency}
        selectedField={selectedField}
        onSelectField={setSelectedField}
        timePeriod={timePeriod}
        onTimePeriodChange={setTimePeriod}
      />
    )
  }

  // No charted currency (charted side empty) — full chrome with honest "—" and the
  // empty chart scaffold. Data hooks are skipped (they require a Currency).
  return (
    <PanelShell
      inputCurrency={inputCurrency}
      outputCurrency={outputCurrency}
      selectedField={selectedField}
      onSelectField={setSelectedField}
      timePeriod={timePeriod}
      onTimePeriodChange={setTimePeriod}
      priceNode={<PairPrice price="—" change="—" changeColor={terminalColors.ink3} />}
      ohlc={EMPTY_OHLC}
    >
      <div style={{ position: 'relative', flex: 1, minHeight: 300, background: terminalColors.bg }}>
        <EmptyChartOverlay spotLabel="—" loading={false} />
      </div>
    </PanelShell>
  )
}
