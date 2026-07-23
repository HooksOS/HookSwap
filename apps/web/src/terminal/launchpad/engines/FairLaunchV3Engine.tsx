/**
 * HookSwap Terminal — Fair Launch · v3 engine (HookOSV3Launcher).
 *
 * This is the ORIGINAL `/launch/create` fair-launch flow, extracted verbatim from
 * LaunchCreateScreen so it can be selected from the engine picker without any behavior change:
 * mint a token + single-sided-seed a v3 pool + lock the LP in the HookOSV3FeeVault, all in one tx.
 *
 * DATA POLICY (no mock data):
 *   • Fees — REAL on-chain reads (effectiveLaunchFee, quoteLaunchCost).
 *   • Result — parsed from the launch tx's PoolSeeded event by the SDK.
 *   • My launches + pending fees — from the FeeVault; honest empty states.
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { ExplorerDataType } from 'uniswap/src/utils/linking'
import { ExplorerAddress } from '~/terminal/components/ExplorerAddress'
import { StatCard } from '~/terminal/components/StatCard'
import {
  fmtWei,
  onlyDigits,
  onlySignedDigits,
  FieldLabel,
  NotDeployedNote,
  Notice,
  Panel,
  PrimaryButton,
  StepLabel,
  SummaryRow,
  TextField,
  ToggleRow,
  TwoColumn,
  MONO,
  SANS,
} from '~/terminal/launchpad/primitives'
import {
  randomSalt,
  useLaunch,
  useMyLaunches,
  V3Dex,
  PairToken,
  ZERO_SALT,
  type LaunchConfigInput,
} from '~/terminal/launchpad/useLaunch'
import { terminalColors } from '~/terminal/theme/tokens'
import type { Address } from '~/chains'

/**
 * Contract-valid pool defaults so the default (non-advanced) form submits.
 *   • sqrtPriceX96 = 2^96 → a 1:1 initial price.
 *   • ticks ±887220 → the full usable range at tickSpacing 60.
 */
const DEFAULT_SQRT_PRICE_X96 = '79228162514264337593543950336'
const DEFAULT_TICK_LOWER = '-887220'
const DEFAULT_TICK_UPPER = '887220'

const EMPTY_INPUT: LaunchConfigInput = {
  name: '',
  symbol: '',
  metadataURI: '',
  totalSupply: '',
  salt: ZERO_SALT,
  sqrtPriceX96: DEFAULT_SQRT_PRICE_X96,
  tickLower: DEFAULT_TICK_LOWER,
  tickUpper: DEFAULT_TICK_UPPER,
  dex: String(V3Dex.HookSwap),
  pair: String(PairToken.WETH),
  lockOnHookSwap: true,
  initialBuyEth: '0',
  initialBuyMinOut: '0',
  initialBuyDeadline: '0',
}

/* ------------------------------------------------------------------ my launches */

