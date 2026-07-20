/**
 * HookSwapPerps — open (resting) orders feed + cancel (engine REST).
 *
 * Open orders are OFF-CHAIN state held by the matching engine (unlike positions, which are
 * on-chain truth). This hook polls `GET /orders?trader=&market=` and exposes a `cancel`
 * mutation over `DELETE /orders/:orderId`. The engine's `/orders` REQUIRES a `market`
 * (server.ts reqMarket), so the feed is only enabled when a market is selected AND the wallet
 * is connected AND on Sepolia — otherwise it reports an honest `disabledReason` and fetches
 * nothing. Nothing here is fabricated: no wallet / wrong chain / no market → empty + reason;
 * engine down → `error` true and the panel renders an honest offline state.
 *
 * Mirrors the poll/abort shape of `useTrades` (react-query, engine feed) and the per-row
 * pending-mutation state machine of `useClosePosition` (pendingId + status + error + reset).
 */
import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Address } from '~/chains'
import { EngineError, perpsEngine, type EngineOpenOrder } from '~/terminal/perps/engine/client'

/** Sepolia — the only chain HookSwapPerps is deployed + validated on. */
const PERPS_CHAIN_ID = 11155111

/** Poll cadence — mirrors the engine feed cadence used by useTrades (5s). */
const POLL_MS = 5_000

/** Cancel lifecycle for a single order row. */
export type CancelStatus = 'idle' | 'canceling' | 'done' | 'error'

export interface UseOpenOrders {
  /** Resting orders for the wallet on this market, or undefined until first load. */
  orders?: EngineOpenOrder[]
  isLoading: boolean
  /** True when the poll failed (engine unreachable / error) — render an honest offline state. */
  error: boolean
  /** Force a re-poll (also fired automatically after a successful cancel). */
  refetch: () => void
  /** True when the feed + cancel can run (wallet + market + right chain). */
  ready: boolean
  /** Human reason the feed is disabled, or undefined when `ready`. */
  disabledReason?: string
  /** Submit `DELETE /orders/:orderId`; refetches the feed on success. */
  cancel: (orderId: string) => Promise<void>
  /** The orderId whose cancel is in flight — drives the row spinner. */
  pendingOrderId?: string
  cancelStatus: CancelStatus
  cancelError?: string
  /** Clear the last cancel result/error. */
  cancelReset: () => void
}

function toMessage(e: unknown): string {
  if (e instanceof EngineError) {
    return e.unreachable ? 'Engine unreachable' : e.message.split('\n')[0] || 'Cancel failed'
  }
  if (e instanceof Error) {
    return e.message.split('\n')[0]
  }
  return 'Cancel failed'
}

export function useOpenOrders({
  market,
  trader,
  chainId,
}: {
  market?: Address | string
  trader?: Address
  chainId?: number
}): UseOpenOrders {
  const connected = Boolean(trader)
  const wrongChain = chainId !== undefined && chainId !== PERPS_CHAIN_ID
  const disabledReason = !connected
    ? 'Connect wallet'
    : wrongChain
      ? 'Switch to Sepolia'
      : !market
        ? 'No market selected'
        : undefined
  const ready = disabledReason === undefined

  const query = useQuery({
    queryKey: ['perps-open-orders', market, trader],
    // ready implies market + trader are defined.
    queryFn: ({ signal }) =>
      perpsEngine.getOpenOrders({ trader: trader as string, market: market as string }, signal),
    enabled: ready,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 2_000,
  })

  const [pendingOrderId, setPendingOrderId] = useState<string | undefined>(undefined)
  const [cancelStatus, setCancelStatus] = useState<CancelStatus>('idle')
  const [cancelError, setCancelError] = useState<string | undefined>(undefined)

  const cancelReset = useCallback(() => {
    setPendingOrderId(undefined)
    setCancelStatus('idle')
    setCancelError(undefined)
  }, [])

  const cancel = useCallback(
    async (orderId: string): Promise<void> => {
      if (!ready) {
        setCancelError(disabledReason ?? 'Cannot cancel')
        setCancelStatus('error')
        return
      }
      setCancelError(undefined)
      setPendingOrderId(orderId)
      setCancelStatus('canceling')
      try {
        await perpsEngine.cancelOrder(orderId)
        setCancelStatus('done')
        // Re-poll so the cancelled order drops out of the list (never assume it's gone).
        await query.refetch()
      } catch (e) {
        setCancelError(toMessage(e))
        setCancelStatus('error')
      } finally {
        setPendingOrderId(undefined)
      }
    },
    [ready, disabledReason, query],
  )

  return {
    orders: ready ? query.data : undefined,
    isLoading: ready && query.isLoading,
    error: ready && query.isError,
    refetch: () => void query.refetch(),
    ready,
    disabledReason,
    cancel,
    pendingOrderId,
    cancelStatus,
    cancelError,
    cancelReset,
  }
}
