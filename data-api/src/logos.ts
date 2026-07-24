/**
 * Token logo resolution for the HookSwap data-api.
 *
 * A robust, tiered resolver (highest priority first — see `resolveTokenLogo`). Every tier is HONEST:
 * a token only gets a logo we're confident maps to it, and a wrong/missing URL degrades to the
 * frontend's monogram fallback (verified: universe `TokenLogo`→`UniversalImage` renders the initials
 * `fallback` on img error; Terminal `LedgerAvatar` `<img onError>` → hue+initials; SwapScreen's CSS
 * `background-image` shows the panel colour, never a broken-image icon). So a best-effort CDN URL that
 * 404s never shows a broken image.
 *
 *   1. CURATED_LOGOS — verified logo URLs for every canonical token HookSwap uses, keyed by
 *      `${chainId}:${addressLower}` (chain-scoped). Highest priority so these never change out from under us.
 *   2. Symbol-family fallback — for a wrapped/bridged/variant token WITHOUT a curated address entry, map
 *      its SYMBOL to a canonical family logo (USDT0/USD₮0/WgUSDT → USDT, bridged USDC → USDC, WHYPE → HYPE,
 *      WOKB → OKB, WBTC → BTC, HOOK/tHOOK/HKT → HookSwap glyph, …). Small closed set of well-known families
 *      so a token can't accidentally borrow the wrong brand.
 *   3. Launchpad metadataURI — for tokens minted by the HookOSV3Launcher (fair-launch tokens), the launcher
 *      stores a per-token `metadataURI` on-chain. We read it live, resolve that URI to an image URL, and use
 *      it. This is what makes a freshly-launched token show an icon without any manual registry entry.
 *   4. External CDN by (chain, address) — best-effort Trust Wallet asset URL for arbitrary tokens on chains
 *      Trust Wallet actually indexes (ethereum/bsc/polygon/…). NONE of HookSwap's custom chains have a Trust
 *      Wallet slug, so this tier is currently inert for the live set — future-proofing only.
 *   5. (frontend) Deterministic branded monogram — when no logo exists anywhere, the frontend renders its
 *      consistent initials circle. The only honest option for a brand-new token with no logo.
 *
 * NEVER FABRICATE: a token with no curated entry, no symbol-family match, no launchpad metadataURI, and no
 * external CDN slug gets NO logo (undefined) — an honest "no icon" the frontend turns into a monogram.
 *
 * NON-BLOCKING: `resolveTokenLogo` / `getLaunchpadLogo` are SYNCHRONOUS. Tiers 1/2/4 are pure lookups; the
 * launchpad tier (3) returns `undefined` immediately on a cache miss and kicks off the on-chain read + URI
 * fetch in the BACKGROUND, so a handler response never waits on the network. The next request for that token
 * (after resolution completes) returns the resolved logo from cache. Terminal outcomes (including "no logo")
 * are cached; only a transient RPC error reading the metadataURI is left uncached so it can retry later.
 */

import { ethers } from 'ethers'
import { getProvider } from './onchain'

/* ----------------------------------------------------------------------------------------------------
 * Verified canonical logo URLs. Every URL below returned HTTP 200 (Trust Wallet raw assets / CoinGecko
 * coin-images), checked 2026-07-24. Trust Wallet raw + CoinGecko coin-images are stable, hotlink-friendly
 * CDNs. NEVER point at a URL we haven't confirmed resolves.
 * -------------------------------------------------------------------------------------------------- */
/** Ether (used for every chain's WETH). */
const ETH_LOGO = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png'
/** Circle USD Coin — also the generic USD-stablecoin glyph for dollar stables with no distinct brand asset. */
const USDC_LOGO =
  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png'
/** Tether USD — used for USDT and its wrapped/bridged/gas variants (USDT0 / USD₮0 / WgUSDT / gUSDT). */
const USDT_LOGO =
  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png'
/** Wrapped BTC — used for BTC/WBTC/cbBTC/BTCB families. */
const WBTC_LOGO =
  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png'