function MyLaunchesPanel({ chainId, owner }: { chainId?: number; owner?: Address }): JSX.Element {
  const my = useMyLaunches({ chainId, owner })

  return (
    <Panel title="04 · My launches" meta={my.isLoading ? ['loading…'] : undefined}>
      {!owner ? (
        <Notice tone="muted">Connect your wallet to see the tokens you&apos;ve launched.</Notice>
      ) : my.isLoading ? (
        <Notice tone="muted">Loading your launches…</Notice>
      ) : my.launches.length === 0 ? (
        <Notice tone="muted">You haven&apos;t launched any tokens yet.</Notice>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {my.launches.map((l) => {
            const dexLabel = l.dex === V3Dex.HookSwap ? 'HookSwap' : 'Uniswap V3'
            return (
              <div
                key={String(l.id)}
                style={{
                  border: `1px solid ${terminalColors.line}`,
                  borderRadius: 11,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <SummaryRow label="Token" value={<ExplorerAddress address={l.token} chainId={chainId} type={ExplorerDataType.TOKEN} fontSize={12.5} fontWeight={500} />} />
                <SummaryRow label="Pool" value={<ExplorerAddress address={l.pool} chainId={chainId} fontSize={12.5} fontWeight={500} />} />
                <SummaryRow label="DEX" value={dexLabel} />
                <SummaryRow label="Position #" value={String(l.tokenId)} />
                <SummaryRow
                  label="Pending WETH"
                  value={fmtWei(l.pendingWeth)}
                  valueColor={l.pendingWeth && l.pendingWeth > 0n ? terminalColors.greenDeep : terminalColors.faint}
                />
                <SummaryRow
                  label="Pending token"
                  value={fmtWei(l.pendingToken)}
                  valueColor={l.pendingToken && l.pendingToken > 0n ? terminalColors.greenDeep : terminalColors.faint}
                />
                <PrimaryButton
                  label={my.claimingToken === l.token && my.isClaiming ? 'Collecting…' : 'Collect fees'}
                  onClick={() => void my.collect(l.token)}
                  disabled={my.isClaiming || !((l.pendingWeth && l.pendingWeth > 0n) || (l.pendingToken && l.pendingToken > 0n))}
                  variant="outline"
                />
              </div>
            )
          })}

          <SummaryRow label="Total pending WETH" value={fmtWei(my.totalPendingWeth)} />
          {my.deferredEth > 0n ? (
            <>
              <SummaryRow label="Deferred ETH" value={fmtWei(my.deferredEth)} valueColor={terminalColors.greenDeep} />
              <PrimaryButton
                label={my.isClaiming ? 'Withdrawing…' : 'Withdraw deferred ETH'}
                onClick={() => void my.withdrawPending()}
                disabled={my.isClaiming}
              />
            </>
          ) : null}
        </div>
      )}

      {my.claimError ? (
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 10, lineHeight: 1.5 }}>
          {my.claimError}
        </div>
      ) : null}

      <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
        LP is permanently locked in the fee vault. Trading fees are split per-dex (50/50 Uniswap V3, 70/30 HookSwap).
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ the engine */

export function FairLaunchV3Engine({
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

  const [input, setInput] = useState<LaunchConfigInput>(EMPTY_INPUT)
  const [advanced, setAdvanced] = useState(false)

  const set = <K extends keyof LaunchConfigInput>(key: K, value: LaunchConfigInput[K]): void => {
    setInput((prev) => ({ ...prev, [key]: value }))
  }

  const launchState = useLaunch({ chainId, owner, input })
  const deployed = launchState.ready

  const feeLabel = launchState.baseFeeWei !== undefined ? `${fmtWei(launchState.baseFeeWei)} ETH` : '—'
  const totalValueLabel = launchState.totalValue !== undefined ? `${fmtWei(launchState.totalValue)} ETH` : '—'

  const busy = launchState.isWritePending || launchState.isConfirming

  const onPrimary = (): void => {
    if (!connected) {
      onConnect()
      return
    }
    if (launchState.isDone) {
      launchState.reset()
      setInput(EMPTY_INPUT)
      return
    }
    void launchState.launch()
  }

  const primaryLabel = ((): string => {
    if (!deployed) {
      return 'Not available on this network'
    }
    if (!connected) {
      return 'Connect wallet to launch'
    }
    if (launchState.isDone) {
      return 'Launch another token'
    }
    if (launchState.validationError) {
      return launchState.validationError
    }
    if (launchState.isWritePending) {
      return 'Preparing launch…'
    }
    if (launchState.isConfirming) {
      return 'Confirm & launching…'
    }
    return 'Launch token'
  })()

  const primaryDisabled = ((): boolean => {
    if (!deployed) {
      return true
    }
    if (!connected) {
      return false
    }
    if (launchState.isDone) {
      return false
    }
    if (busy) {
      return true
    }
    return !launchState.canLaunch
  })()

  const symbolValue = input.symbol.trim() !== '' ? input.symbol.trim().toUpperCase() : '—'
  const supplyValue = input.totalSupply.trim() !== '' ? input.totalSupply.trim() : '—'
  const dexLabel = input.dex === String(V3Dex.HookSwap) ? 'HookSwap' : 'Uniswap V3'

  return (
    <>
      {/* Stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatCard size="lg" label="Symbol" value={symbolValue} />
        <StatCard size="lg" label="Supply (raw)" value={supplyValue} />
        <StatCard size="lg" label="Launch fee" value={deployed ? feeLabel : '—'} />
        <StatCard size="lg" label="DEX" value={deployed ? dexLabel : '—'} />
      </div>

      <TwoColumn
        left={
          <>
            <Panel title="01 · Token" meta={deployed ? undefined : ['not deployed']}>
              {!deployed ? (
                <NotDeployedNote chainLabel={chainLabel} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <FieldLabel>Name</FieldLabel>
                    <TextField value={input.name} onChange={(v) => set('name', v)} placeholder="My Token" maxLength={64} />
                  </div>
                  <div>
                    <FieldLabel>Symbol</FieldLabel>
                    <TextField
                      value={input.symbol}
                      onChange={(v) => set('symbol', v.toUpperCase())}
                      placeholder="MYT"
                      mono
                      maxLength={16}
                    />
                  </div>
                  <div>
                    <FieldLabel>Metadata URI</FieldLabel>
                    <TextField
                      value={input.metadataURI}
                      onChange={(v) => set('metadataURI', v)}
                      placeholder="ipfs://… or https://…"
                      mono
                    />
                  </div>
                  <div>
                    <FieldLabel>Token supply (raw base units)</FieldLabel>
                    <TextField
                      value={input.totalSupply}
                      onChange={(v) => set('totalSupply', onlyDigits(v))}
                      placeholder="1000000000000000000000000"
                      mono
                      inputMode="numeric"
                    />
                  </div>
                </div>
              )}
            </Panel>

            {/* Cross-link to the plain fixed-supply token factory (no pool). */}
            <Link
              to="/token/new"
              style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3Alt, textDecoration: 'none', lineHeight: 1.5 }}
            >
              Just need a plain fixed-supply token?{' '}
              <span style={{ color: terminalColors.brandGreen, fontWeight: 600 }}>Use the token factory →</span>
            </Link>

            {deployed ? (
              <Panel title="02 · Pool">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <FieldLabel>DEX</FieldLabel>
                    {/* HookSwap is the only DEX offered: its v3 factory is the one the router
                        discovers, so every launch is swappable in-app. */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 36,
                        padding: '0 12px',
                        border: `1px solid ${terminalColors.line}`,
                        borderRadius: 8,
                        background: terminalColors.panel2,
                        fontFamily: SANS,
                        fontSize: 13,
                        fontWeight: 500,
                        color: terminalColors.ink,
                      }}
                    >
                      HookSwap
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Pair token</FieldLabel>
                    <ToggleRow
                      options={[
                        { label: 'WETH', value: String(PairToken.WETH) },
                        ...(launchState.hookPairEnabled ? [{ label: 'HOOK', value: String(PairToken.HOOK) }] : []),
                      ]}
                      value={input.pair}
                      onChange={(v) => set('pair', v)}
                    />
                  </div>
                  <div>
                    <FieldLabel>Lock LP permanently</FieldLabel>
                    <ToggleRow
                      options={[
                        { label: 'Yes — lock', value: 'true' },
                        { label: 'No', value: 'false' },
                      ]}
                      value={String(input.lockOnHookSwap)}
                      onChange={(v) => set('lockOnHookSwap', v === 'true')}
                    />
                  </div>
                </div>
                <Notice tone="muted">
                  Pool is single-sided (100% your token), paired against{' '}
                  {input.pair === String(PairToken.HOOK) ? 'HOOK' : 'WETH'}. LP is locked in the fee vault — trading fees
                  are claimable.
                </Notice>
              </Panel>
            ) : null}

            {/* Advanced: v3 price params, salt, initial buy */}
            {deployed ? (
              <Panel title="Advanced">
                <div
                  onClick={() => setAdvanced((a) => !a)}
                  style={{ cursor: 'pointer', fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', color: terminalColors.ink3Alt }}
                >
                  {advanced ? '− ADVANCED' : '+ ADVANCED (price, salt, initial buy)'}
                </div>

                {advanced ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                    <StepLabel index="03" label="Price & range" />
                    <div>
                      <FieldLabel>Initial price (sqrtPriceX96)</FieldLabel>
                      <TextField
                        value={input.sqrtPriceX96}
                        onChange={(v) => set('sqrtPriceX96', onlyDigits(v))}
                        placeholder="79228162514264337593543950336"
                        mono
                        inputMode="numeric"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FieldLabel>Tick lower</FieldLabel>
                        <TextField value={input.tickLower} onChange={(v) => set('tickLower', onlySignedDigits(v))} placeholder="-887220" mono />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FieldLabel>Tick upper</FieldLabel>
                        <TextField value={input.tickUpper} onChange={(v) => set('tickUpper', onlySignedDigits(v))} placeholder="887220" mono />
                      </div>
                    </div>

                    <StepLabel index="04" label="Salt & initial buy" />
                    <div>
                      <FieldLabel>Deploy salt</FieldLabel>
                      <TextField
                        value={input.salt === ZERO_SALT ? '' : input.salt}
                        onChange={(v) => set('salt', v || ZERO_SALT)}
                        placeholder="Default (zero) — click Randomize for a unique address"
                        mono
                      />
                      <PrimaryButton label="Randomize salt" onClick={() => set('salt', randomSalt())} variant="outline" />
                    </div>
                    <div>
                      <FieldLabel>Initial buy amount (ETH, in wei)</FieldLabel>
                      <TextField value={input.initialBuyEth} onChange={(v) => set('initialBuyEth', onlyDigits(v))} placeholder="0" mono inputMode="numeric" />
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FieldLabel>Min tokens received</FieldLabel>
                        <TextField value={input.initialBuyMinOut} onChange={(v) => set('initialBuyMinOut', onlyDigits(v))} placeholder="0" mono inputMode="numeric" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FieldLabel>Deadline (unix timestamp)</FieldLabel>
                        <TextField value={input.initialBuyDeadline} onChange={(v) => set('initialBuyDeadline', onlyDigits(v))} placeholder="0" mono inputMode="numeric" />
                      </div>
                    </div>
                    <Notice tone="muted">Initial buy executes in the same tx. Its ETH is added to the total cost.</Notice>
                  </div>
                ) : null}
              </Panel>
            ) : null}
          </>
        }
        right={
          <>
            <Panel title="Review" corners>
              <SummaryRow label="Name" value={input.name.trim() !== '' ? input.name.trim() : '—'} />
              <SummaryRow label="Symbol" value={symbolValue} />
              <SummaryRow label="Supply (raw)" value={supplyValue} />
              <SummaryRow label="DEX" value={deployed ? dexLabel : '—'} />
              <SummaryRow label="Launch fee" value={deployed ? feeLabel : '—'} />
              <SummaryRow
                label="Total cost"
                value={deployed ? totalValueLabel : '—'}
                valueColor={deployed ? terminalColors.ink : terminalColors.faint}
              />
              <SummaryRow
                label="Creator"
                value={connected && owner ? <ExplorerAddress address={owner} chainId={chainId} fontSize={12.5} fontWeight={500} /> : '—'}
              />
              <SummaryRow label="Network" value={deployed ? chainLabel : 'Not available'} />

              <PrimaryButton label={primaryLabel} onClick={onPrimary} disabled={primaryDisabled} />

              {launchState.isDone ? (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Notice tone="green">Launched — token deployed, pool seeded, LP locked in the fee vault.</Notice>
                  <SummaryRow label="Token" value={<ExplorerAddress address={launchState.createdToken} chainId={chainId} type={ExplorerDataType.TOKEN} fontSize={12.5} fontWeight={500} />} />
                  <SummaryRow label="Pool" value={<ExplorerAddress address={launchState.createdPool} chainId={chainId} fontSize={12.5} fontWeight={500} />} />
                  <SummaryRow
                    label="Position #"
                    value={launchState.createdTokenId !== undefined ? String(launchState.createdTokenId) : '—'}
                  />
                </div>
              ) : launchState.error ? (
                <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 10, lineHeight: 1.5 }}>
                  {launchState.error}
                </div>
              ) : deployed ? (
                <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
                  One transaction: deploys the token, seeds the v3 pool, and registers the LP position in the fee vault.
                  Principal is locked forever; trading fees are claimable below.
                </div>
              ) : null}
            </Panel>

            <MyLaunchesPanel chainId={chainId} owner={owner} />
          </>
        }
      />
    </>
  )
}
