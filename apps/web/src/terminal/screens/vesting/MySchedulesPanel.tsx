/**
 * HookSwap Terminal — "My schedules" manage view (redesigned, spacious).
 *
 * A responsive grid of VestingScheduleCards for every schedule the connected wallet is the
 * beneficiary OR the creator of, with a beneficiary-only Release action per card. Replaces
 * the old cramped single-panel list.
 *
 * DATA POLICY (facts-only): schedules + amounts are REAL on-chain reads (`useMySchedules`).
 * Honest states throughout: not-deployed → COMING SOON, disconnected → connect prompt,
 * loading → skeleton cards, empty → honest empty, error → retry. Nothing fabricated.
 */
import type { UniverseChainId } from 'uniswap/src/features/chains/types'
import { InstrumentPanel, terminalKeycap } from '~/terminal/components/InstrumentPanel'
import { SwitchChainButton } from '~/terminal/components/SwitchChainButton'
import { VestingScheduleCard } from '~/terminal/screens/vesting/VestingScheduleCard'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { type Address } from '~/chains'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { useMySchedulesAllChains } from '~/terminal/vesting/useMySchedulesAllChains'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

const gridStyle = (mobile: boolean): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(400px, 1fr))',
  gap: 16,
})

/* ---------------------------------------------------------------- states */

function NotDeployedNote({ chainLabel }: { chainLabel: string }): JSX.Element {
  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: 13,
        color: terminalColors.ink3,
        lineHeight: 1.55,
        border: `1px dashed ${terminalColors.line}`,
        borderRadius: 14,
        background: terminalColors.panel,
        padding: '22px 20px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', color: terminalColors.greenDeep, marginBottom: 7 }}>
        COMING SOON
      </div>
      Vesting isn&apos;t live on {chainLabel} yet — your schedules will appear here automatically once the HookSwap
      vesting manager is deployed.
    </div>
  )
}

function ConnectState({ onConnect }: { onConnect: () => void }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '30px 16px', textAlign: 'center' }}>
      <div style={{ fontFamily: SANS, fontSize: 13.5, color: terminalColors.ink2, maxWidth: 360, lineHeight: 1.5 }}>
        Connect a wallet to see the vesting schedules you receive or granted, and to claim what has vested.
      </div>
      <button
        type="button"
        onClick={onConnect}
        style={{
          fontFamily: MONO,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontSize: 12.5,
          fontWeight: 600,
          color: terminalColors.btnInk,
          background: terminalColors.brandGreen,
          border: 'none',
          padding: '10px 22px',
          borderRadius: 11,
          cursor: 'pointer',
        }}
      >
        Connect wallet
      </button>
    </div>
  )
}

function EmptyState(): JSX.Element {
  return (
    <div style={{ padding: '34px 16px', textAlign: 'center', fontFamily: SANS, fontSize: 13.5, color: terminalColors.ink3, lineHeight: 1.55 }}>
      You have no vesting schedules yet.
      <div style={{ fontSize: 12.5, color: terminalColors.faint, marginTop: 6 }}>
        Create one from the Create tab, or ask a grantor to vest tokens to your address.
      </div>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '30px 16px' }}>
      <span style={{ fontFamily: SANS, fontSize: 13, color: terminalColors.redDown }}>Failed to load your vesting schedules.</span>
      <button
        type="button"
        onClick={onRetry}
        style={{ ...terminalKeycap, fontSize: 11.5, letterSpacing: '0.04em', textTransform: 'uppercase', color: terminalColors.ink2, padding: '6px 14px', cursor: 'pointer' }}
      >
        Retry
      </button>
    </div>
  )
}

function SkeletonCards({ mobile }: { mobile: boolean }): JSX.Element {
  return (
    <div style={gridStyle(mobile)}>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} style={{ border: `1px solid ${terminalColors.line}`, borderRadius: 16, background: terminalColors.bg, padding: 20 }} aria-busy="true">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: terminalColors.line2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ height: 13, width: '45%', borderRadius: 4, background: terminalColors.line2 }} />
              <div style={{ height: 10, width: '65%', borderRadius: 4, background: terminalColors.line3, marginTop: 7 }} />
            </div>
          </div>
          <div style={{ height: 132, borderRadius: 12, background: terminalColors.panel, marginTop: 18 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 16 }}>
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} style={{ height: 44, borderRadius: 10, background: terminalColors.panel }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- panel */

export function MySchedulesPanel({
  deployed,
  connected,
  chainLabel,
  chainId,
  owner,
  onConnect,
  switchTarget,
}: {
  deployed: boolean
  connected: boolean
  chainLabel: string
  chainId?: number
  owner: Address | undefined
  onConnect: () => void
  switchTarget?: UniverseChainId
}): JSX.Element {
  const isMobile = useIsMobileViewport()
  // MULTICHAIN: aggregate the wallet's schedules across ALL HookSwap chains regardless of the
  // connected chain (each row carries its own chainId → chain badge). Viewing is all-chain;
  // Release still requires the wallet on that row's chain (handled per-row below).
  const schedules = useMySchedulesAllChains({ owner, connectedChainId: chainId })

  const rows = schedules.rows
  const receiving = (rows ?? []).filter((r) => r.isBeneficiary).length
  const granted = (rows ?? []).filter((r) => !r.isBeneficiary).length

  const meta =
    rows && rows.length > 0
      ? [
          <span key="r" style={{ fontFamily: MONO }}>
            {receiving} receiving · {granted} granted
          </span>,
        ]
      : undefined

  const body = ((): JSX.Element => {
    // MULTICHAIN: no `!deployed` gate here — schedules are aggregated across every HookSwap
    // chain, so the list shows even when the CURRENTLY-connected chain has no vesting suite.
    if (!connected) {
      return <ConnectState onConnect={onConnect} />
    }
    if (schedules.error) {
      return <ErrorState onRetry={schedules.refetch} />
    }
    if (rows === undefined) {
      return <SkeletonCards mobile={isMobile} />
    }
    if (rows.length === 0) {
      return <EmptyState />
    }
    return (
      <div style={gridStyle(isMobile)}>
        {rows.map((row) => (
          <VestingScheduleCard
            key={`${row.chainId}-${row.id}`}
            row={row}
            chainId={row.chainId}
            releasing={schedules.isReleasing && schedules.releasingChild?.toLowerCase() === row.contractAddress.toLowerCase()}
            onRelease={(child) => void schedules.release(child, row.chainId)}
            isMobile={isMobile}
          />
        ))}
      </div>
    )
  })()

  return (
    <InstrumentPanel title="MY VESTING SCHEDULES" meta={meta}>
      {body}
      {schedules.releaseError ? (
        <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.redDown, marginTop: 14, lineHeight: 1.5 }}>{schedules.releaseError}</div>
      ) : null}
    </InstrumentPanel>
  )
}
