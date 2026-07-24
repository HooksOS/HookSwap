import { useNavigate } from 'react-router'
import { AccountDrawer } from '~/components/AccountDrawer'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { Portal } from '~/components/Popups/Portal'
import { useAccount } from '~/hooks/useAccount'
import { HookLogo } from '~/terminal/components/HookLogo'
import { BridgeScreen } from '~/terminal/screens/BridgeScreen'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const SANS = terminalFonts.sans
const MONO = terminalFonts.mono
const DISPLAY = terminalFonts.display

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/* ------------------------------------------------------------- connect chip */

function ConnectButton(): JSX.Element {
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  const connected = Boolean(account.address)

  if (connected) {
    return (
      <button
        type="button"
        onClick={() => accountDrawer.toggle()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 40,
          background: terminalColors.bg,
          border: `1px solid ${terminalColors.line}`,
          borderRadius: 10,
          padding: '0 12px',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: terminalColors.greenUp,
            boxShadow: `0 0 0 3px ${terminalColors.greenBg}`,
            flexShrink: 0,
          }}
        />
        <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: terminalColors.ink }}>
          {shortenAddress(account.address as string)}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => accountDrawer.open()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 40,
        padding: '0 18px',
        background: terminalColors.brandGreen,
        border: 'none',
        borderRadius: 10,
        cursor: 'pointer',
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: terminalColors.btnInk }}>Connect</span>
    </button>
  )
}

/* --------------------------------------------------------------------- page */

/**
 * `/bridge` — HookSwap Bridge (cross-chain, solved by Relay).
 *
 * This is ALSO the standalone entry point for the `bridge.hookswap.org` subdomain
 * (which redirects `/` → `/bridge`). Rather than the full trading Terminal rail,
 * it renders a focused, self-contained HookSwap-branded chrome — header (logo +
 * "Bridge" wordmark + compact connect) and footer — so the subdomain reads as a
 * first-class HookSwap product, not a bare embedded widget. Mirrors the standalone
 * LandingScreen pattern (owns its own AccountDrawer portal). Theme = DAYSIGNAL
 * light (terminalColors/terminalFonts); IBM Plex Mono for numbers/addresses.
 */
export default function TerminalBridgePage(): JSX.Element {
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100vh', background: terminalColors.bgApp, fontFamily: SANS }}>
      {/* Standalone HookSwap-branded header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          height: 64,
          boxSizing: 'border-box',
          // DAYSIGNAL sticky translucent header: paper (bgApp) at ~82% alpha + blur.
          // color-mix keeps the alpha theme-aware (bgApp is now a var(--t-*) ref).
          background: `color-mix(in srgb, ${terminalColors.bgApp} 82%, transparent)`,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${terminalColors.line}`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 22px',
        }}
      >
        {/* Logo → HookSwap home */}
        <span
          role="link"
          tabIndex={0}
          aria-label="HookSwap home"
          title="HookSwap"
          onClick={() => navigate('/')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              navigate('/')
            }
          }}
          style={{ cursor: 'pointer', display: 'inline-flex', flexShrink: 0 }}
        >
          <HookLogo size={26} textSize="18px" />
        </span>

        {/* "Bridge" product wordmark */}
        <span style={{ width: 1, height: 22, background: terminalColors.line, flexShrink: 0 }} aria-hidden />
        <span
          style={{
            fontFamily: DISPLAY,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: terminalColors.ink2,
            flexShrink: 0,
          }}
        >
          Bridge
        </span>

        {/* Compact connect */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <ConnectButton />
        </div>
      </header>

      {/* The bridge itself (functionality unchanged) */}
      <main>
        <BridgeScreen />
      </main>

      {/* Standalone page footer — HookSwap identity + subtle Relay attribution */}
      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '18px 22px 32px',
          flexWrap: 'wrap',
        }}
      >
        <HookLogo size={16} textSize="12px" />
        <span style={{ color: terminalColors.line, fontSize: 12 }} aria-hidden>
          ·
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.faint }}>
          Cross-chain bridge · Powered by{' '}
          <a
            href="https://relay.link"
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: terminalColors.ink3, textDecoration: 'none', fontWeight: 600 }}
          >
            Relay
          </a>
        </span>
      </footer>

      {/* Self-hosted chrome bits (normally provided by TerminalChrome) so the
          standalone Connect button opens the real wallet drawer. */}
      <Portal>
        <AccountDrawer />
      </Portal>
    </div>
  )
}
