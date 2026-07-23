/**
 * HookSwap Terminal — Farms shared UI primitives + formatters.
 *
 * Small, presentational building blocks shared by the Farms create wizard
 * (`CreateFarmWizard`) and the stake/manage panel (`FarmsManage`), plus the
 * pure formatting helpers both need. Kept in one module so the two screens reuse
 * one set of fields / buttons / notices / step chrome instead of duplicating them.
 *
 * DATA POLICY (facts-only): nothing here fabricates data — formatters return an
 * honest "—" when a value isn't known yet, and the token preview reflects only
 * REAL on-chain symbol/decimals reads passed in by the caller.
 */
import type { CSSProperties, ReactNode } from 'react'
import { LedgerAvatar, resolveLedgerLogo } from '~/terminal/components/LedgerAvatar'
import { terminalKeycap } from '~/terminal/components/InstrumentPanel'
import { formatUnits } from '~/chains'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

export const MONO = terminalFonts.mono
export const DISPLAY = terminalFonts.display
export const SANS = terminalFonts.sans

export const SECONDS_PER_DAY = 86_400

/* ------------------------------------------------------------------ formatters */

/** Whole days string → seconds, or undefined when empty/invalid. */
export function daysToSeconds(value: string): number | undefined {
  if (value === '') {
    return undefined
  }
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    return undefined
  }
  return Math.floor(n * SECONDS_PER_DAY)
}

/** Seconds → a compact human label (e.g. "2y 6mo", "14d", "3h"). */
export function fmtDuration(seconds: number): string {
  if (seconds <= 0) {
    return '0'
  }
  const years = Math.floor(seconds / 31_536_000)
  const afterYears = seconds - years * 31_536_000
  const months = Math.floor(afterYears / 2_592_000)
  const afterMonths = afterYears - months * 2_592_000
  const days = Math.floor(afterMonths / SECONDS_PER_DAY)
  const parts: string[] = []
  if (years > 0) {
    parts.push(`${years}y`)
  }
  if (months > 0) {
    parts.push(`${months}mo`)
  }
  if (days > 0) {
    parts.push(`${days}d`)
  }
  if (parts.length === 0) {
    const hours = Math.floor(seconds / 3600)
    if (hours > 0) {
      return `${hours}h`
    }
    const mins = Math.floor(seconds / 60)
    return mins > 0 ? `${mins}m` : `${seconds}s`
  }
  return parts.join(' ')
}

/** Raw token units → a readable amount using the token's real decimals ("—" until known). */
export function fmtAmount(raw?: bigint, decimals?: number): string {
  if (raw === undefined || decimals === undefined) {
    return '—'
  }
  const n = Number(formatUnits(raw, decimals))
  if (!Number.isFinite(n)) {
    return '—'
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

/* ------------------------------------------------------------------ fields */

export function FieldLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3Alt, marginBottom: 6 }}>{children}</div>
}

