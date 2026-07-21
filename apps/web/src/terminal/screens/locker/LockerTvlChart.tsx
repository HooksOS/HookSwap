/**
 * HookSwap Locker Analytics — "Ledger" TVL area chart (canvas).
 *
 * A glowing green area chart of daily total value locked, fed by the indexer's
 * `/tvl-history` snapshots (already filtered to points that carry a numeric
 * `totalTvlUsd`). Draws the faint background grid at all times; with < 2 priced
 * points it overlays an honest "TVL history builds as snapshots accrue" note
 * instead of a fabricated line. Never draws invented data.
 */
import { useEffect, useRef } from 'react'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

export interface TvlPoint {
  /** X-axis label (the snapshot's UTC date). */
  label: string
  /** TVL in USD — always a finite number (callers filter out unpriced snapshots). */
  value: number
}

export function LockerTvlChart({ points, height = 240 }: { points: TvlPoint[]; height?: number }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const enough = points.length >= 2

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

      if (points.length < 2) {
        return
      }

      const pad = 16
      const values = points.map((p) => p.value)
      let min = Math.min(...values)
      let max = Math.max(...values)
      if (max === min) {
        // Flat series — pad the range so the line sits mid-well rather than on an edge.
        const bump = Math.abs(max) || 1
        min -= bump
        max += bump
      }
      const n = points.length
      const px = (i: number): number => (n === 1 ? width / 2 : (i / (n - 1)) * width)
      const py = (v: number): number => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2)

      // Area fill — vertical green gradient fading to transparent.
      const grad = ctx.createLinearGradient(0, 0, 0, height)
      grad.addColorStop(0, 'rgba(23,179,87,0.28)')
      grad.addColorStop(1, 'rgba(23,179,87,0.02)')
      ctx.beginPath()
      ctx.moveTo(px(0), py(points[0].value))
      for (let i = 1; i < n; i++) {
        ctx.lineTo(px(i), py(points[i].value))
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
      ctx.moveTo(px(0), py(points[0].value))
      for (let i = 1; i < n; i++) {
        ctx.lineTo(px(i), py(points[i].value))
      }
      ctx.strokeStyle = terminalColors.brandGreen
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.restore()

      // Emphasized endpoint — halo + solid dot.
      const ex = px(n - 1)
      const ey = py(points[n - 1].value)
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
  }, [points, height])

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height }} />
      {!enough ? (
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
          TVL history builds as daily snapshots accrue.
        </div>
      ) : null}
    </div>
  )
}
