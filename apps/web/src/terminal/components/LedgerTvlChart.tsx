/**
 * HookSwap Terminal — shared "Ledger" area chart (canvas).
 *
 * A glowing green area chart of a daily value-over-time series, used by the Locker /
 * Farms / Vesting "Ledger" analytics views. Draws the faint background grid at all
 * times. Never draws invented data — callers pre-filter to points carrying a real
 * numeric value (unpriced snapshots are dropped, never zero-filled).
 *
 * ACTIVITY FALLBACK (honest, no fabricated USD): most tokens are unpriced, so the USD
 * series is usually empty. When there are < 2 priced USD points but the caller supplies
 * a COUNT series (`countPoints` — e.g. locks / farms / schedules per snapshot) with ≥ 2
 * points, the chart plots the COUNT line instead and shows a caption naming what's
 * plotted (so the line is never mistaken for a USD value). When BOTH are empty it keeps
 * the honest "builds as snapshots accrue" empty state. A USD series always wins when
 * present — a count line never masquerades as dollars.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { LedgerStack } from '~/terminal/components/ledgerPerChain'
import { resolveCssColor, resolveTerminalColor, terminalColors, terminalFonts } from '~/terminal/theme/tokens'

export interface TvlPoint {
  /** X-axis label (the snapshot's UTC date). */
  label: string
  /** Series value — always a finite number (callers filter out unpriced snapshots). */
  value: number
}

/** Compact legend value formatter for the stacked (per-chain) mode. */
function fmtStackValue(v: number, mode: LedgerStack['mode']): string {
  const compact = new Intl.NumberFormat('en-US', {
    notation: Math.abs(v) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: mode === 'usd' ? 2 : 0,
  }).format(v)
  return mode === 'usd' ? `$${compact}` : compact
}

