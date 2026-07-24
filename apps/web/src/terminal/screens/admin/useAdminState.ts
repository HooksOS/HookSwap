/**
 * HookSwapPerps admin — LIVE on-chain state reads for the ops console.
 *
 * All facts, no mock data. Batched `useReadContracts` multicalls against the deployed perps
 * governance contracts on the selected chain:
 *   • Factory   — listingFee, minBond(curated), minBond(permissionless)
 *   • FeeRouter — platform/creator/insurance split, floor, treasury, insuranceHub sinks
 *   • ParamGuard— governance leverage/fee/margin bounds
 *   • OracleGuard—registered factory, global minLiquidity, per-market config (venue/refFeed/…)
 *   • BondManager—treasury, withdrawDelay, totalBondsHeld, per-market bond (amount/slashed/…)
 *   • InsuranceHub—per-market insurance sub-account balance (in the market's collateral)
 *
 * The market list itself comes from `useMarkets` (MarketRegistry). Markets whose reads fail are
 * surfaced as `undefined` fields — the UI renders an honest "—", never a fabricated value.
 */
import { useMemo } from 'react'
import type { ContractFunctionParameters } from 'viem'
import { useReadContracts } from 'wagmi'
import type { Address } from '~/chains'
import { getPerpsFactoryDeployment } from '~/terminal/perps/factory/abis'
import { useMarkets, type MarketRow } from '~/terminal/perps/factory/useMarkets'
import { useMarketNames, type ResolvedMarketName } from '~/terminal/perps/factory/useMarketNames'
import {
  bondManagerAdminAbi,
  factoryAdminAbi,
  feeRouterAdminAbi,
  insuranceHubAdminAbi,
  oracleGuardAdminAbi,
  paramGuardAdminAbi,
} from '~/terminal/screens/admin/abis'

/* ------------------------------------------------------------------ shared config */

export interface FactoryConfig {
  listingFee?: bigint
  minBondCurated?: bigint
  minBondPermissionless?: bigint
}

export interface FeeConfig {
  platformShareBps?: bigint
  creatorShareBps?: bigint
  /** Derived: BPS(10000) − platform − creator. */
  insuranceShareBps?: bigint
  platformFloorBps?: bigint
  treasury?: Address
  insuranceHub?: Address
}

export interface ParamBounds {
  maxLeverage?: bigint
  minMaintenanceMarginBps?: bigint
  minFeeBps?: bigint
  maxFeeBps?: bigint
}

export interface OracleGlobal {
  factory?: Address
  minLiquidity?: bigint
}

export interface BondGlobal {
  treasury?: Address
  withdrawDelay?: bigint
  totalBondsHeld?: bigint
}

/* ------------------------------------------------------------------ per-market */

export interface MarketOracleConfig {
  sourceType: `0x${string}`
  venue: Address
  refFeed: Address
  maxDeviationBps: bigint
  maxStaleness: bigint
  minLiquidity: bigint
  dualSourceRequired: boolean
}

export interface MarketBond {
  creator: Address
  amount: bigint
  postedAt: bigint
  slashed: boolean
  withdrawn: boolean
}

/** Everything the admin console needs about one market, joined from every contract. */
export interface AdminMarket extends MarketRow {
  /** Derived display name (ETH-PERP …), when the market's feed resolves. */
  name?: ResolvedMarketName
  oracle?: MarketOracleConfig
  bond?: MarketBond
  /** Insurance sub-account balance in the market's collateral token. */
  insuranceBalance?: bigint
}

const BPS = 10_000n

/* ------------------------------------------------------------------ hook */

export interface UseAdminState {
  /** True when the perps factory suite is deployed on this chain. */
  deployed: boolean
  factory: FactoryConfig
  fees: FeeConfig
  bounds: ParamBounds
  oracle: OracleGlobal
  bonds: BondGlobal
  markets?: AdminMarket[]
  marketCount?: number
  isLoading: boolean
  error: boolean
  refetch: () => void
}

