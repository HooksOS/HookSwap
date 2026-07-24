/**
 * HookSwap Terminal — Bridge (cross-chain, powered by Relay).
 *
 * A self-contained cross-chain bridge served in the Terminal shell and at its own
 * subdomain (bridge.hookswap.org → /bridge). Every value is LIVE:
 *   • Chain list        — Relay GET /chains (all supported chains, HookSwap pinned).
 *   • Token list        — each chain's native + featured ERC-20s (+ /currencies/v2 search).
 *   • Quote             — Relay POST /quote with the HookSwap 0.50% app fee → treasury.
 *   • Balances          — connected wallet (wagmi).
 *   • Execution/status  — real wallet txs + GET /intents/status polling.
 *
 * No mock data. Honest disconnected / loading / no-route / error / progress states.
 * Theme = DAYSIGNAL light (terminalColors/terminalFonts); IBM Plex Mono for numbers.
 */
import { useEffect, useMemo, useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { useBalance } from 'wagmi'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useAccount } from '~/hooks/useAccount'
import { RELAY_NATIVE_ADDRESS } from '~/terminal/bridge/addresses'
import { chainLabel, isHookSwapChain, useBridgeChains, useChainCurrencies } from '~/terminal/bridge/chains'
import {
  fetchRelayCurrencies,
  type RelayChain,
  type RelayCurrencyMeta,
} from '~/terminal/bridge/relayClient'
import { useBridgeExecute } from '~/terminal/bridge/useBridgeExecute'
import { useBridgeQuote } from '~/terminal/bridge/useBridgeQuote'
import { terminalColors, terminalFonts, terminalShadows } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

/* ------------------------------------------------------------------ helpers */

function isNativeCurrency(c?: RelayCurrencyMeta): boolean {
  return !c?.address || c.address.toLowerCase() === RELAY_NATIVE_ADDRESS
}

/** The native currency descriptor for a chain (from the Relay chain entry). */
function nativeCurrencyOf(chain?: RelayChain): RelayCurrencyMeta | undefined {
  if (!chain) {
    return undefined
  }
  return (
    chain.currency ?? {
      symbol: 'ETH',
      name: 'Ether',
      address: RELAY_NATIVE_ADDRESS,
      decimals: 18,
    }
  )
}

/** Base token list for a chain: native first, then its featured ERC-20s. */
function baseTokensOf(chain?: RelayChain): RelayCurrencyMeta[] {
  if (!chain) {
    return []
  }
  const native = nativeCurrencyOf(chain)
  const erc20 = chain.erc20Currencies ?? []
  return native ? [native, ...erc20] : erc20
}

function shortenAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function formatSeconds(sec?: number): string {
  if (!sec || sec <= 0) {
    return '—'
  }
  if (sec < 60) {
    return `~${Math.round(sec)}s`
  }
  return `~${Math.round(sec / 60)} min`
}

/* ------------------------------------------------------------- theme + icons */

/**
 * True when the Terminal is on its DARK palette. Theme is driven by `data-theme` on
 * <html> (DARK is the default — bare `:root` / `data-theme='dark'`; light is
 * `data-theme='light'`). Reactive to the theme toggle via a MutationObserver.
 */
