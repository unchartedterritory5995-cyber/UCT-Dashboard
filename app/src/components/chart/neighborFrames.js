// app/src/components/chart/neighborFrames.js
//
// ─── ⭐⭐ NEIGHBOR FRAMES (2026-11-20): THE NEXT ROW IS PREPARED BEFORE THE KEY ───────────────────
//
// A member scans a watchlist with linked charts (Daily + 60m on one colour), arrowing down. The bars
// of the rows around the selection are already in memory (`barStore/prefetch.createNeighborHold`),
// yet every switch still paid, on the main thread between the key and the paint, work that scales
// with the WHOLE history (12,000 daily / 30,000 hourly bars): every indicator column over every bar
// (`registry.computeFor`), every column turned into chart points (`binder.toPoints`), every bar's
// chart time. Measured on production (two charts, PR #2142's build): a 144 ms flip held ~60 ms of
// binder sync, ~30 ms of it indicator compute.
//
// This module lets that work happen EARLIER, in idle time after a paint, for the rows a member is
// most likely to reach next (±1, then ±2), and lets the switch find it instead of redoing it:
//
//   • `publishScanNeighbors` — the list driving the charts names its next rows, nearest first;
//   • `scheduleIdle`         — ONE queue for every chart: small pieces in `requestIdleCallback`,
//                              at most IDLE_SLICE_MS of work per callback (never a long task), every
//                              piece abandoned the moment the member presses a key or the pointer;
//   • `chartTimesFor`        — one chart time per bar, per (bars, adjustTime), so the dozen series of
//                              one chart stop converting the same 30,000 times each.
//
// ⛔ WHAT IS PREPARED IS KEYED BY CONTENT IDENTITY, NEVER BY SYMBOL. A prepared answer is filed under
// the very bars array (and inputs, sources, envelope) it was computed from, so the switch either
// finds the answer to the exact question it is asking or computes as it always did. A row whose bars
// changed after it was prepared (a deeper load, a new answer) simply misses. The answer is the same
// numbers either way: the prepared path runs the same functions over the same inputs.
//
// ⭐ ON BY DEFAULT since 2026-11-20 (measured on production, two charts D+60 on the S&P 500, interleaved
// OFF/ON pairs: median 341->327 and 267->219 ms, p90 556->499 and 450->336). `localStorage['uct.neighborframes']
// = '0'` turns it off in that browser ('1' or absent: on). ⭐ The SERVER's kill switch (CHART_SPEED_ENABLED,
// lib/chartSpeed.js) turns it off in every browser, over a local '1'. Read once per page load. Off, nothing
// here is scheduled or kept, and every caller takes the path it always took.
//
// ⛔ ALMOST A LEAF: its one import is lib/chartSpeed.js, which imports nothing, so the binder, the bar
// store's adapter and StockChart can all still reach it.

import { chartSpeedKilled } from '../../lib/chartSpeed'
import { diagSetIdle, diagHit, diagMiss } from './__diagNeighborMiss'   // DIAGNOSTIC ONLY

export const NEIGHBOR_FRAMES_KEY = 'uct.neighborframes'

let _flag = null

/** Is the neighbor-frames path on for this page load? */
export function neighborFramesOn() {
  if (_flag !== null) return _flag
  if (chartSpeedKilled()) return (_flag = false)
  try { _flag = typeof localStorage === 'undefined' || localStorage.getItem(NEIGHBOR_FRAMES_KEY) !== '0' } catch { _flag = true }
  return _flag
}

/** Tests: force the switch (null re-reads storage). */
export function __setNeighborFramesForTests(v) { _flag = v === null || v === undefined ? null : !!v }

