// app/src/lib/switchSpeed.js — THE FIELD INSTRUMENT FOR CHART-SWITCH SPEED (2026-11-23).
//
// The goal is "key press to the charts drawn in under 40 ms for every member". Until this file that was
// measured only on a test rig. This counts it in each member's own page as HISTOGRAMS OF COUNTS: one small
// integer per (combination, time bucket). Nothing is kept per switch, and never a symbol.
//
// WHAT ONE SAMPLE IS
//   press   the `timeStamp` of the input event in flight when the board's setGroupSym ran
//           (hooks/handoffGroups.beginGroupSwitch): the key event of an arrow / Space / Enter, the click of a
//           row. It is the browser's own time for the input, so the wait for a busy main thread before the
//           handler ran is inside the sample.
//   frame   the clock, read inside the first animation-frame callback after EVERY chart of the linked group
//           has made its paint record for the new symbol (components/chart/paintLog.recordPaint: a FULL
//           pass WITH bars, the pass in which StockChart hands the new rows to its series). The callback is
//           asked for from a microtask after the last chart's pass, so it is queued behind the draw
//           callbacks the chart library asked for in that pass: the candles' draw calls of that frame have
//           run when the clock is read.
//   NOT IN IT: the rest of that frame (style, layout and paint of the page around the canvases), the
//           compositor and the GPU, the wait for vsync, the display. A member sees the frame about one
//           refresh interval after this stamp. A chart that shows the symbol with NO bars has not drawn it.
//
// WHAT IS COUNTED, AND ONLY THIS (SWITCH_* below are the whole vocabulary; the server holds the same lists,
// api/services/perf_beacon.py, pinned equal by tests/test_perf_beacon.py)
//   a cell   [timeframe class, device store on, trigger, route, inside the regular session] -> 11 counts,
//            one per bucket of SWITCH_BUCKET_EDGES_MS (0-16, 16-25, 25-33, 33-40, 40-50 ... 500+)
//   counters switches that produced no sample, by why (SWITCH_COUNTERS)
// The timeframe class of a group is its FINEST chart's (a D + 1m pair is `intraday-1m`): the finest
// timeframe is the one whose rows are hardest to hold current. The route is the slowest any chart of the
// group took (SWITCH_ROUTE is in that order).
//
// COST. The press: one read of the event in flight, a few comparisons, one small record. A chart's paint
// pass: one call that returns at once unless a switch is waiting for it. The clock is read and the count
// made in the frame callback, never in the handler. No timer, no listener on the key path.
//
// SENT by lib/perfBeacon.js (the existing real-user report, same door, same server switch), which finds this
// module through `window.__uctSwitchSpeed` and never imports it: the beacon's chunk stays what it was.
//
// ⛔ ZERO IMPORTS. The handoff wires this in (hooks/useSymbolHandoff.js); it must cost that chunk only itself.

export const SWITCH_VERSION = 1
/** Upper edges of the first ten buckets, in ms; the eleventh is "this and above". A sample of exactly an
 *  edge belongs to the bucket ABOVE it, so "under 40 ms" is exactly the buckets below the 40 edge. */
export const SWITCH_BUCKET_EDGES_MS = [16, 25, 33, 40, 50, 66, 100, 150, 250, 500]
export const SWITCH_UNDER_MS = 40
export const SWITCH_TF = ['intraday-1m', 'intraday-other', 'daily-plus']
export const SWITCH_TRIGGER = ['list-key', 'click', 'typed', 'other']
export const SWITCH_ROUTE = ['other', 'decision', 'now', 'deferred', 'daily-hold', 'prepare']
export const SWITCH_COUNTERS = ['superseded', 'abandoned', 'unpressed', 'untracked', 'unclocked', 'overflow', 'released']
/** At most this many cells are ever opened between two sends; a sample for one more is counted `overflow`. */
export const MAX_SWITCH_CELLS = 64
/** No count grows past this (the server refuses a larger one). */
export const MAX_SWITCH_COUNT = 100000
/** ...and no more than this many samples in all are counted between two sends (one every 1.2 s for two hours,
 *  without a pause): the rest are `overflow`. The server refuses a report that holds more, and takes no more
 *  than this from one sender in an hour, so one sender cannot outweigh every member in a pooled share. */
export const MAX_SWITCH_TOTAL = 6000
/** A sample outside 0..this is not a switch time (a clock mismatch, a page that slept): counted `unclocked`. */
export const MAX_SWITCH_MS = 60000
/** Where lib/perfBeacon.js finds `{take, peek}`. perfBeacon holds the same literal; its test pins them equal. */
export const SWITCH_SPEED_GLOBAL = '__uctSwitchSpeed'

