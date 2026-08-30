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
  _bumpAny()
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
  _bumpAny()
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
  _bumpAny()
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
  _bumpAny()
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACINGS — named, transparent overlay sheets that span every ticker (Phase 0)
// ─────────────────────────────────────────────────────────────────────────────
// A "tracing" is a sheet of drawings. Phase 0 lands the DATA MODEL + migration
// ONLY: exactly one tracing is active and owns all existing drawings, which stay
// byte-for-byte where they already live (STORAGE_KEY). There is no switching, no
// multi-sheet render, and no UI yet — those are Phase 1.
//
// ⭐ INVARIANT: the ACTIVE tracing's per-sym drawings ALWAYS live in STORAGE_KEY
// ('uct-chart-drawings'); every NON-active tracing's drawings live in the tracings
// doc's `archive`. That is the whole reason the per-sym registry above needed ZERO
// changes — loadAll / _writeSym operate on the active slot BY CONSTRUCTION. A
// Phase-1 active-switch is therefore a SWAP through STORAGE_KEY (plus entry
// invalidation), never a rewrite of the drawing path.
//
// ⭐ The doc is only persisted once the user TOUCHES the tracing system (a meta
// mutation). Absent a persisted doc, the store reports a single implicit default
// tracing — so a member who never opens the tracings UI writes no new key and their
// storage is identical to before this landed. That is what keeps every pre-existing
// drawings test green without modification.
//
// ⛔ Default sheets carry NO name (empty string). The numbered "Tracing N" is a
// DISPLAY placeholder derived by tracingLabel() so the UI and tests share ONE
// definition — never a name baked into stored data.

const TRACINGS_KEY = 'uct-chart-tracings'
const DEFAULT_TRACING_ID = 'default'
// Distinct, theme-agnostic sheet colors; createTracing picks the next by order.
const TRACING_PALETTE = ['#c9a84c', '#5b9bd5', '#e06666', '#63c384', '#b48ce0', '#e0a35b', '#4fc0c0']

/** Display name for a board: the user's name if set, else the numbered placeholder
 *  derived from its position. ONE authority for both UI and tests. (The feature is
 *  called "Drawing Boards" in the UI; the internal identifiers stay `tracing*`.) */
export function tracingLabel(t) {
  const nm = t && typeof t.name === 'string' ? t.name.trim() : ''
  return nm || `Board ${((t && t.order) || 0) + 1}`
}

function _defaultTracing() {
  return { id: DEFAULT_TRACING_ID, name: '', color: TRACING_PALETTE[0], order: 0 }
}

// What an un-migrated store reports: one active default tracing owning STORAGE_KEY.
// NOT persisted until a mutation materializes it.
function _virtualDoc() {
  const t = _defaultTracing()
  return { v: 1, tracings: [t], activeId: t.id, visibleIds: [t.id], archive: {} }
}

function _loadDoc() {
  try {
    const raw = localStorage.getItem(TRACINGS_KEY)
    if (!raw) return null
    const doc = JSON.parse(raw)
    if (!doc || !Array.isArray(doc.tracings) || doc.tracings.length === 0) return null
    // Self-repair a partial/foreign doc rather than throwing user data away.
    if (!doc.tracings.some((t) => t && t.id === doc.activeId)) doc.activeId = doc.tracings[0].id
    // visibleIds: drop ghost ids, force-include the active sheet, keep tracing order.
    const valid = new Set(doc.tracings.map((t) => t.id))
    const vis = new Set((Array.isArray(doc.visibleIds) ? doc.visibleIds : []).filter((id) => valid.has(id)))
    vis.add(doc.activeId)
    doc.visibleIds = doc.tracings.filter((t) => vis.has(t.id)).map((t) => t.id)
    if (!doc.archive || typeof doc.archive !== 'object') doc.archive = {}
    // The ACTIVE sheet's data lives in STORAGE_KEY — archive[activeId] is never
    // authoritative, so drop any stale duplicate a prior swap left behind.
    if (doc.archive[doc.activeId]) { const a = { ...doc.archive }; delete a[doc.activeId]; doc.archive = a }
    if (typeof doc.v !== 'number') doc.v = 1
    return doc
  } catch { return null }
}

// Read-only resolve (never persists) — reads see a coherent doc even pre-migration.
function _ensureDoc() { return _loadDoc() || _virtualDoc() }

