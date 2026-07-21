import { LaunchDetailScreen } from '~/terminal/screens/launchpad/LaunchDetailScreen'
import { TerminalChrome } from '~/terminal/TerminalApp'

/**
 * Public, no-wallet shareable launch page (`/launch/:chainId/:token`).
 *
 * Wrapped in the shared HookSwap Terminal chrome so a community member opening a
 * shared link lands inside the app (and can navigate on from there). The screen
 * itself reads ONLY the public launchpad indexer — it never requires a connected
 * wallet, so the page renders end-to-end for an anonymous visitor.
 */
export default function TerminalLaunchDetailPage(): JSX.Element {
  return (
    <TerminalChrome activeId="launchpad">
      <LaunchDetailScreen />
    </TerminalChrome>
  )
}
