// app/src/pages/Calendar.jsx
// Dominant-feed calendar: Feed / Week / Month views with logo cards, enrichment overlay,
// and My Stocks personalization. Route stays at this path so nav is unchanged.
import { useState, useMemo } from 'react'
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

function fmtEps(v) {
  if (v == null) return null
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(2)}`
}

function fmtRev(v) {
  if (v == null) return null
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}B`
  return `$${Math.round(v)}M`
}

function fmtWeekRange(start, end) {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end   + 'T00:00:00')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (s.getMonth() === e.getMonth()) {
    return `${months[s.getMonth()]} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`
  }
  return `${months[s.getMonth()]} ${s.getDate()} – ${months[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`
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
  const { data, error } = useCalendar()
  const { data: mySets } = useCalendarMySets()
  const { prefs, setPref } = usePreferences()
  const [selected, setSelected] = useState(null)   // { row, label }
  const [openDay, setOpenDay] = useState(null)      // { ds, day } for DayDetailDrawer

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
      out[ds] = { ...d, bmo: tag(d.bmo), amc: tag(d.amc) }
    }
    return out
  }, [data, weekDates, mySets, mySources, enrichmentByDate])

  // ── onSelect: build the EarningsModal row using toModalRow (CORRECTION 2) ──
  const onSelect = (entry, timing) => {
    const label = timingLabel(timing)
    setSelected({ row: toModalRow(entry), label })
  }

  // ── Loading / error states ───────────────────────────────────────────────
  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.error}>Failed to load calendar data</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading calendar…</div>
      </div>
    )
  }

  const weekLabel = data.week_start && data.week_end
    ? `Week of ${fmtWeekRange(data.week_start, data.week_end)}`
    : ''

  return (
    <div className={styles.page}>
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
      />

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
