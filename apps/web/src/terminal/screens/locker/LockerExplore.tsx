/**
 * HookSwap Locker Analytics — "Ledger" Explore (direction B).
 *
 * The editorial analytics view mounted at the TOP of the Locker page, bound to the
 * LIVE locker indexer API (`~/terminal/lockers/analytics/*`). Three parts:
 *   1. Hero — big total-value-locked number + a glowing green area chart (/tvl-history).
 *   2. Stat tiles — Total Locked, Locks Created, New · 24h, Chains Reachable (all real).
 *   3. Ledger rows — /tokens (default) and /pools, toggle-able, each a roomy card with a
 *      deterministic avatar, chain + type badge, a locked-% bar (tokens) and TVL.
 *
 * DATA POLICY (facts-only, no fabricated data): every value is bound to the indexer.
 * USD fields are OMITTED by the indexer when unpriceable → rendered as an honest "—",
 * never $0. Loading → skeletons; indexer unreachable → an honest offline note; no
 * locks yet → an honest empty state. Nothing here invents a lock, price, or TVL.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { LedgerAvatar, resolveLedgerLogo } from '~/terminal/components/LedgerAvatar'
import { LedgerDonut, type DonutSlice } from '~/terminal/components/LedgerDonut'
import { LedgerTvlChart, type TvlPoint } from '~/terminal/components/LedgerTvlChart'
import { buildPerChainStack } from '~/terminal/components/ledgerPerChain'
import { StatCard } from '~/terminal/components/StatCard'
import type { Lock, PoolAgg, TokenAgg, TVLSnapshot } from '~/terminal/lockers/analytics/client'
import { useLockerLocks } from '~/terminal/lockers/analytics/useLockerLocks'
import { useLockerPools } from '~/terminal/lockers/analytics/useLockerPools'
import { useLockerStats } from '~/terminal/lockers/analytics/useLockerStats'
import { useLockerTokens } from '~/terminal/lockers/analytics/useLockerTokens'
import { useLockerTvlHistory } from '~/terminal/lockers/analytics/useLockerTvlHistory'
import { UnlockScheduleChart } from '~/terminal/screens/locker/UnlockScheduleChart'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans
const DISPLAY = terminalFonts.display

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

/** Percent-of-supply (already in percent units, e.g. 0.25 = 0.25%). */
function fmtPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return '—'
  }
  if (pct > 0 && pct < 0.01) {
    return '<0.01%'
  }
  return `${pct >= 100 ? Math.round(pct) : pct.toFixed(2).replace(/\.?0+$/, '')}%`
}

/* ------------------------------------------------------------------ small parts */

/** Shared hue avatar (deterministic colour from the seed). */
const Avatar = LedgerAvatar

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'green' }): JSX.Element {
  const green = tone === 'green'
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        color: green ? terminalColors.greenDeep : terminalColors.ink3,
        background: green ? terminalColors.greenBg : terminalColors.panel2,
        border: `1px solid ${green ? terminalColors.greenBorder : terminalColors.line}`,
        padding: '2px 7px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

/** Locked-%-of-supply bar (tokens only). Width clamps to [0,100]. */
function PctBar({ pct }: { pct: number }): JSX.Element {
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 999, background: terminalColors.panel2, overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', background: terminalColors.brandGreen, borderRadius: 999 }} />
      </div>
      <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.ink2, minWidth: 44, textAlign: 'right' }}>
        {fmtPct(pct)}
      </span>
    </div>
  )
}

/**
 * KPI card for the "Total Locked" slot when the chain has NO USD price anchor (so a USD
 * total would be fabricated). Instead of a dead "No data yet" tombstone, it shows the real
 * lock COUNT with an honest note that value is tracked in native amounts — never a $ figure.
 * Styled to match `StatCard size="lg"` (radius 12, padding 14×16, mono 22px value).
 */