function _saveDoc(doc) {
  try { localStorage.setItem(TRACINGS_KEY, JSON.stringify(doc)) }
  catch { /* quota — the in-memory snapshot stays authoritative for the session */ }
}

// Tracings have their OWN stable snapshot + subscription (mirrors the per-sym one),
// so a Phase-1 useTracings() hook is a thin useSyncExternalStore adapter.
let _tracingsSnapshot = null
const _tracingSubs = new Set()

function _buildTracingsSnapshot(doc) {
  return {
    tracings: doc.tracings.map((t) => ({ ...t })),
    activeId: doc.activeId,
    visibleIds: [...doc.visibleIds],
  }
}

function _tracingsSnap() {
  if (!_tracingsSnapshot) _tracingsSnapshot = _buildTracingsSnapshot(_ensureDoc())
  return _tracingsSnapshot
}

function _commitDoc(doc) {
  _saveDoc(doc)
  _tracingsSnapshot = _buildTracingsSnapshot(doc)
  _tracingSubs.forEach((cb) => { try { cb() } catch { /* one bad subscriber never breaks the rest */ } })
  _bumpAny()
}

// ── Tracings read API ────────────────────────────────────────────────────────
export function getTracingsSnapshot() { return _tracingsSnap() }
export function subscribeTracings(cb) {
  _tracingSubs.add(cb)
  return () => { _tracingSubs.delete(cb) }
}
export function listTracings() { return _tracingsSnap().tracings }
export function getActiveTracingId() { return _tracingsSnap().activeId }
export function getVisibleTracingIds() { return _tracingsSnap().visibleIds }

// ── Tracings meta mutations ──────────────────────────────────────────────────
// Phase 0 ships the SAFE subset only: these touch tracing META (name/color/order/
// visibility) + the archive, NEVER the ACTIVE sheet's live drawings or the per-sym
// registry, so no entry invalidation is required. setActiveTracing + deleteTracing
// are Phase 1: they swap STORAGE_KEY and must invalidate mounted entries, wired
// alongside the multi-sheet overlay render.
export function createTracing(opts = {}) {
  const doc = _ensureDoc()
  const id = crypto.randomUUID()
  const order = doc.tracings.length
  const color = opts.color || TRACING_PALETTE[order % TRACING_PALETTE.length]
  const name = typeof opts.name === 'string' ? opts.name.trim().slice(0, 60) : ''
  doc.tracings = [...doc.tracings, { id, name, color, order }]
  _commitDoc(doc)
  return id
}

export function renameTracing(id, name) {
  const doc = _ensureDoc()
  if (!doc.tracings.some((t) => t.id === id)) return
  const nm = typeof name === 'string' ? name.slice(0, 60) : ''
  doc.tracings = doc.tracings.map((t) => (t.id === id ? { ...t, name: nm } : t))
  _commitDoc(doc)
}

export function recolorTracing(id, color) {
  if (typeof color !== 'string' || !color) return
  const doc = _ensureDoc()
  if (!doc.tracings.some((t) => t.id === id)) return
  doc.tracings = doc.tracings.map((t) => (t.id === id ? { ...t, color } : t))
  _commitDoc(doc)
}

export function reorderTracings(orderedIds) {
  if (!Array.isArray(orderedIds)) return
  const doc = _ensureDoc()
  const byId = new Map(doc.tracings.map((t) => [t.id, t]))
  const next = []
  orderedIds.forEach((id) => { if (byId.has(id)) { next.push(byId.get(id)); byId.delete(id) } })
  // Any tracing not named in orderedIds keeps its relative order, appended at the end.
  doc.tracings.forEach((t) => { if (byId.has(t.id)) next.push(t) })
  doc.tracings = next.map((t, i) => ({ ...t, order: i }))
  _commitDoc(doc)
}

export function setTracingVisible(id, visible) {
  const doc = _ensureDoc()
  if (!doc.tracings.some((t) => t.id === id)) return
  const set = new Set(doc.visibleIds)
  if (visible) set.add(id); else set.delete(id)
  // The active sheet stays visible (single-sheet render floor); preserve order.
  set.add(doc.activeId)
  doc.visibleIds = doc.tracings.filter((t) => set.has(t.id)).map((t) => t.id)
  _commitDoc(doc)
}

