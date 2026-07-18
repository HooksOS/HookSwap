/**
 * HookSwap Terminal — Limit (route kept only for deep-link back-compat).
 *
 * Limit orders are NOT offered by HookSwap: the legacy Uniswap limit flow is
 * UniswapX-only (a hosted off-chain orderbook that HookSwap does NOT run), and
 * the feature is gated to `LIMIT_SUPPORTED_CHAINS` — which is Mainnet-only.
 * Robinhood (the launch chain) and the other HookSwap chains are not in that set,
 * so the legacy `LimitFormWrapper` would coerce every currency back to Mainnet and
 * present a non-functional form. That would be misleading UI.
 *
 * The Terminal therefore exposes NO Limit entry point (removed from the swap
 * ticket tabs, the top nav, and the landing nav). This route survives only so old
 * `/terminal/limit` deep links don't 404: when the active chain isn't limit-
 * supported it renders an honest empty state pointing users back to Market swap.
 * If a limit-supported chain ever becomes enabled, the real form is rendered.
 *
 * HookSwap ships v2 + v3 only (no Uniswap v4 / hooks — LOCKED decision).
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { USDC, nativeOnChain } from 'uniswap/src/constants/tokens'
import { LIMIT_SUPPORTED_CHAINS } from 'uniswap/src/features/chains/chainInfo'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { SwapTransactionSettingsStoreContextProvider } from 'uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/SwapTransactionSettingsStoreContextProvider'
import { useSwapPrefilledState } from 'uniswap/src/features/transactions/swap/form/hooks/useSwapPrefilledState'
import { SwapFormStoreContextProvider } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/SwapFormStoreContextProvider'
import { currencyToAsset } from 'uniswap/src/features/transactions/swap/utils/asset'
import { CurrencyField } from 'uniswap/src/types/currency'
import { SwapAndLimitContextProvider } from '~/features/Swap/state/SwapContext'
import { useAccount } from '~/hooks/useAccount'
import { LimitFormWrapper } from '~/pages/Swap/Limit/LimitForm'
import { MultichainContextProvider } from '~/state/multichain/MultichainContext'
import { ComingSoon } from '~/terminal/components/ComingSoon'
import { Eyebrow, InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const DISPLAY = terminalFonts.display
const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

/** Fixed width of the framed order module — matches the legacy swap module (480px). */
const MODULE_WIDTH = 480

/** Desk page header — Eyebrow kicker + Space Grotesk h1 + subtitle, matching the Terminal screens. */
function LimitHeader({ subtitle }: { subtitle: string }): JSX.Element {
  return (
    <>
      <Eyebrow>Trade · Limit orders</Eyebrow>
      <h1
        style={{
          fontFamily: DISPLAY,
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: terminalColors.ink,
          margin: '8px 0 6px',
        }}
      >
        Limit
      </h1>
      <div style={{ fontFamily: SANS, fontSize: 13, color: terminalColors.ink2, marginBottom: 20, maxWidth: 560, lineHeight: 1.5 }}>
        {subtitle}
      </div>
    </>
  )
}

/**
 * Honest empty state for chains where limit orders aren't available (all HookSwap
 * chains today). No fake/broken form — just the reason + a route back to Market swap.
 */
function LimitUnavailable(): JSX.Element {
  const navigate = useNavigate()
  return (
    <div style={{ padding: '20px var(--tm-gutter) 40px' }}>
      <LimitHeader subtitle="Limit orders aren't available on HookSwap's networks — HookSwap ships v2 + v3 only. Use Market swap instead." />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: MODULE_WIDTH }}>
          <InstrumentPanel title="Not available" meta={['v2 · v3 only']} corners>
            <ComingSoon
              label="NOT AVAILABLE"
              subtext="Limit orders aren't available on Robinhood — use Market swap instead."
            />
            <button
              type="button"
              onClick={() => navigate('/swap')}
              style={{
                width: '100%',
                marginTop: 4,
                background: terminalColors.brandGreen,
                color: terminalColors.btnInk,
                fontFamily: MONO,
                fontWeight: 600,
                fontSize: 13,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                padding: '13px 0',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Go to Market swap
            </button>
          </InstrumentPanel>
        </div>
      </div>
    </div>
  )
}

/**
 * The real limit-order form (legacy `LimitFormWrapper`) framed in Terminal chrome.
 * Only reached when a limit-supported chain is actually enabled — otherwise the
 * caller renders {@link LimitUnavailable}. Kept intact so the feature lights up
 * automatically if a limit-supported chain is ever added to HookSwap.
 */
function LimitFormFrame(): JSX.Element {
  const initialInputCurrency = useMemo(() => nativeOnChain(UniverseChainId.Mainnet), [])
  const initialOutputCurrency = USDC

  const prefilledState = useSwapPrefilledState({
    input: currencyToAsset(initialInputCurrency),
    output: currencyToAsset(initialOutputCurrency),
    exactAmountToken: '',
    exactCurrencyField: CurrencyField.INPUT,
  })

  return (
    <div style={{ padding: '20px var(--tm-gutter) 40px' }}>
      <LimitHeader subtitle="Set a price · order fills when the market reaches it." />
      {/* Centered framed form inside a Desk instrument panel. */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: MODULE_WIDTH }}>
          <InstrumentPanel title="Limit order" corners bodyStyle={{ padding: 12 }}>
            <MultichainContextProvider initialChainId={UniverseChainId.Mainnet}>
              <SwapTransactionSettingsStoreContextProvider>
                <SwapAndLimitContextProvider
                  initialInputCurrency={initialInputCurrency}
                  initialOutputCurrency={initialOutputCurrency}
                >
                  <SwapFormStoreContextProvider prefilledState={prefilledState}>
                    <LimitFormWrapper />
                  </SwapFormStoreContextProvider>
                </SwapAndLimitContextProvider>
              </SwapTransactionSettingsStoreContextProvider>
            </MultichainContextProvider>
          </InstrumentPanel>
        </div>
      </div>
    </div>
  )
}

/**
 * Limit route. Gated on limit support: renders the honest {@link LimitUnavailable}
 * empty state unless the connected wallet's chain (or, when disconnected, the
 * default enabled chain) is in `LIMIT_SUPPORTED_CHAINS`. On HookSwap today no
 * enabled chain is limit-supported, so this always shows the empty state — the
 * real form path stays wired for when/if a supported chain is added.
 */
export function LimitScreen(): JSX.Element {
  const account = useAccount()
  const { defaultChainId } = useEnabledChains()
  const activeChainId = account.chainId ?? defaultChainId
  const isLimitSupported = LIMIT_SUPPORTED_CHAINS.includes(activeChainId)

  return isLimitSupported ? <LimitFormFrame /> : <LimitUnavailable />
}