// ─── what happened, for the flip proof's `--peek` and for tests ─────────────────────────────────────
const _stats = {
  pieces: 0, workMs: 0, maxPieceMs: 0, slices: 0, cancelled: 0, inputAborts: 0,
  colsPrepared: 0, colsHit: 0, colsMissed: 0,
  pointsPrepared: 0, pointsHit: 0,
  derivedPrepared: 0, derivedHit: 0,
  timesBuilt: 0, timesHit: 0,
  barsPrepared: 0, barsSkipped: 0,
  // a binder pass over new bars (a switch, new bars of the same row): were they prepared?
  syncPrepared: 0, syncUnprepared: 0,
  // …and a SWITCH (the symbol changed): were its bars prepared? `switches` names the last few
  // (`SYM:tf:P|U:h<hits>:m<misses>:<ms>`), the newest last.
  switchPrepared: 0, switchUnprepared: 0, switches: [],
}
/** Counters (a live object; read it, never write it). */
export function neighborFramesStats() { return _stats }
/** Bump one counter by `n`. */
export function nfCount(name, n = 1) { if (name in _stats && typeof _stats[name] === 'number') _stats[name] += n }
/** Record one switch (kept: the newest SWITCH_LOG_MAX). */
export const SWITCH_LOG_MAX = 64
export function nfLogSwitch(entry) {
  _stats.switches.push(entry)
  if (_stats.switches.length > SWITCH_LOG_MAX) _stats.switches.splice(0, _stats.switches.length - SWITCH_LOG_MAX)
}
export function __resetNeighborFramesStatsForTests() {
  for (const k of Object.keys(_stats)) { if (Array.isArray(_stats[k])) _stats[k].length = 0; else _stats[k] = 0 }
}
function _expose() {
  try { if (typeof window !== 'undefined' && neighborFramesOn()) window.__uctNeighborFrames = _stats } catch { /* no window */ }
}

// ─── the scan's next rows ─────────────────────────────────────────────────────────────────────────────
// center (upper case) -> { order, at }. A few centres are kept: two lists on two colours each publish.
const SCAN_KEEP = 8
const _scan = new Map()
const _scanSubs = new Set()

/**
 * The list a member scans names the rows around its selection: `ahead` in the direction it is moving,
 * nearest first, and `behind`. Kept as ONE order, ±1 before ±2 (ahead first at each distance).
 */
export function publishScanNeighbors(center, ahead = [], behind = [], depth = 2) {
  if (!neighborFramesOn()) return
  const c = String(center || '').toUpperCase()
  if (!c) return
  const order = []
  const seen = new Set([c])
  for (let d = 0; d < depth; d++) {
    for (const s of [ahead[d], behind[d]]) {
      const u = String(s || '').toUpperCase()
      if (u && !seen.has(u)) { seen.add(u); order.push(u) }
    }
  }
  _scan.delete(c)
  _scan.set(c, { order, at: Date.now() })
  while (_scan.size > SCAN_KEEP) _scan.delete(_scan.keys().next().value)
  _expose()
  for (const cb of [..._scanSubs]) { try { cb(c) } catch { /* a subscriber */ } }
}

/** The rows a list published around `sym` (nearest first), or [] when no list is centred on it. */
export function scanNeighborsFor(sym) {
  const e = _scan.get(String(sym || '').toUpperCase())
  return e ? e.order.slice() : []
}

/** Called with the centre whenever a list publishes. Returns the unsubscribe. */
export function subscribeScanNeighbors(cb) {
  _scanSubs.add(cb)
  return () => { _scanSubs.delete(cb) }
}

export function __resetScanForTests() { _scan.clear(); _scanSubs.clear() }

// ─── a bounded set of source arrays ───────────────────────────────────────────────────────────────────
// ⛔ BOUNDED BY RECENCY, NOT BY THE SOURCE'S LIFE. A source array (a row's bars) lives as long as the bar
// store keeps it (up to 200 keys); what is derived from it is megabytes per 30,000-bar row. So only the
// most recently used SOURCES_KEPT sources keep their derived values (the rows around the selection on two
// charts, the row on screen and the one just left), and an older one's are dropped as a new one arrives.
export const SOURCES_KEPT = 10
// ⛔ (2026-11-20) THE RECENCY LIST HOLDS EACH SOURCE WEAKLY. It held them strongly, so the last
// SOURCES_KEPT source arrays stayed alive after the store had let them go: old revisions of a key and
// symbols long switched away from (a heap snapshot of a jsdom chart walking eight symbols: three of the
// first four symbols' legacy bars held by nothing but this list). A source the store dropped is now
// collected with its derived values; the bound on how many sources keep derived values is unchanged.
// Rail: StockChart.closureChains.test.jsx.
const _WeakRef = typeof globalThis !== 'undefined' ? globalThis.WeakRef : undefined
function _lru() {
  const store = new WeakMap()     // source -> value
  const tokens = new WeakMap()    // source -> its one recency token
  const order = new Set()         // tokens, oldest first; a token holds its source weakly (strongly where WeakRef is missing)
  const tokenOf = (src) => {
    let t = tokens.get(src)
    if (!t) { t = _WeakRef ? new _WeakRef(src) : { deref: () => src }; tokens.set(src, t) }
    return t
  }
  const touch = (src) => { const t = tokenOf(src); order.delete(t); order.add(t) }
  return {
    get(src) { const v = store.get(src); if (v) touch(src); return v },
    make(src, v) {
      store.set(src, v)
      touch(src)
      for (const t of order) if (!t.deref()) order.delete(t)   // sources already collected
      while (order.size > SOURCES_KEPT) {
        const old = order.values().next().value
        order.delete(old)
        const s = old.deref()
        if (s) store.delete(s)
      }
      return v
    },
    clear() { for (const t of order) { const s = t.deref(); if (s) store.delete(s) } order.clear() },
  }
}

