// app/src/components/chart/drawingsStore.js — shared per-symbol chart-drawings store.
//
// ONE module-level registry that every chart surface reads through useChartDrawings.
// Fixes the same-symbol multi-chart clobber: with N charts mounted on one sym,
// per-instance copies of the drawings array + history meant last-writer-wins on
// localStorage. Here there is a single source of truth per sym, one shared
// undo/redo history ("undo the last change to this symbol, whoever made it"),
// and live cross-chart propagation for free.
//
// Modeled on lib/realtimeCandle.js (Map registry + subscribe/notify + _reset test
// helper) with one DELIBERATE divergence: entries are keyed by the RAW sym string
// exactly as passed to useChartDrawings — NO String(sym).toUpperCase()/trim —
// because the localStorage map ('uct-chart-drawings') has always been keyed by
// the raw sym prop, and normalizing would orphan users' saved drawings.
//
// useSyncExternalStore contract (pinned — do not loosen):
//  - getSnapshot(sym) is SIDE-EFFECT FREE: for an unloaded sym it returns the
//    frozen EMPTY_SNAPSHOT constant and never creates or loads an entry (React
//    calls it during render, BEFORE subscribe runs in the passive effect).
//  - subscribe(sym, cb) lazy-loads the sym from localStorage on refs 0→1 and
//    builds a NEW snapshot object; React's post-subscribe snapshot recheck is
//    what triggers the hydration re-render.
//  - Snapshot objects are stable between changes and REPLACED (never mutated)
//    on every change — including snapshotHistory, whose canUndo flip must reach
//    subscribers at drag START, before any commit.

const STORAGE_KEY = 'uct-chart-drawings'
const MAX_HISTORY = 100   // undo/redo depth per symbol (mirrors the legacy hook)

export const EMPTY_SNAPSHOT = Object.freeze({
  drawings: Object.freeze([]),
  canUndo: false,
  canRedo: false,
})

const _entries = new Map()   // sym -> { drawings, past, future, refs, snapshot }
const _subs = new Map()      // sym -> Set<callback>

// ── Fan-out guards ──────────────────────────────────────────────────────────
// Window-level keydown handlers run in EVERY mounted overlay, so one keypress
// with N same-sym charts calls the same mutation N times in ONE task. Guards
// clear at end-of-task (queueMicrotask), so distinct user gestures — distinct
// tasks — are never deduped.
const _gestureGuard = new Set()   // 'u:'+sym (undo) / 'r:'+sym (redo)
const _addGuard = new Map()       // 'a:'+sym+'|'+JSON(d) -> the FIRST add's id (paste fan-out)

// ── localStorage (per-sym read-modify-write, identical to the legacy writeLS) ─
function loadAll() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  catch { return {} }
}

function saveAll(all) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)) }
  catch { /* quota exceeded — in-memory state stays consistent for the session */ }
}

// Fresh RMW: re-read the whole map, touch ONLY all[sym], write back — other
// syms (and other tabs' writes to them) are never clobbered.
function _writeSym(sym, updated) {
  const all = loadAll()
  if (updated.length) all[sym] = updated
  else delete all[sym]
  saveAll(all)
}

// ── Registry internals ──────────────────────────────────────────────────────
function _buildSnapshot(e) {
  return { drawings: e.drawings, canUndo: e.past.length > 0, canRedo: e.future.length > 0 }
}

function _ensure(sym) {
  let e = _entries.get(sym)
  if (!e) {
    e = { drawings: loadAll()[sym] || [], past: [], future: [], refs: 0, snapshot: null }
    e.snapshot = _buildSnapshot(e)
    _entries.set(sym, e)
  }
  return e
}

