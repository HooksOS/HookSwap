/**
 * HookSwap Terminal — embedded, EXECUTING Buy/Sell ticket for the token trade page.
 *
 * Unlike the old TokenDetailScreen "TradeCard" (which deep-linked to `/swap`), this ticket
 * mounts the app's REAL swap-engine provider stack — the SAME one SwapScreen uses — pre-filled
 * with `native → THIS token` (Buy) / `THIS token → native` (Sell), and executes the swap
 * INLINE via `<TerminalSwapReviewFlow>` (the real review → confirm → submit modal). No swap
 * logic is reimplemented: the live Trading-API quote, price impact, slippage, min-received,
 * route and the approval/permit2/submit pipeline are all reused verbatim.
 *
 * Provider stack (mirror of SwapScreen.tsx):
 *   MultichainContextProvider
 *     SwapTransactionSettingsStoreContextProvider
 *       SwapAndLimitContextProvider
 *         SwapFormStoreContextProvider (prefilledState via useSwapPrefilledState)
 *           TransactionModalContextProvider
 *             <Body> — useSwapHandlers() → SwapDependenciesStoreContextProvider → TerminalSwapReviewFlow → <Ticket>
 *
 * DATA POLICY: every value comes from the live swap-form store / trade quote, or an honest
 * "—" / "Fetching…" state. Nothing is fabricated. The pair is locked to (native, token) — no
 * token selector is mounted (the token page owns the instrument), only the Buy/Sell direction
 * toggles which side the token is on.
 */
import { CurrencyAmount } from '@uniswap/sdk-core'
import type { Currency } from '@uniswap/sdk-core'
import { useMemo, useState } from 'react'
import { nativeOnChain } from 'uniswap/src/constants/tokens'
import type { UniverseChainId } from 'uniswap/src/features/chains/types'
import type { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { SwapTransactionSettingsStoreContextProvider } from 'uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/SwapTransactionSettingsStoreContextProvider'
import {
  useTransactionSettingsActions,
  useTransactionSettingsStore,
} from 'uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/useTransactionSettingsStore'
import {
  TransactionModalContextProvider,
  TransactionScreen,
} from 'uniswap/src/features/transactions/components/TransactionModal/TransactionModalContext'
import { SwapDependenciesStoreContextProvider } from 'uniswap/src/features/transactions/swap/stores/swapDependenciesStore/SwapDependenciesStoreContextProvider'
import { SwapFormStoreContextProvider } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/SwapFormStoreContextProvider'
import {
  useSwapFormStore,
  useSwapFormStoreDerivedSwapInfo,
} from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { useSwapPrefilledState } from 'uniswap/src/features/transactions/swap/form/hooks/useSwapPrefilledState'
import { currencyToAsset } from 'uniswap/src/features/transactions/swap/utils/asset'
import { WrapType } from 'uniswap/src/features/transactions/types/wrap'
import { CurrencyField } from 'uniswap/src/types/currency'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { ChainLogo } from '~/components/Logo/ChainLogo'
import { SwapAndLimitContextProvider } from '~/features/Swap/state/SwapContext'
import { useSwapHandlers } from '~/features/Swap/hooks/useSwapHandlers/useSwapHandlers'
import { useAccount } from '~/hooks/useAccount'
import { useWrapCallback as useDirectWrapCallback } from '~/pages/Swap/Limit/ConfirmLimitOrderModal/useWrapCallback'
import { MultichainContextProvider } from '~/state/multichain/MultichainContext'
import { maxAmountSpend } from '~/utils/maxAmountSpend'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { TerminalSwapReviewFlow, useTerminalReviewTrigger } from '~/terminal/screens/swap/TerminalSwapReviewFlow'
import { terminalColors, terminalFonts, terminalTokenGradients } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

/* ------------------------------------------------------------------ helpers */

function groupNumber(value: string): string {
  if (!value) {
    return value
  }
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [intPart, decPart] = unsigned.split('.')
  const grouped = Number(intPart || '0').toLocaleString('en-US')
  const out = decPart !== undefined ? `${grouped}.${decPart}` : grouped
  return negative ? `-${out}` : out
}

function fmtAmount(amount: Maybe<CurrencyAmount<Currency>>, sig = 6): string {
  if (!amount) {
    return ''
  }
  return groupNumber(amount.toSignificant(sig))
}

function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) {
    return cleaned
  }
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

