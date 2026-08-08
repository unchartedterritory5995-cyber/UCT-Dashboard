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
  const [replay, setReplay] = useState(false)
  const [groupBy, setGroupBy] = useState('stocks')   // stocks | theme | sector | industry
  const [tf, setTf] = useState('D')                  // D | W | M — linked charts switch to this
  const valid = start && end && inputToYmd(start) < inputToYmd(end)

  const sort = () => { if (valid) onSort(inputToYmd(start), inputToYmd(end), replay, groupBy === 'stocks' ? null : groupBy, tf) }

  return (
    <div className={styles.cfgBackdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className={styles.cfg} role="dialog" aria-label="Custom-Period Sort">
        <div className={styles.cfgHead}>Custom-Period Sort</div>
        <div className={styles.cfgBody}>
          <div className={styles.cfgRow}>
            <span className={styles.cfgLabel}>Sort</span>
            <select className={styles.cfgSelect} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="stocks">US Common Stocks</option>
              <option value="theme">Themes</option>
              <option value="sector">Sectors</option>
              <option value="industry">Industries</option>
            </select>
          </div>
          <div className={styles.cfgRow}>
            <span className={styles.cfgLabel}>Start</span>
            <input type="date" className={styles.cfgDate} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className={styles.cfgRow}>
            <span className={styles.cfgLabel}>End</span>
            <input type="date" className={styles.cfgDate} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className={styles.cfgRow}>
            <span className={styles.cfgLabel}>Timeframe</span>
            <select className={styles.cfgSelect} value={tf} onChange={(e) => setTf(e.target.value)}>
              <option value="D">Daily</option>
              <option value="W">Weekly</option>
              <option value="M">Monthly</option>
            </select>
          </div>
          {/* Replay mode: charts linked to the results cut off every bar past the End date
              (TradingView-style), re-framed to default zoom, until you exit replay mode. */}
          <label className={styles.cfgReplay}>
            <input type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)} />
            <span>Replay mode <span className={styles.cfgReplayHint}>— hide bars past the end date on linked charts</span></span>
          </label>
        </div>
        <div className={styles.cfgActions}>
          <button type="button" className={`${styles.cfgBtn} ${styles.cfgBtnGhost}`} onClick={onCancel}>Cancel</button>
          <button type="button" className={styles.cfgBtn} disabled={!valid} onClick={sort}>Sort</button>
        </div>
      </div>
    </div>
  )
}
