// app/src/pages/Calendar.jsx
// Dominant-feed calendar: Feed / Week / Month views with logo cards, enrichment overlay,
// and My Stocks personalization. Route stays at this path so nav is unchanged.
// Week paging (?week=YYYY-MM-DD&d=YYYY-MM-DD), ticker search jump, and
// land-on-today: calendar flagship Deploy 1b.
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useLocation } from 'react-router-dom'
import ErrorBoundary from '../components/ErrorBoundary'
import EarningsResearchModal from '../components/research/EarningsResearchModal'
import useEarningsModalRoute, { resolveFeedEntry, normalizeSym } from './calendar/useEarningsModalRoute'
import useSettledSym from '../hooks/useSettledSym'
import { toModalRow, timingLabel, todayIso, shouldUnwindHistory } from './calendar/earningsModalRow'
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
import { mondayOf, currentWeekMonday, localIso } from './calendar/weekAnchor'
import { DEFAULT_FILTERS, applyFilters } from './calendar/filterLogic'
import { tierWeek, FEATURED_CAP } from './calendar/importance'
import CalendarHeader, { DEFAULT_EVENT_TYPES } from './calendar/CalendarHeader'
import FeedView from './calendar/FeedView'
import WireView from './calendar/WireView'
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
//
// `mondayOf` / `localIso` / `currentWeekMonday` now live in ./calendar/weekAnchor.js
// — read its header before touching week math. The short version: `mondayOf`
// answers "which week CONTAINS this date" (used for a URL param or a payload
// day), `currentWeekMonday` answers "which week is the calendar SHOWING right
// now", and only the second one rolls a weekend forward. They are NOT
// interchangeable: using `mondayOf(todayIso())` as the current-week anchor is
// precisely the bug that made week navigation a no-op every weekend.
// `mondayOf` is re-exported so existing importers keep working.
export { mondayOf }

