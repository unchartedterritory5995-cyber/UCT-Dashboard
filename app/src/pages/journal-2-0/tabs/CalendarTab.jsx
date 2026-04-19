/**
 * Calendar Tab — Year/Month/Week views over closed-trade history.
 * Spec: docs/superpowers/specs/2026-04-18-calendar-design.md
 *
 * Phase 1 / Step 2: Month view live. Year + Week land in Step 7.
 */

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useJ2Calendar from '../hooks/useJ2Calendar'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import CalendarHeader from '../components/calendar/CalendarHeader'
import MonthView from '../components/calendar/MonthView'
import YearView from '../components/calendar/YearView'
import WeekView from '../components/calendar/WeekView'
import { todayET } from '../lib/calendar'
import styles from './CalendarTab.module.css'

const MODE_STORAGE_KEY = 'uct.j2.calendar.mode'

export default function CalendarTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [mode, setMode] = useState(
    () => localStorage.getItem(MODE_STORAGE_KEY) || 'pct',
  )

  // Default: this month in ET
  const today = todayET()
  const [defaultYear, defaultMonth] = useMemo(() => {
    const [y, m] = today.split('-')
    return [Number(y), Number(m)]
  }, [today])

  const view = searchParams.get('view') || 'month'
  const year = Number(searchParams.get('y')) || defaultYear
  const month = Number(searchParams.get('m')) || defaultMonth
  const week = Number(searchParams.get('w')) || undefined

  const { accountId } = useJ2SelectedAccount()
  const { days, totals, isLoading, error } = useJ2Calendar({
    view, year, month, week, accountId,
  })

  const setView = (newView) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('view', newView)
      next.delete('m'); next.delete('w')
      if (newView === 'month') next.set('m', String(defaultMonth))
      if (newView === 'week') next.set('w', '1')
      next.set('y', String(year))
      return next
    }, { replace: true })
  }

  const setPeriod = ({ year: ny, month: nm, week: nw }) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (ny != null) next.set('y', String(ny))
      if (nm != null) next.set('m', String(nm))
      if (nw != null) next.set('w', String(nw))
      return next
    }, { replace: true })
  }

  const setModePersisted = (m) => {
    setMode(m)
    localStorage.setItem(MODE_STORAGE_KEY, m)
  }

  return (
    <div className={styles.wrap}>
      <CalendarHeader
        view={view}
        year={year}
        month={month}
        week={week}
        totals={totals}
        mode={mode}
        onViewChange={setView}
        onPeriodChange={setPeriod}
        onModeChange={setModePersisted}
      />

      {error && (
        <div className={styles.errorBanner} role="alert">
          Couldn't load calendar: {String(error.message || error)}
        </div>
      )}

      {view === 'month' && (
        <MonthView year={year} month={month} days={days} mode={mode} />
      )}
      {view === 'year' && (
        <YearView year={year} days={days} mode={mode} />
      )}
      {view === 'week' && (
        <WeekView year={year} week={week || 1} days={days} mode={mode} />
      )}

      {isLoading && days.length === 0 && (
        <p className={styles.hint}>Loading calendar…</p>
      )}
    </div>
  )
}
