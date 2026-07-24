/**
 * HookSwap Terminal — B13 Activity / Notifications (connected-wallet feed).
 *
 * Pixel-perfect recreation of design handoff screen B13 (column 1b) — see
 * `design_handoff_hookswap_terminal/screenshots/B13-notifications.png` and the B13
 * markup in `design/HookSwap Redesign.dc.html`: a title + count badge + action, a
 * 4-cell KPI row, filter chips, and a feed of rows (dot, category tile, title +
 * detail, timestamp, contextual action).
 *
 * DATA POLICY (no mock data — handoff hard rule):
 *   • Feed — LIVE from `useActivityData` (the app's real local + indexed tx history,
 *     the same feed the legacy `/portfolio/activity` page uses). Each row's title comes
 *     from the app's real `getTransactionSummaryTitle`; the timestamp from the tx
 *     `addedTime`; the category tile is mapped from the real `TransactionType`; the
 *     "View" action deep-links to the tx on the chain's block explorer (real).
 *   • KPI row — LIVE: Transactions = real event count; Fees claimable = sum of the
 *     wallet's real LP position `uncollectedFeesUsd`; 7d activity = real count of the
 *     last-7-day events + a sparkline of daily counts. "Price alerts" needs an alert
 *     service HookSwap does not run, so it renders an honest "—" (never fabricated).
 *   • Filter chips are mapped to real transaction groups (Swaps / Liquidity / Approvals
 *     / Transfers) rather than the prototype's notification categories.
 *
 * Disconnected → an honest "Connect wallet" empty state. Loading / empty / error states
 * are all real over the live hook.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getTransactionSummaryTitle } from 'uniswap/src/features/activity/utils/getTransactionSummaryTitle'
import { ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { useActivityData } from 'uniswap/src/features/activity/hooks/useActivityData'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { isLoadingItem, isSectionHeader } from 'uniswap/src/components/activity/utils'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import { useWalletPositions } from 'uniswap/src/features/positions/hooks/useWalletPositions'
import {
  TransactionStatus,
  TransactionType,
  type TransactionDetails,
} from 'uniswap/src/features/transactions/types/transactionDetails'
import { ExplorerDataType, getExplorerLink } from 'uniswap/src/utils/linking'
import { NumberType } from 'utilities/src/format/types'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useAccount } from '~/hooks/useAccount'
import { Eyebrow, InstrumentPanel, terminalKeycap } from '~/terminal/components/InstrumentPanel'
import { NotificationRow, type NotificationCategory } from '~/terminal/components/NotificationRow'
import { StatCard } from '~/terminal/components/StatCard'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { ActivityCardRow, ActivityCardSkeleton, type ActivityTone } from '~/terminal/screens/activity/ActivityCardRow'
import '~/terminal/theme/terminal.css'
import { terminalColors, terminalFonts, terminalShadows } from '~/terminal/theme/tokens'
import { formatRelativeTime } from '~/terminal/utils/time'

const MONO = terminalFonts.mono
const DISPLAY = terminalFonts.display
const SANS = terminalFonts.sans

/* ------------------------------------------------------------- categorisation */

type FilterGroup = 'all' | 'swaps' | 'liquidity' | 'approvals' | 'transfers'

interface TxCategory {
  category: NotificationCategory
  badge: string
  group: Exclude<FilterGroup, 'all'>
}

