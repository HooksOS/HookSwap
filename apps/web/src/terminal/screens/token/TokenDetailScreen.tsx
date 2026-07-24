/**
 * HookSwap Terminal — public, no-wallet, shareable per-token project page ("B · Ledger").
 *
 * The community URL anyone can open to view a token: `/token/:chainId/:address` (the
 * contract address is IN the url so a project can just share the link). Renders end to
 * end with NO connected wallet — like the Locker's proof-of-lock page. Realizes the
 * "B · Ledger" light/Atlas-daylight direction (memory/token-page-design.md).
 *
 * DATA POLICY (facts-only, NO mock/placeholder data — every value is a real source or an
 * honest "—" / loading / empty / not-found state):
 *   • Identity + price + KPIs (price · 24h change · 24h volume · FDV) — LIVE from the
 *     app's real data-api token feed (`useListTokens(chainId)` → data.hookswap.org, the
 *     SAME source the Markets screen resolves tokens from; it serves HookSwap's custom
 *     chains where the hosted Uniswap GraphQL gateway does not). Resolved by matching a
 *     `chainToken` on (chainId, address). Missing metrics render "—", never a fabricated 0.
 *   • Liquidity (TVL) — DERIVED from the real TVL of this token's live pools (summed from
 *     the data-api pools list below). Market cap is NOT in the feed (no circulating
 *     supply) → omitted, never guessed.
 *   • Price chart — the token's real 1-day price history (`stats.priceHistory1d`, the same
 *     series the Markets sparkline draws). Empty series → an honest empty state.
 *   • Pools list — LIVE from the data-api top-pools feed (`useBackendSortedTopPools`,
 *     chain-scoped) filtered to pools that hold this token. Each row deep-links to the
 *     existing Market detail page. No pools → honest empty state.
 *   • Recent activity — LIVE from the real token-transactions feed
 *     (`useTokenTransactions`, swaps buy/sell of this token). On chains the feed doesn't
 *     serve it returns empty → an honest "No trades yet", never fabricated.
 *   • Buy / Sell — deep-link into the existing Swap screen pre-filled with this token
 *     (same URL serializer the Markets/Landing CTAs use). The swap engine is NOT rebuilt.
 *
 * NOTE ON OG UNFURL: the `<Helmet>` tags are set CLIENT-SIDE (crawlers reading the static
 * index.html won't see per-token meta — same known SSR caveat as the Locker page). The
 * page + copy-link work regardless.
 */
import type { MultichainToken } from '@uniswap/client-data-api/dist/data/v1/types_pb'
import type { Currency } from '@uniswap/sdk-core'
import { GraphQLApi } from '@universe/api'
import { useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async/lib/index'
import { Link, useNavigate, useParams } from 'react-router'
import { getNativeAddress } from 'uniswap/src/constants/addresses'
import { nativeOnChain } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel, isUniverseChainId } from 'uniswap/src/features/chains/utils'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import { ExplorerDataType } from 'uniswap/src/utils/linking'
import { isEVMAddress } from 'utilities/src/addresses/evm/evm'
import { NumberType } from 'utilities/src/format/types'
import { gqlToCurrency } from '~/appGraphql/data/util'
import { PoolSortFields } from '~/appGraphql/data/pools/useTopPools'
import { OrderDirection } from '~/appGraphql/data/util'
import { useTokenTransactions } from '~/appGraphql/data/useTokenTransactions'
import { DoubleCurrencyLogo } from '~/components/Logo/DoubleLogo'
import { ExploreTablesFilterStoreContextProvider } from '~/features/Explore/state/exploreTablesFilterStore'
import { useListTokens } from '~/features/Explore/state/listTokens/useListTokens'
import { useTokenMeta } from '~/terminal/screens/token/useTokenMeta'
import { useBackendSortedTopPools } from '~/features/Explore/state/topPools/useBackendSortedTopPools'
import { serializeSwapAddressesToURLParameters } from '~/pages/Swap/Swap/state/tradeQueryParams'
import { useCurrency } from '~/hooks/Tokens'
import { ExplorerAddress, shortAddr } from '~/terminal/components/ExplorerAddress'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { LedgerAvatar, resolveLedgerLogo } from '~/terminal/components/LedgerAvatar'
import { TerminalChartPanel } from '~/terminal/screens/swap/TerminalChartPanel'
import { TokenTradeTicket } from '~/terminal/screens/token/TokenTradeTicket'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import type { PoolStat } from '~/types/explore'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

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

