/**
 * HookSwap Farms Analytics — "Ledger" Explore (direction B).
 *
 * The editorial analytics view mounted at the TOP of the Farms page, bound to the
 * LIVE farms indexer API (`~/terminal/farms/analytics/*`). Three parts, mirroring the
 * Locker Ledger:
 *   1. Hero — big total-staked number + a glowing green area chart (/farms/tvl-history).
 *   2. Stat tiles — Total Farms, Active Farms, Chains Reachable, Total Staked (all real).
 *   3. Ledger rows — /farms, each a roomy card: staking→reward token pair (hue avatars),
 *      chain, a status pill (Active green / Ended gold), APR, TVL staked, rewards left.
 *      Sortable by TVL / APR (server-side sort).
 *
 * DATA POLICY (facts-only, no fabricated data): every value is bound to the indexer.
 * `tvlUsd` / `aprPct` / `totalTvlUsd` are OMITTED by the indexer when unpriceable (only
 * chains with a USD anchor price) → rendered as an honest "—", never $0 or a fabricated
 * APR. Loading → skeletons; indexer unreachable → an honest offline note; no farms yet →
 * an honest empty state. Nothing here invents a farm, price, TVL or yield.
 */
import { useMemo, useState } from 'react'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { LedgerAvatar, resolveLedgerLogo } from '~/terminal/components/LedgerAvatar'
import { LedgerDonut, type DonutSlice } from '~/terminal/components/LedgerDonut'
import { LedgerTvlChart, type TvlPoint } from '~/terminal/components/LedgerTvlChart'
import { StatCard } from '~/terminal/components/StatCard'
import type { Farm, FarmsSnapshot } from '~/terminal/farms/analytics/client'
import { useFarms } from '~/terminal/farms/analytics/useFarms'
import { useFarmsStats } from '~/terminal/farms/analytics/useFarmsStats'
import { useFarmsTvlHistory } from '~/terminal/farms/analytics/useFarmsTvlHistory'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

/** Small uppercase subhead above each chart within a shared panel. */
const subheadStyle: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: terminalColors.faint,
  marginBottom: 12,
}

type SortKey = 'tvl' | 'apr'

/* ------------------------------------------------------------------ APR distribution */

/** APR histogram buckets (percent units). Upper-open on the last bucket. */
const APR_BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: '0–10%', lo: 0, hi: 10 },
  { label: '10–25%', lo: 10, hi: 25 },
  { label: '25–50%', lo: 25, hi: 50 },
  { label: '50–100%', lo: 50, hi: 100 },
  { label: '100%+', lo: 100, hi: Infinity },
]

/**
 * APR distribution — a horizontal bar per bucket, counting farms whose `aprPct` is a real
 * priced value (unpriced farms are excluded, never bucketed as 0%). Honest empty state
 * when no farm has a priced APR yet.
 */
function AprHistogram({ farms, loading }: { farms?: Farm[]; loading: boolean }): JSX.Element {
  const { counts, priced, maxCount } = useMemo(() => {
    const c = new Array<number>(APR_BUCKETS.length).fill(0)
    let n = 0
    for (const f of farms ?? []) {
      const apr = f.aprPct
      if (apr === undefined || !Number.isFinite(apr)) {
        continue
      }
      n++
      const idx = APR_BUCKETS.findIndex((b) => apr >= b.lo && apr < b.hi)
      c[idx >= 0 ? idx : APR_BUCKETS.length - 1] += 1
    }
    return { counts: c, priced: n, maxCount: Math.max(1, ...c) }
  }, [farms])

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {APR_BUCKETS.map((b) => (
          <div key={b.label} style={{ height: 12, width: '80%', borderRadius: 4, background: terminalColors.line2 }} />
        ))}
      </div>
    )
  }

  if (priced === 0) {
    return (
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt, lineHeight: 1.5, padding: '8px 0' }}>
        APR distribution appears once farms report a priced yield.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {APR_BUCKETS.map((b, i) => {
        const count = counts[i]
        const w = (count / maxCount) * 100
        return (
          <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.ink3, width: 62, flexShrink: 0 }}>{b.label}</span>
            <div style={{ flex: 1, height: 8, borderRadius: 999, background: terminalColors.panel2, overflow: 'hidden', minWidth: 0 }}>
              <div style={{ width: `${w}%`, height: '100%', background: terminalColors.brandGreen, borderRadius: 999 }} />
            </div>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: terminalColors.ink, width: 28, textAlign: 'right', flexShrink: 0 }}>
              {count}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ formatting */