/** Map a real TransactionType to a Terminal notification tile + filter group. */
function categorize(type: TransactionType): TxCategory {
  switch (type) {
    case TransactionType.Swap:
    case TransactionType.Bridge:
    case TransactionType.Plan:
      return { category: 'swap', badge: 'SWAP', group: 'swaps' }
    case TransactionType.Wrap:
      return { category: 'swap', badge: 'WRAP', group: 'swaps' }
    case TransactionType.Approve:
    case TransactionType.NFTApprove:
      return { category: 'swap', badge: 'APPR', group: 'approvals' }
    case TransactionType.Send:
      return { category: 'swap', badge: 'SEND', group: 'transfers' }
    case TransactionType.Receive:
      return { category: 'swap', badge: 'RECV', group: 'transfers' }
    case TransactionType.CollectFees:
    case TransactionType.LPIncentivesClaimRewards:
      return { category: 'fees', badge: 'FEES', group: 'liquidity' }
    case TransactionType.LiquidityIncrease:
    case TransactionType.CreatePool:
    case TransactionType.CreatePair:
    case TransactionType.Deposit:
      return { category: 'fees', badge: 'ADD', group: 'liquidity' }
    case TransactionType.LiquidityDecrease:
    case TransactionType.Withdraw:
      return { category: 'range', badge: 'RMV', group: 'liquidity' }
    default:
      return { category: 'swap', badge: 'TXN', group: 'swaps' }
  }
}

function statusDetail(status: TransactionStatus): string {
  switch (status) {
    case TransactionStatus.Pending:
      return 'Pending'
    case TransactionStatus.Failed:
      return 'Failed'
    case TransactionStatus.Canceled:
      return 'Canceled'
    case TransactionStatus.Success:
      return 'Confirmed'
    default:
      return 'Submitted'
  }
}

/** Colour bucket for the mobile card's Status stat (same real `TransactionStatus`). */
function statusTone(status: TransactionStatus): ActivityTone {
  switch (status) {
    case TransactionStatus.Success:
      return 'ok'
    case TransactionStatus.Failed:
    case TransactionStatus.Canceled:
      return 'bad'
    default:
      return 'pending'
  }
}

/** Truncated tx hash for the mobile card (mono). No hash yet → undefined → honest "—". */
function shortHash(hash: string | undefined): string | undefined {
  if (!hash || hash.length < 12) {
    return hash || undefined
  }
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

interface ActivityRow {
  id: string
  title: string
  detail: string
  /** Same live status/chain as `detail`, split out so the mobile card can label them. */
  status: string
  statusTone: ActivityTone
  chainLabel: string
  hashShort?: string
  timestamp: string
  category: NotificationCategory
  badge: string
  group: Exclude<FilterGroup, 'all'>
  unread: boolean
  explorerUrl?: string
  addedTime: number
}

/* ------------------------------------------------------------------ filter chips */

const FILTER_CHIPS: ReadonlyArray<{ id: FilterGroup; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'swaps', label: 'Swaps' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'transfers', label: 'Transfers' },
]

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: SANS,
        fontSize: 12.5,
        fontWeight: 600,
        padding: '6px 13px',
        borderRadius: 999,
        cursor: 'pointer',
        border: active ? `1px solid ${terminalColors.line}` : '1px solid transparent',
        background: active ? terminalColors.bg : 'transparent',
        color: active ? terminalColors.ink : terminalColors.ink2,
        boxShadow: active ? terminalShadows.segmentedActive : undefined,
      }}
    >
      {label}
    </button>
  )
}

/* ------------------------------------------------------------------ 7-day activity bars */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Compact 7-day activity bar chart. `counts[6]` is today, `counts[0]` is 6 days ago —
 * the exact buckets already computed for the "Activity · 7d" KPI (no new fetch). Bars
 * scale to the busiest day; an all-zero week shows an honest empty caption.
 */
function SevenDayBars({ counts }: { counts: readonly number[] }): JSX.Element {
  const max = Math.max(1, ...counts)
  const total = counts.reduce((sum, c) => sum + c, 0)
  const now = Date.now()
  const dayLabel = (i: number): string =>
    new Date(now - (6 - i) * DAY_MS).toLocaleDateString('en-US', { weekday: 'short' })

  if (total === 0) {
    return (
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt, padding: '4px 0' }}>
        No activity in the last 7 days.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
      {counts.map((c, i) => (
        <div
          key={i}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              color: c > 0 ? terminalColors.ink : terminalColors.faint,
            }}
          >
            {c}
          </span>
          {/* Fixed-height track keeps every bar bottom-aligned regardless of count. */}
          <div style={{ width: '100%', height: 64, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div
              style={{
                width: '100%',
                maxWidth: 36,
                height: c === 0 ? 3 : Math.round((c / max) * 60) + 4,
                borderRadius: 4,
                background: c > 0 ? terminalColors.brandGreen : terminalColors.line2,
              }}
            />
          </div>
          <span style={{ fontFamily: MONO, fontSize: 10, color: terminalColors.ink3 }}>{dayLabel(i)}</span>
        </div>
      ))}
    </div>
  )
}

