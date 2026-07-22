/**
 * HookSwap Vesting Analytics — "Ledger" Explore (direction B).
 *
 * The editorial analytics view mounted at the TOP of the Vesting page, bound to the
 * LIVE vesting indexer API (`~/terminal/vesting/analytics/*`). Three parts, mirroring the
 * Farms / Locker Ledger:
 *   1. Hero — big total-vesting number + a glowing green area chart (/vesting/tvl-history).
 *   2. Stat tiles — Total Schedules, Active, Chains Reachable, Total Vesting (all real).
 *   3. Ledger rows — /vesting, each a roomy card: token (hue avatar) + symbol, chain, a
 *      status pill (Cliff gold / Vesting green / Complete muted), a % vested progress bar,
 *      total amount, claimable, cliff/end dates. Sortable by TVL / Ending / % vested.
 *
 * DATA POLICY (facts-only, no fabricated data): every value is bound to the indexer.
 * `valueUsd` / `totalTvlUsd` are OMITTED by the indexer when unpriceable (only chains
 * with a USD anchor price) → rendered as an honest "—", never $0. Loading → skeletons;
 * indexer unreachable → an honest offline note; no schedules yet → an honest empty state.
 * Nothing here invents a schedule, price, amount or date.
 */
import { useMemo, useState } from 'react'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { LedgerAvatar, resolveLedgerLogo } from '~/terminal/components/LedgerAvatar'
import { LedgerTvlChart, type TvlPoint } from '~/terminal/components/LedgerTvlChart'
import { StatCard } from '~/terminal/components/StatCard'
import type { VestingSchedule, VestingSnapshot, VestingSort, VestingStatus } from '~/terminal/vesting/analytics/client'
import { useVesting } from '~/terminal/vesting/analytics/useVesting'
import { useVestingStats } from '~/terminal/vesting/analytics/useVestingStats'
import { useVestingTvlHistory } from '~/terminal/vesting/analytics/useVestingTvlHistory'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

type SortKey = Extract<VestingSort, 'tvl' | 'ending' | 'pct'>

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

