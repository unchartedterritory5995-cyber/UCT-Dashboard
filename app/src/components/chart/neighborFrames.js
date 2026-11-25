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
// ⛔ ALMOST A LEAF: its imports are lib/chartSpeed.js and styles/breakpoints.js, which import nothing, so the
// binder, the bar store's adapter and StockChart can all still reach it.

import { chartSpeedKilled } from '../../lib/chartSpeed'
import { MQ } from '../../styles/breakpoints'

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
const _weak = (x) => (_WeakRef ? new _WeakRef(x) : { deref: () => x })

// ─── ⭐ AND A BUDGET IN BARS (2026-11-25, review of #2729) ─────────────────────────────────────────────
// Counting rows (below) lets one row's depth multiply what is kept: ten 20,000-bar minute rows hold about twice the
// derived values ten arrays did, and the switch is not device-gated, while iOS Safari kills a tab on a few hundred MB.
// So the derived values kept are ALSO bounded by their size: every derived array counts its length (a Set its size)
// against DERIVED_BARS (each cache on its own: the derived values, the chart times), and over it the least recently
// used rows go, oldest first. Two rows never go for the budget (nor for the row bound): the row each chart SHOWS and
// the row it prepared FIRST, the one its next press lands on (`holdRow`, useNeighborFrames). The budget is sized so
// a desktop 1m + 15m board keeps its 10 rows with room (DERIVED_BARS_DESKTOP); the touch tier (≤1024 px or a coarse
// pointer: one chart, a phone's memory) keeps less (DERIVED_BARS_TOUCH). What is derived and what a lookup asks are
// unchanged: a dropped value is computed again, the same numbers.
//
// ARITHMETIC (the 2026-11-25 next-row replay, run 3: S&P 500, 1m + 15m, regular hours, 39 presses). A row holds, in
// derived bars, its session rows (the filter's output) plus the candles, closes, volume and its average over them:
// 5 arrays of the session rows' length (the HVC set adds a few hundred; the extremes are one object). The rows' session
// rows ran 9.2k-24.5k (minute rows of 20,001, 15-minute rows of 20,025-32,001; names with little extended-hours trading
// keep most of theirs). The ten most recent rows at a press (on screen, three prepared and the one just left, per
// chart) held a median 618k and at most 831k derived bars (the heaviest: 5 x (10,255 + 11,037 + 14,265 + 14,451 +
// 15,517 + 15,661 + 18,757 + 19,472 + 22,271 + 24,465)). DERIVED_BARS_DESKTOP = 1,000,000 is x1.2 that: the budget
// does NOT bind on that board, it keeps its 10 rows. The chart times are one array per row (at most 166k for the ten):
// far under. The touch tier, one chart: 4 rows (on screen + three prepared) of median 12k session rows are ~240k;
// DERIVED_BARS_TOUCH = 200,000 keeps the row on screen and the next one always (held) and the farther prepared rows
// when they fit. A derived bar is one small object (a candle, a point) or a reference: 1M is some 50-80 MB of the
// heap at most, 200k a fifth of that.
export const DERIVED_BARS_DESKTOP = 1_000_000
export const DERIVED_BARS_TOUCH = 200_000
/** The derived bars a page keeps: the touch tier keeps fewer. */
export function derivedBarsBudgetFor({ touch = false } = {}) { return touch ? DERIVED_BARS_TOUCH : DERIVED_BARS_DESKTOP }
let _budget = null
function _touchTier() {
  try {
    return typeof matchMedia === 'function' && (matchMedia(MQ.touchDown).matches || matchMedia(MQ.coarsePointer).matches)
  } catch { return false }
}
/** This page's budget, read once (the tier a page loads on). */
export function derivedBarsBudget() {
  if (_budget === null) _budget = derivedBarsBudgetFor({ touch: _touchTier() })
  return _budget
}
/** Tests: set the budget (null re-reads the tier). */
export function __setDerivedBarsBudgetForTests(n) { _budget = n === null || n === undefined ? null : n }

