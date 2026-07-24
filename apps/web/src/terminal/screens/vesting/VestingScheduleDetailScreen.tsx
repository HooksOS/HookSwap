/**
 * HookSwap Terminal — public, shareable per-vesting-schedule detail page ("B · Ledger").
 *
 * The community URL anyone can open to view a single vesting schedule:
 * `/vesting/:chainId/:scheduleId` (the schedule id IS in the url, so a project can just
 * share the link). The last detail-page parity gap — the counterpart to the token
 * (`/token/...`), lock (`/lock/...`) and farm (`/farm/...`) pages — same Ledger layout,
 * `terminalColors`/`terminalFonts`, IBM Plex Mono numbers, dark-default + light, honest
 * empty / loading / "—" states.
 *
 * DATA POLICY (facts-only, NO mock/placeholder data — every value is a real source or an
 * honest "—" / loading / not-found state), split by source exactly like the Vesting page:
 *   • Core figures + the Release action (token, beneficiary, creator, total / released /
 *     claimable amounts, start / cliff / end, symbol / decimals) — LIVE on-chain via the
 *     `useSchedule` hook (real wagmi reads/writes). These render end to end with a working
 *     RPC and need no wallet (anonymous visitors see the full page).
 *   • USD value — from the priced vesting indexer (`useScheduleAnalytics` →
 *     `GET /vesting/:chainId/:id`). The indexer OMITS it when the chain has no USD anchor →
 *     rendered "—" with an honest note, never a fabricated $ value.
 *
 * The Release action is wallet-gated and honors the URL chain: connect → open drawer; wrong
 * network → one-click switch; `release()` is beneficiary-ONLY on the child and pays the live
 * `releasable()`. HookSwapVesting Phase 1 is NON-revocable (there is no revoke path on the
 * contract), so no Revoke action is shown — an honest note explains this instead. NOTE ON OG
 * UNFURL: `<Helmet>` tags are set CLIENT-SIDE (same SSR caveat as the token / lock / farm
 * pages). The page + copy-link work regardless.
 */
import { useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async/lib/index'
import { Link, useParams } from 'react-router'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel, isUniverseChainId } from 'uniswap/src/features/chains/utils'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useAccount } from '~/hooks/useAccount'
import { useSelectChain } from '~/hooks/useSelectChain'
import { ExplorerAddress } from '~/terminal/components/ExplorerAddress'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { LedgerAvatar, resolveLedgerLogo } from '~/terminal/components/LedgerAvatar'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { ConnectInline, fmtAmount, fmtDuration, Notice, PrimaryButton } from '~/terminal/screens/farms/parts'
import { VestingCurve } from '~/terminal/screens/vesting/VestingCurve'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { useScheduleAnalytics } from '~/terminal/vesting/analytics/useScheduleAnalytics'
import { useSchedule } from '~/terminal/vesting/useSchedule'
import type { VestingScheduleRow } from '~/terminal/vesting/useMySchedules'
import { assume0xAddress } from '~/utils/wagmi'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans
const DISPLAY = terminalFonts.display

type Lifecycle = 'cliff' | 'vesting' | 'complete'

/* ------------------------------------------------------------------ formatting */

/** Compact USD, e.g. 2_410_000 → "$2.41M"; undefined/≤0 → "—" (never $0 for missing). */
function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n <= 0) {
    return '—'
  }
  const abs = Math.abs(n)
  const compact = new Intl.NumberFormat('en-US', {
    notation: abs >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 2,
    minimumFractionDigits: abs >= 1000 ? 0 : 2,
  }).format(n)
  return `$${compact}`
}