/** Route label from the live trade quote's pool path: "DIRECT V3", "V2 + V3", "ROUTED", "—". */
function routeLabelFromTrade(activeTrade: unknown): string | undefined {
  const quote = (activeTrade as { quote?: { quote?: { route?: unknown[][] } } } | undefined)?.quote?.quote?.route
  if (!Array.isArray(quote) || quote.length === 0) {
    return undefined
  }
  // Single route → describe its hops; multiple split routes → "SPLIT".
  if (quote.length > 1) {
    return 'SPLIT'
  }
  const hops = quote[0]
  if (!Array.isArray(hops) || hops.length === 0) {
    return undefined
  }
  const versions = Array.from(
    new Set(
      hops
        .map((h) => (h as { type?: string })?.type)
        .map((t) => (t === 'v2-pool' ? 'V2' : t === 'v3-pool' ? 'V3' : t === 'v4-pool' ? 'V4' : undefined))
        .filter((v): v is string => Boolean(v)),
    ),
  )
  if (versions.length === 0) {
    return undefined
  }
  return hops.length === 1 ? `DIRECT ${versions[0]}` : versions.sort().join(' + ')
}

/* ------------------------------------------------------------- token logo */

function TicketTokenLogo({
  currencyInfo,
  size,
  fallbackGradient,
}: {
  currencyInfo: Maybe<CurrencyInfo>
  size: number
  fallbackGradient: string
}): JSX.Element {
  const url = currencyInfo?.logoUrl ?? undefined
  const chainId = currencyInfo?.currency.chainId
  const badgeSize = Math.max(9, Math.round(size * 0.5))
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: size, height: size, flexShrink: 0 }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: url
            ? `${terminalColors.panel} center/cover no-repeat url(${JSON.stringify(url)})`
            : fallbackGradient,
          display: 'block',
        }}
      />
      {chainId !== undefined ? (
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

/* ---------------------------------------------------------- receipt / rows */

function BreakdownRow({
  label,
  value,
  valueColor,
  last,
}: {
  label: string
  value: string
  valueColor?: string
  last?: boolean
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        padding: '8px 0',
        borderBottom: last ? 'none' : `1px dashed ${terminalColors.line}`,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10.5,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: terminalColors.ink3,
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: valueColor ?? terminalColors.ink }}>
        {value}
      </span>
    </div>
  )
}

/* --------------------------------------------------------------- constants */

/** Quick "you pay" amounts (native-denominated for a Buy; input-token for a Sell). */
const QUICK_AMOUNTS = ['0.01', '0.05', '0.1', '0.5', '1.0'] as const
/** Slippage presets (percent); "Auto" clears the custom tolerance. */
const SLIPPAGE_PRESETS = [0.5, 1, 3, 5] as const

/* ------------------------------------------------------------------ ticket */

