import { ReactNode, useState } from 'react'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { EMPTY, PerpInstrument } from '~/terminal/screens/perps/perpsCatalog'

const MONO = terminalFonts.mono

type Side = 'long' | 'short'
type OrderType = 'Market' | 'Limit' | 'Stop'

/**
 * Order ticket — Long/Short toggle (green/short-red), Market/Limit/Stop segment,
 * size, a live LEVERAGE slider, TP/SL, and a settlement receipt (entry / liq /
 * margin / fees·funding). The control surfaces are interactive; every derived
 * *value* (avail balance, entry, liq price, margin, fees) renders an honest '—'
 * because the matching engine isn't live. The submit button reflects real wallet
 * state: disconnected → "Connect wallet to trade" (opens the drawer); connected →
 * disabled (engine offline). No quote is ever fabricated.
 */
export function OrderTicket({
  instrument,
  connected,
  onConnect,
}: {
  instrument: PerpInstrument
  connected: boolean
  onConnect: () => void
}): JSX.Element {
  const [side, setSide] = useState<Side>('long')
  const [orderType, setOrderType] = useState<OrderType>('Market')
  const [leverage, setLeverage] = useState(10)
  const [size, setSize] = useState('')

  const accent = side === 'long' ? terminalColors.brandGreen : terminalColors.redDown
  const pct = ((leverage - 1) / (instrument.maxLeverage - 1)) * 100

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

      {/* Market / Limit / Stop */}
      <div style={{ display: 'flex', background: terminalColors.panel2, borderRadius: 8, padding: 3, gap: 2, marginBottom: 10 }}>
        {(['Market', 'Limit', 'Stop'] as const).map((o) => {
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

      {/* Size */}
      <Field top={['Size', `Avail ${EMPTY}`]}>
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
        <span style={{ fontSize: 11, color: terminalColors.ink3 }}>{instrument.base}</span>
      </Field>

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
          <b style={{ color: accent, fontSize: 13 }}>{leverage}×</b>
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
            max={instrument.maxLeverage}
            step={1}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            aria-label="Leverage"
            style={{ position: 'absolute', inset: 0, width: '100%', margin: 0, opacity: 0, cursor: 'pointer' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: terminalColors.faint, marginTop: 6 }}>
          {[1, Math.round(instrument.maxLeverage * 0.25), Math.round(instrument.maxLeverage * 0.5), Math.round(instrument.maxLeverage * 0.75), instrument.maxLeverage].map(
            (t, i) => (
              <span key={i}>{t}×</span>
            ),
          )}
        </div>
      </div>

      {/* TP / SL */}
      <Field top={['TP / SL', 'optional']}>
        <span style={{ fontSize: 13, color: terminalColors.ink3 }}>{EMPTY}</span>
        <span style={{ fontSize: 13, color: terminalColors.ink3 }}>{EMPTY}</span>
      </Field>

      {/* Receipt */}
      <div style={{ borderTop: `1px dashed ${terminalColors.line}`, marginTop: 4, paddingTop: 8 }}>
        <ReceiptRow k="Entry (mark)" v={EMPTY} />
        <ReceiptRow k="Liq. price" v={EMPTY} valueColor={terminalColors.ink3} />
        <ReceiptRow k="Margin (isolated)" v={EMPTY} />
        <ReceiptRow k="Fees · funding" v={EMPTY} />
      </div>

      {/* Submit */}
      {connected ? (
        <button
          type="button"
          disabled
          title="HookSwapPerps matching engine is not live yet"
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
            background: accent,
            opacity: 0.5,
            cursor: 'not-allowed',
          }}
        >
          {side === 'long' ? `Long ${instrument.base}` : `Short ${instrument.base}`}
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
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
            background: accent,
            cursor: 'pointer',
          }}
        >
          Connect wallet to trade
        </button>
      )}
      {connected ? (
        <div style={{ marginTop: 8, textAlign: 'center', fontSize: 10, color: terminalColors.faint }}>
          Matching engine not live yet
        </div>
      ) : null}
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
