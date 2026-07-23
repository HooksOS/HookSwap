import { LaunchCreateScreen } from '~/terminal/screens/LaunchCreateScreen'
import { TerminalChrome } from '~/terminal/TerminalApp'

export default function TerminalLaunchCreatePage(): JSX.Element {
  return (
    <TerminalChrome activeId="launchpad">
      <LaunchCreateScreen />
    </TerminalChrome>
  )
}
