// News (Trade Exchange) — one widget's view of ONE America/New_York calendar day.
//
// Each News widget browses on its own (state here, per mounted widget); the day is
// filtered by the SERVER over the whole day and served in cursor steps (fetchDay ->
// archive.py), newest first by (received_at_ms, seq). The reader scrolls; this hook
// fetches the next step as the end comes near -- never a whole day up front.
//
//   Today       the live edge: the live pool's headlines of today are merged in as
//               they arrive (mergeDay), unless a time jump left newer rows unloaded.
//   past date   the retained day as it is; the live connection stays open, but
//               today's headlines never enter it and the date never changes by itself.
//   Jump to time   starts at the newest match received at or before HH:MM ET; the
//               rows above it load as the reader scrolls up.
//
// A filter change returns to the top of the SAME date; a new epoch (database
// recreated) reloads it. Keyset steps mean arrivals can never duplicate or skip a row.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDay, fetchDays } from '../../../lib/tradeExchangeNewsStreamManager'
import { addDays, DAY_LIMIT, etDateKey, mergeDay } from './tradeExchangeNewsModel'

const DAYS_REFRESH_MS = 5 * 60_000
const EMPTY = Object.freeze({ rows: [], total: null, dayTotal: null, hidden: null, top: 0, hasOlder: false,
  hasNewer: false, olderCursor: null, newerCursor: null, atMatch: null, key: null })

/**
 * @param feed     the shared pool's state (useSyncExternalStore(NEED...))
 * @param matches  the pool's rows passing this widget's filters, seq-newest first
 * @param request  dayRequest(...) for the same filters (memoised by the caller)
 * @param enabled  false while the feed is unavailable (no requests)
 */
