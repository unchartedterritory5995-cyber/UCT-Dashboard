// app/src/pages/calendar/MonthView.jsx
// True month grid with month nav (‹ June 2026 ›).
// Uses:
//   - useMonthCalendar(year, month) — fetches /api/calendar/month
//   - buildMonthGrid from monthGrid.js (pure, tested)
//   - mySets for mine-ring highlighting
// Mobile: falls back to a scrollable agenda list.

import { useState, useMemo } from 'react'
import CompanyLogo from '../../components/CompanyLogo'
import { useMonthCalendar } from './useCalendarData'
import { buildMonthGrid } from './monthGrid'
import styles from './Calendar.module.css'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri']

function fmtMonthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

// Merge mine-flag from weekly days map (which has mySets applied) into month entries.
// monthDaysMap comes from /api/calendar/month (no mine info).
// weeklyDays is the tagged days from Calendar.jsx (has mine flags for current week).
// For months other than the current week, we leave mySets applied via mySets prop.
function mergeMineFlagIntoMonthDay(monthDay, mySets, activeSources) {
  if (!mySets || !activeSources || activeSources.length === 0) return monthDay
  const allSources = activeSources
  const allSyms = [...(monthDay.bmo || []), ...(monthDay.amc || [])]
  const taggedBmo = (monthDay.bmo || []).map(e => ({
    ...e,
    mine: allSources.some(s => (mySets[s] || []).includes(e.sym?.toUpperCase())),
  }))
  const taggedAmc = (monthDay.amc || []).map(e => ({
    ...e,
    mine: allSources.some(s => (mySets[s] || []).includes(e.sym?.toUpperCase())),
  }))
  return { ...monthDay, bmo: taggedBmo, amc: taggedAmc }
}

// ── MonthGrid cell ─────────────────────────────────────────────────────────

function MonthCell({ cell, onOpenDay }) {
  const MAX_LOGOS = 6
  const shown = cell.syms.slice(0, MAX_LOGOS)
  const overflow = cell.syms.length - MAX_LOGOS
  return (
    <div
      className={[
        styles.gcell,
        cell.isToday  ? styles.gcellToday : '',
        !cell.inMonth ? styles.gcellOff   : '',
      ].join(' ')}
      onClick={() => cell.inMonth && onOpenDay(cell.ds)}
    >
      <div className={styles.dn}>
        {cell.dayNum}
        {cell.hasMacro && <span className={styles.macroStar}> ★</span>}
      </div>
      <div className={styles.glogos}>
        {shown.map(s => (
          <span key={s} className={cell.mineSyms.has(s) ? styles.mineRing : ''}>
            <CompanyLogo sym={s} size={18} />
          </span>
        ))}
        {overflow > 0 && <span className={styles.gmore}>+{overflow}</span>}
      </div>
    </div>
  )
}

// ── Mobile agenda list ─────────────────────────────────────────────────────

function AgendaList({ rows, onOpenDay }) {
  if (!rows.length) {
    return <div className={styles.loading}>No reporters this month.</div>
  }
  return (
    <div className={styles.agenda}>
      {rows.map(({ ds, entries }) => (
        <div key={ds} className={styles.agendaDay} onClick={() => onOpenDay(ds)}>
          <div className={styles.agendaDate}>{ds}</div>
          <div className={styles.agendaSyms}>
            {entries.map(e => (
              <span key={e.sym} className={styles.agendaSym}>{e.sym}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main MonthView ─────────────────────────────────────────────────────────

export default function MonthView({
  // Props from Calendar.jsx for current week enrichment:
  weeklyDays,       // { [ds]: { bmo, amc, ... } } — tagged with mine=true
  mySets,           // { watchlist, flagged, positions, uct20, all_mine }
  mySources,        // ['watchlist', 'flagged', ...]
  // Month cursor managed here:
  monthCursor,      // { year, month }
  setMonthCursor,   // fn
  // Navigation:
  onOpenDay,
}) {
  const { year, month } = monthCursor

  // Fetch full-month data from backend
  const { data: monthData } = useMonthCalendar(year, month)

  // Build day map: prefer weekly tagged data for current week, month data otherwise
  const monthDaysMap = useMemo(() => {
    const raw = monthData?.days || {}
    const out = {}
    for (const [ds, day] of Object.entries(raw)) {
      // If this day exists in the weekly tagged data (current week), use that (has mine flags)
      if (weeklyDays?.[ds]) {
        out[ds] = weeklyDays[ds]
      } else {
        // Apply mine flags from mySets for non-week days
        out[ds] = mergeMineFlagIntoMonthDay(day, mySets, mySources)
      }
    }
    return out
  }, [monthData, weeklyDays, mySets, mySources])

  // Build the 5-column weekday grid (pure function, tested)
  const grid = useMemo(
    () => buildMonthGrid(year, month, monthDaysMap, mySources),
    [year, month, monthDaysMap, mySources]
  )

  // Agenda rows for mobile (flat sorted list of days with entries)
  const agendaRows = useMemo(() => {
    const rows = []
    for (const row of grid) {
      for (const cell of row) {
        if (cell.inMonth && cell.syms.length > 0) {
          const day = monthDaysMap[cell.ds] || {}
          rows.push({
            ds: cell.ds,
            entries: [...(day.bmo || []), ...(day.amc || [])],
          })
        }
      }
    }
    return rows
  }, [grid, monthDaysMap])

  return (
    <div>
      {/* Month nav removed — CalendarHeader renders it in month view to avoid
          duplicate ‹ Month Year › controls. prevMonth/nextMonth are still
          passed up via setMonthCursor so CalendarHeader can call them. */}

      {/* Desktop grid (hidden on mobile via CSS) */}
      <div className={styles.mgridHd}>
        {WEEKDAYS.map(d => <div key={d} className={styles.scolLbl}>{d}</div>)}
      </div>
      <div className={`${styles.mgrid} ${styles.mgridDesktop}`}>
        {grid.flat().map(cell => (
          <MonthCell key={cell.ds} cell={cell} onOpenDay={onOpenDay} />
        ))}
      </div>

      {/* Mobile agenda (hidden on desktop via CSS) */}
      <div className={styles.mgridMobile}>
        <AgendaList rows={agendaRows} onOpenDay={onOpenDay} />
      </div>
    </div>
  )
}