// trigger codes (indexes of SWITCH_TRIGGER)
//   list-key    ArrowUp / ArrowDown / Space outside a text field: walking a list
//   click       ANY pointer event that changed the symbol: a list row, an alert row, a menu, a badge on the chart
//               (not only lists, so the name does not say "list"), a search result excepted
//   typed       a key pressed in a text field (the Enter of a typed ticker), a form submit, or the chart
//               header's search told us so (hintSwitchTrigger: a picked result is a click, and is typed)
//   other       any other input event (a hotkey outside a text field)
export const TRIGGER_LIST_KEY = 0
export const TRIGGER_CLICK = 1
export const TRIGGER_TYPED = 2
export const TRIGGER_OTHER = 3
// route codes (indexes of SWITCH_ROUTE), slowest last; a group's route is the highest any chart reported
//   other       nothing reported how it was shown (a member that paints itself)
//   decision    decided in the press (handoffGroups.decideGroupShow): one synchronous render
//   now         not decided in the press, but every chart held its rows: shown from the handoff's effect
//               (at most the wait for its panes' columns)
//   deferred    the burst rule held the request first (useSymbolSettle BURST_SETTLE_MS), then as `now`
//   daily-hold  a D/W/M chart had to promote or join its set first (the bounded daily prepare)
//   prepare     an intraday chart had to wait for rows (the intraday prepare: the server, the lake or the device)
export const ROUTE_OTHER = 0
export const ROUTE_DECISION = 1
export const ROUTE_NOW = 2
export const ROUTE_DEFERRED = 3
export const ROUTE_DAILY_HOLD = 4
export const ROUTE_PREPARE = 5

const C_SUPERSEDED = 0   // a newer press on the same group came before this one's frame
const C_ABANDONED = 1    // the page was hidden while it waited (no frame is drawn for a hidden page)
const C_UNPRESSED = 2    // the symbol changed with no input event in flight (a link, a restore): not a press
const C_UNTRACKED = 3    // a chart of the group carries no paint identity, so its draw cannot be seen
const C_UNCLOCKED = 4    // the press or the sample had no usable time (see MAX_SWITCH_MS)
const C_OVERFLOW = 5     // more than MAX_SWITCH_CELLS combinations, or MAX_SWITCH_TOTAL samples, between two sends
const C_RELEASED = 6     // the event in flight was a key's RELEASE: never timed (the sample would start a key-hold late)

const NB = SWITCH_BUCKET_EDGES_MS.length + 1
const N_TF = SWITCH_TF.length
const N_TRIG = SWITCH_TRIGGER.length
const N_ROUTE = SWITCH_ROUTE.length
const N_CELLS = N_TF * 2 * N_TRIG * N_ROUTE * 2
const _counts = new Uint32Array(N_CELLS * NB)
const _used = new Uint8Array(N_CELLS)
const _counters = new Uint32Array(SWITCH_COUNTERS.length)
let _cellsUsed = 0
let _total = 0

/** group -> the switch waiting for its frame: { sym, t0, trig, route, members, drawn, all, ready } */
const _pending = new Map()
let _hint = -1
let _store = false
let _rth = null
let _rthAt = -Infinity
let _rthVal = 0
let _frameAsked = false
let _armed = false
let _listening = false
let _clock = () => performance.now()

const _bump = (i) => { if (_counters[i] < MAX_SWITCH_COUNT) _counters[i] += 1 }

/** The bucket (0..10) of a time in ms. */
export function switchBucketOf(ms) {
  let b = 0
  while (b < SWITCH_BUCKET_EDGES_MS.length && ms >= SWITCH_BUCKET_EDGES_MS[b]) b += 1
  return b
}

const _MINUTES = /^\d+$/
/** The class (an index of SWITCH_TF) of a timeframe code: '1'; any other count of minutes; D/W/M and anything else. */
export function switchTfClass(code) {
  const s = String(code)
  if (s === '1') return 0
  return _MINUTES.test(s) ? 1 : 2
}

// input events: 1 a key, 2 a pointer, 3 a form event. Anything else in flight (a timer's task, a message,
// a load) is not a press.
// ⛔ A KEY EVENT IS KNOWN BY ITS SHAPE (`key`, `repeat`), NEVER BY ITS NAME. This file listens for no key and spells
// no key event's name: pages/command/keyListenerCensus.test.js counts every such string outside a listener call as
// a suspected listener, and it is right to (that is how a registration through a variable shows up).
const _KIND = new Map([
  ['click', 2], ['auxclick', 2], ['dblclick', 2], ['mousedown', 2], ['mouseup', 2], ['pointerdown', 2],
  ['pointerup', 2], ['touchstart', 2], ['touchend', 2],
  ['submit', 3], ['change', 3], ['input', 3],
])
function _classify(ev) {
  const kind = typeof ev.key === 'string' && typeof ev.repeat === 'boolean' ? 1 : _KIND.get(ev.type)
  if (!kind) return -1
  const t = ev.target
  const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable === true)
  if (kind === 1) {
    if (typing) return TRIGGER_TYPED
    const k = ev.key
    return k === 'ArrowDown' || k === 'ArrowUp' || k === ' ' || k === 'Spacebar' ? TRIGGER_LIST_KEY : TRIGGER_OTHER
  }
  if (kind === 2) return TRIGGER_CLICK
  return typing || ev.type === 'submit' ? TRIGGER_TYPED : TRIGGER_OTHER
}