function Ticket({ tokenSymbol }: { tokenSymbol: string }): JSX.Element {
  const accountDrawer = useAccountDrawer()
  const account = useAccount()
  const { onReview } = useTerminalReviewTrigger()

  const derived = useSwapFormStoreDerivedSwapInfo((s) => ({
    currencies: s.currencies,
    currencyAmounts: s.currencyAmounts,
    currencyBalances: s.currencyBalances,
    outputAmountUserWillReceive: s.outputAmountUserWillReceive,
    trade: s.trade,
    exactAmountToken: s.exactAmountToken,
    exactCurrencyField: s.exactCurrencyField,
    wrapType: s.wrapType,
  }))

  const { updateSwapForm, input, output } = useSwapFormStore((s) => ({
    updateSwapForm: s.updateSwapForm,
    input: s.input,
    output: s.output,
  }))

  const settingsActions = useTransactionSettingsActions()
  const customSlippage = useTransactionSettingsStore((s) => s.customSlippageTolerance)

  const inputInfo = derived.currencies[CurrencyField.INPUT]
  const outputInfo = derived.currencies[CurrencyField.OUTPUT]
  const inSym = inputInfo?.currency.symbol ?? ''
  const outSym = outputInfo?.currency.symbol ?? ''

  // "Buy" = the token is on the OUTPUT side (paying native). "Sell" = token on the INPUT side.
  const outputIsToken = Boolean(
    outputInfo?.currency && !outputInfo.currency.isNative && outputInfo.currency.symbol === tokenSymbol,
  )
  const isBuy = outputIsToken || !inputInfo?.currency // default to Buy until resolved

  const setSide = (buy: boolean): void => {
    if (buy === isBuy) {
      return
    }
    // Flip direction by swapping the two prefilled sides; keeps the typed amount as the "you pay".
    updateSwapForm({ input: output, output: input, exactCurrencyField: CurrencyField.INPUT })
  }

  // Single editable "you pay" field = the INPUT amount; the est. receive = the OUTPUT amount.
  const isExactIn = derived.exactCurrencyField === CurrencyField.INPUT
  const wrapType = derived.wrapType
  const isWrap = wrapType !== WrapType.NotApplicable

  const payValue = isExactIn ? derived.exactAmountToken : fmtAmount(derived.currencyAmounts[CurrencyField.INPUT])
  const hasAmount = Boolean(derived.exactAmountToken && Number(derived.exactAmountToken) > 0)

  const trade = derived.trade
  const activeTrade = trade.trade

  // Est. receive (output). Wrap = 1:1 (no quote resolves), else the quote's output amount.
  const receiveValue = isWrap
    ? hasAmount
      ? groupNumber(derived.exactAmountToken)
      : '—'
    : fmtAmount(derived.currencyAmounts[CurrencyField.OUTPUT]) ||
      (trade.isLoading && hasAmount ? 'Fetching…' : '')

  const onChangePay = (v: string): void =>
    updateSwapForm({
      exactAmountToken: v,
      exactCurrencyField: CurrencyField.INPUT,
      focusOnCurrencyField: CurrencyField.INPUT,
    })

  const sellBalance = derived.currencyBalances[CurrencyField.INPUT]

  // --- receipt values -------------------------------------------------------
  const impactPct = activeTrade?.priceImpact
  const impactValue = isWrap
    ? '0.00%'
    : impactPct
      ? `${impactPct.toFixed(2)}%`
      : trade.isLoading && hasAmount
        ? 'Fetching…'
        : '—'
  const impactColor = isWrap
    ? terminalColors.greenUp
    : impactPct
      ? Math.abs(Number(impactPct.toFixed(2))) < 1
        ? terminalColors.greenUp
        : terminalColors.warn
      : undefined

  // Slippage: the user's custom tolerance if set, else the trade's applied auto tolerance.
  const autoSlippage = activeTrade?.slippageTolerance
  const slippageValue =
    customSlippage !== undefined
      ? `${customSlippage}%`
      : autoSlippage !== undefined
        ? `${autoSlippage.toFixed(2)}% (auto)`
        : 'Auto'

  const minRecv = derived.outputAmountUserWillReceive ?? activeTrade?.minAmountOut
  const minRecvValue = isWrap
    ? hasAmount
      ? `${groupNumber(derived.exactAmountToken)} ${outSym}`
      : '—'
    : minRecv
      ? `${fmtAmount(minRecv)} ${outSym}`
      : trade.isLoading && hasAmount
        ? 'Fetching…'
        : '—'

  const routeValue = isWrap
    ? wrapType === WrapType.Wrap
      ? 'Wrap'
      : 'Unwrap'
    : routeLabelFromTrade(activeTrade) ?? (inputInfo && outputInfo ? `${inSym} → ${outSym}` : '—')

  // --- insufficient-balance guard ------------------------------------------
  const inputAmount = derived.currencyAmounts[CurrencyField.INPUT]
  const insufficientBalance = Boolean(
    account.address &&
      inputAmount &&
      sellBalance &&
      inputAmount.currency.equals(sellBalance.currency) &&
      inputAmount.greaterThan(sellBalance),
  )

  // Native ↔ wrapped-native direct wrap (bypasses the review pipeline, which no-ops for wraps).
  const directWrap = useDirectWrapCallback({
    inputCurrency: inputInfo?.currency,
    outputCurrency: outputInfo?.currency,
    typedValue: derived.exactAmountToken,
  })

  // --- execute-button state machine ----------------------------------------
  const sideVerb = isBuy ? 'Buy' : 'Sell'
  const accent = isBuy ? terminalColors.greenUp : terminalColors.redDown
  let label: string
  let enabled = false
  let onAct: () => void = () => undefined
  if (!account.address) {
    label = 'Connect wallet'
    enabled = true
    onAct = () => accountDrawer.open()
  } else if (!hasAmount) {
    label = 'Enter an amount'
  } else if (insufficientBalance) {
    label = inSym ? `Insufficient ${inSym} balance` : 'Insufficient balance'
  } else if (isWrap) {
    label = wrapType === WrapType.Wrap ? 'Wrap' : 'Unwrap'
    if (directWrap.execute) {
      enabled = true
      onAct = () => void directWrap.execute?.()
    }
  } else if (trade.isLoading) {
    label = 'Fetching best price…'
  } else if (trade.error) {
    const errMsg =
      typeof trade.error === 'object' && trade.error !== null && 'message' in trade.error
        ? (trade.error as { message: string }).message
        : undefined
    const isNoRoute = errMsg ? /\b404\b|no[_\s-]?route|not\s?found|insufficient\s?liquidity/i.test(errMsg) : false
    label = isNoRoute ? 'No route — insufficient liquidity' : 'Quote unavailable — try again'
  } else if (!activeTrade) {
    label = 'No route available'
  } else {
    label = `${sideVerb} ${tokenSymbol}`
    enabled = true
    onAct = onReview
  }

  const maxSpendable = sellBalance ? maxAmountSpend(sellBalance) : undefined

  return (
    <InstrumentPanel title={`Trade ${tokenSymbol}`} live meta={['Market']} style={{ width: '100%' }}>
      {/* Buy / Sell segmented control */}
      <div style={{ display: 'flex', gap: 4, background: terminalColors.panel2, borderRadius: 9, padding: 3 }}>
        {([true, false] as const).map((buy) => {
          const active = buy === isBuy
          const c = buy ? terminalColors.greenUp : terminalColors.redDown
          return (
            <button
              key={buy ? 'buy' : 'sell'}
              type="button"
              onClick={() => setSide(buy)}
              style={{
                flex: 1,
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 600,
                padding: '8px 0',
                borderRadius: 7,
                cursor: 'pointer',
                border: `1px solid ${active ? c : 'transparent'}`,
                background: active ? terminalColors.bg : 'transparent',
                color: active ? c : terminalColors.ink3,
              }}
            >
              {buy ? 'Buy' : 'Sell'}
            </button>
          )
        })}
      </div>

      {/* You pay (input) */}
      <div
        style={{
          background: terminalColors.panel,
          border: `1px solid ${terminalColors.line2}`,
          borderRadius: 8,
          padding: '12px 14px',
          marginTop: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: MONO,
            fontSize: 10.5,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: terminalColors.ink3,
            marginBottom: 8,
          }}
        >
          <span>You pay</span>
          <span>{sellBalance ? `Bal ${fmtAmount(sellBalance, 4)}` : 'Bal —'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <input
            inputMode="decimal"
            value={payValue}
            placeholder="0"
            onChange={(e) => onChangePay(sanitizeAmountInput(e.target.value))}
            style={{
              fontFamily: MONO,
              fontSize: 26,
              fontWeight: 600,
              color: terminalColors.ink,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              padding: 0,
              minWidth: 0,
              width: '100%',
            }}
          />
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: terminalColors.bg,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 999,
              padding: '5px 12px 5px 6px',
              flexShrink: 0,
            }}
          >
            <TicketTokenLogo currencyInfo={inputInfo} size={20} fallbackGradient={terminalTokenGradients.eth} />
            <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 13, color: terminalColors.ink }}>
              {inSym || '—'}
            </span>
          </span>
        </div>
        {/* Quick "you pay" amount chips */}
        <div style={{ display: 'flex', gap: 5, marginTop: 10 }}>
          {QUICK_AMOUNTS.map((amt) => {
            const active = derived.exactAmountToken === amt && isExactIn
            return (
              <button
                key={amt}
                type="button"
                onClick={() => onChangePay(amt)}
                style={{
                  flex: 1,
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 600,
                  color: active ? terminalColors.ink : terminalColors.ink2,
                  background: active ? terminalColors.bg : terminalColors.panel2,
                  border: `1px solid ${active ? terminalColors.line : terminalColors.line2}`,
                  borderRadius: 7,
                  padding: '5px 0',
                  cursor: 'pointer',
                }}
              >
                {amt}
              </button>
            )
          })}
          {maxSpendable && maxSpendable.greaterThan(0) ? (
            <button
              type="button"
              onClick={() => onChangePay(maxSpendable.toExact())}
              style={{
                flex: 1,
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 600,
                color: terminalColors.ink2,
                background: terminalColors.panel2,
                border: `1px solid ${terminalColors.line2}`,
                borderRadius: 7,
                padding: '5px 0',
                cursor: 'pointer',
              }}
            >
              Max
            </button>
          ) : null}
        </div>
      </div>

      {/* You receive (est.) */}
      <div
        style={{
          background: terminalColors.panel,
          border: `1px solid ${terminalColors.line2}`,
          borderRadius: 8,
          padding: '12px 14px',
          marginTop: 8,
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: terminalColors.ink3,
            marginBottom: 8,
          }}
        >
          You receive (est.)
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 26,
              fontWeight: 600,
              color: receiveValue && receiveValue !== 'Fetching…' ? terminalColors.ink : terminalColors.ink3,
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {receiveValue || '0'}
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: terminalColors.bg,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 999,
              padding: '5px 12px 5px 6px',
              flexShrink: 0,
            }}
          >
            <TicketTokenLogo currencyInfo={outputInfo} size={20} fallbackGradient={terminalTokenGradients.usdc} />
            <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 13, color: terminalColors.ink }}>
              {outSym || '—'}
            </span>
          </span>
        </div>
      </div>

      {/* Slippage presets */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: terminalColors.ink3,
            marginRight: 2,
          }}
        >
          Slippage
        </span>
        <button
          type="button"
          onClick={() => settingsActions.setCustomSlippageTolerance(undefined)}
          style={slippageChipStyle(customSlippage === undefined)}
        >
          Auto
        </button>
        {SLIPPAGE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => settingsActions.setCustomSlippageTolerance(p)}
            style={slippageChipStyle(customSlippage === p)}
          >
            {p}%
          </button>
        ))}
      </div>

      {/* Live receipt */}
      <div
        style={{
          border: `1px dashed ${terminalColors.line}`,
          borderRadius: 8,
          marginTop: 12,
          padding: '4px 14px',
          background: terminalColors.panel,
        }}
      >
        <BreakdownRow label="Price impact" value={impactValue} valueColor={impactColor} />
        <BreakdownRow label="Slippage" value={slippageValue} />
        <BreakdownRow label="Min received" value={minRecvValue} />
        <BreakdownRow label="Route" value={routeValue} last />
      </div>

      {/* Execute */}
      <button
        type="button"
        onClick={enabled ? onAct : undefined}
        disabled={!enabled}
        style={{
          width: '100%',
          height: 46,
          background: enabled ? accent : terminalColors.panel2,
          color: enabled ? terminalColors.btnInk : terminalColors.ink3,
          fontWeight: 600,
          fontSize: 14,
          fontFamily: SANS,
          borderRadius: 8,
          textAlign: 'center',
          marginTop: 12,
          border: 'none',
          cursor: enabled ? 'pointer' : 'not-allowed',
        }}
      >
        {label}
      </button>

      <p style={{ fontFamily: SANS, fontSize: 11, lineHeight: 1.5, color: terminalColors.faint, margin: '10px 0 0' }}>
        Executes on HookSwap through the live router. The quote, price impact and slippage above are what you confirm —
        funds only move when you approve the review modal.
      </p>
    </InstrumentPanel>
  )
}

function slippageChipStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 600,
    color: active ? terminalColors.ink : terminalColors.ink2,
    background: active ? terminalColors.bg : terminalColors.panel2,
    border: `1px solid ${active ? terminalColors.line : terminalColors.line2}`,
    borderRadius: 7,
    padding: '4px 9px',
    cursor: 'pointer',
  }
}

/* --------------------------------------------------------------- body / providers */

function TicketBody({ tokenSymbol }: { tokenSymbol: string }): JSX.Element {
  // The review flow reads swap dependencies (handlers/service) from this store — mount it here,
  // exactly as SwapScreen's body does, so <TerminalSwapReviewFlow> resolves it.
  const swapHandlers = useSwapHandlers()
  return (
    <SwapDependenciesStoreContextProvider swapHandlers={swapHandlers}>
      <TerminalSwapReviewFlow>
        <Ticket tokenSymbol={tokenSymbol} />
      </TerminalSwapReviewFlow>
    </SwapDependenciesStoreContextProvider>
  )
}

/**
 * Embedded, EXECUTING Buy/Sell ticket. `token` is THIS page's token (already resolved to a
 * `Currency`); the counter-asset is the chain's native token. Renders a loading shell until the
 * token resolves so the provider stack always gets a valid pair.
 */
export function TokenTradeTicket({
  chainId,
  token,
  tokenSymbol,
}: {
  chainId: UniverseChainId
  token: Maybe<Currency>
  tokenSymbol: string
}): JSX.Element {
  const native = useMemo(() => nativeOnChain(chainId), [chainId])
  const [txScreen, setTxScreen] = useState<TransactionScreen>(TransactionScreen.Form)

  // Default = Buy: pay native → receive this token.
  const prefilledState = useSwapPrefilledState({
    input: currencyToAsset(native),
    output: currencyToAsset(token),
    exactAmountToken: '',
    exactCurrencyField: CurrencyField.INPUT,
  })

  if (!token) {
    return (
      <InstrumentPanel title={`Trade ${tokenSymbol}`} meta={['Market']} style={{ width: '100%' }}>
        <div
          style={{
            padding: '40px 8px',
            textAlign: 'center',
            fontFamily: SANS,
            fontSize: 12.5,
            color: terminalColors.ink3,
          }}
        >
          Resolving {tokenSymbol}…
        </div>
      </InstrumentPanel>
    )
  }

  // Re-key on the resolved pair so the swap stores re-initialize once the token resolves.
  const pairKey = `${chainId}:${token.isNative ? 'native' : token.wrapped.address}`

  return (
    <MultichainContextProvider key={pairKey} initialChainId={chainId}>
      <SwapTransactionSettingsStoreContextProvider>
        <SwapAndLimitContextProvider initialInputCurrency={native} initialOutputCurrency={token}>
          <SwapFormStoreContextProvider prefilledState={prefilledState}>
            <TransactionModalContextProvider
              bottomSheetViewStyles={{}}
              screen={txScreen}
              setScreen={setTxScreen}
              onClose={() => undefined}
            >
              <TicketBody tokenSymbol={tokenSymbol} />
            </TransactionModalContextProvider>
          </SwapFormStoreContextProvider>
        </SwapAndLimitContextProvider>
      </SwapTransactionSettingsStoreContextProvider>
    </MultichainContextProvider>
  )
}
