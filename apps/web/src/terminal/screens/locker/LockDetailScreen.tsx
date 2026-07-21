/**
 * HookSwap Locker — public, no-wallet "proof-of-lock" detail page.
 *
 * The shareable community URL (`/lock/:chainId/:id`) anyone can open to VERIFY a lock —
 * the "share your lock" mechanic (à la UNCX's pool page). Bound to ONE live indexer
 * endpoint (`GET /lock/:chainId/:id` via `useLock`); works with NO connected wallet.
 *
 * DATA POLICY (facts-only, no fabricated data): every value is the indexer's. `valueUsd`
 * is OMITTED by the indexer when unpriceable → rendered as an honest "—", never $0.
 * Loading → skeleton; 404 → honest "this lock doesn't exist"; indexer offline → honest
 * offline note. Nothing here invents a lock, price, amount, or date.
 *
 * NOTE ON OG UNFURL: the `<Helmet>` tags below are set CLIENT-SIDE, so JS-less crawlers
 * (which read the VPS's static index.html) won't see per-lock meta — per-lock OG needs
 * SSR/edge rendering (known follow-up). The page + copy-link work regardless.
 */
import { useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async/lib/index'
import { Link, useParams } from 'react-router'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { resolveLedgerLogo } from '~/terminal/components/LedgerAvatar'
import type { Lock } from '~/terminal/lockers/analytics/client'
import { useLock } from '~/terminal/lockers/analytics/useLock'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { ExplorerDataType, getExplorerLink } from 'uniswap/src/utils/linking'
import type { UniverseChainId } from 'uniswap/src/features/chains/types'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans
const DISPLAY = terminalFonts.display

/* ------------------------------------------------------------------ formatting */

/** Compact USD, e.g. 2_410_000 → "$2.41M"; undefined → "—" (never $0 for unpriced). */
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

/** Group a `formatted` amount string (e.g. "250000" → "250,000"); passes decimals through. */
function fmtAmount(formatted: string): string {
  if (!formatted) {
    return '—'
  }
  const [whole, frac] = formatted.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${grouped}.${frac}` : grouped
}

/** Short address, e.g. 0xDD68…2996. */
function shortAddr(a: string): string {
  if (!a || a.length < 10) {
    return a || '—'
  }
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** Human date from a UNIX-seconds timestamp, e.g. "Aug 20, 2026". */
function fmtDate(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return '—'
  }
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Full date-time for a title / og description, e.g. "Aug 20 2026". */
function fmtDateShort(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return 'an unknown date'
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
        fontSize: size * 0.36,
        fontWeight: 600,
        letterSpacing: '-0.02em',
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

function StatusPill({ status }: { status: Lock['status'] }): JSX.Element {
  const locked = status === 'locked'
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
      {locked ? '🔒 Locked' : '🔓 Unlockable'}
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
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', color: terminalColors.greenDeep }}
        >
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

function ExploreFooter(): JSX.Element {
  return (
    <div style={{ marginTop: 22, fontFamily: SANS, fontSize: 12, color: terminalColors.faint }}>
      <span style={{ fontFamily: MONO, letterSpacing: '0.04em' }}>🔒 Locked on HookSwap</span>
      <span style={{ margin: '0 8px', opacity: 0.5 }}>·</span>
      <Link to="/locker" style={{ color: terminalColors.greenDeep, textDecoration: 'none', fontWeight: 600 }}>
        Explore all locks →
      </Link>
    </div>
  )
}

/* ------------------------------------------------------------------ the page */

export function LockDetailScreen(): JSX.Element {
  const params = useParams<{ chainId: string; id: string }>()
  const chainId = Number(params.chainId)
  const id = Number(params.id)

  const { lock, isLoading, notFound, error, refetch } = useLock(chainId, id)

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
    if (!lock) {
      return { title: 'Proof of Lock · HookSwap', desc: 'Verify a token or LP lock on HookSwap.' }
    }
    const amount = `${fmtAmount(lock.amount.formatted)} ${lock.symbol}`
    const title = `${amount} locked on HookSwap`
    const desc = `${amount} ${lock.isLpToken ? 'LP ' : ''}locked on ${lock.chainName} until ${fmtDateShort(lock.unlockTime)}. Verify on HookSwap.`
    return { title, desc }
  }, [lock])

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
          <LockSkeleton />
        ) : notFound ? (
          <StateBox
            title="This lock doesn’t exist"
            body="No lock was found for this chain and id. It may have never been created, or the link is mistyped."
          />
        ) : error || !lock ? (
          <StateBox
            title="Can’t reach the locker service"
            body="The locker indexer is unreachable right now — we won’t show any fabricated data. Try again in a moment."
            retry={refetch}
          />
        ) : (
          <LockCard lock={lock} onCopy={onCopy} copied={copied} />
        )}
      </CenterCard>
    </div>
  )
}

/* ------------------------------------------------------------------ the card */

function LockCard({ lock, onCopy, copied }: { lock: Lock; onCopy: () => void; copied: boolean }): JSX.Element {
  const initials = (lock.symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?'
  const lockerUrl = explorerAddr(lock.chainId, lock.lockerContract)
  const tokenUrl = explorerAddr(lock.chainId, lock.token)
  const ownerUrl = explorerAddr(lock.chainId, lock.owner)

  return (
    <InstrumentPanel corners style={{ padding: 0 }}>
      <div style={{ padding: '26px 26px 22px' }}>
        {/* header: avatar + symbol + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <Avatar seed={lock.token} initials={initials} logoUrl={resolveLedgerLogo(lock.chainId, lock.token)} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink }}>
                {lock.symbol || 'Unknown'}
              </span>
              <StatusPill status={lock.status} />
            </div>
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3, marginTop: 3 }}>
              {lock.isLpToken ? 'LP lock' : 'Token lock'} · {lock.chainName} · Lock #{lock.id}
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
          <Stat label="Amount locked" value={`${fmtAmount(lock.amount.formatted)} ${lock.symbol}`} />
          <Stat label="Value" value={fmtUsd(lock.valueUsd)} />
          <Stat label="% of supply" value={fmtPct(lock.lockedPctOfSupply)} />
          <Stat label="Owner" value={shortAddr(lock.owner)} href={ownerUrl} />
          <Stat
            label={lock.status === 'unlockable' ? 'Unlocked' : 'Unlocks'}
            value={fmtDate(lock.unlockTime)}
            mono={false}
            color={lock.status === 'unlockable' ? terminalColors.warn : terminalColors.ink}
          />
          <Stat label="Locked on" value={fmtDate(lock.createdAt)} mono={false} />
        </div>

        {/* LP legs */}
        {lock.isLpToken && lock.lp ? (
          <div style={{ marginTop: 18 }}>
            <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase', color: terminalColors.ink3 }}>
              Pooled liquidity
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
              {[lock.lp.token0, lock.lp.token1].map((leg, i) => (
                <div
                  key={i}
                  style={{
                    border: `1px solid ${terminalColors.line}`,
                    borderRadius: 12,
                    padding: '11px 13px',
                    background: terminalColors.panel,
                  }}
                >
                  <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: terminalColors.ink }}>{leg.symbol || 'Unknown'}</div>
                  <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink, marginTop: 3 }}>
                    {fmtAmount(leg.balance.formatted)}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint, marginTop: 2 }}>{fmtUsd(leg.valueUsd)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

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
          {lockerUrl ? (
            <a
              href={lockerUrl}
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
              View lock contract ↗
            </a>
          ) : null}
        </div>

        {/* contract references */}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ContractRow label="Locker" value={shortAddr(lock.lockerContract)} href={lockerUrl} />
          <ContractRow label="Token" value={`${shortAddr(lock.token)}`} href={tokenUrl} />
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

function LockSkeleton(): JSX.Element {
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
