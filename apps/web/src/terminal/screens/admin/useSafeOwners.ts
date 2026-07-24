/**
 * HookSwapPerps admin — treasury Safe owner gate.
 *
 * Reads the treasury Gnosis Safe's `getOwners()` + `getThreshold()` on the selected chain and
 * checks whether the connected wallet is one of the Safe owners. This is DEFENSE-IN-UX only —
 * it hides the action forms from non-owners and shows an honest "not authorized" state. The
 * REAL gate is that every action the panel emits is a Safe batch that requires the multisig's
 * owner signatures to execute; the panel itself holds no keys and sends no owner tx.
 *
 * Honest states: while loading → `isLoading`; if the Safe read reverts (not a Safe / not
 * deployed on this chain) → `error` and the panel says it couldn't verify Safe ownership.
 */
import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import type { ContractFunctionParameters } from 'viem'
import type { Address } from '~/chains'
import { HOOKSWAP_TREASURY_SAFE, safeAbi } from '~/terminal/screens/admin/abis'

export interface UseSafeOwners {
  /** The treasury Safe address (constant). */
  safe: Address
  /** Safe owner addresses (lowercased-comparable). undefined while loading / on error. */
  owners?: Address[]
  /** Safe signature threshold (m-of-n). */
  threshold?: number
  /** True when the connected wallet is one of the Safe owners. */
  isOwner: boolean
  isLoading: boolean
  /** True when the Safe read reverted (e.g. no Safe deployed on this chain). */
  error: boolean
  refetch: () => void
}

export function useSafeOwners({
  chainId,
  account,
}: {
  chainId?: number
  account?: string
}): UseSafeOwners {
  const safe = HOOKSWAP_TREASURY_SAFE as Address
  const enabled = chainId !== undefined

  const reads = useReadContracts({
    contracts: [
      { address: safe, chainId, abi: safeAbi, functionName: 'getOwners' },
      { address: safe, chainId, abi: safeAbi, functionName: 'getThreshold' },
    ] as unknown as readonly ContractFunctionParameters[],
    query: { enabled, staleTime: 60_000 },
  })

  const owners = useMemo<Address[] | undefined>(() => {
    const entry = reads.data?.[0]
    if (entry?.status !== 'success') {
      return undefined
    }
    return (entry.result as readonly Address[]).map((a) => a)
  }, [reads.data])

  const threshold = useMemo<number | undefined>(() => {
    const entry = reads.data?.[1]
    if (entry?.status !== 'success') {
      return undefined
    }
    return Number(entry.result as bigint)
  }, [reads.data])

  const isOwner = useMemo<boolean>(() => {
    if (!owners || !account) {
      return false
    }
    const me = account.toLowerCase()
    return owners.some((o) => o.toLowerCase() === me)
  }, [owners, account])

  return {
    safe,
    owners,
    threshold,
    isOwner,
    isLoading: enabled && reads.isLoading,
    error: Boolean(reads.error) || (enabled && !reads.isLoading && owners === undefined),
    refetch: () => void reads.refetch(),
  }
}
