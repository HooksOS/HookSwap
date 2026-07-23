/**
 * HookSwap Terminal — Quick Launch engine (RHLaunchpad direct-to-v4). Robinhood-only.
 *
 * One `hookos.quickLaunch.launch(...)` deploys the token, opens its v4 pool (shared LaunchHook),
 * and single-sided-seeds 100% of supply — no bonding curve. The live USD-pegged launch fee is read
 * via `getEffectiveLaunchFee` (shown before signing; the SDK sends it as msg.value). Availability is
 * SDK-resolved (`quickLaunch.available`) → the panel gates honestly off Robinhood. Optional dev buy
 * runs as a separate `quickLaunch.devBuy` after the pool's 3-minute sniper guard.
 */
import { useState } from 'react'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { ExplorerDataType } from 'uniswap/src/utils/linking'
import { ExplorerAddress } from '~/terminal/components/ExplorerAddress'
import { StatCard } from '~/terminal/components/StatCard'
import {
  fmtWei,
  onlyDecimal,
  onlyDigits,
  FieldLabel,
  NotDeployedNote,
  Notice,
  Panel,
  PrimaryButton,
  SummaryRow,
  TextField,
  TwoColumn,
  SANS,
} from '~/terminal/launchpad/primitives'
import { useQuickLaunch, type QuickLaunchInput } from '~/terminal/launchpad/useQuickLaunch'
import { terminalColors } from '~/terminal/theme/tokens'
import type { Address } from '~/chains'

const EMPTY_INPUT: QuickLaunchInput = {
  name: '',
  symbol: '',
  supplyTokens: '',
  targetMcapUsd: '',
  devBuyEth: '',
}

export function QuickLaunchEngine({
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
  const [input, setInput] = useState<QuickLaunchInput>(EMPTY_INPUT)

  const set = <K extends keyof QuickLaunchInput>(key: K, value: QuickLaunchInput[K]): void => {
    setInput((prev) => ({ ...prev, [key]: value }))
  }

  const state = useQuickLaunch({ chainId, owner, input })
  const deployed = state.ready

  const feeLabel = state.feeWei !== undefined ? `${fmtWei(state.feeWei)} ETH` : '—'

  const onPrimary = (): void => {
    if (!connected) {
      onConnect()
      return
    }
    if (state.isDone) {
      state.reset()
      setInput(EMPTY_INPUT)
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
    if (state.isConfirming) {
      return 'Confirm & launching…'
    }
    return 'Quick launch'
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
    return !state.canLaunch
  })()

  const symbolValue = input.symbol.trim() !== '' ? input.symbol.trim().toUpperCase() : '—'
  const supplyValue = input.supplyTokens.trim() !== '' ? input.supplyTokens.trim() : '—'
  const mcapValue = input.targetMcapUsd.trim() !== '' ? `$${input.targetMcapUsd.trim()}` : 'default'

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatCard size="lg" label="Symbol" value={symbolValue} />
        <StatCard size="lg" label="Supply (tokens)" value={supplyValue} />
        <StatCard size="lg" label="Target MCap" value={deployed ? mcapValue : '—'} />
        <StatCard size="lg" label="Launch fee" value={deployed ? feeLabel : '—'} />
      </div>

      <TwoColumn
        left={
          <>
            <Panel title="01 · Token" meta={deployed ? undefined : ['not deployed']}>
              {!deployed ? (
                <NotDeployedNote chainLabel={chainLabel} message="Quick Launch (RHLaunchpad) is live on Robinhood Chain only. Switch to Robinhood to use it." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <FieldLabel>Name</FieldLabel>
                    <TextField value={input.name} onChange={(v) => set('name', v)} placeholder="Pepe" maxLength={64} />
                  </div>
                  <div>
                    <FieldLabel>Symbol</FieldLabel>
                    <TextField value={input.symbol} onChange={(v) => set('symbol', v.toUpperCase())} placeholder="PEPE" mono maxLength={16} />
                  </div>
                  <div>
                    <FieldLabel>Supply (whole tokens)</FieldLabel>
                    <TextField
                      value={input.supplyTokens}
                      onChange={(v) => set('supplyTokens', onlyDigits(v))}
                      placeholder="1000000000"
                      mono
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <FieldLabel>Target opening market cap (USD, optional)</FieldLabel>
                    <TextField
                      value={input.targetMcapUsd}
                      onChange={(v) => set('targetMcapUsd', onlyDigits(v))}
                      placeholder="5500 (default)"
                      mono
                      inputMode="numeric"
                    />
                  </div>
                </div>
              )}
            </Panel>

            {deployed ? (
              <Panel title="02 · Dev buy (optional)">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <FieldLabel>First-candle buy (ETH)</FieldLabel>
                    <TextField value={input.devBuyEth} onChange={(v) => set('devBuyEth', onlyDecimal(v))} placeholder="0.0" mono inputMode="decimal" />
                  </div>
                  <Notice tone="muted">
                    RHLaunchpad arms a 3-minute anti-snipe guard on every new pool. The dev buy becomes available below
                    once that guard elapses.
                  </Notice>
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
            <SummaryRow label="Target MCap" value={deployed ? mcapValue : '—'} />
            <SummaryRow label="Launch fee" value={deployed ? feeLabel : '—'} valueColor={deployed ? terminalColors.ink : terminalColors.faint} />
            <SummaryRow
              label="Creator"
              value={connected && owner ? <ExplorerAddress address={owner} chainId={chainId} fontSize={12.5} fontWeight={500} /> : '—'}
            />
            <SummaryRow label="Network" value={deployed ? chainLabel : 'Robinhood only'} />

            <PrimaryButton label={primaryLabel} onClick={onPrimary} disabled={primaryDisabled} />

            {state.isDone ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Notice tone="green">Launched — token deployed, v4 pool seeded single-sided.</Notice>
                <SummaryRow label="Token" value={<ExplorerAddress address={state.createdToken} chainId={chainId} type={ExplorerDataType.TOKEN} fontSize={12.5} fontWeight={500} />} />
                <SummaryRow
                  label="Opened at MCap"
                  value={state.derivedMcapUsd !== undefined ? `$${state.derivedMcapUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                />
                {input.devBuyEth.trim() !== '' && input.devBuyEth.trim() !== '0' ? (
                  <>
                    <PrimaryButton
                      label={state.devBuyHash ? 'Dev buy sent' : state.isBuying ? 'Buying…' : `Dev buy ${input.devBuyEth} ETH`}
                      onClick={() => void state.devBuy()}
                      disabled={state.isBuying || Boolean(state.devBuyHash)}
                      variant="outline"
                    />
                    {state.devBuyHash ? (
                      <SummaryRow label="Dev buy tx" value={<ExplorerAddress address={state.devBuyHash} chainId={chainId} type={ExplorerDataType.TRANSACTION} fontSize={12.5} fontWeight={500} />} />
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : state.error ? (
              <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 10, lineHeight: 1.5 }}>
                {state.error}
              </div>
            ) : deployed ? (
              <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
                One transaction deploys the token and seeds a concentrated v4 position holding the full supply. No bonding
                curve, no creator pre-allocation.
              </div>
            ) : null}
          </Panel>
        }
      />
    </>
  )
}
