/**
 * HookSwap Terminal — swap chain-selection sync.
 *
 * Keeps the three chain selectors on the swap page in lock-step so they never
 * diverge:
 *   (1) the top-nav ChainSwitcherMenu (TerminalApp.tsx `TerminalChrome`),
 *   (2) the connected wallet's actual chain (`useAccount().chainId` / `useSelectChain`),
 *   (3) the "Select a token" modal's chain dropdown (`SwapTokenSelector` →
 *       `useChainId()` → the swap-form store's `filteredChainIds`).
 *
 * SINGLE SOURCE OF TRUTH = the connected wallet chain (`account.chainId`), with a
 * consistent disconnected fallback (`fallbackChainId` — the swap screen's resolved
 * active chain, the same default the top-nav chip + swap header use). The top-nav
 * chip and the swap form already read the wallet chain; the divergence came from the
 * token selector, whose `filteredChainIds` started unseeded (→ "All Networks" in
 * mainnet mode) and could be moved independently — a cross-chain token pick then
 * updated the swap-form currencies WITHOUT switching the wallet, leaving all three
 * pointing at different chains.
 *
 * This controller closes both directions:
 *   • wallet/top-nav → selector: whenever the active chain changes, seed the swap
 *     form's `filteredChainIds` (both fields) to it, so the token selector's network
 *     filter follows the active chain instead of defaulting to "All Networks".
 *   • selector → wallet/top-nav: if the user picks a token that moves the selector's
 *     chain (both fields agree on one enabled chain other than the wallet chain),
 *     drive `useSelectChain` so the wallet — and therefore the top-nav chip, which
 *     reads `account.chainId` — follow. The swap screen re-keys its provider subtree
 *     on the wallet chain, so the pair re-resolves to a valid pair on the new chain
 *     (no stale token from the old chain is left selected).
 *
 * Renders nothing. Must be mounted inside the swap-form store + multichain providers
 * (see `SwapScreen`). Reuses existing chain state only — `useAccount`,
 * `useSelectChain`, and the swap-form store's `filteredChainIds` — it invents no new
 * chain state.
 */
import { useEffect, useRef } from 'react'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { useSwapFormStore } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { CurrencyField } from 'uniswap/src/types/currency'
import { useAccount } from '~/hooks/useAccount'
import { useSelectChain } from '~/hooks/useSelectChain'

export function SwapChainSync({ fallbackChainId }: { fallbackChainId?: UniverseChainId }): null {
  const account = useAccount()
  const connectedChainId = account.chainId
  // Source of truth: the connected wallet chain, else the swap screen's resolved default.
  const activeChainId = connectedChainId ?? fallbackChainId

  const selectChain = useSelectChain()
  const { chains: enabledChains } = useEnabledChains()

  const { filteredChainIds, updateSwapForm } = useSwapFormStore((s) => ({
    filteredChainIds: s.filteredChainIds,
    updateSwapForm: s.updateSwapForm,
  }))

  // (1) wallet/top-nav → token selector.
  // Seed the selector's chain filter to the active chain. Ref-guarded to fire once per
  // active-chain change so it never fights an in-selector cross-chain pick (which does
  // not change the active chain, and is handled by effect (2) below).
  const lastSeeded = useRef<UniverseChainId | undefined>(undefined)
  useEffect(() => {
    if (activeChainId === undefined) {
      return
    }
    if (lastSeeded.current === activeChainId) {
      return
    }
    lastSeeded.current = activeChainId
    if (
      filteredChainIds?.[CurrencyField.INPUT] !== activeChainId ||
      filteredChainIds?.[CurrencyField.OUTPUT] !== activeChainId
    ) {
      updateSwapForm({
        filteredChainIds: {
          [CurrencyField.INPUT]: activeChainId,
          [CurrencyField.OUTPUT]: activeChainId,
        },
      })
    }
  }, [activeChainId, filteredChainIds, updateSwapForm])

  // (2) token selector → wallet/top-nav.
  // When connected and the selector's chosen chain (both fields agree) is an enabled
  // chain other than the wallet chain, switch the wallet to it so all three converge.
  useEffect(() => {
    if (connectedChainId === undefined) {
      return
    }
    const inputChain = filteredChainIds?.[CurrencyField.INPUT]
    const outputChain = filteredChainIds?.[CurrencyField.OUTPUT]
    const target = inputChain !== undefined && inputChain === outputChain ? inputChain : undefined
    if (target !== undefined && target !== connectedChainId && enabledChains.includes(target)) {
      void selectChain(target)
    }
  }, [filteredChainIds, connectedChainId, enabledChains, selectChain])

  return null
}
