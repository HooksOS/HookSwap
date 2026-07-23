// Shared clickable on-chain-address / tx link for the Terminal.
//
// Every contract, token, pool, market, or tx hash shown in the UI should route
// through this component so it is ALWAYS clickable and opens the correct
// per-chain block explorer in a NEW TAB (e.g. Stable 988 → stablescan.xyz,
// Robinhood → robinscan.io). The explorer URL is resolved from the chain's
// canonical `explorer.url` via `getExplorerLink`, so a newly-wired chain becomes
// linkable automatically — no per-screen edits.
//
// When the chain has no explorer / is unknown (`getExplorerLink` returns ''),
// it degrades gracefully to non-clickable mono text instead of a dead link.
import { CSSProperties, useMemo } from 'react'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { ExplorerDataType, getExplorerLink } from 'uniswap/src/utils/linking'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono

/** Canonical short form `0x1234…abcd` (— when empty). Reuse everywhere. */
export function shortAddr(a?: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—'
}

export type ExplorerAddressProps = {
  /** Address or tx hash. Falsy → renders the em-dash placeholder, no link. */
  address?: string
  /** Chain the address lives on. Undefined → non-clickable (no explorer known). */
  chainId?: number
  /** Explorer path type. Defaults to ADDRESS; pass TOKEN / TRANSACTION as needed. */
  type?: ExplorerDataType
  /** Show `0x1234…abcd` (default) vs the full string. */
  short?: boolean
  /** Override the visible label (e.g. a token symbol) while still linking the address. */
  label?: string
  /** Link/text colour. Defaults to brand green when clickable, ink when not. */
  color?: string
  fontSize?: number
  fontWeight?: number
  /** Extra style overrides merged last. */
  style?: CSSProperties
  /** Title/tooltip; defaults to the full address. */
  title?: string
}

/**
 * Renders an address/tx as a block-explorer link (new tab) when the chain is
 * known, otherwise as plain mono text. Single source of truth for address links.
 */
export function ExplorerAddress({
  address,
  chainId,
  type = ExplorerDataType.ADDRESS,
  short = true,
  label,
  color,
  fontSize = 12,
  fontWeight = 500,
  style,
  title,
}: ExplorerAddressProps): JSX.Element {
  const href = useMemo(() => {
    if (!address || chainId === undefined) {
      return ''
    }
    try {
      return getExplorerLink({ chainId: chainId as UniverseChainId, data: address, type })
    } catch {
      return ''
    }
  }, [address, chainId, type])

  const text = label ?? (short ? shortAddr(address) : address ?? '—')
  const baseStyle: CSSProperties = {
    fontFamily: MONO,
    fontSize,
    fontWeight,
    whiteSpace: 'nowrap',
  }

  if (!href) {
    return (
      <span style={{ ...baseStyle, color: color ?? terminalColors.ink, ...style }} title={title ?? address}>
        {text}
      </span>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? address}
      style={{ ...baseStyle, color: color ?? terminalColors.brandGreen, textDecoration: 'none', ...style }}
    >
      {text}
    </a>
  )
}
