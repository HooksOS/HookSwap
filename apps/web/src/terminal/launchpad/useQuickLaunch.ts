/**
 * HookSwap Terminal — Quick Launch hook (RHLaunchpad direct-to-v4), powered by `@hookos/sdk`.
 *
 * Drives `hookos.quickLaunch`: one `launch()` deploys the token, opens its v4 pool (shared
 * LaunchHook), and single-sided-seeds 100% of supply — no bonding curve. Robinhood-only
 * (`available:false` on every other chain → the panel gates honestly). The msg.value covers the
 * live USD-pegged launch fee (read here for display; the SDK sends it internally).
 *
 * DATA POLICY (no mock data):
 *   • Fee — REAL read (quickLaunch.getEffectiveLaunchFee, native wei).
 *   • Result — token + derived opening mcap decoded from the launch tx's TokenCreated event.
 *   • Dev buy — a real quickLaunch.devBuy swap, usable AFTER the pool's 3-minute sniper guard.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { type Address, type Hash } from '~/chains'
import { toMessage, tryEtherNumber, tryTokenCount } from '~/terminal/launchpad/launchShared'
import { useHookOS } from '~/terminal/launchpad/useHookOS'

/** Raw form inputs for a quick launch. */
export interface QuickLaunchInput {
  name: string
  symbol: string
  /** Plain token COUNT (whole tokens, not wei) — the full supply, all single-sided-seeded. */
  supplyTokens: string
  /** Optional target opening market cap in whole USD ('' = SDK default $5,500). */
  targetMcapUsd: string
  /** Optional post-launch dev buy (ether, decimal string). Runs after the 3-min guard. */
  devBuyEth: string
}

export interface UseQuickLaunch {
  ready: boolean
  /** Effective launch fee in native wei (USD-pegged; the SDK sends it as msg.value). */
  feeWei?: bigint

  validationError?: string
  canLaunch: boolean
  launch: () => Promise<void>
  isWritePending: boolean
  isConfirming: boolean
  isDone: boolean
  launchHash?: Hash

  createdToken?: Address
  /** MCap (USD) implied by the tick the pool actually opened at. */
  derivedMcapUsd?: number

  isBuying: boolean
  devBuy: () => Promise<void>
  devBuyHash?: Hash

  error?: string
  reset: () => void
}

export function useQuickLaunch({
  chainId,
  owner,
  input,
}: {
  chainId?: number
  owner?: Address
  input: QuickLaunchInput
}): UseQuickLaunch {
  const hookos = useHookOS(chainId)
  const ready = Boolean(hookos) && Boolean(hookos?.quickLaunch.available)

  const supplyTokens = useMemo(() => tryTokenCount(input.supplyTokens), [input.supplyTokens])
  const targetMcapUsd = useMemo(() => {
    const t = input.targetMcapUsd.trim()
    if (t === '') {
      return undefined
    }
    return /^\d+$/.test(t) ? BigInt(t) : null // null = malformed
  }, [input.targetMcapUsd])

  const validationError = ((): string | undefined => {
    if (input.name.trim() === '') {
      return 'Enter a token name'
    }
    if (input.symbol.trim() === '') {
      return 'Enter a token symbol'
    }
    if (supplyTokens === undefined) {
      return 'Supply must be a positive whole number of tokens'
    }
    if (targetMcapUsd === null) {
      return 'Target market cap must be a whole USD amount'
    }
    return undefined
  })()

  const feeQuery = useQuery({
    queryKey: ['hookos-quick', 'fee', chainId],
    queryFn: () => hookos!.quickLaunch.getEffectiveLaunchFee(),
    enabled: ready,
  })

  type Phase = 'idle' | 'launching' | 'done' | 'error'
  const [phase, setPhase] = useState<Phase>('idle')
  const [launchHash, setLaunchHash] = useState<Hash | undefined>(undefined)
  const [created, setCreated] = useState<{ token: Address; mcap: number } | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [isBuying, setIsBuying] = useState(false)
  const [devBuyHash, setDevBuyHash] = useState<Hash | undefined>(undefined)

  const isConfirming = phase === 'launching'
  const isDone = phase === 'done'
  const canLaunch = ready && Boolean(owner) && validationError === undefined && !isConfirming && !isDone

  const launch = async (): Promise<void> => {
    if (!hookos || !owner || supplyTokens === undefined || isConfirming || isDone) {
      return
    }
    setError(undefined)
    setPhase('launching')
    try {
      const res = await hookos.quickLaunch.launch({
        name: input.name.trim(),
        symbol: input.symbol.trim(),
        supplyTokens,
        ...(targetMcapUsd ? { targetMcapUsd } : {}),
      })
      setLaunchHash(res.txResult.hash as Hash)
      setCreated({ token: res.token as Address, mcap: res.derivedMcapUsd })
      setPhase('done')
    } catch (e) {
      setError(toMessage(e))
      setPhase('error')
    }
  }

  const devBuy = async (): Promise<void> => {
    if (!hookos || !created || isBuying) {
      return
    }
    const amountInEther = tryEtherNumber(input.devBuyEth)
    if (amountInEther === undefined || amountInEther <= 0) {
      return
    }
    setError(undefined)
    setIsBuying(true)
    try {
      const res = await hookos.quickLaunch.devBuy({ token: created.token, amountInEther })
      setDevBuyHash(res.txResult.hash as Hash)
    } catch (e) {
      setError(toMessage(e))
    } finally {
      setIsBuying(false)
    }
  }

  const reset = (): void => {
    setPhase('idle')
    setLaunchHash(undefined)
    setCreated(undefined)
    setError(undefined)
    setDevBuyHash(undefined)
  }

  return useMemo(
    () => ({
      ready,
      feeWei: feeQuery.data,
      validationError,
      canLaunch,
      launch,
      isWritePending: false,
      isConfirming,
      isDone,
      launchHash,
      createdToken: created?.token,
      derivedMcapUsd: created?.mcap,
      isBuying,
      devBuy,
      devBuyHash,
      error,
      reset,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, feeQuery.data, validationError, canLaunch, isConfirming, isDone, launchHash, created, isBuying, devBuyHash, error],
  )
}
