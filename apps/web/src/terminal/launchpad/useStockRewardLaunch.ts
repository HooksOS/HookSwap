/**
 * HookSwap Terminal — Stock-Reward launch hook (StockRewardLauncherV4), powered by `@hookos/sdk`.
 *
 * Drives `hookos.stock`: a fair, direct-to-v4 launch with a 2–5% buy/sell tax charged in WETH by
 * the StockTaxHook; the proceeds buy REAL tokenized stocks (NVDA / AAPL / a basket) and drip them
 * to holders each epoch. Robinhood-only (`available:false` elsewhere → the panel gates honestly).
 *
 * DATA POLICY (no mock data):
 *   • Reward universe — REAL StockRef[] from the SDK (tokenized-stock address + Chainlink feed +
 *     live-liquidity flag); nothing invented.
 *   • Fee split — REAL previewFeeSplit(taxBps) (the on-chain fixed cuts + holder remainder).
 *   • Result — token + poolId decoded from the launch tx's Launched event.
 *
 * NOTE: the reward-basket ALLOCATION is configured on the StockRewardVault by the creator after
 * launch (the launch tx itself sets the buy/sell tax + seeds the pool). The picker validates + emits
 * the on-chain basket entries; it does not silently pretend the launch submits them.
 */
import { useMemo, useState } from 'react'
import { type FeeSplitPreview, type StockRef } from '@hookos/sdk'
import { type Address, type Hash } from '~/chains'
import { toMessage, tryEtherNumber, tryTokenCount } from '~/terminal/launchpad/launchShared'
import { useHookOS } from '~/terminal/launchpad/useHookOS'

/** Raw form inputs for a stock-reward launch. */
export interface StockRewardInput {
  name: string
  symbol: string
  /** Plain token COUNT (whole tokens, not wei) — the full supply, all single-sided-seeded. */
  supplyTokens: string
  /** Buy tax in bps (200–500). */
  buyBps: number
  /** Sell tax in bps (200–500). */
  sellBps: number
  /** Optional target opening market cap in whole USD ('' = SDK default). */
  targetMcapUsd: string
  /** Optional atomic dev buy (ether, decimal string). */
  devBuyEth: string
}

export interface UseStockRewardLaunch {
  ready: boolean
  /** The selectable reward universe (tokenized stocks + feeds + live-liquidity flags). */
  rewardUniverse: StockRef[]
  /** Fee-split preview for the buy-side tax. */
  buyFeeSplit?: FeeSplitPreview
  /** Fee-split preview for the sell-side tax. */
  sellFeeSplit?: FeeSplitPreview

  validationError?: string
  canLaunch: boolean
  launch: () => Promise<void>
  isWritePending: boolean
  isConfirming: boolean
  isDone: boolean
  launchHash?: Hash

  createdToken?: Address
  /** v4 poolId (bytes32) — or the v3 pool address on the legacy path. */
  createdPool?: Hash | Address
  seededToPool?: bigint

  error?: string
  reset: () => void
}

const MIN_TAX = 200
const MAX_TAX = 500

export function useStockRewardLaunch({
  chainId,
  owner,
  input,
}: {
  chainId?: number
  owner?: Address
  input: StockRewardInput
}): UseStockRewardLaunch {
  const hookos = useHookOS(chainId)
  const stockAvailable = Boolean(hookos?.stock.available)
  const ready = Boolean(hookos) && stockAvailable

  // Reward universe + fee-split previews are pure (no RPC) but throw off-Robinhood — guard on avail.
  const rewardUniverse = useMemo<StockRef[]>(
    () => (ready ? hookos!.stock.getRewardUniverse() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, chainId],
  )
  const buyFeeSplit = useMemo<FeeSplitPreview | undefined>(
    () => (ready ? hookos!.stock.previewFeeSplit(input.buyBps) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, chainId, input.buyBps],
  )
  const sellFeeSplit = useMemo<FeeSplitPreview | undefined>(
    () => (ready ? hookos!.stock.previewFeeSplit(input.sellBps) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, chainId, input.sellBps],
  )

  const supplyTokens = useMemo(() => tryTokenCount(input.supplyTokens), [input.supplyTokens])
  const targetMcapUsd = useMemo(() => {
    const t = input.targetMcapUsd.trim()
    if (t === '') {
      return undefined
    }
    return /^\d+$/.test(t) ? BigInt(t) : null
  }, [input.targetMcapUsd])
  const devBuyEth = useMemo(() => tryEtherNumber(input.devBuyEth), [input.devBuyEth])

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
    if (input.buyBps < MIN_TAX || input.buyBps > MAX_TAX) {
      return 'Buy tax must be between 2% and 5%'
    }
    if (input.sellBps < MIN_TAX || input.sellBps > MAX_TAX) {
      return 'Sell tax must be between 2% and 5%'
    }
    if (targetMcapUsd === null) {
      return 'Target market cap must be a whole USD amount'
    }
    if (devBuyEth === undefined) {
      return 'Dev-buy amount must be a valid ether value'
    }
    return undefined
  })()

  type Phase = 'idle' | 'launching' | 'done' | 'error'
  const [phase, setPhase] = useState<Phase>('idle')
  const [launchHash, setLaunchHash] = useState<Hash | undefined>(undefined)
  const [created, setCreated] = useState<{ token: Address; pool: Hash | Address; seededToPool: bigint } | undefined>(
    undefined,
  )
  const [error, setError] = useState<string | undefined>(undefined)

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
      const res = await hookos.stock.launch({
        name: input.name.trim(),
        symbol: input.symbol.trim(),
        supplyTokens,
        buyBps: input.buyBps,
        sellBps: input.sellBps,
        creator: owner,
        ...(targetMcapUsd ? { targetMcapUsd } : {}),
        ...(devBuyEth && devBuyEth > 0 ? { devBuyEth } : {}),
      })
      setLaunchHash(res.txResult.hash as Hash)
      setCreated({ token: res.token as Address, pool: res.pool, seededToPool: res.seededToPool })
      setPhase('done')
    } catch (e) {
      setError(toMessage(e))
      setPhase('error')
    }
  }

  const reset = (): void => {
    setPhase('idle')
    setLaunchHash(undefined)
    setCreated(undefined)
    setError(undefined)
  }

  return useMemo(
    () => ({
      ready,
      rewardUniverse,
      buyFeeSplit,
      sellFeeSplit,
      validationError,
      canLaunch,
      launch,
      isWritePending: false,
      isConfirming,
      isDone,
      launchHash,
      createdToken: created?.token,
      createdPool: created?.pool,
      seededToPool: created?.seededToPool,
      error,
      reset,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, rewardUniverse, buyFeeSplit, sellFeeSplit, validationError, canLaunch, isConfirming, isDone, launchHash, created, error],
  )
}
