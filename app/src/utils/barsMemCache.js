import { mergeMonotonic } from './barsMerge'
// Synchronous in-memory LRU cache of chart bars, keyed by `${SYM}_${TF}`.
// This is the FAST layer in front of IndexedDB: a switch to a (sym, tf) that's
// in here paints in the SAME synchronous frame — no async idbGet hop, no
// spinner flash. IDB stays the durable layer; this map is wiped on reload by
// design (a small, hot, recency-bounded working set).
// 200 (was 60): the watchlist scan-warm promotes ±6 neighbors × 5 TFs (~60
// entries) around the selection — at 60 the promotion itself LRU-evicted the
// rest of the working set. First-paint entries are ~600 bars (~50KB), so 200
// entries stays around ~10MB worst-case.
// ⛔ (2026-11-20) THAT WORST CASE WAS NO LONGER TRUE: the BarStore's persist writes every
// server-backed snapshot here at its FULL depth, and an intraday key holds up to 50,000 lake bars.
// Production soak, 30 flips: 114 entries, 1.23M rows, nearly all a second copy of what the store
// itself holds. So a ROW budget too: over MEM_CACHE_MAX_ROWS the least recently used entries go
// (never the one just written). 500,000 rows keep the watchlist's warm working set (±6 neighbours
// × 5 timeframes of ~600 bars) plus about ten deep histories.
const MEM_CACHE_MAX = 200
const MEM_CACHE_MAX_ROWS = 500_000
let _maxRows = MEM_CACHE_MAX_ROWS
const _map = new Map() // insertion-ordered; delete+set marks most-recently-used
let _rows = 0

function _key(sym, tf) {
  return `${String(sym || '').toUpperCase()}_${tf}`
}

export function memGet(sym, tf) {
  if (!sym || !tf) return null
  const k = _key(sym, tf)
  const entry = _map.get(k)
  if (!entry) return null
  _map.delete(k)        // re-insert at the end → mark MRU
  _map.set(k, entry)
  return entry.bars
}

// Like memGet but does NOT reorder (no MRU promotion). Safe to call during
// render — it's a pure read with no observable mutation.
export function memPeek(sym, tf) {
  if (!sym || !tf) return null
  const entry = _map.get(_key(sym, tf))
  return entry ? entry.bars : null
}

/** When this browser cached `sym`/`tf`, epoch ms — null when absent. */
export function memPeekSavedAt(sym, tf) {
  if (!sym || !tf) return null
  const entry = _map.get(_key(sym, tf))
  return entry && Number.isFinite(entry.savedAt) ? entry.savedAt : null
}

export function memHas(sym, tf) {
  if (!sym || !tf) return false
  return _map.has(_key(sym, tf))
}

export function memPut(sym, tf, bars, { savedAt, meta } = {}) {
  if (!sym || !tf || !bars?.length) return
  const k = _key(sym, tf)
  if (_map.has(k)) { _rows -= _map.get(k).bars.length; _map.delete(k) }
  // `savedAt`: when the set was WRITTEN from the server. The bars carry no source
  // timestamp, so the daily paint gate ("is today's bar current, or merely
  // today-dated?" and "was it written after the close?") has nothing else to ask.
  // ⛔ A caller PROMOTING an existing set (IDB → mem) must pass that set's own
  // `savedAt`: stamping the promotion time would make an 11:00 set read as written
  // at 18:00, i.e. as holding the sealed close. Fresh-from-server callers omit it.
  // A promoted set whose own stamp is missing is stored as UNKNOWN (null), never now.
  const stamp = savedAt === undefined ? Date.now()
    : (Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null)
  // `meta`: the BarStore's provenance envelope (data/barStore/persist.js). Only the writer
  // that passes it keeps it — every other write replaces the record WITHOUT it, so a set
  // another writer touched never carries a stale seal claim.
  _map.set(k, { bars, lastTs: bars[bars.length - 1]?.t ?? null, savedAt: stamp, ...(meta ? { meta } : {}) })
  _rows += bars.length
  while (_map.size > 1 && (_map.size > MEM_CACHE_MAX || _rows > _maxRows)) {
    const [oldK, oldE] = _map.entries().next().value   // least-recently-used (oldest)
    _map.delete(oldK)
    _rows -= oldE.bars.length
  }
}

/** The monotonic twin of memPut (see barsIDB `mergeMonotonic`): merges `bars` into the
 *  entry held NOW so a background writer can never move it backwards or shallower. */
// `startedAt`: when the incoming request BEGAN — a held set written after that is newer on
// an equal tail (see mergeMonotonic `curIsNewer`).
export function memPutMonotonic(sym, tf, bars, { savedAt, delta = false, startedAt = null, meta = null } = {}) {
  if (!sym || !tf || !bars?.length) return null
  const cur = _map.get(_key(sym, tf))
  const curIsNewer = Number.isFinite(startedAt) && Number.isFinite(cur?.savedAt) && cur.savedAt > startedAt
  const next = mergeMonotonic(cur?.bars ?? null, bars, { delta, curIsNewer })
  if (next && next === cur?.bars && meta) cur.meta = meta   // same rows, newer provenance
  if (!next?.length || next === cur?.bars) return next ?? null
  // The stamp follows the source that supplied the tail BAR: the incoming set's own
  // (`savedAt`, or now when it is fresh from the server), else the held entry's.
  const incomingWins = next[next.length - 1] === bars[bars.length - 1]
  memPut(sym, tf, next, { ...(incomingWins ? (savedAt === undefined ? {} : { savedAt }) : { savedAt: cur?.savedAt ?? null }), meta })
  return next
}

/** The whole held record `{bars, savedAt, meta}` (no MRU promotion), or null. The BarStore's
 *  hydrate reads its provenance envelope through this. */
export function memPeekEntry(sym, tf) {
  if (!sym || !tf) return null
  const e = _map.get(_key(sym, tf))
  return e ? { bars: e.bars, savedAt: e.savedAt ?? null, meta: e.meta ?? null } : null
}

export function memClear() {
  _map.clear()
  _rows = 0
  _maxRows = MEM_CACHE_MAX_ROWS
}

/** Test-only: the held entries and rows; and a smaller row budget (memClear restores it). */
export function _memStats() { return { entries: _map.size, rows: _rows } }
export function _setMemMaxRowsForTests(n) { _maxRows = n }

export { MEM_CACHE_MAX, MEM_CACHE_MAX_ROWS }