function useIsDarkTerminal(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') !== 'light' : true,
  )
  useEffect(() => {
    const el = document.documentElement
    const update = (): void => setDark(el.getAttribute('data-theme') !== 'light')
    update()
    const obs = new MutationObserver(update)
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

/**
 * Ordered chain-icon URL candidates. Relay serves per-theme variants
 * (`…/icons/<id>/light.png` for light backgrounds, `…/dark.png` for dark — both verified
 * live). On the dark Terminal the "light" variant (a dark glyph) is near-invisible, so we
 * prefer the dark variant, then fall back to the provided icon, then `logoUrl` — the
 * `<img>` onError walks this list, and only a genuinely icon-less chain shows the dot.
 */
function chainIconCandidates(chain: RelayChain | undefined, isDark: boolean): string[] {
  const base = chain?.iconUrl ?? chain?.logoUrl
  const out: string[] = []
  if (base && isDark && /\/light\.(png|svg|webp|jpg|jpeg)(\?|$)/i.test(base)) {
    out.push(base.replace(/\/light\.(png|svg|webp|jpg|jpeg)/i, '/dark.$1'))
  }
  if (base) {
    out.push(base)
  }
  if (chain?.logoUrl && chain.logoUrl !== base) {
    out.push(chain.logoUrl)
  }
  return out
}

/* --------------------------------------------------------------- token logo */

/**
 * A token's icon. Uses the currency's own `metadata.logoURI` when present, else resolves
 * it by address from the chain's currency list (the selected token often originates from
 * GET /chains, which ships no logos — the map is built from /currencies/v2). Falls back to
 * a neutral dot only when no logo exists anywhere.
 */
function TokenLogo({
  currency,
  size = 20,
  logoByAddress,
}: {
  currency?: RelayCurrencyMeta
  size?: number
  logoByAddress?: Map<string, string>
}): JSX.Element {
  const url =
    currency?.metadata?.logoURI ??
    logoByAddress?.get((currency?.address ?? RELAY_NATIVE_ADDRESS).toLowerCase())
  const [broken, setBroken] = useState(false)
  // Reset the broken flag when the resolved URL changes (selecting a different token).
  useEffect(() => setBroken(false), [url])
  if (url && !broken) {
    return (
      <img
        src={url}
        alt={currency?.symbol ?? ''}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        style={{ borderRadius: '50%', display: 'block', flexShrink: 0, objectFit: 'cover' }}
      />
    )
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        // Theme-aware neutral placeholder (matches ChainLogo's fallback) — a frozen
        // hardcoded gradient would keep one hue in both palettes.
        background: terminalColors.panel2,
        border: `1px solid ${terminalColors.line}`,
        display: 'inline-block',
      }}
    />
  )
}

function ChainLogo({ chain, size = 18, isDark }: { chain?: RelayChain; size?: number; isDark: boolean }): JSX.Element {
  const candidates = useMemo(() => chainIconCandidates(chain, isDark), [chain, isDark])
  const [idx, setIdx] = useState(0)
  // Restart from the best candidate whenever the chain / theme changes.
  useEffect(() => setIdx(0), [candidates.join('|')])
  const url = candidates[idx]
  if (url) {
    return (
      <img
        src={url}
        alt={chain ? chainLabel(chain) : ''}
        width={size}
        height={size}
        onError={() => setIdx((i) => i + 1)}
        style={{ borderRadius: '50%', display: 'block', flexShrink: 0, objectFit: 'cover' }}
      />
    )
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background: terminalColors.panel2,
        border: `1px solid ${terminalColors.line}`,
        display: 'inline-block',
      }}
    />
  )
}

/* ------------------------------------------------------------- chain select */

