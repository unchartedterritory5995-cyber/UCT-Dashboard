// app/src/pages/Calendar.jsx
// Dominant-feed calendar: Feed / Week / Month views with logo cards, enrichment overlay,
// and My Stocks personalization. Route stays at this path so nav is unchanged.
// Week paging (?week=YYYY-MM-DD&d=YYYY-MM-DD), ticker search jump, and
// land-on-today: calendar flagship Deploy 1b.
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import ErrorBoundary from '../components/ErrorBoundary'
import EarningsModal from '../components/tiles/EarningsModal'
import { toModalRow, timingLabel } from './calendar/earningsModalRow'
import usePreferences, { parsePref } from '../hooks/usePreferences'
import {
  useCalendar,
  useCalendarMySets,
  useWeekEnrichment,
  buildWeekDates,
  mergeEnrichment,
  isMine,
  useIpos,
  useDividends,
} from './calendar/useCalendarData'
import { DEFAULT_FILTERS } from './calendar/filterLogic'
import CalendarHeader, { DEFAULT_EVENT_TYPES } from './calendar/CalendarHeader'
import FeedView from './calendar/FeedView'
import WeekView from './calendar/WeekView'
import MonthView from './calendar/MonthView'
import DayDetailDrawer from './calendar/DayDetailDrawer'
import styles from './calendar/Calendar.module.css'

// ── Helpers ported verbatim from the original Calendar.jsx ──────────────────
// These keep EarningsModal rendering identical to the old page.

function fmtWeekRange(start, end) {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end   + 'T00:00:00')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (s.getMonth() === e.getMonth()) {
    return `${months[s.getMonth()]} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`
  }
  return `${months[s.getMonth()]} ${s.getDate()} – ${months[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`
}

// ── Time helpers (Week Navigator) ────────────────────────────────────────────

// Monday (ISO date string) of the week containing an ISO date string.
export function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00')       // noon-anchored: DST-safe date math
  const shift = (d.getDay() + 6) % 7          // Mon=0 … Sun=6
  d.setDate(d.getDate() - shift)
  return d.toISOString().slice(0, 10)
}

// ET-anchored "today" — the backend anchors its week the same way, so a
// late-evening West-coast user lands on the day the payload flags is_today.
function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date())
}

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_SOURCES = ['watchlist', 'flagged', 'positions', 'uct20']

// ── Default month cursor (current month) ─────────────────────────────────────

