/**
 * HookSwap Terminal — shared per-chain composition helpers for the Ledger analytics
 * views (Locker / Vesting).
 *
 * Builds an honest, stackable per-chain series from the indexer's daily `tvl-history`
 * snapshots. DATA POLICY (facts-only): USD (`tvlUsd`) is OMITTED by the indexer when a
 * chain can't be priced. To avoid fabricating $0, a USD stack is only produced when the
 * global total is priced across ≥ 2 snapshots; otherwise it falls back to the ALWAYS-real
 * per-chain COUNT series (locks / schedules), captioned so a count is never read as USD —
 * mirroring `LedgerTvlChart`'s established USD→count fallback. Chains that are entirely
 * zero over the window are dropped (nothing real to draw). Returns `undefined` when there
 * isn't enough real data for a stacked chart (< 2 snapshots, or nothing non-zero).
 */
import { terminalColors } from '~/terminal/theme/tokens'

/** Categorical series palette — brand-green first, then the Atlas accent set. */
export const LEDGER_SERIES_COLORS = [
  terminalColors.brandGreen,
  terminalColors.accentIndigo,
  terminalColors.accentBlue,
  terminalColors.accentTeal,
  terminalColors.accentPurple,
  terminalColors.accentPink,
  terminalColors.warn,
] as const

/** A stacked series ready for `LedgerTvlChart`'s stack mode. */
export interface LedgerStack {
  /** X-axis labels (snapshot dates), shared across every series. */
  xLabels: string[]
  /** One band per chain, aligned to `xLabels` (values.length === xLabels.length). */
  series: { key: string; label: string; color: string; values: number[] }[]
  /** Caption naming what's plotted (so a count band is never read as dollars). */
  caption: string
  /** `usd` → values are USD; `count` → values are counts (never render with a $). */
  mode: 'usd' | 'count'
}

interface PerChainLike {
  chainId: number
  name: string
  tvlUsd?: number
}

interface SnapshotLike<PC extends PerChainLike> {
  dateISO: string
  totalTvlUsd?: number
  perChain: PC[]
}

/**
 * Build a per-chain stacked series from daily snapshots.
 *
 * @param points   The `/tvl-history` snapshots (undefined while loading).
 * @param countOf  Extracts the ALWAYS-present per-chain count from a perChain entry
 *                 (e.g. `pc => pc.totalLocks`) — used for the honest count fallback.
 * @param captions Caption text for the USD vs count mode.
 */
export function buildPerChainStack<PC extends PerChainLike>(
  points: SnapshotLike<PC>[] | undefined,
  countOf: (pc: PC) => number,
  captions: { usd: string; count: string },
): LedgerStack | undefined {
  if (!points || points.length < 2) {
    return undefined
  }
  const xLabels = points.map((p) => p.dateISO)

  // USD mode only when the global total is genuinely priced across ≥ 2 snapshots —
  // otherwise a per-chain USD stack would fabricate $0 for unpriced chains.
  const pricedSnaps = points.filter((p) => typeof p.totalTvlUsd === 'number' && Number.isFinite(p.totalTvlUsd))
  const usdMode = pricedSnaps.length >= 2

  // Chain ordering: newest snapshot first so the largest current chains stack at the bottom.
  const order: { id: number; name: string }[] = []
  const seen = new Set<number>()
  for (let i = points.length - 1; i >= 0; i--) {
    for (const pc of points[i].perChain) {
      if (!seen.has(pc.chainId)) {
        seen.add(pc.chainId)
        order.push({ id: pc.chainId, name: pc.name })
      }
    }
  }

  const valueAt = (p: SnapshotLike<PC>, chainId: number): number => {
    const pc = p.perChain.find((c) => c.chainId === chainId)
    if (!pc) {
      return 0
    }
    if (usdMode) {
      return typeof pc.tvlUsd === 'number' && Number.isFinite(pc.tvlUsd) ? pc.tvlUsd : 0
    }
    const c = countOf(pc)
    return Number.isFinite(c) ? c : 0
  }

  const series = order
    .map((c, i) => ({
      key: String(c.id),
      label: c.name,
      color: LEDGER_SERIES_COLORS[i % LEDGER_SERIES_COLORS.length],
      values: points.map((p) => valueAt(p, c.id)),
    }))
    // Drop chains with nothing real over the whole window.
    .filter((s) => s.values.some((v) => v > 0))

  if (series.length === 0) {
    return undefined
  }

  return {
    xLabels,
    series,
    caption: usdMode ? captions.usd : captions.count,
    mode: usdMode ? 'usd' : 'count',
  }
}
