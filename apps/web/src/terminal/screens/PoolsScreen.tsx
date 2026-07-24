/**
 * HookSwap Terminal — B4 Pools / Create v2 pool + seed liquidity (INLINE, client-side).
 *
 * Robinhood-only launch scope. Creating a pool here is a self-contained CLIENT-SIDE
 * flow against the deployed own UniswapV2 stack — NO backend, NO contracts to deploy
 * (v2 factory / Router02 / WETH already live on Robinhood), NO Permit2 (the v2 Router
 * pulls tokens via a plain ERC-20 allowance). See `~/terminal/pools/useCreateV2Pool`.
 *
 * This REPLACES the old v3 hand-off (which navigated to the backend `/positions/create/v3`
 * flow that this fork can't serve). HookSwap ships v2 + v3, but in-app creation is v2 —
 * full-range, fixed 0.30% fee — so the v3-only range-band + fee-tier selectors are gone.
 *
 * DATA POLICY (no mock data — handoff hard rule):
 *   • Base picker — LIVE from the active chain's static common-bases (`COMMON_BASES`,
 *     the same source Swap uses), enriched with the hosted `useListTokens` feed where a
 *     backend indexes the chain. Always covers Robinhood (ETH / WETH / USDG / tHOOK).
 *   • Project token — resolved by REAL on-chain reads (symbol / decimals / balance) of
 *     the pasted address; never fabricated.
 *   • First-LP detection + opening price — REAL: `factory.getPair` + the deposit ratio.
 *     No fake pool stats. The new pool auto-appears in Markets via the data-api factory
 *     enumeration once seeded (no extra wiring here).
 *   • Approve → Create — REAL writes (wagmi), gated behind the required ERC-20 allowance.
 *
 * MOBILE (< 900px, `useIsMobileViewport`) — presentation only, same data + same flow:
 *   • The two desktop columns stack into one full-width column (Pair → notices →
 *     Deposit → Summary), so nothing has to be scrolled sideways.
 *   • Order Summary switches from label/value rows to the roomy label→value chip grid
 *     used by the Farms / Locker Ledger mobile cards (`MobileStat`), one card row per
 *     pool fact. Unpriceable values stay an honest "—".
 *   • Touch sizing: 44px+ tap targets (token select, dropdown options, primary CTA) and
 *     16px input text so iOS Safari doesn't auto-zoom the form on focus.
 *   • No sticky CTA — `TerminalShell` already pins a bottom tab bar on mobile.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useReadContract, useReadContracts } from 'wagmi'
import { COMMON_BASES } from 'uniswap/src/constants/routing'
import { WRAPPED_NATIVE_CURRENCY } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel, isUniverseChainId } from 'uniswap/src/features/chains/utils'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import { NumberType } from 'utilities/src/format/types'
import { erc20Abi, formatUnits, isAddress } from '~/chains'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { ChainLogo } from '~/components/Logo/ChainLogo'
import { NATIVE_CHAIN_ID } from '~/constants/tokens'
import { ExploreContextProvider } from '~/features/Explore/state'
import { ExploreTablesFilterStoreContextProvider } from '~/features/Explore/state/exploreTablesFilterStore'
import { useListTokens } from '~/features/Explore/state/listTokens/useListTokens'
import { useAccount } from '~/hooks/useAccount'
import { shortAddr } from '~/terminal/components/ExplorerAddress'
import { pickSwitchTargetChain, supportedChainIdsFromMap, SwitchChainButton } from '~/terminal/components/SwitchChainButton'
import { getPoolAddresses, POOL_ADDRESSES } from '~/terminal/pools/addresses'
import { useCreateV2Pool } from '~/terminal/pools/useCreateV2Pool'
import { DEFAULT_ADD_SLIPPAGE_BIPS, useAddV2Liquidity, type AddLiquiditySide } from '~/terminal/pools/useAddV2Liquidity'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { Eyebrow, InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { terminalColors, terminalFonts, terminalType } from '~/terminal/theme/tokens'
import { assume0xAddress } from '~/utils/wagmi'

const MONO = terminalFonts.mono
const DISPLAY = terminalFonts.display
const SANS = terminalFonts.sans

/** v2 pools are a single fixed fee tier. */
const V2_FEE_LABEL = '0.30%'

/* ------------------------------------------------------------------ data model */

interface TokenOption {
  symbol: string
  logoUrl?: string
  price?: number
  // Real on-chain identity from the token registry (never fabricated): `address` is the
  // token's on-chain address, or the NATIVE sentinel (`NATIVE_CHAIN_ID`) for native ETH.
  address?: string
  chainId?: UniverseChainId
  decimals?: number
}

/* ------------------------------------------------------------------ helpers */

function sanitizeNumberInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const first = cleaned.indexOf('.')
  if (first === -1) {
    return cleaned
  }
  return cleaned.slice(0, first + 1) + cleaned.slice(first + 1).replace(/\./g, '')
}

function toNum(raw: string): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function fmtPrice(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: value >= 1 ? 4 : 8,
  })
}

