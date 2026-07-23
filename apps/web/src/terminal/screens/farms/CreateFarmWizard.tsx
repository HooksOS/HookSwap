/**
 * HookSwap Terminal — Farm creation wizard (de-crammed, stepped).
 *
 * A spacious three-step flow for `StakingRewardsFactory.createAndFund(stakingToken,
 * rewardToken, rewardAmount, duration)`:
 *   1. Staking token — the ERC-20 (or v2 LP token) users deposit.
 *   2. Reward token  — the ERC-20 stakers earn.
 *   3. Budget & schedule — total reward budget + stream duration (with quick presets).
 * A sticky Review rail on the right shows the resolved plan, an HONEST protocol-fee
 * disclosure, the live reward rate, and the approve → create CTA.
 *
 * DATA POLICY (facts-only): every token symbol/decimals is a REAL on-chain read; the
 * reward rate is derived from the entered budget/duration; there is NO fabricated APR
 * or price. The stream starts at creation (the contract has no scheduled-start param),
 * stated honestly rather than shown as a fake input. Protocol fees are owner-configurable and
 * DEFAULT 0 (flat native `createFee` + a `protocolFeeBps` reward-budget cut, capped 5%): the
 * Review READS them live off the factory and shows the exact fee, the reward skim, and the net
 * the farm receives before you sign — never asserting "no fee" without checking. Both the approve
 * and create writes are REAL (wagmi via `useCreateFarm`); the native `createFee` is sent as msg.value.
 */
import { useState } from 'react'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { formatUnits, type Address } from '~/chains'
import { ExplorerAddress } from '~/terminal/components/ExplorerAddress'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { useCreateFarm } from '~/terminal/farms/useCreateFarm'
import { terminalColors } from '~/terminal/theme/tokens'
import {
  AprNote,
  daysToSeconds,
  FieldLabel,
  fmtAmount,
  fmtDuration,
  InlineError,
  InlineHint,
  MONO,
  NotDeployedNote,
  Notice,
  PrimaryButton,
  SANS,
  SECONDS_PER_DAY,
  StepCard,
  SummaryRow,
  TextField,
  TokenPreview,
} from '~/terminal/screens/farms/parts'

/** Quick-pick reward-window presets (days). */
const DURATION_PRESETS: { label: string; days: string }[] = [
  { label: '7D', days: '7' },
  { label: '30D', days: '30' },
  { label: '90D', days: '90' },
  { label: '180D', days: '180' },
  { label: '1Y', days: '365' },
]

