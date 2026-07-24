import { VestingScheduleDetailScreen } from '~/terminal/screens/vesting/VestingScheduleDetailScreen'
import { TerminalChrome } from '~/terminal/TerminalApp'

/**
 * Public, shareable per-vesting-schedule page (`/vesting/:chainId/:scheduleId`).
 *
 * Mirrors `TerminalFarmDetailPage` / `TerminalLockDetailPage` — a thin mount of the shared
 * HookSwap Terminal chrome so a project sharing `hookswap.org/vesting/<chainId>/<id>` lands a
 * visitor inside the app. The screen reads its core figures + metadata on-chain (no wallet
 * required) and layers the priced USD value from the indexer; the wallet-gated Release action
 * activates once the beneficiary connects on the schedule's chain.
 *
 * The dynamic `<Helmet>` OG/twitter meta lives INSIDE `VestingScheduleDetailScreen` — same as
 * the token / lock / farm pages — because the token symbol is only known once the schedule
 * resolves.
 */
export default function TerminalVestingDetailPage(): JSX.Element {
  return (
    <TerminalChrome activeId="vesting">
      <VestingScheduleDetailScreen />
    </TerminalChrome>
  )
}
