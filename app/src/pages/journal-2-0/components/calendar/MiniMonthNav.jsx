/**
 * Compact month-grid sidebar nav for the Day Detail page.
 * Click a day → navigate to /journal-2-0/calendar/{date}.
 * ← / → keys jump to previous / next day.
 */

import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildMonthGrid, dowLabels, monthLabel, monthOffset } from '../../lib/calendar'
import styles from './MiniMonthNav.module.css'

export default function MiniMonthNav({ date }) {
  const navigate = useNavigate()
  const [year, month, day] = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number)
    return [y, m, d]
  }, [date])

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month])

  // Keyboard navigation: ← / →
  useEffect(() => {
    const onKey = (e) => {
      // Skip if user is typing
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const delta = e.key === 'ArrowLeft' ? -1 : 1
      const d = new Date(Date.UTC(year, month - 1, day + delta))
      const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
      navigate(`/journal-2-0/calendar/${next}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [year, month, day, navigate])

  const goPrevMonth = () => {
    const next = monthOffset(year, month, -1)
    const newDate = `${next.year}-${String(next.month).padStart(2, '0')}-01`
    navigate(`/journal-2-0/calendar/${newDate}`)
  }
  const goNextMonth = () => {
    const next = monthOffset(year, month, 1)
    const newDate = `${next.year}-${String(next.month).padStart(2, '0')}-01`
    navigate(`/journal-2-0/calendar/${newDate}`)
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <button type="button" className={styles.navBtn} onClick={goPrevMonth} aria-label="Previous month">‹</button>
        <span className={styles.label}>{monthLabel(year, month)}</span>
        <button type="button" className={styles.navBtn} onClick={goNextMonth} aria-label="Next month">›</button>
      </div>
      <div className={styles.dowRow}>
        {dowLabels().map((d) => (
          <div key={d} className={styles.dowLabel}>{d[0]}</div>
        ))}
      </div>
      <div className={styles.grid}>
        {grid.flat().map((cell, i) => {
          if (!cell) return <div key={`b-${i}`} className={styles.blank} />
          const isCurrent = cell.day === day
          return (
            <button
              key={cell.date}
              type="button"
              className={`${styles.cell} ${isCurrent ? styles.cellCurrent : ''}`}
              onClick={() => navigate(`/journal-2-0/calendar/${cell.date}`)}
              aria-label={`Go to ${cell.date}`}
            >
              {cell.day}
            </button>
          )
        })}
      </div>
      <p className={styles.hint}>← → arrows to navigate days</p>
    </div>
  )
}
