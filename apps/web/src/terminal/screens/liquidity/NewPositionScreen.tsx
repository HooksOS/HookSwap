/**
 * HookSwap Terminal — "New position" (B4b) — Uniswap-parity liquidity creation.
 *
 * Protocol toggle: v2 · v3 (v4 = "soon"). Presents the FORKED Uniswap v3 mint logic
 * (fee tiers · concentrated ranges · NPM mint · createAndInitializePoolIfNecessary) in
 * the DAYSIGNAL Terminal design. NO hosted liquidity service — every read/write is
 * on-chain via wagmi (custom-chain safe), reusing:
 *   • v3 math — `@uniswap/v3-sdk` (via `useCreateV3Position` / `useV3FeeTierPools`).
 *   • token math + tick/price — the interface's own `tryParseTick`/`tryParsePrice`.
 *   • pool/TVL stats — the self-hosted data-api (`useV3FeeTierTvl`).
 *   • token selection — the app's real `CurrencySearchModal` (not a paste field).
 *   • v2 create — the EXISTING `useCreateV2Pool` hook, unchanged (read-only import).
 *
 * PHASE 1 = CREATE only. Position management (increase/decrease/collect), a positions
 * list, and v4 mint are Phase 2 — see the TODO markers + the disabled v4 toggle.
 */
import { Currency } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { useEffect, useMemo, useState } from 'react'
import { nativeOnChain } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { CurrencySearchModal } from '~/components/SearchModal/CurrencySearchModal'
import { NATIVE_CHAIN_ID } from '~/constants/tokens'
import { useAccount } from '~/hooks/useAccount'
import { SwitchNetworkAction } from '~/state/popups/types'
import { CurrencyField } from 'uniswap/src/types/currency'
import { assume0xAddress } from '~/utils/wagmi'
import type { Address } from '~/chains'
import { Eyebrow, InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { pickSwitchTargetChain, supportedChainIdsFromMap, SwitchChainButton } from '~/terminal/components/SwitchChainButton'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { DEFAULT_FEE_TIER, formatFeePercent, V3_FEE_TIERS } from '~/terminal/liquidity/feeTiers'
import { getV3Addresses, v3SupportedChainIds } from '~/terminal/liquidity/v3Addresses'
import { useCreateV3Position, type V3DepositField } from '~/terminal/liquidity/useCreateV3Position'
import { useV3FeeTierPools } from '~/terminal/liquidity/useV3PoolData'
import { useV3FeeTierTvl } from '~/terminal/liquidity/useV3FeeTierTvl'
import { getPoolAddresses, POOL_ADDRESSES } from '~/terminal/pools/addresses'
import { useCreateV2Pool, type PoolTokenInput } from '~/terminal/pools/useCreateV2Pool'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

type ProtocolVersion = 'v2' | 'v3' | 'v4'

/* --------------------------------------------------------------- tiny UI atoms */

function Row({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...style }}>{children}</div>
}

function FieldLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase', color: terminalColors.ink3Alt, marginBottom: 6 }}>
      {children}
    </div>
  )
}

function currencyToPoolInput(c?: Currency): PoolTokenInput {
  if (!c) {
    return {}
  }
  if (c.isNative) {
    return { address: NATIVE_CHAIN_ID, decimals: 18, symbol: c.symbol }
  }
  return { address: c.address, decimals: c.decimals, symbol: c.symbol }
}

/** Green pill button that opens the app's real token selector. */
function TokenButton({ currency, placeholder, onClick }: { currency?: Currency; placeholder: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${terminalColors.line}`,
        background: terminalColors.bg,
        cursor: 'pointer',
        width: '100%',
      }}
    >
      <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 14, color: currency ? terminalColors.ink : terminalColors.ink3Alt }}>
        {currency?.symbol ?? placeholder}
      </span>
      <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 12, color: terminalColors.ink3Alt }}>▾</span>
    </button>
  )
}

/** Numeric text input styled for the Terminal (mono). */
function AmountInput({
  value,
  onChange,
  placeholder = '0.0',
  suffix,
  disabled,
  readOnly,
}: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  suffix?: string
  disabled?: boolean
  readOnly?: boolean
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${terminalColors.line}`,
        background: disabled ? terminalColors.panel2 : terminalColors.bg,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        inputMode="decimal"
        value={value}
        readOnly={readOnly || disabled}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, '')
          onChange?.(v)
        }}
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontFamily: MONO,
          fontSize: 16,
          color: terminalColors.ink,
          width: '100%',
        }}
      />
      {suffix ? <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 13, color: terminalColors.ink3Alt }}>{suffix}</span> : null}
    </div>
  )
}

