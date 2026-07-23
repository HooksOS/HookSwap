/**
 * HookSwap Terminal — Stock Reward engine (StockRewardLauncherV4). Robinhood / RWA only.
 *
 * A taxed fair launch whose 2–5% buy/sell tax (charged in WETH by StockTaxHook) buys REAL tokenized
 * stocks and drips them to holders each epoch. SDK calls: `hookos.stock.launch(...)` +
 * `getRewardUniverse` / `previewFeeSplit`. Availability is SDK-resolved (`stock.available`) → the
 * panel gates honestly off Robinhood. The reward-basket allocation is chosen in RewardBasketPicker.
 */
import { useState } from 'react'
import { DEFAULT_REWARD_SYMBOL, draftToBasketEntries } from '@hookos/sdk'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { ExplorerDataType } from 'uniswap/src/utils/linking'
import { ExplorerAddress } from '~/terminal/components/ExplorerAddress'
import { StatCard } from '~/terminal/components/StatCard'
import {
  onlyDecimal,
  onlyDigits,
  FieldLabel,
  NotDeployedNote,
  Notice,
  Panel,
  PrimaryButton,
  SummaryRow,
  TextField,
  ToggleRow,
  TwoColumn,
  SANS,
} from '~/terminal/launchpad/primitives'
import { useStockRewardLaunch, type StockRewardInput } from '~/terminal/launchpad/useStockRewardLaunch'
import { RewardBasketPicker, isBasketValid, type BasketDraftEntry } from '~/terminal/launchpad/engines/RewardBasketPicker'
import { terminalColors } from '~/terminal/theme/tokens'
import type { Address } from '~/chains'

const TAX_OPTIONS = [
  { label: '2%', value: '200' },
  { label: '3%', value: '300' },
  { label: '4%', value: '400' },
  { label: '5%', value: '500' },
]

const EMPTY_INPUT: StockRewardInput = {
  name: '',
  symbol: '',
  supplyTokens: '',
  buyBps: 400,
  sellBps: 400,
  targetMcapUsd: '',
  devBuyEth: '',
}

