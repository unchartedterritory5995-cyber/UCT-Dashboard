// Custom-Period Sort — the config popover shown right after you drag-highlight a period.
// Shows the (editable) start/end dates + the highlighted symbol's % change over the span,
// then Sort / Sort in New Window / Cancel.
import { useState } from 'react'
import styles from './PeriodSortPanel.module.css'

const ymdToInput = (ymd) => { const s = String(ymd); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` }
const inputToYmd = (v) => parseInt(String(v).replace(/-/g, ''), 10)

export default function PeriodSortConfig({ sel, onSort, onCancel }) {
  const [start, setStart] = useState(ymdToInput(sel.start))
  const [end, setEnd] = useState(ymdToInput(sel.end))
  const valid = start && end && inputToYmd(start) < inputToYmd(end)

  const sort = () => { if (valid) onSort(inputToYmd(start), inputToYmd(end)) }

  return (
    <div className={styles.cfgBackdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className={styles.cfg} role="dialog" aria-label="Custom-Period Sort">
        <div className={styles.cfgHead}>Custom-Period Sort</div>
        <div className={styles.cfgBody}>
          <div className={styles.cfgRow}>
            <span className={styles.cfgLabel}>Start</span>
            <input type="date" className={styles.cfgDate} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className={styles.cfgRow}>
            <span className={styles.cfgLabel}>End</span>
            <input type="date" className={styles.cfgDate} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className={styles.cfgActions}>
          <button type="button" className={`${styles.cfgBtn} ${styles.cfgBtnGhost}`} onClick={onCancel}>Cancel</button>
          <button type="button" className={styles.cfgBtn} disabled={!valid} onClick={sort}>Sort</button>
        </div>
      </div>
    </div>
  )
}
