/**
 * HookSwapPerps admin — shared operator-console UI primitives + the Safe-batch output panel.
 * DAYSIGNAL Terminal-native chrome (terminalColors/terminalFonts, IBM Plex Mono for
 * addresses/numbers, InstrumentPanel frames).
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { downloadSafeBatch, safeBatchToJson, type SafeBatch, type SafeBatchTransaction } from '~/terminal/screens/admin/safeBatch'

export const MONO = terminalFonts.mono
export const SANS = terminalFonts.sans
export const DISPLAY = terminalFonts.display

/* ------------------------------------------------------------------ panel */

export function Panel({
  title,
  meta,
  corners,
  children,
  padding = 16,
}: {
  title?: string
  meta?: ReactNode[]
  corners?: boolean
  children: ReactNode
  padding?: number
}): JSX.Element {
  return (
    <InstrumentPanel title={title} meta={meta} corners={corners} bodyStyle={{ padding }}>
      {children}
    </InstrumentPanel>
  )
}

/* ------------------------------------------------------------------ form fields */

export function FieldLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.ink3Alt, marginBottom: 5 }}>{children}</div>
}

export function TextField({
  value,
  onChange,
  placeholder,
  mono = true,
  inputMode,
  maxLength,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  inputMode?: 'text' | 'decimal' | 'numeric'
  maxLength?: number
}): JSX.Element {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      inputMode={inputMode}
      maxLength={maxLength}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${terminalColors.line2}`,
        borderRadius: 10,
        background: terminalColors.panel,
        padding: '9px 11px',
        fontFamily: mono ? MONO : SANS,
        fontSize: 13,
        fontWeight: mono ? 500 : 600,
        color: terminalColors.ink,
        outline: 'none',
      }}
    />
  )
}

export function SelectField({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { label: string; value: string }[]
}): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${terminalColors.line2}`,
        borderRadius: 10,
        background: terminalColors.panel,
        padding: '9px 11px',
        fontFamily: SANS,
        fontSize: 13,
        fontWeight: 600,
        color: terminalColors.ink,
        outline: 'none',
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/* ------------------------------------------------------------------ notices / badges */

export type Tone = 'neutral' | 'green' | 'muted' | 'red' | 'warn'

export function Notice({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }): JSX.Element {
  const border =
    tone === 'green' ? terminalColors.greenBorder : tone === 'red' ? terminalColors.redDown : tone === 'warn' ? terminalColors.warn : terminalColors.line
  const bg =
    tone === 'green' ? terminalColors.greenBg : tone === 'red' ? terminalColors.redBg : tone === 'warn' ? terminalColors.warnBg : terminalColors.panel
  const color =
    tone === 'green' ? terminalColors.greenDeep : tone === 'red' ? terminalColors.redDown : tone === 'warn' ? terminalColors.warn : terminalColors.ink2
  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: 12,
        lineHeight: 1.5,
        color,
        background: bg,
        border: `1px ${tone === 'muted' ? 'dashed' : 'solid'} ${border}`,
        borderRadius: 10,
        padding: '10px 12px',
      }}
    >
      {children}
    </div>
  )
}

export function Button({
  label,
  onClick,
  disabled,
  variant = 'solid',
  small = false,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'solid' | 'outline' | 'danger'
  small?: boolean
}): JSX.Element {
  const base: CSSProperties = {
    fontFamily: MONO,
    fontSize: small ? 11 : 12.5,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    padding: small ? '7px 12px' : '11px 14px',
    borderRadius: 10,
    cursor: disabled ? 'default' : 'pointer',
    width: '100%',
  }
  const style: CSSProperties =
    variant === 'solid'
      ? {
          ...base,
          color: terminalColors.btnInk,
          background: disabled ? terminalColors.line : terminalColors.brandGreen,
          border: 'none',
        }
      : variant === 'danger'
        ? {
            ...base,
            color: disabled ? terminalColors.faint : terminalColors.redDown,
            background: disabled ? terminalColors.panel : terminalColors.redBg,
            border: `1px solid ${disabled ? terminalColors.line : terminalColors.redDown}`,
          }
        : {
            ...base,
            color: disabled ? terminalColors.faint : terminalColors.ink,
            background: terminalColors.panel2,
            border: `1px solid ${terminalColors.line}`,
          }
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={style}>
      {label}
    </button>
  )
}

/** Simple label/value row (SANS label, MONO value). */
export function Row({ label, value, valueColor }: { label: ReactNode; value: ReactNode; valueColor?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 0' }}>
      <span style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3Alt }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500, color: valueColor ?? terminalColors.ink, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ Safe batch output */

function copyToClipboard(text: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(text)
  }
}

/**
 * Renders a generated Safe Transaction-Builder batch: the raw per-tx `to`/`value`/`data` (for
 * manual entry into the Safe UI), the full importable JSON, and copy + download controls.
 */
export function SafeBatchOutput({ batch, filename }: { batch: SafeBatch; filename: string }): JSX.Element {
  const json = useMemo(() => safeBatchToJson(batch), [batch])
  const [copied, setCopied] = useState(false)

  const onCopy = (): void => {
    copyToClipboard(json)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      style={{
        marginTop: 12,
        border: `1px solid ${terminalColors.greenBorder}`,
        borderRadius: 12,
        background: terminalColors.greenBg,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: terminalColors.greenDeep }}>
          Safe batch ready · {batch.transactions.length} tx · chainId {batch.chainId}
        </span>
      </div>

      {/* Raw per-tx to / value / data for manual entry */}
      {batch.transactions.map((tx: SafeBatchTransaction, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: i > 0 ? `1px dashed ${terminalColors.greenBorder}` : 'none', paddingTop: i > 0 ? 8 : 0 }}>
          <RawField label={`tx${i + 1} · method`} value={`${tx.contractMethod.name}(${tx.contractMethod.inputs.map((n) => n.type).join(', ')})`} />
          <RawField label="to" value={tx.to} />
          <RawField label="value" value={tx.value} />
          <RawField label="data" value={tx.data} wrap />
        </div>
      ))}

      {/* Full JSON */}
      <details>
        <summary style={{ fontFamily: MONO, fontSize: 11, color: terminalColors.greenDeep, cursor: 'pointer' }}>Transaction-Builder JSON</summary>
        <pre
          style={{
            margin: '8px 0 0',
            maxHeight: 260,
            overflow: 'auto',
            fontFamily: MONO,
            fontSize: 10.5,
            lineHeight: 1.5,
            color: terminalColors.ink,
            background: terminalColors.panel,
            border: `1px solid ${terminalColors.line}`,
            borderRadius: 8,
            padding: 10,
            whiteSpace: 'pre',
          }}
        >
          {json}
        </pre>
      </details>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button label={copied ? 'Copied' : 'Copy JSON'} variant="outline" small onClick={onCopy} />
        <Button label="Download .json" variant="solid" small onClick={() => downloadSafeBatch(batch, filename)} />
      </div>
      <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.ink3Alt, lineHeight: 1.5 }}>
        Import into the Safe → Apps → Transaction Builder (or paste the raw to/value/data), review, and collect owner
        signatures. This panel never sends the transaction — the Safe multisig does.
      </div>
    </div>
  )
}

function RawField({ label, value, wrap }: { label: string; value: string; wrap?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ fontFamily: MONO, fontSize: 10, color: terminalColors.ink3Alt, minWidth: 74, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10.5,
          color: terminalColors.ink,
          wordBreak: wrap ? 'break-all' : 'normal',
          overflowWrap: wrap ? 'anywhere' : 'normal',
        }}
      >
        {value}
      </span>
    </div>
  )
}