// ── Notify — frame-coalesced fan-out ────────────────────────────────────────
// Mutations apply state + localStorage synchronously (no data-loss window); only
// the SUBSCRIBER notification is coalesced: pending syms are latched into a Set
// and flushed once per animation frame (queueMicrotask when rAF is unavailable).
// Every store notification re-renders the full StockChart of every same-sym
// chart, so this caps a drag storm at ~one re-render per chart per frame instead
// of one per pointermove per chart.
//
// Under vitest (import.meta.env.MODE === 'test') delivery is SYNCHRONOUS: the
// pre-store hook suite asserts synchronously right after each act() mutation,
// and a deferred callback can never run between two synchronous statements.
// The deferred path is covered by dedicated tests that opt in via
// _setSyncNotify(false).
const _SYNC_NOTIFY_DEFAULT = import.meta.env.MODE === 'test'
let _syncNotify = _SYNC_NOTIFY_DEFAULT
const _pendingNotify = new Set()
let _flushScheduled = false

function _fanOut(sym) {
  const subs = _subs.get(sym)
  if (!subs) return
  subs.forEach((cb) => { try { cb() } catch { /* one bad subscriber never breaks the rest */ } })
}

function _flush() {
  _flushScheduled = false
  const syms = Array.from(_pendingNotify)
  _pendingNotify.clear()
  for (const sym of syms) _fanOut(sym)
}

function _notify(sym) {
  if (_syncNotify) { _fanOut(sym); return }
  _pendingNotify.add(sym)
  if (_flushScheduled) return
  _flushScheduled = true
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_flush)
  else queueMicrotask(_flush)
}

// Apply a new drawings array. When `record` (default), the PREVIOUS state is
// pushed onto the undo stack and the redo stack is cleared. A live drag passes
// record:false for its per-move writes (it snapshots ONCE up front via
// snapshotHistory) so the whole drag collapses into a single undo step.
function _commit(sym, e, updated, record = true) {
  if (record) {
    e.past.push(e.drawings)
    if (e.past.length > MAX_HISTORY) e.past.shift()
    e.future = []
  }
  e.drawings = updated
  _writeSym(sym, updated)
  e.snapshot = _buildSnapshot(e)
  _notify(sym)
}

// ── Read side ───────────────────────────────────────────────────────────────
export function getSnapshot(sym) {
  const e = _entries.get(sym)
  return e ? e.snapshot : EMPTY_SNAPSHOT
}

export function subscribe(sym, cb) {
  const e = _ensure(sym)   // refs 0→1 lazy-load happens HERE, never in getSnapshot
  e.refs += 1
  let set = _subs.get(sym)
  if (!set) { set = new Set(); _subs.set(sym, set) }
  set.add(cb)
  let active = true
  return () => {
    if (!active) return
    active = false
    const cur = _subs.get(sym)
    if (cur) { cur.delete(cb); if (!cur.size) _subs.delete(sym) }
    e.refs -= 1
    // Last unsubscribe evicts the entry: history drops (matching the legacy
    // per-mount reset on unmount/sym-switch) and memory stays bounded; the next
    // subscribe reloads drawings from localStorage. The identity check guards a
    // stale closure evicting a NEWER entry after a _reset().
    if (e.refs <= 0 && _entries.get(sym) === e) _entries.delete(sym)
  }
}

export function canUndo(sym) { const e = _entries.get(sym); return !!e && e.past.length > 0 }
export function canRedo(sym) { const e = _entries.get(sym); return !!e && e.future.length > 0 }

/** Capture-time peek at one symbol's drawings for surfaces that freeze a COPY
 *  (journal chart embeds) without mounting a chart. Prefers the live in-memory
 *  entry, else reads localStorage directly. Side-effect free like getSnapshot —
 *  never creates or loads a registry entry — and returns a deep copy so the
 *  caller's frozen copy can never be mutated into (or by) the live store. */
export function peekDrawings(sym) {
  if (!sym) return []
  try {
    const e = _entries.get(sym)
    const src = e ? e.drawings : (loadAll()[sym] || [])
    return Array.isArray(src) ? JSON.parse(JSON.stringify(src)) : []
  } catch {
    return []
  }
}