/** Compact USD, e.g. 2_410_000 → "$2.41M"; undefined → "—". */
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

/** APR percent (already in percent units, e.g. 42.0 = 42%); undefined → "—". */
function fmtApr(pct: number | undefined): string {
  if (pct === undefined || !Number.isFinite(pct)) {
    return '—'
  }
  if (pct > 0 && pct < 0.01) {
    return '<0.01%'
  }
  return `${pct >= 100 ? Math.round(pct).toLocaleString('en-US') : pct.toFixed(2).replace(/\.?0+$/, '')}%`
}

/** Compact token amount from a decimal-formatted string, e.g. "9.9999972" → "10". */
function fmtToken(formatted: string | undefined): string {
  if (formatted === undefined || formatted === '') {
    return '—'
  }
  const n = Number(formatted)
  if (!Number.isFinite(n)) {
    return formatted
  }
  if (n === 0) {
    return '0'
  }
  const abs = Math.abs(n)
  return new Intl.NumberFormat('en-US', {
    notation: abs >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: abs >= 1 ? 4 : 6,
  }).format(n)
}

function initials(symbol: string | undefined, len = 2): string {
  return (symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, len).toUpperCase() || '?'
}

/* ------------------------------------------------------------------ small parts */

/** Overlapping staking→reward avatar pair. */
function PairAvatar({ farm }: { farm: Farm }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, width: 52 }}>
      <LedgerAvatar
        seed={farm.stakingToken.addr}
        initials={initials(farm.stakingToken.symbol, 1)}
        size={30}
        logoUrl={resolveLedgerLogo(farm.chainId, farm.stakingToken.addr)}
      />
      <div style={{ marginLeft: -10 }}>
        <LedgerAvatar
          seed={farm.rewardToken.addr}
          initials={initials(farm.rewardToken.symbol, 1)}
          size={30}
          logoUrl={resolveLedgerLogo(farm.chainId, farm.rewardToken.addr)}
        />
      </div>
    </div>
  )
}

/** Active (green) / Ended (gold) status pill. */
function StatusPill({ status }: { status: Farm['status'] }): JSX.Element {
  const active = status === 'active'
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: active ? terminalColors.greenDeep : terminalColors.warn,
        background: active ? terminalColors.greenBg : terminalColors.warnBg,
        border: `1px solid ${active ? terminalColors.greenBorder : terminalColors.warn}`,
        padding: '2px 7px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {active ? 'Active' : 'Ended'}
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
  transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
}

/** Small label→value stat chip used in the mobile stacked-card layout. */
function MobileStat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '8px 10px',
        borderRadius: 9,
        border: `1px solid ${terminalColors.line}`,
        background: terminalColors.panel,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: SANS,
          fontSize: 10,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: terminalColors.faint,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 13.5,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: valueColor ?? terminalColors.ink,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </span>
    </div>
  )
}

const mobileStatGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
  gap: 8,
}

