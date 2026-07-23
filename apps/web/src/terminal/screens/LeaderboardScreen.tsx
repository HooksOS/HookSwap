/**
 * HookSwap Terminal — Trading Leaderboard.
 *
 * Ranks trader wallets on the launch chain (Robinhood, 4663) by native-denominated swap volume,
 * trade count, or distinct tokens traded, over a 24h / 7d / 30d / all-time window. Data comes from
 * the HookSwap data-api's `/v1/leaderboard` route (the swap indexer, attributed by tx.from — the real
 * trader EOA — with routers + pool intermediaries excluded). See `useLeaderboard`.
 *
 * DATA POLICY (no mock data — hard rule):
 *   • Every value is real, from the indexer. Rows arrive pre-ranked by the selected metric.
 *   • Native (ETH on Robinhood) volume + trades + tokens are shown NOW. USD is gated on the chain's
 *     WETH/stablecoin anchor pool: when `usdAnchored` is false the USD column shows "—" and an honest
 *     note explains USD ranking activates once the anchor is seeded — NEVER a fabricated dollar value.
 *   • Empty state is honest: Robinhood has ~no trades yet, so the board fills as swaps happen.
 *
 * Reuses the Terminal DataTable + StatCard + theme tokens (mirrors AnalyticsScreen / MarketsScreen).
 */