/** The event being dispatched right now, as the browser reports it (undefined outside a dispatch). */
function _eventInFlight() {
  try { return (typeof window !== 'undefined' && window.event) || null } catch { return null }
}

function _onVisibility() {
  try { if (document.visibilityState !== 'hidden') return } catch { return }
  for (const g of [..._pending.keys()]) { _pending.delete(g); _bump(C_ABANDONED) }
}

/**
 * THE PRESS (handoffGroups.beginGroupSwitch calls this before it decides, in the handler's own task).
 * `members`: the group's registered members (a Map of { key, tf() }): `key` is the identity its chart paints
 * under (chart/paintLog PaintMemberContext). Reads no clock and asks for no frame.
 */
function switchPress(scope, group, sym, members) {
  if (_pending.size && _pending.delete(group)) _bump(C_SUPERSEDED)
  const ev = _eventInFlight()
  // A key's RELEASE is not a press. Nothing switches a symbol on one today (lib/switchSpeed.keyupRail.test.js reads the
  // source for it); if something ever does, the field data says so here instead of reporting the switch faster than it
  // was. Known by shape and by how its name ends: this file spells no key event's name (see _classify).
  if (ev && typeof ev.key === 'string' && typeof ev.repeat === 'boolean' && String(ev.type).endsWith('up')) { _bump(C_RELEASED); return }
  let trig = ev ? _classify(ev) : -1
  if (trig < 0) { _bump(C_UNPRESSED); return }
  if (_hint >= 0) trig = _hint
  const t0 = ev.timeStamp
  if (typeof t0 !== 'number' || !(t0 > 0)) { _bump(C_UNCLOCKED); return }
  const n = members ? members.size : 0
  if (!n || n > 30) { _bump(C_UNTRACKED); return }
  const list = []
  for (const m of members.values()) {
    if (!m || !m.key || typeof m.tf !== 'function') { _bump(C_UNTRACKED); return }
    list.push(m)
  }
  _pending.set(group, { sym, t0, trig, route: ROUTE_OTHER, members: list, drawn: 0, all: (1 << n) - 1, ready: false })
  if (!_listening) {
    _listening = true
    try { document.addEventListener('visibilitychange', _onVisibility) } catch { /* no document */ }
  }
}

/** The group's charts were all shown in the press (the decision). */
function switchDecided(group, sym) {
  const p = _pending.get(group)
  if (p && p.sym === sym && p.route < ROUTE_DECISION) p.route = ROUTE_DECISION
}

/** What the handoff hands to handoffGroups.observeGroupSwitches. */
export const switchObserver = { press: switchPress, decided: switchDecided }

/** A chart of `group` took this route to `sym` (a ROUTE_* code); the slowest one reported is the group's. */
export function noteSwitchRoute(group, sym, code) {
  if (!_pending.size) return
  const p = _pending.get(group)
  if (p && p.sym === sym && code > p.route) p.route = code
}

/**
 * The trigger of the switch the caller is about to make, when the caller knows better than the event does
 * (a TRIGGER_* code), or -1 to forget it. Set it, call setGroupSym, clear it: the same task.
 */
export function hintSwitchTrigger(code) {
  _hint = Number.isInteger(code) && code >= 0 && code < N_TRIG ? code : -1
}

/** This page's facts: is the device store on (one answer per page load), and a function saying whether the
 *  regular session is open now (asked in the frame callback, at most every 30 s). */
export function setSwitchEnv({ store = false, rth = null } = {}) {
  _store = !!store
  _rth = typeof rth === 'function' ? rth : null
  _rthAt = -Infinity
}

function _rthNow(now) {
  if (now - _rthAt > 30000 || now < _rthAt) {
    _rthAt = now
    try { _rthVal = _rth && _rth() ? 1 : 0 } catch { _rthVal = 0 }
  }
  return _rthVal
}

/**
 * A CHART'S PAINT RECORD (chart/paintLog.recordPaint hands every pass of a chart that has an identity).
 * Returns at once unless a switch is waiting; a pass with no bars, or one that re-set nothing, drew nothing.
 */
