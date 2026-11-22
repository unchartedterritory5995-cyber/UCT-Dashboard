// ── Long history for the count chart (6M / 1Y) ───────────────────────────────
// ~400 sessions covers a full year back from any day in the page's 90-day
// window. Rows carry scalars only (the server strips the stock lists). Loaded
// once per page; a failure is simply "no longer history" and may be retried.
const LONG_HISTORY_DAYS = 400
export const longHistoryCache = { rows: null, promise: null }
/** TERM-033: what a FAILED long-history read resolves to (a refused answer or a network failure,
 *  logged with its cause). "No longer history", never an empty year: nothing is cached, the drill
 *  keeps the page's own window (the caller sets rows only on an answer), and the next range pick
 *  asks again. */
export const LONG_HISTORY_FAILED = null
export function loadLongHistory() {
  if (longHistoryCache.rows) return Promise.resolve(longHistoryCache.rows)
  if (!longHistoryCache.promise) {
    longHistoryCache.promise = fetch(`/api/breadth-monitor?days=${LONG_HISTORY_DAYS}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => {
        const got = Array.isArray(d?.rows) ? d.rows : null
        longHistoryCache.rows = got
        return got
      })
      .catch((e) => {
        console.warn('[breadth drill] the 6M / 1Y count history did not load; the page window stands', e)
        return LONG_HISTORY_FAILED
      })
      .finally(() => { longHistoryCache.promise = null })
  }
  return longHistoryCache.promise
}
/** The page's rows plus any older settled sessions from the long history,
 *  newest first, the live row (if any) kept on top. */
export function mergeHistory(rows, longRows) {
  if (!Array.isArray(longRows) || !longRows.length) return rows
  const base = Array.isArray(rows) ? rows : []
  const have = new Set(base.filter(r => !r?._live).map(r => r?.date))
  const extra = longRows.filter(r => r && !r._live && r.date && !have.has(r.date))
  if (!extra.length) return rows
  const settled = [...base.filter(r => !r?._live), ...extra].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  return [...base.filter(r => r?._live), ...settled]
}
