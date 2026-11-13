// app/src/lib/symbolResourceWarm.js
//
// ─── THE SMALL THINGS A CHART READS PER SYMBOL, ASKED FOR AHEAD ──────────────
//
// ⚰️ MEASURED ON PRODUCTION 2026-11-12 (a member arrowing down a watchlist, every
// DOM change inside the chart widget timed against the frame its candles landed):
// the title, the day change, the bar values and the legend were one frame behind
// the candles; the header's stats (rating, market cap, next earnings) settled
// 240 ms later at the median and 540 ms at worst, and the split-adjustment label
// 140 ms. Each is one small GET keyed by the symbol, started only once the chart
// was already on it.
//
// The bars prefetch already knows which symbols are next and tells registered
// warmers (`utils/prefetchBars.registerSymbolWarmer`). This is the warmer for
// those small reads. A surface that reads one SWR resource per symbol REGISTERS
// it here while it is mounted (`useSymbolResource`: its own key function and its
// own fetcher). For the rows a member is about to reach, each registered
// resource is asked for with that fetcher and the answer is written into SWR's
// cache under that key. When the member arrives, the surface's own `useSWR`
// finds the data on its first render.
//
// ⭐ IT ADDS NO REQUEST TO A SCAN. The ask goes out through SWR's own `preload`,
// so a surface that reaches the symbol while the ask is in flight JOINS it, and
// one that arrives within `FRESH_MS` of the answer takes that answer as its own
// fetch: one request per symbol and resource, as before, only earlier. After
// `FRESH_MS` the surface shows the cached answer at once and revalidates as it
// always did.
//
// ⛔ THE KEY IS THE SURFACE'S, NEVER RETYPED HERE. A warm under a key the hook
// does not ask for warms nothing and nobody notices. Each surface has ONE key
// function, uses it for its own `useSWR`, and registers that same function
// (closed over its own timeframe and settings: "what would I ask for if I were
// on this symbol?"). The timeframe the bars were warmed at is not used.
//
// ⛔ ONLY THE ROWS AHEAD, ONLY WHAT IS ON SCREEN SOMEWHERE, ONLY INSTRUMENTS. A
// whole list opening is ignored (bars need a list warmed; a header stat does not
// justify hundreds of requests). A resource no mounted surface holds is not
// warmed. An economic series, a breadth or theme id is left to the surface.
//
// Restraint: nothing before the page's first chart paint, at most `ACTIVE_MAX`
// requests in flight, nearest row first, a key that failed is left alone for
// `RETRY_MS`, an answer the surface already has (or is fetching) is never asked
// for, a hidden app drops the queue. Same per-browser kill switch as the
// indicator warm: localStorage['uct.indwarm.off'] = '1'.
import { useEffect } from 'react'
import { preload, mutate } from 'swr'
import { SWRGlobalState, cache as swrCache } from 'swr/_internal'
import { isAppVisible } from './deskVisibility'

/** A priority call of at most this many symbols is "the rows the member is about to reach". */
export const NEAR_MAX = 12
/** Requests in flight at once. */
export const ACTIVE_MAX = 3
/** The longest the queue may grow; the farthest rows are dropped past it. */
export const QUEUE_MAX = 48
/** How long a landed answer stays joinable as the surface's own fetch. */
export const FRESH_MS = 30_000
/** A key whose ask failed is not asked for again for this long. */
export const RETRY_MS = 60_000

// A plain instrument symbol (NVDA, BRK-B, BF.B). Anything else is not pre-asked.
const PLAIN = /^[A-Za-z][A-Za-z0-9.-]{0,11}$/

const _resources = new Set()   // { keyOf, fetcher }, one per mounted surface
const _failed = new Map()      // key -> when its ask failed
const _queue = []              // { key, fetcher }, nearest first
let _active = 0
let _painted = false           // the page's first chart has painted
let _armed = false
let _freshMs = FRESH_MS
let _retryMs = RETRY_MS

function _disabled() {
  try { return localStorage.getItem('uct.indwarm.off') === '1' } catch { return false }
}

// SWR's own bookkeeping for the default cache: [, , FETCH, PRELOAD].
function _swr() {
  try { return SWRGlobalState.get(swrCache) || [] } catch { return [] }
}

function _held(key) {
  const entry = swrCache.get(key)
  return !!entry && entry.data !== undefined
}

// The surface is fetching it (or did within its dedupe interval), or an ask is already out.
function _busy(key) {
  const st = _swr()
  return !!((st[2] && st[2][key]) || (st[3] && st[3][key]))
}

function _drop(key, raw) {
  const p = _swr()[3]
  if (p && p[key] === raw) delete p[key]
}

/**
 * A mounted surface says "I read this per-symbol resource". Returns the release.
 *
 * @param {(sym: string) => (string|null)} keyOf the surface's OWN SWR key for a symbol
 * @param {(key: string) => Promise<any>} fetcher the surface's own fetcher for that key
 */
