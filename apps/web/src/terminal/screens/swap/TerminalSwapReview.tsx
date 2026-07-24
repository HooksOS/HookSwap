/**
 * HookSwap Terminal — B8 confirm/review body (DAYSIGNAL skin).
 *
 * This is a PRESENTATION-ONLY, Terminal-styled replacement for the shared
 * `SwapReviewScreen` (`packages/uniswap/.../SwapReviewScreen/SwapReviewScreen.tsx`).
 * It is rendered by `TerminalSwapReviewFlow` in place of `<SwapReviewScreen/>`, so
 * it lives INSIDE the exact same provider tree (`SwapReviewScreenProviders` mounts
 * the review / callbacks / transaction / warning stores + `usePrepareSwap`). We read
 * the SAME zustand stores and call the SAME handlers the stock screen does — nothing
 * about swap execution, approvals, permit2, or the review → pending → success/error
 * state machine is re-implemented. Only the pixels differ.
 *
 * Why a Terminal-scoped copy instead of theming the shared screen:
 *   `SwapReviewScreen` + its children (`TransactionAmountsReview`, `SwapDetails`,
 *   `SwapReviewFooter`, `SubmitSwapButton`) are shared Uniswap code still consumed
 *   by the stock web flow (`SwapFlow/CurrentScreen.web.tsx`). Editing them to look
 *   like the Terminal would restyle every other consumer. Because our Terminal swap
 *   already renders its OWN review modal from `TerminalSwapReviewFlow`, the cleanest
 *   and safest move is to swap the review BODY for this Terminal-native component and
 *   leave the shared components byte-for-byte untouched.
 *
 * Logic parity with `SwapReviewScreen` (verified against that file):
 *   • `usePrepareSwapTransactionEffect()` is called unconditionally at the top (tx prep).
 *   • loading / missing-params / submission-error gating is identical.
 *   • the approve/permit multi-step web flow reuses the SHARED `ProgressIndicator`
 *     (the same component the stock screen renders) — zero step-machine rebuild.
 *   • the error branch reuses the SHARED `SwapErrorScreen` (retry/resubmit intact).
 *   • the CTA reuses the SHARED submit handler `onSwapButtonClick` and the SHARED
 *     `getActionText` label map; `useTerminalSwapSubmit` is a faithful port of the
 *     stock `useSwapSubmitButton` (same store reads, same disabled derivation).
 *   • the "new quote requires acceptance" gate reuses the store's `onAcceptTrade`.
 *
 * The breakdown rows (Rate / Price impact / Min received / HookSwap fee / Network
 * cost) are computed from the accepted trade EXACTLY as the Order Ticket does
 * (`SwapScreen.tsx`), so the review mirrors the ticket. Absent values render "—".
 */
