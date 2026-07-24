/**
 * HookSwap Terminal — design tokens.
 *
 * Pixel-perfect extraction of the "Terminal" (column 1b) direction from the
 * design handoff (design_handoff_hookswap_terminal/README.md). Every value here
 * is copied EXACTLY from the spec — do not "improve" or round.
 *
 * This module is fully additive: it is a standalone, typed token object consumed
 * by the Terminal component layer via inline styles / CSS variables. It does NOT
 * mutate the existing Tamagui theme, so the live Uniswap-fork app is unaffected.
 *
 * The same values are mirrored as CSS custom properties in ./terminal.css
 * (prefixed `--tm-`) for consumers that prefer variables.
 */

/* ------------------------------------------------------------------ colors */

/**
 * THEME-AWARE COLOR TOKENS.
 *
 * Every value is a `var(--t-*)` reference, NOT a raw hex. The real hexes for both
 * palettes live in ./terminal.css under `:root` (DARK, the default) and
 * `:root[data-theme='light']` (the DAYSIGNAL LIGHT palette, byte-identical to the
 * former hardcoded values). Because these tokens are consumed in CSS contexts
 * (inline `style` props, border/gradient strings), they resolve to the active
 * theme automatically — the ~85 consuming files need no per-file change, and a
 * theme toggle re-paints instantly with no React re-render.
 *
 * ⚠️ NON-CSS CONSUMERS (canvas 2D, hex string-math): a `var()` string cannot be
 * parsed by `<canvas>` fill/stroke. Those specific call sites must read the real
 * hex for the active theme via `resolveTerminalColor(token)` below, and redraw on
 * the `hookswap-theme-change` event (see theme/theme.ts). Do NOT feed the raw
 * `var(--t-*)` string into a canvas context.
 */
export const terminalColors = {
  // Text / ink
  ink: 'var(--t-ink)', // primary text / headings
  ink2: 'var(--t-ink-2)', // secondary text
  ink3: 'var(--t-ink-3)', // muted labels (primary)
  ink3Alt: 'var(--t-ink-3-alt)', // muted labels (alt used in rail section labels)
  faint: 'var(--t-faint)', // axis labels, timestamps

  // Lines / dividers
  line: 'var(--t-line)', // card/frame borders
  line2: 'var(--t-line-2)', // inner dividers / section rules
  line3: 'var(--t-line-3)', // table row dividers

  // Surfaces
  bg: 'var(--t-bg)', // cards, top bar, active pills
  bgApp: 'var(--t-bg-app)', // main content / page background
  panel: 'var(--t-panel)', // inputs, rail background, inset fields / chart wells
  panel2: 'var(--t-panel-2)', // segmented-control track, chips (primary)
  panel2Alt: 'var(--t-panel-2-alt)', // segmented-control track, chips (alt)

  // Brand green
  brandGreen: 'var(--t-brand-green)', // primary buttons, active accent, "Swap" wordmark
  greenDeep: 'var(--t-green-deep)', // green text/links
  greenUp: 'var(--t-green-up)', // positive values
  greenBg: 'var(--t-green-bg)', // green badge/surface
  greenBorder: 'var(--t-green-border)', // green card border
  btnInk: 'var(--t-btn-ink)', // text on brand-green buttons

  // Red / negative
  redDown: 'var(--t-red-down)', // negative values
  redBg: 'var(--t-red-bg)', // negative surface

  // Warn — gold (DAYSIGNAL rule/accent)
  warn: 'var(--t-warn)', // gas, out-of-range
  warnBg: 'var(--t-warn-bg)', // warn surface (primary)
  warnBgAlt: 'var(--t-warn-bg-alt)', // warn surface (alt)

  // Accents (categories / token icons)
  accentIndigo: 'var(--t-accent-indigo)', // ETH icon, TWAMM category
  accentBlue: 'var(--t-accent-blue)', // USDC icon
  accentPurple: 'var(--t-accent-purple)', // governance
  accentPink: 'var(--t-accent-pink)', // security category
  accentTeal: 'var(--t-accent-teal)', // yield category

  // Rail-specific inactive icon
  railIconInactive: 'var(--t-rail-icon-inactive)', // inactive nav icon
  railWalletSub: 'var(--t-rail-wallet-sub)', // wallet chip subtext
} as const

export type TerminalColorToken = keyof typeof terminalColors

/* -------------------------------------------------- canvas hex resolver ---
   `<canvas>` 2D contexts cannot parse `var(--t-*)`. Canvas call sites (chart
   grids/lines/fills) must resolve the REAL hex for the active theme at draw
   time via `resolveTerminalColor(token)`, and re-draw on the
   `hookswap-theme-change` event. The map below names the CSS var per token; the
   DARK fallback covers SSR / a not-yet-mounted root (dark is the default). */