/** owner (a chart) -> { shown, next }: weak handles on the rows it shows and will land on next. */
const _held = new Map()
/** `owner` shows (`slot` 'shown') or prepared first (`slot` 'next') the row of `src`: neither budget nor bound drops
 *  it while the owner holds it there. Weak: a row the store let go is collected as before. `src` null clears the slot. */
export function holdRow(owner, slot, src) {
  if (!owner || (slot !== 'shown' && slot !== 'next')) return
  let h = _held.get(owner)
  if (!h) { h = { shown: null, next: null }; _held.set(owner, h) }
  h[slot] = src && typeof src === 'object' ? _weak(rowOf(src)) : null
}
/** `owner` holds nothing any more (its chart is gone). */
export function releaseRows(owner) { _held.delete(owner) }
function _isHeld(row) {
  if (!row) return false
  for (const h of _held.values()) {
    if ((h.shown && h.shown.deref() === row) || (h.next && h.next.deref() === row)) return true
  }
  return false
}
/** Derived bars a value holds: an array its length, a Set or Map its size, anything else nothing. */
function _barsOf(v) {
  if (Array.isArray(v)) return v.length
  if (v instanceof Set || v instanceof Map) return v.size
  return 0
}

function _lru() {
  const store = new WeakMap()     // source -> value
  const tokens = new WeakMap()    // source -> its one recency token
  const order = new Set()         // tokens, oldest first; a token holds its source weakly (strongly where WeakRef is missing)
  const weights = new Map()       // token -> derived bars held under it
  let total = 0
  const tokenOf = (src) => {
    let t = tokens.get(src)
    if (!t) { t = _weak(src); tokens.set(src, t) }
    return t
  }
  const touch = (src) => { const t = tokenOf(src); order.delete(t); order.add(t) }
  const drop = (t) => {
    order.delete(t)
    total -= weights.get(t) || 0
    weights.delete(t)
    const s = t.deref()
    if (s) store.delete(s)
  }
  // oldest first, while over the row bound or the bars budget; never `keep` (the source just used) nor a held row
  const evict = (keep) => {
    for (const t of [...order]) if (!t.deref()) drop(t)   // sources already collected
    for (const t of [...order]) {
      if (order.size <= SOURCES_KEPT && total <= derivedBarsBudget()) break
      if (t === keep || _isHeld(t.deref())) continue
      drop(t)
    }
  }
  return {
    get(src) { const v = store.get(src); if (v) touch(src); return v },
    make(src, v) {
      store.set(src, v)
      touch(src)
      evict(tokenOf(src))
      return v
    },
    /** `n` derived bars more (fewer, negative) are held under `src` (a source this cache holds); over the budget,
     *  older rows go. */
    weigh(src, n) {
      if (!n) return
      const t = tokens.get(src)
      if (!t || !order.has(t)) return
      weights.set(t, (weights.get(t) || 0) + n)
      total += n
      if (n > 0) evict(t)
    },
    /** The derived bars held, and the sources (rows) holding them (diagnostics, tests). */
    size() { return { bars: total, rows: order.size } },
    clear() { for (const t of order) { const s = t.deref(); if (s) store.delete(s) } order.clear(); weights.clear(); total = 0 },
  }
}

// ─── ⭐ ROWS, NOT ARRAYS (2026-11-25, next-row key task) ─────────────────────────────────────────────
// The bound above was meant in ROWS ("the rows around the selection on two charts, the row on screen and the one
// just left") and counted ARRAYS. A row is two or three arrays here: its rows (the session filter's source), the
// session-filtered rows (the candles, closes, volume, its average, the HVC set, the extremes, the chart times, the
// binder's columns), and with Heikin-Ashi its display rows. Preparing the three rows around the selection on a
// two-chart board files under 12 arrays, plus the 4 of the rows on screen: the LRU dropped the OLDEST, which is the
// row prepared FIRST, the very row the next press lands on (the next-row replay, 2026-11-25, 39 presses on a 1m + 15m
// board: every chart render in the presses' key tasks read the very rows array the preparer had read, and 67 of the 76
// session derivations there missed: that row's derived values had been dropped; nothing downstream was reused).
// An array derived from a row's rows is now filed under that row (`linkDerivedSource`, called where the chain derives
// it: deriveSession, deriveDisplay): its derived values and chart times are kept and dropped with the row, and the
// LRU counts rows. What is derived is unchanged: the same (array, name, signature) asks the same question.
const _rowOf = new WeakMap()   // an array derived from a row's rows -> those rows (the row's first array)
const rowOf = (src) => _rowOf.get(src) || src
/** `child` was derived from `parent` (the session filter of a row's rows, their Heikin-Ashi): file it under the
 *  same row. Once per array: a child keeps the row it was first filed under. */
