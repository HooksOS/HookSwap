/**
 * HookSwap Terminal — a SINGLE vesting schedule by numeric id (real on-chain reads).
 *
 * The on-chain counterpart to `useMySchedules` but keyed by the schedule id in the URL
 * (`/vesting/:chainId/:scheduleId`) rather than by the connected wallet, so the public,
 * shareable detail page renders end-to-end for an ANONYMOUS visitor (no wallet required):
 *   1. manager.getScheduleData(id)   → the 10-field schedule tuple
 *   2. child.releasable()            → claimable RIGHT NOW (live block time)
 *   3. token.decimals() / .symbol()  → per-token display units
 *
 * Mirrors the farm detail page's split: THIS is the always-available on-chain read; the
 * indexer's priced USD value is layered on top via `useScheduleAnalytics`.
 *
 * A row's Vested = released + releasable (the child's identity: `releasable() =
 * vestedAmount(now) - released`), Locked = total - vested — both from real reads, never a
 * client re-derivation. `release()` is a REAL write (beneficiary-ONLY on the child) and the
 * receipt refetches the reads so the row updates from chain state, never optimistically.
 *
 * FACTS-ONLY: no fabricated amounts. `notFound` (the id resolves to an empty / zero tuple)
 * is distinguished from `error` (RPC unreachable). HookSwapVesting Phase 1 is NON-revocable
 * — there is no revoke path on the contract, so none is exposed here.
 */
import { useEffect, useMemo, useState } from 'react'
import { useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, type Address, type Hash } from '~/chains'
import { vestingChildAbi, vestingManagerAbi } from '~/terminal/vesting/abis'
import { getVestingAddress } from '~/terminal/vesting/addresses'
import type { VestingScheduleRow } from '~/terminal/vesting/useMySchedules'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export interface UseSchedule {
  /** True when the chain has a deployed HookSwapVestingManager. */
  ready: boolean
  /** undefined while loading; a fully-decoded row otherwise. */
  row?: VestingScheduleRow
  isLoading: boolean
  /** The id resolves to no schedule (empty / zero tuple) on this chain. */
  notFound: boolean
  /** An on-chain read failed (RPC unreachable) — never a fabricated fallback. */
  error: boolean
  refetch: () => void

  /** Release all currently-vested tokens (beneficiary-ONLY on the child). */
  release: () => Promise<void>
  isReleasing: boolean
  releaseError?: string
}

/** The 10-field tuple returned by `getScheduleData`. */
type ScheduleTuple = readonly [bigint, Address, Address, Address, bigint, bigint, bigint, bigint, bigint, Address]

/** Best-effort human-readable error, dropping the giant viem stack. */
function toMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'shortMessage' in e && typeof (e as { shortMessage: unknown }).shortMessage === 'string') {
    return (e as { shortMessage: string }).shortMessage
  }
  if (e instanceof Error) {
    return e.message.split('\n')[0]
  }
  return 'Transaction failed'
}