/** Percent (0–100); undefined → "—". */
function fmtPct(pct: number | undefined): string {
  if (pct === undefined || !Number.isFinite(pct)) {
    return '—'
  }
  if (pct > 0 && pct < 0.1) {
    return '<0.1%'
  }
  if (pct >= 100) {
    return '100%'
  }
  return `${pct.toFixed(1).replace(/\.0$/, '')}%`
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

/** Unix seconds → a compact UTC date label (e.g. "Jul 21, 2026"). */
function fmtDate(unixSec: number | undefined): string {
  if (unixSec === undefined || !Number.isFinite(unixSec) || unixSec <= 0) {
    return '—'
  }
  return new Date(unixSec * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function shortAddr(a?: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—'
}

function initials(symbol: string | undefined, len = 2): string {
  return (symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, len).toUpperCase() || '?'
}

/* ------------------------------------------------------------------ small parts */

const STATUS_META: Record<VestingStatus, { label: string; color: string; bg: string; border: string }> = {
  cliff: { label: 'Cliff', color: terminalColors.warn, bg: terminalColors.warnBg, border: terminalColors.warn },
  vesting: { label: 'Vesting', color: terminalColors.greenDeep, bg: terminalColors.greenBg, border: terminalColors.greenBorder },
  complete: { label: 'Complete', color: terminalColors.ink3, bg: terminalColors.panel2, border: terminalColors.line },
}

/** Cliff (gold) / Vesting (green) / Complete (muted) status pill. */
function StatusPill({ status }: { status: VestingStatus }): JSX.Element {
  const m = STATUS_META[status] ?? STATUS_META.vesting
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: m.color,
        background: m.bg,
        border: `1px solid ${m.border}`,
        padding: '2px 7px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {m.label}
    </span>
  )
}

/** % vested progress bar (locker locked-% bar style). */
function VestedBar({ pct, status }: { pct: number; status: VestingStatus }): JSX.Element {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
  const fill = status === 'complete' ? terminalColors.ink3 : terminalColors.greenUp
  return (
    <div
      title={`${fmtPct(pct)} vested`}
      style={{ height: 8, borderRadius: 999, overflow: 'hidden', background: terminalColors.panel2 }}
    >
      <div style={{ width: `${clamped}%`, height: '100%', background: fill, transition: 'width 200ms ease' }} />
    </div>
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

function ScheduleRow({ s }: { s: VestingSchedule }): JSX.Element {
  const [hover, setHover] = useState(false)
  const isMobile = useIsMobileViewport()
  const sym = s.token.symbol || shortAddr(s.token.addr)

  // Mobile: stacked card — identity + % vested bar full-width on top, stats as a
  // label→value chip grid below (no hover-only affordances).
  if (isMobile) {
    return (
      <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <LedgerAvatar
            seed={s.token.addr}
            initials={initials(s.token.symbol)}
            size={34}
            logoUrl={resolveLedgerLogo(s.chainId, s.token.addr)}
          />
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
                {sym}
              </span>
              <StatusPill status={s.status} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3 }}>{s.chainName}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>to {shortAddr(s.beneficiary)}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
                {s.cliff > 0 ? `cliff ${fmtDate(s.cliffTime)} · ` : ''}ends {fmtDate(s.endTime)}
              </span>
            </div>
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: terminalColors.ink, letterSpacing: '-0.02em' }}>
              {fmtPct(s.pctVested)}
            </span>
            <span style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint }}>vested</span>
          </div>
          <VestedBar pct={s.pctVested} status={s.status} />
        </div>
        <div style={mobileStatGridStyle}>
          <MobileStat
            label="Claimable"
            value={`${fmtToken(s.claimable.formatted)} ${s.token.symbol || ''}`.trim()}
            valueColor={Number(s.claimable.formatted) > 0 ? terminalColors.greenDeep : terminalColors.ink2}
          />
          <MobileStat label="Total" value={`${fmtToken(s.totalAmount.formatted)} ${s.token.symbol || ''}`.trim()} />
          <MobileStat label="Value" value={fmtUsd(s.valueUsd)} valueColor={s.valueUsd !== undefined ? terminalColors.ink : terminalColors.faint} />
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
      <LedgerAvatar
        seed={s.token.addr}
        initials={initials(s.token.symbol)}
        size={34}
        logoUrl={resolveLedgerLogo(s.chainId, s.token.addr)}
      />

      {/* Token + chain + parties + dates */}
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
            {sym}
          </span>
          <StatusPill status={s.status} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3 }}>{s.chainName}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
            to {shortAddr(s.beneficiary)}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
            {s.cliff > 0 ? `cliff ${fmtDate(s.cliffTime)} · ` : ''}ends {fmtDate(s.endTime)}
          </span>
        </div>
      </div>

      {/* % vested + bar */}
      <div style={{ flex: '0 0 128px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: terminalColors.ink, letterSpacing: '-0.02em' }}>
            {fmtPct(s.pctVested)}
          </span>
          <span style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint }}>vested</span>
        </div>
        <VestedBar pct={s.pctVested} status={s.status} />
      </div>

      {/* Claimable */}
      <div style={{ flex: '0 0 108px', textAlign: 'right' }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 12.5,
            fontWeight: 600,
            color: Number(s.claimable.formatted) > 0 ? terminalColors.greenDeep : terminalColors.ink2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {fmtToken(s.claimable.formatted)} {s.token.symbol || ''}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 2 }}>Claimable</div>
      </div>

      {/* Total amount + USD */}
      <div style={{ flex: '0 0 108px', textAlign: 'right' }}>
        <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: terminalColors.ink, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fmtToken(s.totalAmount.formatted)} {s.token.symbol || ''}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.faint, marginTop: 2 }}>{fmtUsd(s.valueUsd)}</div>
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
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: terminalColors.line2, flexShrink: 0 }} />
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
      <span>Vesting analytics service is unreachable — showing no fabricated data.</span>
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

const SORT_LABEL: Record<SortKey, string> = { tvl: 'Top value', ending: 'Ending soon', pct: 'Most vested' }

