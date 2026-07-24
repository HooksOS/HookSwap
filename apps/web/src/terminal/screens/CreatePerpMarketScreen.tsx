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
import { getChainLabel, isTestnetChain } from 'uniswap/src/features/chains/utils'
import { ExplorerDataType } from 'uniswap/src/utils/linking'
import { formatUnits } from '~/chains'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useAccount } from '~/hooks/useAccount'
import { useSelectChain } from '~/hooks/useSelectChain'
import { ExplorerAddress, shortAddr } from '~/terminal/components/ExplorerAddress'
import { Eyebrow, InstrumentPanel, terminalKeycap } from '~/terminal/components/InstrumentPanel'
import { PerpsTutorial, type TutorialStep } from '~/terminal/screens/perps/PerpsTutorial'
import { StatCard } from '~/terminal/components/StatCard'
import {
  getPerpsFactoryDeployment,
  PERPS_FACTORY_ADDRESSES,
  PERPS_FACTORY_HOME_CHAIN,
} from '~/terminal/perps/factory/abis'
import {
  CHAINLINK_SOURCE_TYPE,
  DEFAULT_MAX_DEVIATION_BPS,
  DEFAULT_MAX_STALENESS,
  FEE_RATE_MAX_BPS,
  FEE_RATE_MIN_BPS,
  MarketTier,
  PLATFORM_MAX_LEVERAGE_X,
  useAllowlistedAssets,
  useCreateMarket,
  type CreateMarketForm,
  type OracleAssetCandidate,
} from '~/terminal/perps/factory/useCreateMarket'
import { RegistryStatus, RegistryTier, useMarkets, type MarketRow } from '~/terminal/perps/factory/useMarkets'
import { useMarketNames } from '~/terminal/perps/factory/useMarketNames'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { assume0xAddress } from '~/utils/wagmi'

const MONO = terminalFonts.mono
const DISPLAY = terminalFonts.display
const SANS = terminalFonts.sans

/* ---------------------------------------------------- creator launch walkthrough */

/**
 * First-visit tour of the launch flow for market creators. Explains each field in
 * plain terms — including why on-chain addresses (collateral token, oracle feed)
 * appear: they are contract locations, pre-filled with sensible defaults, that
 * most creators never need to touch.
 */
const LAUNCH_TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Launch your own perp market',
    body: 'Anyone can list a new isolated perpetual market in a single transaction, and earn a share of every trade on it. This 30-second tour shows what each field does — most creators only set a name and launch.',
  },
  {
    target: 'launch-overview',
    title: 'Live preview',
    body: 'These tiles preview your market as you build it: its symbol, the per-side fee you earn, the max leverage traders get, and its listing tier. They update live from the form below.',
  },
  {
    target: 'launch-market',
    title: '1 · Market',
    body: 'Name the market (e.g. BTC-PERP) — that derives its on-chain marketId. Collateral is the token traders post as margin; it defaults to the chain’s stablecoin (e.g. USDG) so margin is dollar-stable — you can switch to WETH or a custom token. Creator is the wallet that receives your fee share.',
  },
  {
    target: 'launch-params',
    title: '2 · Parameters',
    body: 'Set the fee you earn per side (2–15 bps) — you keep 40% of every trade’s fee on your market. Then the max leverage (up to the platform cap) and the tier. Curated lists against a single trusted price source; Permissionless requires two independent sources to agree.',
  },
  {
    target: 'launch-oracle',
    title: '3 · Price source',
    body: 'Just pick what you’re listing — e.g. ETH — and the market uses that asset’s allowlisted Chainlink feed automatically. No addresses to paste. Only assets the platform has allowlisted appear; more show up as feeds are added. Power users can open Advanced to set a custom oracle by hand.',
  },
  {
    target: 'launch-review',
    title: 'Review & launch',
    body: 'Check the summary, including the listing fee and the refundable creation bond you pay. Connect your wallet and launch — the factory deploys your isolated market in one transaction and its address appears here.',
  },
]

/* ------------------------------------------------------------------ helpers */

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

