/**
 * HookSwap Terminal — client-side one-shot pool launch, powered by the vendored `@hookos/sdk`.
 *
 * HookSwap dogfoods its own launch SDK here: instead of hand-wiring the `HookOSV3Launcher` ABI +
 * a Robinhood-only address table, this hook drives `hookos.v3` (the SDK's V3 launch module). The
 * SDK resolves the launcher / fee-vault per chain, so `/launch` now works on every HookOS-supported
 * chain (Base 8453 · Robinhood 4663 · MegaETH 4326 · HyperEVM 999 · BNB 56 · Ethereum 1). On any
 * other chain `useHookOS` returns undefined → this hook reports `ready:false` → the screen gates
 * honestly ("not available on this network").
 *
 * Flow: a single payable `launch(p)` deploys a fresh token, opens its v3 pool, and (optionally)
 * performs the creator's initial buy — all in one tx. The SDK mines the CREATE2 salt (token == token0)
 * via `buildLaunchParams`, then sends `launch()` and parses the `PoolSeeded` event, so the created
 * token / pool / positionId come straight back from the result (no getLaunch round-trip needed).
 *
 * DATA POLICY (no mock data):
 *   • Fees — REAL on-chain reads via the SDK (getEffectiveLaunchFee / getLaunchFeeUsd / quoteLaunchCost).
 *   • Result — parsed from the launch tx's PoolSeeded event by the SDK.
 *   • My launches + pending fees — batched on-chain reads (FeeVault); honest empty states.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useReadContract, useReadContracts, useWriteContract } from 'wagmi'
import {
  getHookOSV3Addresses,
  V3Dex as SdkV3Dex,
  V3PairToken as SdkV3PairToken,
  type V3BuildLaunchOptions,
} from '@hookos/sdk'
import { type Address, type Hash } from '~/chains'
import { hookOSV3LauncherAbi, hookOSV3FeeVaultAbi } from '~/terminal/launchpad/abis'
import { useHookOS } from '~/terminal/launchpad/useHookOS'

/** Zero bytes32 — the default salt when the user doesn't randomize one. */
export const ZERO_SALT = `0x${'0'.repeat(64)}` as const
/** How many recent launches `useMyLaunches` scans back over (block-read budget). */
export const MY_LAUNCHES_SCAN = 50
const INT24_MIN = -8_388_608
const INT24_MAX = 8_388_607

/** V3Dex enum values matching the contract. */
export const V3Dex = { UniswapV3: 0, HookSwap: 1 } as const
/** PairToken enum values matching the contract. */
export const PairToken = { WETH: 0, HOOK: 1 } as const

/**
 * Resolve the deployed HookOS V3 launcher + fee-vault addresses for a chain from the SDK.
 * Returns empty when V3 isn't deployed there (the SDK returns null for a zero launcher).
 */
function v3AddressesFor(chainId?: number): { launcher?: Address; feeVault?: Address } {
  if (chainId === undefined) {
    return {}
  }
  const a = getHookOSV3Addresses(chainId)
  if (!a) {
    return {}
  }
  return { launcher: a.launcher as Address, feeVault: a.feeVault as Address }
}

/** The raw `launch(p)` inputs, exactly as the form collects them (strings). */
export interface LaunchConfigInput {
  name: string
  symbol: string
  metadataURI: string
  totalSupply: string
  salt: string
  sqrtPriceX96: string
  tickLower: string
  tickUpper: string
  /** Raw uint256 wei for initial buy (default 0). */
  initialBuyEth: string
  initialBuyMinOut: string
  initialBuyDeadline: string
  /** V3Dex: 0 = UniswapV3, 1 = HookSwap. */
  dex: string
  /** PairToken: 0 = WETH, 1 = HOOK. */
  pair: string
  /** Whether to lock LP on HookSwap's locker. */
  lockOnHookSwap: boolean
}