export function VestingExplore(): JSX.Element {
  const [sort, setSort] = useState<SortKey>('tvl')

  const statsHook = useVestingStats()
  const tvlHook = useVestingTvlHistory()
  const listHook = useVesting({ sort })

  const stats = statsHook.stats

  // Only snapshots that carry a real USD value can be charted — the rest are unpriced
  // (honest gap, never a fabricated point). With < 2 the chart shows its empty state.
  const chartPoints = useMemo<TvlPoint[]>(() => {
    if (!tvlHook.points) {
      return []
    }
    return tvlHook.points
      .filter((p): p is VestingSnapshot & { totalTvlUsd: number } => typeof p.totalTvlUsd === 'number' && Number.isFinite(p.totalTvlUsd))
      .map((p) => ({ label: p.dateISO, value: p.totalTvlUsd }))
  }, [tvlHook.points])

  // Activity fallback — schedule COUNT per snapshot (always present, even unpriced). The
  // chart plots this when there aren't ≥ 2 priced USD points, so there's always a real
  // line instead of an empty box. Never a fabricated USD value.
  const countPoints = useMemo<TvlPoint[]>(() => {
    if (!tvlHook.points) {
      return []
    }
    return tvlHook.points
      .filter((p) => Number.isFinite(p.totalSchedules))
      .map((p) => ({ label: p.dateISO, value: p.totalSchedules }))
  }, [tvlHook.points])

  // Server sorts too; the list is rendered as returned (honest indexer order).
  const schedules = listHook.schedules

  // Fully offline only when the stats call itself failed (the spine of the section).
  const offline = statsHook.error

  const tvlDisplay = stats?.totalTvlUsd
  const heroNumber = statsHook.isLoading ? undefined : fmtUsd(tvlDisplay)

  return (
    <div style={{ marginBottom: 24 }}>
      {offline ? <OfflineNote onRetry={statsHook.refetch} /> : null}

      {/* Hero — total vesting value + glowing area chart */}
      <InstrumentPanel title="TOTAL VESTING" corners style={{ marginBottom: 14 }}>
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
            {fmtInt(stats?.activeSchedules)} active · across {fmtInt(stats?.reachableChains)}/{fmtInt(stats?.chains)} chains
          </span>
        </div>
        {tvlDisplay === undefined && !statsHook.isLoading ? (
          <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3, marginBottom: 6, maxWidth: 560, lineHeight: 1.5 }}>
            A USD total shows only where a stablecoin price anchor exists on the chain. Schedules on chains without a
            priced anchor are tracked in token amounts — see the Ledger below.
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          {tvlHook.isLoading ? (
            <div style={{ height: 240, borderRadius: 10, background: terminalColors.panel }} aria-busy="true" />
          ) : (
            <LedgerTvlChart
              points={chartPoints}
              countPoints={countPoints}
              countLabel="Schedules over time"
              emptyText="Vesting-value history builds as daily snapshots accrue."
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
        <StatCard size="lg" label="Total Schedules" value={stats ? fmtInt(stats.totalSchedules) : undefined} loading={statsHook.isLoading} />
        <StatCard
          size="lg"
          label="Active"
          value={stats ? fmtInt(stats.activeSchedules) : undefined}
          valueColor={stats && stats.activeSchedules > 0 ? 'up' : 'ink'}
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
          label="Total Vesting (USD)"
          value={stats ? fmtUsd(stats.totalTvlUsd) : undefined}
          loading={statsHook.isLoading}
          comingSoon={Boolean(stats) && stats!.totalTvlUsd === undefined}
        />
      </div>

      {/* Ledger — schedules explore */}
      <InstrumentPanel
        title="LEDGER"
        meta={[
          <span key="cnt" style={{ fontFamily: MONO }}>
            {fmtInt(listHook.total)} schedules
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
          {(['tvl', 'ending', 'pct'] as const).map((id) => {
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
                {SORT_LABEL[id]}
              </button>
            )
          })}
        </div>

        {listHook.error ? (
          <EmptyState text="Couldn’t load vesting schedules from the analytics service." />
        ) : schedules === undefined ? (
          <RowSkeletons />
        ) : schedules.length === 0 ? (
          <EmptyState text="No vesting schedules yet. Schedules appear here as they’re created on-chain." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {schedules.map((s) => (
              <ScheduleRow key={`${s.chainId}-${s.id}`} s={s} />
            ))}
          </div>
        )}
      </InstrumentPanel>
    </div>
  )
}