function FarmRow({ f }: { f: Farm }): JSX.Element {
  const [hover, setHover] = useState(false)
  const isMobile = useIsMobileViewport()
  const pairLabel = `${f.stakingToken.symbol || '?'} → ${f.rewardToken.symbol || '?'}`

  // Mobile: stacked card — identity block full-width on top, stats as a label→value
  // chip grid below (no hover-only affordances).
  if (isMobile) {
    return (
      <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <PairAvatar farm={f} />
          <div style={{ minWidth: 0, flex: 1 }}>
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
                {pairLabel}
              </span>
              <StatusPill status={f.status} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, minWidth: 0 }}>
              <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3 }}>{f.chainName}</span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: terminalColors.faint,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                stake {f.stakingToken.symbol || '?'} · earn {f.rewardToken.symbol || '?'}
              </span>
            </div>
          </div>
        </div>
        <div style={mobileStatGridStyle}>
          <MobileStat label="APR" value={fmtApr(f.aprPct)} valueColor={f.aprPct !== undefined ? terminalColors.greenDeep : terminalColors.faint} />
          <MobileStat label="TVL" value={fmtUsd(f.tvlUsd)} valueColor={f.tvlUsd !== undefined ? terminalColors.ink : terminalColors.faint} />
          <MobileStat
            label="Rewards left"
            value={`${fmtToken(f.rewardsRemaining.formatted)} ${f.rewardToken.symbol || ''}`.trim()}
            valueColor={terminalColors.ink2}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...rowStyle,
        transform: hover ? 'translateY(-2px)' : undefined,
        boxShadow: hover ? '0 8px 22px -14px rgba(11,15,20,.28)' : undefined,
        borderColor: hover ? terminalColors.greenBorder : terminalColors.line,
      }}
    >
      <PairAvatar farm={f} />

      {/* Pair + chain */}
      <div style={{ minWidth: 0, flex: '1 1 180px' }}>
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
            {pairLabel}
          </span>
          <StatusPill status={f.status} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3 }}>{f.chainName}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
            stake {f.stakingToken.symbol || '?'} · earn {f.rewardToken.symbol || '?'}
          </span>
        </div>
      </div>

      {/* APR */}
      <div style={{ flex: '0 0 78px', textAlign: 'right' }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 13.5,
            fontWeight: 600,
            color: f.aprPct !== undefined ? terminalColors.greenDeep : terminalColors.faint,
            letterSpacing: '-0.02em',
          }}
        >
          {fmtApr(f.aprPct)}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 2 }}>APR</div>
      </div>

      {/* Rewards remaining */}
      <div style={{ flex: '0 0 118px', textAlign: 'right' }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 12.5,
            fontWeight: 500,
            color: terminalColors.ink2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {fmtToken(f.rewardsRemaining.formatted)} {f.rewardToken.symbol || ''}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 2 }}>Rewards left</div>
      </div>

      {/* TVL staked */}
      <div style={{ flex: '0 0 104px', textAlign: 'right' }}>
        <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: terminalColors.ink, letterSpacing: '-0.02em' }}>
          {fmtUsd(f.tvlUsd)}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            color: terminalColors.faint,
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {fmtToken(f.tvlStaked.formatted)} {f.stakingToken.symbol || ''}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ states */

function RowSkeletons(): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} style={{ ...rowStyle, alignItems: 'center' }}>
          <div style={{ width: 52, height: 30, borderRadius: 999, background: terminalColors.line2, flexShrink: 0 }} />
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
      <span>Farms analytics service is unreachable — showing no fabricated data.</span>
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

