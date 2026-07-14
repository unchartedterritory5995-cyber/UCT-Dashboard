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
  useWeekMetrics,
  buildWeekDates,
  mergeEnrichment,
  isMine,
  useIpos,
  useDividends,
} from './calendar/useCalendarData'
import { DEFAULT_FILTERS, applyFilters } from './calendar/filterLogic'
import { tierWeek, FEATURED_CAP } from './calendar/importance'
import CalendarHeader, { DEFAULT_EVENT_TYPES } from './calendar/CalendarHeader'
import FeedView from './calendar/FeedView'
import TodaysBrief from './calendar/TodaysBrief'
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

// Format a Date's LOCAL calendar parts as ISO — never toISOString(), which
// converts to UTC and shifts the date for UTC+13/+14 browsers (NZDT, Samoa).
function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Monday (ISO date string) of the week containing an ISO date string.
// Returns null for calendar-invalid input ('2026-13-05' passes the URL regex
// but must fall back to the current week, not crash the render).
export function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00')       // noon-anchored: DST-safe date math
  if (Number.isNaN(d.getTime())) return null
  const shift = (d.getDay() + 6) % 7          // Mon=0 … Sun=6
  d.setDate(d.getDate() - shift)
  return localIso(d)
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
    const monday = mondayOf(rawWeek)   // null for calendar-invalid dates
    if (!monday) return null
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

  // Persisted view / filter preferences. VIEW key bumped to _v2: the Week grid
  // is now the flagship competitor-style board (big logo tiles, the EarningsHub
  // look), so it's the new default landing view. Bumping the key resets every
  // legacy 'feed' pref to Week once; the choice persists under v2 thereafter.
  const view = prefs.calendar_view_v2 || 'week'
  // FILTERS key bumped to _v2 (owner decision 2026-07-13): first paint now
  // defaults to the full market ranked big→small (audience 'all'). Legacy
  // metric filters carry over once; audience/sort reset to the new default,
  // then every choice persists under v2.
  const _savedFiltersV2 = parsePref(prefs.calendar_filters_v2, null)
  const filters = _savedFiltersV2
    ? { ...DEFAULT_FILTERS, ..._savedFiltersV2 }
    : {
        ...DEFAULT_FILTERS,
        ...parsePref(prefs.calendar_filters, {}),
        audience: DEFAULT_FILTERS.audience,
        sort: DEFAULT_FILTERS.sort,
      }
  const mySources = parsePref(prefs.calendar_mystocks_sources, ALL_SOURCES)
  const setView = v => setPref('calendar_view_v2', v)
  const setFilters = f => setPref('calendar_filters_v2', f)
  const setMySources = s => setPref('calendar_mystocks_sources', s)

  // Density: EarningsHub logo tiles (default) vs the WSE-style data-row table.
  const density = prefs.calendar_density || 'tiles'
  const setDensity = v => setPref('calendar_density', v)

  // Quick search — EPHEMERAL component state, deliberately never persisted
  // (a stale saved search silently blanking next session reads as data loss).
  // Merged over the saved filters right before the views consume them; a
  // fresh object per render matches how `filters` itself already behaves.
  const [quickQ, setQuickQ] = useState('')
  const effFilters = { ...filters, q: quickQ }

  // Event type filter — persisted as array (Set not JSON-serializable). KEY
  // BUMPED to _v2: macro used to be a locked always-on chip, so every legacy
  // saved pref carries macro not by choice. Bumping the key resets everyone to
  // the new earnings-only default; macro/IPO/dividend toggles persist under v2.
  const _savedEventTypes = parsePref(prefs.calendar_event_types_v2, null)
  const eventTypes = useMemo(
    () => _savedEventTypes ? new Set(_savedEventTypes) : DEFAULT_EVENT_TYPES,
    [_savedEventTypes],
  )
  const setEventTypes = next => setPref('calendar_event_types_v2', [...next])

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
  const { data: metricsByDate } = useWeekMetrics(weekDates, !weekParam)

  // Tag every entry with mine/sources flags and merge the enrichment +
  // metrics overlays. Metrics MUST land here, before tiering — the importance
  // hierarchy ranks on mc_b / dollar-volume.
  const days = useMemo(() => {
    if (!data) return {}
    const out = {}
    for (const ds of weekDates) {
      const d = data.days?.[ds]
      if (!d) continue
      const dayEnrich  = enrichmentByDate?.[ds] || {}
      const dayMetrics = metricsByDate?.[ds] || {}
      const tag = list => (list || []).map(entry => {
        const mine = isMine(entry.sym, mySets, mySources)
        // _sources drives the imp_eff personalization boost AND the future
        // Brief-rail badges — it MUST honor the user's active source picker,
        // exactly like `mine` does. Using ALL_SOURCES boosted names via a
        // source the user disabled (a phantom position weighting the ranking).
        const sources = mySources.filter(
          s => (mySets?.[s] || []).includes(entry.sym?.toUpperCase())
        )
        const m = dayMetrics[entry.sym]
        const withMetrics = m ? {
          ...entry,
          _price:   m.price   ?? entry._price,
          _avg_vol: m.avg_vol ?? entry._avg_vol,
          mc_b:     entry.mc_b ?? m.mc_b,
        } : entry
        return { ...mergeEnrichment(withMetrics, dayEnrich), mine, _sources: sources, _ds: ds }
      })
      out[ds] = { ...d, bmo: tag(d.bmo), amc: tag(d.amc), tbd: tag(d.tbd) }
    }
    return out
  }, [data, weekDates, mySets, mySources, enrichmentByDate, metricsByDate])

  // Quick-bar summary: how much of the loaded week is visible under the
  // current filters (raw vs filtered), plus the user's own count. Cheap loop
  // over already-tagged entries — recomputes with the render, like filters.
  const weekCounts = (() => {
    let raw = 0, total = 0, mine = 0
    for (const ds of weekDates) {
      const d = days[ds]
      if (!d) continue
      const all = [
        ...(d.bmo || []).map(e => ({ ...e, _timing: 'bmo' })),
        ...(d.amc || []).map(e => ({ ...e, _timing: 'amc' })),
        ...(d.tbd || []).map(e => ({ ...e, _timing: 'tbd' })),
      ]
      raw += all.length
      const vis = applyFilters(all, effFilters)
      total += vis.length
      for (const e of vis) if (e.mine) mine += 1
    }
    return { raw, total, mine, hidden: raw - total }
  })()

  // One-tap reset for the QUICK filters only (search + cap pill) — the ⚙
  // panel's audience/sort/metric choices are deliberate and stay put.
  const onClearQuick = () => {
    setQuickQ('')
    if (filters.minMcap > 0) setFilters({ ...filters, minMcap: 0 })
  }

  // Sectors actually present this week, most-reporters-first — drives the
  // sector-scoping chip row. Derived from loaded entries so counts are honest.
  const availableSectors = useMemo(() => {
    const counts = {}
    for (const ds of weekDates) {
      const d = days[ds]
      if (!d) continue
      for (const e of [...(d.bmo || []), ...(d.amc || []), ...(d.tbd || [])]) {
        if (e.sector) counts[e.sector] = (counts[e.sector] || 0) + 1
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [days, weekDates])

  // ── The hierarchy: one tier map drives Board/Week/Month identically ───────
  // Main Event is FROZEN per (week, day) once the enrichment overlay has
  // landed — imp includes the expected-move term, so an unfrozen pick could
  // flip seconds after first paint when enrichment arrives. At most one
  // upgrade happens (pre-enrichment provisional → enriched pick), then it
  // sticks for the payload's lifetime.
  const mainEventFrozen = useRef({})
  const weekTiers = useMemo(() => {
    const tiers = tierWeek(days, weekDates)
    const weekKey = data?.week_start || ''
    // Freeze ONLY once metrics have actually DELIVERED data for this week —
    // mc_b is the dominant imp term and arrives lazily. A failed batch resolves
    // to {} (defined but empty); gating on `!== undefined` froze the pick on a
    // metrics-less ranking that never healed. Non-empty ⇒ real data landed.
    const metricsReady = !!metricsByDate && Object.keys(metricsByDate).length > 0
    for (const ds of weekDates) {
      const t = tiers[ds]
      if (!t) continue
      const fkey = `${weekKey}|${ds}`
      const frozen = mainEventFrozen.current[fkey]
      const dayHas = sym => ['bmo', 'amc', 'tbd'].some(
        b => (days[ds]?.[b] || []).some(e => e.sym === sym))
      if (frozen !== undefined && (frozen === null || dayHas(frozen))) {
        if (frozen !== t.mainEvent && frozen !== null) {
          // Override to the frozen pick; demote the newly-computed pick into
          // featured so it isn't lost — then keep the card budget: the frozen
          // main event + featured must not exceed FEATURED_CAP total.
          if (t.mainEvent) t.featured.add(t.mainEvent)
          t.featured.delete(frozen)
          t.table.delete(frozen)
          t.compact.delete(frozen)
          while (t.featured.size > FEATURED_CAP - 1) {
            const lowest = [...t.featured].pop()   // Set is ranked-desc insertion order
            t.featured.delete(lowest)
            t.table.add(lowest)
          }
        }
        t.mainEvent = frozen
      } else if (metricsReady) {
        mainEventFrozen.current[fkey] = t.mainEvent
      }
    }
    return tiers
  }, [days, weekDates, data?.week_start, enrichmentByDate, metricsByDate])

  // Prune freeze keys from weeks the user has paged away from — the ref would
  // otherwise grow one entry per (week, day) across a long browsing session.
  useEffect(() => {
    const live = new Set(weekDates.map(ds => `${data?.week_start || ''}|${ds}`))
    const store = mainEventFrozen.current
    for (const k of Object.keys(store)) {
      if (!live.has(k)) delete store[k]
    }
  }, [weekDates, data?.week_start])

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
    if (!base) return
    const d = new Date(base + 'T12:00:00')
    if (Number.isNaN(d.getTime())) return
    d.setDate(d.getDate() + deltaDays)
    gotoWeek(localIso(d))
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

  // ── Keyboard core: ←/→ page weeks, T jumps to today (terminal lens) ───────
  // Latest-state ref so the listener stays stable but sees live modal state.
  const kbdBlockedRef = useRef(false)
  kbdBlockedRef.current = !!selected || !!openDay   // modal / drawer open
  useEffect(() => {
    const onKey = (e) => {
      if (kbdBlockedRef.current) return   // don't page weeks behind a modal
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
                || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (view === 'month') return   // month nav owns time there
      if (e.key === 'ArrowLeft')  { e.preventDefault(); shiftWeek(-7) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); shiftWeek(7) }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); gotoToday() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, shiftWeek, gotoToday])

  // Clear the pulse after the animation has played (2 × ~0.9s + settle).
  // The timer starts only once the TARGET DAY is actually rendered — starting
  // at click time expired the pulse while a cold paged week was still
  // building (3-15s), silently losing the highlight on far jumps.
  useEffect(() => {
    if (!pulse) return
    if (!data?.days?.[pulse.ds]) return   // target week not loaded yet
    const t = setTimeout(() => setPulse(null), 2400)
    return () => clearTimeout(t)
  }, [pulse, data])

  // ── Land on today / on the deep-linked day (once per payload) ─────────────
  const landedRef = useRef(null)
  useEffect(() => {
    if (!data || view !== 'feed') return
    // Never stamp the landing key on an error/empty payload — the scroll
    // can't succeed there, and stamping would suppress the landing after a
    // successful Retry of the same week.
    if (data.source === 'error' || data.source === 'out_of_range') return
    // Wait for the personalization set on the CURRENT week before landing: the
    // Brief rail grows above the feed once my-sets resolves (its cluster height
    // is unknown until then), and scrolling before that growth leaves today
    // pushed below the top. On a paged week there is no Brief rail — land now.
    if (isCurrentWeek && mySets === undefined) return
    const key = `${data.week_start}|${dParam || ''}`
    if (landedRef.current === key) return
    landedRef.current = key
    const target = dParam && weekDates.includes(dParam)
      ? dParam
      : (isCurrentWeek ? todayIso() : null)
    if (target) {
      // Two frames: one for the day groups + the now-settled Brief rail to
      // exist in the DOM, one for their final layout before we measure offsets.
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToDay(target)))
    }
  }, [data, dParam, weekDates, isCurrentWeek, view, mySets, scrollToDay])

  // ── onSelect: build the EarningsModal row using toModalRow (CORRECTION 2) ──
  const onSelect = (entry, timing) => {
    const label = timingLabel(timing)
    setSelected({ row: toModalRow(entry), label, reportDate: entry._ds, timing })
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
      availableSectors={availableSectors}
      quickQ={quickQ}
      setQuickQ={setQuickQ}
      weekCounts={weekCounts}
      density={density}
      setDensity={setDensity}
      onClearQuick={onClearQuick}
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
          <>
            {isCurrentWeek && (
              <TodaysBrief
                days={days}
                weekDates={weekDates}
                todayIso={todayIso()}
                onSelect={onSelect}
              />
            )}
            <FeedView
              weekDates={weekDates}
              days={days}
              filters={effFilters}
              onSelect={onSelect}
              eventTypes={eventTypes}
              iposByDate={iposByDate}
              dividendsByDate={dividendsByDate}
              pulse={pulse}
              weekTiers={weekTiers}
              density={density}
              onClearQuick={onClearQuick}
            />
          </>
        )}
        {view === 'week' && (
          <WeekView
            weekDates={weekDates}
            days={days}
            filters={effFilters}
            eventTypes={eventTypes}
            onSelect={onSelect}
            weekTiers={weekTiers}
            onOpenDay={(ds) => setOpenDay({ ds, day: days[ds] })}
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
            reportDate={selected.reportDate}
            timing={selected.timing}
            onClose={() => setSelected(null)}
          />
        </ErrorBoundary>
      )}
    </div>
  )
}
