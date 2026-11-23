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
import { deviceCopyFresh } from '../deviceStore/fresh'
import { deviceServesTf } from '../deviceStore/tfs'

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
  // ⛔ THE ONE GATE EVERY DEVICE READ OF THE STORE GOES THROUGH (hydrateMem, hydrate, refreshDevice, _deviceAgain): a
  // key whose cache-tf the device serves (deviceStore/tfs.SERVED_TFS: D and the intraday session grid). Never W or M
  // (review of #2537, H1: derived from the device's D window they lacked the period in progress and the depth): such a
  // key is never asked of the device, whatever source this store holds, and behaves exactly as with the store off.
  const _devKey = (p) => !!DEV && !p.window && deviceServesTf(p.cacheTf)
  /** Does the entry carry a stamp a save wrote (persist's envelope: identity, a seal, a completeness claim)? A
   *  saved answer of the BarStore's always does (the server sends cache_key, bar_contract.py). */
  const _stamped = (s) => s.cacheKey != null || s.historyRev != null || s.completeThrough != null
    || !!(s.sealedSpans && s.sealedSpans.length)
  const _empty = (s) => !s.bars.length && !s.developing
  /** A held LOCAL copy with no stamp and no forming bar: the store can read no claim off it. ⚠️ That is WIDER
   *  than "the pack's rows": it is the universe pack's rows read back from IndexedDB, the lake's newest bars,
   *  AND a full server answer a legacy writer saved without an envelope (utils/prefetchBars, useLegacyChartBars;
   *  barsIDB drops the envelope when another writer touches a record). Nothing here can tell those apart, so the
   *  join below is held to rules that are safe for all three (`_joinRefused`), not to a guess at which it is. */
  const _claimless = (s) => !s.restSeen && !s.developing && !_stamped(s)
  /** One device read of `p`'s key. `urgent` (the member's own ask: a key press, the chart on screen) goes ahead of
   *  every background read (deviceStore/client.js, TWO LANES); a warm passes nothing and waits its turn. */
  // `newerThan` (review of #2558, P4-L2): the `through` of the copy the entry holds, when the read is to bring it FORWARD:
  // the device client then never answers it from its recently-read cache with a copy no newer than that one.
  const _devRead = (p, urgent, newerThan = null) => {
    if (!Number.isFinite(newerThan)) return urgent === true ? DEV.read(p.sym, p.cacheTf, { urgent: true }) : DEV.read(p.sym, p.cacheTf)
    return DEV.read(p.sym, p.cacheTf, urgent === true ? { urgent: true, newerThan } : { newerThan })
  }
  /** Is a device READ worth making for this entry? Nothing held, only a device copy (it moves its own copy
   *  FORWARD: review of #2189, a copy warmed at 09:35 must not paint its 09:35 bars at 15:55), or a copy with no
   *  claim, which a FRESH device copy may join (`_joinRefused` decides when the copy is in hand). */
  const _deviceMay = (s) => !s || (!s.restSeen && (_empty(s) || s.source === 'device' || _claimless(s)))
  const _devEq = (a, b) => !!a && !!b && a.t === b.t && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v
  /**
   * ⭐ (2026-11-21) THE JOIN: a device copy landing on a held copy that is not its own. Every universe symbol holds
   * the daily pack's ~300 rows in IndexedDB once the pack is ingested, and that read answers in a few ms: it took
   * the key first (or joined the device copy a moment later, making the entry 'idb'), and the device copy was then
   * never consulted (devgates 2026-11-21: 3 of 14 typed switches painted from the device, the three made while the
   * pack was still being written). A device copy now joins such a copy under the reducer's bulk rules (applyLocal:
   * only where the rows they share prove one price basis, never across a hole), and the key is the device's.
   * Returns null when it may, else the rule that refuses (seeding an empty entry and the device moving its own
   * copy forward are not joins: null). ⛔ In the reducer an incoming local row REPLACES a held one of the same
   * bucket, and the merged entry is judged under the device's stamp, so a join is refused unless ALL of:
   *   answered  no server answer holds the key
   *   stamped   the held copy carries no stamp (a saved answer of the BarStore's: its own paint rule, may be deeper)
   *   forming   it holds no forming bar, or only the device's own (`ownDev`: a saved copy that joined a device
   *             copy mid-session leaves the device's forming bar in place); a saved copy's own forming bar is as
   *             old as its save
   *   not-fresh the device copy is fresh by its stamp (deviceStore/fresh.js): only then are its rows the ones to
   *             overwrite a held bucket with. A seed that stops short of its as-of close (engine 'seed-short') is
   *             never fresh, so its last row, caught while forming, can never replace a complete bucket the lake
   *             or the pack holds (review of #2407)
   *   held-newer the held copy's tail is not newer than the device copy's last row, so the merged tail IS the
   *             device's and every rule that reads the entry as the device's (status, fresh.js, the handoff's
   *             behind-the-clock rule) is reading the copy its stamp describes
   */
  function _joinRefused(before, p, got, ownDev) {
    if (!before) return null
    if (before.restSeen) return 'answered'
    if (_empty(before) || before.source === 'device') return null
    if (_stamped(before)) return 'stamped'
    if (before.developing && !_devEq(before.developing, ownDev)) return 'forming'
    if (!deviceCopyFresh(got.through, p.tf, now())) return 'not-fresh'
    const last = normT(got.rows[got.rows.length - 1].t, p.tf)
    const tail = Math.max(before.bars.length ? before.bars[before.bars.length - 1].t : -Infinity, before.developing ? before.developing.t : -Infinity)
    if (!(last >= tail)) return 'held-newer'
    return null
  }
  /** key → `through` (unix s) of the device copy the entry holds: how far it is complete (deviceStore
   *  fresh.js / prefetch.devicePaints read it). Bounded, oldest out. */
  const devThrough = new Map()
  const _noteDev = (key, through) => {
    devThrough.delete(key)
    devThrough.set(key, Number.isFinite(through) ? through : null)
    if (devThrough.size > 1000) devThrough.delete(devThrough.keys().next().value)
  }
  /** Dispatch a device copy; true when it changed the entry. Its saved time is the moment it is complete
   *  up to (`savedAt`, from `through`): what every local-copy age rule reads, the daily gate included.
   *  ⛔ THE STAMPS ARE WRITTEN BEFORE THE DISPATCH (2026-11-21). The registry wakes the key's subscribers INSIDE
   *  the dispatch, and the symbol handoff's waiter is one of them (prefetch.watch, the cold gates): it asks the
   *  device rule in that wake, the only one a switch gets before the server answers. Written after the dispatch,
   *  the rule read `through` as unknown, answered 'stale', and the copy that had just landed was never painted
   *  (devgates 2026-11-21, 0 of 28 with the watcher against 3 of 28 with the 25 ms poll it replaced). A copy the
   *  reducer refuses, or one that does not leave the key the device's, puts both stamps back as they were. */
  function _deviceHit(key, p, gen, got, ownDev = null) {
    // (`n`: the copy's row count without building its rows, deviceStore/source.js; a copy with no `n` has rows)
    if (!got || !(got.n ?? got.rows?.length)) return false
    const before = registry.peek(key)
    const held = devThrough.get(key)
    // What nearly every warm of a device-held key ends in. It reads no row: the count above is `got.n`, and for an
    // entry the device already holds `_joinRefused` returns before it reads one either. (The saving is the lazy
    // `rows` of deviceStore/source.js, not this check's place in the order.)
    if (before?.source === 'device' && held != null && !(got.through > held)) return false   // not newer
    if (_joinRefused(before, p, got, ownDev)) return false
    const was = { dev: devThrough.has(key), through: held, saved: savedAt.has(key), savedAt: savedAt.get(key) }
    _noteDev(key, got.through ?? null)
    _noteSaved(key, got.savedAt ?? null)
    // `forming_t`: the copy's last row is the bucket in progress (deviceStore/source.js `formingT`): the reducer files
    // it as the developing bar whatever the clock says, never as a closed bar (review of #2537, M1)
    const formingT = Number.isFinite(got.formingT) ? { forming_t: got.formingT } : null
    // `through`: the copy's stamp rides on the entry with its marker (reducer `deviceThrough`): what the first answer may
    // keep of the device's rows is what it vouches for (review of #2558, P4-L3)
    registry.dispatch(key, { type: ACTION.DEVICE_HIT, key, gen, payload: { sym: p.sym, bars: got.rows, saved_at: got.savedAt ?? null, through: got.through ?? null, ...formingT } })
    const after = registry.peek(key)
    if (after === before || after?.source !== 'device') {
      if (was.dev) _noteDev(key, was.through); else devThrough.delete(key)
      if (was.saved) _noteSaved(key, was.savedAt); else savedAt.delete(key)
    }
    return after !== before
  }
  /** A saved copy just landed on a key the device copy held: when it JOINED it (the entry is now 'idb' / 'mem'),
   *  the device copy is applied again, as a join (`_joinRefused`), so the key and its saved time stay the
   *  device's: synchronously from the device's recent-read cache, else by one read. `ownDev`: the forming bar the
   *  device copy had put there (mid-session), which is not the saved copy's. ⛔ Without this the chart's daily gate
   *  read the PACK's saved time for an entry the handoff had just committed as the device's, and refused it: a
   *  blank chart (review of #2407). A saved copy that REPLACED the device's rows (another price basis: reducer
   *  applyLocal) refuses the device copy again there, and the key stays the saved copy's. */
  function _deviceAgain(key, p, gen, ownDev, urgent = false) {
    const cur = registry.peek(key)
    if (!cur || cur.source === 'device' || !_devKey(p)) return
    let got = null
    try { got = DEV.peek(p.sym, p.cacheTf) } catch { got = null }
    if (got) { _deviceHit(key, p, gen, got, ownDev); return }
    Promise.resolve().then(() => _devRead(p, urgent)).then((g) => _deviceHit(key, p, gen, g, ownDev)).catch(() => {})
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
     * when the entry moved. `urgent`: the member's own ask (`_devRead`). `newer`: the device rule REFUSED the copy held
     * ('stale'): the read asks for one newer than it (`_devRead` newerThan), so the client's recently-read cache does not
     * answer with the copy just refused (review of #2558, P4-L2). One read per key in flight, whatever asks (the client).
     */
    refreshDevice(key, { urgent = false, newer = false } = {}) {
      const p = parseKey(key)
      if (!p || p.window || !_devKey(p) || !_deviceMay(registry.peek(key))) return Promise.resolve(false)
      const gen = registry.getSnapshot(key).gen
      try { if (_deviceHit(key, p, gen, DEV.peek(p.sym, p.cacheTf))) return Promise.resolve(true) } catch { /* optional */ }
      const held = newer === true ? devThrough.get(key) : null
      return Promise.resolve().then(() => _devRead(p, urgent, held)).then((got) => _deviceHit(key, p, gen, got)).catch(() => false)
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
      }
      // (after a mem record too: one that makes no claim, the pack's rows promoted from IndexedDB, is joined)
      if (_devKey(p) && _deviceMay(registry.peek(key))) {
        try { _deviceHit(key, p, gen, DEV.peek(p.sym, p.cacheTf)) } catch { /* a device copy is optional */ }
      }
      return m?.bars?.length ? m : null
    },
    async hydrate(key, { urgent = false } = {}) {
      const p = parseKey(key)
      if (!p || p.window) return registry.getSnapshot(key)
      const gen = registry.getSnapshot(key).gen
      const m = this.hydrateMem(key)
      // The on-device read leaves NOW, beside the IndexedDB read below, and lands when it lands (a
      // busy IndexedDB can take hundreds of ms; the device answers in ~1). Only for an entry that
      // holds no server answer and nothing but (at most) an older device copy.
      // (`_deviceMay` is the whole rule: a mem record that makes no claim is joined, any other shuts the read out)
      const dev = _devKey(p) && _deviceMay(registry.peek(key))
        ? Promise.resolve().then(() => _devRead(p, urgent)).then((got) => _deviceHit(key, p, gen, got)).catch(() => false)
        : null
      let e = null
      try { e = await IO.idbGet(p.sym, p.cacheTf) } catch { e = null }
      if (e?.bars?.length) {
        const held0 = registry.peek(key)
        const deviceHeld = !!held0 && held0.source === 'device' && !held0.restSeen
        registry.dispatch(key, { type: ACTION.IDB_HIT, key, gen, payload: { ...decodeEntry(key, e), saved_at: e.savedAt ?? null, repair_from: e.repairFromT ?? null } })
        // IDB → mem promotion (the legacy warmers' `_promote`): the synchronous readers (the
        // handoff's mem fast path, useDayFacts) see a disk copy once it is hydrated. With its
        // OWN stamp and envelope, never now (every age rule still judges it by its write
        // time), and only when mem held nothing for the key.
        if (!m?.bars?.length) {
          try { IO.memPutMonotonic(p.sym, p.cacheTf, e.bars, { savedAt: e.savedAt ?? null, meta: e.meta ?? null }) } catch { /* derived */ }
          _noteSaved(key, e.savedAt)
        }
        // the device copy held the key and this saved copy joined it: the key stays the device's (_deviceAgain)
        if (deviceHeld) _deviceAgain(key, p, gen, held0.developing, urgent)
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
