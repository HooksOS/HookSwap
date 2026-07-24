/**
 * HookSwap Terminal — mobile card row for the B13 Activity feed.
 *
 * The desktop feed row (`~/terminal/components/NotificationRow`) packs the unread dot,
 * category tile, title + detail, timestamp and the "View" action onto ONE horizontal
 * line — which squeezes/overflows on a phone. This is the native mobile presentation of
 * the SAME live row: the action leads, the timestamp sits on the same header line, the
 * chain / status / tx hash drop into a wrapping label→value grid, and the explorer link
 * becomes a full-width ≥44px tap target. Nothing scrolls sideways.
 *
 * Presentation only — every value is passed in from `ActivityScreen`'s live
 * `useActivityData` rows. Absent values render an honest "—" (never fabricated).
 */
import { notificationCategoryBadges, type NotificationCategory } from '~/terminal/components/NotificationRow'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

/** Status colour bucket — mapped from the real `TransactionStatus` by the caller. */
export type ActivityTone = 'ok' | 'pending' | 'bad'

function toneColor(tone: ActivityTone): string {
  switch (tone) {
    case 'ok':
      return terminalColors.greenDeep
    case 'pending':
      return terminalColors.warn
    case 'bad':
      return terminalColors.redDown
    default:
      return terminalColors.ink
  }
}

export interface ActivityCardRowProps {
  /** Unread (pending) → brand-green dot, same semantics as the desktop row. */
  unread: boolean
  category: NotificationCategory
  /** Tile text, e.g. SWAP / APPR / FEES. */
  badgeLabel: string
  /** The real action title from `getTransactionSummaryTitle`, e.g. "Swapped". */
  title: string
  /** Confirmed / Pending / Failed / Canceled / Submitted. */
  status: string
  statusTone: ActivityTone
  /** Chain label from `getChainLabel(tx.chainId)`. */
  chainLabel: string
  /** Pre-formatted relative time, e.g. "12m ago". */
  timestamp: string
  /** Truncated tx hash (mono). Undefined when the tx has no hash yet → "—". */
  hashShort?: string
  /** Block-explorer deep link. Omitted → no action button (never a dead link). */
  explorerUrl?: string
  divider?: boolean
}

export function ActivityCardRow({
  unread,
  category,
  badgeLabel,
  title,
  status,
  statusTone,
  chainLabel,
  timestamp,
  hashShort,
  explorerUrl,
  divider = true,
}: ActivityCardRowProps): JSX.Element {
  const badge = notificationCategoryBadges[category]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '15px 16px',
        borderBottom: divider ? `1px solid ${terminalColors.line3}` : undefined,
        background: terminalColors.bg,
      }}
    >
      {/* Header — unread dot + category tile + action title, timestamp pinned right. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
        <span
          aria-label={unread ? 'Unread' : undefined}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: unread ? terminalColors.brandGreen : 'transparent',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: badge.background,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 600,
              color: badge.color,
              textTransform: 'uppercase',
            }}
          >
            {badgeLabel}
          </span>
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: SANS,
            fontSize: 15,
            fontWeight: 600,
            color: terminalColors.ink,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            color: terminalColors.faint,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {timestamp}
        </span>
      </div>

      {/* Label → value grid: wraps instead of scrolling sideways. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: '10px 12px' }}>
        <CardStat label="Status" value={status} valueColor={toneColor(statusTone)} />
        <CardStat label="Network" value={chainLabel} />
        <CardStat label="Tx" value={hashShort ?? '—'} valueColor={hashShort ? terminalColors.ink : terminalColors.faint} />
      </div>

      {/* Explorer link — full-width, ≥44px tap target. Only when a real link exists. */}
      {explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 44,
            fontFamily: SANS,
            fontSize: 13,
            fontWeight: 600,
            color: terminalColors.ink,
            background: terminalColors.bg,
            border: `1px solid ${terminalColors.line}`,
            borderRadius: 10,
            textDecoration: 'none',
          }}
        >
          View on explorer
        </a>
      ) : null}
    </div>
  )
}

/** A labelled stat inside a mobile activity card. Mono value, sans label. */
function CardStat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span
        style={{
          fontFamily: SANS,
          fontSize: 10,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: terminalColors.faint,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12.5,
          fontWeight: 600,
          color: valueColor ?? terminalColors.ink,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  )
}

/** Card-shaped loading placeholder — matches the mobile card's vertical rhythm. */
export function ActivityCardSkeleton(): JSX.Element {
  return (
    <div aria-busy="true">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: '15px 16px',
            borderBottom: i < 4 ? `1px solid ${terminalColors.line3}` : undefined,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: terminalColors.line2, flexShrink: 0 }} />
            <span style={{ width: 36, height: 36, borderRadius: 10, background: terminalColors.line2, flexShrink: 0 }} />
            <span style={{ flex: 1, height: 13, borderRadius: 4, background: terminalColors.line2 }} />
            <span style={{ width: 40, height: 10, borderRadius: 4, background: terminalColors.line3 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: '10px 12px' }}>
            {Array.from({ length: 3 }, (_, j) => (
              <div key={j} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ height: 9, width: 34, borderRadius: 3, background: terminalColors.line3 }} />
                <span style={{ height: 11, width: '70%', borderRadius: 3, background: terminalColors.line2 }} />
              </div>
            ))}
          </div>
          <span style={{ height: 44, borderRadius: 10, background: terminalColors.line3 }} />
        </div>
      ))}
    </div>
  )
}
