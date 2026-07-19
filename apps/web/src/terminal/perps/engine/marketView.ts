/**
 * HookSwapPerps — unified market view + display-label resolution.
 *
 * The desk lists markets from two REAL sources (never fabricated):
 *   1. the matching engine `GET /markets` (primary — carries live status), and
 *   2. the on-chain MarketRegistry (fallback — works even if the engine is down).
 * Both are normalized into a single `PerpMarketView` the panels consume.
 *
 * marketId is stored on-chain as `keccak256(utf8Bytes(label))` — the human label is
 * NOT recoverable from the hash. To show a readable symbol we (in order):
 *   • use an engine-provided `symbol`/`label` if present (tolerated extra field);
 *   • else match the marketId hash against the static instrument catalog
 *     (keccak of each known symbol) — an exact, non-fabricated mapping;
 *   • else, if marketId is already a short label (not a 0x66 hash), use it as-is;
 *   • else fall back to a shortened marketId / market address.
 * Nothing here invents a price — only identity/label resolution.
 */
import { keccak256, toBytes } from 'viem'
import type { Address } from '~/chains'
import type { EngineMarket } from '~/terminal/perps/engine/client'
import { PERP_INSTRUMENTS } from '~/terminal/screens/perps/perpsCatalog'

/** Normalized market the whole desk keys off. */
export interface PerpMarketView {
  /** Market clone address — the EIP-712 verifyingContract for this market's orders. */
  address: Address
  /** Raw registry marketId (hash or label, as provided). */
  marketId: string
  /** Human display symbol, e.g. "BTC-PERP". */
  label: string
  /** Base asset ticker (size unit / ticket buttons), e.g. "BTC". */
  base: string
  /** Collateral / settlement token address. */
  collateral: Address
  /** Registry tier: 0 = curated, 1 = permissionless (undefined if unknown). */
  tier?: number
  /** Registry status: 0 = active, 1 = paused, 2 = delisted (undefined if unknown). */
  status?: number
  /** Max leverage from the catalog when known; on-chain cap is read per-selection. */
  catalogMaxLeverage?: number
  /** Where this row came from. */
  source: 'engine' | 'chain'
}

/** keccak256(utf8Bytes(symbol)) → catalog instrument, for reverse-resolving a marketId hash. */
const CATALOG_BY_HASH = new Map(
  PERP_INSTRUMENTS.map((inst) => [keccak256(toBytes(inst.symbol)).toLowerCase(), inst] as const),
)
const CATALOG_BY_SYMBOL = new Map(PERP_INSTRUMENTS.map((inst) => [inst.symbol.toUpperCase(), inst] as const))

function shorten(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
}

function isHash66(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s)
}

function coerceEnum(v: number | string | undefined): number | undefined {
  if (v === undefined) {
    return undefined
  }
  if (typeof v === 'number') {
    return v
  }
  const n = Number(v)
  if (Number.isFinite(n)) {
    return n
  }
  const label = v.toLowerCase()
  if (label === 'curated' || label === 'active') {
    return 0
  }
  if (label === 'permissionless' || label === 'paused') {
    return 1
  }
  if (label === 'delisted') {
    return 2
  }
  return undefined
}

/**
 * Resolve a display label + base ticker for a marketId + market address.
 * `explicit` is an optional engine-provided symbol/label (used verbatim when present).
 */
export function resolveMarketLabel(
  marketId: string,
  marketAddress: string,
  explicit?: string,
): { label: string; base: string; catalogMaxLeverage?: number } {
  if (explicit && explicit.trim() !== '') {
    const bySym = CATALOG_BY_SYMBOL.get(explicit.trim().toUpperCase())
    return {
      label: explicit.trim(),
      base: bySym?.base ?? explicit.trim().replace(/[-/].*$/, ''),
      catalogMaxLeverage: bySym?.maxLeverage,
    }
  }
  if (isHash66(marketId)) {
    const hit = CATALOG_BY_HASH.get(marketId.toLowerCase())
    if (hit) {
      return { label: hit.symbol, base: hit.base, catalogMaxLeverage: hit.maxLeverage }
    }
    return { label: `MKT ${shorten(marketAddress)}`, base: 'BASE' }
  }
  // marketId looks like a plain label already.
  const bySym = CATALOG_BY_SYMBOL.get(marketId.trim().toUpperCase())
  return {
    label: marketId.trim() || `MKT ${shorten(marketAddress)}`,
    base: bySym?.base ?? (marketId.trim().replace(/[-/].*$/, '') || 'BASE'),
    catalogMaxLeverage: bySym?.maxLeverage,
  }
}

/** Normalize an engine market row into a `PerpMarketView`. */
export function fromEngineMarket(m: EngineMarket): PerpMarketView {
  const { label, base, catalogMaxLeverage } = resolveMarketLabel(m.marketId, m.market, m.symbol ?? m.label)
  return {
    address: m.market as Address,
    marketId: m.marketId,
    label,
    base,
    collateral: m.collateral as Address,
    tier: coerceEnum(m.tier),
    status: coerceEnum(m.status),
    catalogMaxLeverage,
    source: 'engine',
  }
}

/** Normalize an on-chain registry row into a `PerpMarketView`. */
export function fromChainMarket(row: {
  market: Address
  collateral: Address
  marketId: string
  tier: number
  status: number
}): PerpMarketView {
  const { label, base, catalogMaxLeverage } = resolveMarketLabel(row.marketId, row.market)
  return {
    address: row.market,
    marketId: row.marketId,
    label,
    base,
    collateral: row.collateral,
    tier: row.tier,
    status: row.status,
    catalogMaxLeverage,
    source: 'chain',
  }
}
