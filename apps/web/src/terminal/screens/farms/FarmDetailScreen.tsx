/**
 * HookSwap Terminal — public, shareable per-farm detail page ("B · Ledger").
 *
 * The community URL anyone can open to view a single staking farm:
 * `/farm/:chainId/:farmId` (the farm contract address IS in the url, so a project can
 * just share the link). The counterpart to the token (`/token/...`) and lock
 * (`/lock/...`) detail pages — same Ledger layout, `terminalColors`/`terminalFonts`,
 * IBM Plex Mono numbers, dark-default + light, honest empty / loading / "—" states.
 *
 * DATA POLICY (facts-only, NO mock/placeholder data — every value is a real source or an
 * honest "—" / loading / not-found state), split by source exactly like the Farms page:
 *   • Core stats + all actions (staking/reward tokens, symbols/decimals, total staked,
 *     reward rate, period end, YOUR stake, YOUR earned, allowance, stake/unstake/claim) —
 *     LIVE on-chain via the existing `useFarm` hook (real wagmi reads/writes). These render
 *     end to end with a working RPC and never need the indexer.
 *   • USD TVL + APR% — from the priced farms indexer (`useFarmAnalytics` →
 *     `GET /farm/:chainId/:address`). The indexer OMITS these when the chain has no USD
 *     anchor → rendered "—" with an honest note, never a fabricated $ / yield.
 *   • Rewards remaining — DERIVED on-chain from `rewardRate × secondsLeft` (what the farm
 *     will actually stream), so it works without the indexer. Ended → 0; not started → "—".
 *   • Metadata (addresses, reward duration, period window, protocol fee) — all live reads.
 *     The staking-rewards contract exposes no creator / creation timestamp, so those are
 *     honestly not shown (never guessed) — the reward-period START is shown instead.
 *
 * Wallet-gated actions honor the URL chain: connect → open drawer; wrong network → a
 * one-click switch to this farm's chain; approval flow gates staking behind a confirmed
 * ERC-20 allowance (mirrors FarmsManage). NOTE ON OG UNFURL: `<Helmet>` tags are set
 * CLIENT-SIDE (same SSR caveat as the token / lock pages). The page + copy-link work regardless.
 */
import { useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async/lib/index'
import { Link, useParams } from 'react-router'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel, isUniverseChainId } from 'uniswap/src/features/chains/utils'
import { isEVMAddress } from 'utilities/src/addresses/evm/evm'
import { useReadContract } from 'wagmi'
import { formatUnits, type Address } from '~/chains'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useAccount } from '~/hooks/useAccount'
import { useSelectChain } from '~/hooks/useSelectChain'
import { ExplorerAddress, shortAddr } from '~/terminal/components/ExplorerAddress'
import { InstrumentPanel, terminalKeycap } from '~/terminal/components/InstrumentPanel'
import { LedgerAvatar, resolveLedgerLogo } from '~/terminal/components/LedgerAvatar'
import { stakingRewardsFactoryAbi } from '~/terminal/farms/abis'
import { getFarmFactory } from '~/terminal/farms/addresses'
import { useFarmAnalytics } from '~/terminal/farms/analytics/useFarmAnalytics'
import { useFarm } from '~/terminal/farms/useFarm'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import {
  ConnectInline,
  FieldLabel,
  fmtAmount,
  fmtDuration,
  InlineError,
  Notice,
  PrimaryButton,
  SECONDS_PER_DAY,
  SecondaryButton,
  TextField,
} from '~/terminal/screens/farms/parts'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { assume0xAddress } from '~/utils/wagmi'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans
const DISPLAY = terminalFonts.display

/* ------------------------------------------------------------------ formatting */

/** Compact USD, e.g. 2_410_000 → "$2.41M"; undefined/≤0 → "—" (never $0 for missing). */
function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n <= 0) {
    return '—'
  }
  const abs = Math.abs(n)
  const compact = new Intl.NumberFormat('en-US', {
    notation: abs >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 2,
    minimumFractionDigits: abs >= 1000 ? 0 : 2,
  }).format(n)
  return `$${compact}`
}

