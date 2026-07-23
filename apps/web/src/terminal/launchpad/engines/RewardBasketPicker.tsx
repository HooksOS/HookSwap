/**
 * HookSwap Terminal — reward-basket picker for the Stock Reward engine.
 *
 * The creator multi-selects tokenized stocks and sets each one's weight; weights are entered as
 * whole percents and MUST total 100% (→ 10000 bps, the vault's setBasket invariant). Each stock
 * shows a live-liquidity vs. RFQ-only badge straight from `StockRef.liquidity` (no invented data).
 * "Equal weight" auto-balances the current selection via the SDK's `equalWeights` helper.
 */
import { equalWeights, WEIGHT_TOTAL_BPS, type StockRef } from '@hookos/sdk'
import { FieldLabel, MONO, Notice, SANS } from '~/terminal/launchpad/primitives'
import { terminalColors } from '~/terminal/theme/tokens'

/** A UI draft entry — a picked stock and its whole-percent weight. */
export interface BasketDraftEntry {
  symbol: string
  weightPct: number
}

export function totalWeightPct(draft: BasketDraftEntry[]): number {
  return draft.reduce((sum, d) => sum + (Number.isFinite(d.weightPct) ? d.weightPct : 0), 0)
}

/** Whether the draft is a valid basket: at least one stock and weights summing to exactly 100%. */
export function isBasketValid(draft: BasketDraftEntry[]): boolean {
  return draft.length > 0 && totalWeightPct(draft) === 100
}

function LiquidityBadge({ live }: { live: boolean }): JSX.Element {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding: '2px 6px',
        borderRadius: 999,
        color: live ? terminalColors.greenDeep : terminalColors.warn,
        background: live ? terminalColors.greenBg : terminalColors.warnBg,
        border: `1px solid ${live ? terminalColors.greenBorder : terminalColors.warn}`,
      }}
      title={live ? 'A live on-chain pool exists — buyable today' : 'No on-chain pool yet — filled via 0x RFQ'}
    >
      {live ? 'Live liquidity' : 'RFQ only'}
    </span>
  )
}

export function RewardBasketPicker({
  universe,
  draft,
  onChange,
}: {
  universe: StockRef[]
  draft: BasketDraftEntry[]
  onChange: (next: BasketDraftEntry[]) => void
}): JSX.Element {
  const selected = new Map(draft.map((d) => [d.symbol, d.weightPct]))

  const toggle = (symbol: string): void => {
    if (selected.has(symbol)) {
      onChange(draft.filter((d) => d.symbol !== symbol))
    } else {
      onChange([...draft, { symbol, weightPct: 0 }])
    }
  }

  const setWeight = (symbol: string, weightPct: number): void => {
    onChange(draft.map((d) => (d.symbol === symbol ? { ...d, weightPct } : d)))
  }

  const balanceEqually = (): void => {
    if (draft.length === 0) {
      return
    }
    const balanced = equalWeights(draft.map((d) => d.symbol))
    onChange(balanced.map((b) => ({ symbol: b.symbol, weightPct: b.weightPct })))
  }

  const total = totalWeightPct(draft)
  const totalOk = total === 100 && draft.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FieldLabel>Reward stocks — pick one or more; weights must total 100%</FieldLabel>

      {universe.length === 0 ? (
        <Notice tone="muted">No reward stocks are available on this network.</Notice>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {universe.map((stock) => {
            const isSelected = selected.has(stock.symbol)
            const weight = selected.get(stock.symbol) ?? 0
            return (
              <div
                key={stock.symbol}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: `1px solid ${isSelected ? terminalColors.greenBorder : terminalColors.line}`,
                  background: isSelected ? terminalColors.greenBg : terminalColors.panel,
                  borderRadius: 11,
                  padding: '9px 12px',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(stock.symbol)}
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    borderRadius: 5,
                    border: `1.5px solid ${isSelected ? terminalColors.brandGreen : terminalColors.line}`,
                    background: isSelected ? terminalColors.brandGreen : 'transparent',
                    color: terminalColors.btnInk,
                    fontSize: 12,
                    lineHeight: '14px',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  aria-label={isSelected ? `Remove ${stock.symbol}` : `Add ${stock.symbol}`}
                >
                  {isSelected ? '✓' : ''}
                </button>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: terminalColors.ink }}>
                      {stock.symbol}
                    </span>
                    <LiquidityBadge live={stock.liquidity} />
                  </div>
                  <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.ink3Alt, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {stock.name}
                  </div>
                </div>

                {isSelected ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={weight}
                      onChange={(e) => setWeight(stock.symbol, Number(e.target.value))}
                      style={{ width: 96, accentColor: terminalColors.brandGreen }}
                    />
                    <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: terminalColors.ink, width: 40, textAlign: 'right' }}>
                      {weight}%
                    </span>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button
          type="button"
          onClick={balanceEqually}
          disabled={draft.length === 0}
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: draft.length === 0 ? terminalColors.faint : terminalColors.greenDeep,
            background: 'transparent',
            border: `1px solid ${draft.length === 0 ? terminalColors.line : terminalColors.greenBorder}`,
            borderRadius: 8,
            padding: '6px 12px',
            cursor: draft.length === 0 ? 'default' : 'pointer',
          }}
        >
          Equal weight
        </button>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: totalOk ? terminalColors.greenDeep : terminalColors.redDown }}>
          Total {total}% {totalOk ? '✓' : `/ 100%`}
        </span>
      </div>

      <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, lineHeight: 1.5 }}>
        Weights convert to basis points ({WEIGHT_TOTAL_BPS} bps = 100%). The allocation is set on the StockRewardVault
        after launch; the launch transaction itself configures the buy/sell tax + seeds the pool.
      </div>
    </div>
  )
}
