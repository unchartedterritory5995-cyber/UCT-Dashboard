// Synchronous in-memory LRU cache of chart bars, keyed by `${SYM}_${TF}`.
// This is the FAST layer in front of IndexedDB: a switch to a (sym, tf) that's
// in here paints in the SAME synchronous frame — no async idbGet hop, no
// spinner flash. IDB stays the durable layer; this map is wiped on reload by
// design (a small, hot, recency-bounded working set).
// 200 (was 60): the watchlist scan-warm promotes ±6 neighbors × 5 TFs (~60
// entries) around the selection — at 60 the promotion itself LRU-evicted the
// rest of the working set. First-paint entries are ~600 bars (~50KB), so 200
// entries stays around ~10MB worst-case.
const MEM_CACHE_MAX = 200
const _map = new Map() // insertion-ordered; delete+set marks most-recently-used

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

export function memPut(sym, tf, bars) {
  if (!sym || !tf || !bars?.length) return
  const k = _key(sym, tf)
  if (_map.has(k)) _map.delete(k)
  // `savedAt`: when THIS browser put the set here. The bars carry no source
  // timestamp, so a daily paint gate that needs to know "is today's bar current, or
  // merely today-dated?" has nothing else to ask. Additive — no reader is required
  // to care, and the one that does errs safe (real age is always >= this).
  _map.set(k, { bars, lastTs: bars[bars.length - 1]?.t ?? null, savedAt: Date.now() })
  while (_map.size > MEM_CACHE_MAX) {
    _map.delete(_map.keys().next().value) // evict least-recently-used (oldest)
  }
}

export function memClear() {
  _map.clear()
}

export { MEM_CACHE_MAX }
