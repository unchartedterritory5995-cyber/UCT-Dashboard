import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { paidFetcher } from '../../../components/research/sections/paidFetcher'
import { fmtDate, fmtMove } from '../../../utils/feedFormat'
import styles from './FocusScreener.module.css'

// Why the stock is moving, under its chart: the newest entries of the same merged feed the
// research page's Catalysts tab and the /charts News & Catalysts widget read (/api/news-catalysts).
//
// ⛔ A PEEK, never a generation (`?generate=0`). An ordinary read starts a background LLM
// generation for any name not yet covered, and this strip reads the feed for every stock a member
// arrows past, so on the ordinary read a walk down a screen would start one per row. "Find
// catalysts" opens the research tab, the deliberate door that does generate.
//
// The selection must SETTLE first (a held ↓ walks many rows a second): only the stock the walk
// stops on is read.
export const SETTLE_MS = 200
const SHOWN = 2
const KIND = { catalyst: 'Catalyst', earnings: 'Earnings', breaking: 'Wire' }

export default function CatalystStrip({ sym }) {
  const [settled, setSettled] = useState(null)
  useEffect(() => {
    const t = setTimeout(() => setSettled(sym), SETTLE_MS)
    return () => clearTimeout(t)
  }, [sym])
  const key = sym && settled === sym ? `/api/news-catalysts/${encodeURIComponent(sym)}?generate=0` : null
  const { data, error } = useSWR(key, paidFetcher, { revalidateOnFocus: false, dedupingInterval: 60000 })
  if (!sym) return null
  const href = `/research/${encodeURIComponent(sym)}?section=catalysts`
  const answered = settled === sym && data !== undefined
  const events = answered && Array.isArray(data?.events) ? data.events.slice(0, SHOWN) : []
  // The strip keeps its height whatever it holds, so the chart above never jumps on a step.
  return (
    <div className={styles.catStrip} data-testid="pane-catalysts" aria-label={`${sym} catalysts`}>
      {events.map((e, i) => {
        const dir = e.direction === 'up' ? styles.up : e.direction === 'down' ? styles.down : styles.flat
        return (
          <div key={`${e.type}-${e.date}-${i}`} className={styles.catRow}>
            <span className={styles.catKind}>{KIND[e.type] || 'Catalyst'}</span>
            <span className={styles.catDate}>{fmtDate(e.date)}</span>
            {e.move_pct != null && <span className={dir}>{fmtMove(e.move_pct)}</span>}
            <span className={styles.catTitle} title={e.title}>{e.title}</span>
            {i === 0 && <Link className={styles.catLink} to={href}>All catalysts ›</Link>}
          </div>
        )
      })}
      {answered && !events.length && !error && !data?.paywalled && (
        <div className={styles.catRow}>
          <span className={styles.catNone}>No catalysts on record yet.</span>
          <Link className={styles.catLink} to={href}>Find catalysts ›</Link>
        </div>
      )}
    </div>
  )
}