// ─── one chart time per bar ───────────────────────────────────────────────────────────────────────────
const _times = _lru()   // bars -> Map(adjustTime -> times[])

/**
 * `bars.map(b => adjustTime(b.t))`, built once per (bars, adjustTime) and shared read-only by every
 * reader. `adjustTime` is a pure function of the bar time (StockChart's stable `useCallback` over
 * `barTime.toChartTime`), so the array is exactly what each reader computed for itself.
 */
export function chartTimesFor(bars, adjustTime) {
  if (!Array.isArray(bars) || typeof adjustTime !== 'function') return null
  const byFn = _times.get(bars) || _times.make(bars, new Map())
  const hit = byFn.get(adjustTime)
  if (hit) { _stats.timesHit += 1; return hit }
  const out = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) out[i] = adjustTime(bars[i].t)
  byFn.set(adjustTime, out)
  _stats.timesBuilt += 1
  return out
}

// ─── a derived array, filed under its source array ────────────────────────────────────────────────────
const _derived = _lru()   // source array -> Map(`${name}\u0001${sig}` -> value)
const DERIVED_PER_SOURCE = 16

/**
 * `fn()` filed under (`src` identity, `name`, `sig`): the same question asked again of the same array
 * returns the same answer object. ⛔ `sig` must name EVERY value `fn` reads besides `src`; a value it
 * does not name is one a later caller could change without missing (`stableSig`).
 */
export function deriveFrom(src, name, sig, fn) {
  if (!src || typeof src !== 'object') return fn()
  const m = _derived.get(src) || _derived.make(src, new Map())
  const k = `${name}\u0001${sig}`
  if (m.has(k)) { _stats.derivedHit += 1; diagHit(name, src); return m.get(k) }
  diagMiss(name, src, sig)   // DIAGNOSTIC ONLY
  const v = fn()
  m.set(k, v)
  while (m.size > DERIVED_PER_SOURCE) m.delete(m.keys().next().value)
  return v
}

/** Was `name`/`sig` already derived from `src`? (A preparer skips what is done.) */
export function hasDerived(src, name, sig) {
  const m = src && typeof src === 'object' ? _derived.get(src) : null
  return !!m && m.has(`${name}\u0001${sig}`)
}

/** Tests: forget every derived value and chart-time array. */
export function __resetDerivedForTests() { _derived.clear(); _times.clear() }

// ─── an object named by identity, inside a content signature ─────────────────────────────────────────
const _serials = new WeakMap()
let _serial = 0
/** A name for `obj`'s identity (the same object, the same name): for a value a signature must name that is
 *  itself a derived object (a Set filed by `deriveFrom`). null / undefined / a primitive name as themselves. */
export function identitySig(obj) {
  if (obj === null || obj === undefined) return String(obj)
  if (typeof obj !== 'object' && typeof obj !== 'function') return `v:${String(obj)}`
  let s = _serials.get(obj)
  if (!s) { s = ++_serial; _serials.set(obj, s) }
  return `#${s}`
}

/** A signature of plain values (string / number / boolean / null / undefined, arrays and plain objects
 *  of them). ⛔ Throws on a function or a class instance: such a value cannot be named by content. */
export function stableSig(v) {
  if (v === null) return 'n'
  const t = typeof v
  if (t === 'undefined') return 'u'
  if (t === 'string') return `s${v.length}:${v}`
  if (t === 'number') return `d${Object.is(v, -0) ? '-0' : String(v)}`
  if (t === 'boolean') return v ? 'T' : 'F'
  if (Array.isArray(v)) return `[${v.map(stableSig).join(',')}]`
  if (t === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return `{${Object.keys(v).sort().map((k) => `${k}=${stableSig(v[k])}`).join(',')}}`
  }
  throw new TypeError(`stableSig: ${t} cannot be named by content`)
}

// ─── the idle queue ───────────────────────────────────────────────────────────────────────────────────
/** The most work one idle callback does, whatever the browser offers: a frame's worth, never a long task. */
export const IDLE_SLICE_MS = 10
/** A piece is not started with less than this left in the slice. */
export const IDLE_MIN_LEFT_MS = 2

