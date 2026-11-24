// app/src/components/chart/engine/breadthSupply.js
//
// ─── ⭐⭐ T4 B2 — UCT'S BREADTH COUNTS FOR A `USI:` SPELLING, ASKED ONCE PER SPELLING ──────────────────────────────────
//
// A Pine script's `request.security("USI:ADVN.NY", …)` reads UCT's own breadth (`pineBreadth.js`). Its rows come from ONE
// door, `GET /api/pine/breadth/<spelling>` (B1, `api/routers/pine_breadth.py`), NEVER from `/api/bars`, the exchange
// lookup or the symbol resolver (coordinator 2026-11-22: "the USI spelling resolves through the breadth supply"), and this
// module is the chart's cache of that door's answers: one entry per long spelling (an alias reads its long spelling's),
// the same object until it changes, handed to the bind under the chart's secondary key `USI~<SPELLING>` (and its held
// key `USI~<SPELLING>@D` on a weekly or monthly chart, the same rows).
//
// What each answer becomes (the entry's `status`, read by `otherSymbols.js::resolveOtherSymbols`'s witness-row branch):
//   200 `ready` with rows   `available` (`bars`: `{t: <session date>, o, h, l, c, v: NaN}`, oldest first; `knownFrom`;
//                           `rev`: the copy's age stamp). ADD / ADDQ hold the close only: o / h / l are NaN (`na`), never
//                           the close repeated. No row carries a volume (`v` NaN): UCT's counts have none.
//   200 `refused`           `refused` (`said`: the door's own sentence, the Pine data catalog's licence words)
//   202 `pending`           `pending`: B1 is gathering the history; asked again after `Retry-After`, a bounded number of
//                           times, and the read waits (a load, not a refusal)
//   404 / 401 / 402 / 403   `dark`: the door is not open to this member (`PINE_BREADTH_SUPPLY_ENABLED` below `all`)
//   anything else           `error`: asked again after `ERROR_RETRY_MS`
//   a switch-abort          forgotten: the next ensure asks again

import { BREADTH_SPELLINGS, breadthBaseOf } from './pineBreadth.js'

/** How long a held answer is served before the next ensure asks again (B1's own copy refreshes every 6 hours). */
export const BREADTH_MAX_AGE_MS = 6 * 3600 * 1000
export const ERROR_RETRY_MS = 60000
export const PENDING_RETRIES = 24
const PENDING_RETRY_MS = 5000
const DARK = new Set([401, 402, 403, 404])

const _cache = new Map()        // SPELLING -> entry
const _inflight = new Map()     // SPELLING -> promise
const _pendingTries = new Map()
const _timers = new Map()
const _subscribers = new Set()

/** The one URL this module asks: always the LONG spelling (an alias reads its long one's rows). */
export function breadthUrl(ticker) {
  const base = breadthBaseOf(ticker)
  return base ? `/api/pine/breadth/${encodeURIComponent(`USI:${base}`)}` : null
}

export function subscribeBreadth(fn) {
  if (typeof fn !== 'function') return () => {}
  _subscribers.add(fn)
  return () => { _subscribers.delete(fn) }
}
function _notify(s) {
  for (const fn of [..._subscribers]) {
    try { fn(s) } catch { /* a bad subscriber must not break the lane */ }
  }
}

/** Test seam. */
export function clearBreadth() {
  for (const t of _timers.values()) clearTimeout(t)
  _cache.clear(); _inflight.clear(); _pendingTries.clear(); _timers.clear()
}

const _statusOf = (err) => {
  const s = err && (err.httpStatus ?? err.status)
  return Number.isInteger(s) ? s : null
}