/** APR percent (already in percent units, e.g. 42.0 = 42%); undefined → "—". */
function fmtApr(pct: number | undefined): string {
  if (pct === undefined || !Number.isFinite(pct)) {
    return '—'
  }
  if (pct > 0 && pct < 0.01) {
    return '<0.01%'
  }
  return `${pct >= 100 ? Math.round(pct).toLocaleString('en-US') : pct.toFixed(2).replace(/\.?0+$/, '')}%`
}

/** Human date from a UNIX-seconds timestamp, e.g. "Aug 20, 2026". */
function fmtDate(unixSeconds: number | undefined): string {
  if (unixSeconds === undefined || !Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return '—'
  }
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function initials(symbol: string | undefined, len = 1): string {
  return (symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, len).toUpperCase() || '?'
}

/* ------------------------------------------------------------------ param parse */

interface ParsedFarm {
  chainId: UniverseChainId
  address: string
}

/** Parse `/farm/:chainId/:farmId`; rejects unregistered chains / non-EVM addresses. */
function parseParams(chainRaw: string | undefined, farmRaw: string | undefined): ParsedFarm | undefined {
  if (!chainRaw || !farmRaw) {
    return undefined
  }
  const chainNum = Number(chainRaw)
  if (!Number.isInteger(chainNum) || chainNum <= 0 || !isUniverseChainId(chainNum) || !isEVMAddress(farmRaw)) {
    return undefined
  }
  return { chainId: chainNum, address: farmRaw }
}

/* ------------------------------------------------------------------ page shell */

const PAGE_WRAP: React.CSSProperties = {
  minHeight: '70vh',
  background: terminalColors.bgApp,
  padding: '28px var(--tm-gutter, 20px) 64px',
}

function ExploreFooter(): JSX.Element {
  return (
    <div style={{ marginTop: 22, fontFamily: SANS, fontSize: 12, color: terminalColors.faint }}>
      <span style={{ fontFamily: MONO, letterSpacing: '0.04em' }}>🌾 Farming on HookSwap</span>
      <span style={{ margin: '0 8px', opacity: 0.5 }}>·</span>
      <Link to="/farms" style={{ color: terminalColors.greenDeep, textDecoration: 'none', fontWeight: 600 }}>
        Explore all farms →
      </Link>
    </div>
  )
}

function StateBox({ title, body, retry }: { title: string; body: string; retry?: () => void }): JSX.Element {
  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <InstrumentPanel corners style={{ padding: 0 }}>
        <div style={{ padding: '40px 28px', textAlign: 'center' }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink, marginBottom: 10 }}>
            {title}
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13.5, color: terminalColors.ink3, lineHeight: 1.55, maxWidth: 420, margin: '0 auto' }}>
            {body}
          </div>
          {retry ? (
            <button
              type="button"
              onClick={retry}
              style={{
                marginTop: 18,
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: terminalColors.ink2,
                background: terminalColors.bg,
                border: `1px solid ${terminalColors.line}`,
                borderRadius: 8,
                padding: '7px 16px',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          ) : null}
          <div style={{ textAlign: 'center' }}>
            <ExploreFooter />
          </div>
        </div>
      </InstrumentPanel>
    </div>
  )
}

/* ------------------------------------------------------------------ small parts */

/** Active (green) / Ended (gold) / Not started (muted) status pill — from on-chain periodFinish. */
function StatusPill({ status }: { status: 'active' | 'ended' | 'pending' }): JSX.Element {
  const active = status === 'active'
  const label = status === 'active' ? 'Active' : status === 'ended' ? 'Ended' : 'Not started'
  const color = active ? terminalColors.greenDeep : status === 'ended' ? terminalColors.warn : terminalColors.ink3
  const bg = active ? terminalColors.greenBg : status === 'ended' ? terminalColors.warnBg : terminalColors.panel2
  const border = active ? terminalColors.greenBorder : status === 'ended' ? terminalColors.warn : terminalColors.line
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        color,
        background: bg,
        border: `1px solid ${border}`,
        padding: '3px 10px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

/** Overlapping staking→reward avatar pair. */
function PairAvatar({
  chainId,
  stakingToken,
  rewardsToken,
  stakingSymbol,
  rewardSymbol,
}: {
  chainId?: number
  stakingToken?: string
  rewardsToken?: string
  stakingSymbol?: string
  rewardSymbol?: string
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, width: 74 }}>
      <LedgerAvatar
        seed={stakingToken || stakingSymbol || 'stake'}
        initials={initials(stakingSymbol)}
        size={44}
        logoUrl={resolveLedgerLogo(chainId, stakingToken)}
      />
      <div style={{ marginLeft: -14 }}>
        <LedgerAvatar
          seed={rewardsToken || rewardSymbol || 'reward'}
          initials={initials(rewardSymbol)}
          size={44}
          logoUrl={resolveLedgerLogo(chainId, rewardsToken)}
        />
      </div>
    </div>
  )
}