function pctOfBps(bps: number | undefined): string {
  if (bps === undefined) {
    return '—'
  }
  return `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

export function StockRewardEngine({
  chainId,
  connected,
  owner,
  onConnect,
}: {
  chainId: number
  connected: boolean
  owner?: Address
  onConnect: () => void
}): JSX.Element {
  const chainLabel = getChainLabel(chainId)
  const [input, setInput] = useState<StockRewardInput>(EMPTY_INPUT)
  const [basket, setBasket] = useState<BasketDraftEntry[]>([{ symbol: DEFAULT_REWARD_SYMBOL, weightPct: 100 }])

  const set = <K extends keyof StockRewardInput>(key: K, value: StockRewardInput[K]): void => {
    setInput((prev) => ({ ...prev, [key]: value }))
  }

  const state = useStockRewardLaunch({ chainId, owner, input })
  const deployed = state.ready
  const basketOk = isBasketValid(basket)
  // draftToBasketEntries drops unknown symbols + is the exact on-chain (bps) shape the vault takes.
  const basketEntries = basketOk ? draftToBasketEntries(basket) : []

  const onPrimary = (): void => {
    if (!connected) {
      onConnect()
      return
    }
    if (state.isDone) {
      state.reset()
      setInput(EMPTY_INPUT)
      setBasket([{ symbol: DEFAULT_REWARD_SYMBOL, weightPct: 100 }])
      return
    }
    void state.launch()
  }

  const primaryLabel = ((): string => {
    if (!deployed) {
      return 'Robinhood only'
    }
    if (!connected) {
      return 'Connect wallet to launch'
    }
    if (state.isDone) {
      return 'Launch another token'
    }
    if (state.validationError) {
      return state.validationError
    }
    if (!basketOk) {
      return 'Reward weights must total 100%'
    }
    if (state.isConfirming) {
      return 'Confirm & launching…'
    }
    return 'Launch stock-reward token'
  })()

  const primaryDisabled = ((): boolean => {
    if (!deployed) {
      return true
    }
    if (!connected) {
      return false
    }
    if (state.isDone) {
      return false
    }
    return !state.canLaunch || !basketOk
  })()

  const symbolValue = input.symbol.trim() !== '' ? input.symbol.trim().toUpperCase() : '—'
  const supplyValue = input.supplyTokens.trim() !== '' ? input.supplyTokens.trim() : '—'
  const rewardsLabel = basket.length === 0 ? '—' : basket.map((b) => `${b.symbol} ${b.weightPct}%`).join(' · ')

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatCard size="lg" label="Symbol" value={symbolValue} />
        <StatCard size="lg" label="Buy tax" value={pctOfBps(input.buyBps)} />
        <StatCard size="lg" label="Sell tax" value={pctOfBps(input.sellBps)} />
        <StatCard size="lg" label="To holders (buy)" value={deployed ? pctOfBps(state.buyFeeSplit?.holdersBps) : '—'} />
      </div>

      <TwoColumn
        left={
          <>
            <Panel title="01 · Token" meta={deployed ? undefined : ['not deployed']}>
              {!deployed ? (
                <NotDeployedNote chainLabel={chainLabel} message="Stock Reward launches are live on Robinhood Chain only (USDG-settled tokenized stocks). Switch to Robinhood to use it." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <FieldLabel>Name</FieldLabel>
                    <TextField value={input.name} onChange={(v) => set('name', v)} placeholder="Nvidia Rewards" maxLength={64} />
                  </div>
                  <div>
                    <FieldLabel>Symbol</FieldLabel>
                    <TextField value={input.symbol} onChange={(v) => set('symbol', v.toUpperCase())} placeholder="NVDAR" mono maxLength={16} />
                  </div>
                  <div>
                    <FieldLabel>Supply (whole tokens)</FieldLabel>
                    <TextField value={input.supplyTokens} onChange={(v) => set('supplyTokens', onlyDigits(v))} placeholder="1000000000" mono inputMode="numeric" />
                  </div>
                  <div>
                    <FieldLabel>Target opening market cap (USD, optional)</FieldLabel>
                    <TextField value={input.targetMcapUsd} onChange={(v) => set('targetMcapUsd', onlyDigits(v))} placeholder="5500 (default)" mono inputMode="numeric" />
                  </div>
                </div>
              )}
            </Panel>

            {deployed ? (
              <Panel title="02 · Tax">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <FieldLabel>Buy tax</FieldLabel>
                    <ToggleRow options={TAX_OPTIONS} value={String(input.buyBps)} onChange={(v) => set('buyBps', Number(v))} />
                  </div>
                  <div>
                    <FieldLabel>Sell tax</FieldLabel>
                    <ToggleRow options={TAX_OPTIONS} value={String(input.sellBps)} onChange={(v) => set('sellBps', Number(v))} />
                  </div>
                  <Notice tone="muted">
                    Tax is charged in WETH by the hook (sells are never honeypotted). Buy split — creator{' '}
                    {pctOfBps(state.buyFeeSplit?.creatorBps)}, flywheel {pctOfBps(state.buyFeeSplit?.flywheelBps)},
                    platform {pctOfBps(state.buyFeeSplit?.platformBps)}, holders {pctOfBps(state.buyFeeSplit?.holdersBps)}.
                  </Notice>
                </div>
              </Panel>
            ) : null}

            {deployed ? (
              <Panel title="03 · Reward basket">
                <RewardBasketPicker universe={state.rewardUniverse} draft={basket} onChange={setBasket} />
              </Panel>
            ) : null}

            {deployed ? (
              <Panel title="04 · Dev buy (optional)">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <FieldLabel>First-candle buy (ETH)</FieldLabel>
                    <TextField value={input.devBuyEth} onChange={(v) => set('devBuyEth', onlyDecimal(v))} placeholder="0.0" mono inputMode="decimal" />
                  </div>
                  <Notice tone="muted">The dev buy executes atomically inside the launch transaction.</Notice>
                </div>
              </Panel>
            ) : null}
          </>
        }
        right={
          <Panel title="Review" corners>
            <SummaryRow label="Name" value={input.name.trim() !== '' ? input.name.trim() : '—'} />
            <SummaryRow label="Symbol" value={symbolValue} />
            <SummaryRow label="Supply (tokens)" value={supplyValue} />
            <SummaryRow label="Buy / Sell tax" value={`${pctOfBps(input.buyBps)} / ${pctOfBps(input.sellBps)}`} />
            <SummaryRow label="Rewards" value={deployed ? rewardsLabel : '—'} valueColor={deployed && basketOk ? terminalColors.ink : terminalColors.faint} />
            <SummaryRow
              label="Creator"
              value={connected && owner ? <ExplorerAddress address={owner} chainId={chainId} fontSize={12.5} fontWeight={500} /> : '—'}
            />
            <SummaryRow label="Network" value={deployed ? chainLabel : 'Robinhood only'} />

            <PrimaryButton label={primaryLabel} onClick={onPrimary} disabled={primaryDisabled} />

            {state.isDone ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Notice tone="green">Launched — taxed token deployed + pool seeded. Configure the reward basket on the vault next.</Notice>
                <SummaryRow label="Token" value={<ExplorerAddress address={state.createdToken} chainId={chainId} type={ExplorerDataType.TOKEN} fontSize={12.5} fontWeight={500} />} />
                <SummaryRow label="Basket entries" value={String(basketEntries.length)} />
              </div>
            ) : state.error ? (
              <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 10, lineHeight: 1.5 }}>
                {state.error}
              </div>
            ) : deployed ? (
              <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
                No upfront launch fee — the protocol earns from the trading tax. The launch seeds the pool with 100% of
                supply; the reward-stock allocation is set on the StockRewardVault after launch.
              </div>
            ) : null}
          </Panel>
        }
      />
    </>
  )
}
