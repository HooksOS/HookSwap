/**
 * HookSwap Terminal — shared "Ledger" hue avatar (with real-logo overlay).
 *
 * A deterministic circular token/pair avatar whose hue is derived from a seed string
 * (address / pair key), used by the Locker / Farms / Vesting / LaunchPad Ledger rows so
 * identical seeds render an identical colour across views. Purely presentational.
 *
 * When a real token logo is known (via `logoUrl`), it renders an `<img>` OVER the hue
 * avatar and transparently FALLS BACK to the initials-hue avatar if the image is missing
 * or fails to load (`onError`). Recognized tokens (WETH, USDG, ETH, USDC/USDT0, …) get a
 * real logo; custom/unlisted tokens (HOOK, HSTT, STK, TST, …) honestly fall back to the
 * hue avatar — never a fabricated or wrong image.
 */
import { useState } from 'react'
import { getCommonBase } from 'uniswap/src/constants/routing'
import { terminalFonts } from '~/terminal/theme/tokens'

/** Deterministic legible avatar colour from a seed string (stable hue). */
export function ledgerAvatarColor(seed: string): string {
  let h = 0
  const s = (seed || '').toLowerCase()
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 360
  }
  return `hsl(${h}, 52%, 42%)`
}

/**
 * Resolve a REAL token logo URL for `(chainId, address)` from the app's static
 * common-base token lists (`getCommonBase`) — a synchronous, network-free lookup.
 * Returns `undefined` for unrecognized/custom tokens (→ hue-avatar fallback). Never
 * fabricates a logo. Only tokens present in the app's own token lists resolve.
 */
export function resolveLedgerLogo(chainId: number | undefined, address: string | undefined): string | undefined {
  if (!chainId || !address) {
    return undefined
  }
  const logo = getCommonBase(chainId, address)?.logoUrl
  return typeof logo === 'string' && logo.length > 0 ? logo : undefined
}

export function LedgerAvatar({
  seed,
  initials,
  size = 34,
  logoUrl,
}: {
  seed: string
  initials: string
  size?: number
  /** Optional real token logo. Falls back to the hue avatar if missing / on error. */
  logoUrl?: string
}): JSX.Element {
  const [imgFailed, setImgFailed] = useState(false)
  const showImg = Boolean(logoUrl) && !imgFailed

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: ledgerAvatarColor(seed),
        color: '#fff',
        fontFamily: terminalFonts.mono,
        fontSize: Math.max(10, Math.round(size * 0.35)),
        fontWeight: 600,
        letterSpacing: '-0.02em',
      }}
    >
      {/* Hue + initials base — always present so it shows through on load / error. */}
      {initials}
      {showImg ? (
        <img
          src={logoUrl}
          alt=""
          onError={() => setImgFailed(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '50%',
            background: '#fff',
          }}
        />
      ) : null}
    </div>
  )
}
