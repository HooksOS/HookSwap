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
 * VISUAL LANGUAGE: HookSwap "B · Ledger" daylight token-page look — cool-paper page,
 * white rounded cards with hairline borders, IBM Plex Mono for every number/ticker/
 * address, deep acid-green accent. It is a SHARE CARD, not a trading terminal: there is
 * deliberately NO live price chart and NO buy/sell widget — there is no live trade feed
 * for a launch share page and fabricating one would violate the facts-only rule.
 *
 * DATA POLICY (facts-only, no fabricated data): every value is the indexer's.
 * `marketCapUsd` is OMITTED by the indexer when unpriceable → rendered as an honest "—",
 * never $0. Loading → skeleton; 404 → honest "this launch doesn't exist"; indexer offline
 * → honest offline note. Nothing here invents a launch, token, price, supply, or date.
 * The LP-lock badge reads the FeeVault CONTRACT (source of truth), not the indexer field.
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
import { resolveLedgerLogo } from '~/terminal/components/LedgerAvatar'
import type { Address } from '~/chains'
import type { Launch } from '~/terminal/launchpad/analytics/client'
import { useLaunch } from '~/terminal/launchpad/analytics/useLaunch'
import { useLpLock } from '~/terminal/launchpad/useLpLock'
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

function Avatar({
  seed,
  initials,
  size = 46,
  logoUrl,
}: {
  seed: string
  initials: string
  size?: number
  logoUrl?: string
}): JSX.Element {
  const [imgFailed, setImgFailed] = useState(false)
  const showImg = Boolean(logoUrl) && !imgFailed
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
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
        fontSize: size * 0.34,
        fontWeight: 600,
        letterSpacing: '-0.02em',
        boxShadow: `0 0 0 1px ${terminalColors.line}`,
      }}
    >
      {initials}
      {showImg ? (
        <img
          src={logoUrl}
          alt=""
          onError={() => setImgFailed(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '50%',
            background: '#fff',
          }}
        />
      ) : null}
    </div>
  )
}

/** Neutral identity pill (chain / DEX / fee tier / launch #). Sans by default, mono for values. */
function Pill({ children, mono = false }: { children: React.ReactNode; mono?: boolean }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: mono ? MONO : SANS,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: mono ? '-0.01em' : '0.01em',
        color: terminalColors.ink2,
        background: terminalColors.panel2,
        border: `1px solid ${terminalColors.line2}`,
        padding: '3px 10px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

/**
 * LP-lock badge — reads the FeeVault contract as the source of truth via the shared
 * `useLpLock` hook (`isPermanentlyLocked` + the `positions.locker` external-locker seam).
 * NEVER asserts "Locked" when the chain says unlocked (today's Robinhood launches are
 * genuinely unlocked on-chain → this renders "LP Unlocked" for them). Only 'unknown'
 * (no deployed FeeVault / read error) falls back to the indexer's `lpLocked` boolean —
 * never over-asserting Locked.
 */
/** Parse the indexer's decimal tokenId string into a bigint; undefined when not a number. */
function parseTokenId(raw: string | undefined): bigint | undefined {
  if (!raw || !/^\d+$/.test(raw)) {
    return undefined
  }
  try {
    return BigInt(raw)
  } catch {
    return undefined
  }
}

function LpLockBadge({
  chainId,
  token,
  tokenId,
  dex,
  fallbackLocked,
}: {
  chainId: number
  token: Address
  tokenId?: bigint
  dex?: number
  fallbackLocked?: boolean
}): JSX.Element | null {
  const { status, unlockTime } = useLpLock({ chainId, token, tokenId, dex })

  if (status === 'loading') {
    return <LpBadgeChip tone="neutral">LP …</LpBadgeChip>
  }

  // Map the on-chain status to a truthful display; 'unknown' falls back to the indexer flag.
  let locked: boolean
  let effectiveUnlock = 0
  if (status === 'locked-forever') {
    locked = true
  } else if (status === 'locked-until') {
    locked = true
    effectiveUnlock = unlockTime ?? 0
  } else if (status === 'unlocked') {
    locked = false
  } else if (fallbackLocked === true) {
    locked = true
  } else if (fallbackLocked === false) {
    locked = false
  } else {
    return null
  }

  if (locked) {
    const label = effectiveUnlock > 0 ? `🔒 Locked · ${fmtDate(effectiveUnlock)}` : '🔒 Locked Forever'
    return <LpBadgeChip tone="green">{label}</LpBadgeChip>
  }
  return <LpBadgeChip tone="warn">LP Unlocked</LpBadgeChip>
}

/** The visual chip used by `LpLockBadge` (green = locked, gold = unlocked, neutral = pending). */
function LpBadgeChip({ tone, children }: { tone: 'green' | 'warn' | 'neutral'; children: React.ReactNode }): JSX.Element {
  const palette =
    tone === 'green'
      ? { color: terminalColors.greenDeep, background: terminalColors.greenBg, border: terminalColors.greenBorder }
      : tone === 'warn'
        ? { color: terminalColors.warn, background: terminalColors.warnBg, border: '#EAD9A8' }
        : { color: terminalColors.ink3, background: terminalColors.panel, border: terminalColors.line }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: MONO,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.01em',
        padding: '4px 11px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        color: palette.color,
        background: palette.background,
        border: `1px solid ${palette.border}`,
      }}
    >
      {children}
    </span>
  )
}

