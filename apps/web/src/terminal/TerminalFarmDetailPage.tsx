import { FarmDetailScreen } from '~/terminal/screens/farms/FarmDetailScreen'
import { TerminalChrome } from '~/terminal/TerminalApp'

/**
 * Public, shareable per-farm page (`/farm/:chainId/:farmId`).
 *
 * Mirrors `TerminalTokenPage` / `TerminalLockDetailPage` — a thin mount of the shared
 * HookSwap Terminal chrome so a project sharing `hookswap.org/farm/<chainId>/<address>`
 * lands a visitor inside the app. The screen reads its core stats + metadata on-chain
 * (no wallet required) and layers priced TVL/APR from the indexer; wallet-gated
 * stake / claim / unstake actions activate once a wallet connects on the farm's chain.
 *
 * The dynamic `<Helmet>` OG/twitter meta lives INSIDE `FarmDetailScreen` — same as the
 * token / lock pages — because the token symbols are only known once the farm resolves.
 */
export default function TerminalFarmDetailPage(): JSX.Element {
  return (
    <TerminalChrome activeId="farms">
      <FarmDetailScreen />
    </TerminalChrome>
  )
}
