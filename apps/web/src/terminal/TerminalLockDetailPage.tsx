import { LockDetailScreen } from '~/terminal/screens/locker/LockDetailScreen'
import { TerminalChrome } from '~/terminal/TerminalApp'

/**
 * Public, no-wallet "proof-of-lock" detail page (`/lock/:chainId/:id`).
 *
 * Wrapped in the shared HookSwap Terminal chrome so a community member opening a
 * shared link lands inside the app (and can navigate on from there). The screen
 * itself reads ONLY the public locker indexer — it never requires a connected
 * wallet, so the page renders end-to-end for an anonymous visitor.
 */
export default function TerminalLockDetailPage(): JSX.Element {
  return (
    <TerminalChrome activeId="locker">
      <LockDetailScreen />
    </TerminalChrome>
  )
}
