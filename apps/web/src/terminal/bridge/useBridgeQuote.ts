/**
 * HookSwap Terminal — live bridge quote hook.
 *
 * Debounced POST /quote against Relay for the current from/to pair + amount, with
 * the HookSwap app fee attached (see relayClient). Fully live — no mock quotes.
 * Honest states: idle (no amount), loading, noRoute (unsupported pair / dust),
 * and error (service failure).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseUnits } from 'viem'
import {
  fetchRelayQuote,
  RelayNoRouteError,
  type RelayQuoteResponse,
} from '~/terminal/bridge/relayClient'

export interface UseBridgeQuoteParams {
  /** Connected wallet (payer + default recipient). Undefined = disconnected. */
  user?: string
  /** Destination recipient (defaults to `user`). */
  recipient?: string
  originChainId?: number
  destinationChainId?: number
  originCurrency?: string
  destinationCurrency?: string
  /** Decimals of the origin currency (to parse the human amount to base units). */
  originDecimals?: number
  /** Human-entered amount (e.g. "0.01"). */
  amount?: string
}

export interface UseBridgeQuote {
  quote?: RelayQuoteResponse
  loading: boolean
  /** Relay has no executable route for this pair/amount. */
  noRoute: boolean
  error?: string
  /** True when the inputs are complete enough to request a quote. */
  hasInputs: boolean
}

const DEBOUNCE_MS = 450

/** Parse a human amount to base units; returns undefined when invalid/zero. */
function toBaseUnits(amount?: string, decimals?: number): string | undefined {
  if (!amount || decimals === undefined) {
    return undefined
  }
  const trimmed = amount.trim()
  if (!trimmed || Number(trimmed) <= 0) {
    return undefined
  }
  try {
    const raw = parseUnits(trimmed as `${number}`, decimals)
    return raw > 0n ? raw.toString() : undefined
  } catch {
    return undefined
  }
}

export function useBridgeQuote(params: UseBridgeQuoteParams): UseBridgeQuote {
  const {
    user,
    recipient,
    originChainId,
    destinationChainId,
    originCurrency,
    destinationCurrency,
    originDecimals,
    amount,
  } = params

  const [quote, setQuote] = useState<RelayQuoteResponse | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [noRoute, setNoRoute] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const amountRaw = useMemo(() => toBaseUnits(amount, originDecimals), [amount, originDecimals])

  // A quote needs a payer (Relay requires `user`), a full pair, and a positive amount.
  const hasInputs = Boolean(
    user &&
      originChainId !== undefined &&
      destinationChainId !== undefined &&
      originCurrency &&
      destinationCurrency &&
      amountRaw &&
      // Same-chain same-token is not a bridge.
      !(originChainId === destinationChainId && originCurrency === destinationCurrency),
  )

  const abortRef = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    // Reset transient state whenever the request identity changes.
    if (!hasInputs || !amountRaw || !user) {
      abortRef.current?.abort()
      setQuote(undefined)
      setLoading(false)
      setNoRoute(false)
      setError(undefined)
      return
    }

    setLoading(true)
    setError(undefined)
    setNoRoute(false)

    const handle = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      fetchRelayQuote(
        {
          user,
          recipient: recipient || user,
          originChainId: originChainId as number,
          destinationChainId: destinationChainId as number,
          originCurrency: originCurrency as string,
          destinationCurrency: destinationCurrency as string,
          amount: amountRaw,
          tradeType: 'EXACT_INPUT',
        },
        controller.signal,
      )
        .then((q) => {
          if (controller.signal.aborted) {
            return
          }
          setQuote(q)
          setNoRoute(false)
          setError(undefined)
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
            return
          }
          setQuote(undefined)
          if (e instanceof RelayNoRouteError) {
            setNoRoute(true)
            setError(undefined)
          } else {
            setNoRoute(false)
            setError(e instanceof Error ? e.message : 'Quote unavailable')
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false)
          }
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(handle)
    }
  }, [
    hasInputs,
    user,
    recipient,
    originChainId,
    destinationChainId,
    originCurrency,
    destinationCurrency,
    amountRaw,
  ])

  return useMemo(
    () => ({ quote, loading, noRoute, error, hasInputs }),
    [quote, loading, noRoute, error, hasInputs],
  )
}