export function chartPainted(key, sym, bars, mode) {
  if (!_pending.size || mode !== 'full' || !(bars > 0)) return
  for (const p of _pending.values()) {
    if (p.ready || p.sym !== sym) continue
    const ms = p.members
    for (let i = 0; i < ms.length; i++) {
      if (ms[i].key === key) { p.drawn |= 1 << i; break }
    }
    if (p.drawn === p.all) { p.ready = true; _armFrame() }
  }
}

function _armFrame() {
  if (_armed || _frameAsked) return
  _armed = true
  try { queueMicrotask(_askFrame) } catch { Promise.resolve().then(_askFrame) }
}
function _askFrame() {
  _armed = false
  if (_frameAsked || typeof requestAnimationFrame !== 'function') return
  _frameAsked = true
  requestAnimationFrame(_onFrame)
}
/** THE STAMP: the only place the clock is read and a count made. */
function _onFrame() {
  _frameAsked = false
  let now = -1
  for (const [g, p] of _pending) {
    if (!p.ready) continue
    if (now < 0) now = _clock()
    _pending.delete(g)
    _count(p, now)
  }
}

function _count(p, now) {
  const dt = now - p.t0
  if (!(dt >= 0) || dt > MAX_SWITCH_MS) { _bump(C_UNCLOCKED); return }
  let tf = N_TF - 1
  const ms = p.members
  for (let i = 0; i < ms.length; i++) {
    let c = N_TF - 1
    try { c = switchTfClass(ms[i].tf()) } catch { c = N_TF - 1 }
    if (c < tf) tf = c
  }
  if (_total >= MAX_SWITCH_TOTAL) { _bump(C_OVERFLOW); return }
  const cell = (((tf * 2 + (_store ? 1 : 0)) * N_TRIG + p.trig) * N_ROUTE + p.route) * 2 + _rthNow(now)
  if (!_used[cell]) {
    if (_cellsUsed >= MAX_SWITCH_CELLS) { _bump(C_OVERFLOW); return }
    _used[cell] = 1
    _cellsUsed += 1
  }
  const i = cell * NB + switchBucketOf(dt)
  if (_counts[i] < MAX_SWITCH_COUNT) { _counts[i] += 1; _total += 1 }
}

function _snapshot(reset) {
  const cells = []
  for (let c = 0; c < N_CELLS; c++) {
    if (!_used[c]) continue
    const rth = c % 2
    let r = (c - rth) / 2
    const route = r % N_ROUTE
    r = (r - route) / N_ROUTE
    const trig = r % N_TRIG
    r = (r - trig) / N_TRIG
    const store = r % 2
    const row = [(r - store) / 2, store, trig, route, rth]
    for (let b = 0; b < NB; b++) row.push(_counts[c * NB + b])
    cells.push(row)
  }
  const counters = Array.from(_counters)
  // a symbol that changed with no press is not worth a report of its own: it rides with the next one
  const worth = cells.length > 0 || counters.some((n, i) => n > 0 && i !== C_UNPRESSED)
  if (!worth) return null
  if (reset) { _counts.fill(0); _used.fill(0); _counters.fill(0); _cellsUsed = 0; _total = 0 }
  return { v: SWITCH_VERSION, cells, counters }
}

/**
 * Everything counted since the last take, as INTEGERS ONLY, and forget it; null when there is nothing worth
 * sending. `{ v, cells: [[tf, store, trigger, route, rth, n0 .. n10], ...], counters: [one per SWITCH_COUNTERS] }`:
 * the first five numbers of a cell are indexes into the lists above, the rest its counts per bucket.
 */
export function takeSwitchCounts() { return _snapshot(true) }
/** The same, without forgetting (a tester's read in the console: `__uctSwitchSpeed.peek()`). */
export function peekSwitchCounts() { return _snapshot(false) }

try {
  if (typeof window !== 'undefined') window[SWITCH_SPEED_GLOBAL] = { take: takeSwitchCounts, peek: peekSwitchCounts }
} catch { /* a locked-down host: nothing is sent */ }

/** Tests: forget everything counted and waiting. The page's facts (setSwitchEnv) are kept: the handoff sets them
 *  once per page load, and a rail that goes through the handoff must see what it set. */
export function __resetSwitchSpeedForTests() {
  _counts.fill(0); _used.fill(0); _counters.fill(0); _cellsUsed = 0; _total = 0
  _pending.clear()
  _hint = -1; _rthAt = -Infinity; _rthVal = 0
  _frameAsked = false; _armed = false
  _clock = () => performance.now()
}
/** Tests: the clock the frame callback reads. */
export function __setSwitchClockForTests(fn) { _clock = fn }
