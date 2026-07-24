import { NewPositionScreen } from '~/terminal/screens/liquidity/NewPositionScreen'
import { TerminalChrome } from '~/terminal/TerminalApp'

export default function TerminalNewPositionPage(): JSX.Element {
  return (
    <TerminalChrome activeId="create-position">
      <NewPositionScreen />
    </TerminalChrome>
  )
}