/** Adaptive-precision USD price string; undefined/≤0 → "—". */
function fmtPrice(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n <= 0) {
    return '—'
  }
  let maxFrac = 2
  if (n < 1) {
    maxFrac = 4
  }
  if (n < 0.01) {
    maxFrac = 6
  }
  if (n < 0.0001) {
    maxFrac = 8
  }
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: maxFrac })}`
}

/** Signed percent, 2 decimals: 2.41 → "+2.41%"; undefined → "—". */
function fmtSignedPct(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}%`
}

/** Compact token amount, e.g. 118432 → "118.4K"; undefined → "—". */
function fmtCompact(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

/** Compact relative time from a unix-seconds timestamp: "8s", "3m", "14h", "2d". */
function relativeFromSeconds(timestampSec: number, nowMs: number = Date.now()): string {
  const deltaSec = Math.max(0, Math.round(nowMs / 1000 - timestampSec))
  if (deltaSec < 60) {
    return `${deltaSec}s`
  }
  const min = Math.round(deltaSec / 60)
  if (min < 60) {
    return `${min}m`
  }
  const hr = Math.round(min / 60)
  if (hr < 24) {
    return `${hr}h`
  }
  return `${Math.round(hr / 24)}d`
}

function changeColor(pct: number | undefined): string {
  if (pct === undefined || !Number.isFinite(pct)) {
    return terminalColors.faint
  }
  return pct >= 0 ? terminalColors.greenUp : terminalColors.redDown
}

/* ------------------------------------------------------------------ param parse */

interface ParsedToken {
  chainId: UniverseChainId
  address: string
}

/** Parse `/token/:chainId/:address`; rejects unregistered chains / non-EVM addresses. */
function parseParams(chainRaw: string | undefined, address: string | undefined): ParsedToken | undefined {
  if (!chainRaw || !address) {
    return undefined
  }
  const chainNum = Number(chainRaw)
  if (!Number.isInteger(chainNum) || chainNum <= 0 || !isUniverseChainId(chainNum) || !isEVMAddress(address)) {
    return undefined
  }
  return { chainId: chainNum, address }
}

/* ------------------------------------------------------------------ resolvers */

/** Find the multichain token that has a chain-token matching (chainId, address). */
function findToken(
  tokens: readonly MultichainToken[],
  chainId: number,
  address: string,
): MultichainToken | undefined {
  const target = address.toLowerCase()
  return tokens.find((token) =>
    token.chainTokens.some((ct) => ct.chainId === chainId && ct.address?.toLowerCase() === target),
  )
}

interface PoolRow {
  key: string
  detailPath?: string
  currency0?: Currency
  currency1?: Currency
  symbol0: string
  symbol1: string
  tvl: number
  volume24h: number
  feeLabel?: string
  /** Protocol version display string from the data-api pools feed ('v2' | 'v3' | 'v4'). */
  version?: string
}

/** Pools (chain-scoped, data-api) that hold this token, mapped to display rows. */
function buildPoolRows(pools: PoolStat[] | undefined, chainId: number, address: string): PoolRow[] {
  if (!pools) {
    return []
  }
  const target = address.toLowerCase()
  return pools
    .filter(
      (p) =>
        p.token0?.address?.toLowerCase() === target || p.token1?.address?.toLowerCase() === target,
    )
    .map((pool, index): PoolRow => {
      const currency0 = pool.token0 ? gqlToCurrency(pool.token0) : undefined
      const currency1 = pool.token1 ? gqlToCurrency(pool.token1) : undefined
      const feeAmount = pool.feeTier?.feeAmount
      return {
        key: pool.id ? `${pool.id}-${index}` : `pool-${index}`,
        detailPath: pool.id ? `/markets/${chainId}-${pool.id}` : undefined,
        currency0,
        currency1,
        symbol0: currency0?.symbol ?? pool.token0?.symbol ?? '—',
        symbol1: currency1?.symbol ?? pool.token1?.symbol ?? '—',
        tvl: pool.totalLiquidity?.value ?? 0,
        volume24h: pool.volume1Day?.value ?? 0,
        // Uniswap fee amounts are hundredths of a bip (3000 → 0.30%).
        feeLabel: feeAmount !== undefined ? `${(feeAmount / 10000).toFixed(2)}%` : undefined,
        version: pool.protocolVersion || undefined,
      }
    })
}

interface ActivityRow {
  key: string
  typeLabel: string
  typeColor: string
  amount: string
  usd: string
  account: string
  time: string
}

/** Token swaps (buy/sell of THIS token) mapped to display rows. */
function buildActivityRows(
  txns: GraphQLApi.PoolTransaction[],
  chainId: number,
  address: string,
  symbol: string,
): ActivityRow[] {
  const target = address.toLowerCase()
  return txns.map((tx, index): ActivityRow => {
    // The token with a positive signed quantity is the one being SOLD into the pool.
    const q0 = parseFloat(tx.token0Quantity)
    const soldToken = q0 > 0 ? tx.token0 : tx.token1
    const isThisSold = soldToken.address?.toLowerCase() === target
    // Amount of THIS token moved (whichever side it is).
    const thisIsToken0 = tx.token0.address?.toLowerCase() === target
    const rawAmount = Math.abs(parseFloat(thisIsToken0 ? tx.token0Quantity : tx.token1Quantity))
    return {
      key: `${tx.hash}-${index}`,
      typeLabel: isThisSold ? 'Sell' : 'Buy',
      typeColor: isThisSold ? terminalColors.redDown : terminalColors.greenUp,
      amount: `${fmtCompact(Number.isFinite(rawAmount) ? rawAmount : undefined)} ${symbol}`,
      usd: tx.usdValue?.value && tx.usdValue.value > 0 ? fmtUsd(tx.usdValue.value) : '—',
      account: shortAddr(tx.account),
      time: relativeFromSeconds(tx.timestamp),
    }
  })
}

/* ------------------------------------------------------------------ page shell */

const PAGE_WRAP: React.CSSProperties = {
  minHeight: '70vh',
  background: terminalColors.bgApp,
  padding: '28px var(--tm-gutter, 20px) 64px',
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
          <div style={{ marginTop: 22, fontFamily: SANS, fontSize: 12, color: terminalColors.faint }}>
            <Link to="/markets" style={{ color: terminalColors.greenDeep, textDecoration: 'none', fontWeight: 600 }}>
              Explore all markets →
            </Link>
          </div>
        </div>
      </InstrumentPanel>
    </div>
  )
}

