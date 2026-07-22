/**
 * `launch` — HookSwap's token / fair-launch engine.
 *
 * This wraps the upstream `@hookos/sdk` `HookOS` launch modules under HookSwap branding. The
 * launch contracts (TokenFactory, HookOSV3Launcher, RHLaunchpad quick-launch, StockRewardLauncher)
 * are the SAME on-chain deployments HookSwap's Terminal already uses — this module simply exposes
 * them headlessly and typed. Nothing is re-implemented or mocked; every call reaches the real
 * contract via the underlying viem clients.
 *
 * Sub-surfaces:
 *   - `launch.token`  → ERC-20 token creation + querying (TokenFactory). All HookOS chains.
 *   - `launch.v3`     → direct-to-Uniswap/HookSwap/Pancake v3 fair launches + buyback flywheel.
 *   - `launch.quick`  → RHLaunchpad direct-to-v4 memecoin fast path. Robinhood (4663) only.
 *   - `launch.stock`  → taxed fair launches that buy tokenized stocks for holders. Robinhood only.
 *
 * CHAIN SUPPORT: the upstream engine serves 8453 (Base), 4663 (Robinhood), 4326 (MegaETH),
 * 999 (HyperEVM), 56 (BNB), 1 (Ethereum). On a HookSwap chain the engine does NOT serve
 * (Ink 57073 / XLayer 196 / Tempo 4217 / Sepolia 11155111) the accessors throw `ChainError`.
 * Robinhood (4663) — the primary launch chain — is fully supported.
 */
import type { HookOS } from '@hookos/sdk'
import { ChainError } from '../errors.js'

/** A HookOS instance or the reason it couldn't be constructed for this chain. */
export type HookOSHandle = { ok: true; hookos: HookOS } | { ok: false; chainId: number; reason: string }

export class LaunchModule {
  constructor(private readonly handle: HookOSHandle) {}

  /** Whether the underlying launch engine is available on the configured chain. */
  get available(): boolean {
    return this.handle.ok
  }

  private engine(surface: string): HookOS {
    if (!this.handle.ok) {
      throw new ChainError(
        this.handle.chainId,
        `launch.${surface} is not available on chain ${this.handle.chainId}: ${this.handle.reason}. ` +
          `The HookSwap launch engine serves Base (8453), Robinhood (4663), MegaETH (4326), HyperEVM (999), ` +
          `BNB (56) and Ethereum (1).`,
      )
    }
    return this.handle.hookos
  }

  /** ERC-20 token creation + querying (TokenFactory): `create`, `list`, `get`, `getLaunchFee`, … */
  get token(): HookOS['tokens'] {
    return this.engine('token').tokens
  }

  /** Direct-to-v3 fair launches + buyback flywheel: `getLaunch`, `quoteLaunchCost`, `mineSalt`, … */
  get v3(): HookOS['v3'] {
    return this.engine('v3').v3
  }

  /** RHLaunchpad quick launch (direct-to-v4 memecoin): `launch`, `buildLaunchParams`, `devBuy`. Robinhood only. */
  get quick(): HookOS['quickLaunch'] {
    return this.engine('quick').quickLaunch
  }

  /** Stock-reward launches (tax buys real tokenized stocks for holders): `launch`, `claim`, `getBasket`, … Robinhood only. */
  get stock(): HookOS['stock'] {
    return this.engine('stock').stock
  }
}
