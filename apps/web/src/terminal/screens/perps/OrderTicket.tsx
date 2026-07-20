import { ReactNode, useMemo, useState } from 'react'
import type { Address } from '~/chains'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { EMPTY } from '~/terminal/screens/perps/perpsCatalog'
import { CollateralDrawer } from '~/terminal/screens/perps/CollateralDrawer'
import type { PerpMarketView } from '~/terminal/perps/engine/marketView'
import { usePlaceOrder } from '~/terminal/perps/engine/usePlaceOrder'

const MONO = terminalFonts.mono

type Side = 'long' | 'short'
type OrderType = 'Market' | 'Limit'

/**
 * Order ticket — Long/Short toggle, Market/Limit segment, size, leverage slider, an
 * optional limit price, and a settlement receipt (entry-mark / est. margin / liq / fees).
 *
 * Wired to the LIVE flow via usePlaceOrder: reads the trader's deposited collateral,
 * nonce, and the market's on-chain leverage cap; on submit it builds the exact EIP-712
 * `Order`, signs it against the market's ("HookSwapPerps","1") domain, and POSTs it to the
 * matching engine. Honest gating: disconnected → connect; wrong chain → switch to Sepolia;
 * no market → disabled; 0 collateral → deposit guard; engine offline → error on submit.
 * Derived values are real (live mark) or honest '—' — no fabricated fill/quote.
 */