import { CurrencyAmount } from '@uniswap/sdk-core'
import type { Currency } from '@uniswap/sdk-core'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CurrencyLogo } from 'uniswap/src/components/CurrencyLogo/CurrencyLogo'
import { ProgressIndicator } from 'uniswap/src/components/ConfirmSwapModal/ProgressIndicator'
import { WarningSeverity } from 'uniswap/src/components/modals/WarningModal/types'
import type { Warning } from 'uniswap/src/components/modals/WarningModal/types'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { useGasFeeFormattedDisplayAmounts } from 'uniswap/src/features/gas/hooks'
import type { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import { useCurrencyInfo } from 'uniswap/src/features/tokens/useCurrencyInfo'
import { useUSDCValue } from 'uniswap/src/features/transactions/hooks/useUSDCPrice'
import { useTransactionModalContext } from 'uniswap/src/features/transactions/components/TransactionModal/TransactionModalContext'
import { useSwapOnPrevious } from 'uniswap/src/features/transactions/swap/review/hooks/useSwapOnPrevious'
import { useActivePlanStatus } from 'uniswap/src/features/transactions/swap/review/hooks/useActivePlanStatus'
import { usePrepareSwapTransactionEffect } from 'uniswap/src/features/transactions/swap/review/hooks/usePrepareSwapTransactionEffect'
import { useSwapReviewCallbacksStore } from 'uniswap/src/features/transactions/swap/review/stores/swapReviewCallbacksStore/useSwapReviewCallbacksStore'
import {
  useShowInterfaceReviewSteps,
  useSwapReviewStore,
} from 'uniswap/src/features/transactions/swap/review/stores/swapReviewStore/useSwapReviewStore'
import {
  useIsSwapMissingParams,
  useIsSwapReviewLoading,
  useSwapReviewError,
  useSwapReviewTransactionStore,
} from 'uniswap/src/features/transactions/swap/review/stores/swapReviewTransactionStore/useSwapReviewTransactionStore'
import { useSwapReviewWarningStore } from 'uniswap/src/features/transactions/swap/review/stores/swapReviewWarningStore/useSwapReviewWarningStore'
import { SwapErrorScreen } from 'uniswap/src/features/transactions/swap/review/SwapReviewScreen/SwapErrorScreen'
import { getActionText } from 'uniswap/src/features/transactions/swap/review/SwapReviewScreen/SwapReviewFooter/SubmitSwapButton'
import { SwapReviewWarningModal } from 'uniswap/src/features/transactions/swap/review/SwapReviewScreen/SwapReviewWarningModal'
import {
  useSwapFormStore,
  useSwapFormStoreDerivedSwapInfo,
} from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { isValidSwapTxContext } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { isChained } from 'uniswap/src/features/transactions/swap/utils/routing'
import { getTradeAmounts } from 'uniswap/src/features/transactions/swap/utils/getTradeAmounts'
import { getShouldDisplayTokenWarningCard } from 'uniswap/src/features/transactions/TransactionDetails/utils/getShouldDisplayTokenWarningCard'
import { CurrencyField } from 'uniswap/src/types/currency'
import { buildCurrencyId, currencyAddress } from 'uniswap/src/utils/currencyId'
import { getSymbolDisplayText } from 'uniswap/src/utils/currency'
import { SagaStatus, useMonitoredSagaStatus } from 'uniswap/src/utils/saga'
import { NumberType } from 'utilities/src/format/types'
import { logger } from 'utilities/src/logger/logger'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono

/* ------------------------------------------------------------------ helpers */

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

/* ------------------------------------------------------------------ chrome */

function ReviewHeader({ title, onClose }: { title: string; onClose: () => void }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '18px 18px 12px',
        borderBottom: `1px solid ${terminalColors.line2}`,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: terminalColors.ink3,
        }}
      >
        {title}
      </span>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: terminalColors.panel2,
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={terminalColors.ink2} strokeWidth={2.4}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}

/** One of the two big token rows: mono amount + symbol, USD subtext, token logo. */
function TerminalAmountRow({
  currencyInfo,
  formattedTokenAmount,
  formattedFiatAmount,
  dim,
}: {
  currencyInfo: CurrencyInfo | undefined
  formattedTokenAmount: string
  formattedFiatAmount: string
  dim: boolean
}): JSX.Element {
  const symbol = getSymbolDisplayText(currencyInfo?.currency.symbol) ?? ''
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, opacity: dim ? 0.5 : 1 }}>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 24,
            fontWeight: 600,
            color: terminalColors.ink,
            lineHeight: 1.15,
            wordBreak: 'break-word',
          }}
        >
          {groupNumber(formattedTokenAmount)} <span style={{ color: terminalColors.ink2 }}>{symbol}</span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 12, color: terminalColors.ink3, marginTop: 4 }}>
          {formattedFiatAmount || '—'}
        </div>
      </div>
      {currencyInfo ? (
        <CurrencyLogo currencyInfo={currencyInfo} size={36} />
      ) : (
        <span style={{ width: 36, height: 36, borderRadius: '50%', background: terminalColors.panel2, flexShrink: 0 }} />
      )}
    </div>
  )
}