/** Human date from a UNIX-seconds timestamp, e.g. "Aug 20, 2026". */
function fmtDate(unixSeconds: number | undefined): string {
  if (unixSeconds === undefined || !Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return '—'
  }
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function initials(symbol: string | undefined, len = 3): string {
  return (symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, len).toUpperCase() || '?'
}

/** Which phase of the cliff + linear curve the schedule is in (from real on-chain fields). */
function lifecycleOf(row: VestingScheduleRow): Lifecycle {
  const now = Math.floor(Date.now() / 1000)
  if (row.totalAmount > 0n && row.vested >= row.totalAmount) {
    return 'complete'
  }
  if (now < row.start + row.cliff) {
    return 'cliff'
  }
  return 'vesting'
}

/* ------------------------------------------------------------------ param parse */

interface ParsedSchedule {
  chainId: UniverseChainId
  scheduleId: bigint
  scheduleNum: number
}

/** Parse `/vesting/:chainId/:scheduleId`; rejects unregistered chains / non-integer ids. */
function parseParams(chainRaw: string | undefined, idRaw: string | undefined): ParsedSchedule | undefined {
  if (!chainRaw || idRaw === undefined || idRaw === '') {
    return undefined
  }
  const chainNum = Number(chainRaw)
  if (!Number.isInteger(chainNum) || chainNum <= 0 || !isUniverseChainId(chainNum)) {
    return undefined
  }
  if (!/^\d+$/.test(idRaw)) {
    return undefined
  }
  let scheduleId: bigint
  try {
    scheduleId = BigInt(idRaw)
  } catch {
    return undefined
  }
  return { chainId: chainNum, scheduleId, scheduleNum: Number(idRaw) }
}

/* ------------------------------------------------------------------ page shell */

const PAGE_WRAP: React.CSSProperties = {
  minHeight: '70vh',
  background: terminalColors.bgApp,
  padding: '28px var(--tm-gutter, 20px) 64px',
}

function ExploreFooter(): JSX.Element {
  return (
    <div style={{ marginTop: 22, fontFamily: SANS, fontSize: 12, color: terminalColors.faint }}>
      <span style={{ fontFamily: MONO, letterSpacing: '0.04em' }}>⏳ Vesting on HookSwap</span>
      <span style={{ margin: '0 8px', opacity: 0.5 }}>·</span>
      <Link to="/vesting" style={{ color: terminalColors.greenDeep, textDecoration: 'none', fontWeight: 600 }}>
        Explore all schedules →
      </Link>
    </div>
  )
}

function StateBox({ title, body, retry }: { title: string; body: string; retry?: () => void }): JSX.Element {
  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
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
          <div style={{ textAlign: 'center' }}>
            <ExploreFooter />
          </div>
        </div>
      </InstrumentPanel>
    </div>
  )
}

/* ------------------------------------------------------------------ small parts */

const STATUS_META: Record<Lifecycle, { label: string; color: string; bg: string; border: string }> = {
  cliff: { label: 'In cliff', color: terminalColors.warn, bg: terminalColors.warnBg, border: terminalColors.warn },
  vesting: { label: 'Vesting', color: terminalColors.greenDeep, bg: terminalColors.greenBg, border: terminalColors.greenBorder },
  complete: { label: 'Fully vested', color: terminalColors.ink3, bg: terminalColors.panel2, border: terminalColors.line },
}

function StatusPill({ status }: { status: Lifecycle }): JSX.Element {
  const m = STATUS_META[status]
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        color: m.color,
        background: m.bg,
        border: `1px solid ${m.border}`,
        padding: '3px 10px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {m.label}
    </span>
  )
}

function RoleBadge({ isBeneficiary }: { isBeneficiary: boolean }): JSX.Element {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        color: isBeneficiary ? terminalColors.greenDeep : terminalColors.accentIndigo,
        background: isBeneficiary ? terminalColors.greenBg : terminalColors.panel2,
        padding: '3px 10px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {isBeneficiary ? 'RECEIVING' : 'GRANTED'}
    </span>
  )
}

/** One KPI card (matches the farm / token page's Kpi). */
function Kpi({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }): JSX.Element {
  return (
    <div style={{ border: `1px solid ${terminalColors.line2}`, borderRadius: 12, padding: '13px 15px', minWidth: 0, background: terminalColors.bg }}>
      <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase', color: terminalColors.ink3 }}>
        {label}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', color: valueColor ?? terminalColors.ink, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
      {sub ? (
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.faint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </div>
      ) : null}
    </div>
  )
}

