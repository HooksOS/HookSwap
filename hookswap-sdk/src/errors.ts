/**
 * Error classes for the HookSwap SDK.
 *
 * DATA POLICY: nothing in this SDK fabricates a price, lock, quote, or transaction.
 * Every method either returns real data from a live endpoint / contract, or throws one
 * of the errors below. Callers should render honest empty / "—" states on failure,
 * never a $0 or a made-up value.
 */

export class HookSwapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HookSwapError'
  }
}

/** Thrown by write operations when no viem WalletClient was supplied to the client. */
export class WalletRequiredError extends HookSwapError {
  constructor(operation: string) {
    super(`Wallet client required for write operation: ${operation}`)
    this.name = 'WalletRequiredError'
  }
}

/** Thrown when a method is not available on the configured chain. */
export class ChainError extends HookSwapError {
  readonly chainId: number
  constructor(chainId: number, detail?: string) {
    super(detail ?? `Unsupported chain: ${chainId}.`)
    this.name = 'ChainError'
    this.chainId = chainId
  }
}

/** Thrown when a feature is defined but not yet wired in this SDK version (honest stub). */
export class NotImplementedError extends HookSwapError {
  constructor(operation: string, detail?: string) {
    super(`${operation} is not implemented in @hookswap/sdk v0.1.0.${detail ? ` ${detail}` : ''}`)
    this.name = 'NotImplementedError'
  }
}

/**
 * Thrown by HTTP data / swap calls. `unreachable` = a network-level failure (offline,
 * DNS, CORS, timeout); `status` = an HTTP error response. Mirrors the terminal's
 * `LockerApiError` / `TradingApiError` conventions.
 */
export class HttpApiError extends HookSwapError {
  readonly status?: number
  readonly unreachable: boolean
  readonly errorCode?: string
  constructor(message: string, opts?: { status?: number; unreachable?: boolean; errorCode?: string }) {
    super(message)
    this.name = 'HttpApiError'
    this.status = opts?.status
    this.unreachable = opts?.unreachable ?? false
    this.errorCode = opts?.errorCode
  }
}