/** The typed, validated launch config (viem-encodable), the shape the SDK options are built from. */
export interface LaunchParamsTuple {
  name: string
  symbol: string
  metadataURI: string
  totalSupply: bigint
  salt: `0x${string}`
  sqrtPriceX96: bigint
  tickLower: number
  tickUpper: number
  initialBuyEth: bigint
  initialBuyMinOut: bigint
  initialBuyDeadline: bigint
  dex: number
  pair: number
  lockOnHookSwap: boolean
}

export interface UseLaunch {
  ready: boolean
  launcher?: Address
  feeVault?: Address
  /** Base launch fee in wei (from getEffectiveLaunchFee), or undefined while loading. */
  baseFeeWei?: bigint
  /** Launch fee in USD (e.g. 8e18 = $8), or undefined while loading. */
  launchFeeUsd?: bigint
  /** Total msg.value from quoteLaunchCost, or undefined while loading. */
  totalValue?: bigint
  /** Whether HOOK pair is available on-chain. */
  hookPairEnabled?: boolean
  cfg?: LaunchParamsTuple
  validationError?: string

  inputsValid: boolean
  canLaunch: boolean
  launch: () => Promise<void>
  /** True while the SDK builds params + mines the CREATE2 salt (before the wallet prompt). */
  isWritePending: boolean
  launchHash?: Hash
  /** True while the launch tx is signed + broadcast + mined by the SDK. */
  isConfirming: boolean
  isDone: boolean

  createdToken?: Address
  createdPool?: Address
  createdTokenId?: bigint

  error?: string
  reset: () => void
}

function toMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'shortMessage' in e && typeof (e as { shortMessage: unknown }).shortMessage === 'string') {
    return (e as { shortMessage: string }).shortMessage
  }
  if (e instanceof Error) {
    return e.message.split('\n')[0]
  }
  return 'Transaction failed'
}

function tryUint(v: string): bigint | undefined {
  const t = v.trim()
  if (t === '' || !/^\d+$/.test(t)) {
    return undefined
  }
  try {
    return BigInt(t)
  } catch {
    return undefined
  }
}

function tryUintOrZero(v: string): bigint | undefined {
  if (v.trim() === '') {
    return 0n
  }
  return tryUint(v)
}

function tryInt24(v: string): number | undefined {
  const t = v.trim()
  if (t === '' || !/^-?\d+$/.test(t)) {
    return undefined
  }
  const n = Number(t)
  if (!Number.isInteger(n) || n < INT24_MIN || n > INT24_MAX) {
    return undefined
  }
  return n
}

function tryUintN(v: string, max: number): number | undefined {
  const t = v.trim()
  if (t === '' || !/^\d+$/.test(t)) {
    return undefined
  }
  const n = Number(t)
  if (!Number.isInteger(n) || n < 0 || n > max) {
    return undefined
  }
  return n
}

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/

/** A fresh random bytes32 salt (browser crypto). */
export function randomSalt(): `0x${string}` {
  const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined
  if (!cryptoObj?.getRandomValues) {
    return ZERO_SALT
  }
  const bytes = new Uint8Array(32)
  cryptoObj.getRandomValues(bytes)
  let hex = '0x'
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex as `0x${string}`
}

/**
 * Build and validate the typed launch config from raw form inputs. Note: with the SDK path the
 * CREATE2 `salt` is mined by `buildLaunchParams` (the form value is advisory) and `sqrtPriceX96`
 * is advisory too (the launcher derives price from `tickLower`) — both are still validated here so
 * the form defaults stay well-formed and the review panel can render them.
 */