/** Token → CSS custom-property name (mirrors terminalColors + terminal.css). */
export const terminalColorVars: Record<TerminalColorToken, string> = {
  ink: '--t-ink',
  ink2: '--t-ink-2',
  ink3: '--t-ink-3',
  ink3Alt: '--t-ink-3-alt',
  faint: '--t-faint',
  line: '--t-line',
  line2: '--t-line-2',
  line3: '--t-line-3',
  bg: '--t-bg',
  bgApp: '--t-bg-app',
  panel: '--t-panel',
  panel2: '--t-panel-2',
  panel2Alt: '--t-panel-2-alt',
  brandGreen: '--t-brand-green',
  greenDeep: '--t-green-deep',
  greenUp: '--t-green-up',
  greenBg: '--t-green-bg',
  greenBorder: '--t-green-border',
  btnInk: '--t-btn-ink',
  redDown: '--t-red-down',
  redBg: '--t-red-bg',
  warn: '--t-warn',
  warnBg: '--t-warn-bg',
  warnBgAlt: '--t-warn-bg-alt',
  accentIndigo: '--t-accent-indigo',
  accentBlue: '--t-accent-blue',
  accentPurple: '--t-accent-purple',
  accentPink: '--t-accent-pink',
  accentTeal: '--t-accent-teal',
  railIconInactive: '--t-rail-icon-inactive',
  railWalletSub: '--t-rail-wallet-sub',
}

/** DARK-palette fallback hexes (mirrors :root in terminal.css) for non-DOM contexts. */
const terminalColorDarkFallback: Record<TerminalColorToken, string> = {
  ink: '#e8ece2',
  ink2: '#adb5a4',
  ink3: '#7e8676',
  ink3Alt: '#7e8676',
  faint: '#676e60',
  line: '#2a3124',
  line2: '#232a1e',
  line3: '#1c2218',
  bg: '#1e241a',
  bgApp: '#0d100c',
  panel: '#14190f',
  panel2: '#171d14',
  panel2Alt: '#1b2217',
  brandGreen: '#33ce79',
  greenDeep: '#4bd689',
  greenUp: '#3fd782',
  greenBg: '#12271a',
  greenBorder: '#2c6b45',
  btnInk: '#08110a',
  redDown: '#ff6b5e',
  redBg: '#2c1310',
  warn: '#e0a93a',
  warnBg: '#2a2110',
  warnBgAlt: '#2b2012',
  accentIndigo: '#7c8bff',
  accentBlue: '#5aa0ff',
  accentPurple: '#a98be6',
  accentPink: '#f06a93',
  accentTeal: '#34c7be',
  railIconInactive: '#676e60',
  railWalletSub: '#676e60',
}

/**
 * Resolve a Terminal color token to a REAL hex string for the currently-active
 * theme. Use ONLY at non-CSS call sites (canvas fill/stroke) — everywhere else
 * use `terminalColors.<token>` directly so the CSS cascade themes it for free.
 */
export function resolveTerminalColor(token: TerminalColorToken): string {
  if (typeof document !== 'undefined') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(terminalColorVars[token]).trim()
    if (v) {
      return v
    }
  }
  return terminalColorDarkFallback[token]
}

/**
 * Resolve an arbitrary CSS color value that MAY be a `var(--x)` / `var(--x, fb)`
 * reference (e.g. a `terminalColors.*` token) to a real, canvas-parseable hex.
 * Raw colors (hex/rgb) pass through unchanged. Use at canvas call sites that
 * receive token-derived colors from data (e.g. per-series chart colors).
 */
export function resolveCssColor(value: string): string {
  const m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i.exec(value.trim())
  if (!m) {
    return value
  }
  if (typeof document !== 'undefined') {
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim()
    if (resolved) {
      return resolved
    }
  }
  // Fall back to the var()'s own fallback arg, else the raw string.
  return m[2]?.trim() ?? value
}

/**
 * Placeholder token-logo gradients from the prototype. These are CSS gradient
 * circles used ONLY where a real token logo asset is not yet available; the
 * handoff mandates replacing them with real logos (token lists / CDN).
 */
export const terminalTokenGradients = {
  eth: 'linear-gradient(135deg,#8A92FF,#5B6BFF)',
  usdc: 'linear-gradient(135deg,#2E7CF6,#2563EB)',
  walletAvatar: 'linear-gradient(135deg,#17B357,#0C8A42)',
} as const

/* -------------------------------------------------------------- typography */

export const terminalFonts = {
  /** Display / headings / logo wordmark. */
  display: "'Space Grotesk', sans-serif",
  /** UI / body. */
  sans: "'IBM Plex Sans', sans-serif",
  /** Numbers, prices, addresses, tickers, code, param values (hard rule). */
  mono: "'IBM Plex Mono', monospace",
} as const

/** Letter-spacing values used across the spec. */
export const terminalLetterSpacing = {
  displayTight: '-0.03em',
  display: '-0.02em',
  pillTight: '-0.01em',
  railSection: '0.09em', // uppercase section labels (TRADE / ACCOUNT)
} as const

