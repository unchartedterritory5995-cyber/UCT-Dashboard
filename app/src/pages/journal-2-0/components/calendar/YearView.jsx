/**
 * Year heatmap — GitHub-contributions-style: 7 rows (Sun–Sat) × ~53 columns.
 * Click a cell → /journal-2-0/calendar/{date}.
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { cellBackground, fmtSignedDollar, fmtSignedPct, fmtSignedR, todayET } from '../../lib/calendar'
import styles from './YearView.module.css'

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function buildYearGrid(year) {
  // Build column-major (each column = a week starting on Sunday).
  const start = new Date(Date.UTC(year, 0, 1))
  const startDow = start.getUTCDay()  // 0 = Sun
  // Pad leading days with null so the first column starts on Sunday.
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)

  let cursor = new Date(start)
  while (cursor.getUTCFullYear() === year) {
    const y = cursor.getUTCFullYear()
    const m = cursor.getUTCMonth() + 1
    const d = cursor.getUTCDate()
    cells.push({
      date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      day: d,
      month: m,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  // Pad trailing to whole weeks.
  while (cells.length % 7 !== 0) cells.push(null)

  // Reshape into columns of 7. Each row of the rendered grid is a DOW.
  const cols = []
  for (let i = 0; i < cells.length; i += 7) {
    cols.push(cells.slice(i, i + 7))
  }
  return cols
}

export default function YearView({ year, days = [], mode = 'pct' }) {
  const navigate = useNavigate()
  const cols = useMemo(() => buildYearGrid(year), [year])
  const summaryByDate = useMemo(() => {
    const m = {}
    for (const d of days) m[d.date] = d
    return m
  }, [days])
  const today = todayET()

  // Compute month label positions (column index where each month starts).
  const monthLabels = useMemo(() => {
    const seen = new Set()
    const labels = []
    cols.forEach((col, ci) => {
      for (const cell of col) {
        if (!cell) continue
        if (!seen.has(cell.month)) {
          seen.add(cell.month)
          labels.push({ name: MONTH_NAMES[cell.month - 1], col: ci })
          break
        }
      }
    })
    return labels
  }, [cols])

  return (
    <div className={styles.wrap}>
      <div className={styles.monthRow} style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
        {Array.from({ length: cols.length }).map((_, ci) => {
          const label = monthLabels.find((l) => l.col === ci)
          return <div key={ci} className={styles.monthLabel}>{label?.name || ''}</div>
        })}
      </div>
      <div className={styles.gridWrap}>
        <div className={styles.dowCol}>
          {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d, i) => (
            <div key={i} className={styles.dowLabel}>{d}</div>
          ))}
        </div>
        <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
          {cols.flat().map((cell, i) => {
            if (!cell) return <div key={`b-${i}`} className={styles.blank} />
            const summary = summaryByDate[cell.date]
            const value =
              mode === 'dollar' ? summary?.pnlDollar :
              mode === 'r'      ? summary?.rSum :
                                  summary?.pnlPercent
            const bg = cellBackground(value, mode)
            const isToday = cell.date === today
            const tooltip = summary
              ? `${cell.date} · ${fmtSignedDollar(summary.pnlDollar)} · ${fmtSignedPct(summary.pnlPercent)} · ${fmtSignedR(summary.rSum)}`
              : `${cell.date} · no trades`
            return (
              <button
                key={cell.date}
                type="button"
                className={`${styles.cell} ${isToday ? styles.today : ''} ${summary?.hasNotes ? styles.hasNotes : ''}`}
                style={{ background: bg !== 'transparent' ? bg : undefined }}
                onClick={() => navigate(`/journal-2-0/calendar/${cell.date}`)}
                title={tooltip}
                aria-label={tooltip}
              />
            )
          })}
        </div>
      </div>
      <Legend mode={mode} />
    </div>
  )
}

function Legend({ mode }) {
  const labels =
    mode === 'pct' ? ['< -1%', '-0.5%', '-0.1%', '0', '+0.1%', '+0.5%', '> +1%']
    : mode === 'r' ? ['< -2R', '-1R', '-0.5R', '0', '+0.5R', '+1R', '> +2R']
    : ['< -$1K', '-$250', '-$50', '0', '+$50', '+$250', '> +$1K']
  const samples = [-1, -0.4, -0.05, 0, 0.05, 0.4, 1]
  return (
    <div className={styles.legend}>
      <span className={styles.legendLabel}>Less</span>
      {samples.map((s, i) => {
        const bg = cellBackground(
          mode === 'pct' ? s * 0.02 : mode === 'r' ? s * 2 : s * 1500,
          mode,
        )
        return (
          <span
            key={i}
            className={styles.legendCell}
            style={{ background: bg !== 'transparent' ? bg : 'var(--bg-surface)' }}
            title={labels[i]}
          />
        )
      })}
      <span className={styles.legendLabel}>More</span>
    </div>
  )
}
