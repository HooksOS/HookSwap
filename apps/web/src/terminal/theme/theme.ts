/**
 * HookSwap Terminal — light/dark theme state.
 *
 * DARK is the product default. The active theme is written to
 * `document.documentElement.dataset.theme` ('light' | 'dark'); the `--t-*`
 * palette in ./terminal.css keys off that attribute (bare `:root` == dark, so no
 * attribute still paints dark). The choice persists to localStorage.
 *
 * BOOT / NO-FLASH: the module-level call at the bottom applies the stored (or
 * default) theme synchronously the first time this module is evaluated — which
 * happens during initial bundle/chunk evaluation, before React renders the
 * Terminal, so there is no flash. It runs from the app bundle (script-src
 * 'self'), not an inline <script>, so it does not depend on a CSP inline
 * allowance. Because dark lives on bare `:root`, a user with NO stored
 * preference paints dark even before this runs.
 *
 * Canvas consumers can't observe a CSS-var swap, so `setTheme` dispatches a
 * `hookswap-theme-change` event; those call sites redraw on it (see
 * theme/tokens.ts `resolveTerminalColor` and the chart components).
 */
import { useCallback, useEffect, useState } from 'react'

export type TerminalTheme = 'light' | 'dark'

const STORAGE_KEY = 'hookswap-theme'
export const THEME_CHANGE_EVENT = 'hookswap-theme-change'
const DEFAULT_THEME: TerminalTheme = 'dark'

/** Read the persisted preference, or null when none/unavailable. */
export function getStoredTheme(): TerminalTheme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

/** The theme to render now: stored preference, else the DARK default. */
export function getActiveTheme(): TerminalTheme {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME
  }
  return getStoredTheme() ?? DEFAULT_THEME
}

/** Apply a theme to the document root (does not persist). */
export function applyTheme(theme: TerminalTheme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
  }
}

/** Persist + apply a theme, then notify canvas listeners to redraw. */
export function setTheme(theme: TerminalTheme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Non-fatal: storage may be unavailable (private mode) — the attribute still applies.
  }
  applyTheme(theme)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }
}

/** Flip between light and dark. */
export function toggleTheme(): TerminalTheme {
  const next: TerminalTheme = getActiveTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

/**
 * React hook: current theme + a toggle. Subscribes to `hookswap-theme-change`
 * so every mounted consumer (e.g. the toggle button's sun/moon icon) stays in
 * sync when the theme changes from anywhere.
 */
export function useTerminalTheme(): { theme: TerminalTheme; toggle: () => void } {
  const [theme, setThemeState] = useState<TerminalTheme>(() => getActiveTheme())

  useEffect(() => {
    const onChange = (): void => setThemeState(getActiveTheme())
    window.addEventListener(THEME_CHANGE_EVENT, onChange)
    // Reconcile in case the attribute changed between render and effect.
    onChange()
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange)
  }, [])

  const toggle = useCallback(() => {
    toggleTheme()
  }, [])

  return { theme, toggle }
}

// ---- BOOT: apply the stored/default theme at module-eval time (pre-paint). ----
applyTheme(getActiveTheme())
