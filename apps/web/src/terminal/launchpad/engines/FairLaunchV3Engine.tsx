/**
 * HookSwap Terminal — Fair Launch · v3 engine (HookOSV3Launcher).
 *
 * This is the ORIGINAL `/launch/create` fair-launch flow, extracted verbatim from
 * LaunchCreateScreen so it can be selected from the engine picker without any behavior change:
 * mint a token + single-sided-seed a v3 pool + lock the LP in the HookOSV3FeeVault, all in one tx.
 *
 * DATA POLICY (no mock data):
 *   • Fees — REAL on-chain reads (effectiveLaunchFee, quoteLaunchCost).
 *   • Result — parsed from the launch tx's PoolSeeded event by the SDK.
 *   • My launches + pending fees — from the FeeVault; honest empty states.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { ExplorerDataType } from 'uniswap/src/utils/linking'
import { ExplorerAddress } from '~/terminal/components/ExplorerAddress'
import { StatCard } from '~/terminal/components/StatCard'
import {
  fmtWei,
  onlyDecimal,
  onlyDigits,
  onlySignedDigits,
  FieldLabel,
  NotDeployedNote,
  Notice,
  Panel,
  PrimaryButton,
  StepLabel,
  SummaryRow,
  TextField,
  ToggleRow,
  TwoColumn,
  MONO,
  SANS,
} from '~/terminal/launchpad/primitives'
import {
  randomSalt,
  useLaunch,
  useMyLaunches,
  V3Dex,
  PairToken,
  ZERO_SALT,
  type LaunchConfigInput,
} from '~/terminal/launchpad/useLaunch'
import { terminalColors } from '~/terminal/theme/tokens'
import { formatUnits, parseEther, type Address } from '~/chains'

/**
 * Contract-valid pool defaults so the default (non-advanced) form submits.
 *   • sqrtPriceX96 = 2^96 → advisory only (the launcher ignores it; price derives from tickLower).
 *   • ticks ±887220 → the full usable range at tickSpacing 60 → a fair launch that opens at a very
 *     low price and rises as people buy. Proven, contract-valid geometry — kept as the safe default.
 * The beginner flow never touches these; power users override them in the Advanced panel.
 */
const DEFAULT_SQRT_PRICE_X96 = '79228162514264337593543950336'
const DEFAULT_TICK_LOWER = '-887220'
const DEFAULT_TICK_UPPER = '887220'

/** Fixed token decimals for a HookOS-launched token (the launcher mints an 18-dec ERC-20). */
const TOKEN_DECIMALS = 18n

/** Format a plain integer token-count string with thousands separators for display. */
function fmtCount(count: string): string {
  if (count === '') {
    return '—'
  }
  // Group digits without going through Number() (supply can exceed 2^53).
  return count.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** The friendly socials/description fields that get assembled into the on-chain metadata JSON. */
interface TokenMeta {
  image: string
  description: string
  website: string
  twitter: string
  telegram: string
}

const EMPTY_META: TokenMeta = { image: '', description: '', website: '', twitter: '', telegram: '' }

/** UTF-8-safe base64 (btoa alone breaks on non-Latin1 chars in a description). */
function utf8ToBase64(s: string): string {
  return btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))))
}

/**
 * Assemble the optional socials/description fields (+ name/symbol) into the flat token-metadata JSON
 * the data-api parses, returned as a `data:application/json;base64,…` URI. Empty fields are omitted —
 * nothing is fabricated. Returns '' when the creator supplied no image/description/socials at all
 * (name+symbol alone aren't worth a metadata URI — they're already on-chain token fields).
 */
function buildMetadataUri(name: string, symbol: string, meta: TokenMeta): string {
  const obj: Record<string, string> = {}
  const n = name.trim()
  const s = symbol.trim()
  const image = meta.image.trim()
  const description = meta.description.trim()
  const website = meta.website.trim()
  const twitter = meta.twitter.trim()
  const telegram = meta.telegram.trim()
  const hasContent = image !== '' || description !== '' || website !== '' || twitter !== '' || telegram !== ''
  if (!hasContent) {
    return ''
  }
  if (n !== '') {
    obj.name = n
  }
  if (s !== '') {
    obj.symbol = s
  }
  if (image !== '') {
    obj.image = image
  }
  if (description !== '') {
    obj.description = description
  }
  if (website !== '') {
    obj.website = website
  }
  if (twitter !== '') {
    obj.twitter = twitter
  }
  if (telegram !== '') {
    obj.telegram = telegram
  }
  return `data:application/json;base64,${utf8ToBase64(JSON.stringify(obj))}`
}