function SummaryRow({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }): JSX.Element {
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

/**
 * Which chain's markets the "Live markets" directory should list. HookSwapPerps factories
 * are deployed on Sepolia (11155111, the test chain) AND Robinhood (4663, mainnet). Default
 * the DIRECTORY to a MAINNET so the live DEX never shows Sepolia's test markets; only list
 * Sepolia's markets when the wallet is actually connected to Sepolia (the testing path).
 * Mirrors `resolvePerpsDirectoryChain` in PerpsScreen — the wizard's own create flow still
 * targets whatever chain the wallet is on (with the existing wrong-chain state).
 */
function resolvePerpsDirectoryChain(connectedChainId: number | undefined): UniverseChainId {
  if (connectedChainId !== undefined && PERPS_FACTORY_ADDRESSES[connectedChainId as UniverseChainId]) {
    return connectedChainId as UniverseChainId
  }
  if (PERPS_FACTORY_ADDRESSES[UniverseChainId.Robinhood]) {
    return UniverseChainId.Robinhood
  }
  const firstMainnet = (Object.keys(PERPS_FACTORY_ADDRESSES).map(Number) as UniverseChainId[]).find(
    (id) => !isTestnetChain(id),
  )
  return firstMainnet ?? PERPS_FACTORY_HOME_CHAIN
}

function MarketsDirectory({ chainId }: { chainId?: number }): JSX.Element {
  const { ready, markets, count, isLoading, error } = useMarkets({ chainId })

  // Derive a human name per market from its on-chain Chainlink refFeed ("ETH / USD" →
  // "ETH-PERP"). The label isn't stored on-chain (marketId = one-way keccak) so this reads
  // the market's oracle instead; markets whose feed is unreadable stay address-only (honest).
  const nameInputs = useMemo(
    () => markets?.map((m) => ({ market: m.market, collateral: m.collateral })),
    [markets],
  )
  const { names } = useMarketNames({ markets: nameInputs, chainId })

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
            const resolved = names.get(m.market.toLowerCase())
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
                {resolved ? (
                  // Name derived from the market's Chainlink refFeed → show it prominently,
                  // address secondary. Several markets can share a feed → the short address
                  // (in the title) disambiguates.
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 1 }}
                    title={`${resolved.name}${resolved.refFeedDescription ? ` · feed ${resolved.refFeedDescription}` : ''} · ${m.market}`}
                  >
                    <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: terminalColors.ink }}>
                      {resolved.name}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: terminalColors.faint }}>
                      {resolved.collateralSymbol ? `${resolved.collateralSymbol} · ` : ''}
                      {shortAddr(m.market)}
                    </span>
                  </div>
                ) : (
                  // No readable feed → honest address-only identity (unchanged behavior).
                  <ExplorerAddress address={m.market} chainId={chainId} fontSize={12} fontWeight={500} />
                )}
                <TierBadge tier={m.tier} />
                <span style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.ink3Alt }}>
                  {statusLabel(m.status)}
                </span>
                <span style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, marginLeft: 'auto' }}>
                  by <ExplorerAddress address={m.creator} chainId={chainId} fontSize={11} />
                </span>
              </div>
            )
          })}
        </div>
      )}
      <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
        Markets are read live from the on-chain MarketRegistry. The creator&apos;s label isn&apos;t stored on-chain — only
        its keccak marketId — so each name is derived from the market&apos;s Chainlink reference feed (e.g. &ldquo;ETH /
        USD&rdquo; → ETH-PERP); markets whose feed can&apos;t be read show the market address instead.
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

  // The "Live markets" directory lists the connected MAINNET's markets (default Robinhood),
  // never Sepolia's test markets — unless the wallet is actually connected to Sepolia. The
  // create flow above still targets the wallet's chain (with the wrong-chain state).
  const directoryChainId = resolvePerpsDirectoryChain(account.chainId)

  // Creator walkthrough — auto-starts once (localStorage), replayable via the header button.
  const [tutorialOpen, setTutorialOpen] = useState(0)

  const deployment = getPerpsFactoryDeployment(chainId)
  const deployed = Boolean(deployment)
  const chainLabel = getChainLabel(chainId)
  const homeLabel = getChainLabel(PERPS_FACTORY_HOME_CHAIN)
  // Defaults are sourced from whichever deployment applies (the current chain if deployed,
  // else the canonical home deploy) so the oracle/collateral fields pre-fill sensibly.
  const defaults = deployment ?? getPerpsFactoryDeployment(PERPS_FACTORY_HOME_CHAIN)

  /* --------------------------------------------------------------- form state */

  const [label, setLabel] = useState('')
  const [creator, setCreator] = useState('')
  const [feeRateBps, setFeeRateBps] = useState(5)
  const [maxLeverageX, setMaxLeverageX] = useState(10)
  const [tier, setTier] = useState<MarketTier>(MarketTier.Curated)

  /* --- collateral: DEFAULT to the chain's stablecoin (USDG on RH), else WETH --- */
  type CollateralPreset = 'stablecoin' | 'weth' | 'custom'
  const stablecoin = defaults?.stablecoin
  const [collateralPreset, setCollateralPreset] = useState<CollateralPreset>('stablecoin')
  const [collateral, setCollateral] = useState('')
  const [collateralDecimals, setCollateralDecimals] = useState('18')
  // Once the user picks a preset / edits custom, stop auto-following the chain default.
  const [collateralTouched, setCollateralTouched] = useState(false)

  // Auto-follow the connected chain's default collateral (stablecoin > WETH) until touched.
  useEffect(() => {
    if (collateralTouched) {
      return
    }
    if (stablecoin) {
      setCollateralPreset('stablecoin')
      setCollateral(stablecoin.address)
      setCollateralDecimals(String(stablecoin.decimals))
    } else if (defaults?.weth) {
      setCollateralPreset('weth')
      setCollateral(defaults.weth)
      setCollateralDecimals('18')
    }
  }, [collateralTouched, stablecoin, defaults?.weth])

  const pickCollateralPreset = (p: CollateralPreset): void => {
    setCollateralTouched(true)
    setCollateralPreset(p)
    if (p === 'stablecoin' && stablecoin) {
      setCollateral(stablecoin.address)
      setCollateralDecimals(String(stablecoin.decimals))
    } else if (p === 'weth' && defaults?.weth) {
      setCollateral(defaults.weth)
      setCollateralDecimals('18')
    } else if (p === 'custom') {
      setCollateral('')
      setCollateralDecimals('18')
    }
  }

  /* --- oracle: friendly ASSET picker (allowlisted Chainlink feeds), advanced override --- */
  const { assets: allowlistedAssets, isLoading: assetsLoading } = useAllowlistedAssets({ chainId })
  const [selectedAssetSymbol, setSelectedAssetSymbol] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [venue, setVenue] = useState('')
  const [refFeed, setRefFeed] = useState('')
  const [maxDeviationInput, setMaxDeviationInput] = useState(String(DEFAULT_MAX_DEVIATION_BPS))
  const [maxStalenessInput, setMaxStalenessInput] = useState(String(DEFAULT_MAX_STALENESS))

  const selectedAsset = useMemo(
    () => allowlistedAssets.find((a) => a.symbol === selectedAssetSymbol),
    [allowlistedAssets, selectedAssetSymbol],
  )

  // While NOT in advanced mode, the asset picker drives venue + refFeed. Default-select the
  // first allowlisted asset once the on-chain allowlist resolves.
  useEffect(() => {
    if (advancedOpen || allowlistedAssets.length === 0) {
      return
    }
    const pick = allowlistedAssets.find((a) => a.symbol === selectedAssetSymbol) ?? allowlistedAssets[0]
    if (pick.symbol !== selectedAssetSymbol) {
      setSelectedAssetSymbol(pick.symbol)
    }
    if (venue.toLowerCase() !== pick.feed.toLowerCase()) {
      setVenue(pick.feed)
    }
    if (refFeed.toLowerCase() !== pick.feed.toLowerCase()) {
      setRefFeed(pick.feed)
    }
  }, [advancedOpen, allowlistedAssets, selectedAssetSymbol, venue, refFeed])

  const pickAsset = (symbol: string): void => {
    setSelectedAssetSymbol(symbol)
    const a = allowlistedAssets.find((x) => x.symbol === symbol)
    if (a) {
      setVenue(a.feed)
      setRefFeed(a.feed)
    }
  }

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

  const parseBig = (s: string, fallback: bigint): bigint => {
    try {
      const n = BigInt(s.trim() || '0')
      return n > 0n ? n : fallback
    } catch {
      return fallback
    }
  }

  // Effective oracle inputs: asset-driven by default, hand-set only in Advanced mode.
  const oracleVenue = advancedOpen ? venue : (selectedAsset?.feed ?? venue)
  const oracleRefFeed = advancedOpen ? refFeed : (selectedAsset?.feed ?? refFeed)
  const oracleMaxDeviation = advancedOpen ? parseBig(maxDeviationInput, DEFAULT_MAX_DEVIATION_BPS) : DEFAULT_MAX_DEVIATION_BPS
  const oracleMaxStaleness = advancedOpen ? parseBig(maxStalenessInput, DEFAULT_MAX_STALENESS) : DEFAULT_MAX_STALENESS

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
        sourceType: CHAINLINK_SOURCE_TYPE,
        venue: assume0xAddress(oracleVenue || defaults?.ethUsdRefFeed) as `0x${string}`,
        refFeed: assume0xAddress(oracleRefFeed || defaults?.ethUsdRefFeed) as `0x${string}`,
        maxDeviationBps: oracleMaxDeviation,
        maxStaleness: oracleMaxStaleness,
        minLiquidity: 0n,
        dualSourceRequired: tier === MarketTier.Permissionless,
      },
    }),
    [
      label,
      collateral,
      decimalsNum,
      creator,
      owner,
      feeRateBps,
      maxLeverageX,
      tier,
      oracleVenue,
      oracleRefFeed,
      oracleMaxDeviation,
      oracleMaxStaleness,
      defaults,
    ],
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
      <div style={{ fontFamily: SANS, fontSize: 13, color: terminalColors.ink2, marginBottom: 12, maxWidth: 620, lineHeight: 1.5 }}>
        Permissionlessly list a new isolated perpetual market on HookSwapPerps in a single transaction, and{' '}
        <strong>earn 40% of every trade&apos;s fee</strong> on your market. Just name it and pick what you&apos;re listing —
        collateral defaults to the chain&apos;s <strong>stablecoin</strong> and the price source is chosen by asset (no
        addresses to paste). Most creators only set a name and launch.
      </div>

      <div style={{ marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => setTutorialOpen((n) => n + 1)}
          title="Walk me through launching a market"
          style={{
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 600,
            color: terminalColors.greenDeep,
            background: terminalColors.greenBg,
            border: `1px solid ${terminalColors.greenBorder}`,
            borderRadius: 8,
            padding: '6px 12px',
            cursor: 'pointer',
          }}
        >
          ? How to launch a market
        </button>
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
      <div data-tut="launch-overview" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatCard size="lg" label="Market" value={symbolValue} />
        <StatCard size="lg" label="Fee (per side)" value={feeValue} />
        <StatCard size="lg" label="Max leverage" value={levValue} />
        <StatCard size="lg" label="Tier" value={tierValue} />
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: market config */}
        <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div data-tut="launch-market">
          <Panel title="01 · Market">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <FieldLabel>Market label</FieldLabel>
                <TextField value={label} onChange={(v) => setLabel(v.toUpperCase())} placeholder="BTC-PERP" mono maxLength={32} />
                <div style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.faint, marginTop: 5, wordBreak: 'break-all' }}>
                  marketId {state.marketId ?? '—'}
                </div>
              </div>
              <div>
                <FieldLabel>Collateral — what traders post as margin</FieldLabel>
                <ToggleRow
                  options={[
                    ...(stablecoin ? [{ label: `${stablecoin.symbol} · stablecoin`, value: 'stablecoin' }] : []),
                    { label: 'WETH', value: 'weth' },
                    { label: 'Custom', value: 'custom' },
                  ]}
                  value={collateralPreset}
                  onChange={(v) => pickCollateralPreset(v as CollateralPreset)}
                />
                {collateralPreset === 'custom' ? (
                  <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                    <div style={{ flex: '2 1 220px', minWidth: 0 }}>
                      <FieldLabel>Token address</FieldLabel>
                      <TextField
                        value={collateral}
                        onChange={(v) => {
                          setCollateralTouched(true)
                          setCollateral(v)
                        }}
                        placeholder="0x…"
                        mono
                      />
                    </div>
                    <div style={{ flex: '1 1 100px', minWidth: 0 }}>
                      <FieldLabel>Decimals</FieldLabel>
                      <TextField
                        value={collateralDecimals}
                        onChange={(v) => {
                          setCollateralTouched(true)
                          setCollateralDecimals(v.replace(/[^0-9]/g, '').slice(0, 2))
                        }}
                        placeholder="18"
                        mono
                        inputMode="numeric"
                      />
                    </div>
                  </div>
                ) : collateral !== '' ? (
                  <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 8 }}>
                    {collateralPreset === 'stablecoin' ? `Default — dollar-stable margin. ` : ''}
                    <ExplorerAddress address={collateral} chainId={chainId} type={ExplorerDataType.TOKEN} fontSize={10.5} /> ·{' '}
                    {decimalsNum} decimals.
                  </div>
                ) : null}
              </div>
              <div>
                <FieldLabel>Creator (fee beneficiary)</FieldLabel>
                <TextField value={creator} onChange={setCreator} placeholder="0x… (defaults to your wallet)" mono />
              </div>
            </div>
          </Panel>
          </div>

          <div data-tut="launch-params">
          <Panel title="02 · Parameters">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <FieldLabel>
                  Fee rate — per side, {FEE_RATE_MIN_BPS}–{FEE_RATE_MAX_BPS} bps
                </FieldLabel>
                <Slider value={feeRateBps} min={FEE_RATE_MIN_BPS} max={FEE_RATE_MAX_BPS} onChange={setFeeRateBps} suffix=" bps" />
                <div style={{ marginTop: 10 }}>
                  <Notice tone="green">
                    You earn <strong>40%</strong> of every trade&apos;s fee on your market — the split is platform 50% /
                    creator 40% / insurance 10%, routed automatically by the FeeRouter.
                  </Notice>
                </div>
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
          </div>

          <div data-tut="launch-oracle">
          <Panel title="03 · Price source">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <FieldLabel>What are you listing?</FieldLabel>
                {!deployed ? (
                  <Notice tone="muted">Connect to a chain where HookSwapPerps is deployed to pick an asset.</Notice>
                ) : assetsLoading && allowlistedAssets.length === 0 ? (
                  <Notice tone="muted">Checking allowlisted price feeds…</Notice>
                ) : allowlistedAssets.length === 0 ? (
                  <Notice tone="muted">
                    No assets are allowlisted on this chain yet. Use Advanced below to supply a custom allowlisted oracle.
                  </Notice>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {allowlistedAssets.map((a: OracleAssetCandidate) => {
                        const active = !advancedOpen && a.symbol === selectedAssetSymbol
                        return (
                          <button
                            key={a.symbol}
                            type="button"
                            onClick={() => {
                              setAdvancedOpen(false)
                              pickAsset(a.symbol)
                            }}
                            title={`${a.name} · Chainlink ${a.feed}`}
                            style={{
                              fontFamily: MONO,
                              fontSize: 12,
                              fontWeight: 600,
                              color: active ? terminalColors.greenDeep : terminalColors.ink3Alt,
                              background: active ? terminalColors.greenBg : 'transparent',
                              border: `1px solid ${active ? terminalColors.greenBorder : terminalColors.line}`,
                              borderRadius: 9,
                              padding: '8px 16px',
                              cursor: 'pointer',
                            }}
                          >
                            {a.symbol}
                          </button>
                        )
                      })}
                    </div>
                    {!advancedOpen && selectedAsset ? (
                      <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 8 }}>
                        {selectedAsset.name} — priced by its allowlisted Chainlink feed (
                        <ExplorerAddress address={selectedAsset.feed} chainId={chainId} fontSize={10.5} />
                        ). {allowlistedAssets.length === 1 ? 'More assets appear as venues are allowlisted.' : ''}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {/* Advanced — power users set the raw oracle config by hand. */}
              <div style={{ borderTop: `1px solid ${terminalColors.line}`, paddingTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((o) => !o)}
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 600,
                    color: terminalColors.ink3Alt,
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  {advancedOpen ? '▾' : '▸'} Advanced (custom oracle)
                </button>
                {advancedOpen ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
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
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FieldLabel>Max deviation (bps)</FieldLabel>
                        <TextField
                          value={maxDeviationInput}
                          onChange={(v) => setMaxDeviationInput(v.replace(/[^0-9]/g, '').slice(0, 6))}
                          placeholder="500"
                          mono
                          inputMode="numeric"
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FieldLabel>Max staleness (s)</FieldLabel>
                        <TextField
                          value={maxStalenessInput}
                          onChange={(v) => setMaxStalenessInput(v.replace(/[^0-9]/g, '').slice(0, 8))}
                          placeholder="86400"
                          mono
                          inputMode="numeric"
                        />
                      </div>
                    </div>
                    <Notice tone="warn">
                      Custom oracle — the venue must be allowlisted in OracleGuard for its source type, or the launch
                      reverts. Only use this if you know the exact allowlisted feed address.
                    </Notice>
                  </div>
                ) : null}
              </div>

              <SummaryRow label="Max deviation" value={`${oracleMaxDeviation.toString()} bps`} />
              <SummaryRow label="Max staleness" value={`${oracleMaxStaleness.toString()} s`} />
              <SummaryRow label="Dual-source required" value={tier === MarketTier.Permissionless ? 'Yes' : 'No'} />
            </div>
          </Panel>
          </div>
        </div>

        {/* Right: review + launch */}
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div data-tut="launch-review">
          <Panel title="Review" corners>
            <SummaryRow label="Market" value={symbolValue} />
            <SummaryRow
              label="Collateral"
              value={collateral.trim() !== '' ? <ExplorerAddress address={collateral} chainId={chainId} type={ExplorerDataType.TOKEN} fontSize={12.5} fontWeight={500} /> : '—'}
            />
            <SummaryRow label="Fee (per side)" value={feeValue} />
            <SummaryRow label="Max leverage" value={levValue} />
            <SummaryRow label="Tier" value={tierValue} />
            <SummaryRow
              label="Price source"
              value={!advancedOpen && selectedAsset ? `${selectedAsset.symbol} · Chainlink` : 'Chainlink (custom)'}
            />
            <SummaryRow label="Listing fee" value={deployed ? fmtFee(state.listingFee) : '—'} />
            <SummaryRow label="Creation bond" value={deployed ? fmtFee(state.bond) : '—'} />
            <SummaryRow label="Total to pay" value={deployed ? fmtFee(state.totalCost) : '—'} />
            <SummaryRow
              label="Creator"
              value={
                creator.trim() !== '' ? (
                  <ExplorerAddress address={creator} chainId={chainId} fontSize={12.5} fontWeight={500} />
                ) : connected && owner ? (
                  <ExplorerAddress address={owner} chainId={chainId} fontSize={12.5} fontWeight={500} />
                ) : (
                  '—'
                )
              }
            />
            <SummaryRow label="Network" value={deployed ? chainLabel : state.wrongChain ? homeLabel : 'Not available'} />

            <PrimaryButton label={primaryLabel} onClick={onPrimary} disabled={primaryDisabled} />

            {state.isDone ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Notice tone="green">Market launched — the isolated market is deployed and registered.</Notice>
                {state.marketAddress ? (
                  <SummaryRow label="Market address" value={<ExplorerAddress address={state.marketAddress} chainId={chainId} fontSize={12.5} fontWeight={500} />} />
                ) : null}
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
          </div>

          <MarketsDirectory chainId={directoryChainId} />
        </div>
      </div>

      {/* Creator launch walkthrough — first-visit auto-start + replayable button. */}
      <PerpsTutorial
        steps={LAUNCH_TUTORIAL_STEPS}
        storageKey="hookswap.perps.launch.tutorial.seen.v1"
        ready
        openSignal={tutorialOpen}
      />
    </div>
  )
}
