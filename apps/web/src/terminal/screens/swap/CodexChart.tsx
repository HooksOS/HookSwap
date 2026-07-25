/**
 * HookSwap Terminal — Codex / defined.fi chart SCAFFOLD (key-gated, richer fallback).
 *
 * This is an OPT-IN, inert-by-default richer price source. When (and only when) a Codex API key is
 * present in the build env (`REACT_APP_CODEX_API_KEY`), this renders candlesticks sourced from Codex's
 * `getBars` GraphQL API (https://graph.codex.io/graphql, the API behind defined.fi) — deeper history and
 * finer granularity than the native data-api candles. With NO key it is completely inert: `isCodexChartEnabled()`
 * is false, no network request is made, and the panel falls through to HookSwap's own native candles.
 *
 * ACTIVATION (later, no code change beyond the key): set `REACT_APP_CODEX_API_KEY` in the web build env
 * (gitignored `.env.local`) and add the chain→Codex-networkId mapping for the target chain in
 * `CODEX_NETWORK_BY_CHAIN` below. `graph.codex.io` is already allow-listed in `public/csp.json`
 * connect-src. NO key is hardcoded here — the key lives only in the build env.
 *
 * DATA POLICY (no mock data): if the key is absent, or Codex has no data for the token, this renders
 * nothing (returns null) and reports `hasData:false` — never a fabricated series.
 */
import { useQuery } from '@tanstack/react-query'
import type { Currency } from '@uniswap/sdk-core'
import type { UTCTimestamp } from 'lightweight-charts'
import { useMemo } from 'react'
import { TimePeriod } from '~/appGraphql/data/util'
import type { PriceChartData } from '~/components/Charts/PriceChart'
import { PriceChartBody } from '~/components/Charts/PriceChart'
import { PriceChartType } from '~/components/Charts/utils'
import { toStrictlyAscendingByTime } from '~/hooks/useTokenPriceChartData'

/** The Codex GraphQL endpoint (defined.fi's data API). Host is allow-listed in public/csp.json. */
const CODEX_GRAPHQL_URL = 'https://graph.codex.io/graphql'

/**
 * Read the Codex API key from the build env. Empty/undefined → the whole Codex path stays inert.
 * (Vite statically replaces `process.env.REACT_APP_*` at build time; see apps/web/src/config.ts.)
 */
function codexApiKey(): string | undefined {
  const key = process.env.REACT_APP_CODEX_API_KEY
  return key && key.trim() ? key.trim() : undefined
}

/** True when a Codex key is configured. When false, callers must NOT render/query Codex at all. */
export function isCodexChartEnabled(): boolean {
  return codexApiKey() !== undefined
}

/**
 * Chain → Codex networkId map. Codex indexes a fixed set of networks; a HookSwap chain shows Codex data
 * ONLY once Codex supports it AND its id is added here. Empty for now (the custom HookSwap chains are not
 * Codex-indexed yet) → even WITH a key, an unsupported chain stays inert and native candles render.
 */
const CODEX_NETWORK_BY_CHAIN: Record<number, number> = {
  // e.g. 1: 1 (Ethereum), 8453: 8453 (Base) — populate when a HookSwap chain becomes Codex-supported.
}

/** tf → Codex resolution string + lookback seconds (mirrors the native candle windows). */
const CODEX_TF: Record<TimePeriod, { resolution: string; windowSec: number }> = {
  [TimePeriod.HOUR]: { resolution: '1', windowSec: 60 * 60 },
  [TimePeriod.DAY]: { resolution: '15', windowSec: 24 * 60 * 60 },
  [TimePeriod.WEEK]: { resolution: '60', windowSec: 7 * 24 * 60 * 60 },
  [TimePeriod.MONTH]: { resolution: '240', windowSec: 30 * 24 * 60 * 60 },
  [TimePeriod.YEAR]: { resolution: '1D', windowSec: 365 * 24 * 60 * 60 },
}

interface CodexBarsResponse {
  data?: {
    getBars?: {
      t?: number[]
      o?: (number | null)[]
      h?: (number | null)[]
      l?: (number | null)[]
      c?: (number | null)[]
      v?: (number | null)[]
    }
  }
}

