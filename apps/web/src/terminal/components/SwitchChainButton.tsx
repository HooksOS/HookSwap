/**
 * HookSwap Terminal — shared "Switch to <chain>" CTA for tool screens.
 *
 * When a wallet is connected on a chain where a self-service tool ISN'T deployed but the
 * tool IS live on another HookSwap chain, this renders an actionable switch button next to
 * the honest "not available on this network" copy. Mirrors the wrong-chain switch already
 * used by SwapScreen / FarmDetailScreen / VestingScheduleDetailScreen (via `useSelectChain`)
 * — factored out so every tool screen reuses ONE control instead of duplicating it.
 *
 * DATA POLICY (facts-only): the switch target is derived from the tool's REAL per-chain
 * address map / SDK availability (`supportedChainIdsFromMap` / an engine's `supportedChains`),
 * so we only ever offer a chain the tool is genuinely deployed on. When nothing else is
 * supported, `pickSwitchTargetChain` returns `undefined` and the caller keeps the plain
 * honest gate (no button) — never a dead switch.
 */
import type { CSSProperties } from 'react'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { useSelectChain } from '~/hooks/useSelectChain'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

/**
 * Pick a sensible chain to switch to for a tool that isn't deployed on the connected chain
 * but IS live elsewhere. Prefers Robinhood (HookSwap's launch chain) when it's supported,
 * else the first supported chain; never returns the chain the wallet is already on.
 * `undefined` when the tool has no other supported chain (caller leaves the honest gate).
 */
export function pickSwitchTargetChain(
  supported: readonly UniverseChainId[],
  connectedChainId?: number,
): UniverseChainId | undefined {
  const options = supported.filter((c) => c !== connectedChainId)
  if (options.length === 0) {
    return undefined
  }
  return options.includes(UniverseChainId.Robinhood) ? UniverseChainId.Robinhood : options[0]
}

/** Supported UniverseChainIds from a `Partial<Record<UniverseChainId, unknown>>` address map. */
export function supportedChainIdsFromMap(map: Partial<Record<UniverseChainId, unknown>>): UniverseChainId[] {
  const out: UniverseChainId[] = []
  for (const key of Object.keys(map)) {
    const id = Number(key) as UniverseChainId
    if (map[id] !== undefined) {
      out.push(id)
    }
  }
  return out
}

/**
 * A "Switch to <chain>" CTA shown when the connected wallet is on a chain where the tool
 * isn't deployed, but the tool IS live on `target`. DAYSIGNAL-themed, self-contained.
 */
export function SwitchChainButton({
  target,
  note,
  style,
}: {
  target: UniverseChainId
  /** Optional one-line explainer above the button (keep the honest "not deployed" copy nearby). */
  note?: string
  style?: CSSProperties
}): JSX.Element {
  const selectChain = useSelectChain()
  const label = getChainLabel(target)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, ...style }}>
      {note !== undefined ? (
        <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3Alt, lineHeight: 1.5 }}>{note}</div>
      ) : null}
      <button
        type="button"
        onClick={() => void selectChain(target)}
        style={{
          width: '100%',
          fontFamily: MONO,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontSize: 12.5,
          fontWeight: 600,
          color: terminalColors.btnInk,
          background: terminalColors.brandGreen,
          border: 'none',
          padding: '11px 0',
          borderRadius: 11,
          cursor: 'pointer',
        }}
      >
        Switch to {label}
      </button>
    </div>
  )
}
