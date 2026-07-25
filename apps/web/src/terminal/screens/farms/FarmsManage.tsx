/**
 * HookSwap Terminal — stake / claim / unstake into an existing farm.
 *
 * The de-crammed "Stake & manage" panel: pick (or paste) a farm, see its live
 * on-chain stats (your stake, total staked, claimable, reward rate, period end),
 * then stake / claim / unstake — all REAL wagmi reads/writes via `useFarm`.
 *
 * DATA POLICY (facts-only): every symbol/decimals/balance/rate/period is a real
 * on-chain read (renders "—" until resolved); no APR is fabricated (honest note);
 * staking is gated behind a confirmed ERC-20 allowance so a tx can't be signed
 * that would revert. `useFarmList` supplies the discovery pick-list from the
 * factory's `allFarms()` registry.
 */
import type { UniverseChainId } from 'uniswap/src/features/chains/types'
import { formatUnits, type Address } from '~/chains'
import { ExplorerAddress, shortAddr } from '~/terminal/components/ExplorerAddress'
import { InstrumentPanel, terminalKeycap } from '~/terminal/components/InstrumentPanel'
import { StatCard } from '~/terminal/components/StatCard'
import { SwitchChainButton } from '~/terminal/components/SwitchChainButton'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { useFarm } from '~/terminal/farms/useFarm'
import { useFarmListAllChains } from '~/terminal/farms/useFarmListAllChains'
import { ChainBadge } from '~/terminal/components/ChainBadge'
import { terminalColors } from '~/terminal/theme/tokens'
import {
  AprNote,
  ConnectInline,
  FieldLabel,
  fmtAmount,
  fmtDuration,
  InlineError,
  MONO,
  NotDeployedNote,
  PrimaryButton,
  SANS,
  SECONDS_PER_DAY,
  SecondaryButton,
  TextField,
} from '~/terminal/screens/farms/parts'

