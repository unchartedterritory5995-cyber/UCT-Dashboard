// Custom-Period Sort — the config popover shown right after you drag-highlight a period.
// Shows the (editable) start/end dates + the highlighted symbol's % change over the span,
// then Sort / Sort in New Window / Cancel.
import { useId, useState } from 'react'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Checkbox from '../../components/ui/Checkbox'
import FieldError from '../../components/ui/FieldError'
import styles from './PeriodSortPanel.module.css'

const ymdToInput = (ymd) => { const s = String(ymd); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` }
const inputToYmd = (v) => parseInt(String(v).replace(/-/g, ''), 10)

export default function PeriodSortConfig({ sel, onSort, onCancel }) {
  const [start, setStart] = useState(ymdToInput(sel.start))
  const [end, setEnd] = useState(ymdToInput(sel.end))
  const [replay, setReplay] = useState(false)
  const [markStart, setMarkStart] = useState('off')  // off | line (gold vertical line) | candle (gold start-date candle)
  const [groupBy, setGroupBy] = useState('stocks')   // stocks | theme | sector | industry
  const [tf, setTf] = useState('D')                  // D | W | M — linked charts switch to this
  const valid = start && end && inputToYmd(start) < inputToYmd(end)
  // TERM-067: every control here is named by its visible label, and the one rule the
  // Sort button enforces is said in words beside the field that breaks it.
  const uid = useId()
  const ids = { sort: `${uid}-sort`, start: `${uid}-start`, end: `${uid}-end`, tf: `${uid}-tf`, mark: `${uid}-mark` }
  const endError = start && end && !valid ? 'End must be after start.' : null

  const sort = () => { if (valid) onSort(inputToYmd(start), inputToYmd(end), replay, groupBy === 'stocks' ? null : groupBy, tf, markStart) }

  return (
    <div className={styles.cfgBackdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className={styles.cfg} role="dialog" aria-label="Custom-Period Sort">
        <div className={styles.cfgHead}>Custom-Period Sort</div>
        <div className={styles.cfgBody}>
          <div className={styles.cfgRow}>
            <label className={styles.cfgLabel} htmlFor={ids.sort}>Sort</label>
            <Select id={ids.sort} className={styles.cfgSelect} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="stocks">US Common Stocks</option>
              <option value="theme">Themes</option>
              <option value="sector">Sectors</option>
              <option value="industry">Industries</option>
            </Select>
          </div>
          <div className={styles.cfgRow}>
            <label className={styles.cfgLabel} htmlFor={ids.start}>Start</label>
            <Input id={ids.start} type="date" className={styles.cfgDate} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className={styles.cfgRow}>
            <label className={styles.cfgLabel} htmlFor={ids.end}>End</label>
            <Input id={ids.end} type="date" className={styles.cfgDate} value={end} error={endError} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <FieldError forId={ids.end} className={styles.cfgError}>{endError}</FieldError>
          <div className={styles.cfgRow}>
            <label className={styles.cfgLabel} htmlFor={ids.tf}>Timeframe</label>
            <Select id={ids.tf} className={styles.cfgSelect} value={tf} onChange={(e) => setTf(e.target.value)}>
              <option value="D">Daily</option>
              <option value="W">Weekly</option>
              <option value="M">Monthly</option>
            </Select>
          </div>
          {/* Replay mode: charts linked to the results cut off every bar past the End date
              (TradingView-style), re-framed to default zoom, until you exit replay mode. */}
          <label className={styles.cfgReplay}>
            <Checkbox checked={replay} onChange={(e) => setReplay(e.target.checked)} />
            <span>Replay mode <span className={styles.cfgReplayHint}>— hide bars past the end date on linked charts</span></span>
          </label>
          {/* Mark start date on every linked chart (cleared on exit replay): a thin gold
              vertical line, or paint the start-date candle gold. */}
          <div className={styles.cfgRow}>
            <label className={styles.cfgLabel} htmlFor={ids.mark}>Mark start</label>
            <Select id={ids.mark} className={styles.cfgSelect} value={markStart} onChange={(e) => setMarkStart(e.target.value)}>
              <option value="off">Off</option>
              <option value="line">Vertical gold line</option>
              <option value="candle">Gold start candle</option>
            </Select>
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
