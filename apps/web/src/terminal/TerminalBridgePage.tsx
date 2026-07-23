import { BridgeScreen } from '~/terminal/screens/BridgeScreen'
import { TerminalChrome } from '~/terminal/TerminalApp'

/**
 * `/bridge` — cross-chain bridge (Relay) inside the Terminal shell. Also the
 * standalone entry point for the bridge.hookswap.org subdomain (which redirects
 * `/` → `/bridge`).
 */
export default function TerminalBridgePage(): JSX.Element {
  return (
    <TerminalChrome activeId="bridge">
      <BridgeScreen />
    </TerminalChrome>
  )
}