/** OKB (OKX) — XLayer's native/wrapped-native. */
const OKB_LOGO = 'https://coin-images.coingecko.com/coins/images/4463/large/WeChat_Image_20220118095654.png'
/** HYPE (Hyperliquid) — HyperEVM's native/wrapped-native. */
const HYPE_LOGO = 'https://coin-images.coingecko.com/coins/images/50882/large/hyperliquid.jpg'
/** USDG (Global Dollar / Paxos) — Robinhood's stablecoin anchor. (Corrects the prior /41172/ URL, which 403s.) */
const USDG_LOGO = 'https://coin-images.coingecko.com/coins/images/51281/large/GDN_USDG_Token_200x200.png'
/** HookSwap glyph — HookSwap ecosystem tokens (HOOK / tHOOK / HKT). */
const HOOK_LOGO = 'https://hookswap.org/brand/glyph-mark.png'

/* ----------------------------------------------------------------------------------------------------
 * Tier 1 — CURATED_LOGOS: verified logo per canonical token, keyed by `${chainId}:${addressLower}`.
 * Chain-scoped so an address that repeats across chains with a different meaning can't collide. Addresses
 * sourced from data-api/src/chains.ts (wrappedNative + stablecoin) + contracts/deployments/pools-seeded.json.
 * -------------------------------------------------------------------------------------------------- */
const CURATED_LOGOS: Record<string, string> = {
  // Robinhood (4663)
  '4663:0x0bd7d308f8e1639fab988df18a8011f41eacad73': ETH_LOGO, // WETH (Robinhood wrapped-native)
  '4663:0x3b5a01efc59f3465b8eb04697f97cfe0ba700d9d': HOOK_LOGO, // tHOOK (Robinhood HookSwap test token)
  '4663:0x5fc5360d0400a0fd4f2af552add042d716f1d168': USDG_LOGO, // USDG / Global Dollar (Robinhood stablecoin anchor)

  // MegaETH (4326)
  '4326:0x4200000000000000000000000000000000000006': ETH_LOGO, // WETH (MegaETH wrapped-native)
  '4326:0xfafddbb3fc7688494971a79cc65dca3ef82079e7': USDC_LOGO, // USDm (MegaETH dollar stable — generic USD glyph, no distinct USDm brand asset)

  // Ink (57073)
  '57073:0x4200000000000000000000000000000000000006': ETH_LOGO, // WETH (Ink wrapped-native)
  '57073:0x0200c29006150606b650577bbe7b6248f58470c1': USDT_LOGO, // USD₮0 / canonical USDT0 (Ink stablecoin, Tether-style)

  // XLayer (196)
  '196:0xe538905cf8410324e03a5a23c1c177a474d59b2b': OKB_LOGO, // WOKB (XLayer wrapped-native)
  '196:0x0e88a920a522d2e858b5fb0e896f228f4619e0a6': HOOK_LOGO, // HKT (XLayer HookSwap ecosystem token, factory pair[0])
  '196:0x144331bb4c3026d135896cafec3ae3d667f4f376': HOOK_LOGO, // HKT (XLayer HookSwap seed test token, factory pair[1])

  // HyperEVM (999)
  '999:0x5555555555555555555555555555555555555555': HYPE_LOGO, // WHYPE (HyperEVM wrapped-native)
  '999:0xb88339cb7199b77e23db6e890353e22632ba630f': USDC_LOGO, // USDC (HyperEVM real USDC stablecoin)

  // Stable (988)
  '988:0x817997ca8394e26cce3de3a076a4889b27dbf9de': USDT_LOGO, // WgUSDT / Wrapped gasUSDT (Stable wrapped-native, USDT variant)
  '988:0x779ded0c9e1022225f8e0630b35a9b54be713736': USDT_LOGO, // USDT0 (Stable stablecoin)

  // Sepolia (11155111)
  '11155111:0xfff9976782d46cc05630d1f6ebab18b2324d6b14': ETH_LOGO, // WETH (Sepolia wrapped-native)
}

/** Curated logo for a token, chain-scoped. undefined when not curated. */
function curatedLogo(chainId: number, address: string): string | undefined {
  return address ? CURATED_LOGOS[`${chainId}:${address.toLowerCase()}`] : undefined
}

