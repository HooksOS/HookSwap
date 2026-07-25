/**
 * HookSwap Terminal — the connected wallet's vesting schedules across ALL HookSwap chains.
 *
 * STACK-WIDE MULTICHAIN RULE (Reggie, 2026-07-25): every data surface must show a user's
 * on-chain data regardless of which chain their wallet is on, with each item badged by its
 * deploy chain. This is the vesting REFERENCE implementation of that pattern — the same shape
 * (fan a per-chain hook over a fixed address map, tag rows with `chainId`, merge) is what the
 * rest of the stack (farms / locker / pools / positions / perps / portfolio) follows.
 *
 * Hook-rules safety: `VESTING_ADDRESSES` is a module CONSTANT, so `CHAINS` below is a fixed,
 * stable-order array — calling `useMySchedules` once per entry every render keeps hook order
 * invariant (the standard "fixed set of chains" pattern). Never derive this list from state.
 *
 * Sepolia (testnet) is included in the aggregate only when the wallet is connected to Sepolia
 * — mirrors the [[multichain-aggregate-ui]] / visibleChains testnet exception so a mainnet
 * user never sees testnet schedules.
 */
import { useMemo } from 'react'
import type { Address } from '~/chains'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { isTestnetChain } from 'uniswap/src/features/chains/utils'
import { VESTING_ADDRESSES } from '~/terminal/vesting/addresses'
import { useMySchedules, type VestingScheduleRow } from '~/terminal/vesting/useMySchedules'

/** The fixed, stable-order chain set the vesting suite is deployed on. */
const CHAINS: UniverseChainId[] = Object.keys(VESTING_ADDRESSES).map((k) => Number(k) as UniverseChainId)

export interface UseMySchedulesAllChains {
  /** Merged rows across every chain (each carries its own `chainId`); undefined while loading. */
  rows?: VestingScheduleRow[]
  /** Total schedules the wallet is party to across all chains. */
  count: number
  isLoading: boolean
  error: boolean
  refetch: () => void
  /** Release a schedule's child on ITS chain (the wallet must be on that chain to sign). */
  release: (child: Address, chainId: number) => Promise<void>
  releasingChild?: Address
  isReleasing: boolean
  releaseError?: string
}

/**
 * Aggregate the wallet's vesting schedules across all deployed chains.
 *
 * @param owner            the connected wallet
 * @param connectedChainId the wallet's current chain — only used to decide whether Sepolia
 *                         (testnet) is included; VIEWING is otherwise all-chain.
 */
export function useMySchedulesAllChains({
  owner,
  connectedChainId,
}: {
  owner?: Address
  connectedChainId?: number
}): UseMySchedulesAllChains {
  // One per-chain hook per entry in the FIXED map → stable hook order every render.
  const perChain = CHAINS.map((chainId) => ({ chainId, res: useMySchedules({ chainId, owner }) }))

  const onSepolia = connectedChainId === UniverseChainId.Sepolia

  const visible = useMemo(
    () => perChain.filter(({ chainId }) => onSepolia || !isTestnetChain(chainId)),
    // perChain is rebuilt each render; key the memo on the merged inputs below instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSepolia, ...perChain.map((p) => p.res.rows), ...perChain.map((p) => p.res.isLoading)],
  )

  const rows = useMemo((): VestingScheduleRow[] | undefined => {
    // Merge every chain that has resolved; a still-loading chain contributes nothing yet but
    // does NOT block the chains that are ready (progressive fill), so the user sees data ASAP.
    const anyResolved = visible.some(({ res }) => res.rows !== undefined)
    if (!anyResolved) {
      return undefined
    }
    const merged: VestingScheduleRow[] = []
    for (const { res } of visible) {
      if (res.rows) {
        merged.push(...res.rows)
      }
    }
    // Deterministic order: receiving first, then by chainId, then by id.
    merged.sort((a, b) => {
      if (a.isBeneficiary !== b.isBeneficiary) {
        return a.isBeneficiary ? -1 : 1
      }
      if (a.chainId !== b.chainId) {
        return a.chainId - b.chainId
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const isLoading = visible.some(({ res }) => res.isLoading)
  const error = visible.every(({ res }) => res.error) && visible.length > 0
  const releasing = visible.find(({ res }) => res.isReleasing)

  const refetch = (): void => {
    for (const { res } of visible) {
      res.refetch()
    }
  }

  const release = async (child: Address, chainId: number): Promise<void> => {
    const entry = perChain.find((p) => p.chainId === chainId)
    if (entry) {
      await entry.res.release(child)
    }
  }

  return {
    rows,
    count: rows?.length ?? 0,
    isLoading,
    error,
    refetch,
    release,
    releasingChild: releasing?.res.releasingChild,
    isReleasing: Boolean(releasing),
    releaseError: visible.map(({ res }) => res.releaseError).find(Boolean),
  }
}
