import { useEffect, useRef } from 'react'
import HistoryPanel from './HistoryPanel'
import { fmtDate } from './readingModel'
import styles from './Reading.module.css'

/** The marker the drill window's own Escape handler looks for (the drawer closes first). */
export const HISTORY_DRAWER_ATTR = 'data-history-drawer'

// The History drawer: 440px, over the chart from the right; the stock list stays in view.
// × or Escape closes it (the window's Escape handler closes the drawer first, never both).
export default function HistoryDrawer({ label, valueText, universeName, date, reading, loading, error, fmt, onPickDate, onClose }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.querySelector('button')?.focus() }, [])
  return (
    <aside ref={ref} className={styles.drawer} aria-label="History of this reading" {...{ [HISTORY_DRAWER_ATTR]: '' }}>
      <div className={styles.drawerHead}>
        <div className={styles.drawerTitle}>
          <b>History</b>
          <span>{label}{valueText ? ` at ${valueText}` : ''}{date ? ` on ${fmtDate(date)}` : ''}{universeName ? ` · ${universeName}` : ''}</span>
        </div>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close History" title="Close (Esc)">
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className={styles.drawerBody}>
        <HistoryPanel reading={reading} loading={loading} error={error} fmt={fmt} layout="stack" onPickDate={onPickDate} />
      </div>
    </aside>
  )
}
