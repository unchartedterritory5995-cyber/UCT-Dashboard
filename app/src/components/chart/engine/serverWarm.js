// app/src/components/chart/engine/serverWarm.js
//
// ─── SERVER-LANE COLUMNS, ASKED FOR BEFORE THE MEMBER ARRIVES ────────────────
//
// ⚰️ MEASURED ON PRODUCTION 2026-11-12 (a member arrowing down a watchlist, a
// warmed browser, the RS suite on the chart). The next symbol's candles and
// every indicator computed in the browser were drawn in the SAME frame, ~40 ms
// after the key press, because the bars prefetch had put that symbol's bars in
// memory before the member reached it. The five server-computed definitions
// were blank for 1.2 to 2.0 s on every first visit: nothing had asked for their
// columns until the chart was already on the symbol. Candles had a prefetch;
// the server lane did not.
//
// So the lane gets the same treatment, and it does not get its own idea of
// "which symbols are next": `utils/prefetchBars.js` already knows (the rows
// ahead of the selection, the list that just opened, the row under the pointer,
// the ticker being typed) and tells every registered warmer. This module is the
// one registered for the server lane. For each of those symbols it replays the
// asks charts are drawing right now (`serverCompute.liveAsks`: definition and
// inputs, per timeframe) as ONE batch request per symbol
// (`serverCompute.fetchColumnsBatch`), which lands the columns in the same
// cache a paint reads. When the member arrives, the binder's synchronous
// compute finds them and the pane draws with the candles.
//
// ⛔ IT HOLDS NO DATA AND MAKES NO DECISION ABOUT WHAT IS DRAWN. No cache, no
// parse, no definition is named here: `serverCompute.js` owns the cache and the
// request, the paints own which asks exist. This file owns ORDER and RESTRAINT:
//
//   · NEAR FIRST. A small priority call is "the rows the member is about to
//     reach" (a watchlist's scan neighbours, an intent hover, a typed ticker):
//     it goes to the front, in the caller's order (nearest first), and may use
//     one more request slot than background work. A newer near call demotes the
//     previous one's leftovers: rows the member already walked past.
//   · A LIST IS WARMED FROM THE TOP, A FEW ROWS AT A TIME. A large call is a
//     whole list opening. Its `visible` rows are queued; of the rest, the first
//     `BULK_HEAD` are queued and the remainder (up to `BACKLOG_MAX`) is only
//     REMEMBERED, in list order. Whenever the queue runs dry the next
//     `BULK_HEAD` remembered rows are taken, so a member who keeps scanning one
//     list finds it warm all the way down, while a list that was opened and left
//     costs a few rows: the next list replaces the remembered one, and a hidden
//     app forgets it. A 2,000-row list never queues 2,000 server computes.
//   · NEVER IN FRONT OF A CHART. Background jobs wait for the page's first
//     chart paint and for a first visit's pack ingest, start from an idle
//     callback, and run at most `ACTIVE_MAX` at a time (each is one server
//     worker thread for its duration). A chart's own ask is never queued here.
//   · NOT FOR NOBODY. A hidden app drops the queue; the rows are asked for
//     again when the member comes back and moves.
//   · A STRUGGLING SERVER IS LEFT ALONE. A failed request pauses every warm for
//     `BACKOFF_MS`; a server without the batch route is never sent five single
//     asks per symbol in its place (`fetchColumnsBatch` refuses for a warm).
//
// Kill switch, per browser, no deploy: localStorage['uct.indwarm.off'] = '1'.
import { liveAsks, hasColumns, fetchColumnsBatch, batchAvailable } from './serverCompute'
import { isAppVisible } from '../../../lib/deskVisibility'
import { afterFirstChartPaint } from '../../../lib/barsPackClient'
import { registerSymbolWarmer, _packStillIngesting } from '../../../utils/prefetchBars'

/** Requests in flight for background rows at once (each holds one server worker thread). */
export const ACTIVE_MAX = 2
/** …and with a near row waiting, one more. */
export const ACTIVE_MAX_NEAR = 3
/** The longest the queue may grow; the farthest background rows are dropped past it. */
export const QUEUE_MAX = 96
/** A priority call of at most this many symbols is "the rows the member is about to reach". */
export const NEAR_MAX = 12
/** How many rows of a large, unmarked call (a whole list) are queued at a time. */
export const BULK_HEAD = 16
/** How many further rows of that list are remembered, to be taken `BULK_HEAD` at a time as the queue runs dry. */
export const BACKLOG_MAX = 300
/** After a failed request, how long every warm rests. */
export const BACKOFF_MS = 15_000

const _queue = []          // { sym, tf, near }
let _backlog = null        // { tf, syms } the rest of the list that opened last, in list order
let _active = 0
let _backoffUntil = 0
let _kick = null           // the pending deferred pump, if any
let _painted = false       // the page's first chart has painted
let _armed = false

export function warmDisabled() {
  try { return localStorage.getItem('uct.indwarm.off') === '1' } catch { return false }
}

function _symOf(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  // The chart's own spelling, untouched: the cache key is the symbol as the
  // chart sends it, and a warm under any other spelling would warm nothing.
  return s && s.length <= 24 && !/\s/.test(s) ? s : ''
}

function _missing(sym, tf) {
  return liveAsks(tf).filter((a) => !hasColumns(a.defId, sym, tf, a.inputs))
}

function _ingesting() {
  try { return _packStillIngesting() } catch { return false }
}

function _held(job) {
  if (job.near) return false
  return !_painted || _ingesting()
}

