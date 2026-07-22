/**
 * HookSwap LaunchPad — on-chain LP-lock truth (HookOSV3FeeVault + custody NFT owner).
 *
 * The launchpad indexer carries an `lpLocked` boolean, but the SOURCE OF TRUTH is on-chain.
 * These hooks read it directly so the UI never asserts "Locked" when the chain says otherwise:
 *   - `isPermanentlyLocked(token) → (locked, unlockTime)` — the vault's permanent-lock flag.
 *   - `positions(token) → (…, locker, …)` — a non-zero `locker` is the seam for a future
 *     external locker: if the vault reports a locker address we treat the LP as locked even
 *     when `isPermanentlyLocked` is false.
 *   - `ownerOf(tokenId)` on the launch's position-manager (NFT) — if the owner is an immutable
 *     custody holder (`RECOGNIZED_LP_CUSTODY_ADDRESSES`, no withdraw/transfer/decrease path)
 *     the LP is permanently locked BY CUSTODY. This is a POSITIVE signal only, OR'd ahead of
 *     the flags above — it NEVER overrides a genuine `unlocked` from a real locker, and an
 *     `ownerOf` read failure is simply ignored (falls through to the flag logic).
 *
 * DATA POLICY (facts-only): while the reads are pending → 'loading'; if the chain has no
 * deployed FeeVault or the flag reads error → 'unknown' (callers fall back to the indexer's
 * boolean, and NEVER assert Locked over a contract "unlocked").
 */
import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { type Address } from '~/chains'
import { hookOSV3FeeVaultAbi, positionManagerAbi } from '~/terminal/launchpad/abis'
import { getCustodyLockAddresses, getFeeVaultAddress, getPositionManager } from '~/terminal/launchpad/addresses'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** The derived on-chain LP-lock state. */
export type LpLockState = 'loading' | 'locked-forever' | 'locked-until' | 'unlocked' | 'unknown'

export interface LpLockStatus {
  status: LpLockState
  /** UNIX seconds; present only for 'locked-until'. */
  unlockTime?: number
  /** The vault-reported locker address, when non-zero. */
  locker?: Address
}

/** One entry from a wagmi `useReadContracts` result (success or failure). */
interface ReadEntry {
  status: 'success' | 'failure'
  result?: unknown
}

/** A launch item to check: its token address, and (optionally) its position NFT + dex. */
export interface LpLockItem {
  token: Address
  /** LP position NFT id (from the launch). Enables the custody `ownerOf` check. */
  tokenId?: bigint
  /** DEX enum (0 = Uniswap V3, 1 = HookSwap) → selects the position manager. */
  dex?: number
}

function isNonZeroAddress(a: string | undefined): a is Address {
  return typeof a === 'string' && a.length > 0 && a.toLowerCase() !== ZERO_ADDRESS
}

/**
 * Derive an `LpLockStatus` from the reads. The custody `ownerOf` result (`owner`) is a
 * POSITIVE signal checked FIRST: if the NFT owner is in the chain's custody allowlist the LP
 * is permanently locked by custody. Everything else preserves the prior behaviour — either
 * flag read failing → 'unknown'; NEVER returns 'locked' when the contract says unlocked and
 * there is no locker. An `ownerOf` failure is ignored (falls through to the flag logic).
 */
function deriveStatus(
  permanent: ReadEntry | undefined,
  position: ReadEntry | undefined,
  owner: ReadEntry | undefined,
  custodyAllowlist: string[],
): LpLockStatus {
  // POSITIVE custody signal — OR'd ahead of the flag logic. Only asserts lock on a successful
  // read whose owner is an allowlisted immutable custody holder; never downgrades on failure.
  if (owner && owner.status === 'success' && custodyAllowlist.length > 0) {
    const ownerAddr = owner.result as string | undefined
    if (typeof ownerAddr === 'string' && custodyAllowlist.includes(ownerAddr.toLowerCase())) {
      return { status: 'locked-forever' }
    }
  }

  if (!permanent || !position || permanent.status !== 'success' || position.status !== 'success') {
    return { status: 'unknown' }
  }
  // isPermanentlyLocked → [locked: bool, unlockTime: uint40]
  const [locked, unlockRaw] = permanent.result as readonly [boolean, number | bigint]
  const unlockTime = Number(unlockRaw ?? 0)
  // positions → [token, tokenId, creator, locker, lockId, dex, pair, pairToken, registered]
  const pos = position.result as readonly [Address, bigint, Address, Address, bigint, number, number, Address, boolean]
  const lockerRaw = pos?.[3]
  const locker = isNonZeroAddress(lockerRaw) ? lockerRaw : undefined

  if (locked) {
    return unlockTime > 0
      ? { status: 'locked-until', unlockTime, locker }
      : { status: 'locked-forever', locker }
  }
  // Seam: an external locker registered on the position → treat as locked even though the
  // vault's own permanent-lock flag is false.
  if (locker) {
    return unlockTime > 0
      ? { status: 'locked-until', unlockTime, locker }
      : { status: 'locked-forever', locker }
  }
  return { status: 'unlocked' }
}

/** Index of each read within the flat multicall batch for one item (-1 when absent). */
interface ItemIndex {
  permIdx: number
  posIdx: number
  ownerIdx: number
}

/**
 * Single-token LP-lock status, read straight from the chain. Reads the FeeVault flags
 * (`isPermanentlyLocked` + `positions`) and, when a `tokenId` + `dex` are given, ALSO reads
 * `ownerOf(tokenId)` on the matching position manager in the SAME batch — an owner in the
 * custody allowlist ⇒ 'locked-forever'. 'unknown' when no FeeVault / flag reads error;
 * 'loading' while pending.
 */
