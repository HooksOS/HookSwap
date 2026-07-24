/**
 * HookSwap Terminal — one vesting schedule, as a spacious Ledger card.
 *
 * The centrepiece of the redesigned "My schedules" view: a roomy card per on-chain
 * schedule showing the token (hue avatar + explorer link), the receiving/granting role,
 * a lifecycle status pill, the beneficiary/creator, a real cliff+linear VestingCurve
 * graph, the total / claimed / claimable / locked split, and a beneficiary-only Release
 * action.
 *
 * DATA POLICY (facts-only): every figure comes from the decoded on-chain
 * `VestingScheduleRow` (see `~/terminal/vesting/useMySchedules`). Amounts read "—" until
 * the token's decimals resolve. `release()` is beneficiary-ONLY on the child and pays the
 * live `releasable()`, so the button is enabled only for the beneficiary when something is
 * actually claimable — never optimistic, never fabricated.
 */
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { ExplorerDataType } from 'uniswap/src/utils/linking'
import { formatUnits, type Address } from '~/chains'
import { ExplorerAddress } from '~/terminal/components/ExplorerAddress'
import { LedgerAvatar, resolveLedgerLogo } from '~/terminal/components/LedgerAvatar'
import { VestingCurve } from '~/terminal/screens/vesting/VestingCurve'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import type { VestingScheduleRow } from '~/terminal/vesting/useMySchedules'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

type Lifecycle = 'cliff' | 'vesting' | 'complete'

/**
 * There is no `warnBorder` token (green owns `greenBorder`; warn/red do not), so
 * the cliff pill's hairline is mixed from `warn` into `warnBg` — theme-aware, and
 * a near-match for the former hardcoded #EAD9A8 in light mode.
 */
const WARN_BORDER = `color-mix(in srgb, ${terminalColors.warn} 28%, ${terminalColors.warnBg})`

const STATUS_META: Record<Lifecycle, { label: string; color: string; bg: string; border: string }> = {
  cliff: { label: 'In cliff', color: terminalColors.warn, bg: terminalColors.warnBg, border: WARN_BORDER },
  vesting: { label: 'Vesting', color: terminalColors.greenDeep, bg: terminalColors.greenBg, border: terminalColors.greenBorder },
  complete: { label: 'Complete', color: terminalColors.ink3, bg: terminalColors.panel2, border: terminalColors.line },
}

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