import { ReactNode, useMemo, useState } from 'react'
import { DataTable, DataTableColumn } from '~/terminal/components/DataTable'
import { Eyebrow, InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { StatCard } from '~/terminal/components/StatCard'
import '~/terminal/theme/terminal.css'
import { terminalColors, terminalFonts, terminalShadows } from '~/terminal/theme/tokens'
import {
  LeaderboardMetric,
  LeaderboardRow,
  LeaderboardWindow,
  useLeaderboard,
} from '~/terminal/screens/useLeaderboard'

const MONO = terminalFonts.mono
const DISPLAY = terminalFonts.display
const SANS = terminalFonts.sans

/** Robinhood (4663) native currency symbol (see robinhood.ts nativeCurrency = ETH). */
const NATIVE_SYMBOL = 'ETH'

/* ---------------------------------------------------------------- controls */

const WINDOW_OPTIONS: ReadonlyArray<{ id: LeaderboardWindow; label: string }> = [
  { id: '24h', label: '24H' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: 'all', label: 'All' },
]

const METRIC_OPTIONS: ReadonlyArray<{ id: LeaderboardMetric; label: string }> = [
  { id: 'volume', label: 'Volume' },
  { id: 'trades', label: 'Trades' },
  { id: 'tokens', label: 'Tokens' },
]

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ id: T; label: string }>
  value: T
  onChange: (id: T) => void
}): JSX.Element {
  return (
    <div style={{ display: 'inline-flex', background: terminalColors.panel2, borderRadius: 999, padding: 3, gap: 2 }}>
      {options.map((option) => {
        const active = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            style={{
              fontFamily: SANS,
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 13px',
              borderRadius: 999,
              cursor: 'pointer',
              border: 'none',
              background: active ? terminalColors.bg : 'transparent',
              color: active ? terminalColors.ink : terminalColors.ink2,
              boxShadow: active ? terminalShadows.segmentedActive : undefined,
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* --------------------------------------------------------------- helpers */

/** Truncate an address to `0x1234…abcd`. */
function shortenWallet(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/** Native amount → compact string (e.g. 1.2345). Small values keep more precision. */
function formatNative(value: number): string {
  if (value === 0) {
    return '0'
  }
  if (value >= 1) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  }
  return value.toLocaleString('en-US', { maximumSignificantDigits: 4 })
}

/** USD amount → `$1,234.56`. */
function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/* ------------------------------------------------------- volume bar chart */

/** How many wallets the horizontal volume bar chart shows. */
const VOLUME_BARS_TOP_N = 10

/**
 * Horizontal volume bar chart — the top-N wallets by native swap volume, drawn
 * from the SAME `rows` the table renders (no extra fetch; the window/metric toggle
 * already drives `rows`). Green bars scaled to the leader, labeled with the short
 * wallet + native volume (mono). Honest loading skeleton + empty state — never a
 * fabricated bar.
 */
function VolumeBars({ rows, loading }: { rows?: LeaderboardRow[]; loading: boolean }): JSX.Element {
  const top = useMemo(() => {
    if (!rows) {
      return undefined
    }
    return [...rows]
      .filter((r) => Number.isFinite(r.nativeVolume) && r.nativeVolume > 0)
      .sort((a, b) => b.nativeVolume - a.nativeVolume)
      .slice(0, VOLUME_BARS_TOP_N)
  }, [rows])

  if (loading || top === undefined) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ height: 11, width: '38%', borderRadius: 4, background: terminalColors.line2 }} />
            <div style={{ height: 8, width: `${80 - i * 11}%`, borderRadius: 999, background: terminalColors.line2 }} />
          </div>
        ))}
      </div>
    )
  }

  if (top.length === 0) {
    return (
      <div style={{ padding: '22px 4px', fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt, lineHeight: 1.5 }}>
        No swap volume in this window yet — bars fill as trades happen.
      </div>
    )
  }

  const max = top[0].nativeVolume

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {top.map((r, i) => {
        const pct = max > 0 ? Math.max(2, (r.nativeVolume / max) * 100) : 0
        return (
          <div key={r.wallet} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontFamily: MONO, fontSize: 12, color: terminalColors.ink }}>
                <span style={{ color: terminalColors.faint }}>{i + 1}.</span> {shortenWallet(r.wallet)}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: terminalColors.ink, whiteSpace: 'nowrap' }}>
                {formatNative(r.nativeVolume)} {NATIVE_SYMBOL}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: terminalColors.panel2, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  borderRadius: 999,
                  background: terminalColors.brandGreen,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ screen */

export function LeaderboardScreen(): JSX.Element {
  const [window, setWindow] = useState<LeaderboardWindow>('7d')
  const [metric, setMetric] = useState<LeaderboardMetric>('volume')

  const query = useLeaderboard(window, metric)
  const rows = query.data?.rows
  const usdAnchored = query.data?.usdAnchored ?? false
  const isLoading = query.isLoading
  const errorMessage = query.isError ? 'Could not load the leaderboard. Retry.' : undefined

  // Honest aggregates of the returned (ranked, capped) rows.
  const summary = useMemo(() => {
    if (!rows) {
      return undefined
    }
    let volume = 0
    let trades = 0
    for (const r of rows) {
      volume += r.nativeVolume
      trades += r.trades
    }
    return { traders: rows.length, trades, volume }
  }, [rows])

  const columns: ReadonlyArray<DataTableColumn<LeaderboardRow>> = useMemo(
    () => [
      {
        id: 'rank',
        header: '#',
        width: '52px',
        align: 'left',
        mono: true,
        mobileRole: 'secondary',
        cell: (row) => String(row.rank),
        cellColor: () => terminalColors.ink3Alt,
        sortValue: (row) => row.rank,
      },
      {
        id: 'wallet',
        header: 'Trader',
        width: 'minmax(140px,1.4fr)',
        align: 'left',
        mobileRole: 'title',
        cell: (row) => (
          <span style={{ fontFamily: MONO, fontSize: 12.5, color: terminalColors.ink }}>{shortenWallet(row.wallet)}</span>
        ),
        sortValue: (row) => row.wallet,
      },
      {
        id: 'volume',
        header: `Volume (${NATIVE_SYMBOL})`,
        width: 'minmax(110px,1fr)',
        align: 'right',
        mono: true,
        mobileRole: 'primary',
        cell: (row) => formatNative(row.nativeVolume),
        cellColor: () => terminalColors.ink,
        sortValue: (row) => row.nativeVolume,
      },
      {
        id: 'usd',
        header: 'USD',
        width: 'minmax(90px,0.8fr)',
        align: 'right',
        mono: true,
        mobileRole: 'primary',
        cell: (row) => (row.usdVolume !== null ? formatUsd(row.usdVolume) : '—'),
        cellColor: (row) => (row.usdVolume !== null ? terminalColors.ink2 : terminalColors.faint),
        sortValue: (row) => row.usdVolume ?? 0,
      },
      {
        id: 'trades',
        header: 'Trades',
        width: 'minmax(72px,0.7fr)',
        align: 'right',
        mono: true,
        mobileRole: 'secondary',
        cell: (row) => String(row.trades),
        cellColor: () => terminalColors.ink2,
        sortValue: (row) => row.trades,
      },
      {
        id: 'tokens',
        header: 'Tokens',
        width: 'minmax(72px,0.7fr)',
        align: 'right',
        mono: true,
        mobileRole: 'hide',
        cell: (row) => String(row.tokensTraded),
        cellColor: () => terminalColors.ink2,
        sortValue: (row) => row.tokensTraded,
      },
    ],
    [],
  )

  return (
    <div style={{ padding: '20px var(--tm-gutter) 40px' }}>
      {/* Header: title + window + metric */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Eyebrow>Robinhood · trader ranking</Eyebrow>
          <h1
            style={{
              fontFamily: DISPLAY,
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: terminalColors.ink,
              margin: 0,
            }}
          >
            Leaderboard
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Segmented options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
          <Segmented options={WINDOW_OPTIONS} value={window} onChange={setWindow} />
        </div>
      </div>

      <div style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt, marginBottom: 18 }}>
        Top traders on Robinhood, ranked by {metric === 'volume' ? 'swap volume' : metric === 'trades' ? 'trade count' : 'distinct tokens traded'}. Attributed to the signing wallet (tx origin); routers and pool contracts excluded.
      </div>

      {/* Summary stat cards (honest aggregates of the ranked rows) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 18,
        }}
      >
        <StatCard label="Ranked traders" value={summary ? String(summary.traders) : undefined} loading={isLoading} />
        <StatCard label="Total trades" value={summary ? String(summary.trades) : undefined} loading={isLoading} />
        <StatCard
          label={`Total volume (${NATIVE_SYMBOL})`}
          value={summary ? formatNative(summary.volume) : undefined}
          loading={isLoading}
        />
      </div>

      {/* Top-N volume bar chart (same rows the table shows; no extra fetch) */}
      <InstrumentPanel
        title="Volume by trader"
        corners
        meta={[`Top ${VOLUME_BARS_TOP_N}`, window.toUpperCase()]}
        style={{ marginBottom: 18, minWidth: 0 }}
      >
        <VolumeBars rows={rows} loading={isLoading} />
      </InstrumentPanel>

      {/* Table */}
      <InstrumentPanel
        title="Rankings"
        corners
        live
        meta={[`${metric[0].toUpperCase()}${metric.slice(1)}`, window.toUpperCase()]}
        style={{ minWidth: 0 }}
      >
        <DataTable<LeaderboardRow>
          columns={columns}
          rows={isLoading ? undefined : rows}
          rowKey={(row) => row.wallet}
          loading={isLoading}
          error={errorMessage}
          onRetry={() => void query.refetch()}
          emptyMessage="No trading activity yet — the leaderboard fills as swaps happen."
          skeletonRows={8}
          minWidth={560}
        />
      </InstrumentPanel>

      {/* USD-anchor gate note (honest — no fabricated USD ranking) */}
      {!usdAnchored ? (
        <NoteBanner>
          Ranked by native {NATIVE_SYMBOL} volume. USD ranking activates once the USD anchor pool
          (WETH/stablecoin) is seeded — until then USD figures show "—" and are never estimated.
        </NoteBanner>
      ) : null}
    </div>
  )
}

function NoteBanner({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        marginTop: 14,
        fontFamily: SANS,
        fontSize: 11.5,
        lineHeight: 1.5,
        color: terminalColors.faint,
      }}
    >
      {children}
    </div>
  )
}