/** A labelled address / value row in the metadata block. */
function MetaRow({ label, value, address, chainId }: { label: string; value?: string; address?: string; chainId?: number }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: `1px solid ${terminalColors.line3}` }}>
      <span style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3 }}>{label}</span>
      {address ? (
        <ExplorerAddress address={address} chainId={chainId} fontSize={12} fontWeight={500} />
      ) : (
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: terminalColors.ink2, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ?? '—'}
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ the screen */

export function VestingScheduleDetailScreen(): JSX.Element {
  const params = useParams<{ chainId: string; scheduleId: string }>()
  const isMobile = useIsMobileViewport()
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  const selectChain = useSelectChain()

  const parsed = useMemo(() => parseParams(params.chainId, params.scheduleId), [params.chainId, params.scheduleId])
  const chainId = parsed?.chainId
  const scheduleId = parsed?.scheduleId

  const connected = Boolean(account.address)
  const onCorrectChain = account.chainId === chainId
  const owner = assume0xAddress(account.address)

  // Core figures + the Release action — LIVE on-chain (works with no wallet / no indexer).
  const schedule = useSchedule({ chainId, scheduleId, owner })
  const row = schedule.row

  // USD value — from the priced indexer (honest "—" when offline / unpriceable).
  const analytics = useScheduleAnalytics(chainId ?? 0, parsed?.scheduleNum ?? -1)
  const indexed = analytics.schedule

  // Copy-share link.
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

  /* ------------------------------------------------------------- guards */

  if (!parsed) {
    return (
      <div style={PAGE_WRAP}>
        <StateBox
          title="Invalid vesting link"
          body="This vesting link is malformed — it needs a supported chain id and a numeric schedule id. Open a schedule from the Vesting page to view its page."
        />
      </div>
    )
  }

  const chainLabel = getChainLabel(chainId as UniverseChainId)

  if (!schedule.ready) {
    return (
      <div style={PAGE_WRAP}>
        <StateBox
          title="Vesting isn’t live here yet"
          body={`The HookSwap vesting manager isn’t deployed on ${chainLabel} yet, so this schedule can’t be read. Schedules appear here automatically once vesting is live on the chain.`}
        />
      </div>
    )
  }

  // Empty on-chain tuple, or the indexer 404s with no on-chain row → this id isn't a real
  // schedule (covers a manager that reverts on an unknown id — prefer "doesn't exist" over
  // an RPC-error message when the indexer confirms it's not indexed).
  if (schedule.notFound || (row === undefined && !schedule.isLoading && analytics.notFound)) {
    return (
      <div style={PAGE_WRAP}>
        <StateBox
          title="This schedule doesn’t exist"
          body={`No vesting schedule #${parsed.scheduleNum} was found on ${chainLabel}. It may have never been created, or the link is mistyped.`}
        />
      </div>
    )
  }

  if (!schedule.isLoading && schedule.error && row === undefined) {
    return (
      <div style={PAGE_WRAP}>
        <StateBox
          title="Can’t read this schedule"
          body={`The ${chainLabel} RPC is unreachable right now — we won’t show any fabricated data. Try again in a moment.`}
          retry={schedule.refetch}
        />
      </div>
    )
  }

  if (!row) {
    return (
      <div style={PAGE_WRAP}>
        <ScheduleSkeleton />
      </div>
    )
  }

  /* ------------------------------------------------------------- derived */

  const status = lifecycleOf(row)
  const sym = row.tokenSymbol
  const d = row.tokenDecimals
  const now = Math.floor(Date.now() / 1000)
  const end = row.start + row.duration
  const cliffEnd = row.start + row.cliff

  const pctVested = row.totalAmount > 0n ? (Number((row.vested * 10_000n) / row.totalAmount) / 100) : 0
  const pctLabel = ((): string => {
    if (pctVested <= 0) {
      return '0%'
    }
    if (pctVested > 0 && pctVested < 0.1) {
      return '<0.1%'
    }
    if (pctVested >= 100) {
      return '100%'
    }
    return `${pctVested.toFixed(1).replace(/\.0$/, '')}%`
  })()

  const endLabel = ((): string => {
    if (status === 'complete' || now >= end) {
      return 'Fully vested'
    }
    return `in ${fmtDuration(end - now)}`
  })()

  const cliffLabel = ((): string => {
    if (row.cliff <= 0) {
      return 'No cliff'
    }
    if (now >= cliffEnd) {
      return 'Cliff passed'
    }
    return fmtDate(cliffEnd)
  })()

  // USD split from the priced indexer (total value only; honest "—" otherwise).
  const totalUsd = indexed?.valueUsd

  /* ------------------------------------------------------------- action wiring */

  const canRelease = row.isBeneficiary && row.releasable > 0n && !schedule.isReleasing
  const releaseLabel = ((): string => {
    if (schedule.isReleasing) {
      return 'Claiming…'
    }
    if (!row.isBeneficiary) {
      return 'Beneficiary only'
    }
    if (row.releasable === 0n) {
      return now < cliffEnd ? 'In cliff' : row.vested >= row.totalAmount ? 'Fully claimed' : 'Nothing to claim'
    }
    return `Claim ${fmtAmount(row.releasable, d)} ${sym ?? ''}`.trim()
  })()

  /* ------------------------------------------------------------- render */

  const metaTitle = `${sym ?? 'Token'} vesting · HookSwap`
  const metaDesc = `A ${sym ?? 'token'} vesting schedule on ${chainLabel} — ${pctLabel} vested, cliff + linear release. View on HookSwap.`

  return (
    <div style={PAGE_WRAP}>
      <Helmet>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDesc} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDesc} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={metaTitle} />
        <meta name="twitter:description" content={metaDesc} />
      </Helmet>

      <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* ---------------------------------------------- hero */}
        <InstrumentPanel corners style={{ padding: 0 }}>
          <div style={{ padding: '24px 26px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <LedgerAvatar
                seed={row.token}
                initials={initials(sym)}
                size={48}
                logoUrl={resolveLedgerLogo(chainId, row.token)}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink }}>
                    {sym ?? 'Token'} vesting
                  </span>
                  <StatusPill status={status} />
                  {connected ? <RoleBadge isBeneficiary={row.isBeneficiary} /> : null}
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: terminalColors.ink3Alt,
                      background: terminalColors.panel2,
                      padding: '3px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {chainLabel}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 5 }}>
                  <span style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3 }}>
                    Schedule #{String(row.id)} · to{' '}
                    <ExplorerAddress address={row.beneficiary} chainId={chainId} fontSize={12.5} />
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <ExplorerAddress address={row.token} chainId={chainId} short={false} fontSize={12} />
                </div>
              </div>
              {/* Headline % vested */}
              <div style={{ textAlign: 'right', minWidth: 120 }}>
                <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: status === 'complete' ? terminalColors.ink3 : terminalColors.greenDeep }}>
                  {pctLabel}
                </div>
                <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3, marginTop: 2 }}>Vested</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
              <button type="button" onClick={onCopy} style={{ ...secondaryBtnStyle, flex: '0 1 200px' }}>
                {copied ? '✓ Link copied' : 'Copy share link'}
              </button>
            </div>
          </div>
        </InstrumentPanel>

        {/* ---------------------------------------------- KPI row (real only) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Kpi
            label="Total granted"
            value={`${fmtAmount(row.totalAmount, d)} ${sym ?? ''}`.trim()}
            sub={totalUsd !== undefined ? fmtUsd(totalUsd) : undefined}
          />
          <Kpi
            label="Vested to date"
            value={`${fmtAmount(row.vested, d)} ${sym ?? ''}`.trim()}
            valueColor={status !== 'complete' ? terminalColors.greenDeep : undefined}
          />
          <Kpi
            label="Claimable now"
            value={`${fmtAmount(row.releasable, d)} ${sym ?? ''}`.trim()}
            valueColor={row.releasable > 0n ? terminalColors.greenUp : undefined}
          />
          <Kpi label="Remaining locked" value={`${fmtAmount(row.locked, d)} ${sym ?? ''}`.trim()} />
          <Kpi label="Cliff" value={cliffLabel} valueColor={row.cliff > 0 && now < cliffEnd ? terminalColors.warn : undefined} />
          <Kpi label="Ends" value={endLabel} valueColor={status === 'complete' ? terminalColors.ink3 : undefined} sub={fmtDate(end)} />
        </div>

        {/* ---------------------------------------------- curve */}
        <InstrumentPanel title="UNLOCK SCHEDULE">
          <VestingCurve row={row} />
        </InstrumentPanel>

        {/* ---------------------------------------------- actions + metadata */}
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 18, alignItems: 'flex-start' }}>
          {/* Actions card (wallet-gated) */}
          <div style={{ flex: isMobile ? '1 1 auto' : '0 0 360px', minWidth: 0, width: isMobile ? '100%' : undefined }}>
            <InstrumentPanel title="CLAIM VESTED" corners>
              {!connected ? (
                <ConnectInline text={`Connect the beneficiary wallet to claim vested ${sym ?? 'tokens'} from this schedule.`} onConnect={() => accountDrawer.open()} />
              ) : !onCorrectChain ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
                  <Notice tone="muted">
                    Your wallet is on a different network. Switch to {chainLabel} to claim vested tokens from this schedule.
                  </Notice>
                  <PrimaryButton label={`Switch to ${chainLabel}`} onClick={() => void selectChain(chainId as UniverseChainId)} />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <PrimaryButton label={releaseLabel} onClick={() => void schedule.release()} disabled={!canRelease} />
                  {!row.isBeneficiary ? (
                    <Notice tone="muted">
                      Only the schedule’s beneficiary can release its vested tokens. Your connected wallet isn’t the
                      beneficiary of this schedule.
                    </Notice>
                  ) : (
                    <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, lineHeight: 1.5 }}>
                      Release transfers everything vested-but-unclaimed to the beneficiary. Balances refresh from chain
                      state after the transaction confirms — never optimistically.
                    </div>
                  )}
                  {/* Phase 1 vesting is NON-revocable — there is no revoke path on the contract. */}
                  <Notice tone="muted">
                    This schedule is non-revocable — HookSwap vesting has no clawback path, so the grantor cannot cancel
                    or reclaim it. The full amount will vest to the beneficiary on the curve.
                  </Notice>
                  {schedule.releaseError ? (
                    <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, lineHeight: 1.5 }}>{schedule.releaseError}</div>
                  ) : null}
                </div>
              )}
            </InstrumentPanel>
          </div>

          {/* Metadata */}
          <div style={{ flex: '1 1 auto', minWidth: 0, width: isMobile ? '100%' : undefined, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <InstrumentPanel title="SCHEDULE DETAILS">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <MetaRow label="Schedule id" value={`#${String(row.id)}`} />
                <MetaRow label="Token" value={sym} address={row.token} chainId={chainId} />
                <MetaRow label="Beneficiary" address={row.beneficiary} chainId={chainId} />
                <MetaRow label="Creator" address={row.creator} chainId={chainId} />
                <MetaRow label="Vesting contract" address={row.contractAddress} chainId={chainId} />
                <MetaRow label="Start" value={fmtDate(row.start)} />
                <MetaRow label="Cliff" value={row.cliff > 0 ? `${fmtDuration(row.cliff)} · ${fmtDate(cliffEnd)}` : 'None'} />
                <MetaRow label="Duration" value={row.duration > 0 ? fmtDuration(row.duration) : '—'} />
                <MetaRow label="End" value={fmtDate(end)} />
                <MetaRow label="Value (USD)" value={totalUsd !== undefined ? fmtUsd(totalUsd) : analytics.isLoading ? '…' : '—'} />
              </div>
              <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, lineHeight: 1.5, marginTop: 12 }}>
                Amounts, the release curve and the schedule window are live on-chain reads. The USD value comes from the
                priced vesting indexer and shows “—” on chains without a USD anchor — never fabricated. Phase 1 vesting is
                non-revocable.
              </div>
            </InstrumentPanel>
          </div>
        </div>

        <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, lineHeight: 1.5 }}>
          Total · vested · claimable · locked · the release curve and the schedule window are live on-chain reads; the USD
          value comes from the priced vesting indexer (omitted where a chain has no USD anchor — never fabricated).
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ skeleton */

