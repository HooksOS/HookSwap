import { LaunchpadExplore } from '~/terminal/screens/launchpad/LaunchpadExplore'
import { TerminalChrome } from '~/terminal/TerminalApp'

export default function TerminalLaunchPage(): JSX.Element {
  return (
    <TerminalChrome activeId="launchpad">
      <LaunchpadExplore />
    </TerminalChrome>
  )
}
