/**
 * HookSwap Terminal — the four canonical Uniswap-v3 fee tiers.
 *
 * FACTS-ONLY: `FeeAmount` + `TICK_SPACINGS` come straight from `@uniswap/v3-sdk`
 * (the deployed own-stack factory enables exactly these four tiers with these tick
 * spacings). The "best for" hint is standard UX guidance, not on-chain data.
 */
import { FeeAmount, TICK_SPACINGS } from '@uniswap/v3-sdk'

export interface FeeTierOption {
  /** Fee amount in hundredths of a bip (e.g. 3000 = 0.30%). */
  fee: FeeAmount
  /** Human label, e.g. "0.30%". */
  label: string
  /** Short "best for" hint. */
  hint: string
  /** Factory-enabled tick spacing for this tier. */
  tickSpacing: number
}

/** Format a raw fee amount (hundredths of a bip) as a percent string. */
export function formatFeePercent(fee: FeeAmount | number): string {
  // 1_000_000 hundredths-of-a-bip == 100%.
  const pct = (Number(fee) / 10_000).toString()
  return `${pct}%`
}

/** The four standard tiers, in ascending order. */
export const V3_FEE_TIERS: FeeTierOption[] = [
  { fee: FeeAmount.LOWEST, label: formatFeePercent(FeeAmount.LOWEST), hint: 'Best for very stable pairs', tickSpacing: TICK_SPACINGS[FeeAmount.LOWEST] },
  { fee: FeeAmount.LOW, label: formatFeePercent(FeeAmount.LOW), hint: 'Best for stable pairs', tickSpacing: TICK_SPACINGS[FeeAmount.LOW] },
  { fee: FeeAmount.MEDIUM, label: formatFeePercent(FeeAmount.MEDIUM), hint: 'Best for most pairs', tickSpacing: TICK_SPACINGS[FeeAmount.MEDIUM] },
  { fee: FeeAmount.HIGH, label: formatFeePercent(FeeAmount.HIGH), hint: 'Best for exotic pairs', tickSpacing: TICK_SPACINGS[FeeAmount.HIGH] },
]

/** The default tier when nothing is selected (matches Uniswap's 0.30% default). */
export const DEFAULT_FEE_TIER = FeeAmount.MEDIUM
