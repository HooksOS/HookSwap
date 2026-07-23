/**
 * HookSwap Terminal — Bonding-Curve launch hook, powered by the vendored `@hookos/sdk`.
 *
 * Drives `hookos.tokens` (TokenFactory.createTokenAndCurve): mints a token seeded onto a bonding
 * curve that graduates to a real DEX pool (external Uniswap v4 by default) once it fills. Live on
 * every HookOS chain the factory is deployed on (Base · Robinhood · MegaETH · HyperEVM · BNB ·
 * Ethereum); `ready:false` elsewhere so the panel gates honestly.
 *
 * DATA POLICY (no mock data):
 *   • Fee — REAL on-chain reads (getEffectiveLaunchFee native wei + getLaunchFeeUsd 1e18-USD).
 *   • Curve targets — REAL reads (trading.getStartMcapUsd / getGraduationUsd).
 *   • Result — the created token address is decoded from the create tx's TokenCreated event.
 *   • Optional dev buy — a real follow-up trading.buy(token, eth) once the curve exists.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parseEther, type Address, type Hash } from '~/chains'
import { toMessage, tryUint } from '~/terminal/launchpad/launchShared'
import { useHookOS } from '~/terminal/launchpad/useHookOS'

/** Raw form inputs for a bonding-curve launch. */
export interface BondingCurveInput {
  name: string
  symbol: string
  metadataURI: string
  /** 18-dec whole supply as a raw uint256 base-unit string (matches the v3 form convention). */
  initialSupply: string
  /** Graduate to external Uniswap v4 (true, default) vs. the internal HookPool (false). */
  useExternalDex: boolean
  /** Optional post-graduation dev buy amount (ether, decimal string). '' / '0' = none. */
  devBuyEth: string
}

export interface UseBondingCurveLaunch {
  ready: boolean
  /** Effective launch fee in native wei (the value create() sends). */
  feeWei?: bigint
  /** Launch fee target in USD (1e18-scaled). */
  feeUsd?: bigint
  /** Bonding-curve opening market cap target, USD (1e18-scaled). */
  startMcapUsd?: bigint
  /** Bonding-curve graduation market cap target, USD (1e18-scaled). */
  graduationUsd?: bigint

  validationError?: string
  canLaunch: boolean
  launch: () => Promise<void>
  isWritePending: boolean
  isConfirming: boolean
  isDone: boolean
  launchHash?: Hash

  createdToken?: Address
  /** True while the optional dev buy is in flight. */
  isBuying: boolean
  devBuy: () => Promise<void>
  devBuyHash?: Hash

  error?: string
  reset: () => void
}

function validate(input: BondingCurveInput): { error?: string; initialSupply?: bigint } {
  if (input.name.trim() === '') {
    return { error: 'Enter a token name' }
  }
  if (input.symbol.trim() === '') {
    return { error: 'Enter a token symbol' }
  }
  const initialSupply = tryUint(input.initialSupply)
  if (initialSupply === undefined || initialSupply <= 0n) {
    return { error: 'Initial supply must be a positive integer (raw uint256)' }
  }
  return { initialSupply }
}

export function useBondingCurveLaunch({
  chainId,
  owner,
  input,
}: {
  chainId?: number
  owner?: Address
  input: BondingCurveInput
}): UseBondingCurveLaunch {
  const hookos = useHookOS(chainId)
  const ready = Boolean(hookos)

  const { error: validationError, initialSupply } = useMemo(() => validate(input), [input])

  // Fee + curve targets — SDK reads over its own public RPC (no wallet needed).
  const feeQuery = useQuery({
    queryKey: ['hookos-curve', 'fees', chainId],
    queryFn: async () => {
      const [feeWei, feeUsd, startMcapUsd, graduationUsd] = await Promise.all([
        hookos!.tokens.getEffectiveLaunchFee(),
        hookos!.tokens.getLaunchFeeUsd(),
        hookos!.trading.getStartMcapUsd(),
        hookos!.trading.getGraduationUsd(),
      ])
      return { feeWei, feeUsd, startMcapUsd, graduationUsd }
    },
    enabled: ready,
  })

  type Phase = 'idle' | 'launching' | 'done' | 'error'
  const [phase, setPhase] = useState<Phase>('idle')
  const [launchHash, setLaunchHash] = useState<Hash | undefined>(undefined)
  const [createdToken, setCreatedToken] = useState<Address | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [isBuying, setIsBuying] = useState(false)
  const [devBuyHash, setDevBuyHash] = useState<Hash | undefined>(undefined)

  const isConfirming = phase === 'launching'
  const isDone = phase === 'done'
  const canLaunch = ready && Boolean(owner) && initialSupply !== undefined && !isConfirming && !isDone

  const launch = async (): Promise<void> => {
    if (!hookos || !owner || initialSupply === undefined || isConfirming || isDone) {
      return
    }
    setError(undefined)
    setPhase('launching')
    try {
      const res = await hookos.tokens.create({
        name: input.name.trim(),
        symbol: input.symbol.trim(),
        initialSupply,
        metadataURI: input.metadataURI.trim(),
        useExternalDex: input.useExternalDex,
      })
      setLaunchHash(res.txResult.hash as Hash)
      setCreatedToken(res.tokenAddress as Address)
      setPhase('done')
    } catch (e) {
      setError(toMessage(e))
      setPhase('error')
    }
  }

  const devBuy = async (): Promise<void> => {
    if (!hookos || !createdToken || isBuying) {
      return
    }
    const amount = input.devBuyEth.trim()
    if (amount === '' || amount === '0' || amount === '.') {
      return
    }
    let wei: bigint
    try {
      wei = parseEther(amount)
    } catch {
      setError('Dev-buy amount must be a valid ether value')
      return
    }
    if (wei <= 0n) {
      return
    }
    setError(undefined)
    setIsBuying(true)
    try {
      const res = await hookos.trading.buy(createdToken, wei)
      setDevBuyHash(res.hash as Hash)
    } catch (e) {
      setError(toMessage(e))
    } finally {
      setIsBuying(false)
    }
  }

  const reset = (): void => {
    setPhase('idle')
    setLaunchHash(undefined)
    setCreatedToken(undefined)
    setError(undefined)
    setDevBuyHash(undefined)
  }

  return useMemo(
    () => ({
      ready,
      feeWei: feeQuery.data?.feeWei,
      feeUsd: feeQuery.data?.feeUsd,
      startMcapUsd: feeQuery.data?.startMcapUsd,
      graduationUsd: feeQuery.data?.graduationUsd,
      validationError,
      canLaunch,
      launch,
      isWritePending: false,
      isConfirming,
      isDone,
      launchHash,
      createdToken,
      isBuying,
      devBuy,
      devBuyHash,
      error,
      reset,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, feeQuery.data, validationError, canLaunch, isConfirming, isDone, launchHash, createdToken, isBuying, devBuyHash, error],
  )
}
