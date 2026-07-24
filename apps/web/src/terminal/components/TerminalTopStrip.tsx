import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { formatUnits } from 'viem'
import { useBlockNumber, useChainId, useGasPrice } from 'wagmi'
import { useAccount } from '~/hooks/useAccount'
import { useListTokens } from '~/features/Explore/state/listTokens/useListTokens'
import { TickerTape, type TickerItem } from '~/terminal/components/TickerTape'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { isHiddenTokenSymbol } from '~/terminal/utils/hiddenTokens'

/**
 * The Terminal "top": a live token ticker tape + a status strip (TOKEN FEED / GAS /
 * BLOCK / ROUTING), mounted as the TerminalShell `subBar` so EVERY inner screen
 * (swap, markets, perps, …) shows the same top as the landing/proposal — not just
 * the landing. Data-bound + honest: prices are live (test/seed tokens filtered);
 * GAS/BLOCK are read LIVE for the active wallet chain (wagmi useGasPrice /
 * useBlockNumber) and read "—" only while loading or if the RPC genuinely fails.
 */
const MONO = terminalFonts.mono

/** Gas price (wei bigint) → compact gwei label, e.g. "12.3" or "0.05". */
function fmtGwei(wei?: bigint): string {
  if (wei === undefined) {
    return '—'
  }
  const gwei = Number(formatUnits(wei, 9))
  if (!isFinite(gwei)) {
    return '—'
  }
  if (gwei >= 100) {
    return gwei.toFixed(0)
  }
  if (gwei >= 1) {
    return gwei.toFixed(1)
  }
  // Sub-gwei L2 fees (e.g. Ink/MegaETH 0.001 gwei) — keep enough precision to be non-zero.
  return gwei.toFixed(gwei >= 0.01 ? 2 : 4)
}

/** Latest block number → grouped label, e.g. "21,345,209". */
function fmtBlock(n?: bigint): string {
  return n === undefined ? '—' : n.toLocaleString('en-US')
}

function fmtUsd(v?: number): string {
  if (v == null || !isFinite(v)) {
    return '—'
  }
  if (v >= 1000) {
    return `$${(v / 1000).toFixed(2)}K`
  }
  if (v >= 1) {
    return `$${v.toFixed(2)}`
  }
  return `$${v.toFixed(4)}`
}

function fmtPct(v?: number): string {
  if (v == null || !isFinite(v)) {
    return '—'
  }
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

export function TerminalTopStrip(): JSX.Element {
  const navigate = useNavigate()
  const { topTokens, isLoading, isError } = useListTokens(undefined)

  // Active chain = the connected wallet's chain; when NO wallet is connected, fall back to wagmi's
  // config-level chain (`useChainId`, always defined) so GAS/BLOCK show for the default/viewed chain
  // instead of a permanent "—". They still read "—" only while the RPC query is loading or genuinely fails.
  const { chainId: walletChainId } = useAccount()
  const configChainId = useChainId()
  const chainId = walletChainId ?? configChainId
  const { data: gasPrice } = useGasPrice({ chainId })
  const { data: blockNumber } = useBlockNumber({ chainId, watch: true })

  const items: TickerItem[] = useMemo(() => {
    // Dedup so the same asset never appears twice on the compact tape (the list can
    // surface the same symbol more than once — e.g. across chains — rendering
    // "USDG · USDG"). A ticker needs one row per asset, so key on the uppercased symbol.
    const seen = new Set<string>()
    const out: TickerItem[] = []
    for (const t of topTokens ?? []) {
      if (isHiddenTokenSymbol(t.symbol) || typeof t.stats?.price !== 'number') {
        continue
      }
      const key = t.symbol.toUpperCase()
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      out.push({
        symbol: t.symbol,
        price: fmtUsd(t.stats?.price),
        change: t.stats?.priceChange1d != null ? fmtPct(t.stats.priceChange1d) : '—',
        up: t.stats?.priceChange1d == null ? null : t.stats.priceChange1d >= 0,
      })
      if (out.length >= 12) {
        break
      }
    }
    return out
  }, [topTokens])

  const feed = isError ? 'OFFLINE' : items.length ? 'LIVE' : isLoading ? 'SETTLING' : 'SETTLING'
  const emptyLabel = isError
    ? 'Token feed unavailable right now.'
    : isLoading
      ? 'Loading token feed…'
      : 'No token prices yet — builds as trading activity accrues.'

  return (
    <>
      <TickerTape items={items} emptyLabel={emptyLabel} onSelect={() => navigate('/swap')} />
      {/* Desktop-terminal status row (GAS/BLOCK are live for the active wallet chain via
          wagmi; ROUTING is dev-facing). Hidden on mobile via `.tm-topstrip-status` so the
          app-like view keeps only the live ticker above — see terminal.css. */}
      <div
        className="tm-topstrip-status"
        style={{
          borderBottom: `1px solid ${terminalColors.line}`,
          background: terminalColors.bg,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          height: 32,
          padding: '0 var(--tm-gutter)',
          fontFamily: MONO,
          fontSize: 11,
          color: terminalColors.ink3,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 6,
              height: 6,
              background: feed === 'LIVE' ? terminalColors.brandGreen : feed === 'OFFLINE' ? terminalColors.redDown : terminalColors.warn,
            }}
          />
          TOKEN FEED · {feed}
        </span>
        <span>GAS {fmtGwei(gasPrice)}{gasPrice !== undefined ? ' gwei' : ''}</span>
        <span>BLOCK {fmtBlock(blockNumber)}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: terminalColors.brandGreen }}>
          ● ROUTING · EMBED
        </span>
      </div>
    </>
  )
}
