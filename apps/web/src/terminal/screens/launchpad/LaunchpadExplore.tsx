/**
 * HookSwap LaunchPad Analytics — "Ledger" Explore.
 *
 * The editorial analytics view mounted at the TOP of the LaunchPad page, bound to the
 * LIVE launchpad indexer API (`~/terminal/launchpad/analytics/*`). Three parts, mirroring
 * the Farms / Locker Ledger:
 *   1. Hero — big Total Market Cap number (there is NO launch TVL-history endpoint, so this
 *      hero is a single figure with NO fabricated time-series chart).
 *   2. Stat tiles — Total Launches, LP-Locked, Chains Reachable, Total Market Cap (all real).
 *   3. Ledger rows — /launches, each a roomy card: token avatar + name/symbol, chain, an
 *      LP-locked pill (green when locked), market cap (or "—"), fee tier, created date.
 *      Sortable by Market Cap / Newest (server-side sort). Each row links to the shareable
 *      launch page (`/launch/:chainId/:token`).
 *
 * DATA POLICY (facts-only, no fabricated data): every value is bound to the indexer.
 * `marketCapUsd` / `totalMarketCapUsd` are OMITTED by the indexer when unpriceable (only
 * chains with a USD anchor price) → rendered as an honest "—", never $0 or a fabricated
 * market cap. Loading → skeletons; indexer unreachable → an honest offline note; no launches
 * yet → an honest empty state. Nothing here invents a launch, token, price, or market cap.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { LedgerAvatar, resolveLedgerLogo } from '~/terminal/components/LedgerAvatar'
import { StatCard } from '~/terminal/components/StatCard'
import type { Launch } from '~/terminal/launchpad/analytics/client'
import { useLaunches } from '~/terminal/launchpad/analytics/useLaunches'
import { useLaunchesStats } from '~/terminal/launchpad/analytics/useLaunchesStats'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

type SortKey = 'mcap' | 'created'

/* ------------------------------------------------------------------ formatting */

/** Compact USD, e.g. 5_845 → "$5.85K"; undefined → "—" (never $0 for unpriced). */
function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) {
    return '—'
  }
  if (n === 0) {
    return '$0'
  }
  const abs = Math.abs(n)
  const compact = new Intl.NumberFormat('en-US', {
    notation: abs >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 2,
    minimumFractionDigits: abs >= 1000 ? 0 : 2,
  }).format(n)
  return `$${compact}`
}

/** Integer with grouping, e.g. 1234 → "1,234". */
function fmtInt(n: number | undefined): string {
  return n === undefined || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US').format(n)
}

/** Uniswap fee tier in hundredths of a bip → percent label, e.g. 10000 → "1%". */
function fmtFeeTier(feeTier: number | undefined): string {
  if (feeTier === undefined || !Number.isFinite(feeTier)) {
    return '—'
  }
  const pct = feeTier / 10_000
  return `${pct.toFixed(2).replace(/\.?0+$/, '')}%`
}

/** Human date from a UNIX-seconds timestamp, e.g. "Aug 20, 2026". */
function fmtDate(unixSeconds: number | undefined): string {
  if (unixSeconds === undefined || !Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return '—'
  }
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function initials(symbol: string | undefined, len = 2): string {
  return (symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, len).toUpperCase() || '?'
}

/* ------------------------------------------------------------------ small parts */

/** LP-locked (green) / Unlocked (gold) status pill. */
function LpPill({ locked }: { locked: boolean }): JSX.Element {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: locked ? terminalColors.greenDeep : terminalColors.warn,
        background: locked ? terminalColors.greenBg : terminalColors.warnBg,
        border: `1px solid ${locked ? terminalColors.greenBorder : terminalColors.warn}`,
        padding: '2px 7px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {locked ? '🔒 LP Locked' : 'LP Unlocked'}
    </span>
  )
}

/* ------------------------------------------------------------------ ledger row */

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '14px 16px',
  borderRadius: 12,
  border: `1px solid ${terminalColors.line}`,
  background: terminalColors.bg,
  textDecoration: 'none',
  transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
}

