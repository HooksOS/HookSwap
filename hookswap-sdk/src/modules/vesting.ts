/**
 * `vesting` — write operations for HookSwap token vesting (HookSwapVestingManager + children).
 *
 * STATUS (v0.1.0): READ is fully covered by the `data` module (`data.vesting()`, `data.schedule()`,
 * `data.vestingStats()`). WRITE ops (creating a schedule, releasing) are HONEST STUBS that throw
 * `NotImplementedError`. The deployed manager address + ABIs are exposed for manual wiring.
 *
 * Target contracts (see `addresses.ts` + `abis/vesting.ts`):
 *   HookSwapVestingManager.createVesting(token, beneficiary, amount, startTime, cliffDuration, duration) → child
 *   HookSwapVesting.release()
 */
import type { PublicClient, WalletClient } from 'viem'
import { getVestingAddress } from '../addresses.js'
import { VestingChildABI, VestingManagerABI } from '../abis/vesting.js'
import { NotImplementedError, WalletRequiredError } from '../errors.js'

export interface CreateScheduleParams {
  token: string
  beneficiary: string
  /** Base-unit amount to vest. */
  amount: bigint
  /** Unix seconds — vesting start. */
  startTime: number
  /** Cliff duration in seconds (0 = no cliff). */
  cliffDuration: number
  /** Total vesting duration in seconds. */
  duration: number
}

export class VestingModule {
  /** Deployed HookSwapVestingManager for the configured chain (undefined when not deployed there). */
  readonly manager: string | undefined
  /** ABI fragment for HookSwapVestingManager (exposed for manual wiring). */
  readonly managerAbi = VestingManagerABI
  /** ABI fragment for a HookSwapVesting child (exposed for manual wiring). */
  readonly scheduleAbi = VestingChildABI

  constructor(
    private readonly chainId: number,
    /** Public client for the write wiring the stubs describe (receipt waits). */
    readonly publicClient: PublicClient,
    private readonly walletClient?: WalletClient,
  ) {
    this.manager = getVestingAddress(chainId)
  }

  /** Whether the vesting manager is deployed on the configured chain. */
  get deployed(): boolean {
    return !!this.manager
  }

  private requireWallet(op: string): void {
    if (!this.walletClient) throw new WalletRequiredError(op)
  }

  /**
   * Create + fund a vesting schedule. NOT IMPLEMENTED in v0.1.0.
   * TODO: approve `amount` of `token` to `this.manager`, then wire
   * `HookSwapVestingManager.createVesting(token, beneficiary, amount, startTime, cliffDuration, duration)`
   * via `walletClient.writeContract` (value = on-chain `vestingFee()`), wait for the receipt on
   * `this.publicClient`, and decode `VestingCreated` for the child address.
   */
  createSchedule(_params: CreateScheduleParams): Promise<never> {
    this.requireWallet('vesting.createSchedule')
    throw new NotImplementedError(
      'vesting.createSchedule',
      `Read schedules via data.vesting(). To write today, call HookSwapVestingManager.createVesting on ${this.manager ?? '(not deployed on chain ' + this.chainId + ')'} with managerAbi.`,
    )
  }

  /**
   * Release vested tokens from a schedule to its beneficiary. NOT IMPLEMENTED in v0.1.0.
   * TODO: wire `HookSwapVesting.release()` on the child contract address.
   */
  release(_params: { schedule: string }): Promise<never> {
    this.requireWallet('vesting.release')
    throw new NotImplementedError('vesting.release', 'Wire HookSwapVesting.release() with scheduleAbi.')
  }
}
