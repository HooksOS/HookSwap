/**
 * HookSwap Terminal — native OHLC candle series for the token/pool chart.
 *
 * Fetches real candles from the self-hosted data-api's plain REST route
 * `GET /v1/pool/candles?chainId=&tokenA=&tokenB=&tf=` (a browser-friendly GET/JSON facade, NOT
 * Connect-RPC). The server builds the bars from its ALREADY-indexed Swap/Sync events for the most-active
 * pool of the pair (v2 reserves / v3+v4 sqrtPriceX96) — so the Terminal chart draws real candlesticks on
 * the HookSwap chains the hosted GraphQL price history does not index (Robinhood et al.), instead of the
 * "No price history yet" empty state.
 *
 * DATA POLICY (no mock data): every bar originates from a real on-chain event. A pool with no swaps
 * returns `candles: []` → this hook returns `hasData:false` and the panel keeps its honest empty state.
 * Nothing is fabricated.
 *
 * ORIENTATION: the server returns pool-canonical bars (price of token0 in token1). This hook orients them
 * so the CHARTED token is the base priced in the OTHER token: when the charted token is token1 it inverts
 * each bar (o'=1/o, c'=1/c, h'=1/l, l'=1/h — exact, since 1/x is monotonic for x>0). The series stays
 * native/quote-denominated (never mislabeled "$"); the panel captions it "Price in <quote>".
 */
import { useQuery } from '@tanstack/react-query'
import type { Currency } from '@uniswap/sdk-core'
import type { UTCTimestamp } from 'lightweight-charts'
import { useMemo } from 'react'
import { config } from 'uniswap/src/config'
import { WRAPPED_NATIVE_CURRENCY } from 'uniswap/src/constants/tokens'
import { getUniswapServiceUrls } from 'uniswap/src/constants/urls'
import { TimePeriod } from '~/appGraphql/data/util'
import type { PriceChartData } from '~/components/Charts/PriceChart'
import { toStrictlyAscendingByTime } from '~/hooks/useTokenPriceChartData'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Timeframe token the data-api candle route understands. */
type CandleTf = '1H' | '1D' | '1W' | '1M' | '1Y'

const TF_BY_PERIOD: Record<TimePeriod, CandleTf> = {
  [TimePeriod.HOUR]: '1H',
  [TimePeriod.DAY]: '1D',
  [TimePeriod.WEEK]: '1W',
  [TimePeriod.MONTH]: '1M',
  [TimePeriod.YEAR]: '1Y',
}

interface RawCandle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v0: number
  v1: number
}
interface RawTokenInfo {
  address: string
  symbol: string
  decimals: number
}
interface RawCandleSeries {
  chainId: number
  pool: string
  protocolVersion: 'v2' | 'v3' | 'v4'
  tf: CandleTf
  bucketSeconds: number
  token0: RawTokenInfo
  token1: RawTokenInfo
  nativeSide: 0 | 1 | null
  usdPerNative: number | null
  candles: RawCandle[]
}

/** What the panel consumes. */
export interface CandleResult {
  /** candlestick-ready data (base priced in quote, native units), strictly ascending by time. */
  data: PriceChartData[]
  /** quote token symbol (the other side) for the "Price in <quote>" caption. */
  quoteSymbol?: string
  /** total quote-token volume over the window (for the OHLC row's VOL cell). */
  volumeQuote?: number
  loading: boolean
  /** true when there are at least 2 real bars to draw. */
  hasData: boolean
}

const EMPTY: CandleResult = { data: [], loading: false, hasData: false }

function candlesBaseUrl(): string {
  return getUniswapServiceUrls(config).dataApiBaseUrlV2
}

/** The on-chain address to identify a currency by (wrapped-native address for the native currency). */
function currencyKeyAddress(currency: Currency): string | undefined {
  if (currency.isNative) {
    return WRAPPED_NATIVE_CURRENCY[currency.chainId]?.address?.toLowerCase()
  }
  return currency.address.toLowerCase()
}

