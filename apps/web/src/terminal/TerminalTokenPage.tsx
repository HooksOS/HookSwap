import { TokenDetailScreen } from '~/terminal/screens/token/TokenDetailScreen'
import { TerminalChrome } from '~/terminal/TerminalApp'

/**
 * Public, no-wallet, shareable per-token page (`/token/:chainId/:address`).
 *
 * Mirrors `TerminalLockDetailPage` — a thin mount of the shared HookSwap Terminal chrome
 * so a project sharing `hookswap.org/token/<chainId>/<address>` lands a visitor inside the
 * app (and can navigate on from there). The screen reads ONLY public data-api feeds and
 * never requires a connected wallet, so it renders end-to-end for an anonymous visitor.
 *
 * The dynamic `<Helmet>` OG/twitter meta (title "<SYMBOL> · HookSwap", etc.) lives INSIDE
 * `TokenDetailScreen` — same as `LockDetailScreen` — because the symbol is only known once
 * the token resolves from the live feed; the wrapper only has the raw chain id + address.
 */
export default function TerminalTokenPage(): JSX.Element {
  return (
    <TerminalChrome activeId="markets">
      <TokenDetailScreen />
    </TerminalChrome>
  )
}
