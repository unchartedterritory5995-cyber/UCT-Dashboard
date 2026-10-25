// app/src/components/chart/IndicatorHistoryButtons.jsx
//
// ⭐ A1.2 — Undo / Redo buttons for a panel that edits indicators (Chart Settings →
// Indicators, the phone ƒx sheet). Same stack and same rules as the toast
// (`indicatorHistoryStore`): exact or refused, never partial. The tooltip names the entry
// ("Undo: RSI hidden (2)"); a refusal is said beside the buttons and nothing is written.

import { useState } from 'react'
import { useIndicatorHistory, undoIndicatorChange, redoIndicatorChange } from './indicatorHistoryStore'
import styles from './IndicatorHistoryButtons.module.css'

/**
 * @param {object} p
 * @param {string|null} p.surfaceKey  the chart's history surface; absent ⇒ renders nothing
 * @param {string|null} p.userId
 * @param {object} p.cs               the settings the panel shows (what Undo is checked against)
 * @param {(cs:object)=>void} p.write the panel's own sink
 */
export default function IndicatorHistoryButtons({ surfaceKey, userId = null, cs, write }) {
  const { past, future } = useIndicatorHistory(surfaceKey || 'none', userId)
  const [note, setNote] = useState(null)
  if (!surfaceKey) return null
  const last = past[past.length - 1] || null
  const next = future[future.length - 1] || null
  const run = (fn) => {
    const r = fn(surfaceKey, cs, write, { userId })
    setNote(r.ok ? null : r.reason === 'changed-since' ? "Can't undo: the indicator changed since." : null)
  }
  return (
    <span className={styles.group} data-testid="indicator-history-buttons">
      <button type="button" className={styles.btn} disabled={!last}
        aria-label={last ? `Undo: ${last.label}` : 'Nothing to undo'} title={last ? `Undo: ${last.label}` : 'Nothing to undo'}
        onClick={() => run(undoIndicatorChange)}>↶</button>
      <button type="button" className={styles.btn} disabled={!next}
        aria-label={next ? `Redo: ${next.label}` : 'Nothing to redo'} title={next ? `Redo: ${next.label}` : 'Nothing to redo'}
        onClick={() => run(redoIndicatorChange)}>↷</button>
      {note && <span className={styles.note} role="status">{note}</span>}
    </span>
  )
}