/* ------------------------------------------------------------------ small parts */

function Kpi({ label, value, valueColor }: { label: string; value: string; valueColor?: string }): JSX.Element {
  return (
    <div style={{ border: `1px solid ${terminalColors.line2}`, borderRadius: 12, padding: '13px 15px', minWidth: 0, background: terminalColors.bg }}>
      <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase', color: terminalColors.ink3 }}>
        {label}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', color: valueColor ?? terminalColors.ink, marginTop: 5 }}>
        {value}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the screen */

function TokenDetailScreenBody(): JSX.Element {
  const params = useParams<{ chainId: string; address: string }>()
  const navigate = useNavigate()
  const isMobile = useIsMobileViewport()
  const { convertFiatAmountFormatted } = useLocalizationContext()

  const parsed = useMemo(() => parseParams(params.chainId, params.address), [params.chainId, params.address])
  const chainId = parsed?.chainId
  const address = parsed?.address

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

  // Real token feed (data-api; serves HookSwap custom chains). Filtered to this chain.
  const { topTokens, isLoading: tokensLoading, isError: tokensError } = useListTokens(chainId)
  const token = useMemo(
    () => (chainId !== undefined && address ? findToken(topTokens, chainId, address) : undefined),
    [topTokens, chainId, address],
  )

  // Real pools feed (data-api; chain-scoped) — filtered to pools holding this token.
  const { topPools, isLoading: poolsLoading } = useBackendSortedTopPools({
    sortState: { sortBy: PoolSortFields.TVL, sortDirection: OrderDirection.Desc },
    chainId,
    enabled: Boolean(chainId),
  })
  const poolRows = useMemo(
    () => (chainId !== undefined && address ? buildPoolRows(topPools, chainId, address) : []),
    [topPools, chainId, address],
  )
  const derivedLiquidity = useMemo(
    () => (poolRows.length ? poolRows.reduce((sum, r) => sum + r.tvl, 0) : undefined),
    [poolRows],
  )

  // Real token transactions (swaps). GraphQL feed → honest empty on unsupported chains.
  const { transactions: rawTxns, loading: txLoading } = useTokenTransactions({
    address: address ?? '',
    chainId: chainId ?? UniverseChainId.Mainnet,
  })

  // Socials/description from the token's on-chain metadataURI JSON (data-api /v1/token-meta). Optional —
  // absent for tokens without launchpad JSON metadata; never fabricated.
  const { data: tokenMeta } = useTokenMeta(chainId, address)

  // Resolve THIS token + the chain's native as real `Currency` objects — fed to the embedded
  // executing trade ticket (native ↔ token) and the reused price-chart panel. `useCurrency`
  // resolves from the app's token lists + on-chain, so any valid address resolves.
  const tokenCurrency = useCurrency({ address, chainId })
  const nativeCurrency = useMemo(() => (chainId !== undefined ? nativeOnChain(chainId) : undefined), [chainId])

  // Which Trades/Holders/Info tab is active below the chart.
  const [detailTab, setDetailTab] = useState<'trades' | 'holders' | 'info'>('trades')

  const stats = token?.stats
  const symbol = token?.symbol || '—'
  const name = token?.name || ''
  const logoUrl = token?.logoUrl || tokenMeta?.logoUrl || resolveLedgerLogo(chainId, address)
  const initials = (symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?'

  // STATUS chip — the venue this token trades through, read from the highest-TVL pool that
  // holds it (data-api `protocolVersion`). "DIRECT V3" / "DIRECT V2". Honest "—" when no pool
  // is indexed yet; never fabricated.
  const statusLabel = useMemo(() => {
    const withVersion = poolRows.find((r) => r.version)
    return withVersion?.version ? `DIRECT ${withVersion.version.toUpperCase()}` : '—'
  }, [poolRows])

  const activityRows = useMemo(
    () => (chainId !== undefined && address ? buildActivityRows(rawTxns, chainId, address, symbol) : []),
    [rawTxns, chainId, address, symbol],
  )

  // Buy / Sell deep-links into the existing Swap screen, pre-filled with this token.
  const swapLink = useMemo(() => {
    if (chainId === undefined || !address) {
      return { buy: '/swap', sell: '/swap' }
    }
    const native = getNativeAddress(chainId)
    try {
      return {
        // Buy: pay native → receive this token.
        buy:
          '/swap' +
          serializeSwapAddressesToURLParameters({ inputTokenAddress: native, outputTokenAddress: address, chainId }),
        // Sell: pay this token → receive native.
        sell:
          '/swap' +
          serializeSwapAddressesToURLParameters({ inputTokenAddress: address, outputTokenAddress: native, chainId }),
      }
    } catch {
      return { buy: '/swap', sell: '/swap' }
    }
  }, [chainId, address])

  /* ------------------------------------------------------------- guards */

  if (!parsed) {
    return (
      <div style={PAGE_WRAP}>
        <StateBox
          title="Invalid token link"
          body="This token link is malformed — it needs a supported chain id and a valid contract address. Open a token from Markets to view its page."
        />
      </div>
    )
  }

  // Still resolving with nothing yet → skeleton; resolved-empty → honest not-indexed.
  if (!token) {
    if (tokensLoading) {
      return (
        <div style={PAGE_WRAP}>
          <TokenSkeleton />
        </div>
      )
    }
    return (
      <div style={PAGE_WRAP}>
        <StateBox
          title="This token isn’t indexed yet"
          body={
            tokensError
              ? 'The token feed is unreachable right now — we won’t show any fabricated data. Try again in a moment.'
              : `No market data is indexed for ${shortAddr(address)} on ${getChainLabel(chainId as UniverseChainId)} yet. It appears here once it has liquidity and trades. You can still trade it directly.`
          }
        />
        {/* Even when unindexed, the address is valid → offer a direct swap + explorer link. */}
        <div style={{ maxWidth: 620, margin: '16px auto 0', display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => navigate(swapLink.buy)}
            style={primaryBtnStyle}
          >
            Trade {shortAddr(address)}
          </button>
          <ExplorerAddress address={address} chainId={chainId} type={ExplorerDataType.TOKEN} label="View contract ↗" fontSize={13} />
        </div>
      </div>
    )
  }

  const price = fmtPrice(stats?.price)
  const change1d = stats?.priceChange1d
  const fiatStats = (v: number | undefined): string =>
    v !== undefined && v > 0 ? convertFiatAmountFormatted(v, NumberType.FiatTokenStats) : '—'

  /* ------------------------------------------------------------- render */

  return (
    <div style={PAGE_WRAP}>
      <Helmet>
        <title>{`${symbol} · HookSwap`}</title>
        <meta name="description" content={`${symbol}${name ? ` (${name})` : ''} on ${getChainLabel(chainId as UniverseChainId)} — price, liquidity, pools and activity on HookSwap.`} />
        <meta property="og:title" content={`${symbol} · HookSwap`} />
        <meta property="og:description" content={`Trade ${symbol} on HookSwap — live price, pools and activity.`} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={`${symbol} · HookSwap`} />
        <meta name="twitter:description" content={`Trade ${symbol} on HookSwap — live price, pools and activity.`} />
      </Helmet>

      <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* ---------------------------------------------- identity + price hero */}
        <InstrumentPanel corners style={{ padding: 0 }}>
          <div style={{ padding: '24px 26px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <LedgerAvatar seed={address ?? symbol} initials={initials} size={52} logoUrl={logoUrl} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink }}>
                    {symbol}
                  </span>
                  {name ? (
                    <span style={{ fontFamily: SANS, fontSize: 14, color: terminalColors.ink3 }}>{name}</span>
                  ) : null}
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
                    {getChainLabel(chainId as UniverseChainId)}
                  </span>
                  {/* DEX badge — HookSwap + the venue version, from the token's top pool. */}
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: 600,
                      color: terminalColors.greenDeep,
                      background: terminalColors.greenBg,
                      padding: '3px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {statusLabel === '—' ? 'HookSwap' : `HookSwap ${statusLabel.replace('DIRECT ', '')}`}
                  </span>
                </div>
                <div style={{ marginTop: 7 }}>
                  <ExplorerAddress address={address} chainId={chainId} type={ExplorerDataType.TOKEN} short={false} fontSize={12} />
                </div>
                {/* Socials — only rendered for the links the token's metadata actually carries. */}
                {tokenMeta && (tokenMeta.website || tokenMeta.twitter || tokenMeta.telegram) ? (
                  <div style={{ marginTop: 9, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {tokenMeta.website ? (
                      <a href={tokenMeta.website} target="_blank" rel="noopener noreferrer" style={socialLinkStyle}>
                        Website ↗
                      </a>
                    ) : null}
                    {tokenMeta.twitter ? (
                      <a href={tokenMeta.twitter} target="_blank" rel="noopener noreferrer" style={socialLinkStyle}>
                        Twitter / X ↗
                      </a>
                    ) : null}
                    {tokenMeta.telegram ? (
                      <a href={tokenMeta.telegram} target="_blank" rel="noopener noreferrer" style={socialLinkStyle}>
                        Telegram ↗
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {/* Price + 24h */}
              <div style={{ textAlign: 'right', minWidth: 140 }}>
                <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink }}>
                  {price}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: changeColor(change1d), marginTop: 2 }}>
                  {fmtSignedPct(change1d)} <span style={{ color: terminalColors.ink3, fontWeight: 500 }}>24h</span>
                </div>
              </div>
            </div>

            {/* actions — trading lives in the main-column trade card; the hero owns sharing */}
            <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => navigate(swapLink.buy)} style={{ ...primaryBtnStyle, flex: '1 1 140px' }}>
                Buy {symbol}
              </button>
              <button type="button" onClick={onCopy} style={{ ...secondaryBtnStyle, flex: '0 1 180px' }}>
                {copied ? '✓ Link copied' : 'Copy share link'}
              </button>
            </div>

            {/* Project description from the token's metadata JSON — only when present. */}
            {tokenMeta?.description ? (
              <p
                style={{
                  fontFamily: SANS,
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: terminalColors.ink2,
                  margin: '18px 0 0',
                  maxWidth: 760,
                }}
              >
                {tokenMeta.description}
              </p>
            ) : null}
          </div>
        </InstrumentPanel>

        {/* ---------------------------------------------- stats row (real only) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <Kpi label="FDV" value={fiatStats(stats?.fdv)} />
          <Kpi label="24h volume" value={fiatStats(stats?.volume1d)} />
          <Kpi label="Liquidity" value={fiatStats(derivedLiquidity)} />
          {/* Holders isn't served by the token feed yet → honest "—" (never fabricated). */}
          <Kpi label="Holders" value="—" />
          <Kpi label="Status" value={statusLabel} />
        </div>

        {/* ---------------------------------------------- main: price chart + INLINE trade ticket
            On mobile the ticket comes first (buy/sell above the chart); on desktop the chart is
            the wide left column with the ticket docked right. The ticket EXECUTES inline. */}
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: 18,
            alignItems: 'stretch',
          }}
        >
          {/* Reuse the swap desk's live price-chart panel (native ↔ token, 1H/1D/1W/1M/1Y tabs,
              honest empty state). Driven purely by currency props — no swap store needed here. */}
          <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', order: isMobile ? 2 : 0 }}>
            <TerminalChartPanel inputCurrency={nativeCurrency} outputCurrency={tokenCurrency} />
          </div>
          {/* The embedded, EXECUTING Buy/Sell ticket — mounts the real swap-engine provider stack
              pre-filled with native ↔ this token and submits through TerminalSwapReviewFlow. */}
          <div style={{ flex: isMobile ? '1 1 auto' : '0 0 344px', minWidth: 0, order: isMobile ? 1 : 0 }}>
            {chainId !== undefined ? (
              <TokenTradeTicket chainId={chainId} token={tokenCurrency} tokenSymbol={symbol} />
            ) : null}
          </div>
        </div>

        {/* ---------------------------------------------- Trades / Holders / Info tab strip */}
        <InstrumentPanel flush live={detailTab === 'trades'} title={symbol} meta={[getChainLabel(chainId as UniverseChainId)]}>
          <div
            style={{
              display: 'flex',
              gap: 2,
              padding: 10,
              borderBottom: `1px solid ${terminalColors.line3}`,
            }}
          >
            {(['trades', 'holders', 'info'] as const).map((tab) => {
              const active = tab === detailTab
              const labelMap = { trades: 'Trades', holders: 'Holders', info: 'Info' } as const
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDetailTab(tab)}
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: active ? terminalColors.ink : terminalColors.ink3,
                    background: active ? terminalColors.panel2 : 'transparent',
                    border: 'none',
                    borderRadius: 7,
                    padding: '7px 14px',
                    cursor: 'pointer',
                  }}
                >
                  {labelMap[tab]}
                </button>
              )
            })}
          </div>

          {detailTab === 'trades' ? (
            <ActivityList rows={activityRows} loading={txLoading && activityRows.length === 0} chainId={chainId} />
          ) : detailTab === 'holders' ? (
            <div
              style={{
                padding: '30px 16px',
                textAlign: 'center',
                fontFamily: SANS,
                fontSize: 12.5,
                color: terminalColors.ink3Alt,
              }}
            >
              Holder distribution isn’t indexed yet for this token.
            </div>
          ) : (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {tokenMeta?.description ? (
                <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.55, color: terminalColors.ink2, margin: 0 }}>
                  {tokenMeta.description}
                </p>
              ) : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, rowGap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: terminalColors.ink3Alt }}>
                    Contract
                  </span>
                  <ExplorerAddress address={address} chainId={chainId} type={ExplorerDataType.TOKEN} short={false} fontSize={12} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: terminalColors.ink3Alt }}>
                    Venue
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: terminalColors.ink }}>{statusLabel}</span>
                </div>
              </div>
              {/* This token's live pools */}
              <div>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: terminalColors.ink3Alt, marginBottom: 8 }}>
                  Pools
                </div>
                <div style={{ border: `1px solid ${terminalColors.line2}`, borderRadius: 10, overflow: 'hidden' }}>
                  <PoolList
                    rows={poolRows}
                    loading={poolsLoading && poolRows.length === 0}
                    onOpen={(path) => navigate(path)}
                    fiat={fiatStats}
                  />
                </div>
              </div>
            </div>
          )}
        </InstrumentPanel>

        <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, lineHeight: 1.5 }}>
          Price · volume · FDV from the live token feed; liquidity is summed from this token’s live pools; trades are on-chain
          swap history; the chart uses real price history and shows an honest empty state until trades occur. Buy/Sell executes
          on HookSwap through the live router. Market cap · holders are omitted where the data isn’t indexed — never estimated.
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ pools list */

