// Period-Sort widget — the docked/tabbed form of Custom-Period Sort. Renders the shared
// PeriodSortTable (identical to the floating panel) inside a workspace widget, with its own
// ⚙ settings popover to edit the [start, end] range. The range lives in opts.{start,end}.
import { useState } from 'react'
import PeriodSortTable from '../PeriodSortTable'
import { useWorkspace } from '../WorkspaceContext'
import styles from '../PeriodSortPanel.module.css'

const ymdOf = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
const ymdToInput = (ymd) => { const s = String(ymd); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` }
const inputToYmd = (v) => parseInt(String(v).replace(/-/g, ''), 10)
const fmtYmd = (ymd) => { const s = String(ymd); return `${+s.slice(4, 6)}/${+s.slice(6, 8)}/${s.slice(0, 4)}` }

export default function PeriodSortWidget({ color, opts = {}, onOptsChange }) {
  const { setGroupSym } = useWorkspace()
  // Default range (last ~30 days) computed once when a widget is added without a selection.
  const [seed] = useState(() => {
    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 30)
    return { start: ymdOf(start), end: ymdOf(end) }
  })
  const start = opts.start || seed.start
  const end = opts.end || seed.end
  const [gearOpen, setGearOpen] = useState(false)

  const setRange = (s, e) => onOptsChange?.({ ...opts, start: s, end: e })

  return (
    <div className={styles.widgetRoot}>
      <div className={styles.widgetBar}>
        <span className={styles.widgetRange}>{fmtYmd(start)} – {fmtYmd(end)}</span>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setGearOpen((o) => !o)}
          title="Set period"
          aria-label="Set period"
        >⚙</button>
        {gearOpen && (
          <div className={styles.gearPop}>
            <div className={styles.cfgRow}>
              <span className={styles.cfgLabel}>Start</span>
              <input type="date" className={styles.cfgDate} value={ymdToInput(start)} onChange={(e) => setRange(inputToYmd(e.target.value), end)} />
            </div>
            <div className={styles.cfgRow}>
              <span className={styles.cfgLabel}>End</span>
              <input type="date" className={styles.cfgDate} value={ymdToInput(end)} onChange={(e) => setRange(start, inputToYmd(e.target.value))} />
            </div>
          </div>
        )}
      </div>
      <PeriodSortTable start={start} end={end} onPickSym={(s) => setGroupSym?.(color, s)} />
    </div>
  )
}
