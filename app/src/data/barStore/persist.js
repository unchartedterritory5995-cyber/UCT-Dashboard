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
//
// ⭐ DEEP HISTORY (`@hist`, P3-S1 review fix 6). The tail record is capped (barsIDB
// INTRADAY_MAX_BARS = historyPrepend TAIL_ENTRY_MAX_BARS); an intraday series deeper than that
// (scroll-back windows, the background window prefetch) ALSO writes the deep-history segment
// through the same one write path (`idbPutHistory` → idbPutMonotonic segment 'history'), when the
// held history GREW past what the segment holds or the tail is about to outrun it
// (historyLagsTail) — never on every poll. Hydrate reads it after the tail and hands it to the
// reducer as a `history` copy: prepend-only, only when it reaches the held oldest bar on the same
// basis. Invalidation: barsIDB's (logic version, 60m grid, age) + idbDelete; P4: the segment
// carries its own STAMP (cache_key, history_rev, adj_basis — `histStamp`), so the reducer refuses
// it on another row series / history / basis exactly like a tail copy (S8), and an unstamped
// (legacy) segment only on a proven basis (`basisVerdict`); a write under another stamp replaces
// the segment (barsIDB). An interior hole is cut on hydrate (`_newestInteriorHoleEnd`): only the
// run that reaches the tail is handed over.
//
// ⭐ HOLES. A hydrated copy reports its interior hole (barsIDB `_intradayGapStart`: idbGet's
// `repairFromT`, or the same function over the mem record) as `repair_from`; the reducer turns a
// hole older than the next delta's start into a FULL read (it would never be re-read).

import { memPutMonotonic, memPeekEntry } from '../../utils/barsMemCache'
import {
  idbPutMonotonic, idbGet, idbImportPack, idbPutHistory, idbGetHistory, idbGetHistoryEntry,
  _intradayGapStart, _newestInteriorHoleEnd,
} from '../../utils/barsIDB'
import { TAIL_ENTRY_MAX_BARS, HIST_PERSIST_MAX_BARS, historyLagsTail } from '../../utils/historyPrepend'
import { ACTION, parseKey, isDateTf, isIntradayTf, unixToDateLabel, keyOf } from './types'
import { isSealedRow, bucketEnd, normT } from './reducer'
import { deviceSource as _defaultDeviceSource } from '../deviceStore/source'

export const PERSIST_DEBOUNCE_MS = 1000
export const META_VERSION = 1
/** How long a hydrate waits, after its saved-copy reads, for an on-device read still in flight (a
 *  ready device store answers in ~1 ms; a later answer still lands, it just does not hold the caller). */
export const DEVICE_HYDRATE_WAIT_MS = 8

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
    historyRev: s.historyRev, seriesRev: s.seriesRev, adjBasis: s.adjBasis ?? null,
    completeThrough: s.completeThrough, verifiedThrough: s.verifiedThrough,
    spans: (s.sealedSpans || []).map(([a, c]) => [a, c]), gen: s.gen,
    sealed: { t: sealedT, h: sealedH },
  }
}

/** The `@hist` segment's stamp: the identity of the rows it holds (never seals). */
export function histStamp(s) {
  return { v: META_VERSION, key: s.key, cacheKey: s.cacheKey ?? null, historyRev: s.historyRev ?? null, adjBasis: s.adjBasis ?? null }
}