/**
 * Format a hook-derived (auto-filled) amount for display inside an input field.
 * Trims a full-precision `formatUnits` string to a readable length without fabricating
 * digits, and returns '' (so the field shows its placeholder) when there is nothing to
 * show yet — never a fake 0.
 */
function derivedField(v?: string): string {
  if (!v) {
    return ''
  }
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) {
    return ''
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 6 : 10, useGrouping: false })
}


/* ------------------------------------------------------------------ token select */

function TokenCircle({ token, size = 22 }: { token?: TokenOption; size?: number }): JSX.Element {
  const [erroredUrl, setErroredUrl] = useState<string | undefined>(undefined)
  const logoUrl = token?.logoUrl
  const chainId = token?.chainId
  const badgeSize = Math.max(10, Math.round(size * 0.55))

  const inner =
    logoUrl && logoUrl !== erroredUrl ? (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: '50%', display: 'block', objectFit: 'cover' }}
        onError={() => setErroredUrl(logoUrl)}
      />
    ) : (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: terminalColors.panel2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 600,
          color: terminalColors.ink2,
        }}
      >
        {token?.symbol?.slice(0, 1) ?? '?'}
      </span>
    )

  return (
    <span style={{ position: 'relative', display: 'inline-block', width: size, height: size, flexShrink: 0 }}>
      {inner}
      {chainId !== undefined && isUniverseChainId(chainId) ? (
        <span
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            display: 'flex',
            lineHeight: 0,
            padding: 1,
            borderRadius: '50%',
            background: terminalColors.bg,
          }}
        >
          <ChainLogo chainId={chainId} size={badgeSize} />
        </span>
      ) : null}
    </span>
  )
}

