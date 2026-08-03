import { Networkish, StaticJsonRpcProvider } from '@ethersproject/providers'
import { logger } from 'utilities/src/logger/logger'
import { InstrumentedJsonRpcProvider } from './observability/InstrumentedJsonRpcProvider'
import type { RpcObserver } from './observability/rpcObserver'

/** Base backoff before a failed endpoint is eligible to be primary again. */
const DEFAULT_MINIMUM_BACKOFF_MS = 12_000

/**
 * Marks itself disabled on error and re-enables after an exponentially growing
 * backoff, so a transiently broken endpoint is retried but a persistently broken
 * one stops costing a round-trip on every request. A success resets the backoff.
 */
class EndpointController {
  private isEnabled = true
  private timeout: ReturnType<typeof setTimeout> | undefined
  private backoffFactor = 1

  constructor(private readonly minimumBackoffMs: number) {}

  onSuccess(): void {
    this.isEnabled = true
    clearTimeout(this.timeout)
    this.timeout = undefined
    this.backoffFactor = 1
  }

  /** Idempotent — repeated calls do not restart an in-flight backoff timer. */
  onError(): void {
    this.isEnabled = false
    if (!this.timeout) {
      this.timeout = setTimeout(() => {
        this.isEnabled = true
        this.timeout = undefined
        this.backoffFactor *= 2
      }, this.minimumBackoffMs * this.backoffFactor)
    }
  }

  get enabled(): boolean {
    return this.isEnabled
  }
}

/**
 * True for errors that are the node answering correctly, not the endpoint being
 * broken — a reverted `eth_call` or a user-rejected action. Retrying these across every
 * endpoint would multiply latency and wrongly demote healthy endpoints, so they are
 * rethrown from the first endpoint that reports them. Mirrors viem's `shouldThrow`
 * default in its `fallback` transport.
 */
function isDefinitiveError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code === 'CALL_EXCEPTION' || code === 'ACTION_REJECTED' || code === 4001) {
    return true
  }
  return typeof message === 'string' && /execution reverted/i.test(message)
}

interface ControlledProvider {
  provider: InstrumentedJsonRpcProvider
  controller: EndpointController
  url: string
}

/**
 * An ethers provider that fails over across a chain's ordered public RPC endpoints.
 *
 * `createEthersProviderFactory` previously bound each chain to a single URL
 * (`rpcUrls[Public].http[0]`), so one dead or rate-limited endpoint took out every
 * ethers-based read for that chain — gas estimation, ENS, on-chain token fallback,
 * portfolio balances. This is the ethers analogue of viem's `fallback` transport and
 * of apps/web's AppJsonRpcProvider: try the primary, walk the list on error, and
 * demote failing endpoints with exponential backoff so secondaries never permanently
 * overtake the primary.
 *
 * Each inner provider is an InstrumentedJsonRpcProvider, so per-endpoint telemetry is
 * unchanged and a failure is attributed to the endpoint that actually failed.
 */
export class FallbackJsonRpcProvider extends StaticJsonRpcProvider {
  private readonly controlledProviders: ReadonlyArray<ControlledProvider>

  constructor({
    urls,
    headers,
    credentials,
    chainIdOrNetwork,
    observer,
    minimumBackoffMs = DEFAULT_MINIMUM_BACKOFF_MS,
  }: {
    /** Ordered endpoints, highest priority first. Must be non-empty. */
    urls: string[]
    headers?: Record<string, string>
    credentials?: 'include'
    chainIdOrNetwork: Networkish
    observer: RpcObserver
    minimumBackoffMs?: number
  }) {
    if (urls.length === 0) {
      throw new Error('FallbackJsonRpcProvider requires at least one RPC URL')
    }
    super(urls[0], chainIdOrNetwork)
    this.controlledProviders = urls.map((url) => ({
      url,
      provider: new InstrumentedJsonRpcProvider({ url, headers, credentials, chainIdOrNetwork, observer }),
      controller: new EndpointController(minimumBackoffMs),
    }))
  }

  async perform(method: string, params: Record<string, unknown>): Promise<unknown> {
    // Enabled endpoints first, preserving configured priority within each group
    // (Array.prototype.sort is stable). Disabled endpoints are demoted, not dropped,
    // so an all-endpoints-down window still attempts every URL.
    const ordered = [...this.controlledProviders].sort(
      ({ controller: a }, { controller: b }) => Number(b.enabled) - Number(a.enabled),
    )

    let lastError: unknown
    for (const { provider, controller, url } of ordered) {
      try {
        const result: unknown = await provider.perform(method, params)
        controller.onSuccess()
        return result
      } catch (error) {
        if (isDefinitiveError(error)) {
          controller.onSuccess()
          throw error
        }
        lastError = error
        controller.onError()
        logger.warn('FallbackJsonRpcProvider', 'perform', 'RPC endpoint failed, trying next', { method, url })
      }
    }
    throw lastError ?? new Error(`All RPC endpoints failed for ${method}`)
  }
}
