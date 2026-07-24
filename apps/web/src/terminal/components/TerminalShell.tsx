import { ReactNode, useState } from 'react'
import { BottomTabBar, BOTTOM_TAB_BAR_HEIGHT } from '~/terminal/components/BottomTabBar'
import { LeftRail, LeftRailProps } from '~/terminal/components/LeftRail'
import { TopBar, TopBarProps } from '~/terminal/components/TopBar'
import { TopNav } from '~/terminal/components/TopNav'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import '~/terminal/theme/terminal.css'
import { useTerminalTheme } from '~/terminal/theme/theme' // boot: apply stored/default (dark) theme pre-paint

export interface TerminalShellProps {
  /** Navigation configuration (active screen, nav handler, live wallet stats). */
  rail: LeftRailProps
  /** Top-bar configuration (search, gas, chain, wallet, per-screen actions). */
  topBar: TopBarProps
  /** Optional band directly under the top nav (e.g. B1 market ticker strip). */
  subBar?: ReactNode
  /** Screen body. */
  children: ReactNode
}

/**
 * Terminal app shell.
 *
 * • Desktop (≥ 900px): a full-width 64px TOP navigation bar (TopNav) over a
 *   scrollable, full-width content region — matched to the marketing landing
 *   header (logo, Trade/Markets/Earn/Portfolio/Docs, ⌘K search, chain chip,
 *   green Connect).
 * • Mobile (< 900px): a compact TopBar (hamburger) + a fixed bottom tab bar
 *   (Swap · Markets · Pools · Portfolio · More); "More" opens the full nav as a
 *   left slide-in drawer (LeftRail reused). Content goes full-width and is
 *   bottom-padded to clear the tab bar + iOS home indicator. Breakpoint via
 *   `useIsMobileViewport` so the desktop layout is untouched.
 *
 * Wrapped in `.tm-root` so Terminal CSS variables + fonts apply only inside this subtree.
 */
export function TerminalShell({ rail, topBar, subBar, children }: TerminalShellProps): JSX.Element {
  const isMobile = useIsMobileViewport()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Theme toggle is in the desktop TopNav; on mobile it lives at the foot of the nav drawer.
  const { theme, toggle } = useTerminalTheme()

  if (isMobile) {
    // In the mobile drawer, tapping a nav item navigates AND closes the drawer.
    const drawerRail: LeftRailProps = {
      ...rail,
      onNavigate: (path, id) => {
        setDrawerOpen(false)
        rail.onNavigate?.(path, id)
      },
    }

    return (
      <div
        className="tm-root"
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          background: terminalColors.bgApp,
          // Clear the notch / status bar in a standalone PWA so the TopBar isn't hidden
          // under it (0 in a normal browser tab). Side insets protect the top chrome +
          // in-flow content from a landscape notch; the fixed bottom bar handles its own.
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }}
      >
        <TopBar {...topBar} isMobile onMenuClick={() => setDrawerOpen(true)} />
        {subBar}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            // Scroll vertically only. Clip the x-axis so a single over-wide child (e.g. a dense
            // table/chart) can NEVER widen the page and cause the whole layout to scroll/shift
            // sideways (that was the "content cut off on the left" bug). Wide tables keep their OWN
            // internal horizontal scroll (DataTable), so nothing legitimate is clipped.
            overflowX: 'hidden',
            overflowY: 'auto',
            // Clear the fixed bottom tab bar + the iPhone home indicator.
            paddingBottom: `calc(${BOTTOM_TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
          }}
        >
          {children}
        </div>

        <BottomTabBar
          activeId={rail.activeId}
          onNavigate={rail.onNavigate}
          onMore={() => setDrawerOpen(true)}
          moreActive={drawerOpen}
        />

        {drawerOpen ? (
          <>
            <div
              onClick={() => setDrawerOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(11,15,20,.4)', zIndex: 50 }}
            />
            <div
              style={{
                position: 'fixed',
                top: 0,
                bottom: 0,
                left: 0,
                width: 262,
                maxWidth: '84vw',
                zIndex: 51,
                overflowY: 'auto',
                background: terminalColors.bg,
                boxShadow: '2px 0 28px -6px rgba(11,15,20,.28)',
                // The drawer is `position: fixed`, so the root's safe-area padding doesn't
                // reach it — inset it from the notch/status bar (top) and a landscape
                // left-notch (left) itself so its nav never hides under either.
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingLeft: 'env(safe-area-inset-left, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              }}
            >
              <LeftRail {...drawerRail} collapsed={false} hideCollapseToggle />
              {/* Theme toggle — the desktop TopNav's sun/moon isn't rendered on mobile, so surface it here. */}
              <button
                type="button"
                onClick={toggle}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: 'calc(100% - 24px)',
                  margin: '8px 12px 16px',
                  padding: '11px 14px',
                  background: terminalColors.bg,
                  border: `1px solid ${terminalColors.line}`,
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontFamily: terminalFonts.sans,
                  fontSize: 13,
                  fontWeight: 600,
                  color: terminalColors.ink2,
                }}
              >
                <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>{theme === 'dark' ? '☀️' : '🌙'}</span>
                {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className="tm-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background: terminalColors.bgApp,
      }}
    >
      <TopNav
        activeId={rail.activeId}
        onNavigate={rail.onNavigate}
        searchPlaceholder={topBar.searchPlaceholder}
        onSearchClick={topBar.onSearchClick}
        chain={topBar.chain}
        onChainClick={topBar.onChainClick}
        wallet={topBar.wallet}
        onConnectWallet={topBar.onConnectWallet}
        onWalletClick={topBar.onWalletClick}
        actions={topBar.actions}
      />
      {subBar}
      {/* Scroll vertically only; clip x so no over-wide child can shift/scroll the whole page sideways. */}
      <div style={{ flex: 1, minWidth: 0, overflowX: 'hidden', overflowY: 'auto' }}>{children}</div>
    </div>
  )
}
