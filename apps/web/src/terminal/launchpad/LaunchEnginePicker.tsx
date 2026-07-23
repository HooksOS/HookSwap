/**
 * HookSwap Terminal — LaunchPad engine picker.
 *
 * The 4-card selector at the top of the create surface: Bonding Curve · Fair Launch · v3 ·
 * Quick Launch · Stock Reward. Each card's availability is resolved LIVE from the SDK for the
 * connected chain (`engine.resolveAvailability(chainId)`) — an unavailable engine renders a
 * disabled card with an honest reason ("Robinhood only" / "not deployed"), never a dead link.
 *
 * Selecting an engine is always allowed (so a user can read its panel + gating copy), but the
 * card visibly flags whether it can actually launch on the current network.
 */
import { LAUNCH_ENGINES, type LaunchEngineId } from '~/terminal/launchpad/engines'
import { MONO, SANS } from '~/terminal/launchpad/primitives'
import { terminalColors } from '~/terminal/theme/tokens'

export function LaunchEnginePicker({
  chainId,
  selected,
  onSelect,
}: {
  chainId?: number
  selected: LaunchEngineId
  onSelect: (id: LaunchEngineId) => void
}): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 12,
        marginBottom: 22,
      }}
    >
      {LAUNCH_ENGINES.map((engine) => {
        const active = engine.id === selected
        const { available, reason } = engine.resolveAvailability(chainId)
        return (
          <button
            key={engine.id}
            type="button"
            onClick={() => onSelect(engine.id)}
            style={{
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '14px 15px',
              cursor: 'pointer',
              borderRadius: 14,
              border: `1px solid ${active ? terminalColors.brandGreen : terminalColors.line}`,
              background: active ? terminalColors.greenBg : terminalColors.bg,
              boxShadow: active ? `inset 0 0 0 1px ${terminalColors.brandGreen}` : 'none',
              opacity: available ? 1 : 0.72,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: active ? terminalColors.greenDeep : terminalColors.ink,
                }}
              >
                {engine.label}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  padding: '2px 6px',
                  borderRadius: 999,
                  whiteSpace: 'nowrap',
                  color: available ? terminalColors.greenDeep : terminalColors.ink3Alt,
                  background: available ? terminalColors.greenBg : terminalColors.panel2,
                  border: `1px solid ${available ? terminalColors.greenBorder : terminalColors.line}`,
                }}
              >
                {available ? 'Live here' : 'Unavailable'}
              </span>
            </div>

            <span style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.45, color: terminalColors.ink3Alt }}>
              {engine.description}
            </span>

            {!available && reason ? (
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, color: terminalColors.warn }}>
                {reason}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
