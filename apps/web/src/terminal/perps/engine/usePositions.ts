/**
 * HookSwapPerps — open positions (DIRECT on-chain read).
 *
 * Positions are on-chain truth (`PairedPosition`), so this reads them straight from the
 * PerpMarket contract rather than trusting the engine — the desk shows real positions even
 * if the matching engine is offline:
 *   getUserPairIds(trader) → getPairedPosition(pairId)[] (+ getUnrealizedPnL, tokenPrices,
 *   getTokenDecimals) via wagmi multicall. Only ACTIVE pairs where the connected wallet is
 *   the long or short trader are shown, decoded into display rows. Liq. price is '—'
 *   (no plain getter exposes it — never fabricated). No wallet / no market → honest empty.
 */
import { useMemo } from 'react'
import { formatUnits } from 'viem'
import { useReadContract, useReadContracts } from 'wagmi'
import type { Address } from '~/chains'
import {
  perpMarketReadAbi,
  PositionStatus,
  PRICE_PRECISION,
  SIZE_PRECISION,
  type RawPairedPosition,
} from '~/terminal/perps/engine/perpMarketAbi'
import type { PerpPosition } from '~/terminal/screens/perps/PositionsTable'

function fmt(value: bigint, decimals: number, maxFrac: number): string {
  const n = Number(formatUnits(value, decimals))
  if (!Number.isFinite(n)) {
    return '—'
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: maxFrac })
}

function fmtSigned(value: bigint, decimals: number, maxFrac: number): string {
  const n = Number(formatUnits(value, decimals))
  if (!Number.isFinite(n)) {
    return '—'
  }
  const s = n.toLocaleString('en-US', { maximumFractionDigits: maxFrac })
  return n > 0 ? `+${s}` : s
}

export interface UsePositions {
  positions?: PerpPosition[]
  isLoading: boolean
  error: boolean
  refetch: () => void
}

export function usePositions({
  market,
  collateral,
  trader,
  chainId,
}: {
  market?: Address
  collateral?: Address
  trader?: Address
  chainId?: number
}): UsePositions {
  const enabled = Boolean(market && trader)

  const pairIdsRead = useReadContract({
    address: market,
    chainId,
    abi: perpMarketReadAbi,
    functionName: 'getUserPairIds',
    args: trader ? [trader] : undefined,
    query: { enabled, refetchInterval: 12_000 },
  })
  const pairIds = (pairIdsRead.data as readonly bigint[] | undefined) ?? undefined

  const decimalsRead = useReadContract({
    address: market,
    chainId,
    abi: perpMarketReadAbi,
    functionName: 'getTokenDecimals',
    args: collateral ? [collateral] : undefined,
    query: { enabled: Boolean(market && collateral) },
  })
  const collateralDecimals = decimalsRead.data !== undefined ? Number(decimalsRead.data as number) : 18

  const markRead = useReadContract({
    address: market,
    chainId,
    abi: perpMarketReadAbi,
    functionName: 'tokenPrices',
    args: collateral ? [collateral] : undefined,
    query: { enabled: Boolean(market && collateral), refetchInterval: 12_000 },
  })
  const markPrice = markRead.data as bigint | undefined

  // Batch: getPairedPosition + getUnrealizedPnL for each pairId.
  const contracts = useMemo(() => {
    if (!market || !pairIds || pairIds.length === 0) {
      return []
    }
    return pairIds.flatMap((id) => [
      { address: market, chainId, abi: perpMarketReadAbi, functionName: 'getPairedPosition', args: [id] } as const,
      { address: market, chainId, abi: perpMarketReadAbi, functionName: 'getUnrealizedPnL', args: [id] } as const,
    ])
  }, [market, pairIds, chainId])

  const batch = useReadContracts({
    contracts: contracts as never,
    query: { enabled: contracts.length > 0, refetchInterval: 12_000 },
  })

  const positions = useMemo<PerpPosition[] | undefined>(() => {
    if (!enabled) {
      return undefined
    }
    if (!pairIds) {
      return undefined
    }
    if (pairIds.length === 0) {
      return []
    }
    const results = batch.data as ReadonlyArray<{ status: string; result: unknown }> | undefined
    if (!results) {
      return undefined
    }
    const traderLc = (trader as string).toLowerCase()
    const rows: PerpPosition[] = []
    for (let i = 0; i < pairIds.length; i++) {
      const posRes = results[i * 2]
      const pnlRes = results[i * 2 + 1]
      if (!posRes || posRes.status !== 'success') {
        continue
      }
      const pos = posRes.result as RawPairedPosition
      if (Number(pos.status) !== PositionStatus.Active) {
        continue
      }
      const isLong = pos.longTrader.toLowerCase() === traderLc
      const isShort = pos.shortTrader.toLowerCase() === traderLc
      if (!isLong && !isShort) {
        continue
      }
      const margin = isLong ? pos.longCollateral : pos.shortCollateral
      let uPnlRaw: bigint | undefined
      if (pnlRes && pnlRes.status === 'success') {
        const [longPnL, shortPnL] = pnlRes.result as readonly [bigint, bigint]
        uPnlRaw = isLong ? longPnL : shortPnL
      }
      rows.push({
        market: pos.token as string,
        side: isLong ? 'long' : 'short',
        size: fmt(pos.size, SIZE_PRECISION, 4),
        entry: fmt(pos.entryPrice, PRICE_PRECISION, 2),
        mark: markPrice !== undefined && markPrice > 0n ? fmt(markPrice, PRICE_PRECISION, 2) : '—',
        liq: '—',
        uPnl: uPnlRaw !== undefined ? fmtSigned(uPnlRaw, collateralDecimals, 2) : '—',
        margin: fmt(margin, collateralDecimals, 2),
      })
    }
    return rows
  }, [enabled, pairIds, batch.data, trader, markPrice, collateralDecimals])

  return {
    positions,
    isLoading: enabled && (pairIdsRead.isLoading || (contracts.length > 0 && batch.isLoading)),
    error: Boolean(pairIdsRead.error || batch.error),
    refetch: () => {
      void pairIdsRead.refetch()
      void batch.refetch()
      void markRead.refetch()
    },
  }
}
