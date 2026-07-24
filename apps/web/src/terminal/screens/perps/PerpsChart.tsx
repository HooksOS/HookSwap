import { useEffect, useRef } from 'react'
import { resolveTerminalColor, terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { EMPTY } from '~/terminal/screens/perps/perpsCatalog'

const MONO = terminalFonts.mono

/** One OHLC candle. Kept for when the live feed is wired; empty for now. */
export interface Candle {
  o: number
  h: number
  l: number
  c: number
}

/**
 * Candlestick chart (canvas). Draws the faint background grid at all times and
 * renders candles supplied by `useCandles` (engine `GET /candles`, built from the
 * mark series + trade prints). Until candles accrue it overlays a centered
 * "Building price history…" note. NEVER draws fabricated candles.
 */
export function PerpsChart({ candles = [], height = 360 }: { candles?: Candle[]; height?: number }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) {
      return
    }

    function draw(): void {
      // Re-checked inside the closure so TS narrows across the async boundary.
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

      // Canvas can't parse var(--t-*) — resolve the active theme's real hexes.
      const cLine2 = resolveTerminalColor('line2')
      const cGreen = resolveTerminalColor('brandGreen')
      const cRed = resolveTerminalColor('redDown')

      // Faint horizontal grid — drawn even when empty (the chart well).
      ctx.strokeStyle = cLine2
      ctx.lineWidth = 1
      for (let g = 1; g < 5; g++) {
        const y = (height / 5) * g
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      if (!candles.length) {
        return
      }

      // Live candles (only reached once the feed is wired).
      const all = candles.flatMap((c) => [c.o, c.h, c.l, c.c])
      const min = Math.min(...all)
      const max = Math.max(...all)
      const pad = 14
      const py = (v: number): number => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2)
      const bw = width / candles.length
      candles.forEach((c, i) => {
        const cx = i * bw + bw / 2
        const up = c.c >= c.o
        const col = up ? cGreen : cRed
        ctx.strokeStyle = col
        ctx.fillStyle = col
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx, py(c.h))
        ctx.lineTo(cx, py(c.l))
        ctx.stroke()
        const yO = py(c.o)
        const yC = py(c.c)
        ctx.fillRect(cx - bw * 0.3, Math.min(yO, yC), bw * 0.6, Math.max(2, Math.abs(yC - yO)))
      })
    }

    draw()
    window.addEventListener('resize', draw)
    // Redraw with the new palette when the theme toggles (canvas can't reflow CSS vars).
    window.addEventListener('hookswap-theme-change', draw)
    return () => {
      window.removeEventListener('resize', draw)
      window.removeEventListener('hookswap-theme-change', draw)
    }
  }, [candles, height])

  const last = candles.length ? candles[candles.length - 1] : undefined
  const fmt = (v: number | undefined): string => (v !== undefined ? v.toLocaleString('en-US') : EMPTY)

  return (
    <div>
      <div ref={wrapRef} style={{ position: 'relative', width: '100%', height }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height }} />
        {!candles.length ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: MONO,
              fontSize: 11,
              color: terminalColors.faint,
            }}
          >
            Building price history…
          </div>
        ) : null}
      </div>
      {/* OHLC readout — honest '—' until candles arrive. */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          padding: '10px 2px 0',
          fontFamily: MONO,
          fontSize: 11,
          color: terminalColors.ink3,
          flexWrap: 'wrap',
        }}
      >
        {(
          [
            ['O', fmt(last?.o)],
            ['H', fmt(last?.h)],
            ['L', fmt(last?.l)],
            ['C', fmt(last?.c)],
            ['VOL', EMPTY],
          ] as const
        ).map(([k, v]) => (
          <span key={k}>
            {k} <b style={{ color: terminalColors.ink }}>{v}</b>
          </span>
        ))}
      </div>
    </div>
  )
}