export function useAdminState({ chainId }: { chainId?: number }): UseAdminState {
  const deployment = getPerpsFactoryDeployment(chainId)
  const deployed = Boolean(deployment)

  /* -------- markets (registry) + derived names -------- */
  const marketsRead = useMarkets({ chainId })
  const marketRows = marketsRead.markets
  const nameInputs = useMemo(
    () => marketRows?.map((m) => ({ market: m.market, collateral: m.collateral })),
    [marketRows],
  )
  const { names } = useMarketNames({ markets: nameInputs, chainId })

  /* -------- singleton contract config (one batched multicall) -------- */
  const globalReads = useReadContracts({
    contracts: deployment
      ? ([
          { address: deployment.factory, chainId, abi: factoryAdminAbi, functionName: 'listingFee' },
          { address: deployment.factory, chainId, abi: factoryAdminAbi, functionName: 'minBond', args: [0] },
          { address: deployment.factory, chainId, abi: factoryAdminAbi, functionName: 'minBond', args: [1] },
          { address: deployment.feeRouter, chainId, abi: feeRouterAdminAbi, functionName: 'platformShareBps' },
          { address: deployment.feeRouter, chainId, abi: feeRouterAdminAbi, functionName: 'creatorShareBps' },
          { address: deployment.feeRouter, chainId, abi: feeRouterAdminAbi, functionName: 'platformFloorBps' },
          { address: deployment.feeRouter, chainId, abi: feeRouterAdminAbi, functionName: 'treasury' },
          { address: deployment.feeRouter, chainId, abi: feeRouterAdminAbi, functionName: 'insuranceHub' },
          { address: deployment.paramGuard, chainId, abi: paramGuardAdminAbi, functionName: 'getBounds' },
          { address: deployment.oracleGuard, chainId, abi: oracleGuardAdminAbi, functionName: 'factory' },
          { address: deployment.oracleGuard, chainId, abi: oracleGuardAdminAbi, functionName: 'minLiquidity' },
          { address: deployment.bondManager, chainId, abi: bondManagerAdminAbi, functionName: 'treasury' },
          { address: deployment.bondManager, chainId, abi: bondManagerAdminAbi, functionName: 'withdrawDelay' },
          { address: deployment.bondManager, chainId, abi: bondManagerAdminAbi, functionName: 'totalBondsHeld' },
        ] as unknown as readonly ContractFunctionParameters[])
      : [],
    query: { enabled: deployed, staleTime: 30_000 },
  })

  const g = globalReads.data
  const val = <T,>(i: number): T | undefined => (g?.[i]?.status === 'success' ? (g[i]!.result as T) : undefined)

  const factory: FactoryConfig = {
    listingFee: val<bigint>(0),
    minBondCurated: val<bigint>(1),
    minBondPermissionless: val<bigint>(2),
  }
  const platformShareBps = val<bigint>(3)
  const creatorShareBps = val<bigint>(4)
  const fees: FeeConfig = {
    platformShareBps,
    creatorShareBps,
    insuranceShareBps:
      platformShareBps !== undefined && creatorShareBps !== undefined
        ? BPS - platformShareBps - creatorShareBps
        : undefined,
    platformFloorBps: val<bigint>(5),
    treasury: val<Address>(6),
    insuranceHub: val<Address>(7),
  }
  const boundsTuple = val<ParamBounds>(8)
  const bounds: ParamBounds = {
    maxLeverage: boundsTuple?.maxLeverage,
    minMaintenanceMarginBps: boundsTuple?.minMaintenanceMarginBps,
    minFeeBps: boundsTuple?.minFeeBps,
    maxFeeBps: boundsTuple?.maxFeeBps,
  }
  const oracle: OracleGlobal = {
    factory: val<Address>(9),
    minLiquidity: val<bigint>(10),
  }
  const bonds: BondGlobal = {
    treasury: val<Address>(11),
    withdrawDelay: val<bigint>(12),
    totalBondsHeld: val<bigint>(13),
  }

  /* -------- per-market reads (oracle config + bond + insurance), one batched multicall -------- */
  // Three contracts × N markets, aligned as [cfg0, bond0, ins0, cfg1, bond1, ins1, …].
  const perMarketContracts = useMemo<ContractFunctionParameters[]>(() => {
    if (!deployment || !marketRows) {
      return []
    }
    const out: ContractFunctionParameters[] = []
    for (const m of marketRows) {
      out.push({
        address: deployment.oracleGuard,
        chainId,
        abi: oracleGuardAdminAbi,
        functionName: 'getMarketConfig',
        args: [m.market],
      } as unknown as ContractFunctionParameters)
      out.push({
        address: deployment.bondManager,
        chainId,
        abi: bondManagerAdminAbi,
        functionName: 'bondOf',
        args: [m.market],
      } as unknown as ContractFunctionParameters)
      out.push({
        address: deployment.insuranceHub,
        chainId,
        abi: insuranceHubAdminAbi,
        functionName: 'balanceOf',
        args: [m.market, m.collateral],
      } as unknown as ContractFunctionParameters)
    }
    return out
  }, [deployment, marketRows, chainId])

  const perMarketReads = useReadContracts({
    contracts: perMarketContracts,
    query: { enabled: deployed && perMarketContracts.length > 0, staleTime: 30_000 },
  })

  const markets = useMemo<AdminMarket[] | undefined>(() => {
    if (!marketRows) {
      return undefined
    }
    const d = perMarketReads.data
    return marketRows.map((m, i) => {
      const base = i * 3
      const cfgEntry = d?.[base]
      const bondEntry = d?.[base + 1]
      const insEntry = d?.[base + 2]
      const rawBond = bondEntry?.status === 'success' ? (bondEntry.result as MarketBond) : undefined
      return {
        ...m,
        name: names.get(m.market.toLowerCase()),
        oracle: cfgEntry?.status === 'success' ? (cfgEntry.result as MarketOracleConfig) : undefined,
        bond: rawBond,
        insuranceBalance: insEntry?.status === 'success' ? (insEntry.result as bigint) : undefined,
      }
    })
  }, [marketRows, perMarketReads.data, names])

  return {
    deployed,
    factory,
    fees,
    bounds,
    oracle,
    bonds,
    markets,
    marketCount: marketsRead.count,
    isLoading: marketsRead.isLoading || (deployed && globalReads.isLoading),
    error: marketsRead.error || Boolean(globalReads.error),
    refetch: () => {
      marketsRead.refetch()
      void globalReads.refetch()
      void perMarketReads.refetch()
    },
  }
}