export function registerSymbolResource(keyOf, fetcher) {
  if (typeof keyOf !== 'function' || typeof fetcher !== 'function') return () => {}
  const r = { keyOf, fetcher }
  _resources.add(r)
  return () => { _resources.delete(r) }
}

/** The hook form: registered while mounted and while `keyOf` is a function (pass null when off). */
export function useSymbolResource(keyOf, fetcher) {
  useEffect(() => registerSymbolResource(keyOf, fetcher), [keyOf, fetcher])
}

function _pump() {
  if (!_painted) return
  if (!isAppVisible()) { _queue.length = 0; return }
  while (_active < ACTIVE_MAX && _queue.length) {
    const { key, fetcher } = _queue.shift()
    if (_held(key) || _busy(key)) continue
    let raw
    try { raw = preload(key, fetcher) } catch { _failed.set(key, Date.now()); continue }
    _active += 1
    const settle = (ok, data) => {
      _active -= 1
      if (!ok || data === undefined) {
        _failed.set(key, Date.now())
        _drop(key, raw)
      } else {
        // Into the cache the surface reads, unless the surface joined this very request (its
        // own write follows) or its own answer landed first.
        const fetching = _swr()[2]
        const joined = !!(fetching && fetching[key] && fetching[key][0] === raw)
        if (!joined && !_held(key)) {
          try { mutate(key, data, { revalidate: false }) } catch { /* the surface asks for itself */ }
        }
        setTimeout(() => _drop(key, raw), _freshMs)
      }
      _pump()
    }
    Promise.resolve(raw).then((data) => settle(true, data), () => settle(false))
  }
}

/**
 * Warm every registered resource for `syms`: the bars prefetch calls this for the symbol
 * sets it warms (`registerSymbolWarmer`). Only a small priority call does anything.
 *
 * @param {string[]} syms nearest first
 * @param {string} _tf the timeframe the bars were warmed at (unused: each surface closes over its own)
 * @param {{priority?: boolean}} [opts]
 * @returns {number} asks queued by this call
 */
export function warmSymbolResources(syms, _tf, opts = {}) {
  if (!opts.priority || !Array.isArray(syms) || !syms.length || syms.length > NEAR_MAX) return 0
  if (_disabled()) return 0
  const now = Date.now()
  if (_failed.size > 256) for (const [k, at] of _failed) if (now - at >= _retryMs) _failed.delete(k)
  const fresh = []
  for (const sym of syms) {
    if (typeof sym !== 'string' || !PLAIN.test(sym)) continue
    for (const r of _resources) {
      let key = null
      try { key = r.keyOf(sym) } catch { key = null }
      if (typeof key !== 'string' || !key || fresh.some((j) => j.key === key)) continue
      const failedAt = _failed.get(key)
      if (failedAt !== undefined && now - failedAt < _retryMs) continue
      if (_held(key) || _busy(key)) continue
      const at = _queue.findIndex((j) => j.key === key)
      if (at >= 0) _queue.splice(at, 1)                  // already waiting: it moves to the front
      fresh.push({ key, fetcher: r.fetcher })
    }
  }
  if (!fresh.length) return 0
  _queue.unshift(...fresh)                               // the newest call is the nearest rows
  if (_queue.length > QUEUE_MAX) _queue.length = QUEUE_MAX
  _pump()
  return fresh.length
}

/**
 * Wire the warmer to the bars prefetch. The chart module calls it once at load, so a page
 * that never loads a chart never arms it, and this file imports neither the prefetch stack
 * nor the pack client (a hook on another route can register a resource for free).
 *
 * ⛔ ARMING NEVER THROWS. `deps` is a function so that reading the two bindings happens in
 * here: a host whose bars prefetch is a stand-in without them (a suite's partial double
 * throws on the missing export) still gets its chart, with nothing warmed ahead.
 *
 * @param {() => [Function, Function]} deps returns [registerSymbolWarmer, afterFirstChartPaint]
 */
export function armSymbolResourceWarm(deps) {
  if (_armed) return
  _armed = true
  try {
    const [register, afterPaint] = deps()
    afterPaint(() => { _painted = true; _pump() })
    register(warmSymbolResources)
  } catch { /* a stand-in host: nothing is warmed ahead */ }
}

/** Diagnostic + test seam. */
export function symbolResourceWarmStats() {
  return { resources: _resources.size, queued: _queue.length, active: _active, painted: _painted, failed: _failed.size }
}

/** Test seam: forget everything, as a new page load would (and, for a test, shorten the two windows). */
export function __resetSymbolResourceWarm({ painted = false, freshMs = FRESH_MS, retryMs = RETRY_MS } = {}) {
  _resources.clear()
  _failed.clear()
  _queue.length = 0
  _active = 0
  _painted = painted
  _armed = false
  _freshMs = freshMs
  _retryMs = retryMs
}