export function useLpLock({
  chainId,
  token,
  tokenId,
  dex,
}: {
  chainId?: number
  token?: Address
  tokenId?: bigint
  dex?: number
}): LpLockStatus {
  const feeVault = getFeeVaultAddress(chainId)
  const npm = getPositionManager(chainId, dex)
  const custody = useMemo(() => getCustodyLockAddresses(chainId), [chainId])

  const { contracts, index } = useMemo(() => {
    const c: unknown[] = []
    const idx: ItemIndex = { permIdx: -1, posIdx: -1, ownerIdx: -1 }
    if (feeVault && token) {
      idx.permIdx = c.length
      c.push({ address: feeVault, chainId, abi: hookOSV3FeeVaultAbi, functionName: 'isPermanentlyLocked', args: [token] })
      idx.posIdx = c.length
      c.push({ address: feeVault, chainId, abi: hookOSV3FeeVaultAbi, functionName: 'positions', args: [token] })
    }
    if (npm && tokenId !== undefined) {
      idx.ownerIdx = c.length
      c.push({ address: npm, chainId, abi: positionManagerAbi, functionName: 'ownerOf', args: [tokenId] })
    }
    return { contracts: c, index: idx }
  }, [feeVault, npm, token, tokenId, chainId])

  const read = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: contracts as any,
    query: { enabled: contracts.length > 0 },
  })

  return useMemo<LpLockStatus>(() => {
    if (contracts.length === 0) {
      return { status: 'unknown' }
    }
    if (read.isLoading) {
      return { status: 'loading' }
    }
    if (!read.data) {
      return { status: 'unknown' }
    }
    const at = (i: number): ReadEntry | undefined => (i >= 0 ? (read.data?.[i] as ReadEntry) : undefined)
    return deriveStatus(at(index.permIdx), at(index.posIdx), at(index.ownerIdx), custody)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts.length, index, custody, read.isLoading, read.data])
}

/**
 * Batched multi-item LP-lock statuses for a list on ONE chain (Explore). Emits ONE
 * `useReadContracts` with up to 3 calls per item (FeeVault `isPermanentlyLocked` + `positions`,
 * plus `ownerOf` when the item carries a `tokenId` + `dex`) — all multicall-batched. Keyed by
 * LOWERCASED token address. Items on a chain with no deployed FeeVault → 'unknown' (unless a
 * custody `ownerOf` positively locks them); while pending → 'loading'.
 */
export function useLpLocks({
  chainId,
  items,
}: {
  chainId?: number
  items: LpLockItem[]
}): Record<string, LpLockStatus> {
  const feeVault = getFeeVaultAddress(chainId)
  const custody = useMemo(() => getCustodyLockAddresses(chainId), [chainId])

  // Stable, de-duplicated item list (keyed by lowercased token address).
  const key = items.map((it) => `${it.token.toLowerCase()}:${it.tokenId?.toString() ?? ''}:${it.dex ?? ''}`).join(',')
  const uniqueItems = useMemo<LpLockItem[]>(() => {
    const seen = new Set<string>()
    const out: LpLockItem[] = []
    for (const it of items) {
      const lc = it.token.toLowerCase()
      if (!seen.has(lc)) {
        seen.add(lc)
        out.push(it)
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const { contracts, indices } = useMemo(() => {
    const c: unknown[] = []
    const map: ItemIndex[] = []
    for (const it of uniqueItems) {
      const idx: ItemIndex = { permIdx: -1, posIdx: -1, ownerIdx: -1 }
      if (feeVault) {
        idx.permIdx = c.length
        c.push({ address: feeVault, chainId, abi: hookOSV3FeeVaultAbi, functionName: 'isPermanentlyLocked', args: [it.token] })
        idx.posIdx = c.length
        c.push({ address: feeVault, chainId, abi: hookOSV3FeeVaultAbi, functionName: 'positions', args: [it.token] })
      }
      const npm = getPositionManager(chainId, it.dex)
      if (npm && it.tokenId !== undefined) {
        idx.ownerIdx = c.length
        c.push({ address: npm, chainId, abi: positionManagerAbi, functionName: 'ownerOf', args: [it.tokenId] })
      }
      map.push(idx)
    }
    return { contracts: c, indices: map }
  }, [feeVault, chainId, uniqueItems])

  const read = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: contracts as any,
    query: { enabled: contracts.length > 0 },
  })

  return useMemo<Record<string, LpLockStatus>>(() => {
    const out: Record<string, LpLockStatus> = {}
    if (contracts.length === 0) {
      for (const it of uniqueItems) {
        out[it.token.toLowerCase()] = { status: 'unknown' }
      }
      return out
    }
    if (read.isLoading || !read.data) {
      for (const it of uniqueItems) {
        out[it.token.toLowerCase()] = { status: read.isLoading ? 'loading' : 'unknown' }
      }
      return out
    }
    const at = (i: number): ReadEntry | undefined => (i >= 0 ? (read.data?.[i] as ReadEntry) : undefined)
    uniqueItems.forEach((it, i) => {
      const idx = indices[i]
      out[it.token.toLowerCase()] = deriveStatus(at(idx.permIdx), at(idx.posIdx), at(idx.ownerIdx), custody)
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts.length, indices, uniqueItems, custody, read.isLoading, read.data])
}
