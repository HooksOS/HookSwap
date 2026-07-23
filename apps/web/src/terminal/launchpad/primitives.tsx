/**
 * HookSwap Terminal — LaunchPad shared UI primitives.
 *
 * These 9 building blocks (Panel / StepLabel / FieldLabel / TextField / ToggleRow / SummaryRow /
 * Notice / PrimaryButton / NotDeployedNote) were originally local to `LaunchCreateScreen.tsx`.
 * They are extracted here verbatim (no behavior change) so every launch engine — Bonding Curve,
 * Fair Launch · v3, Quick Launch, Stock Reward — renders from the same Terminal-dense vocabulary.
 *
 * Also exports the shared font aliases + a few input sanitizers / formatters the engines share.
 */
import { formatUnits } from '~/chains'
import { InstrumentPanel, terminalKeycap } from '~/terminal/components/InstrumentPanel'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

export const MONO = terminalFonts.mono
export const DISPLAY = terminalFonts.display
export const SANS = terminalFonts.sans

/* ------------------------------------------------------------------ helpers */

/** Keep only 0-9. */
export function onlyDigits(v: string): string {
  return v.replace(/[^0-9]/g, '')
}

/** Keep a single leading '-' plus digits (int24 tick fields). */
export function onlySignedDigits(v: string): string {
  const neg = v.trim().startsWith('-')
  const digits = v.replace(/[^0-9]/g, '')
  return (neg ? '-' : '') + digits
}

/** Keep digits + a single decimal point (ether-denominated dev-buy fields). */
export function onlyDecimal(v: string): string {
  const cleaned = v.replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) {
    return cleaned
  }
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

/** Format a wei value as a human 18-dec number ('—' when undefined). */
export function fmtWei(wei: bigint | undefined): string {
  if (wei === undefined) {
    return '—'
  }
  if (wei === 0n) {
    return '0'
  }
  return Number(formatUnits(wei, 18)).toLocaleString('en-US', { maximumFractionDigits: 6 })
}

/** Format a 1e18-scaled USD value (e.g. 8e18 → "$8.00"). '—' when undefined. */
export function fmtUsd(usd18: bigint | undefined): string {
  if (usd18 === undefined) {
    return '—'
  }
  const n = Number(formatUnits(usd18, 18))
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/* ------------------------------------------------------------------ primitives */

export function Panel({
  title,
  meta,
  corners,
  children,
  padding = 18,
}: {
  title?: string
  meta?: React.ReactNode[]
  corners?: boolean
  children: React.ReactNode
  padding?: number
}): JSX.Element {
  return (
    <InstrumentPanel title={title} meta={meta} corners={corners} bodyStyle={{ padding }}>
      {children}
    </InstrumentPanel>
  )
}

export function StepLabel({ index, label, note }: { index: string; label: string; note?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
      <span
        style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', color: terminalColors.ink3Alt }}
      >
        {index} · {label.toUpperCase()}
      </span>
      {note ? <span style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.ink3Alt }}>{note}</span> : null}
    </div>
  )
}

export function FieldLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.ink3Alt, marginBottom: 5 }}>{children}</div>
}

export function TextField({
  value,
  onChange,
  placeholder,
  mono = false,
  maxLength,
  inputMode,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  maxLength?: number
  inputMode?: 'text' | 'decimal' | 'numeric'
}): JSX.Element {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      maxLength={maxLength}
      inputMode={inputMode}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${terminalColors.line2}`,
        borderRadius: 11,
        background: terminalColors.panel,
        padding: '10px 12px',
        fontFamily: mono ? MONO : SANS,
        fontSize: 13.5,
        fontWeight: mono ? 500 : 600,
        color: terminalColors.ink,
        outline: 'none',
      }}
    />
  )
}

export function SummaryRow({
  label,
  value,
  valueColor,
}: {
  label: string
  value: React.ReactNode
  valueColor?: string
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0' }}>
      <span style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500, color: valueColor ?? terminalColors.ink }}>
        {value}
      </span>
    </div>
  )
}

export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'green' | 'muted' | 'red'
  children: React.ReactNode
}): JSX.Element {
  const border = tone === 'green' ? terminalColors.greenBorder : tone === 'red' ? terminalColors.redDown : terminalColors.line
  const bg = tone === 'green' ? terminalColors.greenBg : tone === 'red' ? terminalColors.redBg : terminalColors.panel
  const color = tone === 'green' ? terminalColors.greenDeep : tone === 'red' ? terminalColors.redDown : terminalColors.ink2
  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: 12,
        lineHeight: 1.5,
        color,
        background: bg,
        border: `1px ${tone === 'muted' ? 'dashed' : 'solid'} ${border}`,
        borderRadius: 11,
        padding: '10px 12px',
      }}
    >
      {children}
    </div>
  )
}

export function PrimaryButton({
  label,
  onClick,
  disabled,
  variant = 'solid',
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'solid' | 'outline'
}): JSX.Element {
  const solid = variant === 'solid'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        marginTop: 12,
        width: '100%',
        fontFamily: MONO,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding: '12px 0',
        cursor: disabled ? 'default' : 'pointer',
        ...(solid
          ? {
              color: terminalColors.btnInk,
              background: disabled ? terminalColors.line : terminalColors.brandGreen,
              border: 'none',
              borderRadius: 12,
            }
          : { ...terminalKeycap, borderRadius: 12 }),
      }}
    >
      {label}
    </button>
  )
}

export function NotDeployedNote({ chainLabel, message }: { chainLabel: string; message?: string }): JSX.Element {
  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: 12.5,
        color: terminalColors.ink3Alt,
        lineHeight: 1.5,
        border: `1px dashed ${terminalColors.line}`,
        borderRadius: 11,
        background: terminalColors.panel,
        padding: '11px 13px',
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: terminalColors.greenDeep,
          marginBottom: 6,
        }}
      >
        COMING SOON
      </div>
      {message ??
        `Launching isn't live on ${chainLabel} yet — this screen activates automatically once the launcher is deployed.`}
    </div>
  )
}

/** Pill-style toggle group for DEX / pair / boolean selectors. */
export function ToggleRow({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[]
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              color: active ? terminalColors.greenDeep : terminalColors.ink3Alt,
              background: active ? terminalColors.greenBg : 'transparent',
              border: `1px solid ${active ? terminalColors.greenBorder : terminalColors.line}`,
              borderRadius: 8,
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ engine shell */

/** A mono pill (green) used for engine identity + status chips. */
export function Pill({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 11,
        fontWeight: 600,
        color: terminalColors.greenDeep,
        background: terminalColors.greenBg,
        border: `1px solid ${terminalColors.greenBorder}`,
        padding: '3px 8px',
        borderRadius: 999,
      }}
    >
      {children}
    </span>
  )
}

/**
 * The compact per-engine identity row (pill + one-line description), shown at the top of each
 * engine panel. The big page title stays generic ("Launch a token — any way you want"); the
 * selected engine's identity comes from its picker card + this row.
 */
export function EngineIntro({ pill, description }: { pill: string; description: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
      <Pill>{pill}</Pill>
      <span style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink2, lineHeight: 1.5 }}>
        {description}
      </span>
    </div>
  )
}

/** The two-column config | review layout every engine reuses. */
export function TwoColumn({ left, right }: { left: React.ReactNode; right: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>{left}</div>
      <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>{right}</div>
    </div>
  )
}