function NativeLockedCard({ lockCount }: { lockCount: number }): JSX.Element {
  return (
    <div
      style={{
        border: `1px solid ${terminalColors.line}`,
        borderRadius: 12,
        background: terminalColors.bg,
        padding: '14px 16px',
        fontFamily: SANS,
        boxSizing: 'border-box',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 12, color: terminalColors.ink3Alt }}>Total Locked</div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 22,
          fontWeight: 600,
          color: terminalColors.ink,
          marginTop: 5,
          letterSpacing: '-0.02em',
        }}
      >
        {fmtInt(lockCount)} lock{lockCount === 1 ? '' : 's'}
      </div>
      <div style={{ fontSize: 11, color: terminalColors.ink3Alt, marginTop: 4, lineHeight: 1.4 }}>
        Native amounts — no USD price anchor
      </div>
    </div>
  )
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
  gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
  gap: 8,
}

/* ------------------------------------------------------------------ ledger rows */

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

/**
 * One roomy Ledger card. When `to` is set the whole row becomes a react-router link to
 * the proof-of-lock detail page — styled to inherit (no underline / link colour) so it
 * looks identical to a static row, just clickable. `to` is omitted when no lock id could
 * be resolved for the aggregate (never links to a fabricated / wrong lock).
 */
function LedgerRow({ children, to, mobile }: { children: React.ReactNode; to?: string; mobile?: boolean }): JSX.Element {
  const [hover, setHover] = useState(false)
  // Mobile: stacked card (column), whole card tappable, no hover-only affordances.
  if (mobile) {
    const style: React.CSSProperties = { ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 12 }
    if (to) {
      return (
        <Link to={to} className="tm-tap" style={{ ...style, textDecoration: 'none', color: 'inherit' }}>
          {children}
        </Link>
      )
    }
    return <div style={style}>{children}</div>
  }
  const style: React.CSSProperties = {
    ...rowStyle,
    transform: hover ? 'translateY(-2px)' : undefined,
    boxShadow: hover ? '0 8px 22px -14px rgba(11,15,20,.28)' : undefined,
    borderColor: hover ? terminalColors.greenBorder : terminalColors.line,
  }
  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
  }
  if (to) {
    return (
      <Link
        to={to}
        {...handlers}
        style={{ ...style, textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
      >
        {children}
      </Link>
    )
  }
  return (
    <div {...handlers} style={style}>
      {children}
    </div>
  )
}

/** Identity block (avatar + name + badge + chain/lock-count) shared by token & pool rows. */
function LedgerIdentity({
  avatar,
  name,
  badge,
  chainName,
  lockCount,
}: {
  avatar: React.ReactNode
  name: string
  badge: React.ReactNode
  chainName: string
  lockCount: number
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      {avatar}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 600,
              color: terminalColors.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </span>
          {badge}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3 }}>{chainName}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
            {lockCount} lock{lockCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  )
}

function TokenRow({ t, to }: { t: TokenAgg; to?: string }): JSX.Element {
  const isMobile = useIsMobileViewport()
  const initials = (t.symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'

  if (isMobile) {
    return (
      <LedgerRow to={to} mobile>
        <LedgerIdentity
          avatar={<Avatar seed={t.token} initials={initials} logoUrl={resolveLedgerLogo(t.chainId, t.token)} />}
          name={t.symbol || 'Unknown'}
          badge={<Badge>TOKEN</Badge>}
          chainName={t.chainName}
          lockCount={t.lockCount}
        />
        <div style={mobileStatGridStyle}>
          <MobileStat label="TVL" value={fmtUsd(t.tvlUsd)} valueColor={t.tvlUsd !== undefined ? terminalColors.ink : terminalColors.faint} />
          <MobileStat
            label="Locked supply"
            value={t.lockedPctOfSupply !== null ? fmtPct(t.lockedPctOfSupply) : '—'}
            valueColor={terminalColors.ink2}
          />
        </div>
      </LedgerRow>
    )
  }

  return (
    <LedgerRow to={to}>
      <Avatar seed={t.token} initials={initials} logoUrl={resolveLedgerLogo(t.chainId, t.token)} />
      <div style={{ minWidth: 0, flex: '1 1 160px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 600,
              color: terminalColors.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t.symbol || 'Unknown'}
          </span>
          <Badge>TOKEN</Badge>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3 }}>{t.chainName}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
            {t.lockCount} lock{t.lockCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <div style={{ flex: '0 1 150px', display: 'flex', justifyContent: 'flex-end' }}>
        {t.lockedPctOfSupply !== null ? <PctBar pct={t.lockedPctOfSupply} /> : (
          <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>—</span>
        )}
      </div>
      <div style={{ flex: '0 0 96px', textAlign: 'right' }}>
        <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: terminalColors.ink, letterSpacing: '-0.02em' }}>
          {fmtUsd(t.tvlUsd)}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 2 }}>TVL</div>
      </div>
    </LedgerRow>
  )
}

