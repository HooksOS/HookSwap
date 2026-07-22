/**
 * `fees` — creator-share + referral earnings from the HookSwap FeeRouter.
 *
 * Wraps the on-chain FeeRouter reads via the upstream `@hookos/sdk` `FeeModule` (the FeeRouter
 * deployment + ABI are shared across the HookSwap / HookOS stack). Every method is a REAL
 * `readContract` against the FeeRouter for the configured chain — no fabricated earnings.
 *
 * CHAIN SUPPORT: same as `launch` — Base (8453), Robinhood (4663), MegaETH (4326), HyperEVM (999),
 * BNB (56), Ethereum (1). On other HookSwap chains the accessors throw `ChainError`.
 */
import type { Address } from 'viem'
import type { HookOS } from '@hookos/sdk'
import { ChainError } from '../errors.js'
import type { HookOSHandle } from './launch.js'

/** One fee recipient's configured share. */
export interface FeeShare {
  wallet: Address
  shareBps: bigint
  label: string
}

export class FeesModule {
  constructor(private readonly handle: HookOSHandle) {}

  /** Whether the FeeRouter is reachable on the configured chain. */
  get available(): boolean {
    return this.handle.ok
  }

  private engine(): HookOS {
    if (!this.handle.ok) {
      throw new ChainError(
        this.handle.chainId,
        `fees are not available on chain ${this.handle.chainId}: ${this.handle.reason}. ` +
          `The FeeRouter is wired on Base (8453), Robinhood (4663), MegaETH (4326), HyperEVM (999), ` +
          `BNB (56) and Ethereum (1).`,
      )
    }
    return this.handle.hookos
  }

  /** Pending FeeRouter earnings for a wallet (creator share + referral), in wei. */
  getEarnings(wallet: Address): Promise<bigint> {
    return this.engine().fees.getEarnings(wallet)
  }

  /** All configured fee recipients + their basis-point shares. */
  getShares(): Promise<FeeShare[]> {
    return this.engine().fees.getShares()
  }

  /** Total fees distributed to date (wei). */
  getTotalDistributed(): Promise<bigint> {
    return this.engine().fees.getTotalDistributed()
  }

  /** Sum of all recipients' shares in basis points. */
  getTotalShareBps(): Promise<bigint> {
    return this.engine().fees.getTotalShareBps()
  }
}