function buildParams(input: LaunchConfigInput): { cfg?: LaunchParamsTuple; error?: string } {
  const name = input.name.trim()
  const symbol = input.symbol.trim()
  if (name === '') {
    return { error: 'Enter a token name' }
  }
  if (symbol === '') {
    return { error: 'Enter a token symbol' }
  }

  const totalSupply = tryUint(input.totalSupply)
  if (totalSupply === undefined || totalSupply <= 0n) {
    return { error: 'Token supply must be a positive integer (raw uint256)' }
  }

  const salt = input.salt.trim() === '' ? ZERO_SALT : input.salt.trim()
  if (!BYTES32_RE.test(salt)) {
    return { error: 'Salt must be 0x + 64 hex chars (bytes32)' }
  }

  const sqrtPriceX96 = tryUint(input.sqrtPriceX96)
  if (sqrtPriceX96 === undefined || sqrtPriceX96 <= 0n) {
    return { error: 'sqrtPriceX96 must be a positive uint160' }
  }

  const tickLower = tryInt24(input.tickLower)
  if (tickLower === undefined) {
    return { error: 'tickLower must be a whole int24' }
  }
  const tickUpper = tryInt24(input.tickUpper)
  if (tickUpper === undefined) {
    return { error: 'tickUpper must be a whole int24' }
  }
  if (tickUpper <= tickLower) {
    return { error: 'tickUpper must be greater than tickLower' }
  }

  const dex = tryUintN(input.dex, 1)
  if (dex === undefined) {
    return { error: 'DEX must be 0 (Uniswap V3) or 1 (HookSwap)' }
  }

  const pair = tryUintN(input.pair, 1)
  if (pair === undefined) {
    return { error: 'Pair must be 0 (WETH) or 1 (HOOK)' }
  }

  const initialBuyEth = tryUintOrZero(input.initialBuyEth)
  if (initialBuyEth === undefined) {
    return { error: 'Initial buy amount must be a non-negative uint256 (wei)' }
  }
  const initialBuyMinOut = tryUintOrZero(input.initialBuyMinOut)
  if (initialBuyMinOut === undefined) {
    return { error: 'Initial buy min-out must be a non-negative uint256' }
  }
  const initialBuyDeadline = tryUintOrZero(input.initialBuyDeadline)
  if (initialBuyDeadline === undefined) {
    return { error: 'Initial buy deadline must be a non-negative uint256 (unix)' }
  }

  return {
    cfg: {
      name,
      symbol,
      metadataURI: input.metadataURI.trim(),
      totalSupply,
      salt: salt as `0x${string}`,
      sqrtPriceX96,
      tickLower,
      tickUpper,
      initialBuyEth,
      initialBuyMinOut,
      initialBuyDeadline,
      dex,
      pair,
      lockOnHookSwap: input.lockOnHookSwap,
    },
  }
}