function PoolList({
  rows,
  loading,
  onOpen,
  fiat,
}: {
  rows: PoolRow[]
  loading: boolean
  onOpen: (path: string) => void
  fiat: (v: number | undefined) => string
}): JSX.Element {
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: 10,
          padding: '9px 16px',
          fontFamily: MONO,
          fontSize: 10,
          color: terminalColors.ink3Alt,
          borderBottom: `1px solid ${terminalColors.line3}`,
        }}
      >
        <span>POOL</span>
        <span style={{ textAlign: 'right' }}>TVL</span>
        <span style={{ textAlign: 'right' }}>24H VOL</span>
      </div>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        {loading ? (
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} style={{ padding: '11px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ height: 12, width: '70%', borderRadius: 3, background: terminalColors.line2 }} />
              <span style={{ height: 10, width: '45%', borderRadius: 3, background: terminalColors.line3 }} />
            </div>
          ))
        ) : rows.length === 0 ? (
          <div style={{ padding: '26px 16px', textAlign: 'center', fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt }}>
            No pools with liquidity yet for this token.
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.key}
              onClick={() => (row.detailPath ? onOpen(row.detailPath) : undefined)}
              style={{
                padding: '10px 16px',
                borderBottom: `1px solid ${terminalColors.line3}`,
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 10,
                alignItems: 'center',
                cursor: row.detailPath ? 'pointer' : 'default',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <DoubleCurrencyLogo currencies={[row.currency0, row.currency1]} size={22} />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: terminalColors.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.symbol0} / {row.symbol1}
                  </span>
                  {row.feeLabel ? (
                    <span style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.ink3Alt }}>{row.feeLabel}</span>
                  ) : null}
                </span>
              </span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: terminalColors.ink, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {fiat(row.tvl)}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: terminalColors.ink2, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {fiat(row.volume24h)}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ activity */

