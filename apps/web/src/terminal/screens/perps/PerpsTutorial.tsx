/**
 * HookSwapPerps — interactive first-visit walkthrough.
 *
 * A dismissable, step-by-step spotlight tour of the Pro Desk. On first visit it
 * auto-starts (persisted via localStorage), dimming the desk and highlighting
 * each panel in turn — watchlist → chart → order book/trades → ticket →
 * positions — with a short, chain-agnostic explanation. Users can replay it any
 * time from the "Tutorial" button on the desk.
 *
 * Targets are resolved by `[data-tut="<key>"]` attributes on the desk grid cells,
 * so this component stays presentational and never couples to panel internals.
 * Purely a UI overlay — it reads/writes no trading state and fabricates no data.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

export interface TutorialStep {
  /** Matches a `[data-tut="key"]` element on the desk. Omit for a centered intro card. */
  target?: string
  title: string
  body: string
}

/** The desk tour — generic perps mechanics, no testnet/chain specifics. */
export const PERPS_TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Welcome to the perps desk',
    body: 'A 60-second tour of how to read and trade this desk. Perpetual futures let you take leveraged long or short exposure with no expiry. You can skip any time.',
  },
  {
    target: 'watchlist',
    title: '1 · Markets',
    body: 'Pick what to trade. Each row is its own isolated market — selecting one loads its order book, chart, and ticket. Your margin in one market never spills into another.',
  },
  {
    target: 'chart',
    title: '2 · Mark price & chart',
    body: 'The mark price is what your PnL and liquidations settle against. It tracks an oracle index price; the periodic funding payment nudges longs and shorts toward that index over time.',
  },
  {
    target: 'orderbook',
    title: '3 · Order book & trades',
    body: 'Resting bids (buyers) and asks (sellers), plus the live trade tape. The spread is the gap between the best bid and ask — your orders fill against this book and print in Trades.',
  },
  {
    target: 'ticket',
    title: '4 · Order ticket',
    body: 'Go long (profit if price rises) or short (profit if it falls) with leverage on isolated margin. Set size, leverage, and price, then sign to place. Higher leverage means a closer liquidation price.',
  },
  {
    target: 'positions',
    title: '5 · Positions & orders',
    body: 'Your open positions show entry, live PnL, and liquidation price; resting orders sit below. Close a position or cancel an order at any time — and watch the liquidation price when leveraged.',
  },
]

const SPOTLIGHT_PAD = 8

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function readSeen(storageKey: string): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(storageKey) === '1'
  } catch {
    return true // storage blocked → treat as seen so we don't nag
  }
}

function writeSeen(storageKey: string): void {
  try {
    window.localStorage.setItem(storageKey, '1')
  } catch {
    /* ignore */
  }
}

export interface PerpsTutorialProps {
  steps: TutorialStep[]
  storageKey: string
  /** Only auto-start / allow targeting once the desk grid is actually rendered. */
  ready: boolean
  /** Bump to force-open the tour (from a "Tutorial" button). 0 = never manually opened. */
  openSignal: number
}