export function linkDerivedSource(child, parent) {
  if (!child || !parent || child === parent || typeof child !== 'object' || typeof parent !== 'object') return
  if (_rowOf.has(child)) return
  const row = rowOf(parent)
  if (row !== child) _rowOf.set(child, row)
}
/** The per-array map filed under `src`'s row (made on first use). */
function _underRow(lru, src) {
  const row = rowOf(src)
  const bySrc = lru.get(row) || lru.make(row, new Map())
  let m = bySrc.get(src)
  if (!m) { m = new Map(); bySrc.set(src, m) }
  return m
}

// ─── one chart time per bar ───────────────────────────────────────────────────────────────────────────
const _times = _lru()   // a row's rows -> Map(bars of that row -> Map(adjustTime -> times[]))

/**
 * `bars.map(b => adjustTime(b.t))`, built once per (bars, adjustTime) and shared read-only by every
 * reader. `adjustTime` is a pure function of the bar time (StockChart's stable `useCallback` over
 * `barTime.toChartTime`), so the array is exactly what each reader computed for itself.
 */
export function chartTimesFor(bars, adjustTime) {
  if (!Array.isArray(bars) || typeof adjustTime !== 'function') return null
  const byFn = _underRow(_times, bars)
  const hit = byFn.get(adjustTime)
  if (hit) { _stats.timesHit += 1; return hit }
  const out = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) out[i] = adjustTime(bars[i].t)
  byFn.set(adjustTime, out)
  _stats.timesBuilt += 1
  _times.weigh(rowOf(bars), out.length)
  return out
}

// ─── a derived array, filed under its source array ────────────────────────────────────────────────────
const _derived = _lru()   // a row's rows -> Map(source array of that row -> Map(`${name}\u0001${sig}` -> value))
const DERIVED_PER_SOURCE = 16

/**
 * `fn()` filed under (`src` identity, `name`, `sig`): the same question asked again of the same array
 * returns the same answer object. ⛔ `sig` must name EVERY value `fn` reads besides `src`; a value it
 * does not name is one a later caller could change without missing (`stableSig`).
 */
export function deriveFrom(src, name, sig, fn) {
  if (!src || typeof src !== 'object') return fn()
  const m = _underRow(_derived, src)
  const k = `${name}\u0001${sig}`
  if (m.has(k)) { _stats.derivedHit += 1; return m.get(k) }
  const v = fn()
  m.set(k, v)
  let n = _barsOf(v)
  while (m.size > DERIVED_PER_SOURCE) {
    const old = m.keys().next().value
    n -= _barsOf(m.get(old))
    m.delete(old)
  }
  _derived.weigh(rowOf(src), n)
  return v
}

/** The derived bars held now, and the rows holding them: the derived values and the chart times (each its own cache,
 *  each against the budget). */
export function derivedHeld() { return { derived: _derived.size(), times: _times.size(), budget: derivedBarsBudget() } }

/** Was `name`/`sig` already derived from `src`? (A preparer skips what is done.) */
export function hasDerived(src, name, sig) {
  const bySrc = src && typeof src === 'object' ? _derived.get(rowOf(src)) : null
  const m = bySrc ? bySrc.get(src) : null
  return !!m && m.has(`${name}\u0001${sig}`)
}

/** Tests: forget every derived value and chart-time array. */
export function __resetDerivedForTests() { _derived.clear(); _times.clear(); _held.clear() }

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
    try { done = !!q.gen.next().done } catch { done = true }
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
