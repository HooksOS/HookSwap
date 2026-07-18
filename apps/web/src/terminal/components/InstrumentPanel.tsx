import { CSSProperties, ReactNode } from 'react'
import { terminalColors, terminalFonts, terminalRadii } from '~/terminal/theme/tokens'

/**
 * HookSwap Terminal — "Desk" instrument panel.
 *
 * The signature surface of the Daylight redesign: a flat white panel on cool
 * paper, framed in a 1px hairline (NO drop shadow — paper is flat), with an
 * uppercase-mono header bar (optional live dot + right-aligned meta) and, when
 * `corners` is set, two green L-shaped registration ticks at opposite corners —
 * the lab-instrument signature.
 *
 * Presentational only. Feed it a real, data-bound body; keep honest empty/'—'
 * states inside `children`.
 */
export interface InstrumentPanelProps {
  /** Uppercase-mono label shown in the header bar. Omit for a bare framed panel. */
  title?: string
  /** Show the pulsing green "live" dot before the title. */
  live?: boolean
  /** Right-aligned mono meta chips in the header (e.g. ['Robinhood', '1D']). */
  meta?: ReactNode[]
  /** Draw the green corner registration ticks (top-left + bottom-right). */
  corners?: boolean
  /** Remove body padding (for tables / lists that manage their own insets). */
  flush?: boolean
  style?: CSSProperties
  bodyStyle?: CSSProperties
  children: ReactNode
}

export function InstrumentPanel({
  title,
  live,
  meta,
  corners,
  flush,
  style,
  bodyStyle,
  children,
}: InstrumentPanelProps): JSX.Element {
  return (
    <div className={corners ? 'tm-panel tm-panel--tick' : 'tm-panel'} style={style}>
      {title != null ? (
        <div className="tm-panel__head">
          {live ? <span className="tm-panel__live" /> : null}
          <span className="tm-panel__title">{title}</span>
          {meta && meta.length ? (
            <span className="tm-panel__meta">
              {meta.map((m, i) => (
                <span key={i}>{m}</span>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
      <div style={{ padding: flush ? 0 : 16, ...bodyStyle }}>{children}</div>
    </div>
  )
}

/** Shared mono eyebrow / section-kicker label (uppercase, tracked). */
export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }): JSX.Element {
  return (
    <span
      style={{
        fontFamily: terminalFonts.mono,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.13em',
        textTransform: 'uppercase',
        color: terminalColors.ink3,
        ...style,
      }}
    >
      {children}
    </span>
  )
}

/** Keycap-style secondary button surface token set (paper key with a hairline + bottom edge). */
export const terminalKeycap: CSSProperties = {
  background: terminalColors.bg,
  color: terminalColors.ink,
  border: `1px solid ${terminalColors.line}`,
  boxShadow: `0 1.5px 0 ${terminalColors.line}`,
  borderRadius: terminalRadii.buttonMin,
  fontFamily: terminalFonts.mono,
  fontWeight: 600,
}