export function PerpsTutorial({ steps, storageKey, ready, openSignal }: PerpsTutorialProps): JSX.Element | null {
  const [active, setActive] = useState(false)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)

  // Auto-start on first visit once the desk is rendered.
  useEffect(() => {
    if (!ready || active) {
      return
    }
    if (!readSeen(storageKey)) {
      // Defer a tick so the grid has painted and targets are measurable.
      const t = setTimeout(() => {
        setIndex(0)
        setActive(true)
      }, 350)
      return () => clearTimeout(t)
    }
    return undefined
  }, [ready, active, storageKey])

  // Manual (re)open from the desk button.
  useEffect(() => {
    if (openSignal > 0) {
      setIndex(0)
      setActive(true)
    }
  }, [openSignal])

  const step = active ? steps[index] : undefined

  const measure = useCallback(() => {
    if (!step?.target) {
      setRect(null)
      return
    }
    const el = document.querySelector<HTMLElement>(`[data-tut="${step.target}"]`)
    if (!el) {
      setRect(null)
      return
    }
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [step])

  // Measure on step change; scroll the target into view first.
  useLayoutEffect(() => {
    if (!active) {
      return
    }
    if (step?.target) {
      const el = document.querySelector<HTMLElement>(`[data-tut="${step.target}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    // Let the smooth-scroll settle before locking the spotlight rect.
    const t = setTimeout(measure, step?.target ? 260 : 0)
    return () => clearTimeout(t)
  }, [active, index, step, measure])

  // Keep the spotlight glued to the target on scroll / resize.
  useEffect(() => {
    if (!active || !step?.target) {
      return
    }
    const onMove = () => measure()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [active, step, measure])

  const close = useCallback(() => {
    setActive(false)
    writeSeen(storageKey)
  }, [storageKey])

  const next = useCallback(() => {
    setIndex((i) => {
      if (i >= steps.length - 1) {
        setActive(false)
        writeSeen(storageKey)
        return i
      }
      return i + 1
    })
  }, [steps.length, storageKey])

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Keyboard: Esc closes, arrows navigate.
  useEffect(() => {
    if (!active) {
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        next()
      } else if (e.key === 'ArrowLeft') {
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, close, next, back])

  if (!active || !step) {
    return null
  }

  const last = index === steps.length - 1
  const spot = rect
    ? {
        top: rect.top - SPOTLIGHT_PAD,
        left: rect.left - SPOTLIGHT_PAD,
        width: rect.width + SPOTLIGHT_PAD * 2,
        height: rect.height + SPOTLIGHT_PAD * 2,
      }
    : null

  // Card placement: below the spotlight if there's room, else above; centered when no target.
  const CARD_W = 340
  const CARD_EST_H = 210
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  let cardTop: number
  let cardLeft: number
  if (spot) {
    const below = spot.top + spot.height + 14
    const above = spot.top - CARD_EST_H - 14
    cardTop = below + CARD_EST_H < vh ? below : Math.max(14, above)
    cardLeft = Math.min(Math.max(14, spot.left), vw - CARD_W - 14)
  } else {
    cardTop = Math.max(14, vh / 2 - CARD_EST_H / 2)
    cardLeft = Math.max(14, vw / 2 - CARD_W / 2)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000 }}>
      {/* Click-blocker: swallows desk interaction; clicking the dim advances. */}
      <div
        onClick={next}
        style={{
          position: 'absolute',
          inset: 0,
          // No target → dim the whole screen here (the spotlight box-shadow handles the targeted case).
          background: spot ? 'transparent' : 'rgba(13,16,12,0.55)',
          cursor: 'pointer',
        }}
      />

      {/* Spotlight — a transparent hole with a huge box-shadow dimming everything around it. */}
      {spot ? (
        <div
          style={{
            position: 'fixed',
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            borderRadius: 12,
            boxShadow: `0 0 0 9999px rgba(13,16,12,0.55)`,
            border: `2px solid ${terminalColors.greenDeep}`,
            pointerEvents: 'none',
            transition: 'top .2s ease, left .2s ease, width .2s ease, height .2s ease',
          }}
        />
      ) : null}

      {/* Explanation card */}
      <div
        style={{
          position: 'fixed',
          top: cardTop,
          left: cardLeft,
          width: CARD_W,
          background: terminalColors.bg,
          border: `1px solid ${terminalColors.line}`,
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(13,16,12,0.28)',
          padding: 18,
          transition: 'top .2s ease, left .2s ease',
        }}
      >
        <div
          style={{
            fontFamily: terminalFonts.mono,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: terminalColors.greenDeep,
            marginBottom: 8,
          }}
        >
          {step.target ? `Step ${index} of ${steps.length - 1}` : 'HookSwapPerps'}
        </div>
        <div
          style={{
            fontFamily: terminalFonts.display,
            fontSize: 16,
            fontWeight: 600,
            color: terminalColors.ink,
            marginBottom: 8,
          }}
        >
          {step.title}
        </div>
        <div
          style={{
            fontFamily: terminalFonts.sans,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: terminalColors.ink3,
            marginBottom: 16,
          }}
        >
          {step.body}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button
            type="button"
            onClick={close}
            style={{
              fontFamily: terminalFonts.mono,
              fontSize: 11,
              color: terminalColors.faint,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '6px 2px',
            }}
          >
            Skip tour
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {index > 0 ? (
              <button
                type="button"
                onClick={back}
                style={{
                  fontFamily: terminalFonts.mono,
                  fontSize: 11,
                  fontWeight: 600,
                  color: terminalColors.ink,
                  background: terminalColors.bg,
                  border: `1px solid ${terminalColors.line}`,
                  borderRadius: 8,
                  padding: '7px 14px',
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={next}
              style={{
                fontFamily: terminalFonts.mono,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                color: terminalColors.btnInk,
                background: terminalColors.brandGreen,
                border: 'none',
                borderRadius: 8,
                padding: '7px 16px',
                cursor: 'pointer',
              }}
            >
              {last ? 'Done' : index === 0 ? 'Start' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