function ChainSelect({
  label,
  chains,
  selectedId,
  onSelect,
}: {
  label: string
  chains: RelayChain[]
  selectedId?: number
  onSelect: (id: number) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const isDark = useIsDarkTerminal()
  const selected = chains.find((c) => c.id === selectedId)
  const filtered = term
    ? chains.filter((c) => chainLabel(c).toLowerCase().includes(term.toLowerCase()) || String(c.id).includes(term))
    : chains

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '9px 11px',
          background: terminalColors.bg,
          border: `1px solid ${terminalColors.line}`,
          borderRadius: 9,
          cursor: 'pointer',
        }}
      >
        <ChainLogo chain={selected} size={18} isDark={isDark} />
        <span style={{ flex: 1, textAlign: 'left', fontFamily: SANS, fontSize: 13, fontWeight: 600, color: terminalColors.ink }}>
          {selected ? chainLabel(selected) : label}
        </span>
        {selected && isHookSwapChain(selected.id) ? (
          <span
            style={{
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: terminalColors.greenDeep,
              background: terminalColors.greenBg,
              border: `1px solid ${terminalColors.greenBorder}`,
              borderRadius: 5,
              padding: '2px 5px',
            }}
          >
            HOOKSWAP
          </span>
        ) : null}
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={terminalColors.ink2} strokeWidth={2.5}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div
            style={{
              position: 'absolute',
              top: 46,
              left: 0,
              right: 0,
              maxHeight: 320,
              overflowY: 'auto',
              background: terminalColors.bg,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 12,
              boxShadow: '0 14px 34px -12px rgba(11,15,20,.30)',
              padding: 6,
              zIndex: 41,
            }}
          >
            <input
              autoFocus
              value={term}
              placeholder="Search chains…"
              onChange={(e) => setTerm(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                marginBottom: 6,
                fontFamily: SANS,
                fontSize: 13,
                color: terminalColors.ink,
                background: terminalColors.panel,
                border: `1px solid ${terminalColors.line2}`,
                borderRadius: 8,
                outline: 'none',
              }}
            />
            {filtered.length === 0 ? (
              <div style={{ padding: '10px', fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3 }}>
                No chains match.
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onSelect(c.id)
                    setOpen(false)
                    setTerm('')
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '8px 9px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    background: c.id === selectedId ? terminalColors.panel : 'transparent',
                  }}
                >
                  <ChainLogo chain={c} size={18} isDark={isDark} />
                  <span style={{ flex: 1, fontFamily: SANS, fontSize: 13, color: terminalColors.ink }}>
                    {chainLabel(c)}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.ink3 }}>{c.id}</span>
                  {isHookSwapChain(c.id) ? (
                    <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, color: terminalColors.greenDeep }}>
                      ●
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------- token select */

function TokenSelect({
  chain,
  selected,
  onSelect,
}: {
  chain?: RelayChain
  selected?: RelayCurrencyMeta
  onSelect: (c: RelayCurrencyMeta) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<RelayCurrencyMeta[] | undefined>(undefined)
  const [searching, setSearching] = useState(false)

  // Default token list WITH logos (from /currencies/v2). Falls back to the /chains
  // native + featured ERC-20s (logo-less) for chains Relay's currency search doesn't serve.
  const { currencies, logoByAddress } = useChainCurrencies(chain?.id)
  const base = useMemo(
    () => (currencies.length > 0 ? currencies : baseTokensOf(chain)),
    [currencies, chain],
  )

  // Live token search against Relay /currencies/v2 (debounced).
  useEffect(() => {
    if (!open || !chain || term.trim().length < 2) {
      setResults(undefined)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const handle = setTimeout(() => {
      fetchRelayCurrencies(chain.id, term.trim(), controller.signal)
        .then((r) => {
          if (!controller.signal.aborted) {
            setResults(r)
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResults([])
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSearching(false)
          }
        })
    }, 350)
    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [open, term, chain])

  const list = results ?? base

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!chain}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: terminalColors.bg,
          border: `1px solid ${terminalColors.line}`,
          borderRadius: 999,
          padding: '5px 11px 5px 6px',
          cursor: chain ? 'pointer' : 'not-allowed',
          opacity: chain ? 1 : 0.6,
        }}
      >
        <TokenLogo currency={selected} size={20} logoByAddress={logoByAddress} />
        <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 13, color: terminalColors.ink }}>
          {selected?.symbol ?? 'Token'}
        </span>
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={terminalColors.ink2} strokeWidth={2.5}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div
            style={{
              position: 'absolute',
              top: 42,
              right: 0,
              width: 280,
              maxHeight: 320,
              overflowY: 'auto',
              background: terminalColors.bg,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 12,
              boxShadow: '0 14px 34px -12px rgba(11,15,20,.30)',
              padding: 6,
              zIndex: 41,
            }}
          >
            <input
              autoFocus
              value={term}
              placeholder="Search name or paste address…"
              onChange={(e) => setTerm(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                marginBottom: 6,
                fontFamily: SANS,
                fontSize: 13,
                color: terminalColors.ink,
                background: terminalColors.panel,
                border: `1px solid ${terminalColors.line2}`,
                borderRadius: 8,
                outline: 'none',
              }}
            />
            {searching ? (
              <div style={{ padding: '10px', fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3 }}>
                Searching…
              </div>
            ) : list.length === 0 ? (
              <div style={{ padding: '10px', fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3 }}>
                No tokens found.
              </div>
            ) : (
              list.map((c, i) => (
                <button
                  key={`${c.address ?? 'native'}-${i}`}
                  type="button"
                  onClick={() => {
                    onSelect(c)
                    setOpen(false)
                    setTerm('')
                    setResults(undefined)
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '8px 9px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    background: 'transparent',
                  }}
                >
                  <TokenLogo currency={c} size={22} logoByAddress={logoByAddress} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontFamily: MONO, fontSize: 13, fontWeight: 600, color: terminalColors.ink }}>
                      {c.symbol ?? '—'}
                    </span>
                    <span style={{ display: 'block', fontFamily: SANS, fontSize: 11, color: terminalColors.ink3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isNativeCurrency(c) ? 'Native' : c.name ?? shortenAddr(c.address ?? '')}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

/* --------------------------------------------------------------- receipt row */

function ReceiptRow({
  label,
  value,
  valueColor,
  last,
}: {
  label: string
  value: string
  valueColor?: string
  last?: boolean
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        padding: '9px 0',
        borderBottom: last ? 'none' : `1px dashed ${terminalColors.line}`,
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: terminalColors.ink3 }}>
        {label}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: valueColor ?? terminalColors.ink }}>
        {value}
      </span>
    </div>
  )
}

