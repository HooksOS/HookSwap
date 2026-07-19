/**
 * HookSwapPerps — client-side self-service market launch (PerpMarketFactory).
 *
 * Self-contained CLIENT-SIDE flow (NO backend, NO Permit2, NO approval): a single
 * `createMarket(collateral, decimals, creator, feeRate, maxLeverage, marketId, tier,
 * oracleCfg)` write against the deployed `PerpMarketFactory` deploys an isolated perp
 * market clone, registers it in the MarketRegistry, and wires its oracle config. The
 * only value moved is the native `listingFee` (read on-chain, forwarded as `value`).
 * See `contracts/perps/src/factory/PerpMarketFactory.sol`.
 *
 * Semantics (mirrors the contract):
 *   • `marketId` = keccak256(utf8Bytes(label)), e.g. "BTC-PERP".
 *   • `feeRate` per-side in bps, clamped on-chain to [MIN_FEE=2, MAX_FEE=15].
 *   • `maxLeverage` = value * LEVERAGE_PRECISION (1e4), clamped to PLATFORM_MAX_LEVERAGE (20x).
 *   • `tier`: 0 = CURATED, 1 = PERMISSIONLESS (permissionless forces dual-source + refFeed).
 *   • `oracleCfg`: the venue must be allowlisted in OracleGuard for its sourceType or the
 *     tx reverts — on Sepolia only the ETH/USD Chainlink feed venue ("chainlink") is
 *     allowlisted, so that is the default. The call is SIMULATED before it can be signed,
 *     so an un-allowlisted venue / underfunded fee surfaces as an honest error instead of a
 *     wasted broadcast.
 *   • The `listingFee()` (0 = free) is read on-chain and forwarded as `value`.
 *   • On success the new market address is decoded from the `MarketCreated` log — never
 *     fabricated.
 *
 * All reads/writes are REAL (wagmi). Guard: not deployed on the current chain → the caller
 * renders an honest "switch to Sepolia" state; the write is disabled.
 */