export function useLaunch({ chainId, owner, input }: { chainId?: number; owner?: Address; input: LaunchConfigInput }): UseLaunch {
  const hookos = useHookOS(chainId)
  const ready = Boolean(hookos)
  const launcher = hookos ? (hookos.v3.launcherAddress as Address) : undefined
  const { feeVault } = v3AddressesFor(chainId)

  /* --------------------------------------------------------------- cfg build + validation */

  const { cfg, error: validationError } = useMemo(() => buildParams(input), [input])

  /* --------------------------------------------------------------- reads (SDK) */

  // effectiveLaunchFee + launchFeeUsd — SDK reads over the SDK's own public RPC (no wallet needed).
  const feeQuery = useQuery({
    queryKey: ['hookos-v3', 'fees', chainId],
    queryFn: async () => {
      const [effective, usd] = await Promise.all([
        hookos!.v3.getEffectiveLaunchFee(),
        hookos!.v3.getLaunchFeeUsd(),
      ])
      return { effective, usd }
    },
    enabled: ready,
  })
  const baseFeeWei = feeQuery.data?.effective
  const launchFeeUsd = feeQuery.data?.usd

  // quoteLaunchCost(lockOnHookSwap, initialBuyEth) — total msg.value (base fee + lock fee + dev buy).
  const quoteQuery = useQuery({
    queryKey: ['hookos-v3', 'quote', chainId, cfg?.lockOnHookSwap ?? null, cfg ? cfg.initialBuyEth.toString() : null],
    queryFn: () => hookos!.v3.quoteLaunchCost(cfg!.lockOnHookSwap, cfg!.initialBuyEth),
    enabled: ready && cfg !== undefined,
  })
  const totalValue = quoteQuery.data

  // hookPairEnabled — not surfaced by the SDK's V3 module; read via the launcher ABI (same
  // bytecode on every chain) against the SDK-resolved launcher address. HOOK is gated OFF at v1.
  const hookPairRead = useReadContract({
    address: launcher,
    chainId,
    abi: hookOSV3LauncherAbi,
    functionName: 'hookPairEnabled',
    query: { enabled: ready && Boolean(launcher) },
  })
  const hookPairEnabled = hookPairRead.data as boolean | undefined

  /* --------------------------------------------------------------- launch (SDK write) */

  type Phase = 'idle' | 'preparing' | 'launching' | 'done' | 'error'
  const [phase, setPhase] = useState<Phase>('idle')
  const [launchHash, setLaunchHash] = useState<Hash | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [created, setCreated] = useState<{ token: Address; pool: Address; tokenId: bigint } | undefined>(undefined)

  const isWritePending = phase === 'preparing'
  const isConfirming = phase === 'launching'
  const isDone = phase === 'done'

  const createdToken = created?.token
  const createdPool = created?.pool
  const createdTokenId = created?.tokenId

  const inputsValid = Boolean(ready && owner && cfg !== undefined && totalValue !== undefined)
  const canLaunch = inputsValid && !isWritePending && !isConfirming && !isDone

  const launch = async (): Promise<void> => {
    if (!hookos || !owner || cfg === undefined) {
      return
    }
    if (isWritePending || isConfirming || isDone) {
      return
    }
    setError(undefined)
    setPhase('preparing')
    try {
      // Map the validated form config → the SDK's high-level build options. The SDK mines the
      // CREATE2 salt (token == token0) and assembles the on-chain LaunchParams tuple for us.
      const opts: V3BuildLaunchOptions = {
        name: cfg.name,
        symbol: cfg.symbol,
        metadataURI: cfg.metadataURI,
        totalSupply: cfg.totalSupply,
        tickLower: cfg.tickLower,
        tickUpper: cfg.tickUpper,
        creator: owner,
        initialBuyEth: cfg.initialBuyEth,
        initialBuyMinOut: cfg.initialBuyMinOut,
        initialBuyDeadline: cfg.initialBuyDeadline,
        dex: cfg.dex as SdkV3Dex,
        pair: cfg.pair as SdkV3PairToken,
        lockOnHookSwap: cfg.lockOnHookSwap,
        sqrtPriceX96: cfg.sqrtPriceX96,
      }
      const built = await hookos.v3.buildLaunchParams(opts)

      // Salt mined + params built — now sign + broadcast + mine. `value` defaults to
      // quoteLaunchCost() inside the SDK; we pass the already-quoted total for consistency.
      setPhase('launching')
      const res = await hookos.v3.launch(built.params, totalValue)
      setLaunchHash(res.txResult.hash as Hash)
      setCreated({ token: res.token as Address, pool: res.pool as Address, tokenId: res.tokenId })
      setPhase('done')
    } catch (e) {
      setError(toMessage(e))
      setPhase('error')
    }
  }

  const reset = (): void => {
    setPhase('idle')
    setLaunchHash(undefined)
    setError(undefined)
    setCreated(undefined)
  }

  return useMemo(
    () => ({
      ready,
      launcher,
      feeVault,
      baseFeeWei,
      launchFeeUsd,
      totalValue,
      hookPairEnabled,
      cfg,
      validationError,
      inputsValid,
      canLaunch,
      launch,
      isWritePending,
      launchHash,
      isConfirming,
      isDone,
      createdToken,
      createdPool,
      createdTokenId,
      error,
      reset,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      ready, launcher, feeVault, baseFeeWei, launchFeeUsd, totalValue, hookPairEnabled,
      cfg, validationError, inputsValid, canLaunch,
      isWritePending, launchHash, isConfirming, isDone,
      createdToken, createdPool, createdTokenId, error,
    ],
  )
}

/* ------------------------------------------------------------------ my launches */

export interface MyLaunch {
  id: bigint
  token: Address
  pool: Address
  creator: Address
  metadataURI: string
  tokenId: bigint
  dex: number
  createdAt: bigint
  /** Pending WETH fees for this position (from vault), raw wei. */
  pendingWeth?: bigint
  /** Pending token fees for this position (from vault). */
  pendingToken?: bigint
}

export interface UseMyLaunches {
  ready: boolean
  launcher?: Address
  feeVault?: Address
  isLoading: boolean
  launches: MyLaunch[]
  /** Sum of per-launch pendingWeth (raw wei). */
  totalPendingWeth: bigint
  /** Deferred ETH on the vault for this account. */
  deferredEth: bigint

  collect: (token: Address) => Promise<void>
  withdrawPending: () => Promise<void>
  claimingToken?: Address
  isClaiming: boolean
  claimError?: string
  refetch: () => void
}

/**
 * All recent launches (no creator filter — public listing).
 *
 * NOTE: these directory reads stay on the batched wagmi multicall (`getLaunch` / `launchCount`)
 * rather than the SDK's one-call-per-launch getters — the multicall is a single round-trip and
 * lower-risk to keep. The launcher address is now SDK-resolved, so this is multi-chain.
 */
export function useRecentLaunches({ chainId, limit = 20 }: { chainId?: number; limit?: number }): {
  isLoading: boolean
  launches: MyLaunch[]
} {
  const { launcher } = v3AddressesFor(chainId)
  const ready = Boolean(launcher)

  const countRead = useReadContract({
    address: launcher,
    chainId,
    abi: hookOSV3LauncherAbi,
    functionName: 'launchCount',
    query: { enabled: ready },
  })
  const count = countRead.data as bigint | undefined

  const ids = useMemo(() => {
    if (count === undefined || count <= 0n) {
      return [] as bigint[]
    }
    const out: bigint[] = []
    const start = count - 1n
    const end = start - BigInt(limit) + 1n
    for (let i = start; i >= 0n && i >= end; i--) {
      out.push(i)
    }
    return out
  }, [count, limit])

  const launchesRead = useReadContracts({
    contracts: ids.map((id) => ({
      address: launcher,
      chainId,
      abi: hookOSV3LauncherAbi,
      functionName: 'getLaunch' as const,
      args: [id] as const,
    })),
    query: { enabled: ready && ids.length > 0 },
  })

  const launches = useMemo(() => {
    if (!launchesRead.data) {
      return [] as MyLaunch[]
    }
    const out: MyLaunch[] = []
    launchesRead.data.forEach((entry, i) => {
      if (entry.status !== 'success' || !entry.result) {
        return
      }
      const r = entry.result as { token: Address; pool: Address; creator: Address; tokenId: bigint; feeTier: number; dex: number; locker: Address; pair: number; pairToken: Address; metadataURI: string; createdAt: bigint }
      out.push({
        id: ids[i],
        token: r.token,
        pool: r.pool,
        creator: r.creator,
        metadataURI: r.metadataURI,
        tokenId: r.tokenId,
        dex: r.dex,
        createdAt: r.createdAt,
      })
    })
    return out
  }, [launchesRead.data, ids])

  const isLoading = countRead.isLoading || launchesRead.isLoading
  return useMemo(() => ({ isLoading, launches }), [isLoading, launches])
}

export function useMyLaunches({ chainId, owner }: { chainId?: number; owner?: Address }): UseMyLaunches {
  const { launcher, feeVault } = v3AddressesFor(chainId)
  const ready = Boolean(launcher) && Boolean(feeVault)

  const countRead = useReadContract({
    address: launcher,
    chainId,
    abi: hookOSV3LauncherAbi,
    functionName: 'launchCount',
    query: { enabled: ready && Boolean(owner) },
  })
  const count = countRead.data as bigint | undefined

  const ids = useMemo(() => {
    if (count === undefined || count <= 0n) {
      return [] as bigint[]
    }
    const out: bigint[] = []
    const start = count - 1n
    const end = start - BigInt(MY_LAUNCHES_SCAN) + 1n
    for (let i = start; i >= 0n && i >= end; i--) {
      out.push(i)
    }
    return out
  }, [count])

  const launchesRead = useReadContracts({
    contracts: ids.map((id) => ({
      address: launcher,
      chainId,
      abi: hookOSV3LauncherAbi,
      functionName: 'getLaunch' as const,
      args: [id] as const,
    })),
    query: { enabled: ready && Boolean(owner) && ids.length > 0 },
  })

  const mine = useMemo(() => {
    if (!owner || !launchesRead.data) {
      return [] as MyLaunch[]
    }
    const ownerLc = owner.toLowerCase()
    const out: MyLaunch[] = []
    launchesRead.data.forEach((entry, i) => {
      if (entry.status !== 'success' || !entry.result) {
        return
      }
      const r = entry.result as { token: Address; pool: Address; creator: Address; tokenId: bigint; feeTier: number; dex: number; locker: Address; pair: number; pairToken: Address; metadataURI: string; createdAt: bigint }
      if (r.creator.toLowerCase() !== ownerLc) {
        return
      }
      out.push({
        id: ids[i],
        token: r.token,
        pool: r.pool,
        creator: r.creator,
        metadataURI: r.metadataURI,
        tokenId: r.tokenId,
        dex: r.dex,
        createdAt: r.createdAt,
      })
    })
    return out
  }, [owner, launchesRead.data, ids])

  // Read pending fees from the FeeVault (not the launcher).
  const pendingRead = useReadContracts({
    contracts: mine.map((m) => ({
      address: feeVault,
      chainId,
      abi: hookOSV3FeeVaultAbi,
      functionName: 'pending' as const,
      args: [m.token] as const,
    })),
    query: { enabled: ready && mine.length > 0 },
  })

  // Deferred ETH for the connected account on the vault.
  const deferredRead = useReadContract({
    address: feeVault,
    chainId,
    abi: hookOSV3FeeVaultAbi,
    functionName: 'pendingEth',
    args: owner ? [owner] : undefined,
    query: { enabled: ready && Boolean(owner) },
  })
  const deferredEth = (deferredRead.data as bigint) ?? 0n

  const launches = useMemo(() => {
    return mine.map((m, i) => {
      const entry = pendingRead.data?.[i]
      if (entry?.status === 'success' && entry.result) {
        const [wethOwed, tokenOwed] = entry.result as [bigint, bigint]
        return { ...m, pendingWeth: wethOwed, pendingToken: tokenOwed }
      }
      return m
    })
  }, [mine, pendingRead.data])

  const totalPendingWeth = useMemo(
    () => launches.reduce((sum, l) => sum + (l.pendingWeth ?? 0n), 0n),
    [launches],
  )

  /* --------------------------------------------------------------- claim writes (on vault) */

  const { writeContractAsync, isPending } = useWriteContract()
  const [claimingToken, setClaimingToken] = useState<Address | undefined>(undefined)
  const [claimError, setClaimError] = useState<string | undefined>(undefined)

  const collect = async (token: Address): Promise<void> => {
    if (!feeVault) {
      return
    }
    setClaimError(undefined)
    setClaimingToken(token)
    try {
      await writeContractAsync({
        address: feeVault,
        chainId,
        abi: hookOSV3FeeVaultAbi,
        functionName: 'collect',
        args: [token],
      })
    } catch (e) {
      setClaimError(toMessage(e))
    } finally {
      setClaimingToken(undefined)
    }
  }

  const withdrawPending = async (): Promise<void> => {
    if (!feeVault) {
      return
    }
    setClaimError(undefined)
    try {
      await writeContractAsync({
        address: feeVault,
        chainId,
        abi: hookOSV3FeeVaultAbi,
        functionName: 'withdrawPending',
        args: [],
      })
    } catch (e) {
      setClaimError(toMessage(e))
    }
  }

  const refetch = (): void => {
    void countRead.refetch()
    void launchesRead.refetch()
    void pendingRead.refetch()
    void deferredRead.refetch()
  }

  const isLoading = Boolean(owner) && (countRead.isLoading || launchesRead.isLoading)

  return useMemo(
    () => ({
      ready,
      launcher,
      feeVault,
      isLoading,
      launches,
      totalPendingWeth,
      deferredEth,
      collect,
      withdrawPending,
      claimingToken,
      isClaiming: isPending,
      claimError,
      refetch,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, launcher, feeVault, isLoading, launches, totalPendingWeth, deferredEth, claimingToken, isPending, claimError],
  )
}
