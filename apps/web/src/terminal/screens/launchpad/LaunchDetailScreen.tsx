/**
 * HookSwap LaunchPad — public, no-wallet shareable launch page.
 *
 * The shareable community URL (`/launch/:chainId/:token`) anyone can open to VIEW a
 * fair-launch — the "share your launch" mechanic (mirrors the locker's proof-of-lock
 * page). Bound to ONE live indexer endpoint (`GET /launch/:chainId/:token` via
 * `useLaunch`); works with NO connected wallet. `:token` may be the launched token
 * ADDRESS (the canonical shareable URL) or the numeric launch id — the indexer accepts
 * both.
 *
 * DATA POLICY (facts-only, no fabricated data): every value is the indexer's.
 * `marketCapUsd` is OMITTED by the indexer when unpriceable → rendered as an honest "—",
 * never $0. Loading → skeleton; 404 → honest "this launch doesn't exist"; indexer offline
 * → honest offline note. Nothing here invents a launch, token, price, supply, or date.
 *
 * NOTE ON OG UNFURL: the `<Helmet>` tags below are set CLIENT-SIDE, so JS-less crawlers
 * (which read the VPS's static index.html) won't see per-launch meta — per-launch OG needs
 * SSR/edge rendering (known follow-up, same as the locker shareable page). The page +
 * copy-link work regardless.
 */
import { useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async/lib/index'
import { Link, useParams } from 'react-router'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import type { Launch } from '~/terminal/launchpad/analytics/client'
import { useLaunch } from '~/terminal/launchpad/analytics/useLaunch'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { ExplorerDataType, getExplorerLink } from 'uniswap/src/utils/linking'
import type { UniverseChainId } from 'uniswap/src/features/chains/types'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans
const DISPLAY = terminalFonts.display

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

/** Group a `formatted` amount string (e.g. "1000000000" → "1,000,000,000"); passes decimals through. */
function fmtAmount(formatted: string | undefined): string {
  if (!formatted) {
    return '—'
  }
  const [whole, frac] = formatted.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${grouped}.${frac}` : grouped
}

/** Uniswap fee tier in hundredths of a bip → percent label, e.g. 10000 → "1%". */
function fmtFeeTier(feeTier: number | undefined): string {
  if (feeTier === undefined || !Number.isFinite(feeTier)) {
    return '—'
  }
  return `${(feeTier / 10_000).toFixed(2).replace(/\.?0+$/, '')}%`
}

/** Short address, e.g. 0xDD68…2996. */
function shortAddr(a: string | undefined): string {
  if (!a || a.length < 10) {
    return a || '—'
  }
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** Human date from a UNIX-seconds timestamp, e.g. "Aug 20, 2026". */
function fmtDate(unixSeconds: number | undefined): string {
  if (unixSeconds === undefined || !Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return '—'
  }
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Deterministic legible avatar colour from an address (stable hue). */
function avatarColor(seed: string): string {
  let h = 0
  const s = (seed || '').toLowerCase()
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 360
  }
  return `hsl(${h}, 52%, 42%)`
}

/** Best-effort explorer link for an address on this chain; undefined if unsupported. */
function explorerAddr(chainId: number, address: string): string | undefined {
  try {
    return getExplorerLink({ chainId: chainId as UniverseChainId, data: address, type: ExplorerDataType.ADDRESS })
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------------ small parts */

function Avatar({ seed, initials, size = 46 }: { seed: string; initials: string; size?: number }): JSX.Element {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: avatarColor(seed),
        color: '#fff',
        fontFamily: MONO,
        fontSize: size * 0.36,
        fontWeight: 600,
        letterSpacing: '-0.02em',
      }}
    >
      {initials}
    </div>
  )
}

function LpPill({ locked }: { locked: boolean }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: MONO,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.02em',
        color: locked ? terminalColors.greenDeep : terminalColors.warn,
        background: locked ? terminalColors.greenBg : terminalColors.warnBg,
        border: `1px solid ${locked ? terminalColors.greenBorder : '#EAD9A8'}`,
        padding: '4px 11px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {locked ? '🔒 LP Locked' : 'LP Unlocked'}
    </span>
  )
}

/** One labelled figure in the stat row. */
function Stat({
  label,
  value,
  href,
  mono = true,
  color,
}: {
  label: string
  value: string
  href?: string
  mono?: boolean
  color?: string
}): JSX.Element {
  const valueNode = (
    <span
      style={{
        fontFamily: mono ? MONO : SANS,
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: mono ? '-0.02em' : '0',
        color: color ?? terminalColors.ink,
      }}
    >
      {value}
    </span>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span
        style={{
          fontFamily: SANS,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          color: terminalColors.ink3,
        }}
      >
        {label}
      </span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
          <span style={{ fontFamily: mono ? MONO : SANS, fontSize: 15, fontWeight: 600, letterSpacing: mono ? '-0.02em' : '0', color: terminalColors.greenDeep }}>
            {value}
          </span>
        </a>
      ) : (
        valueNode
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ page shell */

const PAGE_WRAP: React.CSSProperties = {
  minHeight: '70vh',
  background: terminalColors.bgApp,
  padding: '40px 20px 64px',
  display: 'flex',
  justifyContent: 'center',
}

function CenterCard({ children }: { children: React.ReactNode }): JSX.Element {
  return <div style={{ width: '100%', maxWidth: 620 }}>{children}</div>
}

function ExploreFooter(): JSX.Element {
  return (
    <div style={{ marginTop: 22, fontFamily: SANS, fontSize: 12, color: terminalColors.faint }}>
      <span style={{ fontFamily: MONO, letterSpacing: '0.04em' }}>🚀 Launched on HookSwap</span>
      <span style={{ margin: '0 8px', opacity: 0.5 }}>·</span>
      <Link to="/launch" style={{ color: terminalColors.greenDeep, textDecoration: 'none', fontWeight: 600 }}>
        Explore all launches →
      </Link>
    </div>
  )
}

function StateBox({ title, body, retry }: { title: string; body: string; retry?: () => void }): JSX.Element {
  return (
    <InstrumentPanel corners style={{ padding: 0 }}>
      <div style={{ padding: '40px 28px', textAlign: 'center' }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink, marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 13.5, color: terminalColors.ink3, lineHeight: 1.55, maxWidth: 420, margin: '0 auto' }}>
          {body}
        </div>
        {retry ? (
          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: 18,
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: terminalColors.ink2,
              background: terminalColors.bg,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 8,
              padding: '7px 16px',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        ) : null}
        <ExploreFooter />
      </div>
    </InstrumentPanel>
  )
}

/* ------------------------------------------------------------------ the page */

export function LaunchDetailScreen(): JSX.Element {
  const params = useParams<{ chainId: string; token: string }>()
  const chainId = Number(params.chainId)
  const token = params.token ?? ''

  const { launch, isLoading, notFound, error, refetch } = useLaunch(chainId, token)

  const [copied, setCopied] = useState(false)
  const onCopy = (): void => {
    const href = typeof window !== 'undefined' ? window.location.href : ''
    if (!href) {
      return
    }
    const done = (): void => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(href).then(done).catch(() => undefined)
    } else {
      done()
    }
  }

  // ----- meta (client-side; see file header on the SSR caveat) -----
  const meta = useMemo(() => {
    if (!launch) {
      return { title: 'Launch · HookSwap', desc: 'View a fair-launched token on HookSwap.' }
    }
    const sym = launch.token.symbol || 'A token'
    const title = `${sym} launched on HookSwap`
    const mcap = launch.marketCapUsd !== undefined ? ` · ${fmtUsd(launch.marketCapUsd)} market cap` : ''
    const desc = `${launch.token.name || sym} (${sym}) fair-launched on ${launch.chainName}${mcap}. View on HookSwap.`
    return { title, desc }
  }, [launch])

  return (
    <div style={PAGE_WRAP}>
      <Helmet>
        <title>{meta.title}</title>
        <meta name="description" content={meta.desc} />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.desc} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={meta.title} />
        <meta name="twitter:description" content={meta.desc} />
      </Helmet>

      <CenterCard>
        {isLoading ? (
          <LaunchSkeleton />
        ) : notFound ? (
          <StateBox
            title="This launch doesn’t exist"
            body="No launch was found for this chain and token. It may have never been created, or the link is mistyped."
          />
        ) : error || !launch ? (
          <StateBox
            title="Can’t reach the LaunchPad service"
            body="The LaunchPad indexer is unreachable right now — we won’t show any fabricated data. Try again in a moment."
            retry={refetch}
          />
        ) : (
          <LaunchCard launch={launch} onCopy={onCopy} copied={copied} />
        )}
      </CenterCard>
    </div>
  )
}

/* ------------------------------------------------------------------ the card */

function LaunchCard({ launch, onCopy, copied }: { launch: Launch; onCopy: () => void; copied: boolean }): JSX.Element {
  const initials = (launch.token.symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?'
  const tokenUrl = explorerAddr(launch.chainId, launch.token.addr)
  const poolUrl = explorerAddr(launch.chainId, launch.pool)
  const creatorUrl = explorerAddr(launch.chainId, launch.creator)
  const dexLabel = launch.dex === 1 ? 'HookSwap' : 'Uniswap V3'

  return (
    <InstrumentPanel corners style={{ padding: 0 }}>
      <div style={{ padding: '26px 26px 22px' }}>
        {/* header: avatar + symbol + LP status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <Avatar seed={launch.token.addr} initials={initials} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink }}>
                {launch.token.symbol || 'Unknown'}
              </span>
              <LpPill locked={Boolean(launch.lpLocked)} />
            </div>
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3, marginTop: 3 }}>
              {launch.token.name || 'Fair launch'} · {launch.chainName} · Launch #{launch.id}
            </div>
          </div>
        </div>

        {/* stat grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '18px 20px',
            padding: '18px 0',
            borderTop: `1px solid ${terminalColors.line2}`,
            borderBottom: `1px solid ${terminalColors.line2}`,
          }}
        >
          <Stat label="Market cap" value={fmtUsd(launch.marketCapUsd)} />
          <Stat label="Total supply" value={`${fmtAmount(launch.token.totalSupply.formatted)} ${launch.token.symbol}`} />
          <Stat label="DEX" value={dexLabel} mono={false} />
          <Stat label="Fee tier" value={fmtFeeTier(launch.feeTier)} />
          <Stat label="Creator" value={shortAddr(launch.creator)} href={creatorUrl} />
          <Stat label="Launched on" value={fmtDate(launch.createdAt)} mono={false} />
        </div>

        {/* actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onCopy}
            style={{
              flex: '1 1 160px',
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 600,
              color: terminalColors.btnInk,
              background: terminalColors.brandGreen,
              border: 'none',
              borderRadius: 10,
              padding: '11px 16px',
              cursor: 'pointer',
            }}
          >
            {copied ? '✓ Link copied' : 'Copy share link'}
          </button>
          {tokenUrl ? (
            <a
              href={tokenUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: '1 1 160px',
                textAlign: 'center',
                fontFamily: SANS,
                fontSize: 13,
                fontWeight: 600,
                color: terminalColors.ink2,
                background: terminalColors.bg,
                border: `1px solid ${terminalColors.line}`,
                borderRadius: 10,
                padding: '11px 16px',
                textDecoration: 'none',
              }}
            >
              View token ↗
            </a>
          ) : null}
        </div>

        {/* contract references */}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ContractRow label="Token" value={shortAddr(launch.token.addr)} href={tokenUrl} />
          <ContractRow label="Pool" value={shortAddr(launch.pool)} href={poolUrl} />
        </div>

        <div style={{ textAlign: 'center' }}>
          <ExploreFooter />
        </div>
      </div>
    </InstrumentPanel>
  )
}

function ContractRow({ label, value, href }: { label: string; value: string; href?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3 }}>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontFamily: MONO, fontSize: 12, color: terminalColors.greenDeep, textDecoration: 'none' }}>
          {value} ↗
        </a>
      ) : (
        <span style={{ fontFamily: MONO, fontSize: 12, color: terminalColors.ink2 }}>{value}</span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ skeleton */

function LaunchSkeleton(): JSX.Element {
  const bar = (w: number | string, h: number): JSX.Element => (
    <div style={{ width: w, height: h, borderRadius: 5, background: terminalColors.line2 }} />
  )
  return (
    <InstrumentPanel corners style={{ padding: 0 }}>
      <div style={{ padding: '26px 26px 22px' }} aria-busy="true">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: terminalColors.line2 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bar(120, 20)}
            {bar(180, 12)}
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '18px 20px',
            padding: '18px 0',
            borderTop: `1px solid ${terminalColors.line2}`,
            borderBottom: `1px solid ${terminalColors.line2}`,
          }}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {bar(64, 10)}
              {bar(96, 15)}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 20 }}>{bar('100%', 42)}</div>
      </div>
    </InstrumentPanel>
  )
}