export default function useTradeExchangeNewsDay({ feed, matches, request, enabled = true }) {
  const reqKey = useMemo(() => JSON.stringify(request), [request])
  const [sel, setSel] = useState({ date: null, at: null })         // date null = Today (follows midnight)
  const [meta, setMeta] = useState(null)                           // GET /days
  const [view, setView] = useState(EMPTY)
  const [busy, setBusy] = useState(null)                           // 'init' | 'older' | 'newer' | null
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)
  const [clock, setClock] = useState(() => Date.now())
  const epoch = feed.epoch

  // ── which date: Today follows the ET calendar (the server's word when known) ──
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const localToday = etDateKey(clock)
  const todayKey = meta?.today && meta.today > localToday ? meta.today : localToday
  const dateKey = sel.date || todayKey
  const isToday = dateKey === todayKey

  // ── availability (the calendar): only what the server says it retains ──
  useEffect(() => {
    if (!enabled) return undefined
    let dead = false
    const load = () => fetchDays().then((m) => { if (!dead) setMeta(m) }).catch(() => {})
    load()
    const t = setInterval(load, DAYS_REFRESH_MS)
    return () => { dead = true; clearInterval(t) }
  }, [enabled, epoch, todayKey])

  // A filter change returns to the top of the selected date (the date stays).
  const firstReq = useRef(true)
  useEffect(() => {
    if (firstReq.current) { firstReq.current = false; return }
    setSel((s) => (s.at ? { ...s, at: null } : s))
  }, [reqKey])

  // ── the first slice of the selected date (or of its time jump) ──
  const key = `${reqKey}|${dateKey}|${sel.at || ''}|${epoch ?? ''}|${nonce}`
  const keyRef = useRef(key)
  keyRef.current = key
  useEffect(() => {
    if (!enabled) return undefined
    let dead = false
    setBusy('init')
    setError(null)
    fetchDay({ ...request, date: dateKey, at: sel.at || undefined, limit: DAY_LIMIT })
      .then((r) => {
        if (dead) return
        setView({ rows: r.items || [], total: r.total, dayTotal: r.day_total, hidden: r.hidden_placeholders,
          top: r.top || 0, hasOlder: !!r.has_older, hasNewer: !!r.has_newer, olderCursor: r.older_cursor,
          newerCursor: r.newer_cursor, atMatch: r.at_match || null, key })
      })
      .catch((e) => { if (!dead) setError(e) })
      .finally(() => { if (!dead) setBusy(null) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  // ── further steps, as the reader nears an end (one at a time) ──
  const step = useCallback((direction) => {
    const v = view
    if (busy || v.key !== keyRef.current) return
    const cursor = direction === 'older' ? v.olderCursor : v.newerCursor
    if (!cursor || !(direction === 'older' ? v.hasOlder : v.hasNewer)) return
    const k = v.key
    setBusy(direction)
    fetchDay({ ...request, date: dateKey, cursor, direction, limit: DAY_LIMIT })
      .then((r) => {
        if (keyRef.current !== k) return
        setView((cur) => {
          if (cur.key !== k) return cur
          const have = new Set(cur.rows.map((it) => it.seq))
          const fresh = (r.items || []).filter((it) => !have.has(it.seq))
          return direction === 'older'
            ? { ...cur, rows: [...cur.rows, ...fresh], hasOlder: !!r.has_older, olderCursor: r.older_cursor || cur.olderCursor,
              total: r.total, dayTotal: r.day_total, top: Math.max(cur.top, r.top || 0) }
            : { ...cur, rows: [...fresh, ...cur.rows], hasNewer: !!r.has_newer, newerCursor: r.newer_cursor || cur.newerCursor,
              total: r.total, dayTotal: r.day_total, top: Math.max(cur.top, r.top || 0) }
        })
      })
      .catch((e) => { if (keyRef.current === k) setError(e) })
      .finally(() => setBusy(null))
  }, [view, busy, request, dateKey])
  const loadOlder = useCallback(() => step('older'), [step])
  const loadNewer = useCallback(() => step('newer'), [step])

  // ── what is shown: the server's rows plus the live pool's rows of this date ──
  // Only this view's own answer is shown: a previous date, time or filter's rows are
  // never kept on screen while the next loads (a long-scrolled day would re-render
  // in full for nothing).
  const current = view.key === key ? view : null
  const shownView = current
  const rows = useMemo(() => mergeDay(shownView?.rows || [], matches,
    { dateKey, hasNewer: !!shownView?.hasNewer, hasOlder: !!shownView?.hasOlder }),
  [shownView, matches, dateKey])
  // Counts: the day's matches the server counted, plus what arrived live since.
  let arrived = 0
  let arrivedAll = 0
  let arrivedHidden = 0
  if (shownView) {
    for (const it of feed.items || []) {
      if (it.seq > shownView.top && etDateKey(it.received_at_ms) === dateKey) {
        arrivedAll++
        if (request.hide_placeholders && it.placeholder === 'graphic') arrivedHidden++
      }
    }
    for (const it of matches || []) {
      if (it.seq <= shownView.top) break
      if (etDateKey(it.received_at_ms) === dateKey) arrived++
    }
  }

  const select = useCallback((date) => {
    const d = !date || date >= todayKey ? null : date
    setSel({ date: d, at: null })
  }, [todayKey])
  const prevDay = useCallback(() => select(addDays(dateKey, -1)), [select, dateKey])
  const nextDay = useCallback(() => select(addDays(dateKey, 1)), [select, dateKey])
  const jumpTo = useCallback((at) => setSel((s) => ({ ...s, at: at || null })), [])
  const toLatest = useCallback(() => setSel({ date: null, at: null }), [])
  const retry = useCallback(() => { setError(null); setNonce((n) => n + 1) }, [])

  return {
    dateKey, todayKey, isToday, at: sel.at, atMatch: shownView?.atMatch || null, meta,
    rows, total: shownView ? shownView.total + arrived : null,
    dayTotal: shownView ? shownView.dayTotal + arrivedAll : null,
    hidden: shownView ? shownView.hidden + arrivedHidden : null,
    hasOlder: !!shownView?.hasOlder, hasNewer: !!shownView?.hasNewer,
    loading: busy === 'init' || (enabled && !current && !error), loadingMore: busy === 'older' || busy === 'newer',
    error, retry, loadOlder, loadNewer, select, prevDay, nextDay, jumpTo, toLatest,
    live: isToday && !sel.at && !shownView?.hasNewer,
  }
}
