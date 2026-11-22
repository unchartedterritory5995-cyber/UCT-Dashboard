import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import useMobileSWR from '../../hooks/useMobileSWR'

import jsonFetcher from '../../utils/jsonFetcher'
import { DEFAULT_UNIVERSE, monitorDatesLsKey, monitorRecentLsKey, universeParam, withMarketWide } from './monitorUniverses'

// Windowed data source for the Monitor's virtualized, infinitely-scrollable sheet.
//
// The whole point: the virtual scroller renders over the FULL timeline index (a
// tiny dates-only list, ~5k strings), so a teleport to any year is an instant
// scroll-to-index — and only the rows actually on screen are fetched (in blocks),
// so scrolling stays light no matter how far back you go. Rows fill into a cache
// as their block lands; the date column is known for every row from the index, so
// even un-loaded rows show their date (metrics skeleton in until the block loads).

// ⛔⛔ `jsonFetcher`, NOT a bare `fetch().then(r => r.json())`. A 402 (or any
// non-ok) answers JSON too, and its `{detail}` body is TRUTHY — so an unchecked
// parse hands the refusal downstream as if it were data and every `!data` loading
// guard below is skipped. The shared fetcher THROWS on a non-ok answer, which
// leaves SWR's `data` undefined and lets those guards do their job.
// ⭐ It matters most HERE: `fetchBlock` writes whatever it gets into the row
// cache, so a refusal body would be cached as a block of rows and rendered as
// blank metrics that never resolve. Rail: `src/utils/jsonFetcher.test.js`.
const fetcher = jsonFetcher
const BLOCK = 150               // rows per fetch/window block
const SETTLE_MS = 90            // debounce so a fast fling doesn't fetch every block it flies past
// ⭐ THE WHOLE TIMELINE, ONCE, WHEN THE PAGE IS IDLE (2026-11-20). A jump to 2019 or 2012 (the date
// box, a year pick) landed on skeleton rows and waited ~1-2 s for its blocks (production: ~1.1 s
// of empty rows, then the values). History is immutable and the server keeps one cached body for
// the full window (~4,750 rows, ~850 KB on the wire, ~0.2 s warm), so the page asks for it once in
// idle time and every later jump paints from memory. Blocks still load on demand until it lands.
export const FULL_HISTORY_DAYS = 8000
const FULL_HISTORY_IDLE_TIMEOUT_MS = 4000

// ── Instant open (localStorage) ────────────────────────────────────────────────
// Breadth history is IMMUTABLE — a past day's row never changes — so the recent
// window and the timeline index are cached across page loads and rendered
// instantly on open, then revalidated in the background (stale-while-revalidate).
// The only thing that moves is a new day appearing at the top, which the
// background refetch + the separate live row both pick up within a second.
// ⭐ PER UNIVERSE (the Monitor's universe switcher): each universe has its own EXACT key pair
// (monitorUniverses.MONITOR_LS_KEYS). UCT keeps the historical names
// 'uct.breadth.dates.v1' (timeline index) and 'uct.breadth.recent.v1' (recent rows).
const RECENT_N = 160                       // ~7-8 months cached for an instant first paint

function readLS(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}
function writeLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* quota / private mode */ }
}

/** The SWR key of a universe's timeline index (UCT: the historical, param-free key). */
export const monitorDatesKey = (universe = DEFAULT_UNIVERSE) =>
  `/api/breadth-monitor/dates${universeParam(universe, '?')}`

// One universe's row cache + block bookkeeping. Kept per universe for the life of the page, so
// switching back to a universe already viewed paints from memory with no fetch.
function newUniverseState(universe) {
  const cache = new Map()
  const cached = readLS(monitorRecentLsKey(universe))
  if (Array.isArray(cached)) for (const r of cached) if (r?.date) cache.set(r.date, r)
  return { cache, loaded: new Set(), loading: new Set(), failed: new Set(), idxKey: null }
}