export function OrderTicket({
  market,
  trader,
  chainId,
  connected,
  wrongChain,
  markPrice,
  onConnect,
  onSwitchChain,
}: {
  market?: PerpMarketView
  trader?: Address
  chainId?: number
  connected: boolean
  wrongChain: boolean
  markPrice?: number
  onConnect: () => void
  onSwitchChain: () => void
}): JSX.Element {
  const [side, setSide] = useState<Side>('long')
  const [orderType, setOrderType] = useState<OrderType>('Market')
  const [leverage, setLeverage] = useState(10)
  const [size, setSize] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [collateralOpen, setCollateralOpen] = useState(false)

  const placeOrder = usePlaceOrder({ market, trader, chainId })
  const base = market?.base ?? 'BASE'
  const maxLev = placeOrder.maxLeverageX
  const accent = side === 'long' ? terminalColors.brandGreen : terminalColors.redDown
  const effLev = Math.min(leverage, maxLev)
  const pct = maxLev > 1 ? ((effLev - 1) / (maxLev - 1)) * 100 : 0

  // Receipt estimates from live mark + user inputs (client-side estimate, not a quote).
  const priceForEst = orderType === 'Limit' ? Number(limitPrice) : markPrice
  const sizeNum = Number(size)
  const notional = Number.isFinite(priceForEst) && Number.isFinite(sizeNum) && priceForEst ? priceForEst * sizeNum : undefined
  const marginEst = notional !== undefined && effLev > 0 ? notional / effLev : undefined

  const sizeValid = sizeNum > 0
  const limitValid = orderType === 'Market' || Number(limitPrice) > 0
  const inputsOk = sizeValid && limitValid
  const busy = placeOrder.status === 'signing' || placeOrder.status === 'submitting'

  const submitLabel = useMemo(() => {
    if (!connected) {
      return 'Connect wallet to trade'
    }
    if (wrongChain) {
      return 'Switch to Sepolia'
    }
    if (!market) {
      return 'No market selected'
    }
    if (placeOrder.status === 'signing') {
      return 'Sign order…'
    }
    if (placeOrder.status === 'submitting') {
      return 'Placing order…'
    }
    if (!placeOrder.hasCollateral && placeOrder.nonce !== undefined) {
      return 'Deposit collateral to trade'
    }
    return side === 'long' ? `Long ${base}` : `Short ${base}`
  }, [connected, wrongChain, market, placeOrder.status, placeOrder.hasCollateral, placeOrder.nonce, side, base])

  // The deposit guard is active once the account has loaded (nonce known) with 0 collateral.
  const needsDeposit = Boolean(market) && !placeOrder.hasCollateral && placeOrder.nonce !== undefined

  const canClick =
    !connected || wrongChain ? true : needsDeposit ? true : Boolean(market) && placeOrder.canSubmit && inputsOk && !busy

  const onSubmit = (): void => {
    if (!connected) {
      onConnect()
      return
    }
    if (wrongChain) {
      onSwitchChain()
      return
    }
    // No deposited collateral → open the funding drawer instead of a dead-end disabled state.
    if (needsDeposit) {
      setCollateralOpen(true)
      return
    }
    void placeOrder.submit({ side, orderType, sizeStr: size, leverage: effLev, limitPriceStr: limitPrice })
  }

  const fmtUsd = (v?: number): string => (v !== undefined ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : EMPTY)

  return (
    <div style={{ padding: 12, fontFamily: MONO }}>
      {/* Long / Short */}
      <div style={{ display: 'flex', background: terminalColors.panel2, borderRadius: 8, padding: 3, gap: 2, marginBottom: 10 }}>
        {(['long', 'short'] as const).map((s) => {
          const on = side === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              style={{
                flex: 1,
                fontFamily: MONO,
                fontSize: 12,
                fontWeight: 600,
                padding: 8,
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: on ? terminalColors.btnInk : terminalColors.ink3,
                background: on ? (s === 'long' ? terminalColors.brandGreen : terminalColors.redDown) : 'transparent',
              }}
            >
              {s}
            </button>
          )
        })}
      </div>

      {/* Market / Limit */}
      <div style={{ display: 'flex', background: terminalColors.panel2, borderRadius: 8, padding: 3, gap: 2, marginBottom: 10 }}>
        {(['Market', 'Limit'] as const).map((o) => {
          const on = orderType === o
          return (
            <button
              key={o}
              type="button"
              onClick={() => setOrderType(o)}
              style={{
                flex: 1,
                fontFamily: MONO,
                fontSize: 11,
                padding: 6,
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                color: on ? terminalColors.ink : terminalColors.ink3,
                background: on ? terminalColors.bg : 'transparent',
                boxShadow: on ? '0 1px 2px rgba(20,24,15,.08)' : 'none',
              }}
            >
              {o}
            </button>
          )
        })}
      </div>

      {/* Collateral — live available + a manage affordance (opens the deposit/withdraw drawer). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: terminalColors.panel,
          border: `1px solid ${terminalColors.line2}`,
          borderRadius: 8,
          padding: '7px 11px',
          marginBottom: 9,
        }}
      >
        <span style={{ fontSize: 10, color: terminalColors.ink3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Collateral
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: terminalColors.ink }}>{placeOrder.availableFormatted ?? EMPTY}</span>
          <button
            type="button"
            onClick={() => setCollateralOpen(true)}
            style={{
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              color: terminalColors.greenDeep,
              background: terminalColors.greenBg,
              border: `1px solid ${terminalColors.greenBorder}`,
              borderRadius: 6,
              padding: '4px 9px',
              cursor: 'pointer',
            }}
          >
            {placeOrder.hasCollateral ? 'Manage' : 'Deposit'}
          </button>
        </div>
      </div>

      {/* Size */}
      <Field top={['Size', `Avail ${placeOrder.availableFormatted ?? EMPTY}`]}>
        <input
          value={size}
          onChange={(e) => setSize(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="0.00"
          inputMode="decimal"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: MONO,
            fontSize: 16,
            fontWeight: 600,
            color: terminalColors.ink,
            minWidth: 0,
          }}
        />
        <span style={{ fontSize: 11, color: terminalColors.ink3 }}>{base}</span>
      </Field>

      {/* Limit price (Limit only) */}
      {orderType === 'Limit' ? (
        <Field top={['Limit price', market?.label ?? '']}>
          <input
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
            inputMode="decimal"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: MONO,
              fontSize: 16,
              fontWeight: 600,
              color: terminalColors.ink,
              minWidth: 0,
            }}
          />
          <span style={{ fontSize: 11, color: terminalColors.ink3 }}>USD</span>
        </Field>
      ) : null}

      {/* Leverage */}
      <div style={{ margin: '4px 0 12px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            color: terminalColors.ink3,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 7,
          }}
        >
          <span>Leverage</span>
          <b style={{ color: accent, fontSize: 13 }}>{effLev}×</b>
        </div>
        <div style={{ position: 'relative', height: 14 }}>
          <div style={{ position: 'absolute', top: 5, left: 0, right: 0, height: 5, background: terminalColors.panel2, borderRadius: 3 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: accent, borderRadius: 3 }} />
            <div
              style={{
                position: 'absolute',
                left: `${pct}%`,
                top: '50%',
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: '#fff',
                border: `2px solid ${accent}`,
                transform: 'translate(-50%,-50%)',
              }}
            />
          </div>
          <input
            type="range"
            min={1}
            max={maxLev}
            step={1}
            value={effLev}
            onChange={(e) => setLeverage(Number(e.target.value))}
            aria-label="Leverage"
            style={{ position: 'absolute', inset: 0, width: '100%', margin: 0, opacity: 0, cursor: 'pointer' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: terminalColors.faint, marginTop: 6 }}>
          {[1, Math.round(maxLev * 0.25), Math.round(maxLev * 0.5), Math.round(maxLev * 0.75), maxLev].map((t, i) => (
            <span key={i}>{t}×</span>
          ))}
        </div>
      </div>

      {/* Receipt */}
      <div style={{ borderTop: `1px dashed ${terminalColors.line}`, marginTop: 4, paddingTop: 8 }}>
        <ReceiptRow k="Entry (mark)" v={fmtUsd(markPrice)} />
        <ReceiptRow k="Notional" v={fmtUsd(notional)} />
        <ReceiptRow k="Margin (est.)" v={fmtUsd(marginEst)} />
        <ReceiptRow k="Liq. price" v={EMPTY} valueColor={terminalColors.ink3} />
        <ReceiptRow k="Fees · funding" v={EMPTY} />
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canClick}
        style={{
          width: '100%',
          height: 44,
          borderRadius: 9,
          marginTop: 10,
          border: 'none',
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: terminalColors.btnInk,
          background: wrongChain ? terminalColors.warn : accent,
          opacity: canClick ? 1 : 0.5,
          cursor: canClick ? 'pointer' : 'not-allowed',
        }}
      >
        {submitLabel}
      </button>

      {/* Status line — real order result / error, never fabricated. */}
      {placeOrder.status === 'submitted' && placeOrder.result ? (
        <div style={{ marginTop: 8, textAlign: 'center', fontSize: 10.5, color: terminalColors.greenDeep }}>
          Order {placeOrder.result.status} · {placeOrder.result.orderId.slice(0, 10)}
          {placeOrder.result.txHash ? ` · ${placeOrder.result.txHash.slice(0, 10)}…` : ''}
        </div>
      ) : placeOrder.error ? (
        <div style={{ marginTop: 8, textAlign: 'center', fontSize: 10.5, color: terminalColors.redDown }}>{placeOrder.error}</div>
      ) : !connected ? null : wrongChain ? (
        <div style={{ marginTop: 8, textAlign: 'center', fontSize: 10, color: terminalColors.faint }}>
          HookSwapPerps is live on Sepolia
        </div>
      ) : !market ? (
        <div style={{ marginTop: 8, textAlign: 'center', fontSize: 10, color: terminalColors.faint }}>Select a market to trade</div>
      ) : placeOrder.disabledReason && placeOrder.disabledReason !== 'Submitting…' ? (
        <div style={{ marginTop: 8, textAlign: 'center', fontSize: 10, color: terminalColors.faint }}>{placeOrder.disabledReason}</div>
      ) : null}

      {/* Deposit / withdraw collateral drawer. */}
      <CollateralDrawer
        open={collateralOpen}
        onClose={() => setCollateralOpen(false)}
        market={market}
        trader={trader}
        chainId={chainId ?? 0}
        connected={connected}
        wrongChain={wrongChain}
        onConnect={onConnect}
        onSwitchChain={onSwitchChain}
      />
    </div>
  )
}

function Field({ top, children }: { top: [string, string]; children: ReactNode }): JSX.Element {
  return (
    <div style={{ background: terminalColors.panel, border: `1px solid ${terminalColors.line2}`, borderRadius: 8, padding: '9px 11px', marginBottom: 9 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          color: terminalColors.ink3,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 5,
        }}
      >
        <span>{top[0]}</span>
        <span>{top[1]}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: MONO, fontSize: 16, fontWeight: 600 }}>
        {children}
      </div>
    </div>
  )
}

function ReceiptRow({ k, v, valueColor }: { k: string; v: string; valueColor?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontFamily: MONO, fontSize: 11 }}>
      <span style={{ color: terminalColors.ink3 }}>{k}</span>
      <span style={{ color: valueColor ?? terminalColors.ink }}>{v}</span>
    </div>
  )
}
