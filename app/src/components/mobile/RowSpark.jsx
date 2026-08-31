import { useEffect, useState } from 'react'
import useMediaQuery from '../../hooks/useMediaQuery'
import { idbGet } from '../../utils/barsIDB'
import styles from './RowSpark.module.css'

// Phone AND the iPad two-pane's docked panel (coarse pointer ≤1024px) — the
// same surfaces the chart shell serves. A narrow DESKTOP window (fine pointer)
// keeps its dense column look and performs zero reads.
const SPARK_MQ = '(pointer: coarse) and (max-width: 1024px)'

/* RowSpark — the Deepvue-style mini price path on phone watchlist rows.
 *
 * ⛔ ZERO NETWORK BY CONSTRUCTION. Rows can number in the hundreds (and
 * thousands in scan mode), and this repo has been burned by per-row fetch
 * herds — so the spark reads ONLY the local bars store (IndexedDB, seeded by
 * the Universe Bars Pack and by every chart view). A symbol the store doesn't
 * hold renders nothing; it never falls back to /api/bars.
 *
 * Off-surface mounts render nothing AND read nothing (SPARK_MQ gates the IDB
 * read; the CSS module's matching media is the layout-level guarantee).
 * Results memo in a module Map so a virtualized list scrolling the same
 * symbols back into view re-renders from memory.
 */

/** ~6 weeks of closes → an SVG polyline. Pure + exported for the unit rail.
 *  Returns { points, up } or null when there's too little to draw honestly. */
export function sparkPath(bars, w = 56, h = 16) {
  const closes = []
  for (const b of bars || []) {
    const c = Number.isFinite(b?.c) ? b.c : b?.close
    if (Number.isFinite(c)) closes.push(c)
  }
  if (closes.length < 5) return null
  let min = Infinity
  let max = -Infinity
  for (const c of closes) { if (c < min) min = c; if (c > max) max = c }
  const span = max - min || 1
  const stepX = w / (closes.length - 1)
  const pad = 1.5
  const points = closes
    .map((c, i) => `${(i * stepX).toFixed(1)},${(pad + (h - 2 * pad) * (1 - (c - min) / span)).toFixed(1)}`)
    .join(' ')
  return { points, up: closes[closes.length - 1] >= closes[0] }
}

const SPARK_BARS = 30           // ~6 trading weeks
const memo = new Map()          // sym -> sparkPath result (null = known-absent)

export default function RowSpark({ sym }) {
  const sparkOn = useMediaQuery(SPARK_MQ)
  // The memo is the source of truth; state only ticks when an async read lands.
  const [, setLoadTick] = useState(0)

  useEffect(() => {
    if (!sparkOn || !sym || memo.has(sym)) return undefined
    let on = true
    idbGet(sym, 'D')
      .then((entry) => {
        if (memo.size > 600) memo.clear()   // hygiene bound for scan-mode scrolls
        memo.set(sym, sparkPath(entry?.bars?.slice(-SPARK_BARS)))
        if (on) setLoadTick((n) => n + 1)
      })
      .catch(() => {
        memo.set(sym, null)
        if (on) setLoadTick((n) => n + 1)
      })
    return () => { on = false }
  }, [sym, sparkOn])

  const d = sparkOn ? memo.get(sym) : null
  if (!d) return null
  return (
    <svg className={styles.spark} width="56" height="16" viewBox="0 0 56 16" aria-hidden="true" data-testid="row-spark">
      <polyline
        points={d.points}
        fill="none"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={d.up ? styles.up : styles.down}
      />
    </svg>
  )
}