// ── Mutations (all keyed by sym; falsy sym = no-op, mirroring the legacy guard) ─
export function addDrawing(sym, d) {
  // Legacy-hook parity: an id is returned even when sym is falsy (nothing stored).
  if (!sym) return crypto.randomUUID()
  // Content-keyed paste dedup: Ctrl+V is a window-level keydown that fires in
  // every mounted overlay, and with N same-sym charts the SAME payload (module
  // clipboard + deterministic offsetPoints) arrives N times in one task. The
  // first add commits; duplicates return the first add's id. Different-sym
  // paste still lands per sym (legitimate cross-chart paste), and every other
  // add path is single-call per user gesture.
  const key = 'a:' + sym + '|' + JSON.stringify(d)
  if (_addGuard.has(key)) return _addGuard.get(key)
  const id = crypto.randomUUID()
  _addGuard.set(key, id)
  queueMicrotask(() => _addGuard.delete(key))
  const e = _ensure(sym)
  _commit(sym, e, [...e.drawings, { ...d, id }])
  return id
}

export function removeDrawing(sym, id) {
  if (!sym) return
  const e = _ensure(sym)
  // No-op guard: one Delete keypress fires removeDrawing(sameId) from every
  // same-sym overlay — the 2nd+ calls must not record a junk history step.
  if (!e.drawings.some((x) => x.id === id)) return
  _commit(sym, e, e.drawings.filter((x) => x.id !== id))
}

export function updateDrawing(sym, id, updates, opts) {
  if (!sym) return
  const e = _ensure(sym)
  if (!e.drawings.some((x) => x.id === id)) return   // unknown id: no junk history step
  _commit(
    sym, e,
    e.drawings.map((x) => (x.id === id ? { ...x, ...updates } : x)),
    opts?.record !== false,
  )
}

export function clearAll(sym) {
  if (!sym) return
  _commit(sym, _ensure(sym), [])
}

// Reorder a drawing in the z-stack. 'front' → end of the array (rendered last =
// on top, and hit-tested first); 'back' → start. Recorded as one undo step.
export function reorderDrawing(sym, id, dir) {
  if (!sym) return
  const e = _ensure(sym)
  const d = e.drawings.find((x) => x.id === id)
  if (!d) return
  const rest = e.drawings.filter((x) => x.id !== id)
  _commit(sym, e, dir === 'back' ? [d, ...rest] : [...rest, d])
}

// Push the CURRENT state onto the undo stack without changing it — called once
// at the start of a drag so the coalesced record:false writes are undoable as
// one step. Rebuilds the snapshot + notifies so canUndo flips at drag START.
export function snapshotHistory(sym) {
  if (!sym) return
  const e = _ensure(sym)
  e.past.push(e.drawings.map((d) => ({ ...d })))
  if (e.past.length > MAX_HISTORY) e.past.shift()
  e.future = []
  e.snapshot = _buildSnapshot(e)
  _notify(sym)
}

export function undo(sym) {
  if (!sym) return
  // Per-sym gesture dedup: one window keydown (Ctrl+Z) fires undo from every
  // mounted same-sym overlay in the same task — only the first call steps.
  const k = 'u:' + sym
  if (_gestureGuard.has(k)) return
  _gestureGuard.add(k)
  queueMicrotask(() => _gestureGuard.delete(k))
  const e = _ensure(sym)
  if (!e.past.length) return
  e.future.push(e.drawings)
  e.drawings = e.past.pop()
  _writeSym(sym, e.drawings)
  e.snapshot = _buildSnapshot(e)
  _notify(sym)
}

export function redo(sym) {
  if (!sym) return
  const k = 'r:' + sym
  if (_gestureGuard.has(k)) return
  _gestureGuard.add(k)
  queueMicrotask(() => _gestureGuard.delete(k))
  const e = _ensure(sym)
  if (!e.future.length) return
  e.past.push(e.drawings)
  e.drawings = e.future.pop()
  _writeSym(sym, e.drawings)
  e.snapshot = _buildSnapshot(e)
  _notify(sym)
}

// ── Test/debug helpers (mirrors realtimeCandle.js) ──────────────────────────
export function _reset() {
  _entries.clear()
  _subs.clear()
  _gestureGuard.clear()
  _addGuard.clear()
  _pendingNotify.clear()
  _flushScheduled = false
  _syncNotify = _SYNC_NOTIFY_DEFAULT
}

export function _setSyncNotify(v) { _syncNotify = !!v }
