import { AdminScreen } from '~/terminal/screens/admin/AdminScreen'
import { TerminalChrome } from '~/terminal/TerminalApp'

/**
 * Hidden `/admin` route (served at admin.hookswap.org). NOT in the public nav — an internal
 * operator console. No `activeId` is passed, so no left-rail item is highlighted. The real
 * gate is the treasury Safe: every action requires the multisig's owner signatures.
 */
export default function TerminalAdminPage(): JSX.Element {
  return (
    <TerminalChrome>
      <AdminScreen />
    </TerminalChrome>
  )
}