/* ---------------------------------------------------------------- the screen */

export function BridgeScreen(): JSX.Element {
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  const { chains, loading: chainsLoading, error: chainsError, byId } = useBridgeChains()

  // Default pair: Base → Robinhood (both pinned). Falls back to the first two
  // loaded chains if those aren't present.
  const [fromChainId, setFromChainId] = useState<number | undefined>(undefined)
  const [toChainId, setToChainId] = useState<number | undefined>(undefined)
  const [fromToken, setFromToken] = useState<RelayCurrencyMeta | undefined>(undefined)
  const [toToken, setToToken] = useState<RelayCurrencyMeta | undefined>(undefined)
  const [amount, setAmount] = useState('')

  const exec = useBridgeExecute()

  // Seed defaults once chains load.
  useEffect(() => {
    if (chains.length === 0 || fromChainId !== undefined) {
      return
    }
    const from = byId(8453) ?? chains.find((c) => c.id !== 4663) ?? chains[0]
    const to = byId(4663) ?? chains.find((c) => c.id !== from?.id) ?? chains[0]
    setFromChainId(from?.id)
    setToChainId(to?.id)
    setFromToken(nativeCurrencyOf(from))
    setToToken(nativeCurrencyOf(to))
  }, [chains, fromChainId, byId])

  const fromChain = byId(fromChainId)
  const toChain = byId(toChainId)

  // When a chain changes, reset that side's token to the chain's native currency.
  const onSelectFromChain = (id: number): void => {
    setFromChainId(id)
    setFromToken(nativeCurrencyOf(byId(id)))
    exec.reset()
  }
  const onSelectToChain = (id: number): void => {
    setToChainId(id)
    setToToken(nativeCurrencyOf(byId(id)))
    exec.reset()
  }

  const onFlip = (): void => {
    setFromChainId(toChainId)
    setToChainId(fromChainId)
    setFromToken(toToken)
    setToToken(fromToken)
    setAmount('')
    exec.reset()
  }

  // Balance of the origin token in the connected wallet.
  const isNativeFrom = isNativeCurrency(fromToken)
  const balanceRead = useBalance({
    address: account.address,
    chainId: fromChainId,
    token: isNativeFrom ? undefined : (fromToken?.address as `0x${string}` | undefined),
    query: { enabled: Boolean(account.address && fromChainId && fromToken) },
  })
  const balance = balanceRead.data?.value
  const balanceDecimals = balanceRead.data?.decimals ?? fromToken?.decimals
  const balanceLabel =
    balance !== undefined && balanceDecimals !== undefined
      ? Number(formatUnits(balance, balanceDecimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })
      : '—'

  const originDecimals = fromToken?.decimals ?? balanceDecimals

  // Live quote (with HookSwap app fee → treasury).
  const { quote, loading: quoteLoading, noRoute, error: quoteError, hasInputs } = useBridgeQuote({
    user: account.address,
    recipient: account.address,
    originChainId: fromChainId,
    destinationChainId: toChainId,
    originCurrency: fromToken?.address ?? RELAY_NATIVE_ADDRESS,
    destinationCurrency: toToken?.address ?? RELAY_NATIVE_ADDRESS,
    originDecimals,
    amount,
  })

  // Derived receipt values.
  const out = quote?.details?.currencyOut
  const receiveValue = out?.amountFormatted
    ? `${Number(out.amountFormatted).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${out.currency?.symbol ?? toToken?.symbol ?? ''}`
    : quoteLoading
      ? 'Fetching…'
      : '—'
  const rateValue = quote?.details?.rate
    ? `1 ${fromToken?.symbol ?? ''} = ${Number(quote.details.rate).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${toToken?.symbol ?? ''}`
    : '—'
  const relayer = quote?.fees?.relayer
  const relayerValue = relayer?.amountUsd
    ? `$${Number(relayer.amountUsd).toFixed(2)}`
    : relayer?.amountFormatted
      ? `${Number(relayer.amountFormatted).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${relayer.currency?.symbol ?? ''}`
      : '—'
  const impact = quote?.details?.totalImpact?.percent
  const impactValue = impact !== undefined ? `${Number(impact).toFixed(2)}%` : '—'
  const impactColor =
    impact !== undefined
      ? Math.abs(Number(impact)) < 1
        ? terminalColors.greenUp
        : terminalColors.warn
      : undefined
  const timeValue = formatSeconds(quote?.details?.timeEstimate)

  // Insufficient-balance guard.
  let insufficient = false
  if (account.address && balance !== undefined && originDecimals !== undefined && amount.trim() && Number(amount) > 0) {
    try {
      insufficient = parseUnits(amount.trim() as `${number}`, originDecimals) > balance
    } catch {
      insufficient = false
    }
  }

  const sameToken =
    fromChainId === toChainId &&
    (fromToken?.address ?? '').toLowerCase() === (toToken?.address ?? '').toLowerCase()

  // Primary button state machine.
  let btnLabel = 'Bridge'
  let btnEnabled = false
  let onClickPrimary: () => void = () => undefined
  if (!account.address) {
    btnLabel = 'Connect wallet'
    btnEnabled = true
    onClickPrimary = () => accountDrawer.open()
  } else if (sameToken) {
    btnLabel = 'Select a different destination'
  } else if (!amount.trim() || Number(amount) <= 0) {
    btnLabel = 'Enter an amount'
  } else if (insufficient) {
    btnLabel = `Insufficient ${fromToken?.symbol ?? ''} balance`
  } else if (quoteLoading) {
    btnLabel = 'Fetching quote…'
  } else if (noRoute) {
    btnLabel = 'No route for this pair'
  } else if (quoteError) {
    btnLabel = 'Quote unavailable — try again'
  } else if (!quote) {
    btnLabel = 'Enter an amount'
  } else if (exec.isRunning) {
    btnLabel =
      exec.phase === 'switching'
        ? 'Switch network…'
        : exec.phase === 'signing'
          ? `Confirm in wallet (${exec.stepIndex}/${exec.stepCount})`
          : exec.phase === 'confirming'
            ? 'Confirming on origin…'
            : 'Bridging…'
  } else {
    btnLabel = `Bridge to ${toChain ? chainLabel(toChain) : ''}`
    btnEnabled = true
    onClickPrimary = () => {
      if (quote && fromChainId !== undefined) {
        void exec.execute(quote, fromChainId)
      }
    }
  }

  /* ------------------------------------------------------------------ render */

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '28px 16px 48px', fontFamily: SANS }}>
      <div style={{ width: 460, maxWidth: '100%' }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontFamily: terminalFonts.display, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink }}>
            Bridge
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: terminalColors.ink2, lineHeight: 1.5 }}>
            Move assets across chains via Relay. HookSwap chains are pinned as destinations. No HookSwap fee.
          </p>
        </div>

        {/* Chains failed to load */}
        {chainsError ? (
          <div
            role="alert"
            style={{
              padding: '14px 16px',
              background: terminalColors.redBg,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 12,
              fontSize: 13,
              color: terminalColors.redDown,
            }}
          >
            Couldn’t load the chain list from Relay ({chainsError}). Check your connection and reload.
          </div>
        ) : (
          <div
            style={{
              background: terminalColors.bg,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 16,
              padding: 16,
              boxShadow: terminalShadows.segmentedActive,
            }}
          >
            {/* FROM */}
            <div style={{ background: terminalColors.panel, border: `1px solid ${terminalColors.line2}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: terminalColors.ink3 }}>
                  From
                </span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.ink3 }}>
                  {account.address ? `Bal ${balanceLabel}` : 'Bal —'}
                </span>
              </div>
              <ChainSelect
                label={chainsLoading ? 'Loading chains…' : 'Select chain'}
                chains={chains}
                selectedId={fromChainId}
                onSelect={onSelectFromChain}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <input
                  inputMode="decimal"
                  value={amount}
                  placeholder="0"
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^0-9.]/g, '')
                    const firstDot = cleaned.indexOf('.')
                    setAmount(firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, ''))
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: MONO,
                    fontSize: 26,
                    fontWeight: 600,
                    color: terminalColors.ink,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    padding: 0,
                  }}
                />
                {account.address && balance !== undefined && balanceDecimals !== undefined && balance > 0n ? (
                  <button
                    type="button"
                    onClick={() => setAmount(formatUnits(balance, balanceDecimals))}
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: 600,
                      color: terminalColors.ink2,
                      background: terminalColors.panel2,
                      border: `1px solid ${terminalColors.line2}`,
                      borderRadius: 7,
                      padding: '5px 9px',
                      cursor: 'pointer',
                    }}
                  >
                    Max
                  </button>
                ) : null}
                <TokenSelect chain={fromChain} selected={fromToken} onSelect={(c) => setFromToken(c)} />
              </div>
            </div>

            {/* Flip */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '-8px 0', position: 'relative', zIndex: 2 }}>
              <button
                type="button"
                onClick={onFlip}
                aria-label="Swap direction"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: terminalColors.bg,
                  border: `1px solid ${terminalColors.line}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={terminalColors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" />
                </svg>
              </button>
            </div>

            {/* TO */}
            <div style={{ background: terminalColors.panel, border: `1px solid ${terminalColors.line2}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: terminalColors.ink3 }}>
                  To
                </span>
              </div>
              <ChainSelect
                label={chainsLoading ? 'Loading chains…' : 'Select chain'}
                chains={chains}
                selectedId={toChainId}
                onSelect={onSelectToChain}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 26, fontWeight: 600, color: out ? terminalColors.ink : terminalColors.ink3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {out?.amountFormatted ? Number(out.amountFormatted).toLocaleString('en-US', { maximumFractionDigits: 8 }) : quoteLoading ? '…' : '0'}
                </span>
                <TokenSelect chain={toChain} selected={toToken} onSelect={(c) => setToToken(c)} />
              </div>
            </div>

            {/* Receipt */}
            <div
              style={{
                border: `1px dashed ${terminalColors.line}`,
                borderRadius: 12,
                marginTop: 14,
                padding: '6px 14px',
                background: terminalColors.panel,
              }}
            >
              <ReceiptRow label="You receive" value={receiveValue} />
              <ReceiptRow label="Rate" value={rateValue} />
              <ReceiptRow label="Relayer fee" value={relayerValue} />
              <ReceiptRow label="Price impact" value={impactValue} valueColor={impactColor} />
              <ReceiptRow label="Est. time" value={timeValue} last />
            </div>

            {/* No-route / error honest notes */}
            {hasInputs && noRoute ? (
              <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink2, lineHeight: 1.45 }}>
                Relay has no route for this pair or amount right now. Try a different token, chain, or a larger amount.
              </div>
            ) : null}
            {hasInputs && quoteError ? (
              <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 12.5, color: terminalColors.redDown, lineHeight: 1.45 }}>
                {quoteError}
              </div>
            ) : null}

            {/* Recipient note */}
            {account.address ? (
              <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11, color: terminalColors.ink3 }}>
                Recipient: {shortenAddr(account.address)} (your wallet)
              </div>
            ) : null}

            {/* Primary action */}
            <button
              type="button"
              onClick={btnEnabled ? onClickPrimary : undefined}
              disabled={!btnEnabled}
              style={{
                width: '100%',
                height: 48,
                marginTop: 14,
                background: btnEnabled ? terminalColors.brandGreen : terminalColors.panel2,
                color: btnEnabled ? terminalColors.btnInk : terminalColors.ink3,
                fontWeight: 600,
                fontSize: 14.5,
                fontFamily: SANS,
                borderRadius: 10,
                border: 'none',
                cursor: btnEnabled ? 'pointer' : 'not-allowed',
              }}
            >
              {btnLabel}
            </button>

            {/* Execution progress / result */}
            {exec.phase !== 'idle' ? (
              <BridgeProgress exec={exec} fromChain={fromChain} toChain={toChain} onReset={exec.reset} />
            ) : null}
          </div>
        )}

      </div>
    </div>
  )
}

/* --------------------------------------------------------------- progress */

function BridgeProgress({
  exec,
  fromChain,
  toChain,
  onReset,
}: {
  exec: ReturnType<typeof useBridgeExecute>
  fromChain?: RelayChain
  toChain?: RelayChain
  onReset: () => void
}): JSX.Element {
  const done = exec.phase === 'success' || exec.phase === 'failed' || exec.phase === 'submitted'
  const failed = exec.phase === 'failed'
  const success = exec.phase === 'success'

  let headline: string
  if (success) {
    headline = `Bridged to ${toChain ? chainLabel(toChain) : 'destination'} ✓`
  } else if (exec.phase === 'submitted') {
    headline = 'Deposit submitted — filling on destination'
  } else if (failed) {
    headline = 'Bridge failed'
  } else if (exec.phase === 'filling') {
    headline = `Relayer filling on ${toChain ? chainLabel(toChain) : 'destination'}…`
  } else if (exec.phase === 'confirming') {
    headline = `Confirming on ${fromChain ? chainLabel(fromChain) : 'origin'}…`
  } else if (exec.phase === 'signing') {
    headline = `Confirm in wallet (${exec.stepIndex}/${exec.stepCount})`
  } else {
    headline = 'Switching network…'
  }

  return (
    <div
      style={{
        marginTop: 14,
        padding: '12px 14px',
        borderRadius: 12,
        background: success ? terminalColors.greenBg : failed ? terminalColors.redBg : terminalColors.panel,
        border: `1px solid ${success ? terminalColors.greenBorder : terminalColors.line}`,
      }}
    >
      <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: success ? terminalColors.greenDeep : failed ? terminalColors.redDown : terminalColors.ink }}>
        {headline}
      </div>
      {exec.error ? (
        <div style={{ marginTop: 6, fontFamily: SANS, fontSize: 12, color: terminalColors.redDown, lineHeight: 1.4 }}>
          {exec.error}
        </div>
      ) : null}
      {exec.txHashes.length > 0 ? (
        <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 10.5, color: terminalColors.ink3, lineHeight: 1.5 }}>
          {exec.txHashes.map((h, i) => (
            <div key={h}>
              Origin tx {i + 1}: {h.slice(0, 10)}…{h.slice(-6)}
            </div>
          ))}
          {exec.requestId ? <div>Intent: {exec.requestId.slice(0, 10)}…{exec.requestId.slice(-6)}</div> : null}
        </div>
      ) : null}
      {done ? (
        <button
          type="button"
          onClick={onReset}
          style={{
            marginTop: 10,
            fontFamily: SANS,
            fontSize: 12.5,
            fontWeight: 600,
            color: terminalColors.ink2,
            background: terminalColors.bg,
            border: `1px solid ${terminalColors.line}`,
            borderRadius: 8,
            padding: '7px 12px',
            cursor: 'pointer',
          }}
        >
          {success ? 'Bridge again' : 'Try again'}
        </button>
      ) : null}
    </div>
  )
}
