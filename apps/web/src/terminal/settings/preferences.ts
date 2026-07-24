/**
 * HookSwap Terminal — client-side settings persistence.
 *
 * A tiny localStorage-backed preference store for the Settings screen's
 * Notifications panel, plus a curated "clear cached preferences" action for the
 * Security panel. It mirrors the pattern already used by the theme system
 * (theme/theme.ts): read/write a namespaced localStorage key, apply immediately,
 * and dispatch a window event so every mounted consumer stays in sync without a
 * shared React store.
 *
 * HONEST SCOPE: these preferences record which of the app's REAL, in-app alert
 * categories the user wants surfaced. HookSwap has no email/push backend, so no
 * such toggle is offered — delivery is in-app only (the Activity feed + the app's
 * transaction confirmations). The categories map 1:1 to the transaction groups
 * the Activity screen actually emits (see screens/ActivityScreen.tsx `categorize`).
 */
import { useCallback, useEffect, useState } from 'react'

/* ------------------------------------------------------------ notification prefs */

/** Alert categories — each maps to a real emitted transaction group. */
export type NotificationPrefKey = 'swaps' | 'liquidity' | 'approvals' | 'transfers'

export type NotificationPrefs = Record<NotificationPrefKey, boolean>

export const NOTIFICATION_PREF_KEYS: readonly NotificationPrefKey[] = [
  'swaps',
  'liquidity',
  'approvals',
  'transfers',
]

/** Everything on by default — the user opts OUT of categories they don't want. */
const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  swaps: true,
  liquidity: true,
  approvals: true,
  transfers: true,
}

const NOTIFICATION_STORAGE_KEY = 'hookswap-notification-prefs'
export const NOTIFICATION_PREFS_EVENT = 'hookswap-notification-prefs-change'

/** Read the persisted prefs, merged over defaults (unknown/absent keys → default). */
export function getNotificationPrefs(): NotificationPrefs {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_NOTIFICATION_PREFS }
  }
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_STORAGE_KEY)
    if (!raw) {
      return { ...DEFAULT_NOTIFICATION_PREFS }
    }
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>
    const out: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS }
    for (const key of NOTIFICATION_PREF_KEYS) {
      if (typeof parsed[key] === 'boolean') {
        out[key] = parsed[key] as boolean
      }
    }
    return out
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS }
  }
}

/** Persist a single category preference, then notify listeners. */
export function setNotificationPref(key: NotificationPrefKey, on: boolean): void {
  const next = { ...getNotificationPrefs(), [key]: on }
  try {
    window.localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Non-fatal: storage may be unavailable (private mode). The event still fires
    // so the current tab reflects the choice for this session.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NOTIFICATION_PREFS_EVENT))
  }
}

/**
 * React hook: the live notification prefs + a per-category setter. Subscribes to
 * both the in-tab change event and cross-tab `storage` events so the panel stays
 * in sync if changed from anywhere.
 */
export function useNotificationPrefs(): {
  prefs: NotificationPrefs
  setPref: (key: NotificationPrefKey, on: boolean) => void
} {
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => getNotificationPrefs())

  useEffect(() => {
    const sync = (): void => setPrefs(getNotificationPrefs())
    window.addEventListener(NOTIFICATION_PREFS_EVENT, sync)
    window.addEventListener('storage', sync)
    // Reconcile in case storage changed between initial render and effect.
    sync()
    return () => {
      window.removeEventListener(NOTIFICATION_PREFS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const setPref = useCallback((key: NotificationPrefKey, on: boolean) => {
    setNotificationPref(key, on)
  }, [])

  return { prefs, setPref }
}

/* --------------------------------------------------------- clear cached prefs */

/**
 * The curated set of localStorage keys that hold HookSwap Terminal UI PREFERENCES
 * — safe to wipe without touching wallet/session state, on-chain data, or the
 * referral-attribution code. Enumerated (not prefix-matched) so the action can
 * never nuke an unrelated key by accident.
 *   • hookswap-theme                              — theme/theme.ts
 *   • hookswap-notification-prefs                 — this module
 *   • hookswap.perps.tutorial.seen.v1             — PerpsScreen tutorial
 *   • hookswap.perps.launch.tutorial.seen.v1      — CreatePerpMarketScreen tutorial
 */
export const TERMINAL_PREF_KEYS: readonly string[] = [
  'hookswap-theme',
  NOTIFICATION_STORAGE_KEY,
  'hookswap.perps.tutorial.seen.v1',
  'hookswap.perps.launch.tutorial.seen.v1',
]

/**
 * Remove the curated Terminal-preference keys from localStorage. Returns the
 * number of keys that were actually present and removed (so the caller can give
 * honest feedback). Does NOT clear wallet connections, transaction history, or
 * the referral code.
 */
export function clearTerminalPreferences(): number {
  if (typeof window === 'undefined') {
    return 0
  }
  let removed = 0
  for (const key of TERMINAL_PREF_KEYS) {
    try {
      if (window.localStorage.getItem(key) !== null) {
        window.localStorage.removeItem(key)
        removed += 1
      }
    } catch {
      // Ignore per-key storage errors (private mode / disabled storage).
    }
  }
  return removed
}
