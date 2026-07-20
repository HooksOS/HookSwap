/**
 * HookSwapPerps — close an open position (DIRECT on-chain write, no engine).
 *
 * Closing is on-chain truth: the trader calls `PerpMarket.closePair(pairId)` and the contract
 * settles PnL at the stored on-chain mark. This hook is the write side of the Positions panel —
 * a sibling of `useCollateral` (same wagmi write/receipt state machine + chain guard).
 *
 * CONTRACT FACTS (verified against contracts/perps/src/factory/PerpMarket.sol:763):
 *   • `closePair(uint256 pairId)` — `nonReentrant whenNotPaused`. The caller (`msg.sender`)
 *     MUST be the pair's `longTrader` or `shortTrader`; the pair must be `PositionStatus.ACTIVE`;
 *     the market must not be paused. There is NO price argument — the exit price is the market's
 *     stored on-chain mark `tokenPrices[pos.token]` (OracleGuard-guarded). Emits
 *     `PairClosed(pairId, exitPrice, longPnL, shortPnL)`.
 *
 * DATA POLICY: `txHash` is a real broadcast result — never fabricated. On a mined receipt the
 * hook fires the caller's `refetch` so the closed pair drops out of the on-chain positions read.
 * Honest disabled reasons for no-wallet / wrong-chain / no-market / market-paused.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import type { Address, Hash } from '~/chains'
import type { PerpMarketView } from '~/terminal/perps/engine/marketView'
import { perpMarketWriteAbi } from '~/terminal/perps/engine/perpMarketAbi'

/** Sepolia — the only chain HookSwapPerps is deployed + validated on. */
const PERPS_CHAIN_ID = 11155111

/** Tx lifecycle for a close. */
export type CloseStatus = 'idle' | 'closing' | 'confirming' | 'done' | 'error'

export interface UseClosePosition {
  /** True when a close can be attempted (wallet + market + right chain + not paused). */
  ready: boolean
  /** Human reason a close is unavailable, or undefined when `ready`. */
  disabledReason?: string
  /** Submit `closePair(pairId)` and wait for the receipt; refetch fires on success. */
  close: (pairId: bigint) => Promise<void>
  /** The pairId whose tx is in flight (or confirming) — drives the row spinner. */
  pendingPairId?: bigint
  status: CloseStatus
  /** The in-flight/last close's real tx hash — never fabricated. */
  txHash?: Hash
  error?: string
  reset: () => void
}

function toMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'shortMessage' in e && typeof (e as { shortMessage: unknown }).shortMessage === 'string') {
    return (e as { shortMessage: string }).shortMessage
  }
  if (e instanceof Error) {
    return e.message.split('\n')[0]
  }
  return 'Close failed'
}

export function useClosePosition({
  market,
  trader,
  chainId,
  refetch,
}: {
  market?: PerpMarketView
  trader?: Address
  chainId?: number
  /** Re-read on-chain positions after a mined close (the panel's usePositions.refetch). */
  refetch?: () => void
}): UseClosePosition {
  const marketAddress = market?.address
  const connected = Boolean(trader)
  const wrongChain = chainId !== undefined && chainId !== PERPS_CHAIN_ID
  // PerpMarketView.status: 0 = active, 1 = paused, 2 = delisted (marketView.ts:37).
  const paused = market?.status === 1

  const disabledReason = !connected
    ? 'Connect wallet to close'
    : wrongChain
      ? 'Switch to Sepolia'
      : !marketAddress
        ? 'No market selected'
        : paused
          ? 'Market paused'
          : undefined
  const ready = disabledReason === undefined

  const { writeContractAsync } = useWriteContract()
  const [txHash, setTxHash] = useState<Hash | undefined>(undefined)
  const [pendingPairId, setPendingPairId] = useState<bigint | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const receipt = useWaitForTransactionReceipt({ hash: txHash, chainId })

  // On a mined receipt: refresh positions and clear the in-flight pairId so the row's spinner
  // stops (the closed pair also drops out of the on-chain read).
  useEffect(() => {
    if (!receipt.isSuccess) {
      return
    }
    refetch?.()
    setPendingPairId(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess])

  const reset = useCallback(() => {
    setTxHash(undefined)
    setPendingPairId(undefined)
    setPending(false)
    setError(undefined)
  }, [])

  const close = useCallback(
    async (pairId: bigint): Promise<void> => {
      if (!marketAddress || !ready) {
        setError(disabledReason ?? 'Cannot close')
        return
      }
      setError(undefined)
      setTxHash(undefined)
      setPendingPairId(pairId)
      setPending(true)
      try {
        const hash = await writeContractAsync({
          address: marketAddress,
          chainId,
          abi: perpMarketWriteAbi,
          functionName: 'closePair',
          args: [pairId],
        })
        setTxHash(hash)
      } catch (e) {
        setError(toMessage(e))
        setPendingPairId(undefined)
      } finally {
        setPending(false)
      }
    },
    [marketAddress, ready, disabledReason, chainId, writeContractAsync],
  )

  const status: CloseStatus = useMemo(() => {
    if (error) {
      return 'error'
    }
    if (pending) {
      return 'closing'
    }
    if (txHash) {
      return receipt.isSuccess ? 'done' : 'confirming'
    }
    return 'idle'
  }, [error, pending, txHash, receipt.isSuccess])

  return {
    ready,
    disabledReason,
    close,
    pendingPairId,
    status,
    txHash,
    error,
    reset,
  }
}
