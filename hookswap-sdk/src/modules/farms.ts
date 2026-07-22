/**
 * `farms` — write operations for HookSwap staking farms (StakingRewardsFactory + children).
 *
 * STATUS (v0.1.0): READ is fully covered by the `data` module (`data.farms()`, `data.farm()`,
 * `data.farmsStats()`). WRITE ops (creating a farm, staking, claiming) are HONEST STUBS that
 * throw `NotImplementedError`. The deployed factory address + ABIs are exposed for manual wiring.
 *
 * Target contracts (see `addresses.ts` + `abis/farms.ts`):
 *   StakingRewardsFactory.createAndFund(stakingToken, rewardToken, rewardAmount, duration) → farm
 *   StakingRewards.stake(amount) / withdraw(amount) / getReward() / exit()
 */
import type { PublicClient, WalletClient } from 'viem'
import { getFarmFactory } from '../addresses.js'
import { StakingRewardsABI, StakingRewardsFactoryABI } from '../abis/farms.js'
import { NotImplementedError, WalletRequiredError } from '../errors.js'

export interface CreateFarmParams {
  stakingToken: string
  rewardToken: string
  /** Base-unit reward budget to stream over `duration`. */
  rewardAmount: bigint
  /** Streaming duration in seconds. */
  duration: number
}

export class FarmsModule {
  /** Deployed StakingRewardsFactory for the configured chain (undefined when not deployed there). */
  readonly factory: string | undefined
  /** ABI fragment for StakingRewardsFactory (exposed for manual wiring). */
  readonly factoryAbi = StakingRewardsFactoryABI
  /** ABI fragment for a StakingRewards child (exposed for manual wiring). */
  readonly farmAbi = StakingRewardsABI

  constructor(
    private readonly chainId: number,
    /** Public client for the write wiring the stubs describe (receipt waits). */
    readonly publicClient: PublicClient,
    private readonly walletClient?: WalletClient,
  ) {
    this.factory = getFarmFactory(chainId)
  }

  /** Whether the farm factory is deployed on the configured chain. */
  get deployed(): boolean {
    return !!this.factory
  }

  private requireWallet(op: string): void {
    if (!this.walletClient) throw new WalletRequiredError(op)
  }

  /**
   * Create + fund a staking farm. NOT IMPLEMENTED in v0.1.0.
   * TODO: approve `rewardAmount` of `rewardToken` to `this.factory`, then wire
   * `StakingRewardsFactory.createAndFund(stakingToken, rewardToken, rewardAmount, duration)` via
   * `walletClient.writeContract` (using `this.factoryAbi`), wait for the receipt on `this.publicClient`,
   * and decode the `FarmCreated` event for the child address.
   */
  createFarm(_params: CreateFarmParams): Promise<never> {
    this.requireWallet('farms.createFarm')
    throw new NotImplementedError(
      'farms.createFarm',
      `Read farms via data.farms(). To write today, call StakingRewardsFactory.createAndFund on ${this.factory ?? '(not deployed on chain ' + this.chainId + ')'} with factoryAbi.`,
    )
  }

  /**
   * Stake into a farm. NOT IMPLEMENTED in v0.1.0.
   * TODO: approve `amount` of the farm's staking token, then wire `StakingRewards.stake(amount)`.
   */
  stake(_params: { farm: string; amount: bigint }): Promise<never> {
    this.requireWallet('farms.stake')
    throw new NotImplementedError('farms.stake', 'Wire StakingRewards.stake(amount) with farmAbi.')
  }

  /**
   * Claim accrued rewards from a farm. NOT IMPLEMENTED in v0.1.0.
   * TODO: wire `StakingRewards.getReward()`.
   */
  claim(_params: { farm: string }): Promise<never> {
    this.requireWallet('farms.claim')
    throw new NotImplementedError('farms.claim', 'Wire StakingRewards.getReward() with farmAbi.')
  }
}
