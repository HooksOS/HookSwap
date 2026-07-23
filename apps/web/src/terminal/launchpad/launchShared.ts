/**
 * HookSwap Terminal — shared launch-hook helpers (pure, no React / no UI).
 *
 * Error normalization + numeric parsing reused by every engine hook (bonding curve / quick launch /
 * stock reward) so validation + on-chain error surfacing behave identically across engines.
 */

/** Normalize a thrown value (viem / SDK / Error) into a single-line human message. */
export function toMessage(e: unknown): string {
  if (
    e &&
    typeof e === 'object' &&
    'shortMessage' in e &&
    typeof (e as { shortMessage: unknown }).shortMessage === 'string'
  ) {
    return (e as { shortMessage: string }).shortMessage
  }
  if (e instanceof Error) {
    return e.message.split('\n')[0]
  }
  return 'Transaction failed'
}

/** Parse a non-negative integer string → bigint (raw uint256). undefined when malformed. */
export function tryUint(v: string): bigint | undefined {
  const t = v.trim()
  if (t === '' || !/^\d+$/.test(t)) {
    return undefined
  }
  try {
    return BigInt(t)
  } catch {
    return undefined
  }
}

/** '' → 0n; otherwise a non-negative integer bigint, or undefined when malformed. */
export function tryUintOrZero(v: string): bigint | undefined {
  if (v.trim() === '') {
    return 0n
  }
  return tryUint(v)
}

/** Parse a plain token COUNT (whole tokens, not wei) → bigint. undefined when malformed / <= 0. */
export function tryTokenCount(v: string): bigint | undefined {
  const n = tryUint(v)
  if (n === undefined || n <= 0n) {
    return undefined
  }
  return n
}

/** Parse a decimal ether amount ('' → 0). Returns a JS number (SDK stock/quick dev-buy take number). */
export function tryEtherNumber(v: string): number | undefined {
  const t = v.trim()
  if (t === '') {
    return 0
  }
  if (!/^\d*\.?\d*$/.test(t) || t === '.') {
    return undefined
  }
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
