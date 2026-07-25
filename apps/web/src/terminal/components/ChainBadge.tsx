import type { CSSProperties } from 'react'
import { ChainLogo } from 'components/Logo/ChainLogo'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import type { UniverseChainId } from 'uniswap/src/features/chains/types'

/**
 * Chain badge for aggregated, all-chain lists.
 *
 * Every multichain surface shows rows from several chains at once, so each row has
 * to say which chain it belongs to — otherwise two identically-named farms or locks
 * on different chains are indistinguishable, and a "Claim" button is ambiguous.
 *
 * This was inline JSX in VestingScheduleCard (the first multichain screen) and is
 * extracted here because every other aggregated list needs the identical thing.
 * Several screens already print a bare `getChainLabel(...)` string with no logo;
 * pointing them at this keeps one visual language across the stack.
 *
 * `size="sm"` is for dense table rows, `"md"` matches the original card badge.
 */
export function ChainBadge({
  chainId,
  size = 'md',
  showLabel = true,
  style,
}: {
  chainId: UniverseChainId | number | undefined
  size?: 'sm' | 'md'
  /** Logo-only (with the name still in the tooltip) for very tight columns. */
  showLabel?: boolean
  style?: CSSProperties
}): JSX.Element | null {
  // Render nothing rather than an "unknown chain" chip: a row with no chain is a
  // data bug, and a placeholder badge would disguise it.
  if (chainId === undefined || chainId === null) {
    return null
  }

  const label = getChainLabel(chainId as UniverseChainId)
  const sm = size === 'sm'

  return (
    <span
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: sm ? 4 : 5,
        padding: showLabel ? (sm ? '1px 6px 1px 3px' : '2px 7px 2px 4px') : sm ? 1 : 2,
        borderRadius: 999,
        border: `1px solid ${terminalColors.line}`,
        background: terminalColors.panel2,
        fontFamily: terminalFonts.mono,
        fontSize: sm ? 10 : 10.5,
        color: terminalColors.ink3,
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
        ...style,
      }}
    >
      <ChainLogo chainId={chainId as UniverseChainId} size={sm ? 12 : 13} />
      {showLabel ? label : null}
    </span>
  )
}