export function useSchedule({
  chainId,
  scheduleId,
  owner,
}: {
  chainId?: number
  /** The schedule id from the URL. */
  scheduleId?: bigint
  /** The connected wallet — decides `isBeneficiary` / who can `release()`. Optional (public page). */
  owner?: Address
}): UseSchedule {
  const manager = getVestingAddress(chainId)
  const ready = Boolean(manager)
  const enabled = Boolean(manager && chainId && scheduleId !== undefined)

  /* --------------------------------------------------------------- 1. schedule data */

  const dataRead = useReadContract({
    address: manager,
    chainId,
    abi: vestingManagerAbi,
    functionName: 'getScheduleData',
    args: scheduleId !== undefined ? [scheduleId] : undefined,
    query: { enabled },
  })
  const tuple = dataRead.data as unknown as ScheduleTuple | undefined

  // A decoded-but-empty tuple (no child / no token) means the id isn't a real schedule.
  const isEmptyTuple =
    tuple !== undefined &&
    (tuple[9]?.toLowerCase() === ZERO_ADDRESS || tuple[1]?.toLowerCase() === ZERO_ADDRESS)

  const child = tuple && !isEmptyTuple ? tuple[9] : undefined
  const token = tuple && !isEmptyTuple ? tuple[1] : undefined

  /* --------------------------------------------------------------- 2. live releasable */

  const releasableRead = useReadContract({
    address: child,
    chainId,
    abi: vestingChildAbi,
    functionName: 'releasable',
    query: { enabled: enabled && Boolean(child) },
  })

  /* --------------------------------------------------------------- 3. token metadata */

  const decimalsRead = useReadContract({
    address: token,
    chainId,
    abi: erc20Abi,
    functionName: 'decimals',
    query: { enabled: enabled && Boolean(token) },
  })
  const symbolRead = useReadContract({
    address: token,
    chainId,
    abi: erc20Abi,
    functionName: 'symbol',
    query: { enabled: enabled && Boolean(token) },
  })

  /* --------------------------------------------------------------- row */

  const row = useMemo((): VestingScheduleRow | undefined => {
    if (!tuple || isEmptyTuple) {
      return undefined
    }
    // Wait for the live `releasable()` — a row without it would have to guess the claimable
    // amount, which is exactly what we must never do.
    if (releasableRead.data === undefined) {
      return undefined
    }
    const releasable = releasableRead.data as bigint
    const totalAmount = tuple[7]
    const released = tuple[8]
    const vested = released + releasable
    const locked = totalAmount > vested ? totalAmount - vested : 0n
    const beneficiary = tuple[2]
    const ownerLower = owner?.toLowerCase()

    return {
      id: tuple[0],
      contractAddress: tuple[9],
      token: tuple[1],
      tokenSymbol: symbolRead.data as string | undefined,
      tokenDecimals: decimalsRead.data as number | undefined,
      beneficiary,
      creator: tuple[3],
      start: Number(tuple[4]),
      cliff: Number(tuple[5]),
      duration: Number(tuple[6]),
      totalAmount,
      released,
      releasable,
      vested,
      locked,
      isBeneficiary: Boolean(ownerLower && beneficiary.toLowerCase() === ownerLower),
    }
  }, [tuple, isEmptyTuple, releasableRead.data, symbolRead.data, decimalsRead.data, owner])

  /* --------------------------------------------------------------- release */

  const { writeContractAsync, isPending: isWritePending } = useWriteContract()
  const [releaseHash, setReleaseHash] = useState<Hash | undefined>(undefined)
  const [releaseError, setReleaseError] = useState<string | undefined>(undefined)

  const releaseReceipt = useWaitForTransactionReceipt({ hash: releaseHash, chainId })
  const isReleasing = isWritePending || (Boolean(releaseHash) && releaseReceipt.isLoading)

  const refetch = (): void => {
    void dataRead.refetch()
    void releasableRead.refetch()
  }

  // Refresh from chain state once the release confirms — never update the row optimistically.
  useEffect(() => {
    if (releaseReceipt.isSuccess) {
      void dataRead.refetch()
      void releasableRead.refetch()
      setReleaseHash(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseReceipt.isSuccess])

  const release = async (): Promise<void> => {
    if (isReleasing || !child) {
      return
    }
    setReleaseError(undefined)
    try {
      const hash = await writeContractAsync({
        address: child,
        chainId,
        abi: vestingChildAbi,
        functionName: 'release',
        args: [],
      })
      setReleaseHash(hash)
    } catch (e) {
      setReleaseError(toMessage(e))
    }
  }

  const isLoading =
    enabled && (dataRead.isLoading || (Boolean(child) && (releasableRead.isLoading || row === undefined)) && !isEmptyTuple)

  return {
    ready,
    row,
    isLoading: Boolean(isLoading),
    notFound: Boolean(isEmptyTuple),
    error: Boolean(dataRead.error || releasableRead.error),
    refetch,
    release,
    isReleasing,
    releaseError,
  }
}