export default function useMonitorGrid({ enabled, liveRow, universe = DEFAULT_UNIVERSE }) {
  const isUct = universe === DEFAULT_UNIVERSE
  // Seed SWR from the cached index so `allDates` is populated on the FIRST paint
  // (no wait for the /dates round-trip), then revalidate + rewrite the cache.
  const datesFallbackRef = useRef({})
  if (!(universe in datesFallbackRef.current)) datesFallbackRef.current[universe] = readLS(monitorDatesLsKey(universe)) || undefined
  const { data: datesData, error: datesError, mutate: mutateDates } = useMobileSWR(
    enabled ? monitorDatesKey(universe) : null, fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      // Off UCT the index also carries today's provisional row and the provisional sessions,
      // which move through the day; UCT's live row has its own feed (`liveRow`).
      // `useMobileSWR` (pollingSites rail): the same tick on a desktop, half as often on a
      // touch client, none while the tab is hidden.
      refreshInterval: isUct ? 0 : 60_000,
      fallbackData: datesFallbackRef.current[universe],
      onSuccess: (d) => { if (d?.dates?.length) writeLS(monitorDatesLsKey(universe), d) },
    },
  )
  // UCT: the page's live row. Elsewhere: the universe's own provisional row, with UCT's live
  // market-wide readings laid over it (those are the same on every universe).
  const live = useMemo(
    () => (isUct ? liveRow : withMarketWide(datesData?.live_row ?? null, liveRow)),
    [isUct, liveRow, datesData],
  )
  const liveDate = live?.date ?? null

  // The full index the scroller renders over — newest-first, today's live row on top.
  const allDates = useMemo(() => {
    const d = datesData?.dates ?? []
    if (liveDate && (!d.length || liveDate > d[0])) return [liveDate, ...d]
    return d
  }, [datesData, liveDate])

  // date -> row, per universe. Pre-hydrated ONCE from the cached recent window so those rows
  // paint instantly on open (immutable history → always safe to trust the cache).
  const statesRef = useRef({})
  if (!statesRef.current[universe]) statesRef.current[universe] = newUniverseState(universe)
  const st = statesRef.current[universe]
  // ⭐ The refs below POINT AT THE CURRENT UNIVERSE'S state, so the rest of this hook reads as it
  // always did; a universe's rows can never land in another universe's cache.
  const cacheRef = useRef(null); cacheRef.current = st.cache          // date -> row
  const loadedRef = useRef(null); loadedRef.current = st.loaded      // block index -> loaded
  const loadingRef = useRef(null); loadingRef.current = st.loading   // block index -> in flight
  // block index -> its last read FAILED. Completeness audit 2026-10-07: a failed block (and a
  // failed /dates) was swallowed -- the rows stayed skeletons and the header said "Loading…"
  // forever. The failure is now reported up (blocksFailed / datesFailed) with a `retry`.
  const failedRef = useRef(null); failedRef.current = st.failed
  const [version, setVersion] = useState(0)

  // A new timeline (or live row) invalidates the block bookkeeping but not the row
  // cache (rows are keyed by date, so they stay valid).
  const idxKey = allDates.length ? `${allDates[0]}:${allDates.length}` : ''
  if (st.idxKey !== idxKey) {
    st.idxKey = idxKey
    st.loaded = new Set(); loadedRef.current = st.loaded
    st.loading = new Set(); loadingRef.current = st.loading
    st.failed = new Set(); failedRef.current = st.failed
  }

  const fetchBlock = useCallback(async (k) => {
    if (k < 0 || loadedRef.current.has(k) || loadingRef.current.has(k)) return
    const lo = k * BLOCK
    const dates = allDates.slice(lo, lo + BLOCK)
    const stored = dates.filter((d) => d !== liveDate)
    if (!stored.length) { loadedRef.current.add(k); return }
    // Captured, so a block that lands after a universe switch writes into ITS universe only.
    const s = st
    s.loading.add(k)
    try {
      const res = await fetcher(
        `/api/breadth-monitor?days=${stored.length}&end=${stored[0]}&anchor=le${universeParam(universe)}`)
      // ⛔ A body for another universe (it can only be a server bug) is never cached here.
      if (!isUct && res?.universe !== universe) throw new Error('universe mismatch')
      for (const row of res?.rows ?? []) s.cache.set(row.date, row)
      s.loaded.add(k)
      s.failed.delete(k)
      setVersion((v) => v + 1)
      // Persist the freshly-revalidated recent window for the next instant open.
      if (k === 0) {
        const recent = allDates.slice(0, RECENT_N)
          .map((d) => s.cache.get(d)).filter(Boolean)
        if (recent.length) writeLS(monitorRecentLsKey(universe), recent)
      }
    } catch {
      // Left unloaded, so the next range change asks again -- and REPORTED, so the sheet says
      // these rows failed rather than drawing skeletons that never resolve.
      s.failed.add(k)
      setVersion((v) => v + 1)
    } finally {
      s.loading.delete(k)
    }
  }, [allDates, liveDate, st, universe, isUct])

  // Debounced: load the visible blocks (+1 buffer each side) once the scroll settles.
  const settleRef = useRef(0)
  const lastRangeRef = useRef([0, 0])       // most recent visible [first, last] index
  const ensureRange = useCallback((firstIdx, lastIdx) => {
    if (!allDates.length) return
    lastRangeRef.current = [firstIdx, lastIdx]
    clearTimeout(settleRef.current)
    settleRef.current = setTimeout(() => {
      const b0 = Math.max(0, Math.floor(firstIdx / BLOCK) - 1)
      const b1 = Math.floor(lastIdx / BLOCK) + 1
      for (let k = b0; k <= b1; k++) fetchBlock(k)
    }, SETTLE_MS)
  }, [allDates.length, fetchBlock])

  // Manual refresh: drop the cached rows + block bookkeeping and re-fetch the
  // currently visible range now (the row cache is normally sticky because rows
  // are keyed by date and don't change — a manual refresh is the one time we
  // want a completed day re-pulled, e.g. after the collector writes today).
  const refresh = useCallback(() => {
    st.cache = new Map(); cacheRef.current = st.cache
    st.loaded = new Set(); loadedRef.current = st.loaded
    st.loading = new Set(); loadingRef.current = st.loading
    st.failed = new Set(); failedRef.current = st.failed
    setVersion((v) => v + 1)
    const [f, l] = lastRangeRef.current
    const b0 = Math.max(0, Math.floor(f / BLOCK) - 1)
    const b1 = Math.floor(l / BLOCK) + 1
    for (let k = b0; k <= b1; k++) fetchBlock(k)
  }, [fetchBlock, st])

  useEffect(() => () => clearTimeout(settleRef.current), [])

  // The full timeline in idle time (see FULL_HISTORY_DAYS). Once per universe per page; a failure
  // leaves on-demand blocks as they were and lets a later render ask again.
  useEffect(() => {
    if (!enabled || !allDates.length || st.fullRequested) return undefined
    st.fullRequested = true
    const s = st
    const idle = typeof window !== 'undefined' && window.requestIdleCallback
      ? (fn) => window.requestIdleCallback(fn, { timeout: FULL_HISTORY_IDLE_TIMEOUT_MS })
      : (fn) => setTimeout(fn, 1500)
    const cancelIdle = typeof window !== 'undefined' && window.cancelIdleCallback ? window.cancelIdleCallback : clearTimeout
    let fired = false
    const id = idle(async () => {
      fired = true
      try {
        const res = await fetcher(`/api/breadth-monitor?days=${FULL_HISTORY_DAYS}${universeParam(universe)}`)
        if (!isUct && res?.universe !== universe) throw new Error('universe mismatch')
        // Fill only what is not held: a block read (or the live row) is never replaced by the bulk copy.
        let added = 0
        for (const row of res?.rows ?? []) {
          if (row?.date && !s.cache.has(row.date)) { s.cache.set(row.date, row); added += 1 }
        }
        // Every block now wholly held needs no request of its own.
        const dates = allDates
        for (let k = 0; k * BLOCK < dates.length; k++) {
          const ds = dates.slice(k * BLOCK, (k + 1) * BLOCK).filter((d) => d !== liveDate)
          if (ds.length && ds.every((d) => s.cache.has(d))) { s.loaded.add(k); s.failed.delete(k) }
        }
        if (added) setVersion((v) => v + 1)
      } catch {
        s.fullRequested = false
      }
    })
    // Not started yet (a re-render with a new index, an unmount): withdraw it, and let the next run
    // schedule it again. Once started it completes and fills the cache (keyed by date, always valid).
    return () => {
      if (!fired) { cancelIdle(id); s.fullRequested = false }
    }
  }, [enabled, allDates, liveDate, st, universe, isUct])

  // Retry: re-ask the timeline index, and every block whose read failed.
  const retry = useCallback(() => {
    mutateDates()
    const failed = [...st.failed]
    st.failed = new Set(); failedRef.current = st.failed
    setVersion((v) => v + 1)
    for (const k of failed) fetchBlock(k)
  }, [mutateDates, fetchBlock, st])

  const getRow = useCallback((i) => {
    const d = allDates[i]
    if (!d) return null
    if (d === liveDate) return live
    return st.cache.get(d) ?? null
    // `version` isn't read but is a dep so the identity changes as the cache fills,
    // which re-runs the render's getRow calls after a block lands.
  }, [allDates, liveDate, live, version, st])   // eslint-disable-line react-hooks/exhaustive-deps

  // The 10-day trail ending at row `index` (oldest-first) for a sparkline, pulled
  // from whatever is cached — completes as neighbouring blocks load.
  const trail = useCallback((index, key, n = 10) => {
    const out = []
    for (let j = Math.min(index + n - 1, allDates.length - 1); j >= index; j--) {
      const r = getRow(j)
      out.push(r ? (r[key] ?? null) : null)
    }
    return out
  }, [allDates.length, getRow])

  // Nearest loaded index for a target date (exact, else the first session on/before).
  const indexOfDate = useCallback((iso) => {
    if (!allDates.length) return -1
    let i = allDates.indexOf(iso)
    if (i >= 0) return i
    i = allDates.findIndex((d) => d <= iso)   // newest-first → first ≤ target
    return i < 0 ? allDates.length - 1 : i
  }, [allDates])

  // The first session on/after Jan 1 of a year = the "start of that year" (the
  // highest index whose date is still ≥ Jan 1, since the list is newest-first).
  const indexOfYearStart = useCallback((y) => {
    const jan1 = `${y}-01-01`
    for (let i = allDates.length - 1; i >= 0; i--) {
      if (allDates[i] >= jan1) return i
    }
    return 0
  }, [allDates])

  return {
    allDates, getRow, trail, ensureRange, refresh, indexOfDate, indexOfYearStart,
    min: datesData?.min ?? null, max: datesData?.max ?? null,
    ready: !!datesData, count: allDates.length,
    // a failed /dates read (with a saved index on screen, `count` stays > 0 and the sheet still
    // draws the saved dates; without one there is nothing to draw)
    datesFailed: Boolean(datesError),
    blocksFailed: st.failed.size,
    retry,
    universe,
  }
}