/** Reciprocal for display inversion (price entry only; hook re-quantizes to tick). */
function reciprocal(v: string): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) {
    return ''
  }
  const r = 1 / n
  return r.toPrecision(8).replace(/\.?0+$/, '')
}

/* --------------------------------------------------------------- screen */

function NewPositionBody(): JSX.Element {
  const isMobile = useIsMobileViewport()
  const account = useAccount()
  const accountDrawer = useAccountDrawer()

  const chainId = account.chainId ?? UniverseChainId.Robinhood
  const connected = Boolean(account.address)
  const owner = assume0xAddress(account.address)

  const [version, setVersion] = useState<ProtocolVersion>('v3')

  // Shared token pair (used by both v2 + v3).
  const [currencyA, setCurrencyA] = useState<Currency | undefined>(undefined)
  const [currencyB, setCurrencyB] = useState<Currency | undefined>(undefined)
  const [selecting, setSelecting] = useState<'A' | 'B' | undefined>(undefined)

  // Default token A to the chain's native currency; reset the pair when the chain changes.
  useEffect(() => {
    setCurrencyA(nativeOnChain(chainId))
    setCurrencyB(undefined)
  }, [chainId])

  const v3Ready = Boolean(getV3Addresses(chainId))
  const v2Ready = Boolean(getPoolAddresses(chainId))

  return (
    <div style={{ padding: isMobile ? 12 : 20, maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Eyebrow>B4 · Liquidity</Eyebrow>
        <h1 style={{ fontFamily: terminalFonts.display, fontSize: isMobile ? 22 : 26, fontWeight: 600, color: terminalColors.ink, margin: '4px 0 0' }}>
          New position
        </h1>
        <p style={{ fontFamily: SANS, fontSize: 13, color: terminalColors.ink3Alt, margin: '6px 0 0', maxWidth: 560 }}>
          Provide liquidity on HookSwap. Create or seed a v2 full-range pool, or a v3 concentrated position with a custom
          fee tier and price range.
        </p>
      </div>

      {/* Protocol version toggle */}
      <VersionToggle version={version} setVersion={setVersion} v2Ready={v2Ready} v3Ready={v3Ready} />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr', gap: 16, marginTop: 16 }}>
        {version === 'v3' ? (
          <V3Flow
            chainId={chainId}
            owner={owner}
            connected={connected}
            currencyA={currencyA}
            currencyB={currencyB}
            onSelectA={() => setSelecting('A')}
            onSelectB={() => setSelecting('B')}
            onConnect={() => accountDrawer.open()}
            isMobile={isMobile}
          />
        ) : version === 'v2' ? (
          <V2Panel
            chainId={chainId}
            owner={owner}
            connected={connected}
            currencyA={currencyA}
            currencyB={currencyB}
            onSelectA={() => setSelecting('A')}
            onSelectB={() => setSelecting('B')}
            onConnect={() => accountDrawer.open()}
          />
        ) : (
          <InstrumentPanel title="Uniswap v4" corners>
            <p style={{ fontFamily: SANS, fontSize: 13, color: terminalColors.ink3Alt, margin: 0 }}>
              v4 hooks-based liquidity is coming soon to HookSwap. For now, use v2 or v3.
            </p>
          </InstrumentPanel>
        )}
      </div>

      {/* The app's real token selector (prop-driven; locked to the pool chain). */}
      <CurrencySearchModal
        isOpen={selecting !== undefined}
        onDismiss={() => setSelecting(undefined)}
        currencyField={CurrencyField.INPUT}
        switchNetworkAction={SwitchNetworkAction.LP}
        chainId={chainId as UniverseChainId}
        chainIds={[chainId as UniverseChainId]}
        selectedCurrency={selecting === 'A' ? currencyA : currencyB}
        otherSelectedCurrency={selecting === 'A' ? currencyB : currencyA}
        onCurrencySelect={(c) => {
          if (selecting === 'A') {
            if (currencyB && c.equals(currencyB)) {
              setCurrencyB(currencyA)
            }
            setCurrencyA(c)
          } else {
            if (currencyA && c.equals(currencyA)) {
              setCurrencyA(currencyB)
            }
            setCurrencyB(c)
          }
          setSelecting(undefined)
        }}
      />
    </div>
  )
}

function VersionToggle({
  version,
  setVersion,
  v2Ready,
  v3Ready,
}: {
  version: ProtocolVersion
  setVersion: (v: ProtocolVersion) => void
  v2Ready: boolean
  v3Ready: boolean
}): JSX.Element {
  const options: { id: ProtocolVersion; label: string; enabled: boolean; soon?: boolean }[] = [
    { id: 'v2', label: 'v2', enabled: v2Ready },
    { id: 'v3', label: 'v3', enabled: v3Ready },
    { id: 'v4', label: 'v4', enabled: false, soon: true },
  ]
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, border: `1px solid ${terminalColors.line}`, background: terminalColors.panel2 }}>
      {options.map((o) => {
        const active = version === o.id
        return (
          <button
            key={o.id}
            type="button"
            disabled={!o.enabled}
            onClick={() => o.enabled && setVersion(o.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 16px',
              borderRadius: 9,
              border: 'none',
              cursor: o.enabled ? 'pointer' : 'not-allowed',
              background: active ? terminalColors.ink : 'transparent',
              color: active ? terminalColors.bg : o.enabled ? terminalColors.ink : terminalColors.ink3Alt,
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: 600,
              opacity: o.enabled ? 1 : 0.55,
            }}
          >
            {o.label}
            {o.soon ? (
              <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.5, padding: '2px 5px', borderRadius: 5, background: terminalColors.warnBg, color: terminalColors.warn }}>
                SOON
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/* --------------------------------------------------------------- v3 flow */

function V3Flow({
  chainId,
  owner,
  connected,
  currencyA,
  currencyB,
  onSelectA,
  onSelectB,
  onConnect,
  isMobile,
}: {
  chainId: number
  owner?: Address
  connected: boolean
  currencyA?: Currency
  currencyB?: Currency
  onSelectA: () => void
  onSelectB: () => void
  onConnect: () => void
  isMobile: boolean
}): JSX.Element {
  const [feeAmount, setFeeAmount] = useState<FeeAmount>(DEFAULT_FEE_TIER)
  const [fullRange, setFullRange] = useState(true)
  const [minPriceDisplay, setMinPriceDisplay] = useState('')
  const [maxPriceDisplay, setMaxPriceDisplay] = useState('')
  const [initialPriceDisplay, setInitialPriceDisplay] = useState('')
  const [inverted, setInverted] = useState(false)
  const [independentField, setIndependentField] = useState<V3DepositField>('TOKEN0')
  const [typedValue, setTypedValue] = useState('')

  const v3 = getV3Addresses(chainId)
  const chainReady = Boolean(v3)
  const switchTarget = chainReady ? undefined : pickSwitchTargetChain(v3SupportedChainIds(), chainId)

  // Sorted SDK tokens for the fee-tier stat hooks.
  const sorted = useMemo(() => {
    const a = currencyA?.wrapped
    const b = currencyB?.wrapped
    if (!a || !b || a.equals(b)) {
      return undefined
    }
    return a.sortsBefore(b) ? { token0: a, token1: b } : { token0: b, token1: a }
  }, [currencyA, currencyB])

  const { tiers } = useV3FeeTierPools({ chainId, token0: sorted?.token0, token1: sorted?.token1 })
  const { tvlByFee } = useV3FeeTierTvl({ chainId, token0Address: sorted?.token0.address, token1Address: sorted?.token1.address })

  // Canonical (token1-per-token0) price strings for the hook.
  const canonicalMin = inverted ? reciprocal(maxPriceDisplay) : minPriceDisplay
  const canonicalMax = inverted ? reciprocal(minPriceDisplay) : maxPriceDisplay
  const canonicalInitial = inverted ? reciprocal(initialPriceDisplay) : initialPriceDisplay

  const create = useCreateV3Position({
    chainId,
    owner,
    currencyA,
    currencyB,
    feeAmount,
    range: { fullRange, minPrice: canonicalMin, maxPrice: canonicalMax },
    initialPrice: canonicalInitial,
    independentField,
    typedValue,
  })

  const { token0, token1, poolExists, poolLoading, dependentAmount, dependentField } = create

  // Display base/quote symbols + current price (respecting inversion).
  const baseSym = inverted ? token1?.symbol : token0?.symbol
  const quoteSym = inverted ? token0?.symbol : token1?.symbol
  const currentPriceDisplay = displayPrice(create.currentPrice, inverted)

  const pairReady = Boolean(currencyA && currencyB && sorted)

  // Deposit fields: token0/token1 amounts. Independent = typed; dependent = derived.
  const token0Amount = independentField === 'TOKEN0' ? typedValue : dependentField === 'TOKEN0' ? dependentAmount ?? '' : ''
  const token1Amount = independentField === 'TOKEN1' ? typedValue : dependentField === 'TOKEN1' ? dependentAmount ?? '' : ''

  const onType = (field: V3DepositField, v: string): void => {
    setIndependentField(field)
    setTypedValue(v)
  }

  // Primary CTA state machine.
  let cta: { label: string; onClick?: () => void; disabled?: boolean } = { label: 'Enter an amount', disabled: true }
  if (!connected) {
    cta = { label: 'Connect wallet', onClick: onConnect }
  } else if (!chainReady) {
    cta = { label: 'Unsupported chain', disabled: true }
  } else if (!pairReady) {
    cta = { label: 'Select a pair', disabled: true }
  } else if (!poolExists && !canonicalInitial) {
    cta = { label: 'Set a starting price', disabled: true }
  } else if (create.needsToken0Approval) {
    cta = { label: `Approve ${token0?.symbol ?? 'token'}`, onClick: () => void create.approveToken0(), disabled: create.token0Approving }
  } else if (create.needsToken1Approval) {
    cta = { label: `Approve ${token1?.symbol ?? 'token'}`, onClick: () => void create.approveToken1(), disabled: create.token1Approving }
  } else if (create.canMint) {
    cta = { label: create.isConfirming ? 'Confirming…' : create.isWritePending ? 'Confirm in wallet…' : poolExists ? 'Add liquidity' : 'Create pool & add', onClick: () => void create.mint() }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.1fr 0.9fr', gap: 16, alignItems: 'start' }}>
      {/* LEFT: pair + fee + range */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <InstrumentPanel title="Pair" corners>
          <Row style={{ gap: 10, flexDirection: isMobile ? 'column' : 'row', alignItems: 'stretch' }}>
            <div style={{ flex: 1 }}>
              <FieldLabel>Token A</FieldLabel>
              <TokenButton currency={currencyA} placeholder="Select token" onClick={onSelectA} />
            </div>
            <div style={{ flex: 1 }}>
              <FieldLabel>Token B</FieldLabel>
              <TokenButton currency={currencyB} placeholder="Select token" onClick={onSelectB} />
            </div>
          </Row>
        </InstrumentPanel>

        <InstrumentPanel title="Fee tier" corners meta={[pairReady ? (poolLoading ? 'reading pools…' : 'on-chain') : '—']}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 8 }}>
            {V3_FEE_TIERS.map((t) => {
              const tier = tiers.find((x) => x.fee === t.fee)
              const tvl = tvlByFee[t.fee]
              const active = feeAmount === t.fee
              return (
                <button
                  key={t.fee}
                  type="button"
                  onClick={() => setFeeAmount(t.fee)}
                  style={{
                    textAlign: 'left',
                    padding: '11px 12px',
                    borderRadius: 11,
                    cursor: 'pointer',
                    border: `1.5px solid ${active ? terminalColors.brandGreen : terminalColors.line}`,
                    background: active ? terminalColors.greenBg : terminalColors.bg,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: terminalColors.ink }}>{t.label}</span>
                  <span style={{ fontFamily: SANS, fontSize: 10.5, lineHeight: 1.25, color: terminalColors.ink3Alt }}>{t.hint}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: pairReady && tier?.exists ? terminalColors.greenUp : terminalColors.ink3Alt }}>
                    {!pairReady ? '—' : tier?.exists ? (tvl !== undefined ? `$${abbrev(tvl)} TVL` : 'pool exists') : 'no pool yet'}
                  </span>
                </button>
              )
            })}
          </div>
        </InstrumentPanel>

        {/* Starting price — only when the selected tier's pool doesn't exist yet */}
        {pairReady && !poolExists ? (
          <InstrumentPanel title="Starting price" corners meta={['new pool']}>
            <p style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3Alt, margin: '0 0 10px' }}>
              This {formatFeePercent(feeAmount)} pool doesn't exist yet — you set the initial price. It becomes the pool's
              opening market rate.
            </p>
            <FieldLabel>{quoteSym && baseSym ? `${quoteSym} per ${baseSym}` : 'Initial price'}</FieldLabel>
            <AmountInput value={initialPriceDisplay} onChange={setInitialPriceDisplay} suffix={quoteSym} placeholder="0.0" />
          </InstrumentPanel>
        ) : null}

        <InstrumentPanel
          title="Price range"
          corners
          meta={[
            pairReady && currentPriceDisplay ? `now ${currentPriceDisplay} ${quoteSym ?? ''}` : '—',
          ]}
        >
          <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 9, border: `1px solid ${terminalColors.line}`, background: terminalColors.panel2 }}>
              {[
                { id: true, label: 'Full range' },
                { id: false, label: 'Custom' },
              ].map((o) => {
                const active = fullRange === o.id
                return (
                  <button
                    key={String(o.id)}
                    type="button"
                    onClick={() => setFullRange(o.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 7,
                      border: 'none',
                      cursor: 'pointer',
                      background: active ? terminalColors.ink : 'transparent',
                      color: active ? terminalColors.bg : terminalColors.ink3Alt,
                      fontFamily: MONO,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
            {baseSym && quoteSym ? (
              <button
                type="button"
                onClick={() => setInverted((v) => !v)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: MONO, fontSize: 11, color: terminalColors.greenUp }}
              >
                {baseSym}/{quoteSym} ⇄
              </button>
            ) : null}
          </Row>

          {fullRange ? (
            <RangeBand currentLabel={currentPriceDisplay} full />
          ) : (
            <>
              <RangeBand
                currentLabel={currentPriceDisplay}
                lowLabel={create.atLimitLower ? '0' : displayPrice(create.priceLower, inverted)}
                highLabel={create.atLimitUpper ? '∞' : displayPrice(create.priceUpper, inverted)}
              />
              <Row style={{ gap: 10, marginTop: 10, flexDirection: isMobile ? 'column' : 'row', alignItems: 'stretch' }}>
                <div style={{ flex: 1 }}>
                  <FieldLabel>Min price ({quoteSym} per {baseSym})</FieldLabel>
                  <AmountInput value={minPriceDisplay} onChange={setMinPriceDisplay} suffix={quoteSym} />
                </div>
                <div style={{ flex: 1 }}>
                  <FieldLabel>Max price ({quoteSym} per {baseSym})</FieldLabel>
                  <AmountInput value={maxPriceDisplay} onChange={setMaxPriceDisplay} suffix={quoteSym} />
                </div>
              </Row>
            </>
          )}
        </InstrumentPanel>
      </div>

      {/* RIGHT: deposit + summary + CTA */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: isMobile ? 'static' : 'sticky', top: 16 }}>
        <InstrumentPanel title="Deposit" corners>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <FieldLabel>{token0?.symbol ?? 'Token 0'}</FieldLabel>
              <AmountInput
                value={token0Amount}
                onChange={(v) => onType('TOKEN0', v)}
                suffix={token0?.symbol}
                disabled={create.deposit0Disabled}
              />
            </div>
            <div>
              <FieldLabel>{token1?.symbol ?? 'Token 1'}</FieldLabel>
              <AmountInput
                value={token1Amount}
                onChange={(v) => onType('TOKEN1', v)}
                suffix={token1?.symbol}
                disabled={create.deposit1Disabled}
              />
            </div>
            {create.deposit0Disabled || create.deposit1Disabled ? (
              <span style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.warn }}>
                Range is entirely on one side of the current price → single-sided deposit.
              </span>
            ) : null}
          </div>
        </InstrumentPanel>

        <InstrumentPanel title="Summary" corners flush>
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SummaryRow label="Protocol" value="Uniswap v3" />
            <SummaryRow label="Fee tier" value={formatFeePercent(feeAmount)} />
            <SummaryRow label="Pool" value={!pairReady ? '—' : poolExists ? 'existing' : 'new (you set price)'} />
            <SummaryRow
              label="Range"
              value={
                fullRange
                  ? 'Full range'
                  : `${create.atLimitLower ? '0' : displayPrice(create.priceLower, inverted) ?? '—'} – ${create.atLimitUpper ? '∞' : displayPrice(create.priceUpper, inverted) ?? '—'}`
              }
            />
            {create.poolAddress ? <SummaryRow label="Pool addr" value={shortAddr(create.poolAddress)} mono /> : null}
          </div>
        </InstrumentPanel>

        <PrimaryButton {...cta} />

        {create.error ? (
          <span style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.redDown }}>{create.error}</span>
        ) : null}
        {create.isDone ? (
          <span style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.greenUp }}>
            Position minted. Manage it from the Positions screen (coming soon).
          </span>
        ) : null}
        {switchTarget ? (
          <SwitchChainButton target={switchTarget} note={`v3 isn't live on this chain — switch to ${getChainLabel(switchTarget)}`} />
        ) : null}

        {/* PHASE 2 TODO: increase / decrease / collect + a positions list live in a
            separate screen; this screen only mints new positions. */}
      </div>
    </div>
  )
}