function ScheduleSkeleton(): JSX.Element {
  const bar = (w: number | string, h: number): JSX.Element => (
    <div style={{ width: w, height: h, borderRadius: 5, background: terminalColors.line2 }} />
  )
  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <InstrumentPanel corners style={{ padding: 0 }}>
        <div style={{ padding: '24px 26px 22px' }} aria-busy="true">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: terminalColors.line2 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bar(160, 20)}
              {bar(220, 12)}
            </div>
          </div>
        </div>
      </InstrumentPanel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ border: `1px solid ${terminalColors.line2}`, borderRadius: 12, padding: '13px 15px', background: terminalColors.bg }} aria-busy="true">
            {bar(64, 10)}
            <div style={{ marginTop: 8 }}>{bar(96, 16)}</div>
          </div>
        ))}
      </div>
      <InstrumentPanel>
        <div style={{ height: 132, borderRadius: 12, background: terminalColors.panel }} aria-busy="true" />
      </InstrumentPanel>
    </div>
  )
}

/* ------------------------------------------------------------------ button styles */

const secondaryBtnStyle: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 13,
  fontWeight: 600,
  color: terminalColors.ink2,
  background: terminalColors.bg,
  border: `1px solid ${terminalColors.line}`,
  borderRadius: 10,
  padding: '11px 16px',
  cursor: 'pointer',
}
