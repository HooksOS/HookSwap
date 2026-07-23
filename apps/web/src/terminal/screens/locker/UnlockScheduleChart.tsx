/**
 * HookSwap Locker — Unlock schedule histogram.
 *
 * Buckets every indexed lock by the calendar month it unlocks and renders a vertical
 * bar chart of how many locks come due each month (next ~12 months), with the count of
 * already-unlockable locks called out separately. Real data only: derived from the
 * indexer's `/locks` list (`unlockTime` per lock) — nothing fabricated, honest empty
 * state when there are no upcoming unlocks.
 *
 * Where locks carry a USD value the bar's tooltip also sums it; unpriced locks still
 * count toward the bar height (they're real locks) but never invent a $ figure.
 */
import { useMemo } from 'react'
import type { Lock } from '~/terminal/lockers/analytics/client'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

interface Bucket {
  key: string
  label: string
  count: number
  valueUsd: number
  /** True for the leading "already unlockable" bucket. */
  past: boolean
}

/** Number of future monthly buckets to show. */
const MONTHS_AHEAD = 12

function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function buildBuckets(locks: Lock[]): Bucket[] {
  const now = new Date()
  const nowSec = Math.floor(now.getTime() / 1000)

  // Prime an ordered map of the next MONTHS_AHEAD calendar months so empty months still show.
  const buckets: Bucket[] = []
  const index = new Map<string, number>()
  const past: Bucket = { key: 'past', label: 'Now', count: 0, valueUsd: 0, past: true }
  buckets.push(past)
  for (let i = 0; i < MONTHS_AHEAD; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    index.set(key, buckets.length)
    buckets.push({ key, label: monthLabel(d), count: 0, valueUsd: 0, past: false })
  }
  const horizonKey = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() + MONTHS_AHEAD - 1, 1)
    return `${d.getFullYear()}-${d.getMonth()}`
  })()
  const horizonIdx = index.get(horizonKey) ?? buckets.length - 1

  for (const l of locks) {
    if (!Number.isFinite(l.unlockTime)) {
      continue
    }
    if (l.unlockTime <= nowSec) {
      past.count += 1
      if (typeof l.valueUsd === 'number') {
        past.valueUsd += l.valueUsd
      }
      continue
    }
    const d = new Date(l.unlockTime * 1000)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    // Locks unlocking beyond the horizon fold into the last visible month.
    const idx = index.get(key) ?? horizonIdx
    const b = buckets[idx]
    if (!b) {
      continue
    }
    b.count += 1
    if (typeof l.valueUsd === 'number') {
      b.valueUsd += l.valueUsd
    }
  }
  return buckets
}

export function UnlockScheduleChart({ locks, isLoading }: { locks?: Lock[]; isLoading: boolean }): JSX.Element {
  const buckets = useMemo(() => (locks ? buildBuckets(locks) : undefined), [locks])
  const max = useMemo(() => (buckets ? Math.max(1, ...buckets.map((b) => b.count)) : 1), [buckets])

  if (isLoading || buckets === undefined) {
    return <div style={{ height: 200, borderRadius: 10, background: terminalColors.panel }} aria-busy="true" />
  }

  const totalUpcoming = buckets.filter((b) => !b.past).reduce((s, b) => s + b.count, 0)
  const pastCount = buckets.find((b) => b.past)?.count ?? 0
  if (totalUpcoming === 0 && pastCount === 0) {
    return (
      <div style={{ padding: '28px 16px', textAlign: 'center', fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink3 }}>
        No unlock schedule yet — locks appear here as they’re created on-chain.
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 168 }}>
        {buckets.map((b) => {
          const h = (b.count / max) * 100
          const color = b.past ? terminalColors.warn : terminalColors.brandGreen
          const bg = b.past ? terminalColors.warnBg : terminalColors.greenBg
          const title =
            `${b.past ? 'Already unlockable' : b.label}: ${b.count} lock${b.count === 1 ? '' : 's'}` +
            (b.valueUsd > 0 ? ` · $${Math.round(b.valueUsd).toLocaleString('en-US')}` : '')
          return (
            <div key={b.key} title={title} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: b.count > 0 ? color : terminalColors.faint }}>
                {b.count > 0 ? b.count : ''}
              </span>
              <div
                style={{
                  width: '100%',
                  height: `${Math.max(b.count > 0 ? 4 : 1, h)}%`,
                  minHeight: b.count > 0 ? 4 : 1,
                  borderRadius: 5,
                  background: b.count > 0 ? bg : terminalColors.panel2,
                  borderTop: b.count > 0 ? `2px solid ${color}` : `1px solid ${terminalColors.line2}`,
                  transition: 'height 200ms ease',
                }}
              />
            </div>
          )
        })}
      </div>
      {/* x labels */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {buckets.map((b) => (
          <span
            key={b.key}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: 'center',
              fontFamily: SANS,
              fontSize: 9.5,
              color: terminalColors.faint,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {b.past ? 'Now' : b.label.split(' ')[0]}
          </span>
        ))}
      </div>
    </div>
  )
}
