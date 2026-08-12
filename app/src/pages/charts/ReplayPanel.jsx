// Replay Mode — Tools → Replay: pick a historical date, hide every bar after it on the
// active chart, then explore ANY timeframe (including deep intraday back to ~2003) at that
// point. A config dialog reusing the Custom-Period-Sort chrome (`PeriodSortPanel.module.css`).
// SEPARATE from Custom-Period Sort: it shares only the chart's `replayCutoff` prop and edits
// none of that feature's files.
import { useState } from 'react'
import styles from './PeriodSortPanel.module.css'

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const TF_OPTS = [
  { v: 'D', label: 'Daily' },
  { v: 'W', label: 'Weekly' },
  { v: 'M', label: 'Monthly' },
  { v: '60', label: '1 hour' },
  { v: '30', label: '30 min' },
  { v: '15', label: '15 min' },
  { v: '5', label: '5 min' },
  { v: '1', label: '1 min' },
]

export default function ReplayPanel({ active = false, cutoff = null, onStart, onArmPick, onExit, onClose }) {
  const [date, setDate] = useState(cutoff || '')
  const [tf, setTf] = useState('D')
  const valid = !!date

  return (
    <div className={styles.cfgBackdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.cfg} role="dialog" aria-label="Replay Mode">
        <div className={styles.cfgHead}>Replay Mode</div>
        <div className={styles.cfgBody}>
          <div className={styles.cfgRow}>
            <span className={styles.cfgLabel}>Replay to</span>
            <input
              type="date"
              className={styles.cfgDate}
              value={date}
              min="1990-01-01"
              max={isoToday()}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {onArmPick && (
            <div className={styles.cfgRow}>
              <span className={styles.cfgLabel} />
              <button
                type="button"
                className={`${styles.cfgBtn} ${styles.cfgBtnGhost}`}
                style={{ width: '100%' }}
                onClick={() => onArmPick()}
              >⤢ Pick on chart</button>
            </div>
          )}
          <div className={styles.cfgRow}>
            <span className={styles.cfgLabel}>Timeframe</span>
            <select className={styles.cfgSelect} value={tf} onChange={(e) => setTf(e.target.value)}>
              {TF_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div className={styles.cfgReplayHint} style={{ marginTop: 2 }}>
            Hides every bar after this date on the active chart, then lets you switch
            timeframes at that point. Intraday history reaches back to ~2003 — fetched
            on demand and cached.
          </div>
        </div>
        <div className={styles.cfgActions}>
          {active
            ? <button type="button" className={`${styles.cfgBtn} ${styles.cfgBtnGhost}`} onClick={onExit}>Exit replay</button>
            : <button type="button" className={`${styles.cfgBtn} ${styles.cfgBtnGhost}`} onClick={onClose}>Cancel</button>}
          <button
            type="button"
            className={styles.cfgBtn}
            disabled={!valid}
            onClick={() => { if (valid) onStart(date, tf) }}
          >{active ? 'Update' : 'Start replay'}</button>
        </div>
      </div>
    </div>
  )
}
