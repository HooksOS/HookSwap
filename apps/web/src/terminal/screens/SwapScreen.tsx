/**
 * HookSwap Terminal — B2 Swap (chart-driven).
 *
 * Pixel-perfect recreation of design handoff screen B2 (column 1b) — see
 * `design_handoff_hookswap_terminal/screenshots/B02-swap.png` and the B2 markup in
 * `design/HookSwap Redesign.dc.html`. Three panels inside the Terminal content
 * region: a left market list (238px), a center chart panel, and a right swap
 * ticket (326px).
 *
 * DATA POLICY (no mock data — handoff hard rule):
 *   • Swap ticket — FULLY LIVE. Selected currencies, balances, the editable
 *     sell/buy amounts, and the rate / price-impact / min-received / route rows all
 *     come from the app's real swap engine (`derivedSwapInfo` → live Trading-API
 *     quote) reused via the same provider stack `/swap` uses. Token selection uses
 *     the app's real `SwapTokenSelector`. Loading / empty / error states are real.
 *   • Pair header price — LIVE from the quote's execution price.
 *   • Market list + price-history chart + 24h stats — require a pools/price-history
 *     subgraph that the hosted Trading API does not serve for the target chains.
 *     They render honest loading / empty states (NOT fabricated numbers). See the
 *     `TODO(data)` markers; wire to the self-hosted indexer when available.
 *
 * HookSwap ships v2 + v3 only (no Uniswap v4 / hooks — LOCKED decision). There is
 * NO hook UI on this screen: no hook-fee strip, no active-hook selector, no hook
 * config bar. The order ticket is Market / Send only — Limit orders are excluded
 * (UniswapX-only, and unsupported on Robinhood, the launch chain).
 */
import { CurrencyAmount, Percent, Token } from '@uniswap/sdk-core'
import type { Currency } from '@uniswap/sdk-core'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { COMMON_BASES } from 'uniswap/src/constants/routing'
import { nativeOnChain, THOOK_ROBINHOOD, WRAPPED_NATIVE_CURRENCY } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel, isUniverseChainId } from 'uniswap/src/features/chains/utils'
import type { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { ChainLogo } from '~/components/Logo/ChainLogo'
import { SwapTransactionSettingsStoreContextProvider } from 'uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/SwapTransactionSettingsStoreContextProvider'
import {
  TransactionModalContextProvider,
  TransactionScreen,
} from 'uniswap/src/features/transactions/components/TransactionModal/TransactionModalContext'
import { SwapTokenSelector } from 'uniswap/src/features/transactions/swap/form/SwapFormScreen/SwapTokenSelector/SwapTokenSelector'
import { SwapDependenciesStoreContextProvider } from 'uniswap/src/features/transactions/swap/stores/swapDependenciesStore/SwapDependenciesStoreContextProvider'
import { SwapFormStoreContextProvider } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/SwapFormStoreContextProvider'
import { WrapType } from 'uniswap/src/features/transactions/types/wrap'
import { useSwapHandlers } from '~/features/Swap/hooks/useSwapHandlers/useSwapHandlers'
import {
  useSwapFormStore,
  useSwapFormStoreDerivedSwapInfo,
} from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { useSwapPrefilledState } from 'uniswap/src/features/transactions/swap/form/hooks/useSwapPrefilledState'
import { currencyToAsset } from 'uniswap/src/features/transactions/swap/utils/asset'
import { CurrencyField } from 'uniswap/src/types/currency'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { SwapAndLimitContextProvider } from '~/features/Swap/state/SwapContext'
import { useAccount } from '~/hooks/useAccount'
import { useCurrency } from '~/hooks/Tokens'
import { useSelectChain } from '~/hooks/useSelectChain'
import { useUrlContext } from 'uniswap/src/contexts/UrlContext'
import { useSupportedChainId } from 'uniswap/src/features/chains/hooks/useSupportedChainId'
import { queryParametersToCurrencyState } from '~/pages/Swap/Swap/state/tradeQueryParams'
import { useWrapCallback as useDirectWrapCallback } from '~/pages/Swap/Limit/ConfirmLimitOrderModal/useWrapCallback'
import { maxAmountSpend } from '~/utils/maxAmountSpend'
import { MultichainContextProvider } from '~/state/multichain/MultichainContext'
import { useOnSelectCurrency } from 'uniswap/src/features/transactions/swap/form/hooks/useOnSelectCurrency'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { isChainDexLive } from '~/terminal/TerminalApp'
import { SwapChainSync } from '~/terminal/screens/swap/SwapChainSync'
import { TerminalChartPanel } from '~/terminal/screens/swap/TerminalChartPanel'
import { TerminalMarketsPanel } from '~/terminal/screens/swap/TerminalMarketsPanel'
import { TerminalSwapReviewFlow, useTerminalReviewTrigger } from '~/terminal/screens/swap/TerminalSwapReviewFlow'
import { terminalColors, terminalFonts, terminalShadows, terminalTokenGradients } from '~/terminal/theme/tokens'

/* ------------------------------------------------------------------ helpers */

const MONO = terminalFonts.mono

/** Group the integer part with thousands separators, preserving decimals. */
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

/** Format a CurrencyAmount to a grouped, significant-digit string. */
function fmtAmount(amount: Maybe<CurrencyAmount<Currency>>, sig = 6): string {
  if (!amount) {
    return ''
  }
  return groupNumber(amount.toSignificant(sig))
}

/** Keep only a valid decimal-number input string. */
function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) {
    return cleaned
  }
  // keep the first dot, strip subsequent dots
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

