// app/src/components/chart/engine/indexHistoryNotice.js
//
// ─── ⭐⭐ "OLDER INTRADAY S&P 500 HISTORY COMES FROM OUR DATA VENDOR" (coordinator ruling 2026-11-23) ─────────────────
//
// Our server serves SPX / NDX intraday bars from Yahoo's own window and, before it, from our data vendor's settled
// history (FMP; `api/index_bars.py`, the route's `deep` record: `joined`, `from`, `through`). On a session's LAST bar,
// FMP's closing value and TradingView's can differ slightly (the 2026-11-23 grade: TradingView equals neither FMP's last
// 5-minute close nor the 15:59 one-minute close on about half the older sessions). That bar is the same computation on
// another vendor's real closing value, so it is DRAWN, never cut out of the line; the member is told, once, in words.
//
// ⛔ SHOWN EXACTLY WHEN THE PROVENANCE SAYS SO: an instance reads an index series whose entry carries a JOINED vendor
// prefix (`indexDeep.joined`), AND the chart's own oldest loaded bar is on or before the prefix's last session
// (`indexDeep.through`), so the prefix is actually read on this chart. No `deep` record, a prefix not joined, or a chart
// that starts after the prefix: no sentence. The words are this file's one constant.
//
// Same small-store shape as `chartClockNotice.js`: scoped by binder (`scope`), keyed by instance, session state only.

export const INDEX_HISTORY_NOTE = "Older intraday S&P 500 history comes from our data vendor; on a session's last bar its closing value can differ slightly from TradingView's."
export const INDEX_HISTORY_CODE = 'index-history:vendor-prefix'

const _ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })

/** The ET session date of a bar time (unix seconds or ms; an ISO date string is returned as its date). */
export function etSessionOf(t) {
  if (typeof t === 'string') return t.slice(0, 10)
  if (typeof t !== 'number' || !Number.isFinite(t)) return null
  return _ET_DAY.format(new Date(t > 1e11 ? t : t * 1000))
}

/** Does this chart read the vendor prefix of `entry`? `oldestBarTime` = the chart's own oldest loaded bar. Intraday only:
 *  a daily chart's index rows are the vendor's primary series, never a prefix (an ISO-dated chart answers false). */
export function readsVendorPrefix(entry, oldestBarTime) {
  const d = entry && entry.indexDeep
  if (!d || d.joined !== true || typeof d.through !== 'string') return false
  if (typeof oldestBarTime !== 'number') return false
  const day = etSessionOf(oldestBarTime)
  return !!day && day <= d.through
}

/** scope -> instanceId -> true */
const _notes = new Map()
const _listeners = new Set()
const _emit = () => { for (const fn of [..._listeners]) { try { fn() } catch { /* not the store's problem */ } } }

/** Record whether one instance, in one binder's scope, reads a vendor prefix. Emits only on a change. */
export function setIndexHistoryNote(instanceId, on, scope = '') {
  if (!instanceId) return
  const s = scope || ''
  const own = _notes.get(s)
  const had = !!(own && own.get(instanceId))
  if (!!on === had) return
  if (on) {
    if (own) own.set(instanceId, true)
    else _notes.set(s, new Map([[instanceId, true]]))
  } else {
    own.delete(instanceId)
    if (!own.size) _notes.delete(s)
  }
  _emit()
}

/** The note (`[{code, reason}]`, at most one) for the given instances in one binder's scope. */
export function indexHistoryNotesFor(instanceIds, scope = '') {
  const own = _notes.get(scope || '')
  if (!own) return []
  return (instanceIds || []).some((id) => own.get(id)) ? [{ code: INDEX_HISTORY_CODE, reason: INDEX_HISTORY_NOTE }] : []
}

export function onIndexHistoryChange(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

/** Test seam. */
export function _resetIndexHistoryNotes() { _notes.clear() }