function PoolRow({ p, to }: { p: PoolAgg; to?: string }): JSX.Element {
  const isMobile = useIsMobileViewport()
  const a = (p.token0Symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?'
  const b = (p.token1Symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?'
  const pair = `${p.token0Symbol || '?'}/${p.token1Symbol || '?'}`

  if (isMobile) {
    return (
      <LedgerRow to={to} mobile>
        <LedgerIdentity
          avatar={<Avatar seed={p.pair} initials={`${a}${b}`} />}
          name={pair}
          badge={<Badge tone="green">LP</Badge>}
          chainName={p.chainName}
          lockCount={p.lockCount}
        />
        <div style={mobileStatGridStyle}>
          <MobileStat label="TVL" value={fmtUsd(p.tvlUsd)} valueColor={p.tvlUsd !== undefined ? terminalColors.ink : terminalColors.faint} />
          <MobileStat label="Locked" value={`${p.totalLockedAmount.formatted} LP`} valueColor={terminalColors.ink2} />
        </div>
      </LedgerRow>
    )
  }

  return (
    <LedgerRow to={to}>
      <Avatar seed={p.pair} initials={`${a}${b}`} />
      <div style={{ minWidth: 0, flex: '1 1 160px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 600,
              color: terminalColors.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {pair}
          </span>
          <Badge tone="green">LP</Badge>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3 }}>{p.chainName}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
            {p.lockCount} lock{p.lockCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <div style={{ flex: '0 1 150px', display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontFamily: MONO, fontSize: 12, color: terminalColors.ink2 }}>
          {p.totalLockedAmount.formatted} LP
        </span>
      </div>
      <div style={{ flex: '0 0 96px', textAlign: 'right' }}>
        <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: terminalColors.ink, letterSpacing: '-0.02em' }}>
          {fmtUsd(p.tvlUsd)}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 2 }}>TVL</div>
      </div>
    </LedgerRow>
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
      <span>Locker analytics service is unreachable — showing no fabricated data.</span>
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

export function LockerExplore(): JSX.Element {
  const statsHook = useLockerStats()
  const tvlHook = useLockerTvlHistory()
  const tokensHook = useLockerTokens()
  const poolsHook = useLockerPools()
  const locksHook = useLockerLocks()

  const [view, setView] = useState<'tokens' | 'pools'>('tokens')
  const isMobile = useIsMobileViewport()

  const stats = statsHook.stats

  // Priced-vs-unpriced coverage donut — both counts are always present in /stats.
  const coverageDonut = useMemo<DonutSlice[] | undefined>(() => {
    if (!stats) {
      return undefined
    }
    return [
      { label: 'Priced', value: stats.pricedLocks, color: terminalColors.brandGreen },
      { label: 'Unpriced', value: stats.unpricedLocks, color: terminalColors.faint },
    ]
  }, [stats])

  // Per-chain TVL stacked area from /tvl-history snapshots (USD when priced, else the
  // always-real per-chain lock count — never a fabricated $0).
  const perChainStack = useMemo(
    () =>
      buildPerChainStack(tvlHook.points, (pc) => pc.totalLocks, {
        usd: 'Per-chain TVL (USD)',
        count: 'Per-chain locks',
      }),
    [tvlHook.points],
  )

  // Resolve a representative lock id per (chain, token) so aggregate rows can link to the
  // per-lock proof-of-lock page (`/lock/:chainId/:id`). Locks arrive TVL-sorted, so the
  // first seen for a key is the most significant lock (exact for single-lock rows like
  // "HOOK · 1 lock"). A pool aggregate's `pair` == its LP token address == the lock's
  // `token`, so the same map serves tokens and pools. No match → no link (never fabricated).
  const lockRefByToken = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>()
    const locks: Lock[] | undefined = locksHook.locks
    if (!locks) {
      return m
    }
    for (const l of locks) {
      const key = `${l.chainId}-${l.token.toLowerCase()}`
      if (!m.has(key)) {
        m.set(key, `/lock/${l.chainId}/${l.token}`)
      }
    }
    return m
  }, [locksHook.locks])

  // Only snapshots that carry a real USD value can be charted — the rest are unpriced
  // (honest gap, never a fabricated point). With < 2 the chart shows its empty state.
  const chartPoints = useMemo<TvlPoint[]>(() => {
    if (!tvlHook.points) {
      return []
    }
    return tvlHook.points
      .filter((p): p is TVLSnapshot & { totalTvlUsd: number } => typeof p.totalTvlUsd === 'number' && Number.isFinite(p.totalTvlUsd))
      .map((p) => ({ label: p.dateISO, value: p.totalTvlUsd }))
  }, [tvlHook.points])

  // Activity fallback — lock COUNT per snapshot (always present, even unpriced). The
  // chart plots this when there aren't ≥ 2 priced USD points, so there's always a real
  // line instead of an empty box. Never a fabricated USD value.
  const countPoints = useMemo<TvlPoint[]>(() => {
    if (!tvlHook.points) {
      return []
    }
    return tvlHook.points
      .filter((p) => Number.isFinite(p.totalLocks))
      .map((p) => ({ label: p.dateISO, value: p.totalLocks }))
  }, [tvlHook.points])

  const tokens = useMemo(
    () => (tokensHook.tokens ? [...tokensHook.tokens].sort(byTvl((t) => t.tvlUsd, (t) => t.lockCount)) : undefined),
    [tokensHook.tokens],
  )
  const pools = useMemo(
    () => (poolsHook.pools ? [...poolsHook.pools].sort(byTvl((p) => p.tvlUsd, (p) => p.lockCount)) : undefined),
    [poolsHook.pools],
  )

  // Fully offline only when the stats call itself failed (the spine of the section).
  const offline = statsHook.error

  const tvlDisplay = stats?.totalTvlUsd
  const heroNumber = statsHook.isLoading ? undefined : fmtUsd(tvlDisplay)

  const priceCoverage =
    stats !== undefined ? `${fmtInt(stats.pricedLocks)} priced · ${fmtInt(stats.unpricedLocks)} unpriced` : undefined

  return (
    <div style={{ marginBottom: 24 }}>
      {offline ? <OfflineNote onRetry={statsHook.refetch} /> : null}

      {/* Hero — total value locked + glowing area chart */}
      <InstrumentPanel
        title="TOTAL VALUE LOCKED"
        corners
        meta={priceCoverage ? [priceCoverage] : undefined}
        style={{ marginBottom: 14 }}
      >
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
            across {fmtInt(stats?.reachableChains)}/{fmtInt(stats?.chains)} chains
          </span>
        </div>
        {tvlDisplay === undefined && !statsHook.isLoading ? (
          <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3, marginBottom: 6, maxWidth: 560, lineHeight: 1.5 }}>
            A USD total shows only where a stablecoin price anchor exists on the chain. Locks on chains without a priced
            anchor are tracked in native amounts — see the Ledger below.
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          {tvlHook.isLoading ? (
            <div style={{ height: 240, borderRadius: 10, background: terminalColors.panel }} aria-busy="true" />
          ) : (
            <LedgerTvlChart
              points={chartPoints}
              countPoints={countPoints}
              countLabel="Locks over time"
              emptyText="TVL history builds as daily snapshots accrue."
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
        {stats && stats.totalTvlUsd === undefined ? (
          // No USD anchor on the reachable chains → show the real lock COUNT in native
          // terms rather than a fabricated $ or a dead "No data yet" tile.
          <NativeLockedCard lockCount={stats.totalLocks} />
        ) : (
          <StatCard
            size="lg"
            label="Total Locked (USD)"
            value={stats ? fmtUsd(stats.totalTvlUsd) : undefined}
            loading={statsHook.isLoading}
          />
        )}
        <StatCard size="lg" label="Locks Created" value={stats ? fmtInt(stats.totalLocks) : undefined} loading={statsHook.isLoading} />
        <StatCard
          size="lg"
          label="New Locks · 24h"
          value={stats ? fmtInt(stats.newLocks24h) : undefined}
          valueColor={stats && stats.newLocks24h > 0 ? 'up' : 'ink'}
          loading={statsHook.isLoading}
        />
        <StatCard
          size="lg"
          label="Chains Reachable"
          value={stats ? `${fmtInt(stats.reachableChains)}/${fmtInt(stats.chains)}` : undefined}
          loading={statsHook.isLoading}
        />
      </div>

      {/* Composition — per-chain TVL + price coverage */}
      <InstrumentPanel title="COMPOSITION" style={{ marginBottom: 14 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.5fr) minmax(240px, 1fr)',
            gap: isMobile ? 20 : 26,
            alignItems: 'start',
          }}
        >
          <div>
            <div style={subheadStyle}>TVL by chain</div>
            {tvlHook.isLoading ? (
              <div style={{ height: 200, borderRadius: 10, background: terminalColors.panel }} aria-busy="true" />
            ) : (
              <LedgerTvlChart
                points={[]}
                stack={perChainStack}
                height={200}
                emptyText="Per-chain history builds as daily snapshots accrue."
              />
            )}
          </div>
          <div>
            <div style={subheadStyle}>Price coverage</div>
            <LedgerDonut
              slices={coverageDonut}
              loading={statsHook.isLoading}
              centerValue={stats ? fmtInt(stats.totalLocks) : undefined}
              centerLabel="Locks"
              emptyText="No locks to price yet."
            />
          </div>
        </div>
      </InstrumentPanel>

      {/* Unlock schedule — when locks come due (real per-lock unlockTime from /locks) */}
      <InstrumentPanel
        title="UNLOCK SCHEDULE"
        meta={[
          <span key="up" style={{ fontFamily: MONO }}>
            next {12} months
          </span>,
        ]}
        style={{ marginBottom: 14 }}
      >
        {locksHook.error ? (
          <EmptyState text="Couldn’t load the unlock schedule from the analytics service." />
        ) : (
          <UnlockScheduleChart locks={locksHook.locks} isLoading={locksHook.isLoading} />
        )}
      </InstrumentPanel>

      {/* Ledger — tokens / pools explore */}
      <InstrumentPanel
        title="LEDGER"
        meta={[
          <span key="cnt" style={{ fontFamily: MONO }}>
            {view === 'tokens' ? `${fmtInt(tokensHook.total)} tokens` : `${fmtInt(poolsHook.total)} pools`}
          </span>,
        ]}
      >
        {/* Tokens / Pools toggle */}
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
          {(['tokens', 'pools'] as const).map((id) => {
            const active = view === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
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
                {id === 'tokens' ? 'Tokens' : 'Pools'}
              </button>
            )
          })}
        </div>

        {view === 'tokens' ? (
          tokensHook.error ? (
            <EmptyState text="Couldn’t load token locks from the analytics service." />
          ) : tokens === undefined ? (
            <RowSkeletons />
          ) : tokens.length === 0 ? (
            <EmptyState text="No token locks yet. Locked tokens appear here as they’re created on-chain." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tokens.map((t) => (
                <TokenRow key={`${t.chainId}-${t.token}`} t={t} to={lockRefByToken.get(`${t.chainId}-${t.token.toLowerCase()}`)} />
              ))}
            </div>
          )
        ) : poolsHook.error ? (
          <EmptyState text="Couldn’t load LP locks from the analytics service." />
        ) : pools === undefined ? (
          <RowSkeletons />
        ) : pools.length === 0 ? (
          <EmptyState text="No LP / pool locks yet. Locked liquidity pairs appear here as they’re created on-chain." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pools.map((p) => (
              <PoolRow key={`${p.chainId}-${p.pair}`} p={p} to={lockRefByToken.get(`${p.chainId}-${p.pair.toLowerCase()}`)} />
            ))}
          </div>
        )}
      </InstrumentPanel>
    </div>
  )
}

/** TVL-desc comparator (undefined USD sinks below priced), tie-break by a count getter desc. */
function byTvl<T>(usd: (x: T) => number | undefined, count: (x: T) => number): (a: T, b: T) => number {
  return (a, b) => {
    const ua = usd(a)
    const ub = usd(b)
    if (ua !== undefined && ub !== undefined && ua !== ub) {
      return ub - ua
    }
    if (ua !== undefined && ub === undefined) {
      return -1
    }
    if (ua === undefined && ub !== undefined) {
      return 1
    }
    return count(b) - count(a)
  }
}