function ActivityList({
  rows,
  loading,
  chainId,
}: {
  rows: ActivityRow[]
  loading: boolean
  chainId?: UniverseChainId
}): JSX.Element {
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '52px 1fr auto',
          gap: 8,
          padding: '9px 16px',
          fontFamily: MONO,
          fontSize: 10,
          color: terminalColors.ink3Alt,
          borderBottom: `1px solid ${terminalColors.line3}`,
        }}
      >
        <span>TYPE</span>
        <span>AMOUNT</span>
        <span style={{ textAlign: 'right' }}>VALUE</span>
      </div>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        {loading ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{ padding: '9px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ height: 11, width: '80%', borderRadius: 3, background: terminalColors.line2 }} />
              <span style={{ height: 10, width: '50%', borderRadius: 3, background: terminalColors.line3 }} />
            </div>
          ))
        ) : rows.length === 0 ? (
          <div style={{ padding: '26px 16px', textAlign: 'center', fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt }}>
            No trades yet.
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.key} style={{ padding: '9px 16px', borderBottom: `1px solid ${terminalColors.line3}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 600, color: row.typeColor }}>{row.typeLabel}</span>
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: terminalColors.ink, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row.amount}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: terminalColors.ink2, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {row.usd}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <ExplorerAddress
                  address={row.account}
                  chainId={chainId}
                  type={ExplorerDataType.ADDRESS}
                  fontSize={10.5}
                  fontWeight={500}
                  color={terminalColors.greenDeep}
                />
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.faint }}>{row.time}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ skeleton */

function TokenSkeleton(): JSX.Element {
  const bar = (w: number | string, h: number): JSX.Element => (
    <div style={{ width: w, height: h, borderRadius: 5, background: terminalColors.line2 }} />
  )
  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }} aria-busy="true">
      <InstrumentPanel corners style={{ padding: 0 }}>
        <div style={{ padding: '24px 26px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: terminalColors.line2 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bar(140, 22)}
            {bar(220, 12)}
          </div>
        </div>
      </InstrumentPanel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} style={{ border: `1px solid ${terminalColors.line2}`, borderRadius: 12, padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bar(60, 10)}
            {bar(90, 16)}
          </div>
        ))}
      </div>
      <div style={{ height: 200, borderRadius: 12, background: terminalColors.line2 }} />
    </div>
  )
}

/* ------------------------------------------------------------------ button styles */

const primaryBtnStyle: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 13,
  fontWeight: 600,
  color: terminalColors.btnInk,
  background: terminalColors.brandGreen,
  border: 'none',
  borderRadius: 10,
  padding: '11px 18px',
  cursor: 'pointer',
}

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

/** Inline social link (Website / Twitter / Telegram) in the token identity block. */
const socialLinkStyle: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12.5,
  fontWeight: 600,
  color: terminalColors.greenDeep,
  textDecoration: 'none',
}

/**
 * B · Ledger token page. Wrapped in `ExploreTablesFilterStoreContextProvider` so the
 * data-api pools query (`useBackendSortedTopPools`, the same source Markets resolves
 * from) can read the shared filter store. Public + no-wallet — see file header.
 */
export function TokenDetailScreen(): JSX.Element {
  return (
    <ExploreTablesFilterStoreContextProvider>
      <TokenDetailScreenBody />
    </ExploreTablesFilterStoreContextProvider>
  )
}
