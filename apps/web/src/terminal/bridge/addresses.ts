/**
 * HookSwap Terminal — Bridge constants (Relay.link integration).
 *
 * Cross-chain bridging is powered by the Relay API (https://relay.link,
 * docs https://docs.relay.link). Relay is a request-for-quote bridge/solver
 * network: we ask `/quote` for an executable route, the connected wallet signs
 * the returned deposit transaction(s), and Relay's relayers fill the order on
 * the destination chain. Every value here is a real, verified constant — no
 * placeholders.
 */

/** Relay REST API base. Verified live (GET /chains, POST /quote, GET /intents/status). */
export const RELAY_API_BASE = 'https://api.relay.link'

/**
 * The native-currency sentinel Relay uses for the chain's gas token (ETH, HYPE,
 * etc.). Same zero-address convention as the rest of the app.
 */
export const RELAY_NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * HookSwap treasury / fee-receiver — the canonical recipient for the bridge app
 * fee (see MEMORY: treasury-wallet). Relay auto-collects the app fee to this
 * address (settled in the origin currency per the quote's `fees.app`).
 */
export const HOOKSWAP_TREASURY = '0x011d438E3eb3fce848950859591ec037C6529E13'

/** HookSwap deployer — the Relay app-fee claim wallet (Reggie's choice, 2026-07-23). */
export const HOOKSWAP_DEPLOYER = '0xc14C897c6bff88a5Eeac31F795693b9230205125'

/**
 * The recipient of the HookSwap bridge app fee (Relay `appFees[].recipient`) — i.e. the
 * Relay CLAIM address. Set to the deployer so fees are claimed at relay.link/claim-app-fees
 * by connecting `0xc14C…`. (Change to `HOOKSWAP_TREASURY` to route fees to the treasury instead.)
 */
export const BRIDGE_FEE_RECIPIENT = HOOKSWAP_DEPLOYER

/**
 * The HookSwap app fee, in basis points, added to every bridge quote via Relay's
 * `appFees` request param (`[{ recipient, fee }]`, where `fee` is bps: 100 = 1%).
 * 50 bps = 0.50%. Tune here — it flows through `buildAppFees()` into every quote
 * and is shown transparently in the UI ("HookSwap fee 0.50%").
 *
 * ⚠️ Reggie step: to actually *collect* these fees, the integrator/referrer may
 * need to be registered in the Relay dashboard (https://relay.link, app fees).
 * The param is wired and the fee is quoted/withheld transparently regardless; the
 * dashboard registration only affects payout routing on Relay's side.
 */
export const BRIDGE_APP_FEE_BPS = 50

/** Human-readable fee percentage for the UI, e.g. "0.50%". */
export const BRIDGE_APP_FEE_LABEL = `${(BRIDGE_APP_FEE_BPS / 100).toFixed(2)}%`

/** Relay `appFees` payload for a bridge quote — the HookSwap fee to the treasury. */
export function buildAppFees(): Array<{ recipient: string; fee: string }> {
  return [{ recipient: BRIDGE_FEE_RECIPIENT, fee: String(BRIDGE_APP_FEE_BPS) }]
}
