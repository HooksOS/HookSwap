import { CreatePerpMarketScreen } from '~/terminal/screens/CreatePerpMarketScreen'
import { TerminalChrome } from '~/terminal/TerminalApp'

export default function TerminalCreatePerpMarketPage(): JSX.Element {
  return (
    <TerminalChrome activeId="create-perp-market">
      <CreatePerpMarketScreen />
    </TerminalChrome>
  )
}
