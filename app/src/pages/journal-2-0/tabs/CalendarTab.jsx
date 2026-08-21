/**
 * Calendar Tab — Year/Month/Week views over closed-trade history.
 * Spec: docs/superpowers/specs/2026-04-18-calendar-design.md
 *
 * Phase 1 / Step 2: Month view live. Year + Week land in Step 7.
 */

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useJ2Calendar from '../hooks/useJ2Calendar'
import { useFeatureFlag } from '../featureFlags'
import { renderMonthCardPng } from '../lib/monthCardPng'
import { downloadBlob, copyBlobToClipboard } from '../../../components/chart/chartScreenshot'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import useScope from '../hooks/useScope'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import ScopeBar from '../components/scope/ScopeBar'
import UIcon from '../../../components/ui/UIcon'
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

  const { accountId, account } = useJ2SelectedAccount()
  const isBroker =
    !!account && account.balanceSource && account.balanceSource !== 'manual'
  const { prefs, setPref } = usePreferences()
  const basisPref = parsePref(prefs.j2_calendar_pnl_basis, 'account')
  const effectiveBasis = isBroker ? basisPref : 'closed'

  // The calendar navigates its OWN dates (view/year/month/week), so the global
  // Scope date facet does NOT apply here — strip `date_from`/`date_to` and pass
  // only the non-date facets (symbol/sides/setups/tags + account_id, which the
  // scope's `apiParams` already carries) into the fetch. The A3 backend also
  // strips dates itself; omitting them here keeps the URL honest too.
  const { apiParams } = useScope()
  const calendarScopeParams = useMemo(() => {
    const { date_from, date_to, ...rest } = apiParams
    return rest
  }, [apiParams])

  const { days, totals, basis: serverBasis, isLoading, error } = useJ2Calendar({
    view, year, month, week, basis: effectiveBasis, scopeParams: calendarScopeParams,
  })
  // The server downgrades account→closed when no broker snapshots exist. Cells
  // key their $-display off the ACTUAL data basis (serverBasis); the header
  // toggle keeps showing the user's chosen preference (effectiveBasis).
  const dataBasis = serverBasis || effectiveBasis

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

  // First-run guidance: a fresh account with no closed trades renders an
  // all-zero grid with no context. Once the fetch settles with zero trades in
  // the period, prepend a subtle, non-intrusive note (the grid still renders
  // beneath it — we never replace it).
  const hasTrades = !!(totals && totals.tradeCount > 0)
  const showFirstRun = !isLoading && !error && !hasTrades

  return (
    <div className={styles.wrap}>
      <ScopeBar surface="calendar" dateApplies={false} />
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
        basis={effectiveBasis}
        showBasisToggle={isBroker}
        onBasisChange={(b) => setPref('j2_calendar_pnl_basis', b)}
      />

      {view === 'month' && hasTrades && (
        <MonthCardActions year={year} month={month} days={days} totals={totals} />
      )}

      {error && (
        <div className={styles.errorBanner} role="alert">
          Couldn't load calendar: {String(error.message || error)}
        </div>
      )}

      {showFirstRun && (
        <div className={styles.firstRun} role="status" data-testid="calendar-first-run">
          <UIcon name="calendar" size={14} />
          <span>Your trading days will appear here — log or import trades to get started.</span>
        </div>
      )}

      {view === 'month' && (
        <MonthView year={year} month={month} days={days} mode={mode} basis={dataBasis} />
      )}
      {view === 'year' && (
        <YearView year={year} days={days} mode={mode} />
      )}
      {view === 'week' && (
        <WeekView year={year} week={week || 1} days={days} mode={mode} basis={dataBasis} />
      )}

      {isLoading && days.length === 0 && (
        <p className={styles.hint}>Loading calendar…</p>
      )}
    </div>
  )
}


const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/** Save/Copy image for the month-recap card — same tradePng kill flag as the
 *  whole PNG-export family; inline error, never a crash. */
function MonthCardActions({ year, month, days, totals }) {
  const flagOn = useFeatureFlag('tradePng')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  if (!flagOn) return null
  const label = `${MONTH_NAMES[(month || 1) - 1]} ${year}`

  const run = async (deliver) => {
    setErr(null)
    setBusy(true)
    try {
      const blob = await renderMonthCardPng(label, days, totals)
      await deliver(blob)
    } catch {
      setErr('Couldn’t build the image.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.monthCardRow}>
      <button type="button" className={styles.monthCardBtn} disabled={busy}
        onClick={() => run((b) => downloadBlob(b, `month-${year}-${String(month).padStart(2, '0')}.png`))}>
        Save month image
      </button>
      <button type="button" className={styles.monthCardBtn} disabled={busy}
        onClick={() => run(async (b) => {
          const ok = await copyBlobToClipboard(b)
          if (!ok) setErr('Copy isn’t supported in this browser — use Save.')
        })}>
        Copy month image
      </button>
      {err && <span className={styles.monthCardErr} role="alert">{err}</span>}
    </div>
  )
}