// ── Active-switch + delete (the ops that move drawing data) ──────────────────
// Reload every MOUNTED sym's entry from an authoritative active-slot map, dropping
// per-sym undo/redo history, and notify — so mounted charts repaint on the new
// sheet. Takes the map IN MEMORY (not a disk re-read) so a failed STORAGE_KEY write
// (quota) can't desync the live session from what the user sees.
function _reloadAllEntriesFrom(activeMap) {
  for (const [sym, e] of _entries) {
    e.drawings = activeMap[sym] || []
    e.past = []
    e.future = []
    e.snapshot = _buildSnapshot(e)
    _notify(sym)
  }
}

// Make `id` the active sheet. The active sheet's drawings live in STORAGE_KEY, so
// this SWAPS: the outgoing sheet is archived, the incoming sheet's archived data is
// promoted into STORAGE_KEY. Writes the doc (durable archive) BEFORE STORAGE_KEY so
// the microsecond gap between two synchronous writes can only mis-DISPLAY a sheet
// until the next switch — never lose the archive.
export function setActiveTracing(id) {
  const doc = _ensureDoc()
  if (id === doc.activeId) return
  if (!doc.tracings.some((t) => t.id === id)) return
  const outgoing = loadAll()                                  // current active sym→drawings
  const incoming = (doc.archive && doc.archive[id]) || {}
  doc.archive = { ...(doc.archive || {}), [doc.activeId]: outgoing }
  doc.activeId = id
  const vis = new Set(doc.visibleIds); vis.add(id)
  doc.visibleIds = doc.tracings.filter((t) => vis.has(t.id)).map((t) => t.id)
  _commitDoc(doc)                                             // write #1 — durable archive + meta
  saveAll(incoming)                                           // write #2 — new active slot
  _reloadAllEntriesFrom(incoming)                             // repaint mounted charts
}

// Delete a sheet. Never removes the last one. Deleting the ACTIVE sheet discards its
// live drawings (that IS the delete) and promotes a fallback into the active slot.
export function deleteTracing(id) {
  const doc = _ensureDoc()
  if (doc.tracings.length <= 1) return                        // always keep one sheet
  if (!doc.tracings.some((t) => t.id === id)) return
  const deletingActive = id === doc.activeId
  doc.tracings = doc.tracings.filter((t) => t.id !== id).map((t, i) => ({ ...t, order: i }))
  const nextArchive = { ...(doc.archive || {}) }; delete nextArchive[id]
  doc.archive = nextArchive
  doc.visibleIds = doc.visibleIds.filter((x) => x !== id)
  if (deletingActive) {
    const fallback = doc.tracings[0].id
    const incoming = (doc.archive && doc.archive[fallback]) || {}
    doc.activeId = fallback
    if (!doc.visibleIds.includes(fallback)) doc.visibleIds = [fallback, ...doc.visibleIds]
    _commitDoc(doc)
    saveAll(incoming)
    _reloadAllEntriesFrom(incoming)
  } else {
    if (!doc.visibleIds.length) doc.visibleIds = [doc.activeId]
    _commitDoc(doc)
  }
}

/** Coverage counts for a tracing — how many symbols carry marks and the total
 *  number of drawings across all of them. Powers the panel's "233 syms" line.
 *  Side-effect free. */
export function tracingStats(tracingId) {
  const doc = _ensureDoc()
  const map = tracingId === doc.activeId ? loadAll() : ((doc.archive && doc.archive[tracingId]) || {})
  let syms = 0
  let drawings = 0
  for (const k in map) {
    const arr = map[k]
    if (Array.isArray(arr) && arr.length) { syms += 1; drawings += arr.length }
  }
  return { syms, drawings }
}

/** Capture-time peek at ONE tracing's drawings for a sym (used by the Phase-1b
 *  multi-sheet ghost render). Side-effect free; returns a deep copy. Reads the
 *  active sheet from STORAGE_KEY and any other sheet from the doc archive. */
export function peekTracingDrawings(tracingId, sym) {
  if (!sym || !tracingId) return []
  try {
    const doc = _ensureDoc()
    const src = tracingId === doc.activeId ? loadAll() : ((doc.archive && doc.archive[tracingId]) || {})
    const arr = src[sym]
    return Array.isArray(arr) ? JSON.parse(JSON.stringify(arr)) : []
  } catch { return [] }
}