/**
 * Representative type scale from README §Typography. `family` names the intended
 * font per role; `size`/`weight`/`ls` are px / numeric / letter-spacing.
 */
export const terminalType = {
  heroH1: { family: 'display', size: 50, weight: 600, ls: terminalLetterSpacing.display },
  sectionTitle: { family: 'display', size: 26, weight: 600, ls: terminalLetterSpacing.display },
  sectionTitleSm: { family: 'display', size: 22, weight: 600, ls: terminalLetterSpacing.display },
  cardTitle: { family: 'sans', size: 17, weight: 600, ls: '0' },
  cardTitleSm: { family: 'sans', size: 14, weight: 600, ls: '0' },
  body: { family: 'sans', size: 14, weight: 400, ls: '0' },
  bodyLg: { family: 'sans', size: 16, weight: 400, ls: '0' },
  bodySm: { family: 'sans', size: 13, weight: 400, ls: '0' },
  tableCell: { family: 'mono', size: 13, weight: 400, ls: '0' }, // 12.5–14
  kpiValue: { family: 'mono', size: 22, weight: 600, ls: terminalLetterSpacing.display }, // 18–28
  microLabel: { family: 'sans', size: 11, weight: 600, ls: '0' }, // 10.5–12
  railSectionLabel: { family: 'sans', size: 10.5, weight: 600, ls: terminalLetterSpacing.railSection },
} as const

export type TerminalTypeToken = keyof typeof terminalType

/* ----------------------------------------------------------------- shape */

/** Border radii (px unless the 999px pill / 50% circle). */
export const terminalRadii = {
  pill: 999,
  circle: '50%',
  buttonMin: 9,
  buttonMax: 15,
  inputMin: 9,
  inputMax: 13,
  cardMin: 11,
  cardMax: 18,
  screenFrame: 18,
  modalMin: 18,
  modalMax: 22,
  // Concrete values used verbatim in the nav/top-bar prototype:
  railItem: 10,
  railCard: 12,
  topBarField: 9,
} as const

export const terminalBorders = {
  card: `1px solid ${terminalColors.line}`, // 1px solid #E6E9EE
  innerDivider: `1px solid ${terminalColors.line2}`, // 1px solid #EFF1F4
  rowDivider: `1px solid ${terminalColors.line3}`, // 1px solid #F4F6F8
  greenCard: `1px solid ${terminalColors.greenBorder}`,
} as const

export const terminalShadows = {
  screenFrame: '0 30px 60px -30px rgba(11,15,20,.22)',
  modal: '0 40px 90px -20px rgba(11,15,20,.5)',
  segmentedActive: '0 1px 2px rgba(11,15,20,.06)',
  railActiveItem: '0 1px 2px rgba(11,15,20,.05)',
  greenGlow: '0 0 0 3px rgba(23,179,87,.16)', // connection dot halo (top bar)
} as const

/** Modal scrim colour (B8/B9/B11). */
export const terminalScrim = 'rgba(18,22,15,.38)'

/* --------------------------------------------------------------- layout */

export const terminalLayout = {
  frameWidth: 1360, // all Terminal screens are 1360px desktop frames
  railWidth: 226, // fixed left rail
  topBarHeight: 52, // Terminal top bar
  // Per-screen fixed columns (from README screen specs):
  swapMarketListWidth: 238, // B2 left market list
  swapTicketWidth: 326, // B2 right swap ticket
  createConfigWidth: 300, // B4 left config
  createDepositWidth: 300, // B4 right deposit
  marketDetailSideWidth: 330, // B6 right column
  hookDetailSideWidth: 340, // B7 right column
  confirmModalWidth: 424, // B8
  connectModalWidth: 400, // B9
  commandPaletteWidth: 640, // B11
  settingsNavWidth: 210, // B12 left settings nav
  contentPaddingMin: 16,
  contentPaddingMax: 26,
} as const

/* ---------------------------------------------------------- primitives */

/** Primary button (bg brand-green, ink text). */
export const terminalPrimaryButton = {
  background: terminalColors.brandGreen,
  color: terminalColors.btnInk,
  fontWeight: 600,
  fontFamily: terminalFonts.sans,
} as const

/** Green text link (#0AA85A, 600, trailing →). */
export const terminalGreenLink = {
  color: terminalColors.greenDeep,
  fontWeight: 600,
} as const

/** Category chip colour map (hook marketplace / badges). */
export const terminalCategoryColors: Record<string, string> = {
  Fees: terminalColors.greenUp,
  Orders: terminalColors.accentIndigo,
  TWAMM: terminalColors.accentIndigo,
  Security: terminalColors.accentPink,
  Yield: terminalColors.accentTeal,
  Governance: terminalColors.accentPurple,
}