function SevenDayBarsSkeleton(): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }} aria-busy="true">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ height: 11, width: 14, borderRadius: 3, background: terminalColors.line3 }} />
          <div style={{ width: '100%', height: 64, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div style={{ width: '100%', maxWidth: 36, height: 20 + ((i * 7) % 34), borderRadius: 4, background: terminalColors.line2 }} />
          </div>
          <span style={{ height: 10, width: 20, borderRadius: 3, background: terminalColors.line3 }} />
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ connect state */

function ConnectState({ onConnect }: { onConnect: () => void }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        minHeight: 420,
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, color: terminalColors.ink }}>
        Connect your wallet
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13.5, color: terminalColors.ink2, maxWidth: 340, lineHeight: 1.5 }}>
        Connect a wallet to see your transaction activity and claimable fees.
      </div>
      <button
        type="button"
        onClick={onConnect}
        style={{
          marginTop: 6,
          fontFamily: SANS,
          fontSize: 14,
          fontWeight: 600,
          color: terminalColors.btnInk,
          background: terminalColors.brandGreen,
          border: 'none',
          padding: '11px 22px',
          borderRadius: 12,
          cursor: 'pointer',
        }}
      >
        Connect wallet
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ the screen */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function ActivityScreen(): JSX.Element {
  const { t } = useTranslation()
  const isMobile = useIsMobileViewport()
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  const address = account.address
  const { convertFiatAmountFormatted } = useLocalizationContext()
  const [filter, setFilter] = useState<FilterGroup>('all')

  const activity = useActivityData({
    evmOwner: address,
    ownerAddresses: address ? [address] : [],
    fiatOnRampParams: undefined,
    skip: !address,
  })

  // Live LP position fees (real) for the "Fees claimable" KPI.
  // Restricted to v2 + v3 (no v4 in HookSwap), mirroring PositionsScreen.
  const positionsResult = useWalletPositions({
    account: address ?? '',
    disabled: !address,
    protocolVersions: [ProtocolVersion.V2, ProtocolVersion.V3],
  })
  const feesClaimable = useMemo(
    () => positionsResult.positions.reduce((sum, p) => sum + (p.uncollectedFeesUsd ?? 0), 0),
    [positionsResult.positions],
  )

  const rows: ActivityRow[] | undefined = useMemo(() => {
    if (!activity.sectionData) {
      return undefined
    }
    const out: ActivityRow[] = []
    for (const entry of activity.sectionData) {
      if (isSectionHeader(entry) || isLoadingItem(entry)) {
        continue
      }
      const tx = entry as TransactionDetails
      const cat = categorize(tx.typeInfo.type)
      const status = statusDetail(tx.status)
      const chainLabel = getChainLabel(tx.chainId)
      out.push({
        id: tx.id,
        title: getTransactionSummaryTitle(tx, t) ?? 'Transaction',
        // Status + network (data spans all 6 HookSwap chains) so each row shows which chain it's on.
        detail: `${status} · ${chainLabel}`,
        status,
        statusTone: statusTone(tx.status),
        chainLabel,
        hashShort: shortHash(tx.hash),
        timestamp: formatRelativeTime(tx.addedTime),
        category: cat.category,
        badge: cat.badge,
        group: cat.group,
        unread: tx.status === TransactionStatus.Pending,
        explorerUrl: tx.hash
          ? getExplorerLink({ chainId: tx.chainId, data: tx.hash, type: ExplorerDataType.TRANSACTION })
          : undefined,
        addedTime: tx.addedTime,
      })
    }
    return out
  }, [activity.sectionData, t])

  const filteredRows = useMemo(
    () => (rows ? (filter === 'all' ? rows : rows.filter((r) => r.group === filter)) : undefined),
    [rows, filter],
  )

  // 7d activity metrics (real): count + daily-bucket sparkline.
  const { sevenDayCount, dailyCounts } = useMemo(() => {
    if (!rows) {
      return { sevenDayCount: 0, dailyCounts: [] as number[] }
    }
    const now = Date.now()
    const buckets = new Array<number>(7).fill(0)
    let count = 0
    for (const r of rows) {
      const age = now - r.addedTime
      if (age >= 0 && age < SEVEN_DAYS_MS) {
        count += 1
        const dayIndex = 6 - Math.min(6, Math.floor(age / (24 * 60 * 60 * 1000)))
        buckets[dayIndex] += 1
      }
    }
    return { sevenDayCount: count, dailyCounts: buckets }
  }, [rows])

  const loadingFeed = activity.isLoading && !rows
  const kpiLoading = activity.isLoading && !rows

  if (!address) {
    return (
      <div style={{ padding: '20px var(--tm-gutter) 40px' }}>
        <Header count={0} showRefresh={false} />
        <ConnectState onConnect={() => accountDrawer.open()} />
      </div>
    )
  }

  return (
    <div style={{ padding: '20px var(--tm-gutter) 40px' }}>
      <Header count={rows?.length ?? 0} onRefresh={() => activity.refetch()} />

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 20 }}>
        <StatCard
          size="lg"
          label="Transactions"
          value={kpiLoading ? undefined : String(rows?.length ?? 0)}
          loading={kpiLoading}
        />
        <StatCard
          size="lg"
          label="Fees claimable"
          value={
            positionsResult.isLoading && !positionsResult.hasData
              ? undefined
              : convertFiatAmountFormatted(feesClaimable, NumberType.PortfolioBalance)
          }
          valueColor={feesClaimable > 0 ? 'up' : 'ink'}
          loading={positionsResult.isLoading && !positionsResult.hasData}
        />
        {/* No alert service (v4/hooks excluded) — honest not-available. */}
        <StatCard size="lg" label="Price alerts" value="—" />
        <StatCard
          size="lg"
          label="Activity · 7d"
          value={kpiLoading ? undefined : `${sevenDayCount} events`}
          sparkline={dailyCounts.length > 0 ? dailyCounts : undefined}
          sparklineDirection="up"
          sparklinePosition="right"
          loading={kpiLoading}
        />
      </div>

      {/* 7-day activity bar chart — real daily-bucket counts (same data as the 7d KPI). */}
      <div style={{ marginBottom: 20 }}>
        <InstrumentPanel title="Activity · last 7 days" corners meta={[`${sevenDayCount} events`]}>
          {kpiLoading ? (
            <SevenDayBarsSkeleton />
          ) : (
            <SevenDayBars counts={dailyCounts.length === 7 ? dailyCounts : new Array<number>(7).fill(0)} />
          )}
        </InstrumentPanel>
      </div>

      {/* Filter chips — wrap on mobile so all 5 stay tappable without sideways scroll. */}
      <div style={{ display: 'flex', gap: isMobile ? 6 : 4, flexWrap: isMobile ? 'wrap' : 'nowrap', marginBottom: 14 }}>
        {FILTER_CHIPS.map((chip) => (
          <FilterChip key={chip.id} label={chip.label} active={filter === chip.id} onClick={() => setFilter(chip.id)} />
        ))}
      </div>

      {/* Feed card */}
      <InstrumentPanel
        title="Feed"
        corners
        live
        flush
        meta={[FILTER_CHIPS.find((c) => c.id === filter)?.label ?? 'All']}
        style={{ overflow: 'hidden' }}
      >
        {loadingFeed ? (
          isMobile ? <ActivityCardSkeleton /> : <FeedSkeleton />
        ) : activity.error ? (
          // Honest failed-to-load state (distinct from a successful-but-empty feed), with a Retry.
          <FeedError onRetry={() => activity.refetch()} />
        ) : filteredRows && filteredRows.length > 0 ? (
          // Desktop: bounded scroll region (~8–9 rows) so a long history scrolls INSIDE the
          // card instead of making the page endlessly tall. No pagination controls.
          // Mobile: the feed flows with the page (a nested scroll box fights native scrolling).
          <div style={isMobile ? undefined : { maxHeight: 560, overflowY: 'auto' }}>
            {filteredRows.map((row, index) =>
              isMobile ? (
                <ActivityCardRow
                  key={row.id}
                  unread={row.unread}
                  category={row.category}
                  badgeLabel={row.badge}
                  title={row.title}
                  status={row.status}
                  statusTone={row.statusTone}
                  chainLabel={row.chainLabel}
                  timestamp={row.timestamp}
                  hashShort={row.hashShort}
                  explorerUrl={row.explorerUrl}
                  divider={index < filteredRows.length - 1}
                />
              ) : (
                <NotificationRow
                  key={row.id}
                  unread={row.unread}
                  category={row.category}
                  badgeLabel={row.badge}
                  title={row.title}
                  detail={row.detail}
                  timestamp={row.timestamp}
                  divider={index < filteredRows.length - 1}
                  action={
                    row.explorerUrl
                      ? { label: 'View', onClick: () => window.open(row.explorerUrl, '_blank', 'noopener,noreferrer') }
                      : undefined
                  }
                />
              ),
            )}
          </div>
        ) : (
          <FeedMessage>
            {filter === 'all' ? 'No transaction activity yet.' : `No ${filter} in your activity.`}
          </FeedMessage>
        )}
      </InstrumentPanel>
    </div>
  )
}

