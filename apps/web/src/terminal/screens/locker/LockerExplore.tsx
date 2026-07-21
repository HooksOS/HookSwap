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
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { StatCard } from '~/terminal/components/StatCard'
import type { PoolAgg, TokenAgg, TVLSnapshot } from '~/terminal/lockers/analytics/client'
import { useLockerPools } from '~/terminal/lockers/analytics/useLockerPools'
import { useLockerStats } from '~/terminal/lockers/analytics/useLockerStats'
import { useLockerTokens } from '~/terminal/lockers/analytics/useLockerTokens'
import { useLockerTvlHistory } from '~/terminal/lockers/analytics/useLockerTvlHistory'
import { LockerTvlChart, type TvlPoint } from '~/terminal/screens/locker/LockerTvlChart'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans
const DISPLAY = terminalFonts.display

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

/** Deterministic legible avatar colour from an address (stable hue). */
function avatarColor(seed: string): string {
  let h = 0
  const s = seed.toLowerCase()
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 360
  }
  return `hsl(${h}, 52%, 42%)`
}

/* ------------------------------------------------------------------ small parts */

function Avatar({ seed, initials }: { seed: string; initials: string }): JSX.Element {
  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: avatarColor(seed),
        color: '#fff',
        fontFamily: MONO,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '-0.02em',
      }}
    >
      {initials}
    </div>
  )
}

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

function LedgerRow({ children }: { children: React.ReactNode }): JSX.Element {
  const [hover, setHover] = useState(false)
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
      {children}
    </div>
  )
}

function TokenRow({ t }: { t: TokenAgg }): JSX.Element {
  const initials = (t.symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
  return (
    <LedgerRow>
      <Avatar seed={t.token} initials={initials} />
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

function PoolRow({ p }: { p: PoolAgg }): JSX.Element {
  const a = (p.token0Symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?'
  const b = (p.token1Symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?'
  const pair = `${p.token0Symbol || '?'}/${p.token1Symbol || '?'}`
  return (
    <LedgerRow>
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

  const [view, setView] = useState<'tokens' | 'pools'>('tokens')

  const stats = statsHook.stats

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
            <LockerTvlChart points={chartPoints} />
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
        <StatCard
          size="lg"
          label="Total Locked (USD)"
          value={stats ? fmtUsd(stats.totalTvlUsd) : undefined}
          loading={statsHook.isLoading}
          comingSoon={Boolean(stats) && stats!.totalTvlUsd === undefined}
        />
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
                <TokenRow key={`${t.chainId}-${t.token}`} t={t} />
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
              <PoolRow key={`${p.chainId}-${p.pair}`} p={p} />
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
