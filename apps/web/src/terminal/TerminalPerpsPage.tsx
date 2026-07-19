import { PerpsScreen } from '~/terminal/screens/PerpsScreen'
import { TerminalChrome } from '~/terminal/TerminalApp'

export default function TerminalPerpsPage(): JSX.Element {
  return (
    <TerminalChrome activeId="perps">
      <PerpsScreen />
    </TerminalChrome>
  )
}
