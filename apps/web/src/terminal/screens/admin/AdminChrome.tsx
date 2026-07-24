/**
 * HookSwapPerps — ADMIN CHROME (operator console shell for `/admin`, admin.hookswap.org).
 *
 * A DELIBERATELY DISTINCT shell from the public DEX. Unlike `TerminalChrome` (which wraps
 * the public app in the full DEX TopNav — Trade/Bridge/Markets/Perps/Earn/Tools/Portfolio/Docs
 * — plus the token-feed ticker + gas/block status strip), this chrome renders NONE of that.
 * The operator console gets its own minimal top bar so admin.hookswap.org is visually
 * unmistakable as the internal operator tool, not the trading UI:
 *
 *   • HookSwap hex logo + an "ADMIN" chip in the brand accent + "Operator console" wordmark.
 *   • A "Safe-signed · no keys held" indicator (this console never holds keys / sends owner txs).
 *   • The theme toggle (light/dark) — reuses the app's `useTerminalTheme`.
 *   • The app's real wallet connect (`useAccountDrawer` + the portalled `AccountDrawer`), so
 *     wallets still connect on this route (which bypasses the legacy Header).
 *
 * There is NO public DEX nav, NO ⌘K search, NO chain chip (the perps chain selector lives in
 * the `AdminScreen` body, where the cross-chain reads are wired), and NO ticker / gas-block
 * strip. The console body (`AdminScreen`) is unchanged — this only swaps the surrounding chrome.
 *
 * Theme-aware via `--t-*` / `terminalColors`; IBM Plex Mono for the operator labels; mobile-safe
 * (the bar wraps + respects safe-area insets). Wrapped in `.tm-root` so the Terminal CSS
 * variables + fonts apply to this subtree (same as `TerminalShell`).
 */
import { ReactNode } from 'react'
import { AccountIcon } from 'uniswap/src/features/accounts/AccountIcon'
import { AccountDrawer } from '~/components/AccountDrawer'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { Portal } from '~/components/Popups/Portal'
import { useAccount } from '~/hooks/useAccount'
import { HookLogo } from '~/terminal/components/HookLogo'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import '~/terminal/theme/terminal.css'
import { useTerminalTheme } from '~/terminal/theme/theme' // boot: apply stored/default (dark) theme pre-paint

/** Truncate an address to `0x1234…ABCD`. */
function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Light/dark toggle — mirrors the TopNav sun/moon control, kept local so this chrome is self-contained. */
function ThemeToggle(): JSX.Element {
  const { theme, toggle } = useTerminalTheme()
  return (
    <button
      type="button"
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      onClick={toggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        padding: 0,
        borderRadius: 10,
        border: `1px solid ${terminalColors.line}`,
        background: terminalColors.panel,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {theme === 'dark' ? (
        // Sun — click to go light
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={terminalColors.ink2} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx={12} cy={12} r={4} />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // Moon — click to go dark
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={terminalColors.ink2} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}

/** Wallet connect / connected chip — reuses the app's real AccountDrawer (mounted below in a portal). */
function WalletControl(): JSX.Element {
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  if (account.address) {
    return (
      <button
        type="button"
        onClick={() => accountDrawer.toggle()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          height: 36,
          padding: '0 12px 0 7px',
          borderRadius: 10,
          border: `1px solid ${terminalColors.line}`,
          background: terminalColors.panel,
          fontFamily: terminalFonts.mono,
          fontSize: 12.5,
          fontWeight: 500,
          color: terminalColors.ink,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <AccountIcon address={account.address} size={18} />
        {shortenAddress(account.address)}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => accountDrawer.open()}
      style={{
        height: 36,
        padding: '0 18px',
        borderRadius: 9,
        border: 'none',
        background: terminalColors.brandGreen,
        color: terminalColors.btnInk,
        fontFamily: terminalFonts.mono,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      Connect
    </button>
  )
}

/**
 * The operator-console shell. Renders the minimal admin top bar + the console body,
 * and mounts the app's real wallet drawer (portalled) so connect works on this route.
 */
export function AdminChrome({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      className="tm-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background: terminalColors.bgApp,
        // Clear a standalone-PWA notch / landscape side notch (0 in a normal browser tab).
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* Admin top bar — NOT the DEX TopNav. No public nav / search / ticker / gas strip. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          minHeight: 56,
          boxSizing: 'border-box',
          background: `color-mix(in srgb, ${terminalColors.bg} 90%, transparent)`,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${terminalColors.line}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          rowGap: 8,
          flexWrap: 'wrap',
          padding: '8px var(--tm-gutter)',
          fontFamily: terminalFonts.sans,
        }}
      >
        {/* Brand + ADMIN identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, minWidth: 0 }}>
          <HookLogo size={26} showText={false} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <span
              style={{
                fontFamily: terminalFonts.mono,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: terminalColors.btnInk,
                background: terminalColors.brandGreen,
                padding: '3px 9px',
                borderRadius: 6,
                flexShrink: 0,
              }}
            >
              ADMIN
            </span>
            <span
              style={{
                fontFamily: terminalFonts.mono,
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: '0.04em',
                color: terminalColors.ink2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Operator console
            </span>
          </div>
        </div>

        {/* Right controls — pushed to the end, wrap under the brand on narrow viewports */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
          {/* Safe-signed indicator — this console never holds keys (basic-auth + Safe multisig gate) */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 36,
              padding: '0 11px',
              borderRadius: 999,
              fontFamily: terminalFonts.mono,
              fontSize: 11,
              fontWeight: 600,
              color: terminalColors.greenDeep,
              background: terminalColors.greenBg,
              border: `1px solid ${terminalColors.greenBorder}`,
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: terminalColors.greenDeep, flexShrink: 0 }} />
            Safe-signed · no keys held
          </span>
          <ThemeToggle />
          <WalletControl />
        </div>
      </div>

      {/* Console body — scroll vertically only; clip x so a wide table can't shift the page sideways. */}
      <div style={{ flex: 1, minWidth: 0, overflowX: 'hidden', overflowY: 'auto' }}>{children}</div>

      {/* Real wallet drawer — normally mounted by the legacy Header's Web3Status, which this route bypasses. */}
      <Portal>
        <AccountDrawer />
      </Portal>
    </div>
  )
}