/** A slim visual band showing the current price + the selected range. */
function RangeBand({ currentLabel, lowLabel, highLabel, full }: { currentLabel?: string; lowLabel?: string; highLabel?: string; full?: boolean }): JSX.Element {
  return (
    <div style={{ position: 'relative', height: 46, borderRadius: 10, background: terminalColors.panel2, border: `1px solid ${terminalColors.line}`, overflow: 'hidden' }}>
      {/* selected band */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: full ? '4%' : '22%',
          right: full ? '4%' : '22%',
          background: terminalColors.greenBg,
          borderLeft: `2px solid ${terminalColors.brandGreen}`,
          borderRight: `2px solid ${terminalColors.brandGreen}`,
        }}
      />
      {/* current price marker */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, background: terminalColors.ink }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px' }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: terminalColors.ink3Alt }}>{full ? '0' : lowLabel ?? 'min'}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: terminalColors.ink }}>{currentLabel ?? '·'}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: terminalColors.ink3Alt }}>{full ? '∞' : highLabel ?? 'max'}</span>
      </div>
    </div>
  )
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3Alt }}>{label}</span>
      <span style={{ fontFamily: mono ? MONO : SANS, fontSize: 12.5, fontWeight: 600, color: terminalColors.ink }}>{value}</span>
    </div>
  )
}