const EMPTY_INPUT: LaunchConfigInput = {
  name: '',
  symbol: '',
  metadataURI: '',
  totalSupply: '',
  salt: ZERO_SALT,
  sqrtPriceX96: DEFAULT_SQRT_PRICE_X96,
  tickLower: DEFAULT_TICK_LOWER,
  tickUpper: DEFAULT_TICK_UPPER,
  dex: String(V3Dex.HookSwap),
  pair: String(PairToken.WETH),
  lockOnHookSwap: true,
  initialBuyEth: '0',
  initialBuyMinOut: '0',
  initialBuyDeadline: '0',
}

/* ------------------------------------------------------------------ my launches */

function MyLaunchesPanel({ chainId, owner }: { chainId?: number; owner?: Address }): JSX.Element {
  const my = useMyLaunches({ chainId, owner })

  return (
    <Panel title="04 · My launches" meta={my.isLoading ? ['loading…'] : undefined}>
      {!owner ? (
        <Notice tone="muted">Connect your wallet to see the tokens you&apos;ve launched.</Notice>
      ) : my.isLoading ? (
        <Notice tone="muted">Loading your launches…</Notice>
      ) : my.launches.length === 0 ? (
        <Notice tone="muted">You haven&apos;t launched any tokens yet.</Notice>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {my.launches.map((l) => {
            const dexLabel = l.dex === V3Dex.HookSwap ? 'HookSwap' : 'Uniswap V3'
            return (
              <div
                key={String(l.id)}
                style={{
                  border: `1px solid ${terminalColors.line}`,
                  borderRadius: 11,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <SummaryRow label="Token" value={<ExplorerAddress address={l.token} chainId={chainId} type={ExplorerDataType.TOKEN} fontSize={12.5} fontWeight={500} />} />
                <SummaryRow label="Pool" value={<ExplorerAddress address={l.pool} chainId={chainId} fontSize={12.5} fontWeight={500} />} />
                <SummaryRow label="DEX" value={dexLabel} />
                <SummaryRow label="Position #" value={String(l.tokenId)} />
                <SummaryRow
                  label="Pending WETH"
                  value={fmtWei(l.pendingWeth)}
                  valueColor={l.pendingWeth && l.pendingWeth > 0n ? terminalColors.greenDeep : terminalColors.faint}
                />
                <SummaryRow
                  label="Pending token"
                  value={fmtWei(l.pendingToken)}
                  valueColor={l.pendingToken && l.pendingToken > 0n ? terminalColors.greenDeep : terminalColors.faint}
                />
                <PrimaryButton
                  label={my.claimingToken === l.token && my.isClaiming ? 'Collecting…' : 'Collect fees'}
                  onClick={() => void my.collect(l.token)}
                  disabled={my.isClaiming || !((l.pendingWeth && l.pendingWeth > 0n) || (l.pendingToken && l.pendingToken > 0n))}
                  variant="outline"
                />
              </div>
            )
          })}

          <SummaryRow label="Total pending WETH" value={fmtWei(my.totalPendingWeth)} />
          {my.deferredEth > 0n ? (
            <>
              <SummaryRow label="Deferred ETH" value={fmtWei(my.deferredEth)} valueColor={terminalColors.greenDeep} />
              <PrimaryButton
                label={my.isClaiming ? 'Withdrawing…' : 'Withdraw deferred ETH'}
                onClick={() => void my.withdrawPending()}
                disabled={my.isClaiming}
              />
            </>
          ) : null}
        </div>
      )}

      {my.claimError ? (
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 10, lineHeight: 1.5 }}>
          {my.claimError}
        </div>
      ) : null}

      <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
        LP is permanently locked in the fee vault. Trading fees are split per-dex (50/50 Uniswap V3, 70/30 HookSwap).
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ the engine */

export function FairLaunchV3Engine({
  chainId,
  connected,
  owner,
  onConnect,
}: {
  chainId: number
  connected: boolean
  owner?: Address
  onConnect: () => void
}): JSX.Element {
  const chainLabel = getChainLabel(chainId)

  const [input, setInput] = useState<LaunchConfigInput>(EMPTY_INPUT)
  const [advanced, setAdvanced] = useState(false)
  const [meta, setMeta] = useState<TokenMeta>(EMPTY_META)
  // When a power user pastes a raw metadataURI in Advanced, it takes over from the friendly builder.
  const [rawMetaOverride, setRawMetaOverride] = useState(false)

  const set = <K extends keyof LaunchConfigInput>(key: K, value: LaunchConfigInput[K]): void => {
    setInput((prev) => ({ ...prev, [key]: value }))
  }

  const setMetaField = (key: keyof TokenMeta, value: string): void => {
    setMeta((prev) => ({ ...prev, [key]: value }))
  }

  // Keep input.metadataURI in sync with the friendly socials fields (unless overridden by a raw paste).
  // The on-chain launch tuple is unchanged — metadataURI is just now assembled instead of hand-typed.
  useEffect(() => {
    if (rawMetaOverride) {
      return
    }
    setInput((prev) => {
      const next = buildMetadataUri(prev.name, prev.symbol, meta)
      return next === prev.metadataURI ? prev : { ...prev, metadataURI: next }
    })
  }, [meta, input.name, input.symbol, rawMetaOverride])

  /* ------------------------------------------------------------------ beginner ⇄ raw views
   * The scary on-chain fields stay in `input` as raw strings (unchanged, still validated by
   * buildParams). The primary flow just presents friendly VIEWS over them:
   *   • Total supply — whole token count; the 18 decimals are appended under the hood.
   *   • Buy at launch — ETH; converted to wei under the hood (+ a >0 min-out so the SDK accepts it).
   * No on-chain logic changes: the same LaunchParams tuple is sent either way. */

  /** input.totalSupply (raw 18-dec wei) → whole-token count for the friendly field. */
  const supplyTokens = ((): string => {
    const raw = input.totalSupply.trim()
    if (raw === '' || !/^\d+$/.test(raw)) {
      return ''
    }
    try {
      return (BigInt(raw) / 10n ** TOKEN_DECIMALS).toString()
    } catch {
      return ''
    }
  })()

  /** Whole-token count → raw 18-dec wei stored in input.totalSupply. */
  const setSupplyTokens = (v: string): void => {
    const count = onlyDigits(v)
    set('totalSupply', count === '' ? '' : (BigInt(count) * 10n ** TOKEN_DECIMALS).toString())
  }

  /** input.initialBuyEth (raw wei) → human ETH for the friendly field. */
  const buyEth = ((): string => {
    const w = input.initialBuyEth.trim()
    if (w === '' || w === '0' || !/^\d+$/.test(w)) {
      return ''
    }
    try {
      return formatUnits(BigInt(w), 18)
    } catch {
      return ''
    }
  })()

  /** Human ETH → raw wei; also seeds a >0 min-out (SDK rejects a 0-slippage dev buy). */
  const setBuyEth = (v: string): void => {
    const s = onlyDecimal(v)
    let wei = '0'
    if (s !== '' && s !== '.') {
      try {
        wei = parseEther(s).toString()
      } catch {
        wei = '0'
      }
    }
    setInput((prev) => ({
      ...prev,
      initialBuyEth: wei,
      // Same-tx atomic self-buy → no front-running possible; a min-out of 1 wei just satisfies the
      // launcher's "never 0-slippage" guard. A power user can tighten it in the Advanced panel.
      initialBuyMinOut: wei === '0' ? '0' : prev.initialBuyMinOut !== '' && prev.initialBuyMinOut !== '0' ? prev.initialBuyMinOut : '1',
    }))
  }

  const launchState = useLaunch({ chainId, owner, input })
  const deployed = launchState.ready

  const feeLabel = launchState.baseFeeWei !== undefined ? `${fmtWei(launchState.baseFeeWei)} ETH` : '—'
  const totalValueLabel = launchState.totalValue !== undefined ? `${fmtWei(launchState.totalValue)} ETH` : '—'

  const busy = launchState.isWritePending || launchState.isConfirming

  const onPrimary = (): void => {
    if (!connected) {
      onConnect()
      return
    }
    if (launchState.isDone) {
      launchState.reset()
      setInput(EMPTY_INPUT)
      setMeta(EMPTY_META)
      setRawMetaOverride(false)
      return
    }
    void launchState.launch()
  }

  const primaryLabel = ((): string => {
    if (!deployed) {
      return 'Not available on this network'
    }
    if (!connected) {
      return 'Connect wallet to launch'
    }
    if (launchState.isDone) {
      return 'Launch another token'
    }
    if (launchState.validationError) {
      return launchState.validationError
    }
    if (launchState.isWritePending) {
      return 'Preparing launch…'
    }
    if (launchState.isConfirming) {
      return 'Confirm & launching…'
    }
    return 'Launch token'
  })()

  const primaryDisabled = ((): boolean => {
    if (!deployed) {
      return true
    }
    if (!connected) {
      return false
    }
    if (launchState.isDone) {
      return false
    }
    if (busy) {
      return true
    }
    return !launchState.canLaunch
  })()

  const symbolValue = input.symbol.trim() !== '' ? input.symbol.trim().toUpperCase() : '—'
  const supplyValue = fmtCount(supplyTokens)
  const dexLabel = input.dex === String(V3Dex.HookSwap) ? 'HookSwap' : 'Uniswap V3'

  return (
    <>
      {/* Stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatCard size="lg" label="Symbol" value={symbolValue} />
        <StatCard size="lg" label="Supply" value={supplyValue} />
        <StatCard size="lg" label="Launch fee" value={deployed ? feeLabel : '—'} />
        <StatCard size="lg" label="DEX" value={deployed ? dexLabel : '—'} />
      </div>

      <TwoColumn
        left={
          <>
            <Panel title="01 · Token" meta={deployed ? undefined : ['not deployed']}>
              {!deployed ? (
                <NotDeployedNote chainLabel={chainLabel} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Notice tone="muted">
                    Create your token, seed its liquidity pool, and lock the LP — all in one transaction. It opens as a
                    fair launch (price starts low and rises as people buy), and the trading fees stay yours to claim.
                  </Notice>
                  <div>
                    <FieldLabel>Name</FieldLabel>
                    <TextField value={input.name} onChange={(v) => set('name', v)} placeholder="My Token" maxLength={64} />
                  </div>
                  <div>
                    <FieldLabel>Symbol</FieldLabel>
                    <TextField
                      value={input.symbol}
                      onChange={(v) => set('symbol', v.toUpperCase())}
                      placeholder="MYT"
                      mono
                      maxLength={16}
                    />
                  </div>
                  <div>
                    <FieldLabel>Total supply</FieldLabel>
                    <TextField
                      value={supplyTokens}
                      onChange={setSupplyTokens}
                      placeholder="1,000,000"
                      mono
                      inputMode="numeric"
                    />
                    <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 5, lineHeight: 1.5 }}>
                      Whole number of tokens. Decimals are handled for you. All of it seeds the pool — no team allocation.
                    </div>
                  </div>

                  {!rawMetaOverride ? (
                    <>
                      <StepLabel index="—" label="Socials & description (optional)" />
                      <div>
                        <FieldLabel>Logo image URL</FieldLabel>
                        <TextField value={meta.image} onChange={(v) => setMetaField('image', v)} placeholder="https://… or ipfs://… (PNG/SVG)" mono />
                      </div>
                      <div>
                        <FieldLabel>Description</FieldLabel>
                        <TextField value={meta.description} onChange={(v) => setMetaField('description', v)} placeholder="One line about your token" maxLength={280} />
                      </div>
                      <div>
                        <FieldLabel>Website</FieldLabel>
                        <TextField value={meta.website} onChange={(v) => setMetaField('website', v)} placeholder="https://yourtoken.xyz" mono />
                      </div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <FieldLabel>Twitter / X</FieldLabel>
                          <TextField value={meta.twitter} onChange={(v) => setMetaField('twitter', v)} placeholder="@handle or url" mono />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <FieldLabel>Telegram</FieldLabel>
                          <TextField value={meta.telegram} onChange={(v) => setMetaField('telegram', v)} placeholder="@handle or url" mono />
                        </div>
                      </div>
                      <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, lineHeight: 1.5 }}>
                        These show on your token&apos;s page. All optional — leave any blank. Saved on-chain in the token metadata.
                      </div>
                    </>
                  ) : (
                    <Notice tone="muted">
                      Using a custom metadata URI from the Advanced panel. Clear it there to edit these fields instead.
                    </Notice>
                  )}
                </div>
              )}
            </Panel>

            {/* Cross-link to the plain fixed-supply token factory (no pool). */}
            <Link
              to="/token/new"
              style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3Alt, textDecoration: 'none', lineHeight: 1.5 }}
            >
              Just need a plain fixed-supply token?{' '}
              <span style={{ color: terminalColors.brandGreen, fontWeight: 600 }}>Use the token factory →</span>
            </Link>

            {deployed ? (
              <Panel title="02 · Pool">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <FieldLabel>DEX</FieldLabel>
                    {/* HookSwap is the only DEX offered: its v3 factory is the one the router
                        discovers, so every launch is swappable in-app. */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 36,
                        padding: '0 12px',
                        border: `1px solid ${terminalColors.line}`,
                        borderRadius: 8,
                        background: terminalColors.panel2,
                        fontFamily: SANS,
                        fontSize: 13,
                        fontWeight: 500,
                        color: terminalColors.ink,
                      }}
                    >
                      HookSwap
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Pair token</FieldLabel>
                    <ToggleRow
                      options={[
                        { label: 'WETH', value: String(PairToken.WETH) },
                        ...(launchState.hookPairEnabled ? [{ label: 'HOOK', value: String(PairToken.HOOK) }] : []),
                      ]}
                      value={input.pair}
                      onChange={(v) => set('pair', v)}
                    />
                  </div>
                  <div>
                    <FieldLabel>Lock LP permanently</FieldLabel>
                    <ToggleRow
                      options={[
                        { label: 'Yes — lock', value: 'true' },
                        { label: 'No', value: 'false' },
                      ]}
                      value={String(input.lockOnHookSwap)}
                      onChange={(v) => set('lockOnHookSwap', v === 'true')}
                    />
                  </div>
                  <div>
                    <FieldLabel>Buy at launch (optional, ETH)</FieldLabel>
                    <TextField value={buyEth} onChange={setBuyEth} placeholder="0.0" mono inputMode="decimal" />
                    <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 5, lineHeight: 1.5 }}>
                      Optionally buy some of your own token in the same transaction. This ETH is added to the total cost.
                    </div>
                  </div>
                </div>
                <Notice tone="muted">
                  Pool is single-sided (100% your token), paired against{' '}
                  {input.pair === String(PairToken.HOOK) ? 'HOOK' : 'WETH'}. LP is locked in the fee vault — trading fees
                  are claimable.
                </Notice>
              </Panel>
            ) : null}

            {/* Advanced: v3 price params, salt, initial buy */}
            {deployed ? (
              <Panel title="Advanced">
                <div
                  onClick={() => setAdvanced((a) => !a)}
                  style={{ cursor: 'pointer', fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', color: terminalColors.ink3Alt }}
                >
                  {advanced ? '− ADVANCED' : '+ ADVANCED (metadata, price, salt, initial buy)'}
                </div>

                {advanced ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                    <StepLabel index="02b" label="Metadata URI override" note="Overrides the friendly Socials fields." />
                    <div>
                      <FieldLabel>Metadata URI</FieldLabel>
                      <TextField
                        value={rawMetaOverride ? input.metadataURI : ''}
                        onChange={(v) => {
                          setRawMetaOverride(v.trim() !== '')
                          set('metadataURI', v)
                        }}
                        placeholder="ipfs://… or https://… or data:application/json;… (optional)"
                        mono
                      />
                      <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 5, lineHeight: 1.5 }}>
                        Advanced: paste a raw metadata URI to bypass the Socials fields. Leave blank to use those instead.
                      </div>
                    </div>

                    <StepLabel index="03" label="Price & range" note="Defaults to a full-range fair launch. sqrtPriceX96 is advisory — the pool price is set by tickLower." />
                    <div>
                      <FieldLabel>Initial price (sqrtPriceX96)</FieldLabel>
                      <TextField
                        value={input.sqrtPriceX96}
                        onChange={(v) => set('sqrtPriceX96', onlyDigits(v))}
                        placeholder="79228162514264337593543950336"
                        mono
                        inputMode="numeric"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FieldLabel>Tick lower</FieldLabel>
                        <TextField value={input.tickLower} onChange={(v) => set('tickLower', onlySignedDigits(v))} placeholder="-887220" mono />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FieldLabel>Tick upper</FieldLabel>
                        <TextField value={input.tickUpper} onChange={(v) => set('tickUpper', onlySignedDigits(v))} placeholder="887220" mono />
                      </div>
                    </div>

                    <StepLabel index="04" label="Salt & initial buy" />
                    <div>
                      <FieldLabel>Deploy salt</FieldLabel>
                      <TextField
                        value={input.salt === ZERO_SALT ? '' : input.salt}
                        onChange={(v) => set('salt', v || ZERO_SALT)}
                        placeholder="Default (zero) — click Randomize for a unique address"
                        mono
                      />
                      <PrimaryButton label="Randomize salt" onClick={() => set('salt', randomSalt())} variant="outline" />
                    </div>
                    <div>
                      <FieldLabel>Initial buy amount (raw wei)</FieldLabel>
                      <TextField value={input.initialBuyEth} onChange={(v) => set('initialBuyEth', onlyDigits(v))} placeholder="0" mono inputMode="numeric" />
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FieldLabel>Min tokens received</FieldLabel>
                        <TextField value={input.initialBuyMinOut} onChange={(v) => set('initialBuyMinOut', onlyDigits(v))} placeholder="0" mono inputMode="numeric" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FieldLabel>Deadline (unix timestamp)</FieldLabel>
                        <TextField value={input.initialBuyDeadline} onChange={(v) => set('initialBuyDeadline', onlyDigits(v))} placeholder="0" mono inputMode="numeric" />
                      </div>
                    </div>
                    <Notice tone="muted">Initial buy executes in the same tx. Its ETH is added to the total cost.</Notice>
                  </div>
                ) : null}
              </Panel>
            ) : null}
          </>
        }
        right={
          <>
            <Panel title="Review" corners>
              <SummaryRow label="Name" value={input.name.trim() !== '' ? input.name.trim() : '—'} />
              <SummaryRow label="Symbol" value={symbolValue} />
              <SummaryRow label="Supply" value={supplyValue} />
              {buyEth !== '' ? <SummaryRow label="Buy at launch" value={`${buyEth} ETH`} /> : null}
              <SummaryRow label="DEX" value={deployed ? dexLabel : '—'} />
              <SummaryRow label="Launch fee" value={deployed ? feeLabel : '—'} />
              <SummaryRow
                label="Total cost"
                value={deployed ? totalValueLabel : '—'}
                valueColor={deployed ? terminalColors.ink : terminalColors.faint}
              />
              <SummaryRow
                label="Creator"
                value={connected && owner ? <ExplorerAddress address={owner} chainId={chainId} fontSize={12.5} fontWeight={500} /> : '—'}
              />
              <SummaryRow label="Network" value={deployed ? chainLabel : 'Not available'} />

              <PrimaryButton label={primaryLabel} onClick={onPrimary} disabled={primaryDisabled} />

              {launchState.isDone ? (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Notice tone="green">Launched — token deployed, pool seeded, LP locked in the fee vault.</Notice>
                  <SummaryRow label="Token" value={<ExplorerAddress address={launchState.createdToken} chainId={chainId} type={ExplorerDataType.TOKEN} fontSize={12.5} fontWeight={500} />} />
                  <SummaryRow label="Pool" value={<ExplorerAddress address={launchState.createdPool} chainId={chainId} fontSize={12.5} fontWeight={500} />} />
                  <SummaryRow
                    label="Position #"
                    value={launchState.createdTokenId !== undefined ? String(launchState.createdTokenId) : '—'}
                  />
                </div>
              ) : launchState.error ? (
                <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 10, lineHeight: 1.5 }}>
                  {launchState.error}
                </div>
              ) : deployed ? (
                <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
                  One transaction: deploys the token, seeds the v3 pool, and registers the LP position in the fee vault.
                  Principal is locked forever; trading fees are claimable below.
                </div>
              ) : null}
            </Panel>

            <MyLaunchesPanel chainId={chainId} owner={owner} />
          </>
        }
      />
    </>
  )
}