export function CreateFarmWizard({
  deployed,
  chainLabel,
  chainId,
  owner,
  connected,
  onConnect,
}: {
  deployed: boolean
  chainLabel: string
  chainId?: number
  owner: Address | undefined
  connected: boolean
  onConnect: () => void
}): JSX.Element {
  const [stakingToken, setStakingToken] = useState('')
  const [rewardToken, setRewardToken] = useState('')
  const [rewardAmount, setRewardAmount] = useState('')
  const [durationDays, setDurationDays] = useState('30')

  const durationSeconds = daysToSeconds(durationDays)

  const farm = useCreateFarm({ chainId, owner, stakingToken, rewardToken, rewardAmount, durationSeconds })

  /* ---------------------------------------------------------------- step status */

  const step1Done = Boolean(farm.validStakingToken && farm.stakingSymbol)
  const step2Done = Boolean(farm.validRewardToken && farm.distinctTokens && farm.rewardSymbol)
  const step3Done = farm.validAmount && farm.validDuration
  const step1Status = step1Done ? 'done' : 'active'
  const step2Status = step2Done ? 'done' : step1Done ? 'active' : 'pending'
  const step3Status = step3Done ? 'done' : step2Done ? 'active' : 'pending'

  /* ---------------------------------------------------------------- CTA */

  const onPrimary = (): void => {
    if (!connected) {
      onConnect()
      return
    }
    if (farm.isDone) {
      farm.reset()
      setRewardAmount('')
      return
    }
    void (farm.needsApproval ? farm.approve() : farm.create())
  }

  const primaryLabel = ((): string => {
    if (!deployed) {
      return 'Not available on this network'
    }
    if (!connected) {
      return 'Connect wallet to create a farm'
    }
    if (farm.isDone) {
      return 'Create another farm'
    }
    if (!farm.inputsValid) {
      return 'Complete the steps above'
    }
    if (!farm.allowanceKnown) {
      return 'Checking approval…'
    }
    if (farm.needsApproval) {
      if (farm.approving) {
        return 'Approving…'
      }
      return farm.isWritePending ? 'Confirm in wallet…' : `Approve ${farm.rewardSymbol ?? 'reward token'}`
    }
    if (!farm.feesKnown) {
      return 'Checking fees…'
    }
    if (farm.isWritePending) {
      return 'Confirm in wallet…'
    }
    if (farm.isConfirming) {
      return 'Creating farm…'
    }
    return 'Create farm'
  })()

  const primaryDisabled = ((): boolean => {
    if (!deployed) {
      return true
    }
    if (!connected || farm.isDone) {
      return false
    }
    return farm.needsApproval ? !farm.canApprove : !farm.canCreate
  })()

  // Reward rate is derived from what actually FUNDS the farm (budget minus any protocol
  // skim), not the gross budget — so the /day figure matches the on-chain stream.
  const fundForRate = farm.fundAmountRaw ?? farm.rewardAmountRaw
  const rewardPerDay =
    fundForRate !== undefined && durationSeconds !== undefined && durationSeconds > 0
      ? (fundForRate * BigInt(SECONDS_PER_DAY)) / BigInt(durationSeconds)
      : undefined

  /* ---------------------------------------------------------------- honest fee display */

  const native = chainId ? getChainInfo(chainId).nativeCurrency : undefined
  const hasCreateFee = farm.createFeeRaw > 0n
  const hasCut = farm.protocolFeeBps > 0
  const anyFee = hasCreateFee || hasCut
  const rewardSym = farm.rewardSymbol ?? ''
  const createFeeLabel = hasCreateFee
    ? `${Number(formatUnits(farm.createFeeRaw, native?.decimals ?? 18)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${native?.symbol ?? ''}`.trim()
    : undefined
  const cutLabel = hasCut ? `${(farm.protocolFeeBps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%` : undefined
  const feeRowValue = !farm.feesKnown ? '…' : !anyFee ? 'None' : hasCut && hasCreateFee ? `${cutLabel} + ${createFeeLabel}` : (cutLabel ?? createFeeLabel)

  if (!deployed) {
    return (
      <InstrumentPanel title="CREATE A FARM" meta={['not deployed']}>
        <NotDeployedNote chainLabel={chainLabel} />
      </InstrumentPanel>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Left: stepped form */}
      <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Step 1 — staking token */}
        <StepCard
          index={1}
          title="Staking token"
          hint="The ERC-20 users deposit to earn rewards. Any token works — including a HookSwap v2 LP-pair token, so this doubles as an LP farm."
          status={step1Status}
        >
          <FieldLabel>Staking token address</FieldLabel>
          <TextField
            value={stakingToken}
            onChange={setStakingToken}
            placeholder="0x…"
            tone={stakingToken !== '' && !farm.validStakingToken ? 'error' : step1Done ? 'valid' : 'neutral'}
          />
          {stakingToken !== '' && !farm.validStakingToken ? (
            <InlineError>Enter a valid ERC-20 contract address.</InlineError>
          ) : farm.stakingSymbol ? (
            <TokenPreview chainId={chainId} address={stakingToken} symbol={farm.stakingSymbol} decimals={farm.stakingDecimals} />
          ) : farm.validStakingToken ? (
            <InlineHint>Reading token…</InlineHint>
          ) : null}
        </StepCard>

        {/* Step 2 — reward token */}
        <StepCard
          index={2}
          title="Reward token"
          hint="The ERC-20 paid out to stakers over the reward window. Must differ from the staking token."
          status={step2Status}
        >
          <FieldLabel>Reward token address</FieldLabel>
          <TextField
            value={rewardToken}
            onChange={setRewardToken}
            placeholder="0x…"
            tone={rewardToken !== '' && (!farm.validRewardToken || !farm.distinctTokens) ? 'error' : step2Done ? 'valid' : 'neutral'}
          />
          {rewardToken !== '' && !farm.validRewardToken ? (
            <InlineError>Enter a valid ERC-20 contract address.</InlineError>
          ) : !farm.distinctTokens ? (
            <InlineError>Reward token must differ from the staking token.</InlineError>
          ) : farm.rewardSymbol ? (
            <TokenPreview chainId={chainId} address={rewardToken} symbol={farm.rewardSymbol} decimals={farm.rewardDecimals} />
          ) : farm.validRewardToken ? (
            <InlineHint>Reading token…</InlineHint>
          ) : null}
        </StepCard>

        {/* Step 3 — budget & schedule */}
        <StepCard
          index={3}
          title="Reward budget & schedule"
          hint="The full budget is transferred into the farm on creation and streamed linearly to stakers over the window."
          status={step3Status}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <FieldLabel>Total reward budget</FieldLabel>
              <TextField
                value={rewardAmount}
                onChange={(v) => setRewardAmount(v.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                inputMode="decimal"
                suffix={farm.rewardSymbol ?? 'reward'}
                tone={rewardAmount !== '' && !farm.validAmount ? 'error' : farm.validAmount ? 'valid' : 'neutral'}
              />
              {rewardAmount !== '' && !farm.validAmount ? <InlineError>Enter a reward budget greater than zero.</InlineError> : null}
            </div>

            <div>
              <FieldLabel>Reward duration</FieldLabel>
              <TextField
                value={durationDays}
                onChange={(v) => setDurationDays(v.replace(/[^0-9.]/g, ''))}
                placeholder="30"
                inputMode="decimal"
                suffix="days"
                tone={durationDays !== '' && !farm.validDuration ? 'error' : farm.validDuration ? 'valid' : 'neutral'}
              />
              {/* Quick presets */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {DURATION_PRESETS.map((p) => {
                  const active = durationDays === p.days
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setDurationDays(p.days)}
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.03em',
                        color: active ? terminalColors.greenDeep : terminalColors.ink2,
                        background: active ? terminalColors.greenBg : terminalColors.panel,
                        border: `1px solid ${active ? terminalColors.greenBorder : terminalColors.line}`,
                        padding: '5px 11px',
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
              {durationDays !== '' && !farm.validDuration ? (
                <InlineError>Duration must be greater than zero.</InlineError>
              ) : (
                <InlineHint>
                  {rewardPerDay !== undefined
                    ? `Streams ${fmtAmount(rewardPerDay, farm.rewardDecimals)} ${farm.rewardSymbol ?? ''}/day for ${
                        durationSeconds !== undefined ? fmtDuration(durationSeconds) : ''
                      }.`.trim()
                    : 'Rewards stream from the moment the farm is created — there is no scheduled start.'}
                </InlineHint>
              )}
            </div>
          </div>
        </StepCard>
      </div>

      {/* Right: sticky review + create */}
      <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 16 }}>
        <InstrumentPanel title="REVIEW" corners>
          <SummaryRow label="Staking token" value={farm.stakingSymbol ?? (farm.validStakingToken ? '…' : '—')} />
          <SummaryRow label="Reward token" value={farm.rewardSymbol ?? (farm.validRewardToken ? '…' : '—')} />
          <SummaryRow
            label="Reward budget"
            value={
              farm.validAmount && rewardAmount !== ''
                ? `${Number(rewardAmount).toLocaleString('en-US')} ${farm.rewardSymbol ?? ''}`.trim()
                : '—'
            }
          />
          <SummaryRow label="Duration" value={durationSeconds !== undefined && durationSeconds > 0 ? fmtDuration(durationSeconds) : '—'} />
          <SummaryRow
            label="Reward rate"
            value={rewardPerDay !== undefined ? `${fmtAmount(rewardPerDay, farm.rewardDecimals)} ${farm.rewardSymbol ?? ''}/day`.trim() : '—'}
          />
          <SummaryRow label="Starts" value="Immediately on creation" />
          <SummaryRow label="Protocol fee" value={feeRowValue} valueColor={anyFee ? terminalColors.ink : terminalColors.greenDeep} />
          {hasCut && farm.protocolFeeAmountRaw !== undefined ? (
            <SummaryRow label="Reward skim" value={`${fmtAmount(farm.protocolFeeAmountRaw, farm.rewardDecimals)} ${rewardSym}`.trim()} />
          ) : null}
          {anyFee && farm.fundAmountRaw !== undefined ? (
            <SummaryRow label="Farm receives" value={`${fmtAmount(farm.fundAmountRaw, farm.rewardDecimals)} ${rewardSym}`.trim()} />
          ) : null}
          <SummaryRow
            label="Funded by"
            value={connected && owner ? <ExplorerAddress address={owner} chainId={chainId} fontSize={12.5} fontWeight={500} /> : '—'}
          />
          <SummaryRow label="Network" value={chainLabel} />

          <div style={{ marginTop: 14 }}>
            <PrimaryButton label={primaryLabel} onClick={onPrimary} disabled={primaryDisabled} />
          </div>

          {farm.isDone ? (
            <div style={{ marginTop: 12 }}>
              <Notice tone="green">
                Farm created and funded.
                {farm.createdFarm ? (
                  <>
                    {' '}
                    Address <ExplorerAddress address={farm.createdFarm} chainId={chainId} />.
                  </>
                ) : (
                  ''
                )}{' '}
                Stakers can now deposit from the &ldquo;Stake &amp; manage&rdquo; tab and earn the reward stream.
              </Notice>
            </div>
          ) : farm.error ? (
            <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 12, lineHeight: 1.5 }}>{farm.error}</div>
          ) : (
            <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, marginTop: 12, lineHeight: 1.5 }}>
              You approve the reward token once, then create. Creating deploys a new staking-rewards contract and streams the
              reward budget{anyFee ? ' (after the protocol fee shown above)' : ''} to stakers. Streamed rewards can&apos;t be
              pulled back; you (the creator) own the farm and can extend it later.
            </div>
          )}
        </InstrumentPanel>

        <AprNote />
      </div>
    </div>
  )
}