function PrimaryButton({ label, onClick, disabled }: { label: string; onClick?: () => void; disabled?: boolean }): JSX.Element {
  const isDisabled = disabled || !onClick
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      style={{
        width: '100%',
        padding: '13px 16px',
        borderRadius: 12,
        border: 'none',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        background: isDisabled ? terminalColors.panel2 : terminalColors.brandGreen,
        color: isDisabled ? terminalColors.ink3Alt : terminalColors.btnInk,
        fontFamily: SANS,
        fontSize: 14,
        fontWeight: 700,
      }}
    >
      {label}
    </button>
  )
}

/* --------------------------------------------------------------- v2 panel (reuses useCreateV2Pool) */

function V2Panel({
  chainId,
  owner,
  connected,
  currencyA,
  currencyB,
  onSelectA,
  onSelectB,
  onConnect,
}: {
  chainId: number
  owner?: Address
  connected: boolean
  currencyA?: Currency
  currencyB?: Currency
  onSelectA: () => void
  onSelectB: () => void
  onConnect: () => void
}): JSX.Element {
  const [amountA, setAmountA] = useState('')
  const [amountB, setAmountB] = useState('')

  const chainReady = Boolean(getPoolAddresses(chainId))
  const switchTarget = chainReady ? undefined : pickSwitchTargetChain(supportedV2ChainIds(), chainId)

  const v2 = useCreateV2Pool({
    chainId,
    owner,
    base: currencyToPoolInput(currencyA),
    project: currencyToPoolInput(currencyB),
    baseAmount: amountA,
    projectAmount: amountB,
  })

  const pairReady = Boolean(currencyA && currencyB)

  let cta: { label: string; onClick?: () => void; disabled?: boolean } = { label: 'Enter amounts', disabled: true }
  if (!connected) {
    cta = { label: 'Connect wallet', onClick: onConnect }
  } else if (!chainReady) {
    cta = { label: 'Unsupported chain', disabled: true }
  } else if (!pairReady) {
    cta = { label: 'Select a pair', disabled: true }
  } else if (v2.existingLiquidity) {
    cta = { label: 'Pool already seeded — use Pools to add', disabled: true }
  } else if (v2.needsBaseApproval) {
    cta = { label: `Approve ${currencyA?.symbol ?? 'token'}`, onClick: () => void v2.approveBase(), disabled: v2.baseApproving }
  } else if (v2.needsProjectApproval) {
    cta = { label: `Approve ${currencyB?.symbol ?? 'token'}`, onClick: () => void v2.approveProject(), disabled: v2.projectApproving }
  } else if (v2.canCreate) {
    cta = { label: v2.isConfirming ? 'Confirming…' : v2.isWritePending ? 'Confirm in wallet…' : 'Create pool & add', onClick: () => void v2.create() }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, maxWidth: 520 }}>
      <InstrumentPanel title="v2 pool" corners meta={['full range · 0.30%']}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <FieldLabel>Token A</FieldLabel>
            <TokenButton currency={currencyA} placeholder="Select token" onClick={onSelectA} />
            <div style={{ marginTop: 8 }}>
              <AmountInput value={amountA} onChange={setAmountA} suffix={currencyA?.symbol} />
            </div>
          </div>
          <div>
            <FieldLabel>Token B</FieldLabel>
            <TokenButton currency={currencyB} placeholder="Select token" onClick={onSelectB} />
            <div style={{ marginTop: 8 }}>
              <AmountInput value={amountB} onChange={setAmountB} suffix={currencyB?.symbol} />
            </div>
          </div>
          <p style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3Alt, margin: 0 }}>
            {pairReady && v2.isFirstLp
              ? 'New pair — your deposit ratio sets the opening price.'
              : pairReady && v2.existingLiquidity
                ? 'This pair already has liquidity.'
                : 'v2 provides full-range liquidity at a 0.30% fee.'}
          </p>
        </div>
      </InstrumentPanel>

      <PrimaryButton {...cta} />
      {v2.error ? <span style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.redDown }}>{v2.error}</span> : null}
      {v2.isDone ? <span style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.greenUp }}>Pool created + seeded.</span> : null}
      {switchTarget ? <SwitchChainButton target={switchTarget} note={`v2 isn't live on this chain — switch to ${getChainLabel(switchTarget)}`} /> : null}
    </div>
  )
}

/* --------------------------------------------------------------- helpers */

function supportedV2ChainIds(): UniverseChainId[] {
  return supportedChainIdsFromMap(POOL_ADDRESSES)
}

function displayPrice(canonical?: string, inverted?: boolean): string | undefined {
  if (!canonical) {
    return undefined
  }
  return inverted ? reciprocal(canonical) : canonical
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function abbrev(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`
  }
  return n.toFixed(0)
}

export function NewPositionScreen(): JSX.Element {
  return <NewPositionBody />
}

export default NewPositionScreen