/** One elevated KPI card — white surface, hairline border, uppercase label + value. */
function KpiCard({
  label,
  value,
  href,
  mono = true,
}: {
  label: string
  value: string
  href?: string
  mono?: boolean
}): JSX.Element {
  const valueStyle: React.CSSProperties = {
    fontFamily: mono ? MONO : SANS,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: mono ? '-0.02em' : '0',
    color: href ? terminalColors.greenDeep : terminalColors.ink,
    textDecoration: 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'block',
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        minWidth: 0,
        background: terminalColors.bg,
        border: `1px solid ${terminalColors.line}`,
        borderRadius: 12,
        padding: '13px 15px',
      }}
    >
      <span
        style={{
          fontFamily: SANS,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: terminalColors.ink3,
        }}
      >
        {label}
      </span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={valueStyle} title={value}>
          {value}
        </a>
      ) : (
        <span style={valueStyle} title={value}>
          {value}
        </span>
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
  return <div style={{ width: '100%', maxWidth: 640 }}>{children}</div>
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
      <div style={{ padding: '48px 28px', textAlign: 'center' }}>
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
        {/* ---------- identity hero ---------- */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <Avatar
            seed={launch.token.addr}
            initials={initials}
            size={60}
            logoUrl={resolveLedgerLogo(launch.chainId, launch.token.addr)}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink, lineHeight: 1.05 }}>
                {launch.token.symbol || 'Unknown'}
              </span>
              <LpLockBadge
                chainId={launch.chainId}
                token={launch.token.addr as Address}
                tokenId={parseTokenId(launch.tokenId)}
                dex={launch.dex}
                fallbackLocked={launch.lpLocked}
              />
            </div>
            <div
              style={{
                fontFamily: SANS,
                fontSize: 13.5,
                color: terminalColors.ink2,
                marginTop: 4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {launch.token.name || 'Fair launch'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
              <Pill>{launch.chainName}</Pill>
              <Pill>{dexLabel}</Pill>
              <Pill mono>{fmtFeeTier(launch.feeTier)}</Pill>
              <Pill mono>#{launch.id}</Pill>
            </div>
          </div>
        </div>

        {/* ---------- market-cap hero figure ---------- */}
        <div
          style={{
            marginTop: 20,
            padding: '16px 18px',
            background: terminalColors.panel,
            border: `1px solid ${terminalColors.line2}`,
            borderRadius: 14,
          }}
        >
          <div
            style={{
              fontFamily: SANS,
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: terminalColors.ink3,
            }}
          >
            Market cap
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: '-0.03em',
              color: terminalColors.ink,
              lineHeight: 1.1,
              marginTop: 4,
            }}
          >
            {fmtUsd(launch.marketCapUsd)}
          </div>
        </div>

        {/* ---------- KPI cards ---------- */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 12,
            marginTop: 16,
          }}
        >
          <KpiCard label="Total supply" value={`${fmtAmount(launch.token.totalSupply.formatted)} ${launch.token.symbol}`} />
          <KpiCard label="DEX" value={dexLabel} mono={false} />
          <KpiCard label="Fee tier" value={fmtFeeTier(launch.feeTier)} />
          <KpiCard label="Creator" value={shortAddr(launch.creator)} href={creatorUrl} />
          <KpiCard label="Launched on" value={fmtDate(launch.createdAt)} mono={false} />
          <KpiCard label="Market cap" value={fmtUsd(launch.marketCapUsd)} />
        </div>

        {/* ---------- contract references ---------- */}
        <div
          style={{
            marginTop: 16,
            background: terminalColors.bg,
            border: `1px solid ${terminalColors.line}`,
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <ContractRow label="Token" value={shortAddr(launch.token.addr)} href={tokenUrl} />
          <div style={{ height: 1, background: terminalColors.line2 }} />
          <ContractRow label="Pool" value={shortAddr(launch.pool)} href={poolUrl} />
        </div>

        {/* ---------- actions ---------- */}
        {/* Primary CTA funnels the visitor into the in-app token page (live chart + Buy/Sell
            deep-links into Swap), not the raw explorer — a share card should let people trade. */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <Link
            to={`/token/${launch.chainId}/${launch.token.addr}`}
            style={{
              flex: '2 1 200px',
              textAlign: 'center',
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 700,
              color: terminalColors.btnInk,
              background: terminalColors.brandGreen,
              border: 'none',
              borderRadius: 10,
              padding: '12px 16px',
              textDecoration: 'none',
            }}
          >
            {`Trade ${launch.token.symbol || 'token'} →`}
          </Link>
          <button
            type="button"
            onClick={onCopy}
            style={{
              flex: '1 1 140px',
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 600,
              color: terminalColors.ink2,
              background: terminalColors.bg,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 10,
              padding: '12px 16px',
              cursor: 'pointer',
            }}
          >
            {copied ? '✓ Link copied' : 'Copy share link'}
          </button>
        </div>
        {tokenUrl ? (
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <a
              href={tokenUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: terminalColors.ink3, textDecoration: 'none' }}
            >
              View token on explorer ↗
            </a>
          </div>
        ) : null}

        <div style={{ textAlign: 'center' }}>
          <ExploreFooter />
        </div>
      </div>
    </InstrumentPanel>
  )
}

