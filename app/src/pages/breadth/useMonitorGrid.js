import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import useSWR from 'swr'

// Windowed data source for the Monitor's virtualized, infinitely-scrollable sheet.
//
// The whole point: the virtual scroller renders over the FULL timeline index (a
// tiny dates-only list, ~5k strings), so a teleport to any year is an instant
// scroll-to-index — and only the rows actually on screen are fetched (in blocks),
// so scrolling stays light no matter how far back you go. Rows fill into a cache
// as their block lands; the date column is known for every row from the index, so
// even un-loaded rows show their date (metrics skeleton in until the block loads).

const fetcher = (url) => fetch(url).then((r) => r.json())
const BLOCK = 150               // rows per fetch/window block
const SETTLE_MS = 90            // debounce so a fast fling doesn't fetch every block it flies past

export default function useMonitorGrid({ enabled, liveRow }) {
  const { data: datesData } = useSWR(
    enabled ? '/api/breadth-monitor/dates' : null, fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )
  const liveDate = liveRow?.date ?? null

  // The full index the scroller renders over — newest-first, today's live row on top.
  const allDates = useMemo(() => {
    const d = datesData?.dates ?? []
    if (liveDate && (!d.length || liveDate > d[0])) return [liveDate, ...d]
    return d
  }, [datesData, liveDate])

  const cacheRef = useRef(new Map())      // date -> row
  const loadedRef = useRef(new Set())     // block index -> loaded
  const loadingRef = useRef(new Set())    // block index -> in flight
  const [version, setVersion] = useState(0)

  // A new timeline (or live row) invalidates the block bookkeeping but not the row
  // cache (rows are keyed by date, so they stay valid).
  const idxKey = allDates.length ? `${allDates[0]}:${allDates.length}` : ''
  const idxKeyRef = useRef(idxKey)
  if (idxKeyRef.current !== idxKey) {
    idxKeyRef.current = idxKey
    loadedRef.current = new Set()
    loadingRef.current = new Set()
  }

  const fetchBlock = useCallback(async (k) => {
    if (k < 0 || loadedRef.current.has(k) || loadingRef.current.has(k)) return
    const lo = k * BLOCK
    const dates = allDates.slice(lo, lo + BLOCK)
    const stored = dates.filter((d) => d !== liveDate)
    if (!stored.length) { loadedRef.current.add(k); return }
    loadingRef.current.add(k)
    try {
      const res = await fetcher(
        `/api/breadth-monitor?days=${stored.length}&end=${stored[0]}&anchor=le`)
      for (const row of res?.rows ?? []) cacheRef.current.set(row.date, row)
      loadedRef.current.add(k)
      setVersion((v) => v + 1)
    } catch {
      /* leave unloaded — it retries on the next range change */
    } finally {
      loadingRef.current.delete(k)
    }
  }, [allDates, liveDate])

  // Debounced: load the visible blocks (+1 buffer each side) once the scroll settles.
  const settleRef = useRef(0)
  const ensureRange = useCallback((firstIdx, lastIdx) => {
    if (!allDates.length) return
    clearTimeout(settleRef.current)
    settleRef.current = setTimeout(() => {
      const b0 = Math.max(0, Math.floor(firstIdx / BLOCK) - 1)
      const b1 = Math.floor(lastIdx / BLOCK) + 1
      for (let k = b0; k <= b1; k++) fetchBlock(k)
    }, SETTLE_MS)
  }, [allDates.length, fetchBlock])

  useEffect(() => () => clearTimeout(settleRef.current), [])

  const getRow = useCallback((i) => {
    const d = allDates[i]
    if (!d) return null
    if (d === liveDate) return liveRow
    return cacheRef.current.get(d) ?? null
    // `version` isn't read but is a dep so the identity changes as the cache fills,
    // which re-runs the render's getRow calls after a block lands.
  }, [allDates, liveDate, liveRow, version])   // eslint-disable-line react-hooks/exhaustive-deps

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
    allDates, getRow, trail, ensureRange, indexOfDate, indexOfYearStart,
    min: datesData?.min ?? null, max: datesData?.max ?? null,
    ready: !!datesData, count: allDates.length,
  }
}