/** Raw token units → readable amount using the token's real decimals ("—" until known). */
function fmtAmount(raw: bigint, decimals?: number): string {
  if (decimals === undefined) {
    return '—'
  }
  const n = Number(formatUnits(raw, decimals))
  if (!Number.isFinite(n)) {
    return '—'
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function initials(symbol: string | undefined): string {
  return (symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?'
}

function StatusPill({ status }: { status: Lifecycle }): JSX.Element {
  const m = STATUS_META[status]
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
        padding: '2px 8px',
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
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        color: isBeneficiary ? terminalColors.greenDeep : terminalColors.accentIndigo,
        background: isBeneficiary ? terminalColors.greenBg : terminalColors.panel2,
        padding: '2px 8px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {isBeneficiary ? 'RECEIVING' : 'GRANTED'}
    </span>
  )
}

function StatTile({ label, value, symbol, accent }: { label: string; value: string; symbol?: string; accent?: boolean }): JSX.Element {
  return (
    <div style={{ border: `1px solid ${terminalColors.line}`, borderRadius: 10, background: terminalColors.panel, padding: '9px 11px', minWidth: 0 }}>
      <div style={{ fontFamily: SANS, fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: terminalColors.faint }}>{label}</div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: accent ? terminalColors.greenDeep : terminalColors.ink,
          marginTop: 3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={`${value}${symbol ? ` ${symbol}` : ''}`}
      >
        {value}
        {symbol ? <span style={{ fontSize: 10.5, color: terminalColors.faint, marginLeft: 4 }}>{symbol}</span> : null}
      </div>
    </div>
  )
}

function ReleaseButton({
  row,
  releasing,
  onRelease,
  full,
}: {
  row: VestingScheduleRow
  releasing: boolean
  onRelease: (child: Address) => void
  full?: boolean
}): JSX.Element {
  const now = Math.floor(Date.now() / 1000)
  const cliffEnd = row.start + row.cliff
  const canRelease = row.isBeneficiary && row.releasable > 0n && !releasing

  const label = ((): string => {
    if (releasing) {
      return 'Claiming…'
    }
    if (!row.isBeneficiary) {
      return 'Beneficiary only'
    }
    if (row.releasable === 0n) {
      return now < cliffEnd ? 'In cliff' : row.vested >= row.totalAmount ? 'Fully claimed' : 'Nothing to claim'
    }
    return 'Claim vested'
  })()

  return (
    <button
      type="button"
      disabled={!canRelease}
      onClick={() => onRelease(row.contractAddress)}
      style={{
        width: full ? '100%' : undefined,
        fontFamily: MONO,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontSize: 12,
        fontWeight: 600,
        color: canRelease ? terminalColors.btnInk : terminalColors.faint,
        background: canRelease ? terminalColors.brandGreen : terminalColors.panel2,
        border: canRelease ? 'none' : `1px solid ${terminalColors.line}`,
        padding: full ? '11px 0' : '9px 18px',
        borderRadius: 11,
        cursor: canRelease ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

export function VestingScheduleCard({
  row,
  chainId,
  releasing,
  onRelease,
  isMobile,
}: {
  row: VestingScheduleRow
  chainId?: number
  /** This specific schedule's release tx is in flight. */
  releasing: boolean
  onRelease: (child: Address) => void
  isMobile: boolean
}): JSX.Element {
  const status = lifecycleOf(row)
  const d = row.tokenDecimals
  const sym = row.tokenSymbol
  const chainLabel = chainId !== undefined ? getChainLabel(chainId as UniverseChainId) : undefined

  return (
    <div
      style={{
        border: `1px solid ${terminalColors.line}`,
        borderRadius: 16,
        background: terminalColors.bg,
        padding: isMobile ? 16 : 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        minWidth: 0,
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
        <LedgerAvatar seed={row.token} initials={initials(sym)} size={40} logoUrl={resolveLedgerLogo(chainId, row.token)} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
            <ExplorerAddress
              address={row.token}
              chainId={chainId}
              type={ExplorerDataType.TOKEN}
              label={sym ?? undefined}
              fontSize={15}
              fontWeight={600}
              color={terminalColors.ink}
              style={{ letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis' }}
            />
            <RoleBadge isBeneficiary={row.isBeneficiary} />
            <StatusPill status={status} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 5 }}>
            <span style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3 }}>
              {row.isBeneficiary ? 'From' : 'To'}{' '}
              <ExplorerAddress
                address={row.isBeneficiary ? row.creator : row.beneficiary}
                chainId={chainId}
                fontSize={12}
              />
            </span>
            {chainLabel ? (
              <>
                <span style={{ color: terminalColors.line }}>·</span>
                <span style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3 }}>{chainLabel}</span>
              </>
            ) : null}
          </div>
        </div>
        {!isMobile ? <ReleaseButton row={row} releasing={releasing} onRelease={onRelease} /> : null}
      </div>

      {/* curve */}
      <VestingCurve row={row} />

      {/* amounts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
        <StatTile label="Total" value={fmtAmount(row.totalAmount, d)} symbol={sym} />
        <StatTile label="Claimed" value={fmtAmount(row.released, d)} symbol={sym} />
        <StatTile label="Claimable" value={fmtAmount(row.releasable, d)} symbol={sym} accent={row.releasable > 0n} />
        <StatTile label="Locked" value={fmtAmount(row.locked, d)} symbol={sym} />
      </div>

      {isMobile ? <ReleaseButton row={row} releasing={releasing} onRelease={onRelease} full /> : null}
    </div>
  )
}
