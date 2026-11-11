// app/src/data/barStore/persist.js — the BarStore's ONLY reader/writer of the bar caches
// (P2b; docs/architecture/barstore.md §Persist).
//
// ⭐ ONE WRITE PATH, NOT A PARALLEL ONE. Every write goes through the existing monotonic
// writers — barsMemCache.memPutMonotonic and barsIDB.idbPutMonotonic — so the one write rule
// (barsMerge.mergeMonotonic, #1095) and the one readability rule (barsIDB._entryReadable)
// apply to the store exactly as to every other writer. Rows are written in the cache's
// legacy shape ({t,o,h,l,c,v}; D/W/M `t` = 'YYYY-MM-DD'), so every legacy reader keeps
// reading them unchanged.
//
// ⭐ WHEN: only on a `baseRev` change (closed rows / seal / identity — never a developing-bar
// tick), only for a server-backed snapshot (`restSeen`: a copy that came FROM the cache is
// never written back — re-stamping its savedAt would keep a stale set alive past the
// readers' age rules), debounced (PERSIST_DEBOUNCE_MS) and then run at idle, ≤1 write in
// flight per key. Windowed (`@to=`) keys are replay slices and are never persisted.
//
// ⭐ PROVENANCE (S8: hydrate ∘ persist = base, seals included). Next to the rows each write
// stores a `meta` envelope: cache_key, grid, history_rev, series_rev, complete_through,
// verified_through, the sealed spans, gen, and a per-row fingerprint of every SEALED row.
// Invalidation rules — a claim can never outlive the rows it was made about:
//   • any write by another writer replaces the record WITHOUT meta (barsMemCache / barsIDB);
//   • on hydrate a span is restored only where the stored rows inside it are EXACTLY the
//     rows the store sealed (same set of `t`, same fingerprint) — a row another writer
//     merged in, changed or dropped cuts that span; spans are clipped to the stored depth;
//   • the reducer then refuses the copy whole on another key / cache_key / older history_rev
//     / stale gen (S7, staleReason), and a server row always replaces a non-sealed local one.
// The developing bar is NOT persisted (it is live state; the base is).

import { memPutMonotonic, memPeekEntry } from '../../utils/barsMemCache'
import { idbPutMonotonic, idbGet, idbImportPack } from '../../utils/barsIDB'
import { ACTION, parseKey, isDateTf, unixToDateLabel, keyOf } from './types'
import { isSealedRow, bucketEnd, normT } from './reducer'

export const PERSIST_DEBOUNCE_MS = 1000
export const META_VERSION = 1

const finite = (x) => typeof x === 'number' && Number.isFinite(x)