export function TextField({
  value,
  onChange,
  placeholder,
  mono = true,
  inputMode,
  suffix,
  tone = 'neutral',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  inputMode?: 'text' | 'decimal' | 'numeric'
  /** Optional right-aligned unit/suffix (e.g. a reward symbol or "days"). */
  suffix?: ReactNode
  /** Border emphasis: green when the field is valid+resolved, red on an inline error. */
  tone?: 'neutral' | 'valid' | 'error'
}): JSX.Element {
  const borderColor =
    tone === 'valid' ? terminalColors.greenBorder : tone === 'error' ? terminalColors.redDown : terminalColors.line
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${borderColor}`,
        borderRadius: 11,
        background: terminalColors.panel,
        padding: '0 12px',
      }}
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        spellCheck={false}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          background: 'transparent',
          padding: '11px 0',
          fontFamily: mono ? MONO : SANS,
          fontSize: 13.5,
          fontWeight: 500,
          color: terminalColors.ink,
          outline: 'none',
        }}
      />
      {suffix != null ? (
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: terminalColors.ink3, whiteSpace: 'nowrap', paddingLeft: 8 }}>
          {suffix}
        </span>
      ) : null}
    </div>
  )
}

export function InlineError({ children }: { children: ReactNode }): JSX.Element {
  return <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 6, lineHeight: 1.4 }}>{children}</div>
}

export function InlineHint({ children }: { children: ReactNode }): JSX.Element {
  return <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3Alt, marginTop: 6, lineHeight: 1.4 }}>{children}</div>
}

/* ------------------------------------------------------------------ token preview */

function initials(symbol?: string): string {
  return (symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
}

/** A resolved-token chip: hue/logo avatar + symbol + decimals — REAL on-chain reads only. */
export function TokenPreview({
  chainId,
  address,
  symbol,
  decimals,
}: {
  chainId?: number
  address?: string
  symbol?: string
  decimals?: number
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginTop: 8,
        padding: '8px 10px',
        borderRadius: 10,
        border: `1px solid ${terminalColors.greenBorder}`,
        background: terminalColors.greenBg,
      }}
    >
      <LedgerAvatar
        seed={address || symbol || '?'}
        initials={initials(symbol)}
        size={26}
        logoUrl={resolveLedgerLogo(chainId, address)}
      />
      <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: terminalColors.ink }}>{symbol ?? '…'}</span>
      {decimals !== undefined ? (
        <span style={{ fontFamily: MONO, fontSize: 11.5, color: terminalColors.ink3 }}>· {decimals} decimals</span>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ step chrome */

/** A numbered step card — the spine of the de-crammed create wizard. */
export function StepCard({
  index,
  title,
  hint,
  status,
  children,
}: {
  index: number
  title: string
  hint?: string
  status: 'active' | 'done' | 'pending'
  children: ReactNode
}): JSX.Element {
  const done = status === 'done'
  const active = status === 'active'
  const badgeBg = done || active ? terminalColors.brandGreen : terminalColors.panel2
  const badgeInk = done || active ? terminalColors.btnInk : terminalColors.ink3
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        padding: '18px 20px',
        borderRadius: 14,
        border: `1px solid ${active ? terminalColors.greenBorder : terminalColors.line}`,
        background: terminalColors.bg,
        boxShadow: active ? '0 1px 2px rgba(11,15,20,.05)' : undefined,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: badgeBg,
          color: badgeInk,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: MONO,
          fontSize: 12.5,
          fontWeight: 700,
        }}
      >
        {done ? '✓' : index}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: hint ? 3 : 12 }}>
          <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: terminalColors.ink }}>{title}</span>
        </div>
        {hint ? <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3Alt, marginBottom: 12, lineHeight: 1.45 }}>{hint}</div> : null}
        {children}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ misc */

export function SummaryRow({ label, value, valueColor }: { label: string; value: ReactNode; valueColor?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', gap: 12, borderBottom: `1px solid ${terminalColors.line3}` }}>
      <span style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3Alt, whiteSpace: 'nowrap' }}>{label}</span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12.5,
          fontWeight: 500,
          color: valueColor ?? terminalColors.ink,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  )
}

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'muted' | 'red'; children: ReactNode }): JSX.Element {
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
        padding: '11px 13px',
      }}
    >
      {children}
    </div>
  )
}

export function PrimaryButton({ label, onClick, disabled, style }: { label: string; onClick: () => void; disabled?: boolean; style?: CSSProperties }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        fontFamily: MONO,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontSize: 13,
        fontWeight: 600,
        color: terminalColors.btnInk,
        background: disabled ? terminalColors.line : terminalColors.brandGreen,
        border: 'none',
        padding: '13px 0',
        borderRadius: 12,
        cursor: disabled ? 'default' : 'pointer',
        ...style,
      }}
    >
      {label}
    </button>
  )
}

/** A secondary (keycap) action button, used for Claim / Unstake alongside the primary CTA. */
export function SecondaryButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...terminalKeycap,
        width: '100%',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontSize: 12.5,
        color: disabled ? terminalColors.faint : terminalColors.greenDeep,
        padding: '11px 0',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}

export function ConnectInline({ text, onConnect }: { text: string; onConnect: () => void }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '10px 0' }}>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink2 }}>{text}</div>
      <button
        type="button"
        onClick={onConnect}
        style={{
          fontFamily: MONO,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontSize: 12.5,
          fontWeight: 600,
          color: terminalColors.btnInk,
          background: terminalColors.brandGreen,
          border: 'none',
          padding: '9px 18px',
          borderRadius: 11,
          cursor: 'pointer',
        }}
      >
        Connect wallet
      </button>
    </div>
  )
}

/** Honest note: APR needs a USD price for both tokens, unavailable pre-anchor. */
export function AprNote(): JSX.Element {
  return (
    <Notice tone="muted">
      APR is shown once a USD anchor pool is live — until then this farm reports its reward rate and staked amounts in
      token terms only (no fabricated yield %).
    </Notice>
  )
}

/** Honest "contract not deployed on this chain" note. */
export function NotDeployedNote({ chainLabel }: { chainLabel: string }): JSX.Element {
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
        padding: '13px 15px',
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
      Farms aren&apos;t live on {chainLabel} yet — this panel activates automatically once the HookSwap staking-rewards
      factory is deployed there. Switch to a supported network to launch or manage a farm now.
    </div>
  )
}
