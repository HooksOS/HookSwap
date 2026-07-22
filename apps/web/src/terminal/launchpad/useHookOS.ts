/**
 * HookSwap Terminal — the vendored `@hookos/sdk` client, wired to the connected wallet.
 *
 * This is HookSwap dogfooding its own launch SDK: `useHookOS(chainId)` builds a viem-backed
 * {@link HookOS} client from wagmi's active WalletClient and memoizes it per (chainId, wallet).
 * The SDK resolves launcher / fee-vault addresses per chain internally, so callers get a
 * multi-chain client for free (Base 8453 · Robinhood 4663 · MegaETH 4326 · HyperEVM 999 ·
 * BNB 56 · Ethereum 1).
 *
 * Returns `undefined` when the chain is not supported by the SDK — the constructor throws
 * `ChainError` for unknown chains, which we catch so callers can gate honestly ("not available
 * on this network") instead of pointing at a dead address.
 */
import { useMemo } from 'react'
import { useWalletClient } from 'wagmi'
import { HookOS, type ChainId } from '@hookos/sdk'

/**
 * Build a memoized {@link HookOS} client for `chainId`, bound to the connected wallet.
 * Returns `undefined` for unsupported chains (or when `chainId` is undefined).
 */
export function useHookOS(chainId?: number): HookOS | undefined {
  // The WalletClient for the target chain — undefined until a wallet is connected.
  const { data: walletClient } = useWalletClient({ chainId })

  return useMemo(() => {
    if (chainId === undefined) {
      return undefined
    }
    try {
      // `chainId` is a plain number here; the SDK validates it at runtime and throws
      // `ChainError` for chains it doesn't serve (caught below → undefined).
      return new HookOS({ chainId: chainId as ChainId, walletClient: walletClient ?? undefined })
    } catch {
      return undefined
    }
  }, [chainId, walletClient])
}