/** A `@hist` record's stamp → the identity fields of its reducer payload ({} when absent). */
export function decodeHistStamp(key, m) {
  if (!m || m.v !== META_VERSION || m.key !== key) return {}
  return { cache_key: m.cacheKey ?? null, history_rev: m.historyRev ?? null, adj_basis: m.adjBasis ?? null }
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
  const out = { bars, cache_key: m.cacheKey ?? null, history_rev: m.historyRev ?? null, series_rev: m.seriesRev ?? null,
    adj_basis: m.adjBasis ?? null }
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
 * @param {object|null} [o.device]  the on-device bar store (deviceStore/source: {peek, read}); default
 *   = the app's, which is null while its switch (localStorage 'uct.deviceStore') is off
 */
export function createPersist({
  registry, io = null, debounceMs = PERSIST_DEBOUNCE_MS, idle = _defaultIdle, now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h), device = undefined,
} = {}) {
  const IO = { memPutMonotonic, memPeekEntry, idbPutMonotonic, idbGet, idbImportPack, idbPutHistory, idbGetHistory, idbGetHistoryEntry, ...(io || {}) }
  // ⭐ THE ON-DEVICE COPY (data/deviceStore). A key with no mem record is also looked up in the device
  // store: synchronously in its recently-read cache (hydrateMem), else one worker read started BESIDE
  // the IndexedDB read (hydrate), dispatched the moment it lands. It is a LOCAL copy (DEVICE_HIT:
  // provisional / context, never persisted, the server's answer replaces or joins it under the
  // reducer's rules), so a symbol nobody opened in this browser paints without waiting on the server.
  const DEV = device === undefined ? _defaultDeviceSource() : device
  // (which cache-tfs it holds is the source's own answer: deviceStore/tfs.SERVED_TFS)
  const _devKey = (p) => !!DEV && !p.window
  /** May a device copy land on this entry? Nothing held, or only a device copy (no server answer):
   *  a device copy seeds an entry, or moves its own copy FORWARD (review of #2189: a copy warmed at
   *  09:35 must not paint its 09:35 bars at 15:55, so the switch re-reads it, refreshDevice). */
  const _deviceMay = (s) => !s || (!s.restSeen && ((!s.bars.length && !s.developing) || s.source === 'device'))
  /** key → `through` (unix s) of the device copy the entry holds: how far it is complete (deviceStore
   *  fresh.js / prefetch.devicePaints read it). Bounded, oldest out. */
  const devThrough = new Map()
  const _noteDev = (key, through) => {
    devThrough.delete(key)
    devThrough.set(key, Number.isFinite(through) ? through : null)
    if (devThrough.size > 1000) devThrough.delete(devThrough.keys().next().value)
  }
  /** Dispatch a device copy; true when it changed the entry. Its saved time is the moment it is complete
   *  up to (`savedAt`, from `through`): what every local-copy age rule reads, the daily gate included. */
  function _deviceHit(key, p, gen, got) {
    if (!got?.rows?.length) return false
    const before = registry.peek(key)
    if (!_deviceMay(before)) return false
    const held = devThrough.get(key)
    if (before?.source === 'device' && held != null && !(got.through > held)) return false   // not newer
    registry.dispatch(key, { type: ACTION.DEVICE_HIT, key, gen, payload: { sym: p.sym, bars: got.rows, saved_at: got.savedAt ?? null } })
    const after = registry.peek(key)
    if (after === before) return false
    if (after?.source === 'device') { _noteDev(key, got.through ?? null); _noteSaved(key, got.savedAt ?? null) }
    return true
  }
  /** key → {first, last} of the deep-history segment last written / read (bounded). */
  const hist = new Map()
  const _noteHist = (key, rows) => {
    hist.delete(key)
    if (rows?.length) hist.set(key, { first: rows[0].t, last: rows[rows.length - 1].t })
    if (hist.size > 1000) hist.delete(hist.keys().next().value)
  }
  /** key → { refs, unsub, written (baseRev), timer, writing, again, changedAt } */
  const watched = new Map()
  /** key → savedAt of the record the last hydrate read (bounded, oldest out). */
  const savedAt = new Map()
  const _noteSaved = (key, at) => {
    savedAt.delete(key)
    savedAt.set(key, Number.isFinite(at) ? at : null)
    if (savedAt.size > 1000) savedAt.delete(savedAt.keys().next().value)
  }

  function _changed(key, s) {
    const w = watched.get(key)
    if (!w || !s.restSeen || !s.bars.length || s.baseRev === w.written) return
    w.changedAt = now()
    if (w.writing) { w.again = true; return }
    if (w.timer != null) clearTimer(w.timer)
    w.timer = setTimer(() => { w.timer = null; idle(() => { _write(key) }) }, debounceMs)
  }

  /** THE write of one server-backed snapshot: mem synchronously, then IDB (monotonic both). */
  async function _put(key, s, startedAt) {
    const p = parseKey(key)
    const rows = toCacheRows(s)
    const opts = { startedAt, meta: encodeMeta(s) }
    IO.memPutMonotonic(p.sym, p.cacheTf, rows, opts)
    await IO.idbPutMonotonic(p.sym, p.cacheTf, rows, opts)
    // The deep-history segment: only for a series deeper than the capped tail record, and only
    // when its history grew past the segment or the tail is about to outrun it.
    if (isIntradayTf(p.tf) && rows.length > TAIL_ENTRY_MAX_BARS) {
      const h = hist.get(key)
      // At most the newest HIST_PERSIST_MAX_BARS: deeper rows (the lake's) come back from the HTTP
      // cache, and a whole 20,000-row series is a large structured clone on every growth.
      const seg = rows.length > HIST_PERSIST_MAX_BARS ? rows.slice(-HIST_PERSIST_MAX_BARS) : rows
      if (!h || seg[0].t < h.first || historyLagsTail(h.last, rows)) {
        const out = await IO.idbPutHistory(p.sym, p.cacheTf, seg, { meta: histStamp(s) })
        if (out?.length) _noteHist(key, out)
      }
    }
  }

  async function _write(key, wIn = null, sIn = null) {
    const w = wIn || watched.get(key)
    const s = sIn || registry.peek(key)
    if (!w || !s || !s.restSeen || !s.bars.length || s.baseRev === w.written) return
    w.writing = true
    const rev = s.baseRev
    try {
      await _put(key, s, w.changedAt ?? now())
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
    // ⛔ IN IDLE TIME, NEVER AT THE DETACH (2026-11-20, instant charts). A detach IS a symbol switch: the chart
    // leaving this key is the chart drawing the next one. Written here, the save (an IDB read, a merge of
    // thousands of rows in its onsuccess, a put that clones them: ~33 ms on a 60m series, measured) ran inside
    // that switch on every flip of a scan, because a scan flips faster than the debounce. The snapshot is taken
    // now, so the write is the same one; only when it runs moved.
    if (w.timer != null) {
      clearTimer(w.timer); w.timer = null
      const snap = registry.peek(key)
      idle(() => { _write(key, w, snap) })
    }
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
    /**
     * Write `key` once, now, when no subscriber's watcher owns it (an ensure / prefetch nobody
     * is subscribed to). The watcher's rule: server-backed snapshots only (restSeen, rows
     * held), never a windowed key. The mem half lands before this returns; the IDB half is
     * the returned promise. A watched key is left to its watcher (no double write).
     */
    writeOnce(key, { startedAt = null } = {}) {
      const p = parseKey(key)
      const s = registry.peek(key)
      if (!p || p.window || watched.has(key) || !s || !s.restSeen || !s.bars.length) return Promise.resolve(false)
      return _put(key, s, startedAt ?? now()).then(() => true, () => false)
    },
    /** savedAt of the cache record the last hydrate of `key` read (mem, else IDB; the device copy's
     *  `through` for a device hit), or null. */
    savedAtOf(key) { return savedAt.get(key) ?? null },
    /** `through` (unix s) of the device copy `key` holds, or null. */
    deviceThroughOf(key) { return devThrough.get(key) ?? null },
    /**
     * Bring a held DEVICE copy (no server answer yet) forward to the device's newest: synchronously
     * from the device's recent-read cache, else one worker read. The switch calls it on every peek of
     * such an entry (prefetch), so a copy warmed long ago is re-read before it is shown. Resolves true
     * when the entry moved.
     */
    refreshDevice(key) {
      const p = parseKey(key)
      if (!p || p.window || !_devKey(p) || !_deviceMay(registry.peek(key))) return Promise.resolve(false)
      const gen = registry.getSnapshot(key).gen
      try { if (_deviceHit(key, p, gen, DEV.peek(p.sym, p.cacheTf))) return Promise.resolve(true) } catch { /* optional */ }
      return Promise.resolve().then(() => DEV.read(p.sym, p.cacheTf)).then((got) => _deviceHit(key, p, gen, got)).catch(() => false)
    },
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
    /**
     * The SYNCHRONOUS half of `hydrate`: the mem record only. For a reader that already has an
     * entry holding no rows (a peek made it before a warmer promoted the key to the mem cache)
     * and must not start another pair of IDB reads to look again. Returns the mem entry or null.
     * With no mem record, an entry holding nothing also takes the on-device store's copy when its
     * recently-read cache has it (synchronous: a neighbour the warm already read paints this tick).
     */
    hydrateMem(key) {
      const p = parseKey(key)
      if (!p || p.window) return null
      const gen = registry.getSnapshot(key).gen
      const m = IO.memPeekEntry(p.sym, p.cacheTf)
      if (m?.bars?.length) {
        const repair = isIntradayTf(p.tf) ? _intradayGapStart(m.bars, p.cacheTf) : null
        registry.dispatch(key, { type: ACTION.MEM_HIT, key, gen, payload: { ...decodeEntry(key, m), saved_at: m.savedAt ?? null, repair_from: repair } })
        _noteSaved(key, m.savedAt)
      } else if (_devKey(p) && _deviceMay(registry.peek(key))) {
        try { _deviceHit(key, p, gen, DEV.peek(p.sym, p.cacheTf)) } catch { /* a device copy is optional */ }
      }
      return m?.bars?.length ? m : null
    },
    async hydrate(key) {
      const p = parseKey(key)
      if (!p || p.window) return registry.getSnapshot(key)
      const gen = registry.getSnapshot(key).gen
      const m = this.hydrateMem(key)
      // The on-device read leaves NOW, beside the IndexedDB read below, and lands when it lands (a
      // busy IndexedDB can take hundreds of ms; the device answers in ~1). Only for an entry that
      // holds no server answer and nothing but (at most) an older device copy.
      const dev = !m?.bars?.length && _devKey(p) && _deviceMay(registry.peek(key))
        ? Promise.resolve().then(() => DEV.read(p.sym, p.cacheTf)).then((got) => _deviceHit(key, p, gen, got)).catch(() => false)
        : null
      let e = null
      try { e = await IO.idbGet(p.sym, p.cacheTf) } catch { e = null }
      if (e?.bars?.length) {
        registry.dispatch(key, { type: ACTION.IDB_HIT, key, gen, payload: { ...decodeEntry(key, e), saved_at: e.savedAt ?? null, repair_from: e.repairFromT ?? null } })
        // IDB → mem promotion (the legacy warmers' `_promote`): the synchronous readers (the
        // handoff's mem fast path, useDayFacts) see a disk copy once it is hydrated. With its
        // OWN stamp and envelope, never now (every age rule still judges it by its write
        // time), and only when mem held nothing for the key.
        if (!m?.bars?.length) {
          try { IO.memPutMonotonic(p.sym, p.cacheTf, e.bars, { savedAt: e.savedAt ?? null, meta: e.meta ?? null }) } catch { /* derived */ }
          _noteSaved(key, e.savedAt)
        }
      }
      // The deep-history segment, after the tail (prepend-only; the reducer judges reach,
      // identity — cache_key / history_rev / adj_basis from its stamp — and basis). An interior
      // hole is cut here: only the run after the NEWEST hole (the one reaching the tail) goes in.
      if (isIntradayTf(p.tf)) {
        let h = null
        try {
          h = IO.idbGetHistoryEntry ? await IO.idbGetHistoryEntry(p.sym, p.cacheTf)
            : { bars: await IO.idbGetHistory?.(p.sym, p.cacheTf), meta: null }
        } catch { h = null }
        const all = h?.bars
        if (all?.length) {
          const cut = _newestInteriorHoleEnd(all, p.cacheTf)
          const rows = cut > 0 ? all.slice(cut) : all
          const before = registry.peek(key)
          registry.dispatch(key, { type: ACTION.IDB_HIT, key, gen, payload: { bars: rows, history: true, ...decodeHistStamp(key, h.meta) } })
          // Accepted ⇒ remember what the segment holds; refused (another history / basis, no
          // reach, a hole) ⇒ forget it, so the next write of a deep series re-writes it.
          if (registry.peek(key) !== before && cut === 0) _noteHist(key, all)
          else hist.delete(key)
        }
      }
      if (dev) await Promise.race([dev, new Promise((resolve) => setTimer(resolve, DEVICE_HYDRATE_WAIT_MS))])
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