export function FarmsExplore(): JSX.Element {
  const [sort, setSort] = useState<SortKey>('tvl')

  const isMobile = useIsMobileViewport()
  const statsHook = useFarmsStats()
  const tvlHook = useFarmsTvlHistory()
  const farmsHook = useFarms({ sort })

  const stats = statsHook.stats

  // Active-vs-ended donut — both counts derive from /farms/stats (always present).
  const statusDonut = useMemo<DonutSlice[] | undefined>(() => {
    if (!stats) {
      return undefined
    }
    const ended = Math.max(0, stats.totalFarms - stats.activeFarms)
    return [
      { label: 'Active', value: stats.activeFarms, color: terminalColors.greenUp },
      { label: 'Ended', value: ended, color: terminalColors.warn },
    ]
  }, [stats])

  // Only snapshots that carry a real USD value can be charted — the rest are unpriced
  // (honest gap, never a fabricated point). With < 2 the chart shows its empty state.
  const chartPoints = useMemo<TvlPoint[]>(() => {
    if (!tvlHook.points) {
      return []
    }
    return tvlHook.points
      .filter((p): p is FarmsSnapshot & { totalTvlUsd: number } => typeof p.totalTvlUsd === 'number' && Number.isFinite(p.totalTvlUsd))
      .map((p) => ({ label: p.dateISO, value: p.totalTvlUsd }))
  }, [tvlHook.points])

  // Activity fallback — farm COUNT per snapshot (always present, even unpriced). The
  // chart plots this when there aren't ≥ 2 priced USD points, so there's always a real
  // line instead of an empty box. Never a fabricated USD value.
  const countPoints = useMemo<TvlPoint[]>(() => {
    if (!tvlHook.points) {
      return []
    }
    return tvlHook.points
      .filter((p) => Number.isFinite(p.totalFarms))
      .map((p) => ({ label: p.dateISO, value: p.totalFarms }))
  }, [tvlHook.points])

  // Client-side stable sort by the chosen metric (server sorts too; this keeps priced
  // farms ahead of unpriced ones so the honest "—" rows sink to the bottom).
  const farms = useMemo(() => {
    if (!farmsHook.farms) {
      return undefined
    }
    const metric = (f: Farm): number | undefined => (sort === 'apr' ? f.aprPct : f.tvlUsd)
    return [...farmsHook.farms].sort((a, b) => {
      const ma = metric(a)
      const mb = metric(b)
      if (ma !== undefined && mb !== undefined && ma !== mb) {
        return mb - ma
      }
      if (ma !== undefined && mb === undefined) {
        return -1
      }
      if (ma === undefined && mb !== undefined) {
        return 1
      }
      // Tie-break: active farms first, then larger raw staked amount.
      if (a.status !== b.status) {
        return a.status === 'active' ? -1 : 1
      }
      const ra = BigInt(a.tvlStaked.raw || '0')
      const rb = BigInt(b.tvlStaked.raw || '0')
      return rb > ra ? 1 : rb < ra ? -1 : 0
    })
  }, [farmsHook.farms, sort])

  // Fully offline only when the stats call itself failed (the spine of the section).
  const offline = statsHook.error

  const tvlDisplay = stats?.totalTvlUsd
  const heroNumber = statsHook.isLoading ? undefined : fmtUsd(tvlDisplay)

  return (
    <div style={{ marginBottom: 24 }}>
      {offline ? <OfflineNote onRetry={statsHook.refetch} /> : null}

      {/* Hero — total staked value + glowing area chart */}
      <InstrumentPanel title="TOTAL STAKED" corners style={{ marginBottom: 14 }}>
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
                color: tvlDisplay !== undefined ? terminalColors.ink : terminalColors.ink3,
                lineHeight: 1.05,
              }}
            >
              {heroNumber}
            </span>
          )}
          <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
            {fmtInt(stats?.activeFarms)} active · across {fmtInt(stats?.reachableChains)}/{fmtInt(stats?.chains)} chains
          </span>
        </div>
        {tvlDisplay === undefined && !statsHook.isLoading ? (
          <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3, marginBottom: 6, maxWidth: 560, lineHeight: 1.5 }}>
            A USD total shows only where a stablecoin price anchor exists on the chain. Farms on chains without a priced
            anchor are tracked in staked-token amounts — see the Ledger below.
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          {tvlHook.isLoading ? (
            <div style={{ height: 240, borderRadius: 10, background: terminalColors.panel }} aria-busy="true" />
          ) : (
            <LedgerTvlChart
              points={chartPoints}
              countPoints={countPoints}
              countLabel="Farms over time"
              emptyText="Staked-value history builds as daily snapshots accrue."
            />
          )}
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
        <StatCard size="lg" label="Total Farms" value={stats ? fmtInt(stats.totalFarms) : undefined} loading={statsHook.isLoading} />
        <StatCard
          size="lg"
          label="Active Farms"
          value={stats ? fmtInt(stats.activeFarms) : undefined}
          valueColor={stats && stats.activeFarms > 0 ? 'up' : 'ink'}
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
          label="Total Staked (USD)"
          value={stats ? fmtUsd(stats.totalTvlUsd) : undefined}
          loading={statsHook.isLoading}
          comingSoon={Boolean(stats) && stats!.totalTvlUsd === undefined}
        />
      </div>

      {/* Composition — farm status + APR distribution */}
      <InstrumentPanel title="COMPOSITION" style={{ marginBottom: 14 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'minmax(240px, 1fr) minmax(0, 1.4fr)',
            gap: isMobile ? 20 : 26,
            alignItems: 'start',
          }}
        >
          <div>
            <div style={subheadStyle}>Farm status</div>
            <LedgerDonut
              slices={statusDonut}
              loading={statsHook.isLoading}
              centerValue={stats ? fmtInt(stats.totalFarms) : undefined}
              centerLabel="Farms"
              emptyText="No farms yet."
            />
          </div>
          <div>
            <div style={subheadStyle}>APR distribution</div>
            <AprHistogram farms={farmsHook.farms} loading={farmsHook.isLoading && !farmsHook.farms} />
          </div>
        </div>
      </InstrumentPanel>

      {/* Ledger — farms explore */}
      <InstrumentPanel
        title="LEDGER"
        meta={[
          <span key="cnt" style={{ fontFamily: MONO }}>
            {fmtInt(farmsHook.total)} farms
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
          {(['tvl', 'apr'] as const).map((id) => {
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
                {id === 'tvl' ? 'Top TVL' : 'Top APR'}
              </button>
            )
          })}
        </div>

        {farmsHook.error ? (
          <EmptyState text="Couldn’t load farms from the analytics service." />
        ) : farms === undefined ? (
          <RowSkeletons />
        ) : farms.length === 0 ? (
          <EmptyState text="No farms yet. Staking farms appear here as they’re created on-chain." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {farms.map((f) => (
              <FarmRow key={`${f.chainId}-${f.farm}`} f={f} />
            ))}
          </div>
        )}
      </InstrumentPanel>
    </div>
  )
}
