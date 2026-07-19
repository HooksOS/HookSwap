/**
 * HookSwapPerps — "Launch a Perp Market" self-service wizard + live markets directory.
 *
 * Launches an isolated perp market against the deployed `PerpMarketFactory` in ONE
 * client-side tx (no backend, no approval) — the only value moved is the native
 * `listingFee`. Below the wizard, a directory reads the on-chain `MarketRegistry` and
 * lists every market with its tier badge + mono addresses.
 *
 * DATA POLICY (no mock data — handoff hard rule):
 *   • Listing fee — REAL on-chain read (`listingFee()`), forwarded as `value` (0 = free).
 *   • marketId — computed keccak256(utf8Bytes(label)); shown live.
 *   • Create — REAL write; simulated first so an un-allowlisted oracle venue / underfunded
 *     fee surfaces as an honest error before broadcast. The new market address is DECODED
 *     from the `MarketCreated` log — never fabricated.
 *   • Directory — REAL `marketCount()` + `getMarkets(0, count)`; honest loading / empty
 *     ("No markets yet — be the first to launch one.") states.
 *   • Not deployed on the current chain → an honest "switch to Sepolia" banner (the factory
 *     is validated on Sepolia first per the mandatory-Sepolia rule); the write is disabled.
 */
import { useEffect, useMemo, useState } from 'react'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { ExplorerDataType, getExplorerLink } from 'uniswap/src/utils/linking'
import { formatUnits } from '~/chains'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useAccount } from '~/hooks/useAccount'
import { useSelectChain } from '~/hooks/useSelectChain'
import { Eyebrow, InstrumentPanel, terminalKeycap } from '~/terminal/components/InstrumentPanel'
import { StatCard } from '~/terminal/components/StatCard'
import { getPerpsFactoryDeployment, PERPS_FACTORY_HOME_CHAIN } from '~/terminal/perps/factory/abis'
import {
  CHAINLINK_SOURCE_TYPE,
  defaultChainlinkOracleConfig,
  FEE_RATE_MAX_BPS,
  FEE_RATE_MIN_BPS,
  MarketTier,
  PLATFORM_MAX_LEVERAGE_X,
  useCreateMarket,
  type CreateMarketForm,
} from '~/terminal/perps/factory/useCreateMarket'
import { RegistryStatus, RegistryTier, useMarkets, type MarketRow } from '~/terminal/perps/factory/useMarkets'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { assume0xAddress } from '~/utils/wagmi'

const MONO = terminalFonts.mono
const DISPLAY = terminalFonts.display
const SANS = terminalFonts.sans

/* ------------------------------------------------------------------ helpers */

function shortAddr(a?: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—'
}

function fmtFee(wei: bigint | undefined): string {
  if (wei === undefined) {
    return '—'
  }
  if (wei === 0n) {
    return 'Free'
  }
  return `${Number(formatUnits(wei, 18)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH`
}

/* ------------------------------------------------------------------ primitives */

function Panel({
  title,
  meta,
  corners,
  children,
  padding = 18,
}: {
  title?: string
  meta?: React.ReactNode[]
  corners?: boolean
  children: React.ReactNode
  padding?: number
}): JSX.Element {
  return (
    <InstrumentPanel title={title} meta={meta} corners={corners} bodyStyle={{ padding }}>
      {children}
    </InstrumentPanel>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.ink3Alt, marginBottom: 5 }}>{children}</div>
}