export function LedgerTvlChart({
  points,
  countPoints = [],
  countLabel = 'Activity over time',
  height = 240,
  emptyText = 'History builds as daily snapshots accrue.',
  stack,
}: {
  points: TvlPoint[]
  /** Optional count series (activity) plotted when the USD series is empty/flat. */
  countPoints?: TvlPoint[]
  /** Caption naming the count series when it's the one being plotted. */
  countLabel?: string
  height?: number
  /** Overlay note shown when NEITHER series has ≥ 2 points (honest empty state). */
  emptyText?: string
  /**
   * Optional per-chain STACKED mode. When provided, the chart draws one filled band per
   * chain (`stack.series`) instead of the single `points`/`countPoints` line, and renders
   * a chain legend below. `points`/`countPoints` are ignored in this mode.
   */
  stack?: LedgerStack
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Stacked mode is valid only with ≥ 2 x-labels, ≥ 1 chain band, and something non-zero.
  const stackValid =
    stack !== undefined &&
    stack.xLabels.length >= 2 &&
    stack.series.length >= 1 &&
    stack.series.some((s) => s.values.some((v) => v > 0))

  // A USD series always wins; the count series is the honest activity fallback.
  const mode: 'usd' | 'count' | 'none' =
    points.length >= 2 ? 'usd' : countPoints.length >= 2 ? 'count' : 'none'
  const series = useMemo<TvlPoint[]>(
    () => (mode === 'usd' ? points : mode === 'count' ? countPoints : []),
    [mode, points, countPoints],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) {
      return
    }

    function draw(): void {
      const cv = canvasRef.current
      const w = wrapRef.current
      if (!cv || !w) {
        return
      }
      const rect = w.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const width = rect.width
      cv.width = width * dpr
      cv.height = height * dpr
      const ctx = cv.getContext('2d')
      if (!ctx) {
        return
      }
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, height)

      // Canvas can't parse var(--t-*) — resolve the active theme's real hex.
      const cLine2 = resolveTerminalColor('line2')
      const cGreen = resolveTerminalColor('brandGreen')

      // Faint horizontal grid — drawn even when empty (the chart well).
      ctx.strokeStyle = cLine2
      ctx.lineWidth = 1
      for (let g = 1; g < 4; g++) {
        const y = (height / 4) * g
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      // ── STACKED (per-chain) mode ────────────────────────────────────────────────
      if (stack && stackValid) {
        const n = stack.xLabels.length
        const pad = 16
        // Peak stacked total across the window → y-scale.
        let maxTotal = 0
        for (let x = 0; x < n; x++) {
          let sum = 0
          for (const s of stack.series) {
            sum += s.values[x] || 0
          }
          if (sum > maxTotal) {
            maxTotal = sum
          }
        }
        if (maxTotal <= 0) {
          return
        }
        const px = (i: number): number => (n === 1 ? width / 2 : (i / (n - 1)) * width)
        const py = (v: number): number => height - pad - (v / maxTotal) * (height - pad * 2)

        // Draw bands bottom-up, each filling from the running baseline to baseline+value.
        const baseline = new Array<number>(n).fill(0)
        for (const s of stack.series) {
          const top = baseline.map((b, i) => b + (s.values[i] || 0))
          ctx.beginPath()
          ctx.moveTo(px(0), py(top[0]))
          for (let i = 1; i < n; i++) {
            ctx.lineTo(px(i), py(top[i]))
          }
          for (let i = n - 1; i >= 0; i--) {
            ctx.lineTo(px(i), py(baseline[i]))
          }
          ctx.closePath()
          // Per-series color may be a var(--t-*) token — resolve to real hex for canvas.
          const sColor = resolveCssColor(s.color)
          ctx.save()
          ctx.globalAlpha = 0.55
          ctx.fillStyle = sColor
          ctx.fill()
          ctx.restore()
          // Crisp top edge.
          ctx.beginPath()
          ctx.moveTo(px(0), py(top[0]))
          for (let i = 1; i < n; i++) {
            ctx.lineTo(px(i), py(top[i]))
          }
          ctx.strokeStyle = sColor
          ctx.lineWidth = 1.5
          ctx.lineJoin = 'round'
          ctx.stroke()
          for (let i = 0; i < n; i++) {
            baseline[i] = top[i]
          }
        }
        return
      }

      if (series.length < 2) {
        return
      }

      const pad = 16
      const values = series.map((p) => p.value)
      let min = Math.min(...values)
      let max = Math.max(...values)
      if (max === min) {
        // Flat series — pad the range so the line sits mid-well rather than on an edge.
        const bump = Math.abs(max) || 1
        min -= bump
        max += bump
      }
      const n = series.length
      const px = (i: number): number => (n === 1 ? width / 2 : (i / (n - 1)) * width)
      const py = (v: number): number => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2)

      // Area fill — vertical green gradient fading to transparent.
      const grad = ctx.createLinearGradient(0, 0, 0, height)
      grad.addColorStop(0, 'rgba(23,179,87,0.28)')
      grad.addColorStop(1, 'rgba(23,179,87,0.02)')
      ctx.beginPath()
      ctx.moveTo(px(0), py(series[0].value))
      for (let i = 1; i < n; i++) {
        ctx.lineTo(px(i), py(series[i].value))
      }
      ctx.lineTo(px(n - 1), height)
      ctx.lineTo(px(0), height)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()

      // Glow + line stroke.
      ctx.save()
      ctx.shadowColor = 'rgba(12,138,66,0.45)'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.moveTo(px(0), py(series[0].value))
      for (let i = 1; i < n; i++) {
        ctx.lineTo(px(i), py(series[i].value))
      }
      ctx.strokeStyle = cGreen
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.restore()

      // Emphasized endpoint — halo + solid dot.
      const ex = px(n - 1)
      const ey = py(series[n - 1].value)
      ctx.beginPath()
      ctx.arc(ex, ey, 6, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(23,179,87,0.18)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(ex, ey, 3.2, 0, Math.PI * 2)
      ctx.fillStyle = cGreen
      ctx.fill()
    }

    draw()
    window.addEventListener('resize', draw)
    // Redraw with the new palette when the theme toggles (canvas can't reflow CSS vars).
    window.addEventListener('hookswap-theme-change', draw)
    return () => {
      window.removeEventListener('resize', draw)
      window.removeEventListener('hookswap-theme-change', draw)
    }
  }, [series, height, stack, stackValid])

  // In stacked mode the empty state shows when there's nothing real to draw.
  const stackEmpty = stack !== undefined && !stackValid

  return (
    <div>
      <div ref={wrapRef} style={{ position: 'relative', width: '100%', height }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height }} />

        {/* Stacked-mode caption — names what's plotted (USD vs per-chain count). */}
        {stack && stackValid ? (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 10,
              fontFamily: terminalFonts.mono,
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: terminalColors.faint,
              background: terminalColors.panel,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 6,
              padding: '2px 7px',
              pointerEvents: 'none',
            }}
          >
            {stack.caption}
          </div>
        ) : null}

        {stackEmpty ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '0 24px',
              fontFamily: terminalFonts.sans,
              fontSize: 12.5,
              color: terminalColors.faint,
              lineHeight: 1.5,
            }}
          >
            {emptyText}
          </div>
        ) : null}

        {/* Count-mode caption — names the plotted series so a count line is never read
          as a USD value (the panel header says "value", but here we plot activity). */}
        {!stack && mode === 'count' ? (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 10,
            fontFamily: terminalFonts.mono,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: terminalColors.faint,
            background: terminalColors.panel,
            border: `1px solid ${terminalColors.line}`,
            borderRadius: 6,
            padding: '2px 7px',
            pointerEvents: 'none',
          }}
        >
          {countLabel}
        </div>
        ) : null}

        {!stack && mode === 'none' ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '0 24px',
              fontFamily: terminalFonts.sans,
              fontSize: 12.5,
              color: terminalColors.faint,
              lineHeight: 1.5,
            }}
          >
            {emptyText}
          </div>
        ) : null}
      </div>

      {/* Per-chain legend — chain colour swatch + latest stacked value. */}
      {stack && stackValid ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 12 }}>
          {stack.series.map((s) => {
            const latest = s.values[s.values.length - 1] || 0
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                <span style={{ fontFamily: terminalFonts.sans, fontSize: 11.5, color: terminalColors.ink2 }}>{s.label}</span>
                <span style={{ fontFamily: terminalFonts.mono, fontSize: 11, color: terminalColors.faint }}>
                  {fmtStackValue(latest, stack.mode)}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
