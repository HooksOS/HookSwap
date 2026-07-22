import { createPublicClient, http, type PublicClient, type WalletClient } from 'viem'
import { HookOS, type HookOSOptions } from '@hookos/sdk'
import { DEFAULT_RPC, getHookSwapChain, isHookSwapChain, type HookSwapChainId } from './chains.js'
import { ChainError } from './errors.js'
import { DataModule } from './modules/data.js'
import { SwapModule } from './modules/swap.js'
import { LaunchModule, type HookOSHandle } from './modules/launch.js'
import { FeesModule } from './modules/fees.js'
import { LockerModule } from './modules/locker.js'
import { FarmsModule } from './modules/farms.js'
import { VestingModule } from './modules/vesting.js'

/** Default HookSwap service endpoints (overridable per client). */
export const DEFAULT_DATA_BASE_URL = 'https://data.hookswap.org/locker'
export const DEFAULT_TRADING_BASE_URL = 'https://trading.hookswap.org'

/** Chain ids the upstream `@hookos/sdk` launch/fees engine serves. */
const HOOKOS_SUPPORTED_CHAIN_IDS = new Set<number>([8453, 4663, 4326, 999, 56, 1])

export interface HookSwapOptions {
  /**
   * Chain id. Defaults to 4663 (Robinhood Chain), HookSwap's primary launch chain.
   * HookSwap set: 4663 (Robinhood), 999 (HyperEVM), 4326 (MegaETH), 57073 (Ink), 196 (XLayer),
   * 4217 (Tempo), 11155111 (Sepolia).
   */
  chainId?: HookSwapChainId

  /** Custom RPC URL for the public client. Defaults to the chain's public RPC. */
  rpcUrl?: string

  /** viem WalletClient for write operations. Read/HTTP methods work without it. */
  walletClient?: WalletClient

  /** Existing viem PublicClient. When provided, `rpcUrl` is ignored for reads. */
  publicClient?: PublicClient

  /** Indexer / data-api base URL. Default `https://data.hookswap.org/locker`. */
  dataBaseUrl?: string

  /** Trading adapter base URL. Default `https://trading.hookswap.org`. */
  tradingBaseUrl?: string
}

/**
 * `HookSwap` — the official SDK client for the HookSwap stack.
 *
 * @example
 * ```ts
 * import { HookSwap } from '@hookswap/sdk'
 *
 * // Read-only (no wallet, no RPC needed for the HTTP modules):
 * const hookswap = new HookSwap({ chainId: 4663 })
 *
 * // Indexer reads (locker / farms / vesting / launchpad):
 * const { locks } = await hookswap.data.locks({ sort: 'tvl', limit: 20 })
 * const { farms } = await hookswap.data.farms({ chainId: 4663 })
 *
 * // A swap quote (no wallet needed):
 * const quote = await hookswap.swap.quote({
 *   type: TradeType.EXACT_INPUT,
 *   amount: '1000000000000000',
 *   tokenIn: '0x...WETH', tokenOut: '0x...TOKEN',
 *   tokenInChainId: 4663, tokenOutChainId: 4663,
 *   swapper: '0xYourWallet',
 * })
 *
 * // Launch a token (needs a walletClient):
 * const created = await hookswap.launch.token.create({ name: 'Foo', symbol: 'FOO', initialSupply: 1_000_000n, metadataURI: 'ipfs://...' })
 * ```
 */
export class HookSwap {
  /** Indexer / data-api reads: locks, farms, vesting schedules, launches (pure HTTP). */
  readonly data: DataModule
  /** Trading adapter: quotes + executable swap calldata + approval checks (HTTP). */
  readonly swap: SwapModule
  /** Token / fair-launch engine (delegates to the on-chain HookSwap launch contracts). */
  readonly launch: LaunchModule
  /** Creator-share + referral earnings from the FeeRouter (on-chain reads). */
  readonly fees: FeesModule
  /** Locker writes (read via `data`). Honest stubs in v0.1.0. */
  readonly locker: LockerModule
  /** Farm writes (read via `data`). Honest stubs in v0.1.0. */
  readonly farms: FarmsModule
  /** Vesting writes (read via `data`). Honest stubs in v0.1.0. */
  readonly vesting: VestingModule

  /** The viem PublicClient used for on-chain reads. */
  readonly publicClient: PublicClient
  /** The viem WalletClient used for writes (if provided). */
  readonly walletClient: WalletClient | undefined
  /** The active chain id. */
  readonly chainId: HookSwapChainId

  constructor(opts: HookSwapOptions = {}) {
    this.chainId = opts.chainId ?? 4663
    if (!isHookSwapChain(this.chainId)) {
      throw new ChainError(this.chainId, `Chain ${this.chainId} is not a HookSwap chain.`)
    }
    this.walletClient = opts.walletClient

    // Public client for on-chain reads (used by locker/farms/vesting wiring).
    if (opts.publicClient) {
      this.publicClient = opts.publicClient
    } else {
      const chain = getHookSwapChain(this.chainId)
      const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC[this.chainId]
      this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    }

    // HTTP modules — always available, no wallet / no chain gate.
    this.data = new DataModule(opts.dataBaseUrl ?? DEFAULT_DATA_BASE_URL)
    this.swap = new SwapModule(opts.tradingBaseUrl ?? DEFAULT_TRADING_BASE_URL)

    // Launch + fees delegate to the upstream engine, which serves a subset of chains.
    const handle = this.resolveHookOS(opts)
    this.launch = new LaunchModule(handle)
    this.fees = new FeesModule(handle)

    // Write-op modules (read side lives in `data`).
    this.locker = new LockerModule(this.chainId, this.publicClient, this.walletClient)
    this.farms = new FarmsModule(this.chainId, this.publicClient, this.walletClient)
    this.vesting = new VestingModule(this.chainId, this.publicClient, this.walletClient)
  }

  /** Construct the upstream HookOS engine if it serves this chain; otherwise carry the reason. */
  private resolveHookOS(opts: HookSwapOptions): HookOSHandle {
    if (!HOOKOS_SUPPORTED_CHAIN_IDS.has(this.chainId)) {
      return {
        ok: false,
        chainId: this.chainId,
        reason: 'the HookSwap launch/fees engine does not serve this chain',
      }
    }
    try {
      // The upstream engine takes viem clients typed against ITS installed viem. In a normal
      // consumer install viem dedupes to one copy; here the vendored `file:` link can resolve a
      // second viem, so we bridge the two client identities at this single boundary via a cast.
      const hookosOpts: HookOSOptions = {
        chainId: this.chainId as 8453 | 4663 | 4326 | 999 | 56 | 1,
        rpcUrl: opts.rpcUrl,
        walletClient: opts.walletClient as unknown as HookOSOptions['walletClient'],
        publicClient: opts.publicClient as unknown as HookOSOptions['publicClient'],
      }
      const hookos = new HookOS(hookosOpts)
      return { ok: true, hookos }
    } catch (e) {
      return { ok: false, chainId: this.chainId, reason: e instanceof Error ? e.message : 'engine init failed' }
    }
  }
}