function TextField({
  value,
  onChange,
  placeholder,
  mono = false,
  maxLength,
  inputMode,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  maxLength?: number
  inputMode?: 'text' | 'decimal' | 'numeric'
}): JSX.Element {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      maxLength={maxLength}
      inputMode={inputMode}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${terminalColors.line2}`,
        borderRadius: 11,
        background: terminalColors.panel,
        padding: '10px 12px',
        fontFamily: mono ? MONO : SANS,
        fontSize: 13.5,
        fontWeight: mono ? 500 : 600,
        color: terminalColors.ink,
        outline: 'none',
      }}
    />
  )
}

function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  suffix: string
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: terminalColors.brandGreen, cursor: 'pointer' }}
      />
      <span
        style={{
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 600,
          color: terminalColors.ink,
          minWidth: 62,
          textAlign: 'right',
        }}
      >
        {value}
        {suffix}
      </span>
    </div>
  )
}

function SummaryRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0' }}>
      <span style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500, color: valueColor ?? terminalColors.ink }}>
        {value}
      </span>
    </div>
  )
}

function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'green' | 'muted' | 'red' | 'warn'
  children: React.ReactNode
}): JSX.Element {
  const border =
    tone === 'green'
      ? terminalColors.greenBorder
      : tone === 'red'
        ? terminalColors.redDown
        : tone === 'warn'
          ? terminalColors.warn
          : terminalColors.line
  const bg =
    tone === 'green'
      ? terminalColors.greenBg
      : tone === 'red'
        ? terminalColors.redBg
        : tone === 'warn'
          ? terminalColors.warnBg
          : terminalColors.panel
  const color =
    tone === 'green'
      ? terminalColors.greenDeep
      : tone === 'red'
        ? terminalColors.redDown
        : tone === 'warn'
          ? terminalColors.warn
          : terminalColors.ink2
  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: 12,
        lineHeight: 1.5,
        color,
        background: bg,
        border: `1px ${tone === 'muted' ? 'dashed' : 'solid'} ${border}`,
        borderRadius: 11,
        padding: '10px 12px',
      }}
    >
      {children}
    </div>
  )
}

function PrimaryButton({
  label,
  onClick,
  disabled,
  variant = 'solid',
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'solid' | 'outline'
}): JSX.Element {
  const solid = variant === 'solid'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        marginTop: 12,
        width: '100%',
        fontFamily: MONO,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding: '12px 0',
        cursor: disabled ? 'default' : 'pointer',
        ...(solid
          ? {
              color: terminalColors.btnInk,
              background: disabled ? terminalColors.line : terminalColors.brandGreen,
              border: 'none',
              borderRadius: 12,
            }
          : { ...terminalKeycap, borderRadius: 12 }),
      }}
    >
      {label}
    </button>
  )
}

/** Pill-style toggle group (tier select). */
function ToggleRow({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[]
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              color: active ? terminalColors.greenDeep : terminalColors.ink3Alt,
              background: active ? terminalColors.greenBg : 'transparent',
              border: `1px solid ${active ? terminalColors.greenBorder : terminalColors.line}`,
              borderRadius: 8,
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** Tier badge for the directory rows. */
function TierBadge({ tier }: { tier: RegistryTier }): JSX.Element {
  const curated = tier === RegistryTier.Curated
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        color: curated ? terminalColors.greenDeep : terminalColors.accentIndigo,
        background: curated ? terminalColors.greenBg : terminalColors.panel2,
        border: `1px solid ${curated ? terminalColors.greenBorder : terminalColors.line}`,
        borderRadius: 999,
        padding: '2px 8px',
      }}
    >
      {curated ? 'CURATED' : 'PERMISSIONLESS'}
    </span>
  )
}

function statusLabel(status: RegistryStatus): string {
  switch (status) {
    case RegistryStatus.Active:
      return 'Active'
    case RegistryStatus.Paused:
      return 'Paused'
    case RegistryStatus.Delisted:
      return 'Delisted'
    default:
      return '—'
  }
}

/* ------------------------------------------------------------------ directory */

function MarketsDirectory({ chainId }: { chainId?: number }): JSX.Element {
  const { ready, markets, count, isLoading, error } = useMarkets({ chainId })

  const explorer = (addr: string): string | undefined => {
    if (chainId === undefined) {
      return undefined
    }
    try {
      return getExplorerLink({ chainId: chainId as UniverseChainId, data: addr, type: ExplorerDataType.ADDRESS })
    } catch {
      return undefined
    }
  }

  return (
    <Panel title="Live markets" meta={ready && count !== undefined ? [`${count} total`] : isLoading ? ['loading…'] : undefined}>
      {!ready ? (
        <Notice tone="muted">The market registry isn&apos;t deployed on this chain yet.</Notice>
      ) : error ? (
        <Notice tone="red">Couldn&apos;t read the market registry. Retry in a moment.</Notice>
      ) : markets === undefined ? (
        <Notice tone="muted">Loading markets…</Notice>
      ) : markets.length === 0 ? (
        <Notice tone="muted">No markets yet — be the first to launch one.</Notice>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {markets.map((m: MarketRow) => {
            const href = explorer(m.market)
            return (
              <div
                key={m.market}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: `1px solid ${terminalColors.line}`,
                  borderRadius: 10,
                  padding: '9px 11px',
                }}
              >
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: terminalColors.brandGreen, textDecoration: 'none' }}
                  >
                    {shortAddr(m.market)}
                  </a>
                ) : (
                  <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: terminalColors.ink }}>
                    {shortAddr(m.market)}
                  </span>
                )}
                <TierBadge tier={m.tier} />
                <span style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.ink3Alt }}>
                  {statusLabel(m.status)}
                </span>
                <span style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, marginLeft: 'auto' }}>
                  by {shortAddr(m.creator)}
                </span>
              </div>
            )
          })}
        </div>
      )}
      <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
        Markets are read live from the on-chain MarketRegistry. The human label isn&apos;t stored on-chain — only its
        keccak marketId — so rows show the market address + creator.
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ the screen */

export function CreatePerpMarketScreen(): JSX.Element {
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  const selectChain = useSelectChain()

  const chainId = account.chainId ?? PERPS_FACTORY_HOME_CHAIN
  const connected = Boolean(account.address)
  const owner = assume0xAddress(account.address)

  const deployment = getPerpsFactoryDeployment(chainId)
  const deployed = Boolean(deployment)
  const chainLabel = getChainLabel(chainId)
  const homeLabel = getChainLabel(PERPS_FACTORY_HOME_CHAIN)
  // Defaults are sourced from whichever deployment applies (the current chain if deployed,
  // else the canonical home deploy) so the oracle/collateral fields pre-fill sensibly.
  const defaults = deployment ?? getPerpsFactoryDeployment(PERPS_FACTORY_HOME_CHAIN)

  /* --------------------------------------------------------------- form state */

  const [label, setLabel] = useState('')
  const [collateral, setCollateral] = useState(defaults?.weth ?? '')
  const [collateralDecimals, setCollateralDecimals] = useState('18')
  const [creator, setCreator] = useState('')
  const [feeRateBps, setFeeRateBps] = useState(5)
  const [maxLeverageX, setMaxLeverageX] = useState(10)
  const [tier, setTier] = useState<MarketTier>(MarketTier.Curated)
  const [venue, setVenue] = useState(defaults?.ethUsdRefFeed ?? '')
  const [refFeed, setRefFeed] = useState(defaults?.ethUsdRefFeed ?? '')

  // Default the creator to the connected wallet once it's known (still editable after).
  useEffect(() => {
    if (owner && creator === '') {
      setCreator(owner)
    }
  }, [owner, creator])

  const decimalsNum = ((): number => {
    const n = Number(collateralDecimals)
    return Number.isInteger(n) && n >= 0 && n <= 36 ? n : 18
  })()

  const form: CreateMarketForm = useMemo(
    () => ({
      label,
      collateral,
      collateralDecimals: decimalsNum,
      creator: creator || (owner ?? ''),
      feeRateBps,
      maxLeverageX,
      tier,
      oracle: {
        ...defaultChainlinkOracleConfig(assume0xAddress(refFeed || defaults?.ethUsdRefFeed) as `0x${string}`, tier),
        venue: assume0xAddress(venue || defaults?.ethUsdRefFeed) as `0x${string}`,
        refFeed: assume0xAddress(refFeed || defaults?.ethUsdRefFeed) as `0x${string}`,
      },
    }),
    [label, collateral, decimalsNum, creator, owner, feeRateBps, maxLeverageX, tier, venue, refFeed, defaults],
  )

  const state = useCreateMarket({ chainId, owner, form })

  /* --------------------------------------------------------------- primary action */

  const busy = state.isWritePending || state.isConfirming

  const onPrimary = (): void => {
    if (!connected) {
      accountDrawer.open()
      return
    }
    if (state.wrongChain) {
      void selectChain(PERPS_FACTORY_HOME_CHAIN)
      return
    }
    if (state.isDone) {
      state.reset()
      setLabel('')
      return
    }
    void state.create()
  }

  const primaryLabel = ((): string => {
    if (!connected) {
      return 'Connect wallet to launch a market'
    }
    if (state.wrongChain) {
      return `Switch to ${homeLabel}`
    }
    if (!deployed) {
      return 'Not available on this network'
    }
    if (state.isDone) {
      return 'Launch another market'
    }
    if (!state.inputsValid) {
      return 'Complete the market details'
    }
    if (state.isWritePending) {
      return 'Confirm in wallet…'
    }
    if (state.isConfirming) {
      return 'Launching market…'
    }
    if (state.simulateOk === false) {
      return 'Cannot launch — check oracle / fee'
    }
    return 'Launch market'
  })()

  const primaryDisabled = ((): boolean => {
    if (!connected) {
      return false
    }
    if (state.wrongChain) {
      return false
    }
    if (!deployed) {
      return true
    }
    if (state.isDone) {
      return false
    }
    if (busy) {
      return true
    }
    return !state.canCreate
  })()

  /* --------------------------------------------------------------- stat values */

  const symbolValue = label.trim() !== '' ? label.trim().toUpperCase() : '—'
  const feeValue = `${feeRateBps} bps`
  const levValue = `${maxLeverageX}×`
  const tierValue = tier === MarketTier.Curated ? 'Curated' : 'Permissionless'

  return (
    <div style={{ padding: '20px var(--tm-gutter) 40px' }}>
      {/* Header */}
      <Eyebrow style={{ display: 'block', marginBottom: 8 }}>HookSwapPerps · Self-service listing</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink, margin: 0 }}>
          Launch a perp market
        </h1>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 600,
            color: terminalColors.greenDeep,
            background: terminalColors.greenBg,
            border: `1px solid ${terminalColors.greenBorder}`,
            padding: '3px 8px',
            borderRadius: 999,
          }}
        >
          isolated market · one tx
        </span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: terminalColors.ink2, marginBottom: 18, maxWidth: 620, lineHeight: 1.5 }}>
        Permissionlessly list a new isolated perpetual market on HookSwapPerps in a single transaction. Pick the
        collateral, fee rate, leverage cap, tier, and oracle source — the factory deploys the market and registers it.
      </div>

      {/* Wrong-chain / not-deployed banner */}
      {connected && state.wrongChain ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warn">
            The perp-market factory is deployed on <strong>{homeLabel}</strong> (the canonical validation chain). You&apos;re
            connected to {chainLabel} — switch to {homeLabel} to launch a market.
          </Notice>
        </div>
      ) : connected && !deployed && !state.wrongChain ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="muted">The perp-market factory isn&apos;t deployed on {chainLabel} yet.</Notice>
        </div>
      ) : null}

      {/* Stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatCard size="lg" label="Market" value={symbolValue} />
        <StatCard size="lg" label="Fee (per side)" value={feeValue} />
        <StatCard size="lg" label="Max leverage" value={levValue} />
        <StatCard size="lg" label="Tier" value={tierValue} />
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: market config */}
        <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="01 · Market">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <FieldLabel>Market label</FieldLabel>
                <TextField value={label} onChange={(v) => setLabel(v.toUpperCase())} placeholder="BTC-PERP" mono maxLength={32} />
                <div style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.faint, marginTop: 5, wordBreak: 'break-all' }}>
                  marketId {state.marketId ?? '—'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: '2 1 220px', minWidth: 0 }}>
                  <FieldLabel>Collateral token</FieldLabel>
                  <TextField value={collateral} onChange={setCollateral} placeholder="0x…" mono />
                </div>
                <div style={{ flex: '1 1 100px', minWidth: 0 }}>
                  <FieldLabel>Decimals</FieldLabel>
                  <TextField
                    value={collateralDecimals}
                    onChange={(v) => setCollateralDecimals(v.replace(/[^0-9]/g, '').slice(0, 2))}
                    placeholder="18"
                    mono
                    inputMode="numeric"
                  />
                </div>
              </div>
              {defaults?.weth && collateral.toLowerCase() === defaults.weth.toLowerCase() ? (
                <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint }}>
                  Default: WETH ({shortAddr(defaults.weth)}).
                </div>
              ) : null}
              <div>
                <FieldLabel>Creator (fee beneficiary)</FieldLabel>
                <TextField value={creator} onChange={setCreator} placeholder="0x… (defaults to your wallet)" mono />
              </div>
            </div>
          </Panel>

          <Panel title="02 · Parameters">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <FieldLabel>
                  Fee rate — per side, {FEE_RATE_MIN_BPS}–{FEE_RATE_MAX_BPS} bps
                </FieldLabel>
                <Slider value={feeRateBps} min={FEE_RATE_MIN_BPS} max={FEE_RATE_MAX_BPS} onChange={setFeeRateBps} suffix=" bps" />
              </div>
              <div>
                <FieldLabel>Max leverage — 1–{PLATFORM_MAX_LEVERAGE_X}× (platform cap)</FieldLabel>
                <Slider value={maxLeverageX} min={1} max={PLATFORM_MAX_LEVERAGE_X} onChange={setMaxLeverageX} suffix="×" />
              </div>
              <div>
                <FieldLabel>Tier</FieldLabel>
                <ToggleRow
                  options={[
                    { label: 'Curated', value: String(MarketTier.Curated) },
                    { label: 'Permissionless', value: String(MarketTier.Permissionless) },
                  ]}
                  value={String(tier)}
                  onChange={(v) => setTier(Number(v) as MarketTier)}
                />
                <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 6, lineHeight: 1.5 }}>
                  {tier === MarketTier.Permissionless
                    ? 'Permissionless markets require a dual-source oracle (AMM + reference feed must agree).'
                    : 'Curated markets can list against a single trusted source.'}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="03 · Oracle">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <FieldLabel>Source type</FieldLabel>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    height: 40,
                    padding: '0 12px',
                    border: `1px solid ${terminalColors.line}`,
                    borderRadius: 11,
                    background: terminalColors.panel2,
                    fontFamily: SANS,
                    fontSize: 13,
                    fontWeight: 500,
                    color: terminalColors.ink,
                  }}
                >
                  <span>Chainlink</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: terminalColors.faint }}>
                    {shortAddr(CHAINLINK_SOURCE_TYPE)}
                  </span>
                </div>
              </div>
              <div>
                <FieldLabel>Venue (allowlisted feed)</FieldLabel>
                <TextField value={venue} onChange={setVenue} placeholder="0x…" mono />
              </div>
              <div>
                <FieldLabel>Reference feed (Chainlink)</FieldLabel>
                <TextField value={refFeed} onChange={setRefFeed} placeholder="0x…" mono />
              </div>
              <SummaryRow label="Max deviation" value="500 bps" />
              <SummaryRow label="Max staleness" value="86400 s" />
              <SummaryRow label="Dual-source required" value={tier === MarketTier.Permissionless ? 'Yes' : 'No'} />
              <Notice tone="muted">
                Default: the Sepolia ETH/USD Chainlink feed — the only venue allowlisted in OracleGuard today. Other venues
                must be allowlisted by the platform before a market can list against them, or the launch will revert.
              </Notice>
            </div>
          </Panel>
        </div>

        {/* Right: review + launch */}
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Review" corners>
            <SummaryRow label="Market" value={symbolValue} />
            <SummaryRow label="Collateral" value={collateral.trim() !== '' ? shortAddr(collateral) : '—'} />
            <SummaryRow label="Fee (per side)" value={feeValue} />
            <SummaryRow label="Max leverage" value={levValue} />
            <SummaryRow label="Tier" value={tierValue} />
            <SummaryRow label="Oracle" value="Chainlink" />
            <SummaryRow label="Listing fee" value={deployed ? fmtFee(state.listingFee) : '—'} />
            <SummaryRow label="Creation bond" value={deployed ? fmtFee(state.bond) : '—'} />
            <SummaryRow label="Total to pay" value={deployed ? fmtFee(state.totalCost) : '—'} />
            <SummaryRow label="Creator" value={creator.trim() !== '' ? shortAddr(creator) : connected && owner ? shortAddr(owner) : '—'} />
            <SummaryRow label="Network" value={deployed ? chainLabel : state.wrongChain ? homeLabel : 'Not available'} />

            <PrimaryButton label={primaryLabel} onClick={onPrimary} disabled={primaryDisabled} />

            {state.isDone ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Notice tone="green">Market launched — the isolated market is deployed and registered.</Notice>
                {state.marketAddress ? <SummaryRow label="Market address" value={shortAddr(state.marketAddress)} /> : null}
              </div>
            ) : state.error ? (
              <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 10, lineHeight: 1.5 }}>
                {state.error}
              </div>
            ) : state.simulateError && state.inputsValid && !state.wrongChain ? (
              <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 10, lineHeight: 1.5 }}>
                Simulation reverted: {state.simulateError}
              </div>
            ) : deployed ? (
              <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
                One transaction — no approval. The listing fee (if any) is forwarded to the treasury. Your new market
                address appears here on success.
              </div>
            ) : null}
          </Panel>

          <MarketsDirectory chainId={chainId} />
        </div>
      </div>
    </div>
  )
}
