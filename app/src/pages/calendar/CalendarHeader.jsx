// app/src/pages/calendar/CalendarHeader.jsx
import { useState } from 'react'
import styles from './Calendar.module.css'

const AUDIENCE = [
  ['mine', '★ My Stocks'], ['watchlist', 'Watchlist'], ['positions', 'Positions'],
  ['uct20', 'UCT20'], ['all', 'All ($300M+)'],
]
const SORTS = [['mine', 'My stocks first'], ['time', 'Time'], ['mcap', 'Market cap'], ['move', 'Expected move']]
const SOURCES = [['watchlist','Watchlists'],['flagged','Flagged'],['positions','Positions'],['uct20','UCT20']]

export default function CalendarHeader({
  view, setView, weekLabel, filters, setFilters,
  mySources, setMySources,
  // Month nav (only shown when view === 'month')
  monthCursor, setMonthCursor,
}) {
  const [gear, setGear] = useState(false)
  const set = (k, v) => setFilters({ ...filters, [k]: v })
  const toggleSource = s => setMySources(
    mySources.includes(s) ? mySources.filter(x => x !== s) : [...mySources, s])

  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ]

  function prevMonth() {
    if (!setMonthCursor) return
    setMonthCursor(c => {
      const m = c.month === 1 ? 12 : c.month - 1
      const y = c.month === 1 ? c.year - 1 : c.year
      return { year: y, month: m }
    })
  }
  function nextMonth() {
    if (!setMonthCursor) return
    setMonthCursor(c => {
      const m = c.month === 12 ? 1 : c.month + 1
      const y = c.month === 12 ? c.year + 1 : c.year
      return { year: y, month: m }
    })
  }

  return (
    <div className={styles.header}>
      <div className={styles.hrow}>
        <span className={styles.ttl}>📅 Calendar</span>
        <span className={styles.view}>
          {['Feed','Week','Month'].map(v => (
            <span key={v} className={view === v.toLowerCase() ? styles.viewOn : ''}
                  onClick={() => setView(v.toLowerCase())}>{v}</span>
          ))}
        </span>
        {/* Show week label in feed/week; show month nav in month view */}
        {view !== 'month' ? (
          <span className={styles.wk}>{weekLabel}</span>
        ) : (
          <span className={styles.monthNavHeader}>
            <button className={styles.monthNavBtn} onClick={prevMonth} aria-label="Previous month">‹</button>
            <span className={styles.monthNavLbl}>
              {monthCursor ? `${MONTH_NAMES[monthCursor.month - 1]} ${monthCursor.year}` : ''}
            </span>
            <button className={styles.monthNavBtn} onClick={nextMonth} aria-label="Next month">›</button>
          </span>
        )}
        <span className={styles.gearWrap}>
          <button className={styles.mystk} onClick={() => setGear(g => !g)}>★ My Stocks ⚙</button>
          {gear && (
            <div className={styles.gearPop}>
              <div className={styles.scolLbl}>Count toward &ldquo;My Stocks&rdquo;:</div>
              {SOURCES.map(([k, lbl]) => (
                <label key={k} className={styles.gearRow}>
                  <input type="checkbox" checked={mySources.includes(k)} onChange={() => toggleSource(k)} /> {lbl}
                </label>
              ))}
            </div>
          )}
        </span>
      </div>
      <div className={styles.fb}>
        {AUDIENCE.map(([k, lbl]) => (
          <span key={k} className={`${styles.chip} ${filters.audience === k ? styles.chipOn : ''}`}
                onClick={() => set('audience', k)}>{lbl}</span>
        ))}
        <span className={styles.sep} />
        <select className={styles.sel} value={filters.minMcap}
                onChange={e => set('minMcap', Number(e.target.value))}>
          <option value={0}>Any cap</option><option value={2}>$2B+</option>
          <option value={10}>$10B+</option><option value={50}>$50B+</option>
        </select>
        <select className={styles.sel} value={filters.sort} onChange={e => set('sort', e.target.value)}>
          {SORTS.map(([k, lbl]) => <option key={k} value={k}>Sort: {lbl}</option>)}
        </select>
      </div>
    </div>
  )
}