/** One KPI card (matches the token page's Kpi). */
function Kpi({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }): JSX.Element {
  return (
    <div style={{ border: `1px solid ${terminalColors.line2}`, borderRadius: 12, padding: '13px 15px', minWidth: 0, background: terminalColors.bg }}>
      <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase', color: terminalColors.ink3 }}>
        {label}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', color: valueColor ?? terminalColors.ink, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
      {sub ? (
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.faint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </div>
      ) : null}
    </div>
  )
}

/** A labelled address / value row in the metadata block. */
function MetaRow({ label, value, address, chainId }: { label: string; value?: string; address?: string; chainId?: number }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: `1px solid ${terminalColors.line3}` }}>
      <span style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3 }}>{label}</span>
      {address ? (
        <ExplorerAddress address={address} chainId={chainId} fontSize={12} fontWeight={500} />
      ) : (
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: terminalColors.ink2, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ?? '—'}
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ the screen */

export function FarmDetailScreen(): JSX.Element {
  const params = useParams<{ chainId: string; farmId: string }>()
  const isMobile = useIsMobileViewport()
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  const selectChain = useSelectChain()

  const parsed = useMemo(() => parseParams(params.chainId, params.farmId), [params.chainId, params.farmId])
  const chainId = parsed?.chainId
  const address = parsed?.address

  const connected = Boolean(account.address)
  const onCorrectChain = account.chainId === chainId
  const owner = assume0xAddress(account.address)

  // Amount inputs for stake / unstake actions.
  const [stakeAmount, setStakeAmount] = useState('')
  const [unstakeAmount, setUnstakeAmount] = useState('')

  // Core stats + actions — LIVE on-chain (works with no indexer). Only the owner's reads
  // need a connected wallet on the right chain.
  const farm = useFarm({
    chainId,
    owner: onCorrectChain ? owner : undefined,
    farm: address ?? '',
    stakeAmount,
    unstakeAmount,
  })

  // USD TVL + APR% — from the priced indexer (honest "—" when offline / unpriceable).
  const analytics = useFarmAnalytics(chainId ?? 0, address ?? '')
  const indexed = analytics.farm

  // Protocol fee — read from the farm's actual deploying factory when the indexer reports it,
  // else the chain's configured factory. Absent on pre-fee factories → honest "—".
  const factoryAddress = (indexed?.factory as Address | undefined) ?? getFarmFactory(chainId)
  const feeRead = useReadContract({
    address: factoryAddress,
    chainId,
    abi: stakingRewardsFactoryAbi,
    functionName: 'protocolFeeBps',
    query: { enabled: Boolean(factoryAddress && chainId) },
  })
  const protocolFeeBps = feeRead.data as bigint | undefined

  // Copy-share link.
  const [copied, setCopied] = useState(false)
  const onCopy = (): void => {
    const href = typeof window !== 'undefined' ? window.location.href : ''
    if (!href) {
      return
    }
    const done = (): void => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(href).then(done).catch(() => undefined)
    } else {
      done()
    }
  }

  /* ------------------------------------------------------------- guards */

  if (!parsed) {
    return (
      <div style={PAGE_WRAP}>
        <StateBox
          title="Invalid farm link"
          body="This farm link is malformed — it needs a supported chain id and a valid farm contract address. Open a farm from the Farms page to view its page."
        />
      </div>
    )
  }

  // Resolved-empty on-chain AND indexer 404 → this address isn't a farm we can read.
  if (!farm.isLoadingCore && farm.stakingToken === undefined && !analytics.isLoading) {
    return (
      <div style={PAGE_WRAP}>
        <StateBox
          title="This farm isn’t readable"
          body={
            farm.error
              ? `The ${getChainLabel(chainId as UniverseChainId)} RPC is unreachable right now — we won’t show any fabricated data. Try again in a moment.`
              : `No staking farm was found at ${shortAddr(address)} on ${getChainLabel(chainId as UniverseChainId)}. The address may not be a HookSwap farm, or it isn’t deployed on this chain.`
          }
          retry={farm.refetch}
        />
      </div>
    )
  }

  /* ------------------------------------------------------------- derived */

  const stakingSymbol = farm.stakingSymbol ?? indexed?.stakingToken.symbol
  const rewardSymbol = farm.rewardSymbol ?? indexed?.rewardToken.symbol
  const chainLabel = getChainLabel(chainId as UniverseChainId)

  const now = Math.floor(Date.now() / 1000)
  const periodFinish = farm.periodFinish !== undefined ? Number(farm.periodFinish) : undefined
  const status: 'active' | 'ended' | 'pending' =
    periodFinish === undefined || periodFinish === 0 ? 'pending' : periodFinish > now ? 'active' : 'ended'

  const endsLabel = ((): string => {
    if (periodFinish === undefined) {
      return '—'
    }
    if (periodFinish === 0) {
      return 'Not started'
    }
    return periodFinish > now ? `in ${fmtDuration(periodFinish - now)}` : 'Ended'
  })()

  // Reward-period start = finish − duration (both live on-chain reads).
  const periodStart =
    periodFinish !== undefined && periodFinish > 0 && farm.rewardsDuration !== undefined
      ? periodFinish - Number(farm.rewardsDuration)
      : undefined

  const rewardPerDay = farm.rewardRate !== undefined ? farm.rewardRate * BigInt(SECONDS_PER_DAY) : undefined

  // Rewards remaining — what the farm will actually stream: rewardRate × secondsLeft.
  const rewardsRemaining =
    farm.rewardRate !== undefined && periodFinish !== undefined
      ? periodFinish > now
        ? farm.rewardRate * BigInt(periodFinish - now)
        : 0n
      : undefined

  const totalStakedValue =
    indexed?.tvlUsd !== undefined ? fmtUsd(indexed.tvlUsd) : `${fmtAmount(farm.totalStaked, farm.stakingDecimals)} ${stakingSymbol ?? ''}`.trim()
  const totalStakedSub =
    indexed?.tvlUsd !== undefined ? `${fmtAmount(farm.totalStaked, farm.stakingDecimals)} ${stakingSymbol ?? ''}`.trim() : undefined

  const feeLabel = ((): string => {
    if (protocolFeeBps === undefined) {
      return feeRead.isLoading ? '…' : '—'
    }
    return protocolFeeBps === 0n ? 'None' : `${(Number(protocolFeeBps) / 100).toLocaleString('en-US')}%`
  })()

  /* ------------------------------------------------------------- action wiring */

  const stakeLabel = ((): string => {
    if (!farm.validStake) {
      return 'Enter an amount to stake'
    }
    if (!farm.allowanceKnown) {
      return 'Checking approval…'
    }
    if (farm.needsApproval) {
      return farm.pendingAction === 'approve' ? 'Approving…' : 'Approve staking token'
    }
    return farm.pendingAction === 'stake' ? 'Staking…' : 'Stake'
  })()

  const onStakePrimary = (): void => void (farm.needsApproval ? farm.approve() : farm.stake())
  const stakeDisabled = farm.needsApproval ? !farm.canApprove : !farm.canStake

  /* ------------------------------------------------------------- render */

  const pairName = stakingSymbol && rewardSymbol ? `${stakingSymbol} → ${rewardSymbol}` : (stakingSymbol ?? 'Farm')
  const metaTitle = `${pairName} · HookSwap Farm`

  return (
    <div style={PAGE_WRAP}>
      <Helmet>
        <title>{metaTitle}</title>
        <meta name="description" content={`Stake ${stakingSymbol ?? 'tokens'} to earn ${rewardSymbol ?? 'rewards'} on ${chainLabel} — a HookSwap staking farm. Live TVL, reward rate and APR.`} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={`Stake ${stakingSymbol ?? 'tokens'} to earn ${rewardSymbol ?? 'rewards'} on HookSwap.`} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={metaTitle} />
        <meta name="twitter:description" content={`Stake ${stakingSymbol ?? 'tokens'} to earn ${rewardSymbol ?? 'rewards'} on HookSwap.`} />
      </Helmet>

      <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* ---------------------------------------------- hero */}
        <InstrumentPanel corners style={{ padding: 0 }}>
          <div style={{ padding: '24px 26px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <PairAvatar
                chainId={chainId}
                stakingToken={farm.stakingToken}
                rewardsToken={farm.rewardsToken}
                stakingSymbol={stakingSymbol}
                rewardSymbol={rewardSymbol}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink }}>
                    {stakingSymbol ?? '…'} <span style={{ color: terminalColors.ink3, fontWeight: 500 }}>→</span> {rewardSymbol ?? '…'}
                  </span>
                  <StatusPill status={status} />
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: terminalColors.ink3Alt,
                      background: terminalColors.panel2,
                      padding: '3px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {chainLabel}
                  </span>
                </div>
                <div style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3, marginTop: 4 }}>
                  Stake {stakingSymbol ?? 'tokens'} · earn {rewardSymbol ?? 'rewards'} · staking-rewards farm
                </div>
                <div style={{ marginTop: 8 }}>
                  <ExplorerAddress address={address} chainId={chainId} short={false} fontSize={12} />
                </div>
              </div>
              {/* Headline APR (indexer only — honest "—" when unpriced) */}
              <div style={{ textAlign: 'right', minWidth: 120 }}>
                <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: indexed?.aprPct !== undefined ? terminalColors.greenDeep : terminalColors.ink3 }}>
                  {fmtApr(indexed?.aprPct)}
                </div>
                <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3, marginTop: 2 }}>APR</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
              <button type="button" onClick={onCopy} style={{ ...secondaryBtnStyle, flex: '0 1 200px' }}>
                {copied ? '✓ Link copied' : 'Copy share link'}
              </button>
            </div>
          </div>
        </InstrumentPanel>

        {/* ---------------------------------------------- KPI row (real only) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Kpi label="Total staked" value={totalStakedValue} sub={totalStakedSub} />
          <Kpi
            label="Reward rate"
            value={rewardPerDay !== undefined ? `${fmtAmount(rewardPerDay, farm.rewardDecimals)}` : '—'}
            sub={rewardPerDay !== undefined ? `${rewardSymbol ?? ''} / day`.trim() : undefined}
          />
          <Kpi
            label="Rewards remaining"
            value={rewardsRemaining !== undefined ? `${fmtAmount(rewardsRemaining, farm.rewardDecimals)} ${rewardSymbol ?? ''}`.trim() : '—'}
          />
          <Kpi label="Period ends" value={endsLabel} valueColor={status === 'ended' ? terminalColors.warn : undefined} />
          <Kpi
            label="Your staked"
            value={onCorrectChain ? `${fmtAmount(farm.staked, farm.stakingDecimals)} ${stakingSymbol ?? ''}`.trim() : '—'}
          />
          <Kpi
            label="Your earned"
            value={onCorrectChain ? `${fmtAmount(farm.earned, farm.rewardDecimals)} ${rewardSymbol ?? ''}`.trim() : '—'}
            valueColor={onCorrectChain && farm.earned !== undefined && farm.earned > 0n ? terminalColors.greenUp : undefined}
          />
        </div>

        {/* ---------------------------------------------- actions + metadata */}
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 18, alignItems: 'flex-start' }}>
          {/* Actions card (wallet-gated) */}
          <div style={{ flex: isMobile ? '1 1 auto' : '0 0 360px', minWidth: 0, width: isMobile ? '100%' : undefined }}>
            <InstrumentPanel title="STAKE / MANAGE" corners>
              {!connected ? (
                <ConnectInline text={`Connect a wallet to stake ${stakingSymbol ?? 'tokens'} in this farm.`} onConnect={() => accountDrawer.open()} />
              ) : !onCorrectChain ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
                  <Notice tone="muted">
                    Your wallet is on a different network. Switch to {chainLabel} to stake, claim or unstake in this farm.
                  </Notice>
                  <PrimaryButton label={`Switch to ${chainLabel}`} onClick={() => void selectChain(chainId as UniverseChainId)} />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {/* Stake */}
                  <div>
                    <FieldLabel>Amount to stake ({stakingSymbol ?? 'tokens'})</FieldLabel>
                    <TextField
                      value={stakeAmount}
                      onChange={(v) => setStakeAmount(v.replace(/[^0-9.]/g, ''))}
                      placeholder="0.00"
                      inputMode="decimal"
                      suffix={stakingSymbol}
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
                          ? `Claim ${fmtAmount(farm.earned, farm.rewardDecimals)} ${rewardSymbol ?? ''}`.trim()
                          : 'Nothing to claim'
                    }
                    onClick={() => void farm.claim()}
                    disabled={!farm.canClaim}
                  />

                  {/* Unstake */}
                  <div>
                    <FieldLabel>Amount to unstake ({stakingSymbol ?? 'tokens'})</FieldLabel>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <TextField
                          value={unstakeAmount}
                          onChange={(v) => setUnstakeAmount(v.replace(/[^0-9.]/g, ''))}
                          placeholder="0.00"
                          inputMode="decimal"
                          suffix={stakingSymbol}
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

          {/* Metadata + your position */}
          <div style={{ flex: '1 1 auto', minWidth: 0, width: isMobile ? '100%' : undefined, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <InstrumentPanel title="FARM DETAILS">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <MetaRow label="Staking token" value={stakingSymbol} address={farm.stakingToken} chainId={chainId} />
                <MetaRow label="Reward token" value={rewardSymbol} address={farm.rewardsToken} chainId={chainId} />
                <MetaRow label="Farm contract" address={address} chainId={chainId} />
                {factoryAddress ? <MetaRow label="Factory" address={factoryAddress} chainId={chainId} /> : null}
                <MetaRow label="Reward duration" value={farm.rewardsDuration !== undefined ? fmtDuration(Number(farm.rewardsDuration)) : '—'} />
                <MetaRow label="Period start" value={fmtDate(periodStart)} />
                <MetaRow label="Period end" value={fmtDate(periodFinish)} />
                <MetaRow label="Protocol fee" value={feeLabel} />
              </div>
              <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, lineHeight: 1.5, marginTop: 12 }}>
                Reward rate, staked balances and the period window are live on-chain reads. USD TVL and APR come from the
                priced farms indexer and show “—” on chains without a USD anchor. The staking-rewards contract stores no
                creator or creation date, so those aren’t shown — never guessed.
              </div>
            </InstrumentPanel>

            {/* Your position */}
            {connected && onCorrectChain ? (
              <InstrumentPanel title="YOUR POSITION">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                  <Kpi label="Your staked" value={`${fmtAmount(farm.staked, farm.stakingDecimals)} ${stakingSymbol ?? ''}`.trim()} />
                  <Kpi
                    label="Claimable"
                    value={`${fmtAmount(farm.earned, farm.rewardDecimals)} ${rewardSymbol ?? ''}`.trim()}
                    valueColor={farm.earned !== undefined && farm.earned > 0n ? terminalColors.greenUp : undefined}
                  />
                </div>
              </InstrumentPanel>
            ) : null}
          </div>
        </div>

        <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, lineHeight: 1.5 }}>
          Reward rate · staked balances · period window · your stake and rewards are live on-chain reads; USD TVL and APR
          come from the priced farms indexer (omitted where a chain has no USD anchor — never fabricated).
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ button styles */

const secondaryBtnStyle: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 13,
  fontWeight: 600,
  color: terminalColors.ink2,
  background: terminalColors.bg,
  border: `1px solid ${terminalColors.line}`,
  borderRadius: 10,
  padding: '11px 16px',
  cursor: 'pointer',
}