/** True when two addresses are equal, or both are the chain's native side (wrapped-native / 0x0). */
function addrEq(a: string, b: string, wnative: string | undefined): boolean {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  if (x === y) {
    return true
  }
  if (!wnative) {
    return false
  }
  const isNative = (v: string): boolean => v === wnative || v === ZERO_ADDRESS
  return isNative(x) && isNative(y)
}

/**
 * Orient the pool-canonical bars so `chartedAddr` is the base, mapping to lightweight-charts candlestick
 * data. Returns the series + quote symbol + total quote-side volume. Empty when fewer than 2 bars.
 */
function orient(series: RawCandleSeries, chartedAddr: string, wnative: string | undefined): CandleResult {
  const bars = series.candles
  if (bars.length < 2) {
    return EMPTY
  }
  const chartedIsToken0 = addrEq(series.token0.address, chartedAddr, wnative)
  const quote = chartedIsToken0 ? series.token1 : series.token0

  const data: PriceChartData[] = []
  let volumeQuote = 0
  for (const bar of bars) {
    if (![bar.o, bar.h, bar.l, bar.c].every((v) => Number.isFinite(v) && v > 0)) {
      continue
    }
    const time = bar.t as UTCTimestamp
    let open: number
    let high: number
    let low: number
    let close: number
    if (chartedIsToken0) {
      // price of token0 in token1 — as returned.
      open = bar.o
      high = bar.h
      low = bar.l
      close = bar.c
      volumeQuote += bar.v1
    } else {
      // invert to price of token1 in token0 (1/x monotonic → high/low swap).
      open = 1 / bar.o
      high = 1 / bar.l
      low = 1 / bar.h
      close = 1 / bar.c
      volumeQuote += bar.v0
    }
    data.push({ time, value: close, open, high, low, close })
  }

  const ascending = toStrictlyAscendingByTime(data)
  if (ascending.length < 2) {
    return EMPTY
  }
  return {
    data: ascending,
    quoteSymbol: quote.symbol || undefined,
    volumeQuote,
    loading: false,
    hasData: true,
  }
}

/**
 * React-Query hook for a pair's native candle series on the given timeframe. Disabled until both
 * currencies are known. Returns an honest empty result (`hasData:false`) on 404 / no-swaps / <2 bars.
 */
export function useCandles(
  chartedCurrency: Maybe<Currency>,
  otherCurrency: Maybe<Currency>,
  timePeriod: TimePeriod,
): CandleResult {
  const chainId = chartedCurrency?.chainId
  const tf = TF_BY_PERIOD[timePeriod]
  const tokenA = chartedCurrency ? currencyKeyAddress(chartedCurrency) : undefined
  const tokenB = otherCurrency ? currencyKeyAddress(otherCurrency) : undefined
  const wnative = chainId !== undefined ? WRAPPED_NATIVE_CURRENCY[chainId]?.address?.toLowerCase() : undefined

  const query = useQuery({
    queryKey: ['hookswap-candles', chainId, tokenA, tokenB, tf],
    enabled: chainId !== undefined && Boolean(tokenA) && Boolean(tokenB) && tokenA !== tokenB,
    queryFn: async (): Promise<RawCandleSeries | null> => {
      const url = `${candlesBaseUrl()}/v1/pool/candles?chainId=${chainId}&tokenA=${tokenA}&tokenB=${tokenB}&tf=${tf}`
      const res = await fetch(url)
      if (res.status === 404) {
        return null // no indexed pool for the pair — honest empty.
      }
      if (!res.ok) {
        throw new Error(`candles request failed: ${res.status}`)
      }
      return (await res.json()) as RawCandleSeries
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  return useMemo(() => {
    if (query.isLoading) {
      return { ...EMPTY, loading: true }
    }
    const series = query.data
    if (!series || !tokenA) {
      return EMPTY
    }
    return orient(series, tokenA, wnative)
  }, [query.isLoading, query.data, tokenA, wnative])
}