/* ------------------------------------------------------------- token logo */

/**
 * Real token logo (from `currencyInfo.logoUrl`) with a gradient-circle fallback
 * matching the prototype's placeholder circles when a logo URL is unavailable.
 */
function TerminalTokenLogo({
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
  const badgeSize = Math.max(10, Math.round(size * 0.55))
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

/* -------------------------------------------------------------- swap ticket */

// v2/v3 only — Market + Send. (TWAMM is a v4 hook; excluded per LOCKED decision.)
// "Send" routes to its own Terminal screen (/terminal/send); "Market" is this screen.
// "Limit" is intentionally omitted: limit orders are UniswapX-only (a hosted off-chain
// orderbook HookSwap does NOT run) and Robinhood — the launch chain — is not in
// LIMIT_SUPPORTED_CHAINS, so a Limit tab would be a non-functional control.
const TICKET_TABS = ['Market', 'Send'] as const

function CurrencyField_Panel({
  side,
  amountValue,
  balanceLabel,
  currencyInfo,
  fallbackGradient,
  editable,
  onAmountChange,
  onSelectToken,
  belowInput,
}: {
  side: 'Sell' | 'Buy'
  amountValue: string
  balanceLabel: string
  currencyInfo: Maybe<CurrencyInfo>
  fallbackGradient: string
  editable: boolean
  onAmountChange: (v: string) => void
  onSelectToken: () => void
  belowInput?: JSX.Element | null
}): JSX.Element {
  const symbol = currencyInfo?.currency.symbol
  return (
    <div
      style={{
        background: terminalColors.panel,
        border: `1px solid ${terminalColors.line2}`,
        borderRadius: 8,
        padding: '12px 14px',
        marginTop: 10,
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
        <span>{side}</span>
        <span>{balanceLabel}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <input
          inputMode="decimal"
          value={amountValue}
          placeholder="0"
          readOnly={!editable}
          onChange={(e) => onAmountChange(sanitizeAmountInput(e.target.value))}
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
        <button
          type="button"
          onClick={onSelectToken}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: terminalColors.bg,
            border: `1px solid ${terminalColors.line}`,
            borderRadius: 999,
            padding: '5px 11px 5px 6px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <TerminalTokenLogo currencyInfo={currencyInfo} size={20} fallbackGradient={fallbackGradient} />
          <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 13, color: terminalColors.ink }}>
            {symbol ?? 'Select'}
          </span>
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={terminalColors.ink2} strokeWidth={2.5}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {belowInput}
    </div>
  )
}

/* ----------------------------------------------------------- amount presets */

/** The four quick-amount fractions of the sell balance (Max leaves gas for native). */
const PRESET_PERCENTS = [25, 50, 75, 100] as const

/**
 * 25 / 50 / 75 / Max quick-amount buttons for the Sell field. Each fraction is
 * computed from the REAL connected-wallet sell balance. 25/50/75 are a raw
 * fraction of the FULL balance (NOT gas-reserve-capped) so they stay usable on
 * cheap-L2 dust balances below the ~0.01 native gas reserve `maxAmountSpend`
 * withholds; only "Max" uses `maxAmountSpend` so native tokens still leave a gas
 * reserve. Clicking sets EXACT_INPUT with the computed amount via the SAME setter
 * the manual input uses (`onSetAmount` → `onChangeSell`). Rendered only when
 * connected with a positive sell balance.
 */
function AmountPresetRow({
  balance,
  onSetAmount,
}: {
  balance: CurrencyAmount<Currency>
  onSetAmount: (v: string) => void
}): JSX.Element {
  // "Max" ceiling: full balance for tokens; balance minus a gas reserve for native.
  const spendableMax = maxAmountSpend(balance)
  const hasBalance = balance.greaterThan(0)

  return (
    <div style={{ display: 'flex', gap: 5, marginTop: 10 }}>
      {PRESET_PERCENTS.map((pct) => {
        const isMax = pct === 100
        // 25/50/75 = raw fraction of the full balance (never gas-capped); Max = spendable.
        const amount = isMax ? spendableMax : balance.multiply(new Percent(pct, 100))
        // Fractions disable only on a zero balance; Max disables when nothing is spendable
        // after the gas reserve (undefined/zero spendableMax).
        const disabled = isMax ? !amount || !amount.greaterThan(0) : !hasBalance
        return (
          <button
            key={pct}
            type="button"
            disabled={disabled}
            onClick={amount && !disabled ? () => onSetAmount(amount.toExact()) : undefined}
            style={{
              flex: 1,
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.01em',
              color: disabled ? terminalColors.ink3Alt : terminalColors.ink2,
              background: terminalColors.panel2,
              border: `1px solid ${terminalColors.line2}`,
              borderRadius: 7,
              padding: '5px 0',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.55 : 1,
            }}
          >
            {isMax ? 'Max' : `${pct}%`}
          </button>
        )
      })}
    </div>
  )
}

/** One mono key/value row in the breakdown box. */
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
        padding: '9px 0',
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

export function SwapTicket(): JSX.Element {
  const accountDrawer = useAccountDrawer()
  const account = useAccount()
  const navigate = useNavigate()
  // Launches the REAL review→confirm→submit flow. Valid only because SwapTicket is
  // rendered inside <TerminalSwapReviewFlow> (which provides the swap-form warning store).
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

  const { updateSwapForm, selectingCurrencyField, input, output } = useSwapFormStore((s) => ({
    updateSwapForm: s.updateSwapForm,
    selectingCurrencyField: s.selectingCurrencyField,
    input: s.input,
    output: s.output,
  }))

  const inputInfo = derived.currencies[CurrencyField.INPUT]
  const outputInfo = derived.currencies[CurrencyField.OUTPUT]
  const inSym = inputInfo?.currency.symbol ?? ''
  const outSym = outputInfo?.currency.symbol ?? ''
  const isExactIn = derived.exactCurrencyField === CurrencyField.INPUT

  // A native ↔ wrapped-native pair (e.g. ETH ↔ WETH) is a pure 1:1 wrap/unwrap, NOT a
  // poolable swap — the router correctly returns NO_ROUTE for it. Detect it via the
  // swap engine's own `wrapType` (getWrapType → WRAPPED_NATIVE_CURRENCY) so we bypass
  // the trading-API quote entirely and drive the existing wrap execution path
  // (useSwapHandlers → useWrapCallback) instead of hanging on "Fetching best price…".
  const wrapType = derived.wrapType
  const isWrap = wrapType !== WrapType.NotApplicable

  // For a wrap the output equals the input (1:1). The trade quote never resolves (there
  // is no pool), so `currencyAmounts[OUTPUT]` stays empty — mirror the exact amount into
  // both fields so the ticket shows the correct 1:1 amounts.
  const sellValue = isWrap
    ? derived.exactAmountToken
    : isExactIn
      ? derived.exactAmountToken
      : fmtAmount(derived.currencyAmounts[CurrencyField.INPUT])
  const buyValue = isWrap
    ? derived.exactAmountToken
    : !isExactIn
      ? derived.exactAmountToken
      : fmtAmount(derived.currencyAmounts[CurrencyField.OUTPUT])

  const sellBalance = derived.currencyBalances[CurrencyField.INPUT]
  const buyBalance = derived.currencyBalances[CurrencyField.OUTPUT]

  const onChangeSell = (v: string): void =>
    updateSwapForm({
      exactAmountToken: v,
      exactCurrencyField: CurrencyField.INPUT,
      focusOnCurrencyField: CurrencyField.INPUT,
    })
  const onChangeBuy = (v: string): void =>
    updateSwapForm({
      exactAmountToken: v,
      exactCurrencyField: CurrencyField.OUTPUT,
      focusOnCurrencyField: CurrencyField.OUTPUT,
    })

  const onSwitch = (): void => updateSwapForm({ input: output, output: input })

  // --- Live trade-derived breakdown -----------------------------------------
  const trade = derived.trade
  const activeTrade = trade.trade
  const hasAmount = Boolean(derived.exactAmountToken && Number(derived.exactAmountToken) > 0)

  // Wrap/unwrap is a fixed 1:1 with no price impact — show constant values and never
  // "Fetching…" (there is no quote to fetch).
  const rateValue = isWrap
    ? `1 ${inSym} = 1 ${outSym}`
    : activeTrade
      ? `1 ${inSym} = ${groupNumber(activeTrade.executionPrice.toSignificant(8))} ${outSym}`
      : trade.isLoading && hasAmount
        ? 'Fetching…'
        : '—'
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
  const minRecv = derived.outputAmountUserWillReceive ?? activeTrade?.minAmountOut
  const minRecvValue = isWrap
    ? hasAmount
      ? groupNumber(derived.exactAmountToken)
      : '—'
    : minRecv
      ? fmtAmount(minRecv)
      : trade.isLoading && hasAmount
        ? 'Fetching…'
        : '—'
  const routeValue = isWrap
    ? wrapType === WrapType.Wrap
      ? 'Wrap'
      : 'Unwrap'
    : inputInfo && outputInfo
      ? `${inSym} → ${outSym}`
      : '—'

  // --- HookSwap fee (LIVE 0.3% output-token PAY_PORTION) --------------------
  // Bound to the REAL swapFee the trade carries (derived from the quote's portionBips/
  // portionAmount/portionRecipient by getTradingApiSwapFee). Never a hardcoded string: the
  // percent and amount come straight from the executable trade, so the row matches what the
  // transaction actually skims. Wraps have no swap and no fee.
  const swapFee = activeTrade?.swapFee
  const swapFeeAmount =
    swapFee && activeTrade
      ? fmtAmount(CurrencyAmount.fromRawAmount(activeTrade.outputAmount.currency, swapFee.amount))
      : undefined
  const hookFeeLabel = swapFee ? `HookSwap fee · ${swapFee.percent.toFixed(2)}%` : 'HookSwap fee · 0.3%'
  const hookFeeValue = isWrap
    ? '—'
    : swapFee
      ? swapFeeAmount
        ? `${swapFeeAmount} ${outSym}`
        : `${swapFee.percent.toFixed(2)}%`
      : trade.isLoading && hasAmount
        ? 'Fetching…'
        : '—'

  // --- Insufficient-balance guard -------------------------------------------
  // Compare the REAL amount the user must pay — `currencyAmounts[INPUT]` (the parsed
  // exact-in amount, or the quote-derived input for an exact-out ticket) — against the
  // connected wallet's REAL input-token balance (`currencyBalances[INPUT]`, same source
  // the "Bal" label and preset row use). Flags ONLY when a wallet is connected AND both
  // amounts are known AND same-currency: an unloaded/unknown balance, disconnected
  // wallet, or a mid-token-switch currency mismatch never shows a false "insufficient"
  // state. Applies to wraps too (a native → wrapped deposit needs a funded balance).
  const inputAmount = derived.currencyAmounts[CurrencyField.INPUT]
  const insufficientBalance = Boolean(
    account.address &&
      inputAmount &&
      sellBalance &&
      inputAmount.currency.equals(sellBalance.currency) &&
      inputAmount.greaterThan(sellBalance),
  )

  // Native ↔ wrapped-native wrap/unwrap, executed DIRECTLY against WETH9 (viem
  // deposit/withdraw + addTransaction tracking) — bypasses the Terminal review pipeline,
  // which silently no-ops for wraps (a wrap has no trade, so prepareSwap falls through /
  // swallows in the review flow → the button appeared dead). `execute` is defined only
  // when the wrap is actually submittable. See ~/pages/Swap/Limit/…/useWrapCallback.
  const directWrap = useDirectWrapCallback({
    inputCurrency: inputInfo?.currency,
    outputCurrency: outputInfo?.currency,
    typedValue: derived.exactAmountToken,
  })

  // --- Swap button state ----------------------------------------------------
  let swapLabel: string
  let swapEnabled = false
  let onSwap: () => void = () => undefined
  if (!account.address) {
    swapLabel = 'Connect wallet'
    swapEnabled = true
    onSwap = () => accountDrawer.open()
  } else if (!hasAmount) {
    swapLabel = 'Enter an amount'
  } else if (insufficientBalance) {
    // Disabled, honest state (matches Uniswap production) — never opens the review flow.
    swapLabel = inSym ? `Insufficient ${inSym} balance` : 'Insufficient balance'
  } else if (isWrap) {
    // Native ↔ wrapped-native is a deterministic 1:1 needing no quote/route/review — drive
    // the WETH9 deposit/withdraw directly (see `directWrap` above). `execute` is present
    // only when submittable; if absent, keep the button disabled instead of a silent no-op.
    swapLabel = wrapType === WrapType.Wrap ? 'Wrap' : 'Unwrap'
    if (directWrap.execute) {
      swapEnabled = true
      onSwap = () => void directWrap.execute?.()
    }
  } else if (trade.isLoading) {
    swapLabel = 'Fetching best price…'
  } else if (trade.error) {
    // Surface the actual error when the quote service fails (vs just "no route").
    const errMsg = typeof trade.error === 'object' && trade.error !== null && 'message' in trade.error
      ? (trade.error as { message: string }).message
      : undefined
    // A 404 / NO_ROUTE_FOUND from the quote service is NOT a service failure — it means the
    // requested trade has no executable route, virtually always because pool liquidity is
    // absent/too thin for that size. Show the honest liquidity state, never a raw
    // "Response status: 404" (see the adapter's NO_ROUTE_FOUND detail).
    const isNoRoute = errMsg ? /\b404\b|no[_\s-]?route|not\s?found|insufficient\s?liquidity/i.test(errMsg) : false
    if (isNoRoute) {
      swapLabel = 'No route — insufficient liquidity'
    } else {
      swapLabel = errMsg && errMsg.length < 60 ? errMsg : 'Quote unavailable — try again'
    }
  } else if (!activeTrade) {
    swapLabel = 'No route available'
  } else {
    // Trade ready — open the REAL review→confirm→submit modal via the interface's
    // own swap pipeline, reused verbatim (see TerminalSwapReviewFlow / SwapReviewScreen).
    // The button opens the review step; funds only move on explicit confirm in that modal.
    swapLabel = 'Review swap →'
    swapEnabled = true
    onSwap = onReview
  }

  return (
    <InstrumentPanel title="Order Ticket" meta={['Market']} style={{ width: '100%' }}>
      {/* Market / Send tabs — desk segmented (well track, active = white keycap) */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          background: terminalColors.panel2,
          padding: 3,
          borderRadius: 8,
        }}
      >
        {TICKET_TABS.map((tab) => {
          const active = tab === 'Market'
          // "Send" is its own Terminal screen — clicking the tab routes there (real
          // transfer flow) rather than duplicating a form here.
          const to = tab === 'Send' ? '/terminal/send' : undefined
          return (
            <span
              key={tab}
              role={active ? undefined : 'link'}
              tabIndex={active ? undefined : 0}
              onClick={active || !to ? undefined : () => navigate(to)}
              onKeyDown={
                active || !to
                  ? undefined
                  : (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        navigate(to)
                      }
                    }
              }
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '5px 11px',
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 600,
                background: active ? terminalColors.bg : 'transparent',
                color: active ? terminalColors.ink : terminalColors.ink3,
                borderRadius: 6,
                boxShadow: active ? terminalShadows.segmentedActive : undefined,
                cursor: 'pointer',
              }}
            >
              {tab}
            </span>
          )
        })}
      </div>

      {/* Sell */}
      <CurrencyField_Panel
        side="Sell"
        amountValue={sellValue}
        balanceLabel={sellBalance ? `Bal ${fmtAmount(sellBalance, 4)}` : 'Bal —'}
        currencyInfo={inputInfo}
        fallbackGradient={terminalTokenGradients.eth}
        editable
        onAmountChange={onChangeSell}
        onSelectToken={() => updateSwapForm({ selectingCurrencyField: CurrencyField.INPUT })}
        // 25/50/75/Max — only with a connected wallet + a positive sell balance.
        belowInput={
          account.address && sellBalance && sellBalance.greaterThan(0) ? (
            <AmountPresetRow balance={sellBalance} onSetAmount={onChangeSell} />
          ) : null
        }
      />

      {/* Switch node */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '-8px 0', position: 'relative', zIndex: 2 }}>
        <button
          type="button"
          onClick={onSwitch}
          aria-label="Switch tokens"
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: terminalColors.bg,
            border: `1px solid ${terminalColors.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke={terminalColors.ink}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" />
          </svg>
        </button>
      </div>

      {/* Buy */}
      <CurrencyField_Panel
        side="Buy"
        amountValue={buyValue}
        balanceLabel={buyBalance ? `Bal ${fmtAmount(buyBalance, 4)}` : 'Bal —'}
        currencyInfo={outputInfo}
        fallbackGradient={terminalTokenGradients.usdc}
        editable
        onAmountChange={onChangeBuy}
        onSelectToken={() => updateSwapForm({ selectingCurrencyField: CurrencyField.OUTPUT })}
      />

      {/*
        MEV protection — intentionally a DISABLED, not-yet-available control (matches
        SettingsScreen's "Unavailable" treatment). Private-flow / protected routing
        needs the self-hosted protected-routing backend, which is not live for the
        HookSwap chains yet, so this is rendered off + disabled rather than a
        misleading toggle that implies active protection. Do NOT wire it on until the
        backend exists.
      */}
      <div
        aria-disabled="true"
        title="Requires the self-hosted protected-routing backend — not yet available for HookSwap chains."
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '14px 2px 6px',
          fontFamily: terminalFonts.sans,
          fontSize: 13,
          color: terminalColors.ink2,
          opacity: 0.6,
          cursor: 'not-allowed',
        }}
      >
        <svg
          width={15}
          height={15}
          viewBox="0 0 24 24"
          fill="none"
          stroke={terminalColors.ink3}
          strokeWidth={2}
          strokeLinejoin="round"
        >
          <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
        </svg>
        <span>MEV protection</span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            color: terminalColors.ink3,
            background: terminalColors.panel2,
            padding: '2px 6px',
            borderRadius: 5,
          }}
        >
          Soon
        </span>
        {/* Off + disabled toggle — visual only, no click handler. */}
        <span
          style={{
            marginLeft: 'auto',
            width: 38,
            height: 22,
            borderRadius: 999,
            background: terminalColors.line,
            position: 'relative',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              left: 3,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: terminalColors.bg,
            }}
          />
        </span>
      </div>

      {/* Live receipt — dashed instrument block, mono rows */}
      <div
        style={{
          border: `1px dashed ${terminalColors.line}`,
          borderRadius: 8,
          marginTop: 14,
          padding: '6px 14px',
          background: terminalColors.panel,
        }}
      >
        <BreakdownRow label="Rate" value={rateValue} />
        <BreakdownRow label="Price impact" value={impactValue} valueColor={impactColor} />
        <BreakdownRow label="Min received" value={minRecvValue} />
        <BreakdownRow label="Route" value={routeValue} />
        {/* LIVE HookSwap fee: 0.3% of the output token, bound to the trade's real swapFee. */}
        <BreakdownRow label={hookFeeLabel} value={hookFeeValue} />
        {/* Network fee: no verifiable per-quote gas estimate is surfaced here → honest "—". */}
        <BreakdownRow label="Network fee" value="—" last />
      </div>

      {/* Primary action — dynamic state machine (Connect / Enter amount / Insufficient /
          Wrap / Review swap). Green, full-width. */}
      <button
        type="button"
        onClick={swapEnabled ? onSwap : undefined}
        disabled={!swapEnabled}
        style={{
          width: '100%',
          height: 46,
          background: swapEnabled ? terminalColors.brandGreen : terminalColors.panel2,
          color: swapEnabled ? terminalColors.btnInk : terminalColors.ink3,
          fontWeight: 600,
          fontSize: 14,
          fontFamily: terminalFonts.sans,
          borderRadius: 8,
          textAlign: 'center',
          marginTop: 14,
          border: 'none',
          cursor: swapEnabled ? 'pointer' : 'not-allowed',
        }}
      >
        {swapLabel}
      </button>

      {/* Real token selector (app's SwapTokenSelector, driven by the swap form store) */}
      <SwapTokenSelector isModalOpen={selectingCurrencyField !== undefined} />
    </InstrumentPanel>
  )
}

/* ------------------------------------------------------------------- body */

/**
 * Honest prompt shown when the connected wallet is on a chain HookSwap doesn't
 * offer for trading yet. HookSwap launches on Robinhood Chain only (see
 * TERMINAL_LIVE_CHAIN_IDS in TerminalApp.tsx). On any other connected chain the
 * ticket seeds a native → canonical-token pair that has no HookSwap pool, so quotes
 * return NO_ROUTE — rather than fail silently, guide the user to switch. Non-blocking:
 * the ticket still renders below (e.g. an X Layer wallet's seeded test pair keeps
 * working), the banner just points to the live launch chain. Reuses the same
 * `useSelectChain` wallet chain-switch action the Terminal's top-bar switcher uses.
 */
function WrongChainBanner(): JSX.Element | null {
  const account = useAccount()
  const selectChain = useSelectChain()
  const [switching, setSwitching] = useState(false)
  const connectedChainId = account.chainId

  // Only relevant when the wallet is connected to a chain HookSwap does NOT trade on.
  // Data-driven via isChainDexLive (a chain with a live v2/v3 stack) — NOT hardcoded to
  // Robinhood, since swaps route on XLayer/Stable/HyperEVM/etc too.
  if (connectedChainId === undefined || isChainDexLive(connectedChainId as UniverseChainId)) {
    return null
  }

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        margin: '0 0 12px',
        padding: '10px 14px',
        background: terminalColors.panel2,
        border: `1px solid ${terminalColors.line2}`,
        borderRadius: 12,
      }}
    >
      <span style={{ fontFamily: terminalFonts.sans, fontSize: 12.5, color: terminalColors.ink2, lineHeight: 1.45 }}>
        Your wallet is on <strong style={{ color: terminalColors.ink }}>{getChainLabel(connectedChainId)}</strong>.
        HookSwap trades on Robinhood Chain.
      </span>
      <button
        type="button"
        disabled={switching}
        onClick={async () => {
          setSwitching(true)
          try {
            await selectChain(UniverseChainId.Robinhood)
          } finally {
            setSwitching(false)
          }
        }}
        style={{
          fontFamily: terminalFonts.sans,
          fontSize: 12.5,
          fontWeight: 600,
          color: terminalColors.btnInk,
          background: terminalColors.brandGreen,
          border: 'none',
          padding: '8px 14px',
          borderRadius: 9,
          cursor: switching ? 'not-allowed' : 'pointer',
          opacity: switching ? 0.6 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {switching ? 'Switching…' : 'Switch to Robinhood Chain'}
      </button>
    </div>
  )
}

function SwapScreenBody(): JSX.Element {
  const derived = useSwapFormStoreDerivedSwapInfo((s) => ({
    currencies: s.currencies,
  }))
  const inputCurrency = derived.currencies[CurrencyField.INPUT]?.currency
  const outputCurrency = derived.currencies[CurrencyField.OUTPUT]?.currency
  const isMobile = useIsMobileViewport()
  // Swap dependencies (handlers/service) — the review flow reads this store via
  // useSwapDependenciesStoreBase(); the real swap page provides it the same way
  // (SwapForm.tsx). Omitting it crashes the screen ("must be used within
  // SwapDependenciesStoreContextProvider"). Provided here around the whole body.
  const swapHandlers = useSwapHandlers()

  // Left "Markets" pane wiring — clicking a market row commits that token as the swap
  // OUTPUT via the app's OWN selection path (`useOnSelectCurrency` → `selectTradeableAsset`),
  // the SAME handler the real SwapTokenSelector uses, so the pair updates through the live
  // swap-form store (no bespoke state). The list is scoped to the active pair's chain.
  const onSelectCurrencyHandler = useOnSelectCurrency({})
  const handleSelectMarket = (currency: Currency): void =>
    onSelectCurrencyHandler({
      currency,
      field: CurrencyField.OUTPUT,
      allowCrossChainPair: false,
      isPreselectedAsset: false,
    })
  const marketChainId = inputCurrency?.chainId ?? outputCurrency?.chainId

  // Mobile: single, centered swap ticket (no chart / markets) to avoid horizontal overflow.
  if (isMobile) {
    return (
      <SwapDependenciesStoreContextProvider swapHandlers={swapHandlers}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 12px 28px' }}>
          <div style={{ width: 340, maxWidth: '100%' }}>
            <WrongChainBanner />
            <TerminalSwapReviewFlow>
              <SwapTicket />
            </TerminalSwapReviewFlow>
          </div>
        </div>
      </SwapDependenciesStoreContextProvider>
    )
  }

  return (
    <SwapDependenciesStoreContextProvider swapHandlers={swapHandlers}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 660 }}>
        {/* Full-width honest wrong-chain banner — horizontal inset only so it collapses to
            zero height (no phantom gap) when it returns null on the live chain. */}
        <div style={{ padding: '0 24px' }}>
          <WrongChainBanner />
        </div>
        {/* Desk: 3 framed instrument panels on cool paper, 16px gutters, top-aligned. */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: '20px 24px 40px' }}>
          {marketChainId !== undefined && isUniverseChainId(marketChainId) ? (
            <TerminalMarketsPanel
              chainId={marketChainId}
              activeCurrency={outputCurrency}
              onSelectCurrency={handleSelectMarket}
            />
          ) : null}
          <TerminalChartPanel inputCurrency={inputCurrency} outputCurrency={outputCurrency} />
          {/* Fixed-width, top-aligned wrapper: TransactionModal (rendered inside the flow)
              uses <Flex fill justifyContent="flex-end">, which would otherwise stretch to
              the row height and steal the chart's width / bottom-align the ticket. */}
          <div style={{ width: 340, flexShrink: 0, alignSelf: 'flex-start' }}>
            <TerminalSwapReviewFlow>
              <SwapTicket />
            </TerminalSwapReviewFlow>
          </div>
        </div>
      </div>
    </SwapDependenciesStoreContextProvider>
  )
}

/* --------------------------------------------------------------- providers */

/** The X Layer test pool default: native OKB → HKT (the seeded WOKB/HKT pool). */
const XLAYER_HKT = new Token(
  UniverseChainId.XLayer,
  '0x144331BB4C3026D135896CaFec3Ae3D667f4F376',
  18,
  'HKT',
  'HookSwap Test',
)

/**
 * A valid default OUTPUT token for `chainId` — the chain's canonical stablecoin
 * (USDC/USDT/DAI) from the app's own common-bases list, falling back to the
 * wrapped-native token. Returns `undefined` only if the chain exposes neither, in
 * which case the caller keeps the X Layer default so the pair is never broken.
 */
function resolveDefaultOutput(chainId: UniverseChainId): Currency | undefined {
  const tokens = (COMMON_BASES[chainId] ?? [])
    .map((info) => info.currency)
    .filter((currency): currency is Token => currency.isToken)
  const stablecoin = tokens.find((currency) => /usd/i.test(currency.symbol ?? ''))
  return stablecoin ?? tokens[tokens.length - 1] ?? WRAPPED_NATIVE_CURRENCY[chainId]
}

/**
 * B2 Swap screen. Mounts the same swap-engine provider stack the app's `/swap`
 * page uses (multichain → transaction settings → swap-and-limit → swap form
 * store), so the ticket reads a real live quote.
 *
 * Default pair: native ETH → tHOOK on the Robinhood seeded pool when disconnected or
 * the wallet is already on Robinhood (4663) — the only chain the Terminal offers for
 * live trading right now. X Layer's seeded OKB → HKT pair is kept when actually
 * connected there. When a wallet is connected on ANOTHER chain, tHOOK/HKT are invalid
 * there — so the pair is re-seeded to that chain's native token → a REAL, valid output
 * (its canonical stablecoin / wrapped-native from common-bases), so the header never
 * renders a broken "native / —" pair. Keyed on the resolved chain so switching chains
 * re-initializes a valid pair.
 */
export function SwapScreen(): JSX.Element {
  const account = useAccount()
  const activeChainId = account.chainId

  // Honor deep-link currency params (e.g. ?chain=robinhood&outputCurrency=0x5fc5…USDG) so a
  // shared swap link opens on the intended pair instead of silently falling back to the
  // hardcoded default. Parsed from the URL and resolved via the app's own token resolver
  // (token list + on-chain), so ANY valid token address on the chain is honored — not just
  // the seeded defaults. When no currency params are present these stay undefined and the
  // existing default-pair logic below is used unchanged.
  const { useParsedQueryString } = useUrlContext()
  const parsedQs = useParsedQueryString()
  const urlCurrencyState = useMemo(() => queryParametersToCurrencyState(parsedQs), [parsedQs])
  const urlChainId = useSupportedChainId(urlCurrencyState.chainId)
  const urlInputCurrency = useCurrency({ address: urlCurrencyState.inputCurrencyAddress, chainId: urlChainId })
  const urlOutputCurrency = useCurrency({ address: urlCurrencyState.outputCurrencyAddress, chainId: urlChainId })

  const { chainId, initialInputCurrency, initialOutputCurrency } = useMemo(() => {
    // A deep link with a resolved currency wins over every default below (the shared link's
    // intent). Missing side falls back to the chain's native input / a valid default output.
    if (urlInputCurrency || urlOutputCurrency) {
      const resolvedChain = (urlChainId ??
        (urlOutputCurrency?.chainId as UniverseChainId | undefined) ??
        (urlInputCurrency?.chainId as UniverseChainId | undefined) ??
        UniverseChainId.Robinhood) as UniverseChainId
      return {
        chainId: resolvedChain,
        initialInputCurrency: urlInputCurrency ?? nativeOnChain(resolvedChain),
        initialOutputCurrency:
          urlOutputCurrency ?? resolveDefaultOutput(resolvedChain) ?? (THOOK_ROBINHOOD as Currency),
      }
    }
    // Disconnected, or already on Robinhood → the real ETH → USDG stablecoin pair. The
    // WETH/USDG anchor pool now has liquidity, so USDG (resolveDefaultOutput's canonical
    // stablecoin pick) is the correct default; tHOOK is a test/seed token and is no
    // longer surfaced. Falls back to tHOOK only if the stablecoin can't be resolved.
    // Robinhood is the only chain the Terminal offers for live trading right now.
    if (activeChainId === undefined || activeChainId === UniverseChainId.Robinhood) {
      return {
        chainId: UniverseChainId.Robinhood,
        initialInputCurrency: nativeOnChain(UniverseChainId.Robinhood),
        initialOutputCurrency: resolveDefaultOutput(UniverseChainId.Robinhood) ?? (THOOK_ROBINHOOD as Currency),
      }
    }
    // Connected on X Layer → keep its seeded OKB → HKT test pair.
    if (activeChainId === UniverseChainId.XLayer) {
      return {
        chainId: UniverseChainId.XLayer,
        initialInputCurrency: nativeOnChain(UniverseChainId.XLayer),
        initialOutputCurrency: XLAYER_HKT as Currency,
      }
    }
    // Connected on another chain → native → a valid canonical output on THAT chain.
    const output = resolveDefaultOutput(activeChainId)
    if (!output) {
      return {
        chainId: UniverseChainId.Robinhood,
        initialInputCurrency: nativeOnChain(UniverseChainId.Robinhood),
        initialOutputCurrency: THOOK_ROBINHOOD as Currency,
      }
    }
    return {
      chainId: activeChainId,
      initialInputCurrency: nativeOnChain(activeChainId) as Currency,
      initialOutputCurrency: output,
    }
  }, [activeChainId, urlInputCurrency, urlOutputCurrency, urlChainId])

  // Identity of the resolved pair. A deep-link currency (e.g. USDG) may resolve
  // asynchronously (undefined → token); re-keying the swap provider subtree on the pair
  // re-initializes `prefilledState` with the resolved currency so the ticket reflects it
  // instead of the stale default. Stable for a given pair, so in-screen token switching
  // (which updates the swap-form store, not these initial values) never remounts.
  const pairKey = `${chainId}:${
    initialInputCurrency?.isNative ? 'native' : (initialInputCurrency as Token | undefined)?.address ?? '—'
  }:${initialOutputCurrency?.isNative ? 'native' : (initialOutputCurrency as Token | undefined)?.address ?? '—'}`

  // Minimal transaction-modal context (mirrors TransactionModal.web.tsx) — the
  // SwapTokenSelector's selection hooks require it even outside a modal flow.
  const [txScreen, setTxScreen] = useState<TransactionScreen>(TransactionScreen.Form)

  const prefilledState = useSwapPrefilledState({
    input: currencyToAsset(initialInputCurrency),
    output: currencyToAsset(initialOutputCurrency),
    exactAmountToken: '',
    exactCurrencyField: CurrencyField.INPUT,
  })

  return (
    <MultichainContextProvider key={pairKey} initialChainId={chainId}>
      <SwapTransactionSettingsStoreContextProvider>
        <SwapAndLimitContextProvider
          initialInputCurrency={initialInputCurrency}
          initialOutputCurrency={initialOutputCurrency}
        >
          <SwapFormStoreContextProvider prefilledState={prefilledState}>
            {/* Keeps the top-nav switcher, the wallet chain, and the token-selector
                chain dropdown in lock-step (single source of truth = wallet chain,
                fallback = this screen's resolved active chain). */}
            <SwapChainSync fallbackChainId={chainId} />
            <TransactionModalContextProvider
              bottomSheetViewStyles={{}}
              screen={txScreen}
              setScreen={setTxScreen}
              onClose={() => undefined}
            >
              <SwapScreenBody />
            </TransactionModalContextProvider>
          </SwapFormStoreContextProvider>
        </SwapAndLimitContextProvider>
      </SwapTransactionSettingsStoreContextProvider>
    </MultichainContextProvider>
  )
}