function ContractRow({ label, value, href }: { label: string; value: string; href?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 15px' }}>
      <span
        style={{
          fontFamily: SANS,
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          color: terminalColors.ink3,
        }}
      >
        {label}
      </span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: terminalColors.greenDeep, textDecoration: 'none' }}>
          {value} ↗
        </a>
      ) : (
        <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: terminalColors.ink2 }}>{value}</span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ skeleton */

function LaunchSkeleton(): JSX.Element {
  const bar = (w: number | string, h: number, r = 6): JSX.Element => (
    <div style={{ width: w, height: h, borderRadius: r, background: terminalColors.line2 }} />
  )
  return (
    <InstrumentPanel corners style={{ padding: 0 }}>
      <div style={{ padding: '26px 26px 22px' }} aria-busy="true">
        {/* identity */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: terminalColors.line2, flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
            {bar(130, 24)}
            {bar(180, 13)}
            <div style={{ display: 'flex', gap: 7, marginTop: 2 }}>
              {bar(70, 20, 999)}
              {bar(80, 20, 999)}
              {bar(54, 20, 999)}
            </div>
          </div>
        </div>
        {/* hero market cap */}
        <div style={{ marginTop: 20, padding: '16px 18px', background: terminalColors.panel, border: `1px solid ${terminalColors.line2}`, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
          {bar(72, 11)}
          {bar(160, 34)}
        </div>
        {/* kpi cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 16 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: terminalColors.bg, border: `1px solid ${terminalColors.line}`, borderRadius: 12, padding: '13px 15px' }}>
              {bar(60, 10)}
              {bar(92, 15)}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>{bar('100%', 46, 10)}</div>
      </div>
    </InstrumentPanel>
  )
}