function currentMonthCursor() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Calendar() {
  // ── URL time state: /calendar?week=YYYY-MM-DD&d=YYYY-MM-DD (deep-linkable) ──
  const [searchParams, setSearchParams] = useSearchParams()
  const rawWeek = searchParams.get('week')
  const weekParam = useMemo(() => {
    if (!rawWeek || !/^\d{4}-\d{2}-\d{2}$/.test(rawWeek)) return null
    const monday = mondayOf(rawWeek)
    // The current week rides the bare endpoint (legacy calendar_weekly cache
    // key) — treat an explicit current-week param as "no param".
    return monday === mondayOf(todayIso()) ? null : monday
  }, [rawWeek])
  const dParam = searchParams.get('d')

  const { data, error, mutate } = useCalendar(weekParam)
  const { data: mySets } = useCalendarMySets()
  const { prefs, setPref } = usePreferences()
  const [selected, setSelected] = useState(null)   // { row, label }
  const [openDay, setOpenDay] = useState(null)      // { ds, day } for DayDetailDrawer
  const [pulse, setPulse] = useState(null)           // { sym, ds } — search jump target

  // Month cursor — component state (not persisted; resets to current month on page mount)
  const [monthCursor, setMonthCursor] = useState(currentMonthCursor)

  // Persisted view / filter preferences
  const view = prefs.calendar_view || 'feed'
  const filters = { ...DEFAULT_FILTERS, ...parsePref(prefs.calendar_filters, {}) }
  const mySources = parsePref(prefs.calendar_mystocks_sources, ALL_SOURCES)
  const setView = v => setPref('calendar_view', v)
  const setFilters = f => setPref('calendar_filters', f)
  const setMySources = s => setPref('calendar_mystocks_sources', s)

  // B3: event type filter — persisted as array (Set not JSON-serializable)
  const _savedEventTypes = parsePref(prefs.calendar_event_types, null)
  const eventTypes = useMemo(
    () => _savedEventTypes ? new Set(_savedEventTypes) : DEFAULT_EVENT_TYPES,
    [_savedEventTypes],
  )
  const setEventTypes = next => setPref('calendar_event_types', [...next])

  // Build stable weekDates array from API data
  const weekDates = useMemo(() => {
    if (!data) return []
    return data.week_start
      ? buildWeekDates(data.week_start)
      : Object.keys(data.days || {}).sort()
  }, [data])

  // B3: fetch IPOs for the visible week range (only when chip enabled)
  const weekFrom = weekDates.length ? weekDates[0] : null
  const weekTo   = weekDates.length ? weekDates[weekDates.length - 1] : null
  const { data: iposRaw } = useIpos(
    eventTypes.has('ipos') ? weekFrom : null,
    eventTypes.has('ipos') ? weekTo   : null,
  )

  // B3: Group IPOs by date for quick lookup in DayGroup
  const iposByDate = useMemo(() => {
    if (!iposRaw) return {}
    const out = {}
    for (const ev of iposRaw) {
      const ds = ev.date
      if (!ds) continue
      if (!out[ds]) out[ds] = []
      out[ds].push(ev)
    }
    return out
  }, [iposRaw])

  // B3: fetch dividends/splits for current week's visible tickers
  // Use a stable comma-separated list of mySets tickers to avoid unbounded requests
  const mySymsList = useMemo(() => {
    if (!mySets) return null
    const all = new Set()
    for (const src of ALL_SOURCES) {
      for (const s of (mySets[src] || [])) all.add(s)
    }
    return [...all].sort().join(',') || null
  }, [mySets])
  const { data: dividendsRaw } = useDividends(
    eventTypes.has('dividends') ? mySymsList : null,
  )

  // B3: Group dividends/splits by date for quick lookup in DayGroup
  const dividendsByDate = useMemo(() => {
    if (!dividendsRaw) return {}
    const out = {}
    for (const ev of dividendsRaw) {
      const ds = ev.date
      if (!ds) continue
      if (!out[ds]) out[ds] = []
      out[ds].push(ev)
    }
    return out
  }, [dividendsRaw])

  // ── Enrichment overlay (CORRECTION 1: single stable hook, never in a loop) ──
  // One SWR call fans out to all days and returns { [ds]: { SYM: {...} } }.
  // weekDates is [] before data loads → key is null → SWR skips. Length never
  // changes between renders within the same data version, so hook count is stable.
  const { data: enrichmentByDate } = useWeekEnrichment(weekDates)

  // Tag every entry with mine/sources flags and merge enrichment overlay
  const days = useMemo(() => {
    if (!data) return {}
    const out = {}
    for (const ds of weekDates) {
      const d = data.days?.[ds]
      if (!d) continue
      const dayEnrich = enrichmentByDate?.[ds] || {}
      const tag = list => (list || []).map(entry => {
        const mine = isMine(entry.sym, mySets, mySources)
        const sources = ALL_SOURCES.filter(
          s => (mySets?.[s] || []).includes(entry.sym?.toUpperCase())
        )
        return { ...mergeEnrichment(entry, dayEnrich), mine, _sources: sources }
      })
      out[ds] = { ...d, bmo: tag(d.bmo), amc: tag(d.amc), tbd: tag(d.tbd) }
    }
    return out
  }, [data, weekDates, mySets, mySources, enrichmentByDate])

  // ── Week Navigator: per-day tab info (count + mine count) ─────────────────
  const dayTabs = useMemo(() => weekDates.map(ds => {
    const d = days[ds] || {}
    const all = [...(d.bmo || []), ...(d.amc || []), ...(d.tbd || [])]
    return {
      ds,
      label:    d.label || ds,
      count:    all.length,
      mineN:    all.filter(e => e.mine).length,
      is_today: !!d.is_today,
    }
  }), [weekDates, days])

  const isCurrentWeek = !weekParam

  // ── Navigation handlers ────────────────────────────────────────────────────
  const gotoWeek = useCallback((mondayIso, dayIso = null) => {
    const next = {}
    if (mondayIso && mondayIso !== mondayOf(todayIso())) next.week = mondayIso
    if (dayIso) next.d = dayIso
    setSearchParams(next)
  }, [setSearchParams])

  const shiftWeek = useCallback((deltaDays) => {
    const base = weekParam || mondayOf(todayIso())
    const d = new Date(base + 'T12:00:00')
    d.setDate(d.getDate() + deltaDays)
    gotoWeek(d.toISOString().slice(0, 10))
  }, [weekParam, gotoWeek])

  const scrollToDay = useCallback((ds) => {
    const el = document.getElementById(`day-${ds}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const gotoToday = useCallback(() => {
    const t = todayIso()
    gotoWeek(null)
    // Already on the current week → the payload won't change; scroll now.
    if (isCurrentWeek) scrollToDay(t)
  }, [gotoWeek, isCurrentWeek, scrollToDay])

  const onDayTab = useCallback((ds) => {
    // ONE verb in every view: "take me to that day". Feed scrolls; Week/Month
    // switch to Feed and scroll — a primary control must never no-op.
    if (view !== 'feed') setView('feed')
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('d', ds)
      return p
    }, { replace: true })
    requestAnimationFrame(() => scrollToDay(ds))
  }, [view, setView, scrollToDay, setSearchParams])

  // ── Search jump: sym in this week → scroll+pulse; else page to its week ────
  const onSearchJump = useCallback((sym, dateIso) => {
    const S = (sym || '').toUpperCase()
    if (!dateIso) return
    if (view !== 'feed') setView('feed')
    setPulse({ sym: S, ds: dateIso })
    if (weekDates.includes(dateIso)) {
      requestAnimationFrame(() => scrollToDay(dateIso))
    } else {
      gotoWeek(mondayOf(dateIso), dateIso)
    }
  }, [weekDates, view, setView, gotoWeek, scrollToDay])

  // Clear the pulse after the animation has played (2 × ~0.9s + settle)
  useEffect(() => {
    if (!pulse) return
    const t = setTimeout(() => setPulse(null), 2400)
    return () => clearTimeout(t)
  }, [pulse])

  // ── Land on today / on the deep-linked day (once per payload) ─────────────
  const landedRef = useRef(null)
  useEffect(() => {
    if (!data || view !== 'feed') return
    const key = `${data.week_start}|${dParam || ''}`
    if (landedRef.current === key) return
    landedRef.current = key
    const target = dParam && weekDates.includes(dParam)
      ? dParam
      : (isCurrentWeek ? todayIso() : null)
    if (target) {
      // Wait one frame so the day groups exist in the DOM.
      requestAnimationFrame(() => scrollToDay(target))
    }
  }, [data, dParam, weekDates, isCurrentWeek, view, scrollToDay])

  // ── onSelect: build the EarningsModal row using toModalRow (CORRECTION 2) ──
  const onSelect = (entry, timing) => {
    const label = timingLabel(timing)
    setSelected({ row: toModalRow(entry), label })
  }

  const weekLabel = data?.week_start && data?.week_end
    ? `Week of ${fmtWeekRange(data.week_start, data.week_end)}`
    : ''

  // ── Header is ALWAYS rendered — navigation must survive a failed week load
  //    (an arrow that strands you on a dead error page reads as broken). ─────
  const headerEl = (
    <CalendarHeader
      view={view}
      setView={setView}
      weekLabel={weekLabel}
      filters={filters}
      setFilters={setFilters}
      mySources={mySources}
      setMySources={setMySources}
      monthCursor={monthCursor}
      setMonthCursor={setMonthCursor}
      eventTypes={eventTypes}
      setEventTypes={setEventTypes}
      dayTabs={dayTabs}
      isCurrentWeek={isCurrentWeek}
      onPrevWeek={() => shiftWeek(-7)}
      onNextWeek={() => shiftWeek(7)}
      onGotoToday={gotoToday}
      onGotoWeek={gotoWeek}
      onDayTab={onDayTab}
      onSearchJump={onSearchJump}
    />
  )

  // ── Loading / error states (below the always-live header) ────────────────
  if (error || (data && (data.source === 'error' || data.source === 'out_of_range'))) {
    return (
      <div className={styles.page}>
        {headerEl}
        <div className={styles.error}>
          Couldn&apos;t load that week.{' '}
          <button className={styles.retryBtn} onClick={() => mutate()}>Retry</button>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={styles.page}>
        {headerEl}
        <div className={styles.skeletonWrap} aria-label="Loading calendar">
          {[0, 1, 2].map(i => (
            <div key={i} className={styles.skeletonDay}>
              <div className={styles.skeletonBar} />
              <div className={styles.skeletonRow} />
              <div className={styles.skeletonRowShort} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {headerEl}

      <div className={styles.body}>
        {view === 'feed' && (
          <FeedView
            weekDates={weekDates}
            days={days}
            filters={filters}
            onSelect={onSelect}
            eventTypes={eventTypes}
            iposByDate={iposByDate}
            dividendsByDate={dividendsByDate}
            pulse={pulse}
          />
        )}
        {view === 'week' && (
          <WeekView
            weekDates={weekDates}
            days={days}
            filters={filters}
            onSelect={onSelect}
          />
        )}
        {view === 'month' && (
          <MonthView
            weeklyDays={days}
            mySets={mySets}
            mySources={mySources}
            monthCursor={monthCursor}
            setMonthCursor={setMonthCursor}
            onOpenDay={(ds, day) => setOpenDay({ ds, day })}
          />
        )}
      </div>

      {openDay && (
        <DayDetailDrawer
          ds={openDay.ds}
          day={openDay.day || days[openDay.ds]}
          onClose={() => setOpenDay(null)}
          onSelect={onSelect}
        />
      )}

      {selected && (
        <ErrorBoundary
          fallback={
            <div style={{ color: 'var(--text-muted)', fontSize: '11px', padding: '12px' }}>
              Unable to load — click a ticker to retry.
            </div>
          }
          key={selected.row.sym}
        >
          <EarningsModal
            row={selected.row}
            label={selected.label}
            onClose={() => setSelected(null)}
          />
        </ErrorBoundary>
      )}
    </div>
  )
}