// ── Cross-device sync surface (Phase 2) ──────────────────────────────────────
// The sync layer (useTracingsSync) needs (1) a single "anything changed" signal to
// debounce a push on, and (2) whole-state export/import to move the full set of
// sheets between this browser and the server. USER mutations funnel through _commit
// (drawings), the undo/redo/snapshot paths, and _commitDoc (sheet meta), so
// _bumpAny() is called at exactly those points — never on a sync-IN import, so
// adopting the server copy can't echo straight back as a push.
let _changeSeq = 0
const _anySubs = new Set()
function _bumpAny() {
  _changeSeq += 1
  _anySubs.forEach((cb) => { try { cb() } catch { /* one bad subscriber never breaks the rest */ } })
}
export function subscribeAnyChange(cb) { _anySubs.add(cb); return () => { _anySubs.delete(cb) } }
export function getChangeSeq() { return _changeSeq }

/** Is there any user-created tracing content in THIS browser? (a drawing on any
 *  sheet, or more than the single default sheet). Lets the sync layer avoid
 *  clobbering a device that has local work when it first meets an empty server. */
export function hasLocalTracingContent() {
  const doc = _loadDoc()
  if (doc && doc.tracings.length > 1) return true
  const hasDraw = (m) => { for (const k in m) { if (Array.isArray(m[k]) && m[k].length) return true } return false }
  if (hasDraw(loadAll())) return true
  if (doc && doc.archive) { for (const id in doc.archive) { if (hasDraw(doc.archive[id])) return true } }
  return false
}

/** Serialize ALL tracings (meta + every sheet's drawings) into one plain object for
 *  server storage. The active sheet's data (STORAGE_KEY) is folded into
 *  byTracing[activeId] so the blob is a complete, self-contained snapshot. */
export function exportTracings() {
  const doc = _ensureDoc()
  const byTracing = { ...(doc.archive || {}) }
  byTracing[doc.activeId] = loadAll()
  return {
    v: doc.v || 1,
    tracings: doc.tracings.map((t) => ({ ...t })),
    activeId: doc.activeId,
    visibleIds: [...doc.visibleIds],
    byTracing,
  }
}

/** Replace ALL local tracings with a server blob (shape from exportTracings). Splits
 *  it back into the two-key storage, reloads every mounted chart's entry, and
 *  refreshes the tracings snapshot. No-ops on a malformed blob. Does NOT bump the
 *  change signal — a sync-IN must not trigger a push back out. */
export function importTracings(blob) {
  if (!blob || !Array.isArray(blob.tracings) || blob.tracings.length === 0) return
  if (!blob.byTracing || typeof blob.byTracing !== 'object') return
  const tracings = blob.tracings
    .filter((t) => t && t.id)
    .map((t, i) => ({
      id: t.id,
      name: typeof t.name === 'string' ? t.name : '',
      color: (typeof t.color === 'string' && t.color) ? t.color : TRACING_PALETTE[i % TRACING_PALETTE.length],
      order: i,
    }))
  if (!tracings.length) return
  let activeId = blob.activeId
  if (!tracings.some((t) => t.id === activeId)) activeId = tracings[0].id
  const valid = new Set(tracings.map((t) => t.id))
  const vis = new Set((Array.isArray(blob.visibleIds) ? blob.visibleIds : []).filter((id) => valid.has(id)))
  vis.add(activeId)
  const visibleIds = tracings.filter((t) => vis.has(t.id)).map((t) => t.id)
  const okMap = (m) => (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}
  const activeMap = okMap(blob.byTracing[activeId])
  const archive = {}
  for (const t of tracings) {
    if (t.id === activeId) continue
    const m = blob.byTracing[t.id]
    if (m && typeof m === 'object' && !Array.isArray(m)) archive[t.id] = m
  }
  const doc = { v: blob.v || 1, tracings, activeId, visibleIds, archive }
  saveAll(activeMap)                    // STORAGE_KEY = active sheet
  _saveDoc(doc)
  _tracingsSnapshot = _buildTracingsSnapshot(doc)
  _reloadAllEntriesFrom(activeMap)      // repaint mounted charts
  _tracingSubs.forEach((cb) => { try { cb() } catch { /* */ } })
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
  _tracingsSnapshot = null
  _tracingSubs.clear()
  _changeSeq = 0
  _anySubs.clear()
}

export function _setSyncNotify(v) { _syncNotify = !!v }
