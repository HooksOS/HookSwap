/**
 * `locker` — write operations for the HookSwap token/LP/position lockers.
 *
 * STATUS (v0.1.0): READ is fully covered by the `data` module (`data.locks()`, `data.lock()`,
 * `data.lockerTokens()`, `data.lockerPools()`, `data.lockerStats()`). WRITE ops (creating /
 * extending locks) are HONEST STUBS — they throw `NotImplementedError`. The deployed contract
 * addresses + ABIs are exposed below so integrators can wire viem `writeContract` today, and so
 * a later SDK version can implement them without changing this surface.
 *
 * Target contracts (see `addresses.ts` + `abis/locker.ts`):
 *   HookSwapTokenLockerManager.lock(token, amount, unlockTime, owner) payable  → lockId
 *   HookSwapTokenLockerManager.extend(lockId, newUnlockTime)
 *   HookSwapV3PositionLocker.lock(tokenId, unlockTime, owner) payable          → lockId
 *   HookSwapV3PositionLocker.collectFees(lockId)
 */
import type { PublicClient, WalletClient } from 'viem'
import { getLockerAddresses, type LockerAddresses } from '../addresses.js'
import { TokenLockerManagerABI, V3PositionLockerABI } from '../abis/locker.js'
import { NotImplementedError, WalletRequiredError } from '../errors.js'

export interface CreateLockParams {
  /** ERC-20 or V2-LP token to lock. */
  token: string
  /** Base-unit amount to lock. */
  amount: bigint
  /** Unix seconds at which the lock unlocks. */
  unlockTime: number
  /** Lock owner (defaults to the wallet account). */
  owner?: string
}

export class LockerModule {
  /** Deployed locker addresses for the configured chain (undefined when not deployed there). */
  readonly addresses: LockerAddresses | undefined
  /** ABI fragment for HookSwapTokenLockerManager write ops (exposed for manual wiring). */
  readonly tokenLockerAbi = TokenLockerManagerABI
  /** ABI fragment for HookSwapV3PositionLocker write ops (exposed for manual wiring). */
  readonly v3PositionLockerAbi = V3PositionLockerABI

  constructor(
    private readonly chainId: number,
    /** Public client for the write wiring the stubs describe (receipt waits). */
    readonly publicClient: PublicClient,
    private readonly walletClient?: WalletClient,
  ) {
    this.addresses = getLockerAddresses(chainId)
  }

  /** Whether the locker contracts are deployed on the configured chain. */
  get deployed(): boolean {
    return !!this.addresses?.tokenLockerManager
  }

  private requireWallet(op: string): void {
    if (!this.walletClient) throw new WalletRequiredError(op)
  }

  /**
   * Create an ERC-20 / V2-LP lock. NOT IMPLEMENTED in v0.1.0.
   * TODO: wire `HookSwapTokenLockerManager.lock(token, amount, unlockTime, owner)` via
   * `walletClient.writeContract` (value = on-chain `lockFee()`), using `this.addresses.tokenLockerManager`
   * + `this.tokenLockerAbi`, then wait for the receipt on `this.publicClient`.
   */
  createLock(_params: CreateLockParams): Promise<never> {
    this.requireWallet('locker.createLock')
    throw new NotImplementedError(
      'locker.createLock',
      `Read locks via data.locks(). To write today, call HookSwapTokenLockerManager.lock on ${this.addresses?.tokenLockerManager ?? '(not deployed on chain ' + this.chainId + ')'} with tokenLockerAbi.`,
    )
  }

  /**
   * Lock a Uniswap v3 position NFT. NOT IMPLEMENTED in v0.1.0.
   * TODO: wire `HookSwapV3PositionLocker.lock(tokenId, unlockTime, owner)` via `walletClient.writeContract`.
   */
  lockV3Position(_params: { tokenId: bigint; unlockTime: number; owner?: string }): Promise<never> {
    this.requireWallet('locker.lockV3Position')
    throw new NotImplementedError(
      'locker.lockV3Position',
      `To write today, call HookSwapV3PositionLocker.lock on ${this.addresses?.v3PositionLocker ?? '(not deployed on chain ' + this.chainId + ')'} with v3PositionLockerAbi.`,
    )
  }
}
