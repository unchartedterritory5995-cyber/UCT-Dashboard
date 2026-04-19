/**
 * Month grid — 7 cols × 5/6 rows. Sunday-start.
 */

import { useMemo } from 'react'
import { buildMonthGrid, dowLabels, todayET } from '../../lib/calendar'
import DayCell from './DayCell'
import styles from './MonthView.module.css'

export default function MonthView({ year, month, days = [], mode = 'pct' }) {
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month])
  const summaryByDate = useMemo(() => {
    const map = {}
    for (const d of days) map[d.date] = d
    return map
  }, [days])
  const today = todayET()

  return (
    <div className={styles.wrap}>
      <div className={styles.dowRow}>
        {dowLabels().map((d) => (
          <div key={d} className={styles.dowLabel}>{d}</div>
        ))}
      </div>
      <div className={styles.grid}>
        {grid.flat().map((cell, i) => (
          <DayCell
            key={cell?.date || `blank-${i}`}
            cell={cell}
            summary={cell ? summaryByDate[cell.date] : undefined}
            mode={mode}
            isToday={cell?.date === today}
          />
        ))}
      </div>
    </div>
  )
}