/** One mono key/value breakdown row — matches the Order Ticket's `BreakdownRow`. */
function ReviewRow({
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

/* ------------------------------------------------------------- submit button */

/**
 * Faithful port of the stock `useSwapSubmitButton` (local to `SwapReviewFooter.tsx`).
 * Same store reads, same disabled derivation, same `onSwapButtonClick` submit handler —
 * so the Terminal CTA drives the identical execution/approval/permit path.
 */
function useTerminalSwapSubmit(): {
  disabled: boolean
  showPendingUI: boolean
  warning: Warning | undefined
  onSubmit: () => Promise<void>
  isSubmitting: boolean
  isSwapOrPlanSagaRunning: boolean
} {
  const {
    tokenWarningProps,
    feeOnTransferProps,
    blockingWarning,
    newTradeRequiresAcceptance,
    reviewScreenWarning,
    swapTxContext,
    isWrap,
  } = useSwapReviewTransactionStore((s) => ({
    tokenWarningProps: s.tokenWarningProps,
    feeOnTransferProps: s.feeOnTransferProps,
    blockingWarning: s.blockingWarning,
    newTradeRequiresAcceptance: s.newTradeRequiresAcceptance,
    reviewScreenWarning: s.reviewScreenWarning,
    swapTxContext: s.swapTxContext,
    isWrap: s.isWrap,
  }))

  const tokenWarningChecked = useSwapReviewWarningStore((s) => s.tokenWarningChecked)
  const { isSubmitting, showPendingUI } = useSwapFormStore((s) => ({
    isSubmitting: s.isSubmitting,
    showPendingUI: s.showPendingUI,
  }))
  const onSwapButtonClick = useSwapReviewCallbacksStore((s) => s.onSwapButtonClick)
  const { shouldDisplayTokenWarningCard } = getShouldDisplayTokenWarningCard({
    tokenWarningProps,
    feeOnTransferProps,
  })

  const swapSagaState = useMonitoredSagaStatus('swapSaga')
  const planSagaState = useMonitoredSagaStatus('planSaga')
  const isSwapOrPlanSagaRunning =
    swapSagaState.status === SagaStatus.Started || planSagaState.status === SagaStatus.Started

  const disabled = useMemo(() => {
    const validSwap = isValidSwapTxContext(swapTxContext)
    const isTokenWarningBlocking = shouldDisplayTokenWarningCard && !tokenWarningChecked
    return (
      (!validSwap && !isWrap) ||
      !!blockingWarning ||
      newTradeRequiresAcceptance ||
      isSubmitting ||
      isTokenWarningBlocking ||
      isSwapOrPlanSagaRunning
    )
  }, [
    swapTxContext,
    isWrap,
    blockingWarning,
    newTradeRequiresAcceptance,
    isSubmitting,
    tokenWarningChecked,
    shouldDisplayTokenWarningCard,
    isSwapOrPlanSagaRunning,
  ])

  return {
    disabled,
    showPendingUI,
    onSubmit: onSwapButtonClick,
    warning: reviewScreenWarning?.warning,
    isSubmitting,
    isSwapOrPlanSagaRunning,
  }
}

function TerminalSubmitButton(): JSX.Element | null {
  const { t } = useTranslation()
  const showInterfaceReviewSteps = useShowInterfaceReviewSteps()
  const { disabled, showPendingUI, warning, onSubmit, isSubmitting, isSwapOrPlanSagaRunning } = useTerminalSwapSubmit()
  const { passkeyAuthStatus } = useTransactionModalContext()

  const {
    wrapType,
    trade: { trade, indicativeTrade },
  } = useSwapFormStoreDerivedSwapInfo((s) => ({ wrapType: s.wrapType, trade: s.trade }))
  const { hasActivePlan, lastStepFailed } = useActivePlanStatus()
  const swapTxContextForText = useSwapReviewTransactionStore((s) => s.swapTxContext)
  const indicative = Boolean(!trade && indicativeTrade)

  // Mirror the footer gate: during a multi-step (approve/permit) web flow the steps
  // list replaces the button, unless a failed plan needs a Retry. (All hooks above
  // this return run unconditionally — rules-of-hooks safe.)
  const allowRetryPlan = hasActivePlan && !isSubmitting
  if (showInterfaceReviewSteps && !allowRetryPlan) {
    return null
  }

  let label: string
  if (indicative) {
    label = t('swap.finalizingQuote')
  } else if (showPendingUI || isSubmitting) {
    label = t('common.confirmWallet')
  } else {
    label = getActionText({
      t,
      wrapType,
      swapTxContext: swapTxContextForText,
      warning,
      isAuthenticated: Boolean(passkeyAuthStatus?.isSessionAuthenticated),
      hasActivePlan,
      lastStepFailed,
    })
  }

  const busy = indicative || showPendingUI || isSubmitting
  const isDisabled = disabled || indicative

  // Warning-driven CTA color, mirroring `SubmitSwapButton`'s `warningVariant`.
  const highSeverity = warning?.severity === WarningSeverity.High
  const medSeverity = warning?.severity === WarningSeverity.Medium
  const bg = isDisabled
    ? terminalColors.panel2
    : highSeverity
      ? terminalColors.redDown
      : medSeverity
        ? terminalColors.warn
        : terminalColors.brandGreen
  const fg = isDisabled ? terminalColors.ink3 : terminalColors.btnInk

  return (
    <>
      {isSwapOrPlanSagaRunning && !isSubmitting && (
        <div
          style={{
            fontFamily: terminalFonts.sans,
            fontSize: 12,
            color: terminalColors.warn,
            textAlign: 'center',
            paddingBottom: 10,
          }}
        >
          {t('swap.review.pendingWalletAction')}
        </div>
      )}
      <button
        type="button"
        onClick={!isDisabled ? () => void onSubmit() : undefined}
        disabled={isDisabled}
        style={{
          width: '100%',
          height: 46,
          background: bg,
          color: fg,
          fontWeight: 600,
          fontSize: 14,
          fontFamily: terminalFonts.sans,
          borderRadius: 8,
          border: 'none',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {busy && <TerminalSpinner size={16} color={fg} />}
        {label}
      </button>
    </>
  )
}

function TerminalSpinner({ size, color }: { size: number; color: string }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'tm-spin 0.8s linear infinite' }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={3} />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />
    </svg>
  )
}

/* ------------------------------------------------------------------- screen */

export function TerminalSwapReviewScreen(): JSX.Element | null {
  const { t } = useTranslation()
  const { convertFiatAmountFormatted, formatCurrencyAmount } = useLocalizationContext()

  // MUST run unconditionally, exactly like `SwapReviewScreen` — prepares the swap tx.
  usePrepareSwapTransactionEffect()

  const { onPrev } = useSwapOnPrevious()
  const showInterfaceReviewSteps = useShowInterfaceReviewSteps()
  const isLoading = useIsSwapReviewLoading()
  const isSwapMissingParams = useIsSwapMissingParams()
  const error = useSwapReviewError()

  const {
    acceptedDerivedSwapInfo,
    newTradeRequiresAcceptance,
    isWrap,
    gasFee,
    chainId,
    onAcceptTrade,
  } = useSwapReviewTransactionStore((s) => ({
    acceptedDerivedSwapInfo: s.acceptedDerivedSwapInfo,
    newTradeRequiresAcceptance: s.newTradeRequiresAcceptance,
    isWrap: s.isWrap,
    gasFee: s.gasFee,
    chainId: s.chainId,
    onAcceptTrade: s.onAcceptTrade,
  }))

  const { steps, currentStep, hideContent } = useSwapReviewStore((s) => ({
    steps: s.steps,
    currentStep: s.currentStep,
    hideContent: s.hideContent,
  }))

  const trade = acceptedDerivedSwapInfo?.trade.trade
  const isChainedAction = Boolean(trade && isChained({ routing: trade.routing }))

  // --- Amounts (mirrors TransactionAmountsReview) ---------------------------
  const amounts = acceptedDerivedSwapInfo ? getTradeAmounts(acceptedDerivedSwapInfo) : undefined
  const inputCurrencyAmount = amounts?.inputCurrencyAmount
  const outputCurrencyAmount = amounts?.outputCurrencyAmount

  const currencyInInfo = useCurrencyInfo(
    inputCurrencyAmount
      ? buildCurrencyId(inputCurrencyAmount.currency.chainId, currencyAddress(inputCurrencyAmount.currency))
      : undefined,
  )
  const currencyOutInfo = useCurrencyInfo(
    outputCurrencyAmount
      ? buildCurrencyId(outputCurrencyAmount.currency.chainId, currencyAddress(outputCurrencyAmount.currency))
      : undefined,
  )

  const usdIn = useUSDCValue(inputCurrencyAmount)
  const usdOut = useUSDCValue(outputCurrencyAmount)

  // Network cost — real gas from the review store, formatted; honest "—" when absent.
  const gasChainId = (chainId ?? inputCurrencyAmount?.currency.chainId ?? UniverseChainId.Mainnet) as UniverseChainId
  const { gasFeeFormatted } = useGasFeeFormattedDisplayAmounts({
    gasFee,
    chainId: gasChainId,
    placeholder: undefined,
  })

  // --- Early states (identical gating to SwapReviewScreen) ------------------
  if (isLoading) {
    return (
      <ReviewCard>
        <ReviewHeader title={t('swap.review.summary')} onClose={onPrev} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 260 }}>
          <TerminalSpinner size={34} color={terminalColors.brandGreen} />
        </div>
      </ReviewCard>
    )
  }

  if (isSwapMissingParams) {
    logger.error('Missing required props in `derivedSwapInfo` to render `SwapReview` screen.', {
      tags: { file: 'TerminalSwapReview', function: 'render' },
    })
    return null
  }

  if (error.submissionError) {
    return (
      <ReviewCard>
        <SwapErrorScreen
          submissionError={error.submissionError}
          setSubmissionError={error.setSubmissionError}
          resubmitSwap={error.onSwapButtonClick}
          onPressRetry={error.onPressRetry}
          onClose={onPrev}
        />
      </ReviewCard>
    )
  }

  const formattedIn = formatCurrencyAmount({ value: inputCurrencyAmount, type: NumberType.TokenTx })
  const formattedOut = formatCurrencyAmount({ value: outputCurrencyAmount, type: NumberType.TokenTx })
  const fiatIn = convertFiatAmountFormatted(usdIn?.toExact(), NumberType.FiatTokenQuantity)
  const fiatOut = convertFiatAmountFormatted(usdOut?.toExact(), NumberType.FiatTokenQuantity)

  const dimInput = Boolean(
    newTradeRequiresAcceptance && acceptedDerivedSwapInfo?.exactCurrencyField === CurrencyField.OUTPUT,
  )
  const dimOutput = Boolean(
    newTradeRequiresAcceptance && acceptedDerivedSwapInfo?.exactCurrencyField === CurrencyField.INPUT,
  )

  // --- Breakdown values (mirrors the Order Ticket, computed from accepted trade) ---
  const inSym = currencyInInfo?.currency.symbol ?? inputCurrencyAmount?.currency.symbol ?? ''
  const outSym = currencyOutInfo?.currency.symbol ?? outputCurrencyAmount?.currency.symbol ?? ''

  const rateValue = isWrap
    ? `1 ${inSym} = 1 ${outSym}`
    : trade
      ? `1 ${inSym} = ${groupNumber(trade.executionPrice.toSignificant(8))} ${outSym}`
      : '—'

  const impactPct = trade?.priceImpact
  const impactValue = isWrap ? '0.00%' : impactPct ? `${impactPct.toFixed(2)}%` : '—'
  const impactColor = isWrap
    ? terminalColors.greenUp
    : impactPct
      ? Math.abs(Number(impactPct.toFixed(2))) < 1
        ? terminalColors.greenUp
        : terminalColors.warn
      : undefined

  const minRecv = acceptedDerivedSwapInfo?.outputAmountUserWillReceive ?? trade?.minAmountOut
  const minRecvValue = isWrap
    ? outputCurrencyAmount
      ? `${fmtAmount(outputCurrencyAmount)} ${outSym}`
      : '—'
    : minRecv
      ? `${fmtAmount(minRecv)} ${outSym}`
      : '—'

  const swapFee = trade?.swapFee
  const swapFeeAmount =
    swapFee && trade ? fmtAmount(CurrencyAmount.fromRawAmount(trade.outputAmount.currency, swapFee.amount)) : undefined
  const hookFeeLabel = swapFee ? `HookSwap fee · ${swapFee.percent.toFixed(2)}%` : 'HookSwap fee · 0.2%'
  const hookFeeValue = isWrap ? '—' : swapFee ? (swapFeeAmount ? `${swapFeeAmount} ${outSym}` : `${swapFee.percent.toFixed(2)}%`) : '—'

  const networkCostValue = gasFeeFormatted ?? '—'

  return (
    <ReviewCard>
      {/* Shared warning modal — preserves the token/price-impact warning flow. */}
      <SwapReviewWarningModal />

      <ReviewHeader title={t('swap.review.summary')} onClose={onPrev} />

      <div style={{ padding: 18, opacity: hideContent ? 0 : 1, transition: 'opacity 120ms ease' }}>
        {/* Two token rows + ↓ divider */}
        <div
          style={{
            background: terminalColors.panel,
            border: `1px solid ${terminalColors.line2}`,
            borderRadius: 8,
            padding: '14px 16px',
          }}
        >
          <TerminalAmountRow
            currencyInfo={currencyInInfo ?? undefined}
            formattedTokenAmount={formattedIn}
            formattedFiatAmount={fiatIn}
            dim={dimInput}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0' }}>
            <span style={{ flex: 1, height: 1, background: terminalColors.line2 }} />
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={terminalColors.ink3} strokeWidth={2}>
              <path d="M12 5v14M12 19l-5-5M12 19l5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ flex: 1, height: 1, background: terminalColors.line2 }} />
          </div>
          <TerminalAmountRow
            currencyInfo={currencyOutInfo ?? undefined}
            formattedTokenAmount={formattedOut}
            formattedFiatAmount={fiatOut}
            dim={dimOutput}
          />
        </div>

        {/* New-quote acceptance gate — reuses the store's onAcceptTrade handler. */}
        {newTradeRequiresAcceptance && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              marginTop: 12,
              padding: '10px 14px',
              background: terminalColors.warnBg,
              border: `1px solid ${terminalColors.warn}`,
              borderRadius: 8,
            }}
          >
            <span style={{ fontFamily: terminalFonts.sans, fontSize: 12.5, color: terminalColors.ink2 }}>
              {t('swap.details.updatedPrice')}
            </span>
            <button
              type="button"
              onClick={onAcceptTrade}
              style={{
                fontFamily: terminalFonts.sans,
                fontSize: 12.5,
                fontWeight: 600,
                color: terminalColors.btnInk,
                background: terminalColors.warn,
                border: 'none',
                padding: '6px 12px',
                borderRadius: 7,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('common.button.accept')}
            </button>
          </div>
        )}

        {/* Approve/permit multi-step (web) reuses the SHARED ProgressIndicator; else the
            Terminal breakdown rows. */}
        {showInterfaceReviewSteps ? (
          <div style={{ marginTop: 16 }}>
            <ProgressIndicator currentStep={currentStep} steps={steps} isChainedAction={isChainedAction} />
          </div>
        ) : (
          <div
            style={{
              border: `1px dashed ${terminalColors.line}`,
              borderRadius: 8,
              marginTop: 14,
              padding: '4px 14px',
              background: terminalColors.panel,
            }}
          >
            <ReviewRow label="Rate" value={rateValue} />
            <ReviewRow label="Price impact" value={impactValue} valueColor={impactColor} />
            <ReviewRow label="Min received" value={minRecvValue} />
            <ReviewRow label={hookFeeLabel} value={hookFeeValue} />
            <ReviewRow label="Network cost" value={networkCostValue} last />
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <TerminalSubmitButton />
        </div>
      </div>
    </ReviewCard>
  )
}

/** Full-bleed Terminal card that paints the modal surface edge-to-edge. */
function ReviewCard({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        width: '100%',
        background: terminalColors.bg,
        color: terminalColors.ink,
        fontFamily: terminalFonts.sans,
      }}
    >
      {children}
    </div>
  )
}
