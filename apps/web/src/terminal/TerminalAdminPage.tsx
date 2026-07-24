import { AdminChrome } from '~/terminal/screens/admin/AdminChrome'
import { AdminScreen } from '~/terminal/screens/admin/AdminScreen'

/**
 * Hidden `/admin` route (served at admin.hookswap.org). NOT in the public nav — an internal
 * operator console. It gets its OWN chrome (`AdminChrome`) — a minimal admin top bar — instead
 * of the public DEX `TerminalChrome`, so admin.hookswap.org is visually distinct from the DEX
 * (no public nav, no token-feed ticker / gas-block strip). App.tsx keeps `/admin` in its
 * `isTerminalLayoutPath` list, so it is NOT double-wrapped in a second layout — `AdminChrome`
 * is the sole chrome here. The real gate is the treasury Safe: every action requires the
 * multisig's owner signatures.
 */
export default function TerminalAdminPage(): JSX.Element {
  return (
    <AdminChrome>
      <AdminScreen />
    </AdminChrome>
  )
}
