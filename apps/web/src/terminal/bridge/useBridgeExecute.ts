/**
 * HookSwap Terminal — bridge execution + status polling.
 *
 * Executes a Relay quote end to end with the connected wallet:
 *   1. Switch the wallet to the origin chain (if needed).
 *   2. Submit every step item's transaction in order (an ERC-20 `approve` step,
 *      when present, then the `deposit`), awaiting each receipt.
 *   3. Extract the intent `requestId` from the deposit item's `check` endpoint and
 *      poll GET /intents/status until the relayer fills on the destination chain.
 *
 * All on-chain actions are REAL (wagmi core). No fabricated hashes/status. Honest
 * terminal states: success, failure/refund, or "submitted, tracking unavailable"
 * when Relay returns no requestId.
 */
import { sendTransaction, switchChain, waitForTransactionReceipt } from '@wagmi/core'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useConfig } from 'wagmi'
import {
  extractRequestId,
  fetchRelayStatus,
  type RelayQuoteResponse,
} from '~/terminal/bridge/relayClient'

export type BridgePhase =
  | 'idle'
  | 'switching' // switching the wallet to the origin chain
  | 'signing' // waiting for a wallet signature/confirmation
  | 'confirming' // an origin tx is mining
  | 'filling' // deposit mined; polling Relay for the destination fill
  | 'success' // relayer filled on the destination chain
  | 'submitted' // deposit mined but Relay returned no requestId to track
  | 'failed'

export interface BridgeExecuteState {
  phase: BridgePhase
  /** 1-based index of the step currently executing (0 when idle). */
  stepIndex: number
  /** Total step-transactions in the active run. */
  stepCount: number
  /** Hashes of submitted origin transactions, in order. */
  txHashes: string[]
  /** The Relay intent id being tracked (once the deposit is sent). */
  requestId?: string
  /** Destination fill tx hash(es), once known. */
  fillTxHashes?: string[]
  error?: string
  isRunning: boolean
}

const POLL_INTERVAL_MS = 4000
const POLL_TIMEOUT_MS = 8 * 60 * 1000 // 8 minutes

function toMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'shortMessage' in e && typeof (e as { shortMessage: unknown }).shortMessage === 'string') {
    return (e as { shortMessage: string }).shortMessage
  }
  if (e instanceof Error) {
    return e.message.split('\n')[0]
  }
  return 'Bridge transaction failed'
}

const INITIAL: BridgeExecuteState = {
  phase: 'idle',
  stepIndex: 0,
  stepCount: 0,
  txHashes: [],
  isRunning: false,
}

export interface UseBridgeExecute extends BridgeExecuteState {
  /** Execute the given quote from the origin chain. */
  execute: (quote: RelayQuoteResponse, originChainId: number) => Promise<void>
  reset: () => void
}

export function useBridgeExecute(): UseBridgeExecute {
  const config = useConfig()
  const [state, setState] = useState<BridgeExecuteState>(INITIAL)
  const cancelledRef = useRef(false)

  const patch = useCallback((p: Partial<BridgeExecuteState>): void => {
    setState((prev) => ({ ...prev, ...p }))
  }, [])

  const reset = useCallback((): void => {
    cancelledRef.current = true
    setState(INITIAL)
  }, [])

  const execute = useCallback(
    async (quote: RelayQuoteResponse, originChainId: number): Promise<void> => {
      cancelledRef.current = false

      // Flatten every step item that carries a transaction to submit, in order.
      const txItems = (quote.steps ?? [])
        .flatMap((step) => step.items ?? [])
        .filter((item) => item.data?.to && item.data?.data !== undefined)

      if (txItems.length === 0) {
        setState({ ...INITIAL, phase: 'failed', error: 'Quote has no executable transaction' })
        return
      }

      const requestId = extractRequestId(quote)
      const hashes: string[] = []

      setState({
        ...INITIAL,
        phase: 'switching',
        stepCount: txItems.length,
        requestId,
        isRunning: true,
      })

      // 1. Ensure the wallet is on the origin chain.
      try {
        await switchChain(config, { chainId: originChainId })
      } catch (e) {
        setState({
          ...INITIAL,
          phase: 'failed',
          error: `Switch your wallet to the origin chain to continue (${toMessage(e)})`,
        })
        return
      }

      // 2. Submit each transaction in order, awaiting its receipt.
      for (let i = 0; i < txItems.length; i++) {
        if (cancelledRef.current) {
          return
        }
        const data = txItems[i].data
        if (!data?.to) {
          continue
        }
        patch({ phase: 'signing', stepIndex: i + 1 })
        try {
          const hash = await sendTransaction(config, {
            chainId: (data.chainId as number | undefined) ?? originChainId,
            to: data.to as `0x${string}`,
            data: (data.data ?? '0x') as `0x${string}`,
            value: data.value ? BigInt(data.value) : 0n,
            ...(data.gas ? { gas: BigInt(data.gas) } : {}),
          })
          hashes.push(hash)
          patch({ phase: 'confirming', txHashes: [...hashes] })

          const receipt = await waitForTransactionReceipt(config, {
            hash,
            chainId: (data.chainId as number | undefined) ?? originChainId,
          })
          if (receipt.status === 'reverted') {
            patch({ phase: 'failed', error: `Origin transaction ${i + 1} reverted`, isRunning: false })
            return
          }
        } catch (e) {
          patch({ phase: 'failed', error: toMessage(e), isRunning: false })
          return
        }
      }

      if (cancelledRef.current) {
        return
      }

      // 3. Poll Relay for the destination fill.
      if (!requestId) {
        // Deposit is on-chain but Relay gave us no intent id to track — honest state.
        patch({ phase: 'submitted', isRunning: false })
        return
      }

      patch({ phase: 'filling' })
      const start = Date.now()
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelledRef.current) {
          return
        }
        if (Date.now() - start > POLL_TIMEOUT_MS) {
          // Still pending after the timeout — the intent is valid, just slow. Honest.
          patch({ phase: 'submitted', error: undefined, isRunning: false })
          return
        }
        try {
          const status = await fetchRelayStatus(requestId)
          if (status.status === 'success') {
            patch({ phase: 'success', fillTxHashes: status.txHashes, isRunning: false })
            return
          }
          if (status.status === 'failure') {
            patch({ phase: 'failed', error: status.details || 'Relay reported a failed fill', isRunning: false })
            return
          }
          if (status.status === 'refund' || status.status === 'fallback') {
            patch({
              phase: 'failed',
              error: status.details || 'Bridge refunded on the origin chain',
              isRunning: false,
            })
            return
          }
          // pending / received / unknown → keep polling.
        } catch {
          // Transient status error — keep polling until the timeout.
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
    },
    [config, patch],
  )

  return useMemo(() => ({ ...state, execute, reset }), [state, execute, reset])
}