function LaunchRow({ l }: { l: Launch }): JSX.Element {
  const [hover, setHover] = useState(false)
  const name = l.token.name || l.token.symbol || 'Unknown'
  return (
    <Link
      to={`/launch/${l.chainId}/${l.token.addr}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...rowStyle,
        transform: hover ? 'translateY(-2px)' : undefined,
        boxShadow: hover ? '0 8px 22px -14px rgba(11,15,20,.28)' : undefined,
        borderColor: hover ? terminalColors.greenBorder : terminalColors.line,
      }}
    >
      <LedgerAvatar
        seed={l.token.addr}
        initials={initials(l.token.symbol)}
        size={34}
        logoUrl={resolveLedgerLogo(l.chainId, l.token.addr)}
      />

      {/* Name/symbol + chain */}
      <div style={{ minWidth: 0, flex: '1 1 200px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 13.5,
              fontWeight: 600,
              color: terminalColors.ink,
              letterSpacing: '-0.01em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {l.token.symbol || '?'}
          </span>
          <LpPill locked={Boolean(l.lpLocked)} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, minWidth: 0 }}>
          <span
            style={{
              fontFamily: SANS,
              fontSize: 11.5,
              color: terminalColors.ink3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint, whiteSpace: 'nowrap' }}>
            {l.chainName}
          </span>
        </div>
      </div>

      {/* Fee tier */}
      <div style={{ flex: '0 0 68px', textAlign: 'right' }}>
        <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: terminalColors.ink2, letterSpacing: '-0.02em' }}>
          {fmtFeeTier(l.feeTier)}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 2 }}>Fee tier</div>
      </div>

      {/* Created */}
      <div style={{ flex: '0 0 104px', textAlign: 'right' }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 12.5,
            fontWeight: 500,
            color: terminalColors.ink2,
            whiteSpace: 'nowrap',
          }}
        >
          {fmtDate(l.createdAt)}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 2 }}>Created</div>
      </div>

      {/* Market cap */}
      <div style={{ flex: '0 0 104px', textAlign: 'right' }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 14,
            fontWeight: 600,
            color: l.marketCapUsd !== undefined ? terminalColors.ink : terminalColors.faint,
            letterSpacing: '-0.02em',
          }}
        >
          {fmtUsd(l.marketCapUsd)}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 2 }}>Market cap</div>
      </div>
    </Link>
  )
}

/* ------------------------------------------------------------------ states */

function RowSkeletons(): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} style={{ ...rowStyle, alignItems: 'center' }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: terminalColors.line2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 12, width: '40%', borderRadius: 4, background: terminalColors.line2 }} />
            <div style={{ height: 10, width: '55%', borderRadius: 4, background: terminalColors.line3, marginTop: 7 }} />
          </div>
          <div style={{ height: 12, width: 70, borderRadius: 4, background: terminalColors.line2 }} />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ text }: { text: string }): JSX.Element {
  return (
    <div style={{ padding: '28px 16px', textAlign: 'center', fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3, lineHeight: 1.5 }}>
      {text}
    </div>
  )
}

function OfflineNote({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '11px 14px',
        marginBottom: 16,
        border: `1px dashed ${terminalColors.line}`,
        borderRadius: 12,
        background: terminalColors.panel,
        fontFamily: SANS,
        fontSize: 12.5,
        color: terminalColors.ink3,
      }}
    >
      <span>LaunchPad analytics service is unreachable — showing no fabricated data.</span>
      <button
        type="button"
        onClick={onRetry}
        style={{
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: terminalColors.ink2,
          background: terminalColors.bg,
          border: `1px solid ${terminalColors.line}`,
          borderRadius: 8,
          padding: '5px 12px',
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ the section */

export function LaunchpadExplore(): JSX.Element {
  const [sort, setSort] = useState<SortKey>('mcap')

  const statsHook = useLaunchesStats()
  const launchesHook = useLaunches({ sort })

  const stats = statsHook.stats

  // Client-side stable sort by the chosen metric (server sorts too; this keeps priced
  // launches ahead of unpriced ones so the honest "—" rows sink to the bottom when
  // sorting by market cap).
  const launches = useMemo(() => {
    if (!launchesHook.launches) {
      return undefined
    }
    const list = [...launchesHook.launches]
    if (sort === 'created') {
      return list.sort((a, b) => b.createdAt - a.createdAt)
    }
    return list.sort((a, b) => {
      const ma = a.marketCapUsd
      const mb = b.marketCapUsd
      if (ma !== undefined && mb !== undefined && ma !== mb) {
        return mb - ma
      }
      if (ma !== undefined && mb === undefined) {
        return -1
      }
      if (ma === undefined && mb !== undefined) {
        return 1
      }
      return b.createdAt - a.createdAt
    })
  }, [launchesHook.launches, sort])

  // Fully offline only when the stats call itself failed (the spine of the section).
  const offline = statsHook.error

  const mcapDisplay = stats?.totalMarketCapUsd
  const heroNumber = statsHook.isLoading ? undefined : fmtUsd(mcapDisplay)

  return (
    <div style={{ marginBottom: 24 }}>
      {offline ? <OfflineNote onRetry={statsHook.refetch} /> : null}

      {/* Hero — total market cap (no launch TVL-history endpoint → single figure, no chart) */}
      <InstrumentPanel title="TOTAL MARKET CAP" corners style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          {heroNumber === undefined ? (
            <div style={{ height: 40, width: 200, borderRadius: 6, background: terminalColors.line2 }} aria-busy="true" />
          ) : (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 42,
                fontWeight: 600,
                letterSpacing: '-0.03em',
                color: mcapDisplay !== undefined ? terminalColors.ink : terminalColors.ink3,
                lineHeight: 1.05,
              }}
            >
              {heroNumber}
            </span>
          )}
          <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
            {fmtInt(stats?.totalLaunches)} launches · across {fmtInt(stats?.reachableChains)}/{fmtInt(stats?.chains)} chains
          </span>
        </div>
        <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3, marginTop: 4, maxWidth: 560, lineHeight: 1.5 }}>
          {mcapDisplay === undefined && !statsHook.isLoading
            ? 'A USD market cap shows only where a stablecoin price anchor exists on the chain. Launches on chains without a priced anchor are tracked by token supply — see the Ledger below.'
            : 'Aggregate market cap of every fair-launch tracked by the LaunchPad indexer, priced where a USD anchor exists on the chain.'}
        </div>
      </InstrumentPanel>

      {/* Stat tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 14,
        }}
      >
        <StatCard size="lg" label="Total Launches" value={stats ? fmtInt(stats.totalLaunches) : undefined} loading={statsHook.isLoading} />
        <StatCard
          size="lg"
          label="LP-Locked"
          value={stats ? fmtInt(stats.lpLockedLaunches) : undefined}
          valueColor={stats && stats.lpLockedLaunches > 0 ? 'up' : 'ink'}
          loading={statsHook.isLoading}
        />
        <StatCard
          size="lg"
          label="Chains Reachable"
          value={stats ? `${fmtInt(stats.reachableChains)}/${fmtInt(stats.chains)}` : undefined}
          loading={statsHook.isLoading}
        />
        <StatCard
          size="lg"
          label="Total Market Cap"
          value={stats ? fmtUsd(stats.totalMarketCapUsd) : undefined}
          loading={statsHook.isLoading}
          comingSoon={Boolean(stats) && stats!.totalMarketCapUsd === undefined}
        />
      </div>

      {/* Ledger — launches explore */}
      <InstrumentPanel
        title="LEDGER"
        meta={[
          <span key="cnt" style={{ fontFamily: MONO }}>
            {fmtInt(launchesHook.total)} launches
          </span>,
        ]}
      >
        {/* Sort toggle */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: terminalColors.panel2,
            padding: 4,
            borderRadius: 10,
            width: 'fit-content',
            marginBottom: 14,
          }}
        >
          {(['mcap', 'created'] as const).map((id) => {
            const active = sort === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSort(id)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 7,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: SANS,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: active ? terminalColors.ink : terminalColors.ink2,
                  background: active ? terminalColors.bg : 'transparent',
                  boxShadow: active ? '0 1px 2px rgba(11,15,20,.06)' : undefined,
                }}
              >
                {id === 'mcap' ? 'Top Market Cap' : 'Newest'}
              </button>
            )
          })}
        </div>

        {launchesHook.error ? (
          <EmptyState text="Couldn’t load launches from the analytics service." />
        ) : launches === undefined ? (
          <RowSkeletons />
        ) : launches.length === 0 ? (
          <EmptyState text="No launches yet. Fair-launched tokens appear here as they’re created on-chain." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {launches.map((l) => (
              <LaunchRow key={`${l.chainId}-${l.id}`} l={l} />
            ))}
          </div>
        )}
      </InstrumentPanel>
    </div>
  )
}