export function FarmsManage({
  deployed,
  connected,
  chainLabel,
  chainId,
  owner,
  onConnect,
  switchTarget,
  selectedFarm,
  setSelectedFarm,
  farm,
  stakeAmount,
  setStakeAmount,
  unstakeAmount,
  setUnstakeAmount,
}: {
  deployed: boolean
  connected: boolean
  chainLabel: string
  chainId?: number
  owner: Address | undefined
  onConnect: () => void
  switchTarget?: UniverseChainId
  selectedFarm: string
  setSelectedFarm: (v: string) => void
  farm: ReturnType<typeof useFarm>
  stakeAmount: string
  setStakeAmount: (v: string) => void
  unstakeAmount: string
  setUnstakeAmount: (v: string) => void
}): JSX.Element {
  // MULTICHAIN: discovery spans every chain the farm factory is deployed on, so a
  // user connected to one chain still sees (and can switch to) farms elsewhere.
  // Writes remain on the selected farm's own chain — see the per-row switch prompt.
  const list = useFarmListAllChains({ connectedChainId: chainId })

  if (!deployed) {
    // MULTICHAIN: the connected chain has no factory, but the user may well have
    // farms elsewhere. Previously this state said only "not deployed here", which
    // reads as "you have no farms". Show where farms actually exist so the switch
    // is an informed one — staking still requires being on that farm's chain.
    const chainsWithFarms = Array.from(new Set((list.farms ?? []).map((f) => f.chainId)))
    return (
      <InstrumentPanel title="FARMS" meta={['not deployed on this chain']}>
        <NotDeployedNote chainLabel={chainLabel} />
        {chainsWithFarms.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <FieldLabel>Farms on other chains</FieldLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {chainsWithFarms.map((cid) => (
                <ChainBadge key={cid} chainId={cid} />
              ))}
            </div>
          </div>
        ) : null}
        {switchTarget !== undefined ? (
          <SwitchChainButton
            target={switchTarget}
            note="Farms are live on other HookSwap chains — switch networks to stake now."
          />
        ) : null}
      </InstrumentPanel>
    )
  }

  // Which chain the currently-picked farm lives on (undefined for a hand-typed
  // address that isn't in the discovered set).
  const selectedFarmChainId = selectedFarm
    ? list.farms?.find((f) => f.farm.toLowerCase() === selectedFarm.toLowerCase())?.chainId
    : undefined

  const now = Math.floor(Date.now() / 1000)
  const periodFinish = farm.periodFinish !== undefined ? Number(farm.periodFinish) : undefined
  const endsLabel = ((): string => {
    if (periodFinish === undefined) {
      return '—'
    }
    if (periodFinish === 0) {
      return 'Not started'
    }
    return periodFinish > now ? `in ${fmtDuration(periodFinish - now)}` : 'Ended'
  })()

  const rewardPerDay = farm.rewardRate !== undefined ? farm.rewardRate * BigInt(SECONDS_PER_DAY) : undefined

  const stakeLabel = ((): string => {
    if (!connected) {
      return 'Connect wallet'
    }
    if (!farm.validStake) {
      return 'Enter an amount to stake'
    }
    if (!farm.allowanceKnown) {
      return 'Checking approval…'
    }
    if (farm.needsApproval) {
      return farm.pendingAction === 'approve' ? 'Approving…' : 'Approve staking token'
    }
    if (farm.pendingAction === 'stake') {
      return 'Staking…'
    }
    return 'Stake'
  })()

  const onStakePrimary = (): void => {
    if (!connected) {
      onConnect()
      return
    }
    void (farm.needsApproval ? farm.approve() : farm.stake())
  }
  const stakeDisabled = connected && (farm.needsApproval ? !farm.canApprove : !farm.canStake)

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Left: farm picker + live stats */}
      <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <InstrumentPanel title="SELECT A FARM" corners>
          <FieldLabel>Farm address</FieldLabel>
          <TextField
            value={selectedFarm}
            onChange={setSelectedFarm}
            placeholder="0x… (paste a farm address)"
            tone={selectedFarm !== '' && !farm.validFarm ? 'error' : farm.validFarm ? 'valid' : 'neutral'}
          />
          {selectedFarm !== '' && !farm.validFarm ? <InlineError>Enter a valid farm contract address.</InlineError> : null}

          {/* MULTICHAIN: the picked farm may live on a chain the wallet isn't on.
              Reads/writes below are bound to the CONNECTED chain, so surface the
              mismatch and offer the switch rather than letting stake/claim fail. */}
          {selectedFarmChainId !== undefined && selectedFarmChainId !== chainId ? (
            <div style={{ marginTop: 12 }}>
              <SwitchChainButton
                target={selectedFarmChainId}
                note={`This farm is on ${getChainLabel(selectedFarmChainId)} — switch networks to stake, withdraw or claim it.`}
              />
            </div>
          ) : null}

          {/* Discovery list — every farm the factory has deployed (allFarms), all chains. */}
          <div style={{ marginTop: 14 }}>
            <FieldLabel>Deployed farms</FieldLabel>
            {list.isLoading || list.farms === undefined ? (
              <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3Alt }}>Loading farms…</div>
            ) : list.error ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.redDown }}>Failed to load farms.</span>
                <button
                  type="button"
                  onClick={list.refetch}
                  style={{
                    fontFamily: SANS,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: terminalColors.ink2,
                    background: terminalColors.panel,
                    border: `1px solid ${terminalColors.line}`,
                    padding: '4px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            ) : list.farms.length === 0 ? (
              <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3Alt, lineHeight: 1.5 }}>
                No farms have been created on any HookSwap chain yet — make one from the Create tab.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {list.farms.map(({ chainId: farmChainId, farm: f }) => {
                  const active = f.toLowerCase() === selectedFarm.toLowerCase()
                  return (
                    <button
                      key={`${farmChainId}-${f}`}
                      type="button"
                      onClick={() => setSelectedFarm(f)}
                      style={{
                        fontFamily: MONO,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: active ? terminalColors.greenDeep : terminalColors.ink2,
                        background: active ? terminalColors.greenBg : terminalColors.panel,
                        border: `1px solid ${active ? terminalColors.greenBorder : terminalColors.line}`,
                        padding: '6px 11px',
                        borderRadius: 9,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                      }}
                    >
                      <ChainBadge chainId={farmChainId} size="sm" showLabel={false} />
                      {shortAddr(f)}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </InstrumentPanel>

        {farm.validFarm ? (
          <InstrumentPanel title="STAKE → EARN" meta={[farm.stakingSymbol ?? '…', `→ ${farm.rewardSymbol ?? '…'}`]}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <StatCard size="md" label="Your stake" value={fmtAmount(farm.staked, farm.stakingDecimals)} />
              <StatCard size="md" label="Total staked" value={fmtAmount(farm.totalStaked, farm.stakingDecimals)} />
              <StatCard
                size="md"
                label="Claimable"
                value={fmtAmount(farm.earned, farm.rewardDecimals)}
                valueColor={farm.earned !== undefined && farm.earned > 0n ? 'up' : 'ink'}
              />
              <StatCard
                size="md"
                label="Reward rate / day"
                value={rewardPerDay !== undefined ? `${fmtAmount(rewardPerDay, farm.rewardDecimals)} ${farm.rewardSymbol ?? ''}`.trim() : '—'}
              />
              <StatCard size="md" label="Period ends" value={endsLabel} />
            </div>

            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3Alt }}>Farm contract</span>
              {farm.farmAddress ? <ExplorerAddress address={farm.farmAddress} chainId={chainId} fontSize={12} fontWeight={500} /> : <span>—</span>}
            </div>

            <div style={{ marginTop: 14 }}>
              <AprNote />
            </div>
          </InstrumentPanel>
        ) : null}
      </div>

      {/* Right: stake / claim / unstake */}
      <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <InstrumentPanel title="STAKE / MANAGE" corners>
          {!farm.validFarm ? (
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt, padding: '6px 0', lineHeight: 1.5 }}>
              Select or paste a farm address to stake, claim rewards, or unstake.
            </div>
          ) : !connected ? (
            <ConnectInline text="Connect a wallet to stake in this farm." onConnect={onConnect} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Stake */}
              <div>
                <FieldLabel>Amount to stake ({farm.stakingSymbol ?? 'tokens'})</FieldLabel>
                <TextField
                  value={stakeAmount}
                  onChange={(v) => setStakeAmount(v.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  inputMode="decimal"
                  suffix={farm.stakingSymbol}
                />
                <div style={{ marginTop: 10 }}>
                  <PrimaryButton label={stakeLabel} onClick={onStakePrimary} disabled={stakeDisabled} />
                </div>
              </div>

              {/* Claim */}
              <SecondaryButton
                label={
                  farm.pendingAction === 'claim'
                    ? 'Claiming…'
                    : farm.earned !== undefined && farm.earned > 0n
                      ? `Claim ${fmtAmount(farm.earned, farm.rewardDecimals)} ${farm.rewardSymbol ?? ''}`.trim()
                      : 'Nothing to claim'
                }
                onClick={() => void farm.claim()}
                disabled={!farm.canClaim}
              />

              {/* Unstake */}
              <div>
                <FieldLabel>Amount to unstake ({farm.stakingSymbol ?? 'tokens'})</FieldLabel>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      value={unstakeAmount}
                      onChange={(v) => setUnstakeAmount(v.replace(/[^0-9.]/g, ''))}
                      placeholder="0.00"
                      inputMode="decimal"
                      suffix={farm.stakingSymbol}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (farm.staked !== undefined && farm.stakingDecimals !== undefined) {
                        setUnstakeAmount(formatUnits(farm.staked, farm.stakingDecimals))
                      }
                    }}
                    disabled={farm.staked === undefined || farm.staked === 0n}
                    style={{
                      ...terminalKeycap,
                      fontSize: 11,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: farm.staked && farm.staked > 0n ? terminalColors.ink2 : terminalColors.faint,
                      padding: '10px 12px',
                      cursor: farm.staked && farm.staked > 0n ? 'pointer' : 'default',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Max
                  </button>
                </div>
                {unstakeAmount !== '' && !farm.validUnstake ? <InlineError>Enter an amount up to your staked balance.</InlineError> : null}
                <div style={{ marginTop: 10 }}>
                  <SecondaryButton
                    label={farm.pendingAction === 'withdraw' ? 'Unstaking…' : 'Unstake'}
                    onClick={() => void farm.withdraw()}
                    disabled={!farm.canWithdraw}
                  />
                </div>
              </div>

              {farm.actionError ? (
                <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, lineHeight: 1.5 }}>{farm.actionError}</div>
              ) : (
                <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, lineHeight: 1.5 }}>
                  Staking approves the token once, then deposits. Claim and unstake need no approval. Balances refresh from
                  chain state after each transaction confirms.
                </div>
              )}
            </div>
          )}
        </InstrumentPanel>
      </div>
    </div>
  )
}
