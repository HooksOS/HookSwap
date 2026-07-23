/**
 * HookSwap Terminal — Bonding Curve engine (TokenFactory.createTokenAndCurve).
 *
 * Mint a token seeded onto a bonding curve that graduates to a real DEX pool once it fills.
 * SDK calls: `hookos.tokens.create(...)` (+ getEffectiveLaunchFee / getLaunchFeeUsd) and, for the
 * curve targets, `hookos.trading.getStartMcapUsd / getGraduationUsd`. Optional post-create dev buy
 * via `hookos.trading.buy`. Availability is SDK-resolved per chain (all 6 HookOS chains).
 */
import { useState } from 'react'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { ExplorerDataType } from 'uniswap/src/utils/linking'
import { ExplorerAddress } from '~/terminal/components/ExplorerAddress'
import { StatCard } from '~/terminal/components/StatCard'
import {
  fmtUsd,
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
  ToggleRow,
  TwoColumn,
  SANS,
} from '~/terminal/launchpad/primitives'
import { useBondingCurveLaunch, type BondingCurveInput } from '~/terminal/launchpad/useBondingCurveLaunch'
import { terminalColors } from '~/terminal/theme/tokens'
import type { Address } from '~/chains'

const EMPTY_INPUT: BondingCurveInput = {
  name: '',
  symbol: '',
  metadataURI: '',
  initialSupply: '',
  useExternalDex: true,
  devBuyEth: '',
}

export function BondingCurveEngine({
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
  const [input, setInput] = useState<BondingCurveInput>(EMPTY_INPUT)

  const set = <K extends keyof BondingCurveInput>(key: K, value: BondingCurveInput[K]): void => {
    setInput((prev) => ({ ...prev, [key]: value }))
  }

  const state = useBondingCurveLaunch({ chainId, owner, input })
  const deployed = state.ready

  const feeUsdLabel = fmtUsd(state.feeUsd)
  const feeWeiLabel = state.feeWei !== undefined ? `${fmtWei(state.feeWei)} ETH` : '—'

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
      return 'Not available on this network'
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
    return 'Launch on bonding curve'
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
  const supplyValue = input.initialSupply.trim() !== '' ? input.initialSupply.trim() : '—'
  const graduatesTo = input.useExternalDex ? 'External Uniswap v4' : 'Internal HookPool'

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatCard size="lg" label="Symbol" value={symbolValue} />
        <StatCard size="lg" label="Launch fee" value={deployed ? feeUsdLabel : '—'} />
        <StatCard size="lg" label="Start MCap" value={deployed ? fmtUsd(state.startMcapUsd) : '—'} />
        <StatCard size="lg" label="Graduation MCap" value={deployed ? fmtUsd(state.graduationUsd) : '—'} />
      </div>

      <TwoColumn
        left={
          <>
            <Panel title="01 · Token" meta={deployed ? undefined : ['not deployed']}>
              {!deployed ? (
                <NotDeployedNote chainLabel={chainLabel} message={`The bonding-curve factory is not deployed on ${chainLabel}.`} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <FieldLabel>Name</FieldLabel>
                    <TextField value={input.name} onChange={(v) => set('name', v)} placeholder="My Token" maxLength={64} />
                  </div>
                  <div>
                    <FieldLabel>Symbol</FieldLabel>
                    <TextField value={input.symbol} onChange={(v) => set('symbol', v.toUpperCase())} placeholder="MYT" mono maxLength={16} />
                  </div>
                  <div>
                    <FieldLabel>Metadata URI</FieldLabel>
                    <TextField value={input.metadataURI} onChange={(v) => set('metadataURI', v)} placeholder="ipfs://… or https://…" mono />
                  </div>
                  <div>
                    <FieldLabel>Initial supply (raw base units)</FieldLabel>
                    <TextField
                      value={input.initialSupply}
                      onChange={(v) => set('initialSupply', onlyDigits(v))}
                      placeholder="1000000000000000000000000000"
                      mono
                      inputMode="numeric"
                    />
                  </div>
                </div>
              )}
            </Panel>

            {deployed ? (
              <Panel title="02 · Graduation">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <FieldLabel>Graduate to</FieldLabel>
                    <ToggleRow
                      options={[
                        { label: 'External DEX (v4)', value: 'true' },
                        { label: 'Internal HookPool', value: 'false' },
                      ]}
                      value={String(input.useExternalDex)}
                      onChange={(v) => set('useExternalDex', v === 'true')}
                    />
                  </div>
                  <Notice tone="muted">
                    The token trades on its bonding curve until the graduation market cap is hit, then liquidity migrates
                    to {graduatesTo.toLowerCase()}.
                  </Notice>
                </div>
              </Panel>
            ) : null}

            {deployed ? (
              <Panel title="03 · Dev buy (optional)">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <FieldLabel>First-candle buy (ETH)</FieldLabel>
                    <TextField
                      value={input.devBuyEth}
                      onChange={(v) => set('devBuyEth', onlyDecimal(v))}
                      placeholder="0.0"
                      mono
                      inputMode="decimal"
                    />
                  </div>
                  <Notice tone="muted">
                    A dev buy runs as a SEPARATE bonding-curve buy right after the token is created — enabled below once
                    the launch confirms.
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
            <SummaryRow label="Supply (raw)" value={supplyValue} />
            <SummaryRow label="Graduates to" value={deployed ? graduatesTo : '—'} />
            <SummaryRow label="Launch fee (USD)" value={deployed ? feeUsdLabel : '—'} />
            <SummaryRow label="Launch fee (native)" value={deployed ? feeWeiLabel : '—'} valueColor={deployed ? terminalColors.ink : terminalColors.faint} />
            <SummaryRow
              label="Creator"
              value={connected && owner ? <ExplorerAddress address={owner} chainId={chainId} fontSize={12.5} fontWeight={500} /> : '—'}
            />
            <SummaryRow label="Network" value={deployed ? chainLabel : 'Not available'} />

            <PrimaryButton label={primaryLabel} onClick={onPrimary} disabled={primaryDisabled} />

            {state.isDone ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Notice tone="green">Launched — token created + seeded on the bonding curve.</Notice>
                <SummaryRow label="Token" value={<ExplorerAddress address={state.createdToken} chainId={chainId} type={ExplorerDataType.TOKEN} fontSize={12.5} fontWeight={500} />} />
                {input.devBuyEth.trim() !== '' && input.devBuyEth.trim() !== '0' ? (
                  <>
                    <PrimaryButton
                      label={
                        state.devBuyHash ? 'Dev buy sent' : state.isBuying ? 'Buying…' : `Dev buy ${input.devBuyEth} ETH`
                      }
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
                One transaction deploys the token and seeds its bonding curve. The launch fee is USD-pegged and paid in
                native currency.
              </div>
            ) : null}
          </Panel>
        }
      />
    </>
  )
}