/* ----------------------------------------------------------------------------------------------------
 * Tier 2 — Symbol-family fallback. For a wrapped/bridged/variant token with no curated entry, map its
 * SYMBOL to a canonical family logo. Keys are ALREADY-NORMALIZED symbols (see normalizeSymbol). Kept to a
 * small, closed set of well-known families so a token can never accidentally borrow an unrelated brand.
 * -------------------------------------------------------------------------------------------------- */
const SYMBOL_FAMILY_LOGOS: Record<string, string> = {
  // Ether family (native + wrapped).
  ETH: ETH_LOGO,
  WETH: ETH_LOGO,
  BETH: ETH_LOGO,
  // Tether family — USDT and its wrapped/bridged/gas variants (USD₮0 normalizes to USDT0; WgUSDT → WGUSDT; gUSDT → GUSDT).
  USDT: USDT_LOGO,
  USDT0: USDT_LOGO,
  WGUSDT: USDT_LOGO,
  GUSDT: USDT_LOGO,
  USDTE: USDT_LOGO,
  // USD Coin family — USDC and bridged variants.
  USDC: USDC_LOGO,
  USDCE: USDC_LOGO,
  USDBC: USDC_LOGO,
  // Other dollar stables — USDG has its own asset; USDm shares the generic USD glyph (no distinct brand asset).
  USDG: USDG_LOGO,
  USDM: USDC_LOGO,
  // Hyperliquid family.
  HYPE: HYPE_LOGO,
  WHYPE: HYPE_LOGO,
  // OKB family.
  OKB: OKB_LOGO,
  WOKB: OKB_LOGO,
  // Bitcoin family.
  BTC: WBTC_LOGO,
  WBTC: WBTC_LOGO,
  BTCB: WBTC_LOGO,
  CBBTC: WBTC_LOGO,
  // HookSwap ecosystem tokens.
  HOOK: HOOK_LOGO,
  THOOK: HOOK_LOGO,
  HKT: HOOK_LOGO,
}

/** Normalize a symbol to a family key: uppercase, ₮→T (USD₮0→USDT0), strip non-alphanumerics (WgUSDT→WGUSDT). */
function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/₮/g, 'T').replace(/[^A-Z0-9]/g, '')
}

/** Canonical family logo for a token symbol, or undefined when the symbol matches no known family. */
function symbolFamilyLogo(symbol: string | undefined): string | undefined {
  if (!symbol) {
    return undefined
  }
  return SYMBOL_FAMILY_LOGOS[normalizeSymbol(symbol)]
}

/* ----------------------------------------------------------------------------------------------------
 * Tier 4 — External CDN (Trust Wallet assets) by (chain, checksummed address). Trust Wallet only indexes
 * chains it has a slug for; NONE of HookSwap's custom chains (Robinhood/MegaETH/Ink/XLayer/HyperEVM/Stable/
 * Tempo/Sepolia) have one, so this tier returns undefined for the entire live chain set today — it exists
 * purely so an arbitrary token on a Trust-Wallet-indexed chain (Ethereum/BSC/Polygon/…) would resolve if
 * HookSwap ever serves one. Best-effort: a missing asset 404s → the frontend's onError → monogram fallback
 * (verified present) handles it, never a broken image.
 * -------------------------------------------------------------------------------------------------- */
const TRUSTWALLET_CHAIN_SLUGS: Record<number, string> = {
  1: 'ethereum',
  56: 'smartchain',
  137: 'polygon',
  43114: 'avalanchec',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  250: 'fantom',
  25: 'cronos',
}