/** 32-bit FNV-1a fingerprint of a row's values (never its time). */
export function rowHash(b) {
  const s = `${+b.o}|${+b.h}|${+b.l}|${+b.c}|${+(b.v ?? 0)}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}

/** Snapshot → the cache's legacy row shape (closed rows only). */
export function toCacheRows(s) {
  const date = isDateTf(s.tf)
  return s.bars.map((b) => ({ t: date ? unixToDateLabel(b.t) : b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
}

/** The provenance envelope of snapshot `s`. */
export function encodeMeta(s) {
  const sealedT = [], sealedH = []
  for (const b of s.bars) if (isSealedRow(s, b)) { sealedT.push(b.t); sealedH.push(rowHash(b)) }
  return {
    v: META_VERSION, key: s.key, cacheKey: s.cacheKey, grid: s.grid,
    historyRev: s.historyRev, seriesRev: s.seriesRev,
    completeThrough: s.completeThrough, verifiedThrough: s.verifiedThrough,
    spans: (s.sealedSpans || []).map(([a, c]) => [a, c]), gen: s.gen,
    sealed: { t: sealedT, h: sealedH },
  }
}

/**
 * A stored record ({bars, meta?}) → the reducer payload of a mem-hit / idb-hit for `key`.
 * Without a valid envelope it is a plain local copy (rows only). With one, the identity
 * fields always ride along (the reducer checks them) and every span that still describes
 * exactly the stored rows is restored with `complete_through` capped to the surviving seals.
 */
export function decodeEntry(key, entry) {
  const bars = entry?.bars || []
  const m = entry?.meta
  const p = parseKey(key)
  if (!p || !m || m.v !== META_VERSION || m.key !== key) return { bars }
  const out = { bars, cache_key: m.cacheKey ?? null, history_rev: m.historyRev ?? null, series_rev: m.seriesRev ?? null }
  if (m.grid != null) out.grid = m.grid
  if (m.verifiedThrough != null) out.verified_through = m.verifiedThrough
  if (m.cacheKey == null || m.historyRev == null || !Array.isArray(m.spans) || !m.spans.length) return out

  const st = { key, tf: p.tf, grid: m.grid ?? null }
  const stored = new Map()
  for (const r of bars) { const t = normT(r.t, p.tf); if (finite(t)) stored.set(t, r) }
  const times = [...stored.keys()].sort((a, b) => a - b)
  if (!times.length) return out
  const first = times[0]
  const sealedT = m.sealed?.t || [], sealedH = m.sealed?.h || []
  const want = new Map(sealedT.map((t, i) => [t, sealedH[i]]))
  const kept = []
  for (const sp of m.spans) {
    if (!Array.isArray(sp) || !finite(sp[0]) || !finite(sp[1])) continue
    const a = Math.max(sp[0], first), c = sp[1]
    if (c <= a) continue
    const inSpan = (t) => t >= a && bucketEnd(t, st) <= c
    const have = times.filter(inSpan)
    const need = sealedT.filter(inSpan)
    if (!have.length || have.length !== need.length) continue
    let ok = true
    for (let i = 0; i < have.length && ok; i++) {
      ok = have[i] === need[i] && want.get(have[i]) === rowHash(stored.get(have[i]))
    }
    if (ok) kept.push([a, c])
  }
  if (!kept.length) return out
  out.sealed_spans = kept
  const maxEnd = Math.max(...kept.map((s) => s[1]))
  out.complete_through = finite(m.completeThrough) ? Math.min(m.completeThrough, maxEnd) : maxEnd
  return out
}

const _defaultIdle = (fn) => {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(fn, { timeout: 2000 })
  return setTimeout(fn, 0)
}

/**
 * @param {object} o
 * @param {ReturnType<import('./registry').createRegistry>} o.registry
 * @param {object} [o.io]   the cache functions (tests inject; default = the real modules)
 * @param {number} [o.debounceMs]
 * @param {(fn:Function)=>any} [o.idle]
 * @param {() => number} [o.now]
 */
export function createPersist({
  registry, io = null, debounceMs = PERSIST_DEBOUNCE_MS, idle = _defaultIdle, now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h),
} = {}) {
  const IO = { memPutMonotonic, memPeekEntry, idbPutMonotonic, idbGet, idbImportPack, ...(io || {}) }
  /** key → { refs, unsub, written (baseRev), timer, writing, again, changedAt } */
  const watched = new Map()

  function _changed(key, s) {
    const w = watched.get(key)
    if (!w || !s.restSeen || !s.bars.length || s.baseRev === w.written) return
    w.changedAt = now()
    if (w.writing) { w.again = true; return }
    if (w.timer != null) clearTimer(w.timer)
    w.timer = setTimer(() => { w.timer = null; idle(() => { _write(key) }) }, debounceMs)
  }

  async function _write(key) {
    const w = watched.get(key)
    const s = registry.peek(key)
    if (!w || !s || !s.restSeen || !s.bars.length || s.baseRev === w.written) return
    const p = parseKey(key)
    w.writing = true
    const rev = s.baseRev
    try {
      const rows = toCacheRows(s)
      const meta = encodeMeta(s)
      const opts = { startedAt: w.changedAt ?? now(), meta }
      IO.memPutMonotonic(p.sym, p.cacheTf, rows, opts)
      await IO.idbPutMonotonic(p.sym, p.cacheTf, rows, opts)
      w.written = rev
    } catch { /* best-effort: the caches are derived data */ }
    w.writing = false
    if (w.again) { w.again = false; const cur = registry.peek(key); if (cur) _changed(key, cur) }
  }

  function detach(key) {
    const w = watched.get(key)
    if (!w) return
    if (--w.refs > 0) return
    // A pending write still lands (the snapshot is server-backed); nothing new is watched.
    if (w.timer != null) { clearTimer(w.timer); w.timer = null; _write(key) }
    w.unsub?.()
    watched.delete(key)
  }

  return {
    /** Start persisting `key` (refcounted). Returns its detach function. */
    attach(key) {
      const p = parseKey(key)
      if (!p || p.window) return () => {}
      let w = watched.get(key)
      if (!w) {
        w = { refs: 0, unsub: null, written: null, timer: null, writing: false, again: false, changedAt: null }
        watched.set(key, w)
        w.unsub = registry.subscribe(key, (s) => _changed(key, s))
        _changed(key, registry.getSnapshot(key))
      }
      w.refs++
      let done = false
      return () => { if (done) return; done = true; detach(key) }
    },
    detach,
    /** Write every pending key now (page hide / tests). */
    async flush() {
      const keys = [...watched.keys()]
      for (const k of keys) { const w = watched.get(k); if (w?.timer != null) { clearTimer(w.timer); w.timer = null } }
      await Promise.all(keys.map((k) => _write(k)))
    },
    /**
     * Hydrate `key` from the caches: the mem record first (same frame), then IDB. Each hit is
     * dispatched with the gen it was read under, so a hit that lands after an invalidate is
     * dropped by the reducer.
     */
    async hydrate(key) {
      const p = parseKey(key)
      if (!p || p.window) return registry.getSnapshot(key)
      const gen = registry.getSnapshot(key).gen
      const m = IO.memPeekEntry(p.sym, p.cacheTf)
      if (m?.bars?.length) registry.dispatch(key, { type: ACTION.MEM_HIT, key, gen, payload: decodeEntry(key, m) })
      let e = null
      try { e = await IO.idbGet(p.sym, p.cacheTf) } catch { e = null }
      if (e?.bars?.length) registry.dispatch(key, { type: ACTION.IDB_HIT, key, gen, payload: decodeEntry(key, e) })
      return registry.peek(key)
    },
    /**
     * Pack import facade: the universe/intraday pack lands through barsIDB.idbImportPack
     * (its keep-local rule unchanged); every entry whose key the registry holds is also
     * seeded into its store (`seed-from-pack`).
     */
    async importPack(entries, opts) {
      const res = await IO.idbImportPack(entries, opts)
      for (const e of entries || []) {
        if (!e?.sym || !e?.tf || !e?.bars?.length) continue
        let key
        try { key = keyOf({ sym: e.sym, tf: e.tf, session: String(e.tf) === '60e' ? 'eth' : 'rth' }) } catch { continue }
        if (registry.has(key)) registry.dispatch(key, { type: ACTION.SEED_FROM_PACK, key, payload: { bars: e.bars } })
      }
      return res
    },
    /** Test / diagnostics. */
    stats() { return { watched: watched.size, writing: [...watched.values()].filter((w) => w.writing).length } },
  }
}
