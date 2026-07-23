/**
 * HookSwap Terminal — Farms (StakingRewardsFactory) contract addresses.
 *
 * FACTS-ONLY: `StakingRewardsFactory` is the self-service staking-farm deployer
 * (see `contracts/farms/src/StakingRewardsFactory.sol`) — anyone can call
 * `createAndFund(stakingToken, rewardToken, rewardAmount, duration)` to deploy a funded
 * `StakingRewards` child that streams `rewardToken` to stakers over `duration`. The
 * contract is built + audited + Sepolia-tested, but its Robinhood-mainnet deploy is
 * PENDING, so every entry here is intentionally UNSET. Do NOT invent an address: a chain
 * with no entry (or `undefined`) renders an honest "Farms aren't deployed on {chain} yet"
 * state — never fabricated data.
 *
 * When Reggie deploys StakingRewardsFactory, fill the address below (from the deploy output /
 * `contracts/deployments/robinhood.json` `"stakingRewardsFactory"`) and the screen lights up
 * automatically — no other change needed. Mirrors `~/terminal/vesting/addresses.ts`.
 */

import { UniverseChainId } from 'uniswap/src/features/chains/types'
import type { Address } from '~/chains'

/**
 * Per-chain deployed `StakingRewardsFactory` addresses. Robinhood-only launch scope;
 * structured so other HookSwap chains can be added from their deploy output.
 */
// FEE-ENABLED StakingRewardsFactory (createFee $15-native + protocolFeeBps 100 = 1%,
// feeReceiver = treasury 0x011d438E). Deployed 2026-07-23, on-chain verified. Supersedes
// the earlier no-fee suite factories. Tempo (4217) uses AA/pathUSD gas → fee-factory deploy
// deferred; keep its prior no-fee factory until the AA deploy lands.
export const FARM_FACTORY_ADDRESSES: Partial<Record<UniverseChainId, Address>> = {
  [UniverseChainId.Robinhood]: '0x1b51c392de4e3d3e0ab066c5f89492ec0fcf21c3',
  [UniverseChainId.HyperEvm]: '0xef6348e9c3ed869798cd7c711837fc16d13d1488',
  [UniverseChainId.XLayer]: '0x7e814d843d32e683ae25144430399ed77015ee07',
  [UniverseChainId.MegaETH]: '0x1eb902735c9d65143e4a67dc05d34fb740a682b4',
  [UniverseChainId.Ink]: '0x8d26aa9d0556fd1483ad630fe9f6e21c168f2e33',
  [UniverseChainId.Stable]: '0x5520789f08934681510836816b418eff9f5c06cc',
  [UniverseChainId.Sepolia]: '0x3da293ebf0a35aeb4fcec20fd1101ed471f035a4',
  // Tempo (4217): fee-factory deploy deferred (AA/pathUSD gas); prior no-fee factory:
  [UniverseChainId.Tempo]: '0x250c3448278f7b71e3e9b641f2efeb6074820e25',
}

/**
 * Deployed `StakingRewardsFactory` address for a chain, or `undefined` when it isn't
 * deployed there yet. Callers treat a missing address as an honest "not deployed" state.
 */
export function getFarmFactory(chainId?: number): Address | undefined {
  if (chainId === undefined) {
    return undefined
  }
  return FARM_FACTORY_ADDRESSES[chainId as UniverseChainId]
}