function TokenSelect({
  value,
  options,
  onChange,
  loading,
  mobile = false,
}: {
  value?: TokenOption
  options: TokenOption[]
  onChange: (token: TokenOption) => void
  loading: boolean
  /** Roomier trigger + option rows (44px+ tap targets) and 16px text on mobile. */
  mobile?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={loading}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: mobile ? 10 : 8,
          padding: mobile ? '13px 14px' : '9px 11px',
          minHeight: mobile ? 48 : undefined,
          borderRadius: mobile ? 12 : 10,
          border: `1px solid ${terminalColors.line}`,
          background: terminalColors.bg,
          cursor: loading ? 'default' : 'pointer',
          boxSizing: 'border-box',
        }}
      >
        <TokenCircle token={value} size={mobile ? 24 : 20} />
        <span
          style={{
            fontFamily: SANS,
            fontSize: mobile ? 16 : 13.5,
            fontWeight: 600,
            color: terminalColors.ink,
            flex: 1,
            textAlign: 'left',
          }}
        >
          {value?.symbol ?? (loading ? 'Loading…' : 'Select')}
        </span>
        <span style={{ fontFamily: MONO, fontSize: mobile ? 13 : 11, color: terminalColors.ink3Alt }}>▾</span>
      </button>
      {open ? (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              maxHeight: mobile ? 340 : 260,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
              background: terminalColors.bg,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: mobile ? 12 : 10,
              boxShadow: '0 12px 30px -12px rgba(11,15,20,.28)',
              zIndex: 11,
              padding: 4,
            }}
          >
            {options.map((token) => (
              <button
                key={token.symbol}
                type="button"
                onClick={() => {
                  onChange(token)
                  setOpen(false)
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: mobile ? 10 : 8,
                  padding: mobile ? '12px 12px' : '8px 10px',
                  minHeight: mobile ? 48 : undefined,
                  borderRadius: mobile ? 10 : 8,
                  border: 'none',
                  background: value?.symbol === token.symbol ? terminalColors.panel : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <TokenCircle token={token} size={mobile ? 24 : 20} />
                <span
                  style={{
                    fontFamily: SANS,
                    fontSize: mobile ? 15 : 13,
                    fontWeight: 600,
                    color: terminalColors.ink,
                    flex: 1,
                    textAlign: 'left',
                  }}
                >
                  {token.symbol}
                </span>
                {token.price !== undefined ? (
                  <span style={{ fontFamily: MONO, fontSize: mobile ? 13 : 11.5, color: terminalColors.ink3Alt }}>
                    ${fmtPrice(token.price)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ small pieces */

function SummaryRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0' }}>
      <span style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500, color: valueColor ?? terminalColors.ink }}>{value}</span>
    </div>
  )
}

/**
 * Mobile card-row stat chip — the same label→value chip the Farms / Locker Ledger mobile
 * cards use. Values are passed through verbatim (an honest "—" stays "—").
 */
function MobileStat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '8px 10px',
        borderRadius: 9,
        border: `1px solid ${terminalColors.line}`,
        background: terminalColors.panel,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: SANS,
          fontSize: 10,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: terminalColors.faint,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 13.5,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: valueColor ?? terminalColors.ink,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </span>
    </div>
  )
}

const mobileStatGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
  gap: 8,
}

function Panel({ children, padding = 18 }: { children: React.ReactNode; padding?: number }): JSX.Element {
  return (
    <div
      style={{
        border: `1px solid ${terminalColors.line}`,
        borderRadius: 14,
        background: terminalColors.bg,
        padding,
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.ink3Alt, marginBottom: 5 }}>{children}</div>
}

/** A soft informational callout (first-LP / opening-price / Phase-2 notices). */
function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'muted'; children: React.ReactNode }): JSX.Element {
  const border =
    tone === 'green' ? terminalColors.greenBorder : tone === 'muted' ? terminalColors.line : terminalColors.line
  const bg = tone === 'green' ? terminalColors.greenBg : terminalColors.panel
  const color = tone === 'green' ? terminalColors.greenDeep : terminalColors.ink2
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

/* ------------------------------------------------------------------ deposit field */

function DepositField({
  token,
  amount,
  onChange,
  usd,
  balanceLabel,
  estimated = false,
  mobile = false,
}: {
  token?: TokenOption
  amount: string
  onChange: (v: string) => void
  usd?: string
  balanceLabel?: string
  /** This side's amount is auto-filled from the pool ratio → show a small "est." tag. */
  estimated?: boolean
  /** Roomier padding + larger numeral on mobile. */
  mobile?: boolean
}): JSX.Element {
  return (
    <div
      style={{
        border: `1px solid ${terminalColors.line}`,
        borderRadius: mobile ? 13 : 11,
        background: terminalColors.bg,
        padding: mobile ? '14px 14px' : '11px 12px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: mobile ? 8 : 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <TokenCircle token={token} size={mobile ? 24 : 20} />
          <span style={{ fontFamily: SANS, fontSize: mobile ? 14.5 : 13, fontWeight: 600, color: terminalColors.ink }}>
            {token?.symbol ?? '—'}
          </span>
          {estimated ? (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
                color: terminalColors.ink3Alt,
                background: terminalColors.panel,
                border: `1px solid ${terminalColors.line}`,
                padding: '1px 5px',
                borderRadius: 999,
              }}
            >
              est.
            </span>
          ) : null}
        </span>
        {balanceLabel ? (
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.faint }}>{balanceLabel}</span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <input
          value={amount}
          onChange={(e) => onChange(sanitizeNumberInput(e.target.value))}
          placeholder="0.00"
          inputMode="decimal"
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: MONO,
            fontSize: mobile ? 24 : 20,
            fontWeight: 600,
            color: terminalColors.ink,
            padding: 0,
          }}
        />
        {usd ? (
          <span style={{ fontFamily: MONO, fontSize: mobile ? 12 : 11, color: terminalColors.ink3Alt, flexShrink: 0 }}>{usd}</span>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the screen */

function PoolsScreenBody(): JSX.Element {
  const isMobile = useIsMobileViewport()
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  const { convertFiatAmountFormatted } = useLocalizationContext()

  const { topTokens, isLoading: tokensLoading } = useListTokens(undefined)

  // Active chain — connected wallet's chain, defaulting to Robinhood (the Terminal's live
  // chain) when disconnected, mirroring SwapScreen.
  const chainId = account.chainId ?? UniverseChainId.Robinhood
  const connected = Boolean(account.address)
  const owner = assume0xAddress(account.address)

  const poolAddrs = getPoolAddresses(chainId)
  const chainReady = Boolean(poolAddrs)
  // No v2 stack wired on this chain but one IS elsewhere → offer a one-click switch.
  const switchTarget = chainReady ? undefined : pickSwitchTargetChain(supportedChainIdsFromMap(POOL_ADDRESSES), chainId)
  const wrappedNative = chainId ? WRAPPED_NATIVE_CURRENCY[chainId] : undefined

  // Base token options (dedup by symbol). PRIMARY: the active chain's static common-bases
  // (always populated for HookSwap chains). SECONDARY: the hosted `topTokens` feed enriches
  // with live prices/logos on chains a backend indexes.
  const options: TokenOption[] = useMemo(() => {
    const bySymbol = new Map<string, TokenOption>()
    for (const info of COMMON_BASES[chainId] ?? []) {
      const { currency } = info
      const symbol = currency.symbol
      if (!symbol || bySymbol.has(symbol)) {
        continue
      }
      bySymbol.set(symbol, {
        symbol,
        logoUrl: info.logoUrl ?? undefined,
        address: currency.isNative ? NATIVE_CHAIN_ID : currency.address,
        chainId: currency.chainId as UniverseChainId,
        decimals: currency.decimals,
      })
    }
    for (const token of topTokens) {
      if (!token.symbol) {
        continue
      }
      const chainToken = token.chainTokens.find((ct) => ct.chainId === chainId)
      const existing = bySymbol.get(token.symbol)
      if (existing) {
        if (existing.price === undefined && token.stats?.price !== undefined) {
          existing.price = token.stats.price
        }
        if (!existing.logoUrl && token.logoUrl) {
          existing.logoUrl = token.logoUrl
        }
        continue
      }
      bySymbol.set(token.symbol, {
        symbol: token.symbol,
        logoUrl: token.logoUrl || undefined,
        price: token.stats?.price,
        address: chainToken?.address,
        chainId: chainToken ? (chainToken.chainId as UniverseChainId) : undefined,
        decimals: chainToken?.decimals,
      })
    }
    // Only bases we can actually pair against (native, or a known on-chain address + decimals).
    return Array.from(bySymbol.values())
      .filter((o) => o.address === NATIVE_CHAIN_ID || (Boolean(o.address) && o.decimals !== undefined))
      .slice(0, 50)
  }, [topTokens, chainId])

  const [base, setBase] = useState<TokenOption | undefined>()
  // Default base to native ETH / WETH once options load.
  const resolvedBase =
    base ?? options.find((o) => o.address === NATIVE_CHAIN_ID) ?? options.find((o) => o.symbol === 'WETH') ?? options[0]

  // Project token — resolved from a pasted address by REAL on-chain reads.
  const [projectAddr, setProjectAddr] = useState('')

  // Pre-fill from a deep-link. Runs once after options load; never clobbers a later manual pick.
  //   • Existing-pool "Add liquidity" CTA (Market/Token/pool row):
  //       ?base=<addrOrNATIVE>&token=<otherAddr>&chainId=<id>
  //     → base selector picked by ADDRESS (native via the NATIVE sentinel) + the OTHER side's
  //       address dropped straight into the Project-token field, so the user skips the paste.
  //   • Legacy symbol deep-link (?token0=SYM / ?token1=SYM) → base preselected by symbol.
  //   • Create-Token hand-off (?project=0x…) → prefill the project token.
  const [searchParams] = useSearchParams()
  const didSeed = useRef(false)
  useEffect(() => {
    if (didSeed.current || options.length === 0) {
      return
    }

    // Resolve a base-token param (NATIVE sentinel or on-chain address) to a base option.
    const findBaseOption = (param: string | null): TokenOption | undefined => {
      if (!param) {
        return undefined
      }
      if (param.toUpperCase() === NATIVE_CHAIN_ID) {
        return options.find((o) => o.address === NATIVE_CHAIN_ID)
      }
      return options.find((o) => o.address && o.address.toLowerCase() === param.toLowerCase())
    }

    const baseParam = searchParams.get('base')
    const tokenParam = searchParams.get('token')

    if (baseParam || tokenParam) {
      // Address-based deep link from an existing pool's "Add liquidity" CTA.
      let baseOpt = findBaseOption(baseParam)
      let projectParam = tokenParam
      // Tolerant: if the base side isn't a known base option but the token side IS, swap them
      // — put the recognised base in the selector and the other address into the project field.
      if (!baseOpt) {
        const tokenAsBase = findBaseOption(tokenParam)
        if (tokenAsBase) {
          baseOpt = tokenAsBase
          projectParam = baseParam
        }
      }
      if (baseOpt) {
        setBase(baseOpt)
      }
      if (projectParam && isAddress(projectParam)) {
        setProjectAddr(projectParam)
      }
    } else {
      // Legacy symbol deep-link (?token0=SYM / ?token1=SYM).
      const sym = searchParams.get('token0') ?? searchParams.get('token1')
      if (sym) {
        const found = options.find((o) => o.symbol.toUpperCase() === sym.toUpperCase())
        if (found) {
          setBase(found)
        }
      }
    }

    // Create-Token → Pools hand-off: prefill the project token from a valid ?project= address.
    const project = searchParams.get('project')
    if (project && isAddress(project)) {
      setProjectAddr(project)
    }
    didSeed.current = true
  }, [options, searchParams])

  // Deep-link chain (from the "Add liquidity" CTA) — when it differs from the active chain,
  // the pre-filled project address can't resolve on-chain here, so offer a switch to the
  // pool's chain. Only when that chain actually has a v2 stack wired (else no dead switch).
  const deepLinkChainId = useMemo((): UniverseChainId | undefined => {
    const raw = searchParams.get('chainId')
    if (!raw) {
      return undefined
    }
    const n = Number(raw)
    return Number.isInteger(n) && isUniverseChainId(n) ? (n as UniverseChainId) : undefined
  }, [searchParams])
  const chainMismatch =
    deepLinkChainId !== undefined && deepLinkChainId !== chainId && getPoolAddresses(deepLinkChainId) !== undefined

  const projValid = isAddress(projectAddr)
  const projectAddr0x = assume0xAddress(projValid ? projectAddr : undefined)

  const projectMeta = useReadContracts({
    contracts: [
      { address: projectAddr0x, chainId, abi: erc20Abi, functionName: 'symbol' as const },
      { address: projectAddr0x, chainId, abi: erc20Abi, functionName: 'decimals' as const },
    ],
    query: { enabled: projValid },
  })
  const symbolEntry = projectMeta.data?.[0]
  const decimalsEntry = projectMeta.data?.[1]
  const projectSymbol = symbolEntry?.status === 'success' ? (symbolEntry.result as string) : undefined
  const projectDecimals = decimalsEntry?.status === 'success' ? Number(decimalsEntry.result) : undefined
  const projectResolveError = projValid && projectMeta.isError
  const projectResolved = projValid && projectSymbol !== undefined && projectDecimals !== undefined

  const projectBalanceRead = useReadContract({
    address: projectAddr0x,
    chainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    query: { enabled: projValid && Boolean(owner) },
  })
  const projectBalance = projectBalanceRead.data as bigint | undefined

  const [baseAmount, setBaseAmount] = useState('')
  const [projectAmount, setProjectAmount] = useState('')
  // Which deposit field the user last typed into. Drives the add-to-existing-pool auto-fill:
  // the OTHER side is derived from live reserves. Either side can be the typed one.
  const [inputSide, setInputSide] = useState<AddLiquiditySide>('base')

  const baseIsNative = resolvedBase?.address === NATIVE_CHAIN_ID

  const create = useCreateV2Pool({
    chainId,
    owner,
    base: { address: resolvedBase?.address, decimals: resolvedBase?.decimals, symbol: resolvedBase?.symbol },
    project: { address: projValid ? projectAddr : undefined, decimals: projectDecimals, symbol: projectSymbol },
    baseAmount,
    projectAmount,
  })

  // Existing-pool ADD flow (reserve-ratio auto-fill + slippage-protected mins). Shares the exact
  // base/project inputs as the create hook and resolves the same pair independently, computing the
  // paired amount from live on-chain reserves. Chain-agnostic — the pair/reserve reads key off the
  // active chain + factory (no chain hardcoded). The typed side feeds `inputAmount`.
  const add = useAddV2Liquidity({
    chainId,
    owner,
    base: { address: resolvedBase?.address, decimals: resolvedBase?.decimals, symbol: resolvedBase?.symbol },
    project: { address: projValid ? projectAddr : undefined, decimals: projectDecimals, symbol: projectSymbol },
    inputSide,
    inputAmount: inputSide === 'base' ? baseAmount : projectAmount,
  })

  // Existing pool (getPair != 0 AND reserves > 0) → ADD at the current ratio via `add`.
  // Otherwise → first-LP CREATE + seed via `create`. This one flag selects the flow everywhere.
  const poolExists = create.existingLiquidity

  // Deposit-field wiring. First-LP: both fields are free (bound to base/projectAmount). Existing
  // pool: the typed side echoes the input; the OTHER side auto-fills from the pool ratio and is
  // shown from the hook's derived amount (still editable — typing it flips the typed side).
  // Track the last-typed side unconditionally (only consumed in existing-pool mode) so a value
  // entered before reserves resolve isn't lost the instant the pool flips to auto-fill mode.
  const onBaseAmountChange = (v: string): void => {
    setBaseAmount(v)
    setInputSide('base')
  }
  const onProjectAmountChange = (v: string): void => {
    setProjectAmount(v)
    setInputSide('project')
  }
  const baseFieldAmount = poolExists && inputSide !== 'base' ? derivedField(add.baseAmountFormatted) : baseAmount
  const projectFieldAmount =
    poolExists && inputSide !== 'project' ? derivedField(add.projectAmountFormatted) : projectAmount

  // Opening price = deposit ratio (only shown on the first-LP path, where it's meaningful).
  const bAmt = toNum(baseAmount)
  const pAmt = toNum(projectAmount)
  const projPerBase = bAmt > 0 && pAmt > 0 ? pAmt / bAmt : undefined
  const basePerProj = bAmt > 0 && pAmt > 0 ? bAmt / pAmt : undefined

  // Deposit value in USD tracks the ACTUAL base amount going in — the typed base amount on the
  // first-LP path, or (existing pool) whichever base amount is in play (typed or auto-filled).
  const effectiveBaseNum = poolExists ? toNum(baseFieldAmount) : bAmt
  const baseUsd =
    resolvedBase?.price && effectiveBaseNum > 0
      ? convertFiatAmountFormatted(effectiveBaseNum * resolvedBase.price, NumberType.PortfolioBalance)
      : undefined
  const depositUsd = resolvedBase?.price ? effectiveBaseNum * resolvedBase.price : 0

  const projectOption: TokenOption | undefined = projValid
    ? { symbol: projectSymbol ?? shortAddr(projectAddr), address: projectAddr, decimals: projectDecimals }
    : undefined

  const projectBalanceLabel =
    projectBalance !== undefined && projectDecimals !== undefined
      ? `Bal ${Number(formatUnits(projectBalance, projectDecimals)).toLocaleString('en-US', { maximumFractionDigits: 4 })}`
      : undefined

  /* --------------------------------------------------------------- primary action */

  // The active flow's in-flight state (add for an existing pool, else create).
  const busy = poolExists
    ? add.isWritePending || add.baseApproving || add.projectApproving || add.isConfirming
    : create.isWritePending || create.baseApproving || create.projectApproving || create.isConfirming

  const onPrimary = (): void => {
    if (!connected) {
      accountDrawer.open()
      return
    }
    if (poolExists) {
      // Existing pool → add at the current reserve ratio via `useAddV2Liquidity` (inline).
      if (add.isDone) {
        add.reset()
        setBaseAmount('')
        setProjectAmount('')
        setInputSide('base')
        return
      }
      if (add.needsProjectApproval) {
        void add.approveProject()
        return
      }
      if (add.needsBaseApproval) {
        void add.approveBase()
        return
      }
      void add.add()
      return
    }
    if (create.isDone) {
      // Start another pool.
      create.reset()
      setBaseAmount('')
      setProjectAmount('')
      setProjectAddr('')
      return
    }
    if (create.needsProjectApproval) {
      void create.approveProject()
      return
    }
    if (create.needsBaseApproval) {
      void create.approveBase()
      return
    }
    void create.create()
  }

  const primaryLabel = ((): string => {
    if (!chainReady) {
      return 'Not available on this network'
    }
    if (!connected) {
      return poolExists ? 'Connect wallet to add liquidity' : 'Connect wallet to create a pool'
    }
    if (poolExists) {
      if (add.isDone) {
        return 'Added — add more'
      }
      if (add.projectApproving || add.baseApproving) {
        return 'Approving…'
      }
      if (add.isWritePending) {
        return 'Confirm in wallet…'
      }
      if (add.isConfirming) {
        return 'Adding liquidity…'
      }
      if (!add.reservesLoaded) {
        return 'Loading pool…'
      }
      if (!add.inputsValid) {
        return 'Enter an amount'
      }
      if (add.needsProjectApproval) {
        return `Approve ${projectSymbol ?? 'token'}`
      }
      if (add.needsBaseApproval) {
        return `Approve ${resolvedBase?.symbol ?? 'token'}`
      }
      return 'Add liquidity'
    }
    if (create.isDone) {
      return 'Create another pool'
    }
    if (!create.inputsValid) {
      return 'Enter token & amounts'
    }
    if (create.projectApproving || create.baseApproving) {
      return 'Approving…'
    }
    if (create.isWritePending) {
      return 'Confirm in wallet…'
    }
    if (create.isConfirming) {
      return 'Creating pool…'
    }
    if (create.needsProjectApproval) {
      return `Approve ${projectSymbol ?? 'token'}`
    }
    if (create.needsBaseApproval) {
      return `Approve ${resolvedBase?.symbol ?? 'token'}`
    }
    return 'Create pool & add liquidity'
  })()

  const primaryDisabled = ((): boolean => {
    if (!chainReady) {
      return true
    }
    if (!connected) {
      return false
    }
    if (poolExists) {
      if (add.isDone) {
        return false
      }
      if (busy || !add.reservesLoaded || !add.poolHasReserves) {
        return true
      }
      if (add.needsProjectApproval || add.needsBaseApproval) {
        return false
      }
      return !add.canAdd
    }
    if (create.isDone) {
      return false
    }
    if (busy) {
      return true
    }
    if (create.needsProjectApproval || create.needsBaseApproval) {
      return false
    }
    return !create.canCreate
  })()

  // Existing-vs-new copy: once the chosen pair resolves to a live on-chain pool (getPair != 0
  // AND reserves > 0 → `poolExists`), this is ADDING to an existing pool, not creating one.
  const pairLabel = resolvedBase?.symbol && projectSymbol ? `${resolvedBase.symbol}/${projectSymbol}` : undefined

  return (
    <div style={{ padding: '20px var(--tm-gutter) 40px' }}>
      {/* Header */}
      <div style={{ marginBottom: 8 }}>
        <Eyebrow>{poolExists ? 'Liquidity · add to pool' : 'Launch · seed liquidity'}</Eyebrow>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: isMobile ? 8 : 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1
          style={{
            fontFamily: DISPLAY,
            fontSize: isMobile ? terminalType.sectionTitleSm.size : terminalType.sectionTitle.size,
            fontWeight: terminalType.sectionTitle.weight,
            letterSpacing: terminalType.sectionTitle.ls,
            color: terminalColors.ink,
            margin: 0,
          }}
        >
          {poolExists ? 'Add liquidity' : 'New pool'}
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
          {poolExists ? `${pairLabel ?? 'existing'} · v2 pool` : `v2 · full range · ${V2_FEE_LABEL}`}
        </span>
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontSize: isMobile ? 13.5 : 13,
          color: terminalColors.ink2,
          marginBottom: isMobile ? 16 : 18,
          maxWidth: 560,
          lineHeight: 1.55,
        }}
      >
        {poolExists
          ? `This ${pairLabel ? `${pairLabel} ` : ''}pool already exists. Add liquidity at the current pool ratio — your deposit keeps the current price, right here, no deploy needed.`
          : 'Create a v2 pool for your token and seed it with the first liquidity — right here, no deploy needed. Your deposit ratio sets the opening price.'}
      </div>

      {/* Deep-linked from a pool on another chain → switch networks so the pre-filled pair resolves. */}
      {chainMismatch && deepLinkChainId !== undefined ? (
        <div style={{ marginBottom: isMobile ? 16 : 18, maxWidth: 560 }}>
          <SwitchChainButton
            target={deepLinkChainId}
            note={`This pool is on ${getChainLabel(deepLinkChainId)}. Switch networks to add liquidity to it.`}
            style={{ marginTop: 0 }}
          />
        </div>
      ) : null}

      {/* Mobile stacks the two desktop columns into one full-width column (no sideways
          scrolling); desktop keeps the wrapping two-column layout exactly as before. */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? 14 : 20,
          alignItems: isMobile ? 'stretch' : 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        {/* Left: pair */}
        <div
          style={{
            flex: isMobile ? '1 1 auto' : '1 1 320px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: isMobile ? 14 : 16,
          }}
        >
          <InstrumentPanel
            title="01 · Pair"
            meta={chainReady ? undefined : ['not available']}
            bodyStyle={{ padding: isMobile ? 14 : 18 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 12 }}>
              <div>
                <FieldLabel>Base token</FieldLabel>
                <TokenSelect
                  value={resolvedBase}
                  options={options}
                  onChange={setBase}
                  loading={tokensLoading}
                  mobile={isMobile}
                />
                {baseIsNative && wrappedNative ? (
                  <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, marginTop: 5 }}>
                    Native {resolvedBase?.symbol} is wrapped to {wrappedNative.symbol} for the pool.
                  </div>
                ) : null}
              </div>
              <div>
                <FieldLabel>Project token address</FieldLabel>
                <input
                  value={projectAddr}
                  onChange={(e) => setProjectAddr(e.target.value.trim())}
                  placeholder="0x…"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: `1px solid ${terminalColors.line}`,
                    borderRadius: isMobile ? 12 : 11,
                    background: terminalColors.bg,
                    padding: isMobile ? '13px 14px' : '10px 12px',
                    minHeight: isMobile ? 48 : undefined,
                    fontFamily: MONO,
                    // 16px on mobile: below that iOS Safari auto-zooms the page on focus.
                    fontSize: isMobile ? 16 : 13.5,
                    fontWeight: 500,
                    color: terminalColors.ink,
                    outline: 'none',
                  }}
                />
                {projectAddr !== '' && !projValid ? (
                  <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.redDown, marginTop: 5 }}>
                    Enter a valid contract address.
                  </div>
                ) : projValid && projectMeta.isLoading ? (
                  <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.ink3Alt, marginTop: 5 }}>
                    Resolving token…
                  </div>
                ) : projectResolveError ? (
                  <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.redDown, marginTop: 5 }}>
                    Not an ERC-20 on this network.
                  </div>
                ) : projectResolved ? (
                  <div style={{ fontFamily: MONO, fontSize: 11.5, color: terminalColors.greenDeep, marginTop: 5 }}>
                    {projectSymbol} · {projectDecimals} decimals
                  </div>
                ) : null}
              </div>
            </div>
          </InstrumentPanel>

          {/* First-LP / existing-pool / opening-price notices */}
          {chainReady && projectResolved ? (
            <Panel padding={isMobile ? 14 : 18}>
              {create.existingLiquidity ? (
                <Notice tone="green">
                  This pair already has a live pool. Use{' '}
                  <strong style={{ fontWeight: 600 }}>Add liquidity</strong> to deposit into it at the
                  current pool ratio.
                </Notice>
              ) : create.isFirstLp ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Notice tone="green">
                    You&apos;ll be the first liquidity provider. You set the starting price — the deposit
                    ratio below IS the opening price.
                  </Notice>
                  {projPerBase !== undefined && basePerProj !== undefined ? (
                    <div>
                      <SummaryRow
                        label={`1 ${resolvedBase?.symbol ?? 'base'} =`}
                        value={`${fmtPrice(projPerBase)} ${projectSymbol ?? ''}`.trim()}
                      />
                      <SummaryRow
                        label={`1 ${projectSymbol ?? 'token'} =`}
                        value={`${fmtPrice(basePerProj)} ${resolvedBase?.symbol ?? ''}`.trim()}
                      />
                    </div>
                  ) : (
                    <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.faint }}>
                      Enter both amounts to preview the opening price.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3Alt }}>Checking pool…</div>
              )}
            </Panel>
          ) : null}
        </div>

        {/* Right: deposit + create */}
        <div
          style={{
            flex: isMobile ? '1 1 auto' : '1 1 320px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: isMobile ? 14 : 16,
          }}
        >
          <InstrumentPanel title="02 · Deposit" bodyStyle={{ padding: isMobile ? 14 : 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 10 }}>
              <DepositField
                token={resolvedBase}
                amount={baseFieldAmount}
                onChange={onBaseAmountChange}
                usd={baseUsd}
                estimated={poolExists && inputSide === 'project'}
                mobile={isMobile}
              />
              <DepositField
                token={projectOption}
                amount={projectFieldAmount}
                onChange={onProjectAmountChange}
                balanceLabel={projectBalanceLabel}
                estimated={poolExists && inputSide === 'base'}
                mobile={isMobile}
              />
            </div>
          </InstrumentPanel>

          <InstrumentPanel title="Order Summary" bodyStyle={{ padding: isMobile ? 14 : 18 }}>
            {isMobile ? (
              // Mobile card row — same four live facts as the desktop rows, as roomy
              // label→value chips. `depositUsd` is only priceable when the base token
              // carries a live price, otherwise an honest "—".
              <div style={mobileStatGridStyle}>
                <MobileStat
                  label="Deposit value"
                  value={depositUsd > 0 ? convertFiatAmountFormatted(depositUsd, NumberType.PortfolioBalance) : '—'}
                  valueColor={depositUsd > 0 ? terminalColors.ink : terminalColors.faint}
                />
                <MobileStat label="Fee tier" value={`${V2_FEE_LABEL} (v2)`} />
                <MobileStat label="Range" value="Full range" valueColor={terminalColors.ink2} />
                <MobileStat
                  label="Network"
                  value={chainReady && chainId ? getChainLabel(chainId) : 'Not available'}
                  valueColor={chainReady ? terminalColors.ink2 : terminalColors.faint}
                />
                {poolExists ? (
                  <MobileStat
                    label="Slippage"
                    value={`${(DEFAULT_ADD_SLIPPAGE_BIPS / 100).toFixed(2)}%`}
                    valueColor={terminalColors.ink2}
                  />
                ) : null}
              </div>
            ) : (
              <>
                <SummaryRow
                  label="Deposit value"
                  value={depositUsd > 0 ? convertFiatAmountFormatted(depositUsd, NumberType.PortfolioBalance) : '—'}
                  valueColor={depositUsd > 0 ? terminalColors.ink : terminalColors.faint}
                />
                <SummaryRow label="Fee tier" value={`${V2_FEE_LABEL} (v2)`} />
                <SummaryRow label="Range" value="Full range" />
                <SummaryRow label="Network" value={chainReady && chainId ? getChainLabel(chainId) : 'Not available'} />
                {poolExists ? (
                  <SummaryRow label="Slippage" value={`${(DEFAULT_ADD_SLIPPAGE_BIPS / 100).toFixed(2)}%`} />
                ) : null}
              </>
            )}

            <button
              type="button"
              onClick={onPrimary}
              disabled={primaryDisabled}
              style={{
                marginTop: isMobile ? 14 : 12,
                width: '100%',
                fontFamily: SANS,
                fontSize: isMobile ? 15 : 14,
                fontWeight: 600,
                color: terminalColors.btnInk,
                background: primaryDisabled ? terminalColors.line : terminalColors.brandGreen,
                border: 'none',
                padding: isMobile ? '15px 0' : '12px 0',
                minHeight: isMobile ? 50 : undefined,
                borderRadius: isMobile ? 14 : 12,
                cursor: primaryDisabled ? 'default' : 'pointer',
              }}
            >
              {primaryLabel}
            </button>

            {!chainReady && switchTarget !== undefined ? (
              <SwitchChainButton
                target={switchTarget}
                note="Pool creation is live on other HookSwap chains — switch networks to seed a pool now."
              />
            ) : null}

            {poolExists ? (
              add.isDone ? (
                <div style={{ marginTop: 10 }}>
                  <Notice tone="green">
                    Liquidity added at the current pool ratio. Your position updates once the block is indexed.
                  </Notice>
                </div>
              ) : add.error ? (
                <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 10, lineHeight: 1.5 }}>
                  {add.error}
                </div>
              ) : chainReady ? (
                <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
                  {baseIsNative
                    ? 'The paired amount auto-fills from the current pool reserves. Approve your project token once, then add — native is wrapped automatically. No Permit2.'
                    : 'The paired amount auto-fills from the current pool reserves. Approve each token once, then add. Tokens are pulled by the v2 router (no Permit2).'}
                </div>
              ) : null
            ) : create.isDone ? (
              <div style={{ marginTop: 10 }}>
                <Notice tone="green">
                  Pool created and seeded. It becomes swappable and appears in Markets once indexed.
                </Notice>
              </div>
            ) : create.error ? (
              <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 10, lineHeight: 1.5 }}>
                {create.error}
              </div>
            ) : chainReady ? (
              <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
                {baseIsNative
                  ? 'Approve your project token once, then create — native is wrapped automatically. No Permit2.'
                  : 'Approve each token once, then create. Tokens are pulled by the v2 router (no Permit2).'}
              </div>
            ) : null}
          </InstrumentPanel>
        </div>
      </div>
    </div>
  )
}

/**
 * B4 Pools / Create v2 pool. Wrapped in the same Explore providers the Markets screen uses
 * so the token-list query (`useListTokens`) resolves.
 */
export function PoolsScreen(): JSX.Element {
  return (
    <ExploreContextProvider>
      <ExploreTablesFilterStoreContextProvider>
        <PoolsScreenBody />
      </ExploreTablesFilterStoreContextProvider>
    </ExploreContextProvider>
  )
}