const _queue = []   // { owner, rank, gen, seq }
let _seq = 0
let _handle = null
let _inputBound = false

const _now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())
// ⛔ A REAL IDLE SIGNAL OR NOTHING. Without `requestIdleCallback` (Safari) nothing is prepared: a timer firing
// every 50 ms whether the page is idle or not, with a budget it made up, would compete with exactly the work
// this exists to keep off the main thread. That browser switches as it always did.
/** Can this browser tell us when it is idle? (Nothing is queued when it cannot.) */
export function idleSupported() { return typeof requestIdleCallback === 'function' }
const _ric = (cb) => requestIdleCallback(cb)
const _cic = (h) => { try { cancelIdleCallback(h) } catch { /* gone */ } }
/** Is a key / press already waiting for the main thread? (Chromium's `isInputPending`; false where absent.) */
function _inputPending() {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.scheduling : null
    return !!(s && typeof s.isInputPending === 'function' && s.isInputPending())
  } catch { return false }
}

function _bindInput() {
  if (_inputBound || typeof window === 'undefined' || !window.addEventListener) return
  _inputBound = true
  // ⛔ A KEY OR A PRESS ENDS EVERY QUEUED PIECE: it is about to ask the main thread for a switch, and
  // nothing prepared for the old neighbourhood is worth one millisecond of it. What was finished stays
  // filed (it is keyed by content); what was not is simply not there.
  const cancel = () => cancelIdle()
  for (const t of ['keydown', 'pointerdown', 'wheel']) window.addEventListener(t, cancel, { capture: true, passive: true })
}

function _pick() {
  let best = -1
  for (let i = 0; i < _queue.length; i++) {
    const q = _queue[i]
    if (best < 0 || q.rank < _queue[best].rank || (q.rank === _queue[best].rank && q.seq < _queue[best].seq)) best = i
  }
  return best
}

function _run(deadline) {
  _handle = null
  _stats.slices += 1
  const t0 = _now()
  const offered = deadline && typeof deadline.timeRemaining === 'function' ? deadline.timeRemaining() : IDLE_SLICE_MS
  const budget = Math.min(IDLE_SLICE_MS, offered)
  while (_queue.length) {
    const left = budget - (_now() - t0)
    if (left < IDLE_MIN_LEFT_MS) break
    // ⛔ AN INPUT ALREADY WAITING STARTS NO PIECE: the queue is dropped now (its listener would drop it anyway,
    // after this callback; the piece it would have run is the delay it would have added to the switch).
    if (_inputPending()) { _stats.inputAborts += 1; cancelIdle(); return }
    const i = _pick()
    const q = _queue[i]
    const p0 = _now()
    let done = false
    diagSetIdle(true)   // DIAGNOSTIC ONLY
    try { done = !!q.gen.next().done } catch { done = true } finally { diagSetIdle(false) }
    const ms = _now() - p0
    _stats.pieces += 1
    _stats.workMs += ms
    if (ms > _stats.maxPieceMs) _stats.maxPieceMs = ms
    if (done) {
      const at = _queue.indexOf(q)
      if (at >= 0) _queue.splice(at, 1)
    }
  }
  if (_queue.length) _handle = _ric(_run)
}

/**
 * Queue `gen` (a generator: each `yield` is a place it may be paused) for idle time. An owner may queue
 * several (one per row); a chart that paints again drops its old ones first (`cancelIdleFor`). Lower
 * `rank` runs first across every owner (+1 of both charts before +2 of either).
 */
export function scheduleIdle(owner, rank, gen) {
  if (!gen || typeof gen.next !== 'function') return
  if (!idleSupported()) { try { gen.return() } catch { /* never started */ } return }
  _bindInput()
  _expose()
  _queue.push({ owner, rank, gen, seq: ++_seq })
  if (_handle == null) _handle = _ric(_run)
}

/** Drop everything `owner` has queued. */
export function cancelIdleFor(owner) {
  for (let i = _queue.length - 1; i >= 0; i--) {
    if (_queue[i].owner === owner) {
      try { _queue[i].gen.return() } catch { /* finished */ }
      _queue.splice(i, 1)
    }
  }
}

/** Drop everything queued (user input). */
export function cancelIdle() {
  if (!_queue.length) return
  _stats.cancelled += _queue.length
  for (const q of _queue.splice(0)) { try { q.gen.return() } catch { /* finished */ } }
  if (_handle != null) { _cic(_handle); _handle = null }
}

/** Tests: how many tasks are queued. */
export function __idleQueueLength() { return _queue.length }