function _kickSoon(delayMs) {
  if (_kick !== null) return
  const go = () => { _kick = null; _pump() }
  if (delayMs === undefined && typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(go, { timeout: 1500 })
    _kick = { idle: id }
  } else {
    _kick = { timer: setTimeout(go, delayMs === undefined ? 400 : delayMs) }
  }
}

/** Queue the next `BULK_HEAD` remembered rows that still miss something. */
function _refill() {
  if (!_backlog) return
  const { tf, syms } = _backlog
  let took = 0
  while (syms.length && took < BULK_HEAD) {
    const sym = syms.shift()
    if (_queue.some((j) => j.sym === sym && j.tf === tf) || !_missing(sym, tf).length) continue
    _queue.push({ sym, tf, near: false })
    took += 1
  }
  if (!syms.length) _backlog = null
}

function _pump() {
  if (!isAppVisible()) { _queue.length = 0; _backlog = null; return }
  if (!_queue.length) _refill()
  if (!_queue.length) return
  const now = Date.now()
  if (now < _backoffUntil) { _kickSoon(_backoffUntil - now + 50); return }
  while (_queue.length) {
    const at = _queue.findIndex((j) => !_held(j))
    if (at < 0) { _kickSoon(3000); return }           // only held background rows are left
    const cap = _queue[at].near ? ACTIVE_MAX_NEAR : ACTIVE_MAX
    if (_active >= cap) return
    const job = _queue.splice(at, 1)[0]
    const asks = _missing(job.sym, job.tf)
    if (!asks.length) continue                         // landed meanwhile, or nobody draws it any more
    _active += 1
    fetchColumnsBatch(job.sym, job.tf, asks, { quiet: true })
      .then((landed) => { if (landed < 0) _backoffUntil = Date.now() + BACKOFF_MS })
      .catch(() => { _backoffUntil = Date.now() + BACKOFF_MS })
      .finally(() => { _active -= 1; _pump() })
  }
}

/**
 * Warm the server-lane columns of `syms` at `tf`: the bars prefetch calls this
 * for every set of symbols it warms (`registerSymbolWarmer`).
 *
 * @param {string[]} syms nearest first
 * @param {string} tf the timeframe the bars were warmed at
 * @param {{priority?: boolean, visible?: boolean}} [opts] as the bars prefetch was called
 * @returns {number} jobs queued by this call (0 when nothing draws a server
 *   definition at `tf`, which costs one map read)
 */
export function warmSymbols(syms, tf, opts = {}) {
  if (!Array.isArray(syms) || !syms.length) return 0
  const T = String(tf == null ? 'D' : tf)
  if (!liveAsks(T).length || !batchAvailable() || warmDisabled()) return 0
  const near = !!opts.priority && syms.length <= NEAR_MAX
  const bulk = !near && !opts.visible
  const take = bulk ? syms.slice(0, BULK_HEAD) : syms
  if (bulk) {
    // The newest list replaces the remembered one: the member has moved on from the last.
    const rest = []
    for (const raw of syms.slice(BULK_HEAD, BULK_HEAD + BACKLOG_MAX)) {
      const sym = _symOf(raw)
      if (sym && !rest.includes(sym)) rest.push(sym)
    }
    _backlog = rest.length ? { tf: T, syms: rest } : null
  }
  const fresh = []
  for (const raw of take) {
    const sym = _symOf(raw)
    if (!sym || fresh.some((j) => j.sym === sym)) continue
    if (!_missing(sym, T).length) continue
    const at = _queue.findIndex((j) => j.sym === sym && j.tf === T)
    if (at >= 0) {
      if (!near) continue                              // already waiting; keep its place
      _queue.splice(at, 1)                             // re-queued at the front below
    }
    fresh.push({ sym, tf: T, near })
  }
  if (!fresh.length) return 0
  if (near) {
    for (const j of _queue) j.near = false             // the previous near rows are behind the member now
    _queue.unshift(...fresh)
  } else {
    _queue.push(...fresh)
  }
  if (_queue.length > QUEUE_MAX) _queue.length = QUEUE_MAX
  if (near) _pump()
  else _kickSoon()
  return fresh.length
}

/**
 * Register the warmer with the bars prefetch. Idempotent; the chart calls it
 * once at module load, so a page that never mounts a chart never arms it.
 */
export function armServerWarm() {
  if (_armed) return
  _armed = true
  // ⛔ ARMING NEVER THROWS. It runs at the chart module's load; a host whose bars prefetch is a
  // stand-in without the registry (a suite's partial double) must still get its chart, with
  // nothing warmed ahead, rather than no chart.
  try {
    registerSymbolWarmer(warmSymbols)
    afterFirstChartPaint(() => { _painted = true; _pump() })
  } catch { /* a stand-in host: nothing is warmed ahead */ }
}

/** Diagnostic + test seam. */
export function serverWarmStats() {
  return { queued: _queue.length, near: _queue.filter((j) => j.near).length, active: _active, painted: _painted,
    remembered: _backlog ? _backlog.syms.length : 0, backoffMs: Math.max(0, _backoffUntil - Date.now()) }
}

/** Test seam: forget the queue and every hold, as a new page load would. */
export function __resetServerWarm({ painted = false } = {}) {
  _queue.length = 0
  _backlog = null
  _active = 0
  _backoffUntil = 0
  if (_kick !== null) {
    if (_kick.timer !== undefined) clearTimeout(_kick.timer)
    else if (typeof cancelIdleCallback === 'function') cancelIdleCallback(_kick.idle)
    _kick = null
  }
  _painted = painted
}