/**
 * Fetch Codex bars for a token, gated on the key + a supported network. Returns candlestick-ready data.
 * Disabled (no request) unless a key is set AND the chain is Codex-supported AND the token is ERC-20.
 */
function useCodexBars(
  currency: Maybe<Currency>,
  timePeriod: TimePeriod,
): { data: PriceChartData[]; loading: boolean; hasData: boolean } {
  const key = codexApiKey()
  const chainId = currency?.chainId
  const networkId = chainId !== undefined ? CODEX_NETWORK_BY_CHAIN[chainId] : undefined
  const tokenAddress = currency && !currency.isNative ? currency.address.toLowerCase() : undefined
  const enabled = Boolean(key) && networkId !== undefined && Boolean(tokenAddress)

  const query = useQuery({
    queryKey: ['hookswap-codex-bars', chainId, tokenAddress, timePeriod],
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<PriceChartData[]> => {
      const { resolution, windowSec } = CODEX_TF[timePeriod]
      const to = Math.floor(Date.now() / 1000)
      const from = to - windowSec
      const symbol = `${tokenAddress}:${networkId}`
      const body = {
        query: `query GetBars($symbol: String!, $from: Int!, $to: Int!, $resolution: String!) {
          getBars(symbol: $symbol, from: $from, to: $to, resolution: $resolution, removeLeadingNullValues: true) {
            t o h l c v
          }
        }`,
        variables: { symbol, from, to, resolution },
      }
      const res = await fetch(CODEX_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: key as string },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error(`codex getBars failed: ${res.status}`)
      }
      const json = (await res.json()) as CodexBarsResponse
      const bars = json.data?.getBars
      if (!bars || !bars.t) {
        return []
      }
      const out: PriceChartData[] = []
      for (let i = 0; i < bars.t.length; i++) {
        const t = bars.t[i]
        const o = bars.o?.[i]
        const h = bars.h?.[i]
        const l = bars.l?.[i]
        const c = bars.c?.[i]
        if (
          typeof t !== 'number' ||
          typeof o !== 'number' ||
          typeof h !== 'number' ||
          typeof l !== 'number' ||
          typeof c !== 'number' ||
          !(o > 0 && h > 0 && l > 0 && c > 0)
        ) {
          continue
        }
        out.push({ time: t as UTCTimestamp, value: c, open: o, high: h, low: l, close: c })
      }
      return toStrictlyAscendingByTime(out)
    },
  })

  return useMemo(() => {
    const data = query.data ?? []
    return { data, loading: query.isLoading, hasData: data.length >= 2 }
  }, [query.data, query.isLoading])
}

/** What the panel needs to decide whether Codex renders (vs. falling back to native candles). */
export interface CodexChartState {
  /** true when a Codex key is configured (the whole path is inert otherwise). */
  enabled: boolean
  loading: boolean
  /** true only when enabled AND Codex returned ≥2 bars. */
  hasData: boolean
  data: PriceChartData[]
}

/**
 * Panel-facing hook: returns whether Codex is active and, if so, its candlestick data. Lets the caller
 * choose Codex vs. native candles in a SINGLE render (no flash), keeping Codex a clean opt-in fallback.
 */
export function useCodexChart(currency: Maybe<Currency>, timePeriod: TimePeriod): CodexChartState {
  const enabled = isCodexChartEnabled()
  const { data, loading, hasData } = useCodexBars(currency, timePeriod)
  return useMemo(
    () => ({ enabled, loading, hasData: enabled && hasData, data }),
    [enabled, loading, hasData, data],
  )
}

/**
 * Standalone Codex candlestick chart. Renders ONLY when a Codex key is set AND Codex returns ≥2 bars;
 * otherwise returns null so the caller falls back to HookSwap's native candles.
 */
export function CodexChart({
  currency,
  timePeriod,
  height,
}: {
  currency: Maybe<Currency>
  timePeriod: TimePeriod
  height: number
}): JSX.Element | null {
  const { hasData, data } = useCodexChart(currency, timePeriod)
  if (!hasData) {
    return null
  }
  return (
    <PriceChartBody
      data={data}
      height={height}
      type={PriceChartType.CANDLESTICK}
      stale={false}
      hideYAxis={false}
      hideXAxis={false}
      hideMinMaxLines
    />
  )
}