/* --------------------------------------------------------------- sub-pieces */

function Header({
  count,
  onRefresh,
  showRefresh = true,
}: {
  count: number
  onRefresh?: () => void
  showRefresh?: boolean
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Eyebrow>Account · transaction feed</Eyebrow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
          Activity
        </h1>
        {count > 0 ? (
          <span
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              color: terminalColors.greenDeep,
              background: terminalColors.greenBg,
              border: `1px solid ${terminalColors.greenBorder}`,
              padding: '3px 9px',
              borderRadius: 999,
            }}
          >
            {count} events
          </span>
        ) : null}
        </div>
      </div>
      {showRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          style={{
            ...terminalKeycap,
            fontSize: 12.5,
            padding: '8px 14px',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      ) : null}
    </div>
  )
}

function FeedMessage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ padding: '40px 18px', textAlign: 'center', fontFamily: SANS, fontSize: 13, color: terminalColors.ink3Alt }}>
      {children}
    </div>
  )
}

function FeedError({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div style={{ padding: '40px 18px', textAlign: 'center' }}>
      <div style={{ fontFamily: SANS, fontSize: 13, color: terminalColors.redDown }}>
        Couldn&apos;t load your activity.
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          ...terminalKeycap,
          marginTop: 12,
          fontSize: 12.5,
          padding: '8px 14px',
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  )
}

function FeedSkeleton(): JSX.Element {
  return (
    <div aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '15px 18px',
            borderBottom: i < 5 ? `1px solid ${terminalColors.line3}` : undefined,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: terminalColors.line2, flexShrink: 0 }} />
          <span style={{ width: 38, height: 38, borderRadius: 10, background: terminalColors.line2, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ height: 12, width: '35%', borderRadius: 4, background: terminalColors.line2 }} />
            <div style={{ height: 10, width: '55%', borderRadius: 4, background: terminalColors.line3, marginTop: 6 }} />
          </div>
          <span style={{ height: 10, width: 44, borderRadius: 4, background: terminalColors.line3 }} />
        </div>
      ))}
    </div>
  )
}