function _defaultFetch(url) {
  return fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`)
      err.httpStatus = r.status
      throw err
    }
    return r.json()
  })
}

function _later(s, ms) {
  if (_timers.has(s)) clearTimeout(_timers.get(s))
  _timers.set(s, setTimeout(() => {
    _timers.delete(s)
    const held = _cache.get(s)
    if (held && (held.status === 'pending' || held.status === 'error')) held.ready = true
    _notify(s)
  }, ms))
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)

/** B1's rows (`{d, o, h, l, c}`) as the bind reads bars: keyed by session date, the close-only fields NaN. */
export function breadthBarsOf(rows, base) {
  const closeOnly = !!(BREADTH_SPELLINGS[base] && BREADTH_SPELLINGS[base].closeOnly)
  const out = []
  let last = ''
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = r && typeof r.d === 'string' ? r.d.slice(0, 10) : null
    const c = r ? num(r.c) : NaN
    if (!d || d <= last || !Number.isFinite(c)) continue
    last = d
    out.push(closeOnly ? { t: d, o: NaN, h: NaN, l: NaN, c, v: NaN }
      : { t: d, o: num(r.o), h: num(r.h), l: num(r.l), c, v: NaN })
  }
  return out
}

/** Ask the door now. */
export function fetchBreadth(ticker, fetcher) {
  const base = breadthBaseOf(ticker)
  const url = breadthUrl(ticker)
  if (!base || !url) return Promise.resolve(null)
  if (_inflight.has(base)) return _inflight.get(base)
  const get = typeof fetcher === 'function' ? fetcher : _defaultFetch
  const p = Promise.resolve()
    .then(() => get(url))
    .then((doc) => {
      if (!doc || typeof doc !== 'object') throw Object.assign(new Error('an empty answer'), { httpStatus: 0 })
      if (doc.state === 'pending') {
        const tries = (_pendingTries.get(base) || 0) + 1
        _pendingTries.set(base, tries)
        if (tries > PENDING_RETRIES) {
          _cache.set(base, { status: 'error', spelling: base, at: Date.now(), why: 'still gathering after every retry' })
          _later(base, ERROR_RETRY_MS)
        } else {
          _cache.set(base, { status: 'pending', spelling: base, at: Date.now() })
          _later(base, PENDING_RETRY_MS)
        }
        return _cache.get(base)
      }
      _pendingTries.delete(base)
      if (doc.state === 'refused') {
        const said = doc.refusal && typeof doc.refusal.sentence === 'string' ? doc.refusal.sentence
          : (typeof doc.refusal === 'string' ? doc.refusal : '')
        const entry = { status: 'refused', spelling: base, said }
        _cache.set(base, entry)
        return entry
      }
      const bars = breadthBarsOf(doc.rows, base)
      if (doc.state !== 'ready' || !bars.length) {
        const entry = { status: 'error', spelling: base, at: Date.now(), why: doc.source || doc.state || 'no rows' }
        _cache.set(base, entry)
        _later(base, ERROR_RETRY_MS)
        return entry
      }
      const entry = { status: 'available', spelling: base, bars, at: Date.now(), newestBarIsForming: false,
        knownFrom: typeof doc.knownFrom === 'string' ? doc.knownFrom.slice(0, 10) : bars[0].t,
        rev: `${bars.length}:${bars[bars.length - 1].t}:${bars[bars.length - 1].c}` }
      _cache.set(base, entry)
      return entry
    })
    .catch((err) => {
      if (err && err.canceled) { _cache.delete(base); return null }
      const status = _statusOf(err)
      if (DARK.has(status)) {
        const entry = { status: 'dark', spelling: base, httpStatus: status }
        _cache.set(base, entry)
        return entry
      }
      const entry = { status: 'error', spelling: base, at: Date.now(), httpStatus: status }
      _cache.set(base, entry)
      _later(base, ERROR_RETRY_MS)
      return entry
    })
    .finally(() => {
      _inflight.delete(base)
      _notify(base)
    })
  _inflight.set(base, p)
  return p
}

/** The chart's entry for a spelling's rows, asking the door when it must: a synchronous answer now (possibly
 *  `{status: 'loading'}`) and a request in flight for the next bind. The same object every call until it changes. */
export function ensureBreadth(ticker, fetcher) {
  const base = breadthBaseOf(ticker)
  if (!base) return null
  const held = _cache.get(base)
  if (held) {
    const stale = held.status === 'available' && Date.now() - held.at > BREADTH_MAX_AGE_MS
    const retry = (held.status === 'pending' || held.status === 'error') && held.ready === true
    if ((stale || retry) && !_inflight.has(base)) fetchBreadth(base, fetcher)
    return held
  }
  if (!_inflight.has(base)) fetchBreadth(base, fetcher)
  const loading = { status: 'loading', spelling: base }
  _cache.set(base, loading)
  return loading
}
