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
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

export interface TvlPoint {
  /** X-axis label (the snapshot's UTC date). */
  label: string
  /** Series value — always a finite number (callers filter out unpriced snapshots). */
  value: number
}

export function LedgerTvlChart({
  points,
  countPoints = [],
  countLabel = 'Activity over time',
  height = 240,
  emptyText = 'History builds as daily snapshots accrue.',
}: {
  points: TvlPoint[]
  /** Optional count series (activity) plotted when the USD series is empty/flat. */
  countPoints?: TvlPoint[]
  /** Caption naming the count series when it's the one being plotted. */
  countLabel?: string
  height?: number
  /** Overlay note shown when NEITHER series has ≥ 2 points (honest empty state). */
  emptyText?: string
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

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

      // Faint horizontal grid — drawn even when empty (the chart well).
      ctx.strokeStyle = terminalColors.line2
      ctx.lineWidth = 1
      for (let g = 1; g < 4; g++) {
        const y = (height / 4) * g
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
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
      ctx.strokeStyle = terminalColors.brandGreen
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
      ctx.fillStyle = terminalColors.brandGreen
      ctx.fill()
    }

    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [series, height])

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height }} />

      {/* Count-mode caption — names the plotted series so a count line is never read
          as a USD value (the panel header says "value", but here we plot activity). */}
      {mode === 'count' ? (
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

      {mode === 'none' ? (
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
  )
}
