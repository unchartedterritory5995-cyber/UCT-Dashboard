// app/src/pages/calendar/MonthView.jsx
// True month grid with month nav (‹ June 2026 ›).
// Uses:
//   - useMonthCalendar(year, month) — fetches /api/calendar/month
//   - buildMonthGrid from monthGrid.js (pure, tested)
//   - mySets for mine-ring highlighting
// Mobile: falls back to a scrollable agenda list.

import { useState, useMemo } from 'react'
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
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
// Reads like the week view — gold/blue BMO·AMC headers + logo + ticker-name
// rows — but scaled down to fit a ~1/5-width month cell, with each band capped
// so cells stay bounded. Bands stack (BMO above AMC) and use the full width
// (NOT side-by-side, which halved each band and clipped logo+ticker). Heavy
// days collapse the tail to "+N more"; click opens the day drawer for the rest.

const MONTH_MAX_PER_TIMING = 4   // logo+ticker rows; overflow collapses to "+N more"

function MonthTimingGroup({ label, icon, hdClass, syms, mineSyms }) {
  const shown = syms.slice(0, MONTH_MAX_PER_TIMING)
  const overflow = syms.length - MONTH_MAX_PER_TIMING
  return (
    <div className={styles.mband}>
      <div className={`${styles.mbandHd} ${hdClass}`}>
        <UIcon name={icon} size={12} aria-hidden="true" /> {label}
      </div>
      {shown.length ? (
        <>
          {shown.map(s => (
            <div key={s} className={styles.mrow}>
              <CompanyLogo sym={s} size={40} tile />
              <span className={`${styles.mt} ${mineSyms.has(s) ? styles.gold : ''}`}>{s}</span>
            </div>
          ))}
          {overflow > 0 && <div className={styles.mmore}>+{overflow} more</div>}
        </>
      ) : (
        <div className={styles.mbandEmpty}>—</div>
      )}
    </div>
  )
}

function MonthCell({ cell, onOpenDay }) {
  const empty = cell.bmoSyms.length === 0 && cell.amcSyms.length === 0
  return (
    <div
      className={[
        styles.gcell,
        cell.isToday  ? styles.gcellToday : '',
        !cell.inMonth ? styles.gcellOff   : '',
        empty && cell.inMonth ? styles.gcellEmpty : '',
      ].join(' ')}
      onClick={() => cell.inMonth && onOpenDay(cell.ds)}
    >
      <div className={styles.dn}>
        {cell.dayNum}
        {cell.hasMacro && <span className={styles.macroStar}> <UIcon name="star-fill" size={11} /></span>}
      </div>
      {empty ? (
        <div className={styles.mempty}>
          <span className={styles.wemptyDot} aria-hidden="true" />
          No earnings
        </div>
      ) : (
        <div className={styles.mtimings}>
          <MonthTimingGroup label="BMO" icon="sparkle" hdClass={styles.bmoHd} syms={cell.bmoSyms} mineSyms={cell.mineSyms} />
          <MonthTimingGroup label="AMC" icon="moon" hdClass={styles.amcHd} syms={cell.amcSyms} mineSyms={cell.mineSyms} />
        </div>
      )}
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