/** Best-effort Trust Wallet asset URL for (chain, address); undefined when the chain has no TW slug or the address is invalid. */
function trustWalletLogo(chainId: number, address: string): string | undefined {
  const slug = TRUSTWALLET_CHAIN_SLUGS[chainId]
  if (!slug || !address) {
    return undefined
  }
  let checksummed: string
  try {
    // Trust Wallet asset folders are keyed by the EIP-55 checksummed address.
    checksummed = ethers.utils.getAddress(address)
  } catch {
    return undefined // not a valid address → never guess a URL
  }
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${slug}/assets/${checksummed}/logo.png`
}

/**
 * Deployed `HookOSV3Launcher` proxy address per chain (mirrors
 * apps/web/src/terminal/launchpad/addresses.ts). Only chains listed here get launchpad logo resolution;
 * every other chain resolves to no launchpad logo with zero RPC. Robinhood (4663) is the only deployment.
 */
const LAUNCHER_ADDRESSES: Record<number, string> = {
  4663: '0x9B8d992704ddf38729535A641502bcc55734e0B8',
}

/**
 * Minimal `HookOSV3Launcher` ABI — only the two views used to read a token's launch metadataURI.
 * `isHookOSV3Token` is a cheap bool guard (won't revert for a non-launch token), so we can distinguish a
 * deterministic "not a launch → no logo" from a transient RPC error; `getLaunchByToken` returns the launch
 * struct whose `metadataURI` field we read. (Full ABI: apps/web/src/terminal/launchpad/abis.ts.)
 */
const LAUNCHER_ABI = [
  'function isHookOSV3Token(address) view returns (bool)',
  'function getLaunchByToken(address token) view returns (address token, address pool, address creator, uint256 tokenId, uint24 feeTier, uint8 dex, address locker, uint8 pair, address pairToken, string metadataURI, uint256 createdAt)',
]

/** HTTP fetch budget for a metadataURI (and any nested image URL). Mirrors onchain.ts' 8s RPC cap intent
 *  — short enough that a slow/dead URI can't stall a handler; resolution runs in the background regardless. */
const FETCH_TIMEOUT_MS = 5_000

/** Public IPFS gateway for `ipfs://` normalization. */
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'

/** Path looks like a direct image (extension, ignoring any query/fragment). */
const IMAGE_EXT_RE = /\.(png|jpe?g|svg|gif|webp)(?:[?#].*)?$/i
/** Path looks like a JSON metadata document. */
const JSON_EXT_RE = /\.json(?:[?#].*)?$/i

interface CacheEntry {
  /** the launch metadataURI this entry resolved from ('' when the token has none / isn't a launch). */
  metadataURI: string
  /** resolved image URL, or undefined for an honest "no logo". */
  logoUrl?: string
  /** socials/description parsed from a JSON metadataURI, or undefined when none were present. */
  socials?: TokenSocials
}

/** Resolved (terminal) results keyed by `${chainId}:${addressLower}`. Also the "already resolved" marker. */
const cache = new Map<string, CacheEntry>()
/** Keys with a background resolve in flight — dedupes concurrent resolves for the same token. */
const inFlight = new Set<string>()

/** ipfs:// (and ipfs://ipfs/) → a public gateway URL; otherwise returned trimmed unchanged. */
function normalizeUri(uri: string): string {
  const t = uri.trim()
  if (/^ipfs:\/\//i.test(t)) {
    let cid = t.replace(/^ipfs:\/\//i, '')
    cid = cid.replace(/^ipfs\//i, '')
    return `${IPFS_GATEWAY}${cid}`
  }
  return t
}

/** Extract an image URL from a parsed metadata JSON's `image` / `logo` / `image_url` field (normalized). */
function imageFromJson(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') {
    return undefined
  }
  const obj = json as Record<string, unknown>
  const candidate = obj.image ?? obj.logo ?? obj.image_url
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    return undefined
  }
  const normalized = normalizeUri(candidate)
  return /^https?:\/\//i.test(normalized) ? normalized : undefined
}

/** Social / description fields captured from a token's metadata JSON — every field optional, never fabricated. */
export interface TokenSocials {
  description?: string
  twitter?: string
  website?: string
  telegram?: string
}

/** A first non-empty string among the given keys of a metadata JSON object, trimmed. */
function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim() !== '') {
      return v.trim()
    }
  }
  return undefined
}

/** Normalize a social handle/URL to a full https URL for the given platform, or undefined if unusable. */
function normalizeSocial(raw: string | undefined, base: string): string | undefined {
  if (!raw) {
    return undefined
  }
  const t = raw.trim()
  if (/^https?:\/\//i.test(t)) {
    return t
  }
  // Bare handle (`@name` or `name`) → platform URL.
  const handle = t.replace(/^@/, '')
  if (!handle || /\s/.test(handle)) {
    return undefined
  }
  return `${base}${handle}`
}

/**
 * Extract socials/description from a parsed metadata JSON. Accepts both flat fields
 * (`twitter`, `website`, `description`) and a nested `{ links: {...} }` / `{ socials: {...} }` object,
 * the common shapes token metadata JSONs use. Missing fields stay undefined — never invented.
 */
function socialsFromJson(json: unknown): TokenSocials | undefined {
  if (!json || typeof json !== 'object') {
    return undefined
  }
  const obj = json as Record<string, unknown>
  const nested =
    (obj.links && typeof obj.links === 'object' ? (obj.links as Record<string, unknown>) : undefined) ??
    (obj.socials && typeof obj.socials === 'object' ? (obj.socials as Record<string, unknown>) : undefined)
  const src: Record<string, unknown> = nested ? { ...obj, ...nested } : obj

  const website = normalizeSocial(pickString(src, ['website', 'url', 'homepage', 'external_url']), 'https://')
  const twitter = normalizeSocial(pickString(src, ['twitter', 'x', 'twitter_url']), 'https://x.com/')
  const telegram = normalizeSocial(pickString(src, ['telegram', 'tg', 'telegram_url']), 'https://t.me/')
  const description = pickString(src, ['description', 'about'])

  if (!website && !twitter && !telegram && !description) {
    return undefined
  }
  return { description, twitter, website, telegram }
}

/** fetch() with a hard timeout so a slow URI can't hang the background resolve. */
async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve a launch metadataURI to an image URL, per the rules:
 *   - normalize ipfs:// → gateway; only http(s) URIs are usable.
 *   - direct image (image extension) → use the URI itself (no fetch).
 *   - otherwise fetch once: content-type image/* → use the URI; JSON (by extension or content-type) →
 *     parse and take image/logo/image_url.
 *   - anything else / any failure → undefined (no logo). Never throws for a "not an image" outcome; a
 *     network/parse error propagates to the caller, which logs + caches no-logo.
 */
async function resolveUriToLogo(rawUri: string): Promise<{ logoUrl?: string; socials?: TokenSocials }> {
  const uri = normalizeUri(rawUri)
  if (!/^https?:\/\//i.test(uri)) {
    return {}
  }
  if (IMAGE_EXT_RE.test(uri)) {
    return { logoUrl: uri }
  }
  const res = await fetchWithTimeout(uri)
  if (!res.ok) {
    return {}
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  if (contentType.startsWith('image/')) {
    return { logoUrl: uri }
  }
  const looksJson =
    JSON_EXT_RE.test(uri) ||
    contentType.includes('application/json') ||
    contentType.includes('+json') ||
    contentType.includes('text/json')
  if (looksJson) {
    const json = (await res.json()) as unknown
    // A full metadata JSON carries both the image and (optionally) socials/description.
    return { logoUrl: imageFromJson(json), socials: socialsFromJson(json) }
  }
  return {}
}

/** Live read of a token's launch metadataURI. Returns '' for a non-launch token; throws on RPC error. */
async function readMetadataURI(chainId: number, launcher: string, token: string): Promise<string> {
  const contract = new ethers.Contract(launcher, LAUNCHER_ABI, getProvider(chainId))
  const isLaunch: boolean = await contract.isHookOSV3Token(token)
  if (!isLaunch) {
    return ''
  }
  const launch = await contract.getLaunchByToken(token)
  const uri = launch?.metadataURI
  return typeof uri === 'string' ? uri.trim() : ''
}

/** Background: read metadataURI + resolve to a logo, then cache the terminal result. Never throws. */
async function resolveInBackground(chainId: number, launcher: string, token: string, key: string): Promise<void> {
  if (inFlight.has(key)) {
    return
  }
  inFlight.add(key)
  try {
    const metadataURI = await readMetadataURI(chainId, launcher, token)
    if (!metadataURI) {
      // Deterministic: not a launch, or a launch with no metadataURI → honest no-logo, cache it.
      cache.set(key, { metadataURI: '' })
      return
    }
    let logoUrl: string | undefined
    let socials: TokenSocials | undefined
    try {
      const resolved = await resolveUriToLogo(metadataURI)
      logoUrl = resolved.logoUrl
      socials = resolved.socials
    } catch (e) {
      // URI fetch/parse failure — honest no-logo (still a terminal outcome for this immutable URI).
      // eslint-disable-next-line no-console
      console.warn(`[data-api] logo: failed to resolve metadataURI for ${token} on ${chainId}: ${(e as Error).message}`)
      logoUrl = undefined
    }
    cache.set(key, { metadataURI, logoUrl, socials })
  } catch (e) {
    // RPC error reading the metadataURI — transient; do NOT cache so a later request can retry.
    // eslint-disable-next-line no-console
    console.warn(`[data-api] logo: failed to read launch metadataURI for ${token} on ${chainId}: ${(e as Error).message}`)
  } finally {
    inFlight.delete(key)
  }
}

/**
 * Launchpad logo for a token, from cache. On a miss, kicks off a background resolve and returns
 * `undefined` this call (the handler never waits on the network); a later request returns the resolved
 * value. Chains with no launchpad resolve to no-logo synchronously with zero RPC.
 */
export function getLaunchpadLogo(chainId: number, address: string): string | undefined {
  if (!address) {
    return undefined
  }
  const key = `${chainId}:${address.toLowerCase()}`
  const hit = cache.get(key)
  if (hit) {
    return hit.logoUrl
  }
  const launcher = LAUNCHER_ADDRESSES[chainId]
  if (!launcher) {
    // No launchpad on this chain → terminal no-logo, no RPC.
    cache.set(key, { metadataURI: '' })
    return undefined
  }
  void resolveInBackground(chainId, launcher, address, key)
  return undefined
}

/**
 * The logo URL for a token, or undefined for an honest no-logo. Tiered (highest priority first):
 *   1. curated per-address logo (chain-scoped) — CURATED_LOGOS
 *   2. symbol-family logo — for wrapped/bridged/variant tokens (needs `symbol`; skipped when absent)
 *   3. launchpad on-chain metadataURI (lazy + cached — see getLaunchpadLogo)
 *   4. external CDN by (chain, address) — Trust Wallet (inert for HookSwap's custom chains today)
 * Anything past tier 4 → undefined (the frontend renders its deterministic monogram — tier 5).
 * Synchronous + non-blocking: safe to call while building any Token proto. `symbol` is optional so
 * callers without it (e.g. the address-only /v1/token-meta endpoint) still get tiers 1/3/4.
 */
export function resolveTokenLogo(chainId: number, address: string, symbol?: string): string | undefined {
  const curated = curatedLogo(chainId, address)
  if (curated) {
    return curated
  }
  const family = symbolFamilyLogo(symbol)
  if (family) {
    return family
  }
  const launchpad = getLaunchpadLogo(chainId, address)
  if (launchpad) {
    return launchpad
  }
  return trustWalletLogo(chainId, address)
}

/**
 * Socials/description for a launchpad token, from cache. Same non-blocking contract as the logo path: a
 * cache miss returns `undefined` and kicks off the background resolve (the metadataURI read + JSON parse
 * is shared with the logo resolve, so this never doubles the RPC). Returns undefined for curated / non-JSON
 * / socials-less tokens — an honest "no socials", never fabricated.
 */
export function resolveTokenSocials(chainId: number, address: string): TokenSocials | undefined {
  if (!address) {
    return undefined
  }
  const key = `${chainId}:${address.toLowerCase()}`
  const hit = cache.get(key)
  if (hit) {
    return hit.socials
  }
  // Not resolved yet — trigger the same background resolve the logo path uses, return nothing this call.
  getLaunchpadLogo(chainId, address)
  return undefined
}