import { useEffect, useMemo, useState } from 'react'
import { keccak256, parseEventLogs, toBytes, type Hex } from 'viem'
import { useReadContract, useSimulateContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import type { Address, Hash } from '~/chains'
import { getPerpsFactoryDeployment, PERPS_FACTORY_HOME_CHAIN, perpMarketFactoryAbi } from '~/terminal/perps/factory/abis'
import { assume0xAddress } from '~/utils/wagmi'

/** MarketRegistry.Tier — must match the on-chain enum ordering. */
export enum MarketTier {
  Curated = 0,
  Permissionless = 1,
}

/** LEVERAGE_PRECISION on the contract (`maxLeverage = value * 1e4`). */
export const LEVERAGE_PRECISION = 10_000n

/** Fee-rate bounds (per-side, bps) enforced on-chain by ParamGuard / the factory. */
export const FEE_RATE_MIN_BPS = 2
export const FEE_RATE_MAX_BPS = 15

/** Platform leverage cap (20x) — the on-chain PLATFORM_MAX_LEVERAGE fallback. */
export const PLATFORM_MAX_LEVERAGE_X = 20

/** The oracle `sourceType` for a Chainlink price feed = keccak256("chainlink"). */
export const CHAINLINK_SOURCE_TYPE: Hex = keccak256(toBytes('chainlink'))

/** Default deviation band + staleness for the Chainlink default config (spec-sane values). */
export const DEFAULT_MAX_DEVIATION_BPS = 500n
export const DEFAULT_MAX_STALENESS = 86_400n

/** The on-chain oracle config tuple passed to createMarket. */
export interface OracleConfigInput {
  sourceType: Hex
  venue: Address
  refFeed: Address
  maxDeviationBps: bigint
  maxStaleness: bigint
  minLiquidity: bigint
  dualSourceRequired: boolean
}

/** Human form state for the wizard. */
export interface CreateMarketForm {
  /** Market label, e.g. "BTC-PERP" → marketId = keccak256(utf8Bytes(label)). */
  label: string
  /** Collateral token address (WETH default). */
  collateral: string
  /** Collateral decimals (0 = auto-detect in the market). */
  collateralDecimals: number
  /** Fee beneficiary / launcher; defaults to the connected wallet. */
  creator: string
  /** Per-side fee rate in bps (2–15). */
  feeRateBps: number
  /** Requested leverage cap in whole x (1–20). */
  maxLeverageX: number
  tier: MarketTier
  oracle: OracleConfigInput
}

export interface UseCreateMarket {
  /** True when the factory suite is deployed on the CURRENT chain. */
  ready: boolean
  /** Resolved factory address on the current chain, or undefined when not deployed. */
  factory?: Address
  /** True when the connected wallet is on a chain WITHOUT a deploy but a home deploy exists. */
  wrongChain: boolean
  /** The chain the factory is canonically deployed on (Sepolia) — the switch target. */
  homeChainId: UniverseChainId

  /** Native listing fee (raw), or undefined while loading. 0n = free. */
  listingFee?: bigint
  /** Tier-aware creation bond (raw), escrowed + refundable after the delay unless slashed. */
  bond?: bigint
  /** Total native `value` sent with createMarket = listingFee + bond. */
  totalCost?: bigint

  /** keccak256(utf8Bytes(label)), or undefined when the label is empty. */
  marketId?: Hex
  /** maxLeverage in contract units (value * 1e4). */
  maxLeverageRaw?: bigint

  // Validation
  inputsValid: boolean
  /** Simulation result: undefined = pending/disabled, true = would succeed, false = would revert. */
  simulateOk?: boolean
  /** Human simulate error (e.g. venue not allowlisted, underfunded fee), when simulation reverts. */
  simulateError?: string

  // Create
  canCreate: boolean
  create: () => Promise<void>
  isWritePending: boolean
  txHash?: Hash
  isConfirming: boolean
  isDone: boolean
  /** Address of the freshly deployed market, decoded from the MarketCreated log. */
  marketAddress?: Address
  error?: string
  reset: () => void
}

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

/** Build the on-chain default oracle config for a Chainlink-priced (e.g. WETH) market. */
export function defaultChainlinkOracleConfig(refFeed: Address, tier: MarketTier): OracleConfigInput {
  return {
    sourceType: CHAINLINK_SOURCE_TYPE,
    venue: refFeed, // on Sepolia the ETH/USD feed itself is the allowlisted venue
    refFeed,
    maxDeviationBps: DEFAULT_MAX_DEVIATION_BPS,
    maxStaleness: DEFAULT_MAX_STALENESS,
    minLiquidity: 0n,
    dualSourceRequired: tier === MarketTier.Permissionless,
  }
}

/** marketId = keccak256(utf8Bytes(label)); undefined for an empty label. */
export function computeMarketId(label: string): Hex | undefined {
  const trimmed = label.trim()
  if (trimmed === '') {
    return undefined
  }
  return keccak256(toBytes(trimmed))
}

function isAddr(a?: string): a is string {
  return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
}

export function useCreateMarket({
  chainId,
  owner,
  form,
}: {
  chainId?: number
  owner?: Address
  form: CreateMarketForm
}): UseCreateMarket {
  const deployment = getPerpsFactoryDeployment(chainId)
  const factory = deployment?.factory
  const ready = Boolean(factory)
  const homeChainId = PERPS_FACTORY_HOME_CHAIN
  // Wrong chain only when THIS chain has no deploy but the home chain does have one.
  const wrongChain = !ready && Boolean(getPerpsFactoryDeployment(homeChainId))

  /* --------------------------------------------------------------- listing fee */

  const listingFeeRead = useReadContract({
    address: factory,
    chainId,
    abi: perpMarketFactoryAbi,
    functionName: 'listingFee',
    query: { enabled: ready },
  })
  const listingFee = listingFeeRead.data as bigint | undefined

  /* --------------------------------------------------------------- creation bond (factory v3) */
  // createMarket requires msg.value >= listingFee + minBond(tier). Bond is tier-aware
  // (permissionless > curated) and escrowed in the BondManager, slashable on abuse.
  const minBondRead = useReadContract({
    address: factory,
    chainId,
    abi: perpMarketFactoryAbi,
    functionName: 'minBond',
    args: [form.tier],
    query: { enabled: ready },
  })
  const minBond = minBondRead.data as bigint | undefined
  const totalValue =
    listingFee !== undefined && minBond !== undefined ? listingFee + minBond : undefined

  /* --------------------------------------------------------------- derived args */

  const marketId = computeMarketId(form.label)
  const feeRateOk = Number.isInteger(form.feeRateBps) && form.feeRateBps >= FEE_RATE_MIN_BPS && form.feeRateBps <= FEE_RATE_MAX_BPS
  const levOk = Number.isInteger(form.maxLeverageX) && form.maxLeverageX >= 1 && form.maxLeverageX <= PLATFORM_MAX_LEVERAGE_X
  const maxLeverageRaw = levOk ? BigInt(form.maxLeverageX) * LEVERAGE_PRECISION : undefined
  const collateral = isAddr(form.collateral) ? assume0xAddress(form.collateral) : undefined
  const creator = isAddr(form.creator) ? assume0xAddress(form.creator) : undefined
  const decimalsOk = Number.isInteger(form.collateralDecimals) && form.collateralDecimals >= 0 && form.collateralDecimals <= 36
  const oracleOk =
    isAddr(form.oracle.venue) &&
    isAddr(form.oracle.refFeed) &&
    form.oracle.maxDeviationBps > 0n

  const inputsValid = Boolean(
    ready &&
      owner &&
      factory &&
      marketId &&
      feeRateOk &&
      maxLeverageRaw !== undefined &&
      collateral &&
      creator &&
      decimalsOk &&
      oracleOk,
  )

  // The exact args createMarket is called with (also fed to the simulation).
  const args = useMemo(() => {
    if (
      !inputsValid ||
      marketId === undefined ||
      maxLeverageRaw === undefined ||
      collateral === undefined ||
      creator === undefined
    ) {
      return undefined
    }
    return [
      collateral,
      form.collateralDecimals,
      creator,
      BigInt(form.feeRateBps),
      maxLeverageRaw,
      marketId,
      form.tier,
      {
        sourceType: form.oracle.sourceType,
        venue: assume0xAddress(form.oracle.venue) as Address,
        refFeed: assume0xAddress(form.oracle.refFeed) as Address,
        maxDeviationBps: form.oracle.maxDeviationBps,
        maxStaleness: form.oracle.maxStaleness,
        minLiquidity: form.oracle.minLiquidity,
        dualSourceRequired: form.oracle.dualSourceRequired,
      },
    ] as const
  }, [inputsValid, marketId, maxLeverageRaw, collateral, creator, form])

  /* --------------------------------------------------------------- simulation gate */

  const simulate = useSimulateContract({
    address: factory,
    chainId,
    abi: perpMarketFactoryAbi,
    functionName: 'createMarket',
    args: args as never,
    value: totalValue ?? 0n,
    account: owner,
    query: { enabled: Boolean(ready && args && owner && totalValue !== undefined) },
  })
  const simulateOk = simulate.data ? true : simulate.error ? false : undefined
  const simulateError = simulate.error ? toMessage(simulate.error) : undefined

  /* --------------------------------------------------------------- write */

  const { writeContractAsync, isPending: isWritePending } = useWriteContract()

  const [txHash, setTxHash] = useState<Hash | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [marketAddress, setMarketAddress] = useState<Address | undefined>(undefined)

  const receipt = useWaitForTransactionReceipt({ hash: txHash, chainId })
  const isConfirming = Boolean(txHash) && receipt.isLoading
  const isDone = Boolean(txHash) && receipt.isSuccess

  // Decode the deployed market address from the MarketCreated log once the receipt lands.
  useEffect(() => {
    if (!receipt.isSuccess || !receipt.data) {
      return
    }
    try {
      const events = parseEventLogs({
        abi: perpMarketFactoryAbi,
        logs: receipt.data.logs,
        eventName: 'MarketCreated',
      })
      const created = events[0]
      if (created && 'args' in created && created.args.market) {
        setMarketAddress(created.args.market as Address)
      }
    } catch {
      // Leave marketAddress undefined — the tx still succeeded; show success without an
      // address rather than fabricating one.
    }
  }, [receipt.isSuccess, receipt.data])

  const canCreate = inputsValid && !isWritePending && !isConfirming && !isDone && simulateOk !== false

  const create = async (): Promise<void> => {
    if (!canCreate || !factory || args === undefined) {
      return
    }
    setError(undefined)
    try {
      // Prefer the simulated request when available (carries the validated args + gas);
      // fall back to the explicit write when the simulation hasn't resolved.
      const hash = simulate.data
        ? await writeContractAsync(simulate.data.request as never)
        : await writeContractAsync({
            address: factory,
            chainId,
            abi: perpMarketFactoryAbi,
            functionName: 'createMarket',
            args: args as never,
            value: totalValue ?? 0n,
          })
      setTxHash(hash)
    } catch (e) {
      setError(toMessage(e))
    }
  }

  const reset = (): void => {
    setTxHash(undefined)
    setError(undefined)
    setMarketAddress(undefined)
  }

  return useMemo(
    () => ({
      ready,
      factory,
      wrongChain,
      homeChainId,
      listingFee,
      bond: minBond,
      totalCost: totalValue,
      marketId,
      maxLeverageRaw,
      inputsValid,
      simulateOk,
      simulateError,
      canCreate,
      create,
      isWritePending,
      txHash,
      isConfirming,
      isDone,
      marketAddress,
      error,
      reset,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      ready,
      factory,
      wrongChain,
      homeChainId,
      listingFee,
      minBond,
      totalValue,
      marketId,
      maxLeverageRaw,
      inputsValid,
      simulateOk,
      simulateError,
      canCreate,
      isWritePending,
      txHash,
      isConfirming,
      isDone,
      marketAddress,
      error,
    ],
  )
}