// `todayIso`/`shouldUnwindHistory` moved to ./calendar/earningsModalRow.js
// (T11 review round 1, minor) — that module is already imported by BOTH
// Calendar.jsx and MyStocksHub.jsx, so sharing it costs nothing extra in
// either mount's bundle, unlike importing from Calendar.jsx itself (which
// would drag CalendarHeader/FeedView/WeekView/MonthView/DayDetailDrawer into
// MyStocksHub's lazy chunk). Re-exported here so existing imports of
// `shouldUnwindHistory` from this module keep working.
export { shouldUnwindHistory }

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
    // key) — treat an explicit current-week param as "no param". "Current"
    // MUST be the backend's answer (`currentWeekMonday`), not the week
    // containing today: on a Saturday those are 7 days apart, and the bare
    // endpoint serves the FORWARD one.
    return monday === currentWeekMonday(todayIso()) ? null : monday
  }, [rawWeek])
  const dParam = searchParams.get('d')

  const { data, error, mutate } = useCalendar(weekParam)
  const { data: mySets } = useCalendarMySets()
  const { prefs, setPref } = usePreferences()
  const [selected, setSelected] = useState(null)   // { row, label }
  const [openDay, setOpenDay] = useState(null)      // { ds, day } for DayDetailDrawer
  const [pulse, setPulse] = useState(null)           // { sym, ds } — search jump target

  // ── Earnings research modal: URL-routed at this mount (P2 T11 / §4.4) ─────
  const { pathname } = useLocation()
  const route = useEarningsModalRoute({ enabled: true, pathname })
  const resolveRef = useRef(null)   // guards the next-report fetch — one ask per symbol
  // T11 review round 1, C3: the ErrorBoundary around the modal has no reset —
  // once tripped it renders the fallback until unmounted. Un-keying it (so
  // arrow-stepping reuses the shell) removed the ONLY way out of a crashed
  // boundary, since `key` was the sole thing that ever remounted it. Keying
  // on this counter instead — bumped on a genuine fresh open, untouched by
  // stepping (route.step) — restores recovery (click a different ticker)
  // without reintroducing a remount on every step.
  //
  // CAUGHT IN TESTING: bumping openSeq synchronously inside onSelect (the
  // click handler) is NOT enough on its own. onSelect's routed branch only
  // calls route.open(sym) — the URL updates in the same render as openSeq,
  // but `selected` (the DATA actually passed to the modal) is set later, by
  // the resolution effect below, which runs AFTER commit. That leaves one
  // render where the boundary has ALREADY remounted (new key) but is still
  // being fed the OLD, stale `selected.row` — if that stale data is what was
  // crashing, the fresh boundary crashes again on its very first paint,
  // before the correct data ever arrives, and then just sits tripped (no key
  // change follows, since openSeq already bumped). `openMarkerRef` fixes
  // this: onSelect records the symbol it's opening; the resolution effect
  // only bumps openSeq at the exact moment it ALSO commits that symbol's
  // real data — so the key change and the fresh data land in the same
  // render, never one render apart.
  const [openSeq, setOpenSeq] = useState(0)
  const openMarkerRef = useRef(null)

  // Month cursor — component state (not persisted; resets to current month on page mount)
  const [monthCursor, setMonthCursor] = useState(currentMonthCursor)

  // Persisted view / filter preferences. VIEW key bumped to _v3 (owner-approved
  // UX pass 2026-07-14): ONE self-describing segment — Board (logo mosaic,
  // default) | Table (day-by-day WSE data table) | Month. This retires the
  // muddy Feed/Week split AND the Tiles|Rows density toggle: Feed-in-tiles was
  // visually redundant with the Board, and the flagship table was hidden two
  // non-obvious clicks deep. v2 prefs migrate once: feed+rows→table, else
  // board; month stays month.
  const _viewV2 = prefs.calendar_view_v2
  const _savedViewV3 = prefs.calendar_view_v3
  const view = _savedViewV3 || (
    _viewV2 === 'month' ? 'month'
    : (_viewV2 === 'feed' && prefs.calendar_density === 'rows') ? 'table'
    : 'board'
  )
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
  const setView = v => setPref('calendar_view_v3', v)
  const setFilters = f => setPref('calendar_filters_v2', f)
  const setMySources = s => setPref('calendar_mystocks_sources', s)

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

  // ── Deep-link resolution ladder (§4.4). Never a blank modal, never a loop. ──
  useEffect(() => {
    const want = route.sym
    // Minor (T11 review round 1): reset on close too, not just on a hit — a
    // transient next-report failure must not downgrade that symbol to the
    // minimal row for the rest of the page session; the next time it's
    // opened deserves a fresh ask.
    if (!want) { setSelected(null); resolveRef.current = null; return }
    if (selected?.row?.sym === want) {
      // GATE a / Task 12 (found live on CAT, 2026-08-04): `days` can change
      // AGAIN after this symbol already resolved — the enrichment-batch
      // fetch always starts strictly after the base /api/calendar payload
      // renders, so a fast click (Month view -> day drawer -> ticker) can hit
      // the branch below and commit a row BEFORE enrichment lands. This guard
      // exists to stop redundant re-resolution once a symbol is already
      // showing, but left as a bare return it also froze that row FOREVER,
      // even once `days` went on to gain the enrichment it was missing —
      // nothing else ever re-checks it, so the History section stayed on the
      // empty state for the rest of the modal's life.
      //
      // The three enrichment fields are THREE INDEPENDENT PROVIDERS
      // (beat_history: Finnhub, hist_stats: FMP/AV, expected_move: the
      // options chain) that can each arrive — or permanently fail — on their
      // own schedule (live-verified: CAT's beat_history sat behind a 10-min
      // Finnhub negative-cache while hist_stats/expected_move had ALREADY
      // landed — see api/services/earnings_estimates.py's `_INTEL_FAIL_TTL`).
      // An earlier version of this guard stopped re-checking the moment ANY
      // ONE field showed up, which froze the row with beat_history
      // permanently null even after it later became available — exactly the
      // field EarningsHistorySection's emptiness depends on. So: keep
      // re-checking as long as ANY field is still missing, and only commit
      // when the fresh lookup actually GAINS a field the row doesn't already
      // have (never when it has none of what's missing either — that's a
      // correctly, permanently partial row, e.g. `expected_move` on a past
      // day, and must not be fought forever).
      const row = selected.row
      const stillMissing = row.beat_history == null
        || row.hist_stats == null || row.expected_move == null
      if (!stillMissing) return
      const hit = resolveFeedEntry(want, days)
      const gained = hit && (
        (row.beat_history == null && hit.entry.beat_history != null)
        || (row.hist_stats == null && hit.entry.hist_stats != null)
        || (row.expected_move == null && hit.entry.expected_move != null)
      )
      // Not a fresh open — no openSeq bump (that would remount the
      // ErrorBoundary mid-view for no reason) and no resolveRef/ask-ladder
      // churn; this only ever upgrades an already-committed row in place.
      if (gained) {
        setSelected({ row: toModalRow(hit.entry), label: timingLabel(hit.timing),
                       reportDate: hit.ds, timing: hit.timing, entry: hit.entry })
      }
      return
    }

    const hit = resolveFeedEntry(want, days)

    // Task 14 (found live, AMD/CAT 2026-08-04): a miss here is NOT the same as
    // "this symbol doesn't report in this week" while `data` — the raw payload
    // behind `days` for whichever week is currently selected — is still
    // loading. `days` is legitimately `{}` before the FIRST /api/calendar
    // response for this week lands, and treating that transient emptiness as
    // authoritative fired the /next-report fallback before the real week data
    // ever got a chance to answer. That fallback answers "when does this
    // symbol report NEXT" against FMP/Finnhub — which excludes a report that
    // has ALREADY happened today (epsActual now populated) — so a same-week
    // deep link raced its own correct resolution into a jump 13 weeks out,
    // then (useCalendar's `keepPreviousData` is false) orphaned the real
    // current-week payload entirely once the URL's `week` param moved,
    // degrading the row to the minimal fallback when the wrong week couldn't
    // corroborate it either. Wait for the real payload before trusting a miss.
    if (!hit && !data) return

    // C3: bump openSeq in the SAME call as the setSelected it's paired with
    // — see the doc comment on openMarkerRef above. `commit` centralizes
    // that pairing so every setSelected in this ladder does it identically;
    // only fires when THIS effect run is resolving the symbol onSelect just
    // asked to open (never on a step, which never touches openMarkerRef).
    // Computed AFTER the `!data` bail above — clearing the fresh-open marker
    // before the week payload has even loaded would strand the NEXT (real)
    // resolution without it, silently dropping the openSeq bump that gives
    // the ErrorBoundary a fresh mount on a genuine fresh open.
    const isFreshOpen = openMarkerRef.current === want
    if (isFreshOpen) openMarkerRef.current = null
    const commit = (row) => {
      if (isFreshOpen) setOpenSeq((s) => s + 1)
      setSelected(row)
    }

    if (hit) {
      resolveRef.current = null
      commit({ row: toModalRow(hit.entry), label: timingLabel(hit.timing),
               reportDate: hit.ds, timing: hit.timing, entry: hit.entry })
      return
    }
    // Ask ONCE per symbol; a failed lookup must never re-fire.
    if (resolveRef.current === want) {
      if (isFreshOpen) setOpenSeq((s) => s + 1)
    // `history_unresolved` marks this as a GUESS, not an answer. The modal's
    // Earnings History section otherwise reads an empty row as the CLAIM "no
    // reported quarters yet" — and it cannot tell this row apart from a real
    // one by shape, because a bare `{ sym }` is exactly what MyStocksHub and
    // the direct research routes pass for a company that genuinely has none.
    // Only here do we know we never resolved the symbol. Lived 2026-08-08:
    // `?earnings=JAZZ` on a Saturday resolves to its November report, which
    // the calendar feed does not carry yet, so JAZZ -- nine reported quarters
    // -- was told it had never reported one.
      setSelected((prev) => (prev?.row?.sym === want ? prev
        : { row: { sym: want, history_unresolved: true },
            label: timingLabel(null), reportDate: null, timing: null }))
      return
    }
    resolveRef.current = want
    fetch(`/api/calendar/next-report?sym=${encodeURIComponent(want)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // Stale-response guard (Task 14): this ask may have been superseded
        // by a resolution that already succeeded — via resolveFeedEntry
        // finding the symbol once real data landed, or a different symbol's
        // ask — while it was in flight. A late answer must never act once
        // it's no longer the live ask for `want`.
        if (resolveRef.current !== want) return
        const monday = d?.date ? mondayOf(d.date) : null
        if (monday) route.jumpToWeek(monday)
        else {
          // Unresolved for the same reason as above — mark the guess.
          commit({ row: { sym: want, history_unresolved: true },
                   label: timingLabel(null), reportDate: null, timing: null })
        }
      })
      .catch(() => {
        if (resolveRef.current !== want) return
        commit({ row: { sym: want, history_unresolved: true },
                 label: timingLabel(null), reportDate: null, timing: null })
      })
  }, [route.sym, days, data])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stepping across the open day's reporters ──────────────────────────────
  const daySyms = useMemo(() => {
    const ds = selected?.reportDate
    const day = ds ? days?.[ds] : null
    if (!day) return []
    return ['bmo', 'amc', 'tbd'].flatMap((t) => (day[t] || []).map((e) => e.sym))
  }, [days, selected?.reportDate])

  const stepIdx = daySyms.indexOf(selected?.row?.sym)
  const stepTo = useCallback((delta) => {
    const next = daySyms[stepIdx + delta]
    if (next) route.step(next)
  }, [daySyms, stepIdx, route])

  const { stepping } = useSettledSym(selected?.row?.sym ?? null)
  const isTodayReporter = selected?.reportDate === todayIso()

  // Every dismiss path (Escape / backdrop / the × button — all three fire
  // through this one onClose) goes through shouldUnwindHistory (see above)
  // rather than blindly calling route.close().
  const dismissModal = useCallback(() => {
    if (shouldUnwindHistory(route)) route.close()
    else setSelected(null)
  }, [route])

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
  // Counts are FILTERED (same lens as the views) — unfiltered tab counts next
  // to filtered day cards read as a contradiction ("tab says 4, day says
  // No earnings"). effFilters is a fresh object each render; keying the memo
  // on its meaningful parts keeps the recompute honest without thrashing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dayTabs = useMemo(() => weekDates.map(ds => {
    const d = days[ds] || {}
    const all = [
      ...(d.bmo || []).map(e => ({ ...e, _timing: 'bmo' })),
      ...(d.amc || []).map(e => ({ ...e, _timing: 'amc' })),
      ...(d.tbd || []).map(e => ({ ...e, _timing: 'tbd' })),
    ]
    const vis = applyFilters(all, effFilters)
    return {
      ds,
      label:    d.label || ds,
      count:    vis.length,
      mineN:    vis.filter(e => e.mine).length,
      is_today: !!d.is_today,
    }
  }), [weekDates, days, JSON.stringify(effFilters)])

  const isCurrentWeek = !weekParam

  // ── Navigation handlers ────────────────────────────────────────────────────
  const gotoWeek = useCallback((mondayIso, dayIso = null) => {
    const next = {}
    // Same anchor as `weekParam` above — these two decisions have to be the
    // same decision, or a "go to this week" lands somewhere the reader of the
    // URL disagrees with.
    if (mondayIso && mondayIso !== currentWeekMonday(todayIso())) next.week = mondayIso
    if (dayIso) next.d = dayIso
    setSearchParams(next)
  }, [setSearchParams])

  const shiftWeek = useCallback((deltaDays) => {
    // The base for ±7 must be the week ON SCREEN. With no `?week=` that is the
    // backend's current week; anchoring on `mondayOf(todayIso())` instead made
    // "next" resolve to the displayed week (no-op) and "prev" skip one, every
    // Saturday and Sunday.
    const base = weekParam || currentWeekMonday(todayIso())
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
    // ONE verb in every view: "take me to that day". Table scrolls; Board/Month
    // switch to Table and scroll — a primary control must never no-op.
    if (view !== 'table') setView('table')
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
    if (view !== 'table') setView('table')
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
    if (!data || view !== 'table') return
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

  // ── onSelect: routes through the URL when routed (§4.4) — the modal state
  //    itself is set by the deep-link resolution effect above, so there is
  //    ONE code path that opens it. Falls back to local state off the two
  //    routed surfaces (dead in production here — Calendar.jsx only ever
  //    mounts at /calendar — kept so a future non-routed reuse still works).
  const onSelect = (entry, timing) => {
    if (route.routed) {
      // C3: record the INTENT here; the resolution effect bumps openSeq
      // itself, in the same call as the fresh data — see openMarkerRef's
      // doc comment (bumping it right here would remount the boundary with
      // this render's STALE `selected`, since `selected` doesn't update
      // until that effect runs).
      // Normalized the same way `route.sym` is (normalizeSym uppercases) —
      // a case mismatch here would silently defeat the isFreshOpen check.
      openMarkerRef.current = normalizeSym(entry.sym)
      route.open(entry.sym)
      return
    }
    setOpenSeq((s) => s + 1)
    setSelected({ row: toModalRow(entry), label: timingLabel(timing),
                  reportDate: entry._ds, timing })
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
        {view === 'wire' && <WireView />}

        {view === 'table' && (
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
              enrichReady={!!enrichmentByDate}
              onClearQuick={onClearQuick}
            />
          </>
        )}
        {view === 'board' && (
          <WeekView
            weekDates={weekDates}
            days={days}
            filters={effFilters}
            eventTypes={eventTypes}
            onSelect={onSelect}
            weekTiers={weekTiers}
            onOpenDay={(ds) => setOpenDay({ ds, day: days[ds] })}
            onClearQuick={onClearQuick}
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
          // GATE a (Task 12): prefer the ENRICHED week data. `openDay.day`
          // comes from MonthView, which is fed by /api/calendar/month — a
          // payload `mergeEnrichment` never touches, so its entries carry no
          // beat_history/hist_stats. With `openDay.day` winning, clicking a
          // ticker in the day drawer handed the modal an un-enriched entry and
          // the Earnings History section rendered its EmptyState even for names
          // that had just reported. `days` is week-scoped, so a date outside the
          // loaded week still falls back to the month payload and degrades
          // honestly (EmptyState) rather than showing a wrong chart.
          day={days[openDay.ds] || openDay.day}
          onClose={() => setOpenDay(null)}
          onSelect={onSelect}
        />
      )}

      {selected && (
        <ErrorBoundary
          key={openSeq}
          fallback={
            <div style={{ color: 'var(--text-muted)', fontSize: '11px', padding: '12px' }}>
              Unable to load — click a ticker to retry.
            </div>
          }
        >
          {/* Key is `openSeq`, NOT `selected.row.sym` (§4.4 / T11 review C3):
              a sym-key remounts the shell on every arrow-step, throwing away
              the section scroll map and the settle debounce. `openSeq` only
              changes on a genuine fresh open (onSelect) — stable across
              stepping, but still gives the ErrorBoundary a fresh mount (and
              therefore a way OUT of a tripped fallback) the next time the
              user opens anything, since the boundary itself has no reset. */}
          <EarningsResearchModal
            row={selected.row}
            label={selected.label}
            reportDate={selected.reportDate}
            timing={selected.timing}
            section={route.section}
            onSectionChange={route.setSection}
            onClose={dismissModal}
            onStepPrev={stepIdx > 0 ? () => stepTo(-1) : null}
            onStepNext={stepIdx >= 0 && stepIdx < daySyms.length - 1 ? () => stepTo(1) : null}
            stepping={stepping}
            onPollActuals={mutate}
            isTodayReporter={isTodayReporter}
            enrichReady={!!enrichmentByDate}
          />
        </ErrorBoundary>
      )}
    </div>
  )
}
