// app/src/data/deviceStore/engine.js — the on-device bar store's core: ONE file per timeframe, its
// index in memory, synchronous symbol reads, and the ingest (download → verify → atomic commit).
//
// Environment-agnostic: it runs inside the leader's dedicated worker against OPFS (io.opfsIO) and in
// tests against memory (io.memoryIO). No DOM, no main thread.
//
// ⭐ FILES (one directory, io.STORE_DIR):
//   <tf>.<gen>.pack   the timeframe's first-frame seed pack exactly as the edge serves it (codec.js;
//                     docs/charts/first-frame-seed-format.md, `UFFSEED1`)
//   <tf>.<gen>.ok     the COMMIT MARKER: {v, tf, gen, build, sha256, bytes, src?, via?}. Written only
//                     after the whole file is on disk, flushed and verified (a download: its sha256
//                     matched the manifest and its trailer parsed; a delta: every record read back).
//                     A generation without one does not exist for a reader. `bytes` is the file's
//                     size; `src` = {sha256, bytes} the manifest's FULL pack this generation stands for
//                     (absent on a download: the file itself); `via` 'delta' for one rebuilt from a delta.
//   <tf>.<gen>.prog   the download's identity ({build, sha256, bytes, url}): a reload mid-download
//                     resumes THAT build from the bytes already on disk (HTTP Range), re-hashing them.
// A new build is a new generation: the old one keeps serving until the new one is committed, then is
// closed and deleted. A crash at any point leaves either the old committed generation or the new one.
//
// ⭐ READ: index row → ONE positioned read into a reused buffer → inflate + decodeBody (codec.js) →
// Float64 columns. W and M are derived from D (resample.js) for the engine's own reads only: the page is never
// served them (tfs.SERVED_TFS, review of #2537 H1). Symbols are keyed as /api/bars names them
// (upper case; class shares with '-', e.g. BRK-B); a '.' spelling in a file is found too. A symbol the
// file does not hold reads null: no device copy, the chart asks the network.
//
// ⭐ THE DAILY DELTA (format doc section 10, delta.js). When the held generation of a timeframe IS the
// manifest entry's `delta.base`, ingest() downloads `<tf>.delta.ffs` (a few MB) instead of the pack: the
// whole delta in memory, exactly its manifest `bytes`, its sha256 checked; parsed; every record of the new
// build rebuilt from the held one (delta.js applyDelta, which computes and does not prove) and written as a
// NEW generation `<tf>.<gen>.pack` in the pack format (no .prog: an unmarked delta generation is never
// resumed, only removed); then the whole file is READ BACK through the reader (trailer, every record decoded
// against the new build's bars/first/last/column CRC: THE check, format section 10 apply step 4, and its only
// copy) and only then marked .ok and swapped in. ANY doubt falls back to the full pack, the held generation
// serving throughout: no held copy, another base, a malformed entry, a download that fails, is short, long
// or wrong, a trailer that names another build or base, a symbol set that is not the manifest's, a record
// that does not decode or check, a write or read-back that fails.
//
// ⭐ WHAT A MEMBER'S BROWSER PAYS WHEN THINGS GO WRONG IS BOUNDED (review of #2537; INGEST_STATE_FILE keeps the records
// across page loads, beside the packs, so removing the store's directory removes them too):
//   M5  ROOM FIRST. No pack is downloaded (nor a delta applied: it writes a new full-size generation) unless the
//       origin's free quota (navigator.storage.estimate) holds the pack plus HEADROOM_MARGIN_BYTES: the quota is
//       shared with IndexedDB (the bar caches, the Notebook's offline outbox), and the seed must never be what makes
//       those fail. A write the disk refuses (QuotaExceededError, or fewer bytes written than given) removes the
//       partial generation at once (never resumed), and either refusal records "no room" for NO_ROOM_RETRY_MS: until
//       then this browser is asked nothing (the leader does not even fetch the manifest, workerCore). One attempt per
//       period, never a loop on a browser that cannot hold the seed (a private window, a tiny quota, a full disk).
//       Any other write failure removes the partial too, without the marker.
//   M7  A PACK THAT FAILS ITS CHECKS (sha256, size, trailer, build, the probe record) is discarded whole, as before,
//       and recorded with its build: tried again after BAD_PACK_RETRY_MS[0], then [1], then never again for that
//       build + sha256 (BAD_PACK_MAX_TRIES). A new build clears it. A bad object at the edge costs a member at most
//       three downloads per build, not one per page load. The record also names the CLIENT that failed it (`codeId`:
//       the worker chunk's own path, which carries the bundle's content hash; review of #2537 head 107dea1ee1, P-5):
//       a deploy that changes the engine tries the build again, so "never again" (which lasts until the next build,
//       a whole weekend from Friday night) never holds a fixed client to a broken one's failures.
//   L3  Pack and delta downloads are `cache: 'no-store'`: the edge serves them `private, max-age=31536000, immutable`,
//       which would keep a second copy of every pack in the HTTP cache. The edge's own copy (its Cache API, keyed by
//       a URL the Worker builds) does not depend on the request's cache mode. They are also `priority: 'low'` (review
//       of #2537 head 107dea1ee1, P-4): default ON starts ~80 MB in a desktop member's first charting minute, and the
//       charts' own bars and stream requests go first. A hint to the browser's scheduler, not a bandwidth cap; a
//       browser that does not know the member ignores it, and the edge never sees it.

import { decodeRecord, trailerLengthOf, parseTrailer, PACK_TAIL_BYTES, DeviceFormatError, SEED_FIELDS, SEED_MAGIC } from './codec'
import { parseDelta, applyDelta, newSetOf } from './delta'
import { createSha256 } from './sha256'
import { deriveFromDaily } from './resample'
import { isoOfYmd, nextSessionISO } from './sessions'
import { closeMinuteOf } from './fresh'
import { etDateLabel, etMinuteOfDay } from '../../components/chart/barTime'

import { STORED_TFS, DERIVED_TFS } from './tfs'

export { STORED_TFS, DERIVED_TFS, SERVED_TFS } from './tfs'

const NAME_RE = /^(1|5|15|30|60|D)\.(\d+)\.(pack|ok|prog)$/
const packName = (tf, gen) => `${tf}.${gen}.pack`
const okName = (tf, gen) => `${tf}.${gen}.ok`
const progName = (tf, gen) => `${tf}.${gen}.prog`
const REHASH_CHUNK = 1 << 20
const BUSY_RETRIES = 6
const BUSY_WAIT_MS = 120

export class IngestError extends Error {
  constructor(message) { super(message); this.name = 'IngestError' }
}
/** The disk refused a write (quota, or a short write): M5. */
export class NoRoomError extends IngestError {
  constructor(message) { super(message); this.name = 'NoRoomError' }
}
/** The downloaded object is not the manifest's (size, sha256): M7. */
class BadPackError extends IngestError {
  constructor(message) { super(message); this.badPack = true }
}

/** M5: free quota a pack download must leave untouched (see the header). 256 MiB: the seed is ~80 MB and replacing a
 *  timeframe briefly holds two generations, so a browser needs ~340 MB free to take a first seed; the bars pack's
 *  IndexedDB caches and the Notebook's offline outbox keep a quarter gigabyte to grow into. A normal desktop profile
 *  has gigabytes (Chrome: up to 60% of the disk); a private window or a nearly full disk does not, and stays off. */
export const HEADROOM_MARGIN_BYTES = 256 * 1024 * 1024
/** M5: how long a "no room" stands before this browser tries once more. A wrong "no room" costs a member the speed
 *  feature for a few days; a wrong retry costs up to a whole pack of download and disk churn: at most ~10 a month. */
export const NO_ROOM_RETRY_MS = 3 * 24 * 3_600_000
/** M7: wait after the 1st and the 2nd failure of a pack (same build + sha256); the 3rd is the last try for that build. */
export const BAD_PACK_RETRY_MS = Object.freeze([3_600_000, 6 * 3_600_000])
export const BAD_PACK_MAX_TRIES = 3
/** The records of M5 and M7, beside the packs: {v: 1, noRoom: {at, until, tf, why, need?, free?} | null,
 *  bad: {tf: {build, sha256, tries, at, until, error}}}. */
export const INGEST_STATE_FILE = 'ingest.json'

const _isQuota = (e) => e?.name === 'QuotaExceededError' || e?.code === 22
/** One write, all of it, or a typed failure: NoRoomError for a quota refusal or a short write; any other failure is
 *  the original error marked `writeFailed` (its partial is removed, never resumed). */
function _put(h, u8, at) {
  let n
  try { n = h.write(u8, at) } catch (e) {
    if (_isQuota(e)) throw new NoRoomError(`write refused: ${e?.message || e}`)
    try { e.writeFailed = true } catch { /* not an object */ }
    throw e
  }
  if (n !== u8.length) throw new NoRoomError(`short write: ${n} of ${u8.length} bytes`)
}
function _flush(h) {
  try { h.flush() } catch (e) {
    if (_isQuota(e)) throw new NoRoomError(`flush refused: ${e?.message || e}`)
    try { e.writeFailed = true } catch { /* not an object */ }
    throw e
  }
}
const _writeFailed = (e) => e instanceof NoRoomError || e?.writeFailed === true
/** navigator.storage.estimate() where there is one (a worker has it too), else null: "cannot tell" never blocks. */
const _estimate = async () => {
  const st = typeof navigator !== 'undefined' ? navigator.storage : null
  return st && typeof st.estimate === 'function' ? st.estimate() : null
}
/** The newest as-of session ('YYYY-MM-DD') any row of a timeframe file holds, or null. */
function _asofMaxOf(index) {
  let m = 0
  const a = index?.asof
  if (a && typeof a.length === 'number') for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]
  return m > 0 ? isoOfYmd(m) : null
}
const _emptyState = () => ({ v: 1, noRoom: null, bad: {} })
/** A state file's contents, kept only where well-formed (anything else is forgotten: the safe direction is to try).
 *  ⭐ CAPPED WHEN READ (review of #2563, LOW-4): a record written while the clock ran ahead never locks this browser
 *  out past its schedule counted from `nowMs` (this load): "no room" at most NO_ROOM_RETRY_MS, a bad pack at most its
 *  try's wait. ("Never again for this build", after the last try, is not a time and is kept.) */
function _stateOf(j, nowMs) {
  const out = _emptyState()
  const n = j?.noRoom
  if (n && Number.isFinite(n.until) && Number.isFinite(n.at)) out.noRoom = { ...n, until: Math.min(n.until, nowMs + NO_ROOM_RETRY_MS) }
  for (const [tf, b] of Object.entries(j?.bad || {})) {
    if (STORED_TFS.includes(tf) && b && typeof b.build === 'string' && typeof b.sha256 === 'string' && Number.isSafeInteger(b.tries)
        && b.tries > 0 && (b.until === null || Number.isFinite(b.until))) {
      const wait = BAD_PACK_RETRY_MS[Math.min(b.tries, BAD_PACK_RETRY_MS.length) - 1]
      out.bad[tf] = { ...b, until: b.until === null ? null : Math.min(b.until, nowMs + wait) }
    }
  }
  return out
}

const _enc = new TextEncoder()
const _dec = new TextDecoder()
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const _clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())
/** A delta's apply and read-back hand the worker back this often (ms of work), so the leader keeps answering
 *  every tab's reads from the held generation while it runs. */
const DELTA_SLICE_MS = 12
/** One macrotask turn, so queued messages (other tabs' reads) run. A MessageChannel turn, not setTimeout(0):
 *  browsers clamp nested timeouts to >= 4 ms (measured on the dev PC's Node: 15 ms a setTimeout(0) turn,
 *  0.2 ms a MessageChannel one). */
const _turn = () => new Promise((resolve) => {
  if (typeof MessageChannel !== 'function') { setTimeout(resolve, 0); return }
  const { port1, port2 } = new MessageChannel()
  port1.onmessage = () => { port1.close(); resolve() }
  port2.postMessage(0)
})
const SHA_RE = /^[0-9a-f]{64}$/
/** The manifest FULL pack a committed generation stands for (an older marker: the file itself). */
const _srcOf = (ok) => (ok?.src && Number.isSafeInteger(ok.src.bytes) && typeof ok.src.sha256 === 'string'
  ? { sha256: ok.src.sha256, bytes: ok.src.bytes } : { sha256: ok?.sha256 ?? null, bytes: ok?.bytes ?? null })

/**
 * @param {object} o
 * @param {object} o.io            io.js interface
 * @param {Function} [o.fetchFn]   fetch (tests inject)
 * @param {Function} [o.onEvent]   ({type:'gen', tf, build, gen}) after a commit
 * @param {number} [o.flushEvery]  bytes between flushes while downloading
 * @param {number} [o.deltaSliceMs] ms of delta work between yields to the worker's other messages
 */
/** The splits list of the manifest, as the engine keeps it: {session, symbols: Set} or null. */
export const SPLITS_FILE = 'splits.json'
function _splitsOf(m) {
  const sp = m?.splits
  if (!sp || typeof sp.session !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sp.session) || !sp.symbols || typeof sp.symbols !== 'object') return null
  return { session: sp.session, symbols: new Set(Object.keys(sp.symbols).map((x) => x.toUpperCase().replace(/\./g, '-'))) }
}

/** `codeId`: the client code running this engine (deviceStore.worker.js passes its own chunk's path; '' unknown). */
export function createDeviceEngine({ io, fetchFn = (...a) => fetch(...a), onEvent = null, flushEvery = 8 << 20, now = () => Date.now(), deltaSliceMs = DELTA_SLICE_MS,
  estimate = _estimate, headroomBytes = HEADROOM_MARGIN_BYTES, codeId = '' } = {}) {
  if (!io) throw new Error('device engine: no io')
  /** M5 / M7 records (INGEST_STATE_FILE), read at open(). */
  let state = _emptyState()
  /** ⭐ THE SPLIT GUARD (review of #2189). The seed is split-adjusted AS OF its session (`asof`); a split
   *  executing on a LATER session puts the server (and today's raw minutes) on another basis than the
   *  seed, and a joined copy would paint a fake cliff the server's answer then resets. The manifest names
   *  the symbols whose split executes on the session after `asof` (`splits: {session, symbols}`); a copy
   *  is used on a later date only when that list covers the session after its `asof` and does not name
   *  the symbol. No list, or one for another session: no device copy past `asof` (fail closed). */
  let splits = null
  /** tf → { gen, build, handle, index, bytes, scratch, bad } */
  const live = new Map()
  /** live.js overlay of today's bars (attachLive), or null */
  let overlay = null
  /** every symbol any held timeframe file names (the overlay keeps only these), rebuilt lazily */
  let names = null
  const inflight = new Map()   // tf → ingest promise
  let opening = null
  const tfOpening = new Map()  // stored tf → the promise of its own open (openTf)

  // A handle the previous leader's worker still held is released when that worker goes away; the new
  // leader may get there a moment first.
  async function _open(name, opts) {
    for (let i = 0; ; i++) {
      try { return await io.open(name, opts) } catch (e) {
        if (e?.name !== 'NoModificationAllowedError' || i >= BUSY_RETRIES) throw e
        await _sleep(BUSY_WAIT_MS)
      }
    }
  }
  async function _readJson(name) {
    const h = await _open(name)
    try {
      const b = new Uint8Array(h.size())
      h.read(b, 0)
      return JSON.parse(_dec.decode(b))
    } finally { h.close() }
  }
  async function _writeJson(name, obj) {
    const h = await _open(name, { create: true })
    try {
      const b = _enc.encode(JSON.stringify(obj))
      h.truncate(0)
      h.write(b, 0)
      h.flush()
    } finally { h.close() }
  }
  /** names → Map tf → Map gen → Set(kind) */
  function _scan(names) {
    const by = new Map()
    for (const n of names) {
      const m = NAME_RE.exec(n)
      if (!m) continue
      const [, tf, g, kind] = m
      if (!by.has(tf)) by.set(tf, new Map())
      const gens = by.get(tf)
      const gen = Number(g)
      if (!gens.has(gen)) gens.set(gen, new Set())
      gens.get(gen).add(kind)
    }
    return by
  }
  function _indexOf(h, tf) {
    const size = h.size()
    if (size < PACK_TAIL_BYTES + 2) throw new DeviceFormatError('pack: too small')
    const tail = new Uint8Array(PACK_TAIL_BYTES)
    h.read(tail, size - PACK_TAIL_BYTES)
    const tlen = trailerLengthOf(tail, size)
    const tb = new Uint8Array(tlen)
    const dataEnd = size - PACK_TAIL_BYTES - tlen
    h.read(tb, dataEnd)
    return parseTrailer(tb, dataEnd, { tf })
  }
  /** Open the newest valid generation of one stored timeframe (`gens`: _scan's map for it). */
  async function _openTf(tf, gens) {
    if (!gens) return
    const ready = [...gens.keys()].filter((g) => gens.get(g).has('ok') && gens.get(g).has('pack')).sort((a, b) => b - a)
    for (const gen of ready) {
      let h = null
      try {
        const ok = await _readJson(okName(tf, gen))
        h = await _open(packName(tf, gen))
        if (h.size() !== ok.bytes) throw new DeviceFormatError('pack: size does not match its marker')
        const index = _indexOf(h, tf)
        _install(tf, { gen, build: ok.build, handle: h, index, bytes: ok.bytes, src: _srcOf(ok), via: ok.via === 'delta' ? 'delta' : 'full' })
        h = null
        return
      } catch { /* unreadable: the next older generation */ } finally { if (h) h.close() }
    }
  }
  function _install(tf, entry) {
    names = null
    const old = live.get(tf)
    live.set(tf, { ...entry, scratch: new Uint8Array(4096), bad: 0, asofMax: _asofMaxOf(entry.index) })
    if (old && old.handle !== entry.handle) { try { old.handle.close() } catch { /* gone */ } }
  }
  async function _removeGen(tf, gen) {
    // marker first: a crash between the two leaves an unmarked pack (never read; removed next time)
    for (const name of [okName(tf, gen), progName(tf, gen), packName(tf, gen)]) {
      try { await io.remove(name) } catch { /* busy or gone: the next ingest retries */ }
    }
  }
  /** May the seed copy of `sym` (adjusted as of `asof`) be used today? See the split guard above. */
  function _basisHolds(sym, asof) {
    const today = etDateLabel(Math.floor(now() / 1000))
    if (today <= asof) return true                       // still the as-of day: the seed's own basis
    const next = nextSessionISO(asof)
    if (!splits || splits.session !== next || today > next) return false
    return !splits.symbols.has(sym.replace(/\./g, '-'))
  }
  /**
   * ⛔ A SEED COPY THAT STOPS BEFORE ITS AS-OF SESSION'S LAST BUCKET IS NOT COMPLETE THROUGH THAT SESSION
   * (2026-11-21). The file says `asof`, and the builder checks only that the newest row is OF that day
   * (api/services/ffseed.py build_tf `stale`): it packs whatever intraday rows the worker's store holds. Measured
   * on the published build 20261121T0137Z (as of Friday 2026-11-20): 3,535 of 3,541 30m rows stopped short, 3,530 of them by 13:00 ET
   * of that day (60m and 15m alike, 5m mostly ~12:10), their last row a bucket caught while it was forming; the
   * build before it was the same for Thursday. Stamped through the end of the as-of day, such a copy passed
   * fresh.js, and with today's bars appended it read current mid-session: a chart with a hole in yesterday.
   * For an intraday copy (D is one bar a day: never short), by its LAST row:
   *   'cut'     it is not the last bucket of its own session (the page's completeness rule,
   *             marketSession.classifyIntradayTail): the copy stops mid-session, and that row is the one the
   *             store caught while its bucket was forming. It is not handed out (_lookup).
   *   'behind'  it is the last bucket of an EARLIER session than `asof` (the builder leaves such a symbol out as
   *             stale; a file that carries one anyway holds nothing of its as-of session): its rows are whole
   *             buckets, but the copy is not complete through `asof`.
   *   null      the last bucket of `asof`'s session: the copy is whole.
   */
  function _shortOfClose(seed, tf, asof) {
    const mins = Number(tf)
    if (!Number.isFinite(mins) || mins <= 0 || !seed.t.length) return null
    const last = seed.t[seed.t.length - 1]
    const day = etDateLabel(last)
    if (etMinuteOfDay(last) < closeMinuteOf(day) - mins) return 'cut'
    return day !== asof ? 'behind' : null
  }
  /** The key `sym` is held under in L ('BRK-B' or its 'BRK.B' spelling), or null. */
  function _rowName(L, sym) {
    const S = sym.toUpperCase()
    if (L.index.row.has(S)) return S
    if (S.includes('-') && L.index.row.has(S.replace(/-/g, '.'))) return S.replace(/-/g, '.')
    if (S.includes('.') && L.index.row.has(S.replace(/\./g, '-'))) return S.replace(/\./g, '-')
    return null
  }
  /** The ONE decision behind read() and why(): the columns, and the rule that decided them. */
  function _lookup(sym, tf) {
    const from = DERIVED_TFS[tf]
    if (from) {
      const r = _lookup(sym, from)
      // the period in progress only when today's FORMING D bar is in the copy (forming.js): without it the
      // week / month so far would be built from days that are not the whole period's yet
      const forming = r.out?.forming === 'D'
      const w = r.out ? deriveFromDaily(r.out, tf, { through: r.out.through, forming }) : null
      if (w) { w.through = r.out.through; if (forming) w.forming = 'D' }
      return { out: w, why: r.why }
    }
    const L = live.get(String(tf))
    if (!L || typeof sym !== 'string') return { out: null, why: 'no-file' }
    const S = _rowName(L, sym)
    if (S == null) return { out: null, why: 'missing' }
    const i = L.index.row.get(S)
    const asof = isoOfYmd(L.index.asof[i])
    if (!_basisHolds(S, asof)) return { out: null, why: 'split' }
    let seed
    try { seed = _decodeRow(L, i) } catch { L.bad++; return { out: null, why: 'bad' } }
    if (!seed) return { out: null, why: 'bad' }
    // the seed is complete through the end of its as-of day (built after that day's 20:00 ET close)
    seed.through = Date.UTC(+asof.slice(0, 4), +asof.slice(5, 7) - 1, +asof.slice(8, 10)) / 1000 + 86400
    // ...unless its rows stop before that session's last bucket (_shortOfClose). Then:
    //  - A LAST ROW THAT STOPS MID-SESSION IS NOT HANDED OUT (review of #2407). That row was caught while its
    //    bucket was forming, and in the store an incoming local row replaces a held one: it would overwrite a
    //    complete bucket the lake or the pack holds, whatever its stamp says;
    //  - the copy is complete, at most, to where its last row starts, so every rule that reads `through` refuses it;
    //  - today is NEVER appended to it (the join would hide the missing hours behind a current tail).
    const short = _shortOfClose(seed, String(tf), asof)
    if (short === 'cut') {
      const n = seed.t.length - 1
      if (n <= 0) return { out: null, why: 'seed-short' }
      const cut = {}
      for (const c of ['t', 'o', 'h', 'l', 'c', 'v']) cut[c] = seed[c].slice(0, n)
      cut.through = seed.t[n]
      return { out: cut, why: 'seed-short' }
    }
    if (short === 'behind') {
      seed.through = seed.t[seed.t.length - 1]
      return { out: seed, why: 'seed-short' }
    }
    if (!overlay) return { out: seed, why: 'seed-only:no-overlay' }
    // TODAY, to the last COMPLETE minute (live.js): appended only where the overlay vouches for every
    // bar and continues this symbol's window across exactly one night.
    const add = overlay.read(S, String(tf), asof)
    if (!add) return { out: seed, why: `seed-only:${overlay.why ? overlay.why(S, String(tf), asof) : 'refused'}` }
    const out = add.cols ? _append(seed, add.cols) : seed
    out.through = Math.max(seed.through, add.through)
    // today's forming bar is the copy's last row (forming.js): said so, for W / M and the reader
    if (add.forming && add.cols) out.forming = add.forming
    return { out, why: 'ok' }
  }
  /** The seed's columns followed by the overlay's bars that are newer than its last one. */
  function _append(seed, add) {
    const last = seed.t.length ? seed.t[seed.t.length - 1] : -Infinity
    let k = 0
    while (k < add.t.length && add.t[k] <= last) k++
    const m = add.t.length - k
    if (!m) return seed
    const n = seed.t.length
    const out = {}
    for (const c of ['t', 'o', 'h', 'l', 'c', 'v']) {
      const a = new Float64Array(n + m)
      a.set(seed[c], 0)
      a.set(add[c].subarray(k), n)
      out[c] = a
    }
    return out
  }
  function _decodeRow(L, i) {
    const len = L.index.len[i]
    if (L.scratch.length < len) L.scratch = new Uint8Array(Math.max(len, L.scratch.length * 2))
    const buf = L.scratch.subarray(0, len)
    if (L.handle.read(buf, L.index.off[i]) !== len) return null
    return decodeRecord(L.index, i, buf)
  }

  const api = {
    /**
     * Open every committed generation (newest valid one per timeframe). Idempotent.
     * ⭐ (2026-11-21, the cold switch) EVERY TIMEFRAME OPENS AT ONCE: one listing, then each timeframe's marker,
     * pack and trailer read in parallel (they were read one after another, 1m last, and a page's first read
     * waited for all six). A read waits only for its own timeframe (openTf).
     */
    open() {
      if (opening) return opening
      const listing = (async () => {
        const all = await io.list()
        if (all.includes(SPLITS_FILE)) {
          try { const j = await _readJson(SPLITS_FILE); splits = _splitsOf({ splits: j && { session: j.session, symbols: Object.fromEntries((j.symbols || []).map((x) => [x, 1])) } }) } catch { splits = null }
        }
        if (all.includes(INGEST_STATE_FILE)) {
          try { state = _stateOf(await _readJson(INGEST_STATE_FILE), now()) } catch { state = _emptyState() }
        }
        return _scan(all)
      })()
      for (const tf of STORED_TFS) tfOpening.set(tf, listing.then((by) => _openTf(tf, by.get(tf)), () => {}))
      opening = Promise.all([listing, ...tfOpening.values()]).then(() => api.info())
      return opening
    },

    /** Resolves once the timeframe `tf` serves from (a derived W/M: its D) is open; opens the store if needed. */
    openTf(tf) {
      const o = api.open()
      return tfOpening.get(DERIVED_TFS[tf] ?? String(tf)) || o
    },

    /**
     * SYNCHRONOUS read of (sym, tf): {t, o, h, l, c, v} Float64Arrays, or null (not held, or a record
     * that fails its checks: counted in info().bad, never thrown at the caller).
     */
    read: (sym, tf) => _lookup(sym, tf).out,

    /**
     * Diagnostics: why read(sym, tf) answers what it does. 'ok' (seed and today's overlay), 'seed-only:<rule>'
     * (the seed alone: the overlay is absent or refused, live.js why()), 'seed-short' (the seed alone and not
     * complete through its as-of session, _shortOfClose: without its last row when it stops mid-session, null when
     * that was its only row), or the rule that made it null:
     * no-file (that timeframe is not held) | missing (not in the seed) | split (the split guard) | bad (the
     * row failed its checks).
     */
    why: (sym, tf) => _lookup(sym, tf).why,

    /** The manifest's splits list (see SPLITS_FILE); kept on disk so a reload keeps the guard. */
    async setSplits(manifest) {
      const sp = _splitsOf(manifest)
      splits = sp
      try { await _writeJson(SPLITS_FILE, sp ? { session: sp.session, symbols: [...sp.symbols] } : null) } catch { /* memory still holds it */ }
    },

    /**
     * M2: does any held timeframe still pass the split guard today, for some symbol? Its newest as-of session is today
     * or later, or today is the next session and the manifest's split list covers it (_basisHolds without a symbol).
     * False: every read() answers null ('split') until a newer seed lands, so the leader stops the minute feed.
     */
    serves() {
      const today = etDateLabel(Math.floor(now() / 1000))
      for (const L of live.values()) {
        const asof = L.asofMax
        if (!asof) continue
        if (today <= asof) return true
        const next = nextSessionISO(asof)
        if (splits && splits.session === next && today <= next) return true
      }
      return false
    },

    /** M5: this browser has no room for the seed (until the marker expires): {status: 'no-room', ...} or null. */
    ingestBlocked() {
      const n = state.noRoom
      if (!n || !(now() < n.until)) return null
      return { status: 'no-room', ...n }
    },

    /** Diagnostics: the M5 / M7 records (a copy). */
    ingestState() { return JSON.parse(JSON.stringify(state)) },

    /** Attach (or detach, null) today's overlay (live.js), read by every read() after this. */
    attachLive(o) { overlay = o || null },
    /** The name a held file uses for `sym` ('BRK-B' or 'BRK.B' spelling), or null when none holds it. */
    seedName(sym) {
      if (!names) { names = new Set(); for (const L of live.values()) for (const k of L.index.row.keys()) names.add(k) }
      if (typeof sym !== 'string') return null
      const S = sym.toUpperCase()
      if (names.has(S)) return S
      const a = S.includes('.') ? S.replace(/\./g, '-') : (S.includes('-') ? S.replace(/-/g, '.') : null)
      return a && names.has(a) ? a : null
    },

    has(sym, tf) {
      const L = live.get(DERIVED_TFS[tf] ?? String(tf))
      return !!L && typeof sym === 'string' && L.index.row.has(sym.toUpperCase())
    },
    buildOf(tf) { return live.get(DERIVED_TFS[tf] ?? String(tf))?.build ?? null },
    info() {
      const tfs = {}
      for (const [tf, L] of live) tfs[tf] = { build: L.build, asof: L.index.asof, gen: L.gen, count: L.index.count, bytes: L.bytes, comp: L.index.comp, bad: L.bad, via: L.via ?? 'full' }
      return { tfs }
    },

    /**
     * Download, verify and commit one timeframe file. `entry` = {tf, build, url, bytes, sha256,
     * encoding?: 'identity' | 'gzip', symbols?, bars?, delta?: {base, url, bytes, sha256}} (the manifest's
     * per-tf entry plus its build). Resolves {tf, status: 'current' | 'ingested', via: 'delta' | 'full', ...}
     * (`delta`: why an offered delta was not used), 'no-room' (M5: no download without room, or the disk refused
     * a write: {why: 'headroom' | 'write', until, need?, free?}) or 'backoff' (M7: this build failed its checks
     * recently: {build, tries, until}, until null once its tries are spent); rejects on a failure (a download the
     * NETWORK cut stays on disk and resumes on the next call; a file that fails its checks is discarded whole and
     * recorded; a write that fails is discarded whole). The delta is tried first when the held generation is its
     * base, the full pack on any doubt (see the header). One ingest per timeframe at a time.
     */
    ingest(entry, opts = {}) {
      const tf = String(entry?.tf)
      const run = inflight.get(tf)
      if (run) return run
      const p = _ingestAny(entry, opts).finally(() => { if (inflight.get(tf) === p) inflight.delete(tf) })
      inflight.set(tf, p)
      return p
    },

    /** Every timeframe of a manifest (`latest.json`: {v, kind, build, tfs: {tf: entry}}), ONE AT A TIME,
     *  in STORED_TFS order. */
    async ingestAll(manifest, { signal = null, base = null } = {}) {
      await api.open()
      const blocked = api.ingestBlocked()
      if (blocked) return [blocked]                       // M5: nothing at all until the marker expires
      await api.setSplits(manifest)
      const out = []
      for (const tf of STORED_TFS) {
        const e = manifest?.tfs?.[tf]
        if (!e) continue
        if (signal?.aborted) break
        const url = base ? new URL(e.url, base).href : e.url
        // the delta's url resolves against the manifest like the pack's (a malformed one is refused in ingest)
        let delta = e.delta
        if (delta && typeof delta === 'object' && typeof delta.url === 'string' && delta.url && base) {
          try { delta = { ...delta, url: new URL(delta.url, base).href } } catch { delta = { ...delta, url: '' } }
        }
        try { out.push(await api.ingest({ build: manifest.build, ...e, tf, url, delta }, { signal })) } catch (err) {
          out.push({ tf, status: 'error', error: String(err?.message || err) })
        }
        if (out[out.length - 1]?.status === 'no-room') break   // M5: the next timeframe would not fit either
      }
      return out
    },

    close() {
      for (const L of live.values()) { try { L.handle.close() } catch { /* gone */ } }
      live.clear()
      opening = null
      tfOpening.clear()
    },
  }

  function _checkEntry(entry) {
    const tf = String(entry?.tf)
    if (!STORED_TFS.includes(tf) || typeof entry.url !== 'string' || !entry.url || !entry.build
        || !Number.isSafeInteger(entry.bytes) || entry.bytes <= PACK_TAIL_BYTES || !SHA_RE.test(entry.sha256 || '')) {
      throw new IngestError(`ingest: bad manifest entry for ${tf}`)
    }
    return tf
  }
  /** Is the held generation `cur` already the manifest entry's build? (A delta-built one stands for the
   *  manifest's full pack: its `src`, not its own size.) */
  const _isCurrent = (cur, entry) => !!cur && cur.build === entry.build && (cur.src?.bytes ?? cur.bytes) === entry.bytes

  /** Why the offered delta cannot be used on `cur` ('bad-entry' | 'not-smaller' | 'no-base' | 'other-base'), or
   *  null. A delta is held whole in memory, so one no smaller than the pack is never worth it (and a manifest's
   *  `bytes` never sizes more memory than the pack itself would take on disk). */
  function _deltaRefusal(entry, cur) {
    const d = entry.delta
    if (!d || typeof d !== 'object' || typeof d.url !== 'string' || !d.url || typeof d.base !== 'string' || !d.base
        || !Number.isSafeInteger(d.bytes) || d.bytes <= PACK_TAIL_BYTES || !SHA_RE.test(d.sha256 || '') || d.base === entry.build) return 'bad-entry'
    if (d.bytes >= entry.bytes) return 'not-smaller'
    if (!cur) return 'no-base'
    // exactly the build it applies to, by the marker AND by the file's own trailer
    if (cur.build !== d.base || (cur.index.build != null && cur.index.build !== d.base)) return 'other-base'
    return null
  }

  async function _saveState() {
    try { await _writeJson(INGEST_STATE_FILE, state) } catch { /* memory still holds it: one try per page load */ }
  }
  /** M5: the browser has no room (`why` 'headroom' | 'write'): recorded for NO_ROOM_RETRY_MS. The status to answer. */
  async function _noRoom(tf, why, extra = {}) {
    const at = now()
    state.noRoom = { at, until: at + NO_ROOM_RETRY_MS, tf, why, ...extra }
    await _saveState()
    return { tf, status: 'no-room', why, until: state.noRoom.until, ...extra }
  }
  /** M5: is there room for `bytes` more plus the margin? `ok` when the browser cannot tell. */
  async function _room(bytes) {
    let est = null
    try { est = await estimate() } catch { est = null }
    const quota = Number(est?.quota), usage = Number(est?.usage)
    if (!Number.isFinite(quota) || !Number.isFinite(usage)) return { ok: true, free: null, need: null }
    const free = quota - usage
    const need = bytes + headroomBytes
    return { ok: free >= need, free, need }
  }
  /** M5 (review of #2563, LOW-4): the bytes of THIS build's resumable partial download of `tf` already on disk (its
   *  .prog names exactly this entry), so the room check asks only for the rest. 0 for none, and for a gzip pack (it
   *  restarts from zero). */
  async function _resumableBytes(tf, entry) {
    if (entry.encoding === 'gzip') return 0
    try {
      for (const [g, kinds] of _scan(await io.list()).get(tf) || []) {
        if (kinds.has('ok') || !kinds.has('prog') || !kinds.has('pack')) continue
        const p = await _readJson(progName(tf, g))
        if (p.build !== entry.build || p.sha256 !== entry.sha256 || p.bytes !== entry.bytes || p.url !== entry.url) continue
        const h = await _open(packName(tf, g))
        try { return Math.max(0, Math.min(h.size(), entry.bytes)) } finally { h.close() }
      }
    } catch { /* none readable: count nothing */ }
    return 0
  }
  /** M5: every uncommitted generation of `tf` (a partial, an unmarked delta generation) goes: no room to finish it. */
  async function _dropUncommitted(tf) {
    let gens
    try { gens = _scan(await io.list()).get(tf) } catch { return }
    const cur = live.get(tf)
    for (const [g, kinds] of gens || []) if (g !== cur?.gen && !kinds.has('ok')) await _removeGen(tf, g)
  }
  /** M7: the status to answer while this build of `tf` is backed off, or null (go). A record of another build or
   *  sha256, or written by another client (`codeId`; a record from before it was kept names none: ''), is cleared: a
   *  new build is never held to an old one's failures, nor a new client to an old client's. */
  async function _backoffFor(tf, entry) {
    const b = state.bad[tf]
    if (!b) return null
    if (b.build !== entry.build || b.sha256 !== entry.sha256 || (b.code ?? '') !== String(codeId)) { delete state.bad[tf]; await _saveState(); return null }
    const base = { tf, status: 'backoff', build: b.build, tries: b.tries, error: b.error ?? null }
    if (b.tries >= BAD_PACK_MAX_TRIES) return { ...base, until: null }
    if (now() < b.until) return { ...base, until: b.until }
    return null
  }
  /** M7: this build of `tf` failed its checks once more. */
  async function _noteBad(tf, entry, e) {
    const prev = state.bad[tf]
    const tries = prev && prev.build === entry.build && prev.sha256 === entry.sha256 ? prev.tries + 1 : 1
    const at = now()
    state.bad[tf] = { build: entry.build, sha256: entry.sha256, code: String(codeId), tries, at, until: tries >= BAD_PACK_MAX_TRIES ? null : at + BAD_PACK_RETRY_MS[tries - 1], error: String(e?.message || e).slice(0, 200) }
    await _saveState()
  }
  async function _clearBad(tf) {
    if (!state.bad[tf]) return
    delete state.bad[tf]
    await _saveState()
  }

  async function _ingestAny(entry, opts = {}) {
    const tf = _checkEntry(entry)
    await api.open()
    const cur = live.get(tf)
    if (_isCurrent(cur, entry)) return { tf, status: 'current', build: cur.build, via: cur.via ?? 'full' }
    const blocked = api.ingestBlocked()
    if (blocked) return { ...blocked, tf }
    const backoff = await _backoffFor(tf, entry)
    if (backoff) return backoff
    // ⭐ ROOM FIRST (M5): both paths write a new generation the size of the full pack; a full download that RESUMES
    // needs only the rest of it (LOW-4 of the review of #2563)
    const deltaFirst = entry.delta != null && !_deltaRefusal(entry, cur)
    const room = await _room(entry.bytes - (deltaFirst ? 0 : await _resumableBytes(tf, entry)))
    if (!room.ok) { await _dropUncommitted(tf); return _noRoom(tf, 'headroom', { need: room.need, free: room.free }) }
    let why = null
    if (entry.delta != null) {
      why = _deltaRefusal(entry, cur)
      if (!why) {
        try {
          const r = await _ingestDelta(tf, entry, cur, opts)
          await _clearBad(tf)
          return r
        } catch (e) {
          // the disk refused the delta's generation: the full pack would not fit either (no 80 MB fallback)
          if (e instanceof NoRoomError || _isQuota(e)) return _noRoom(tf, 'write', { error: String(e?.message || e).slice(0, 200) })
          why = `failed: ${String(e?.message || e).slice(0, 200)}`
        }
      }
    }
    let r
    try { r = await _ingest(entry, opts) } catch (e) {
      // a quota refusal anywhere in the download (its .prog / .ok files included) is "no room" too, never a loop
      if (_isQuota(e)) return _noRoom(tf, 'write', { error: String(e?.message || e).slice(0, 200) })
      throw e
    }
    return why && r.status === 'ingested' ? { ...r, delta: why } : r
  }

  /** The delta file, whole, in memory: exactly `d.bytes`, sha256 `d.sha256`, or IngestError. */
  async function _fetchDelta(tf, d, signal) {
    const res = await fetchFn(d.url, { signal, credentials: 'same-origin', cache: 'no-store', priority: 'low' })   // L3
    if (res.status !== 200) throw new IngestError(`delta: ${tf} answered ${res.status}`)
    if (!res.body) throw new IngestError('delta: no body')
    const buf = new Uint8Array(d.bytes)
    const hasher = createSha256()
    let have = 0
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (signal?.aborted) throw new IngestError('delta: aborted')
        if (have + value.length > d.bytes) throw new IngestError('delta: longer than the manifest says')
        buf.set(value, have)
        hasher.update(value)
        have += value.length
      }
    } finally {
      try { reader.releaseLock() } catch { /* done */ }
    }
    if (have !== d.bytes) throw new IngestError(`delta: ${tf} is ${have} bytes, the manifest says ${d.bytes}`)
    if (hasher.hex() !== d.sha256) throw new IngestError(`delta: ${tf} sha256 mismatch`)
    return buf
  }

  /**
   * The delta path (see the header): download + verify the delta, rebuild the new build's pack from the held
   * generation `cur` into a NEW generation, read it all back, then commit it exactly like a download. Throws on
   * any doubt, having removed its own unmarked generation; `cur` keeps serving throughout.
   */
  async function _ingestDelta(tf, entry, cur, { signal = null } = {}) {
    const d = entry.delta
    const bytes = await _fetchDelta(tf, d, signal)
    const dt = parseDelta(bytes, { tf })
    if (dt.build !== entry.build) throw new IngestError(`delta: ${tf} builds ${dt.build}, the manifest says ${entry.build}`)
    if (dt.base !== d.base || dt.base !== cur.build) throw new IngestError(`delta: ${tf} applies to ${dt.base}, held ${cur.build}`)
    // the new build's symbol set, before a byte is written: what the manifest says the full pack holds
    const want = newSetOf(dt)
    if (!want.count) throw new IngestError('delta: an empty build')
    if (Number.isSafeInteger(entry.symbols) && entry.symbols !== want.count) throw new IngestError(`delta: ${want.count} symbols, the manifest says ${entry.symbols}`)
    if (Number.isSafeInteger(entry.bars) && entry.bars !== want.bars) throw new IngestError(`delta: ${want.bars} bars, the manifest says ${entry.bars}`)

    const gens = _scan(await io.list()).get(tf) ?? new Map()
    const gen = Math.max(0, cur.gen, ...gens.keys()) + 1
    let h = await _open(packName(tf, gen), { create: true })
    let committed = false
    let t0 = _clock()
    const pace = async () => {
      if (signal?.aborted) throw new IngestError('delta: aborted')
      if (_clock() - t0 >= deltaSliceMs) { await _turn(); t0 = _clock() }
    }
    try {
      h.truncate(0)
      // 1. the records, in symbol order (delta.js computes them; step 3 proves them)
      const L = cur
      let rb = new Uint8Array(4096)
      const readBase = (i) => {
        const len = L.index.len[i]
        if (rb.length < len) rb = new Uint8Array(Math.max(len, rb.length * 2))
        const b = rb.subarray(0, len)
        if (L.handle.read(b, L.index.off[i]) !== len) throw new IngestError('delta: the held file is short')
        return b
      }
      const symbols = Object.create(null)
      let at = 0
      for (const { sym, blob, entry: e } of applyDelta({ index: L.index, read: readBase }, dt, bytes)) {
        e[0] = at
        _put(h, blob, at)
        at += blob.length
        symbols[sym] = e
        await pace()
      }
      // 2. the trailer (format section 3; `via`/`base` are extra keys, which readers ignore)
      const tr = {
        asof: dt.asof, base: dt.base, basis: dt.basis, build: dt.build, comp: dt.comp, depth: dt.depth,
        fields: [...SEED_FIELDS], grid: dt.grid, kind: 'ffseed', symbols, tf: dt.tf, tunit: dt.tunit, v: 1, via: 'delta',
      }
      const tb = _enc.encode(JSON.stringify(tr))
      const tail = new Uint8Array(PACK_TAIL_BYTES)
      const tv = new DataView(tail.buffer)
      tv.setUint32(0, tb.length % 4294967296, true)
      tv.setUint32(4, Math.floor(tb.length / 4294967296), true)
      tail.set(_enc.encode(SEED_MAGIC), 8)
      _put(h, tb, at)
      _put(h, tail, at + tb.length)
      const size = at + tb.length + tail.length
      _flush(h)
      if (h.size() !== size) throw new IngestError(`delta: the new file is ${h.size()} bytes, ${size} were written`)

      // 3. ⭐ THE CHECK, its only copy: READ IT BACK through the reader, the trailer then every record, as a
      //    chart will read them. decodeRecord holds each to the new build's bars/first/last and column CRC.
      const index = _indexOf(h, tf)
      let buf = new Uint8Array(4096)
      for (const [sym, e] of Object.entries(symbols)) {
        const j = index.row.get(sym)
        if (j == null) throw new IngestError(`delta: ${sym} is missing from the new file`)
        for (let k = 0; k < SEED_FIELDS.length; k++) {
          if (index[SEED_FIELDS[k]][j] !== e[k]) throw new IngestError(`delta: ${sym} reads back another ${SEED_FIELDS[k]}`)
        }
        if (buf.length < e[1]) buf = new Uint8Array(Math.max(e[1], buf.length * 2))
        const b = buf.subarray(0, e[1])
        if (h.read(b, e[0]) !== e[1]) throw new IngestError(`delta: ${sym} reads back short`)
        decodeRecord(index, j, b)               // inflate + decodeBody: the column CRC of the new build
        await pace()
      }

      // 4. commit, exactly like a download: marker, swap, the older generations removed
      const src = { sha256: entry.sha256, bytes: entry.bytes }
      await _writeJson(okName(tf, gen), { v: 1, tf, gen, build: entry.build, sha256: null, bytes: size, src, via: 'delta', base: dt.base, delta: { sha256: d.sha256, bytes: d.bytes } })
      _install(tf, { gen, build: entry.build, handle: h, index, bytes: size, src, via: 'delta' })
      committed = true
      h = null
    } catch (e) {
      if (h) { try { h.close() } catch { /* gone */ } h = null }
      if (!committed) await _removeGen(tf, gen)
      throw e
    }
    for (const g of gens.keys()) if (g !== gen) await _removeGen(tf, g)
    try { onEvent?.({ type: 'gen', tf, build: entry.build, gen }) } catch { /* listener */ }
    return { tf, status: 'ingested', build: entry.build, count: want.count, via: 'delta', bytes: d.bytes }
  }

  async function _ingest(entry, { signal = null, onProgress = null } = {}) {
    const tf = _checkEntry(entry)
    await api.open()
    const cur = live.get(tf)
    if (_isCurrent(cur, entry)) return { tf, status: 'current', build: cur.build, via: cur.via ?? 'full' }

    const gens = _scan(await io.list()).get(tf) ?? new Map()
    // A partial download of THIS file (a reload mid-ingest) resumes; any other uncommitted generation
    // (an older build's partial, an unmarked pack) is garbage.
    let gen = null
    for (const [g, kinds] of gens) {
      if (kinds.has('ok') || !kinds.has('prog')) continue
      try {
        const p = await _readJson(progName(tf, g))
        if (p.build === entry.build && p.sha256 === entry.sha256 && p.bytes === entry.bytes && p.url === entry.url) { gen = g; break }
      } catch { /* unreadable: garbage */ }
    }
    for (const g of gens.keys()) if (g !== gen && g !== cur?.gen) await _removeGen(tf, g)
    if (gen == null) {
      gen = Math.max(0, ...gens.keys()) + 1
      await _writeJson(progName(tf, gen), { build: entry.build, sha256: entry.sha256, bytes: entry.bytes, url: entry.url })
    }

    let h = await _open(packName(tf, gen), { create: true })
    try {
      let have = h.size()
      let hasher = createSha256()
      if (have > entry.bytes) { h.truncate(0); have = 0 }
      // a resume re-hashes what is already on disk (the hasher's state is not persisted)
      if (have > 0) {
        const chunk = new Uint8Array(Math.min(REHASH_CHUNK, have))
        for (let at = 0; at < have;) {
          const n = h.read(chunk.subarray(0, Math.min(chunk.length, have - at)), at)
          if (n <= 0) { have = at; break }
          hasher.update(chunk.subarray(0, n))
          at += n
        }
      }
      if (have < entry.bytes) {
        const gz = entry.encoding === 'gzip'
        // a gzip FILE cannot resume mid-stream (the inflater's state is gone): start it over
        if (gz && have > 0) { h.truncate(0); have = 0; hasher = createSha256() }
        const headers = have > 0 ? { Range: `bytes=${have}-` } : {}
        const res = await fetchFn(entry.url, { headers, signal, credentials: 'same-origin', cache: 'no-store', priority: 'low' })   // L3
        if (have > 0 && res.status === 200) { h.truncate(0); have = 0; hasher = createSha256() }   // range ignored
        else if (have > 0 && res.status === 206) {
          const m = /bytes\s+(\d+)-/i.exec(res.headers?.get?.('content-range') || '')
          if (!m || Number(m[1]) !== have) throw new IngestError('ingest: resume answered another range')
        } else if (!res.ok) throw new IngestError(`ingest: ${tf} answered ${res.status}`)
        let stream = res.body
        if (!stream) throw new IngestError('ingest: no body')
        if (gz) stream = stream.pipeThrough(new DecompressionStream('gzip'))
        const reader = stream.getReader()
        let since = 0
        let writeErr = null
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            if (signal?.aborted) throw new IngestError('ingest: aborted')
            if (have + value.length > entry.bytes) throw new BadPackError('ingest: longer than the manifest says')
            try { _put(h, value, have) } catch (e) { writeErr = e; throw e }
            hasher.update(value)
            have += value.length
            since += value.length
            if (since >= flushEvery) { try { _flush(h) } catch (e) { writeErr = e; throw e } since = 0 }
            onProgress?.(tf, have, entry.bytes)
          }
        } finally {
          // what arrived before a network cut is kept for the resume (flushed); a write failure is not
          if (!writeErr) { try { _flush(h) } catch (e) { writeErr = e } }
          try { reader.releaseLock() } catch { /* done */ }
        }
        if (writeErr) throw writeErr
        // the body ENDED (no network error) short of the manifest's size: the object at the edge is not the manifest's
        if (have !== entry.bytes) throw new BadPackError(`ingest: ${tf} is ${have} bytes, the manifest says ${entry.bytes}`)
      }
      if (have !== entry.bytes) throw new IngestError(`ingest: ${tf} is ${have} bytes, the manifest says ${entry.bytes}`)
      // never resumed: the bytes on disk are wrong somewhere (discarded whole and recorded below)
      if (hasher.hex() !== entry.sha256) throw new BadPackError(`ingest: ${tf} sha256 mismatch`)
      // A whole, verified file that is still not USABLE is discarded whole too (never resumed): its
      // trailer must parse for this tf, it must be the build the manifest named (a stale edge copy, a
      // mixed-up URL), and ONE record must decode (a store that answers null for every symbol is never
      // swapped in over a good one).
      let index
      try {
        index = _indexOf(h, tf)
        if (index.build != null && index.build !== entry.build) throw new IngestError(`ingest: ${tf} holds build ${index.build}, the manifest says ${entry.build}`)
        if (index.count) decodeRecord(index, 0, _probe(h, index))
      } catch (e) {
        try { e.badPack = true } catch { /* not an object */ }
        throw e
      }
      await _writeJson(okName(tf, gen), { v: 1, tf, gen, build: entry.build, sha256: entry.sha256, bytes: entry.bytes })
      _install(tf, { gen, build: entry.build, handle: h, index, bytes: entry.bytes, src: { sha256: entry.sha256, bytes: entry.bytes }, via: 'full' })
      h = null
      try { await io.remove(progName(tf, gen)) } catch { /* harmless */ }
      for (const g of gens.keys()) if (g !== gen) await _removeGen(tf, g)
      await _clearBad(tf)
      try { onEvent?.({ type: 'gen', tf, build: entry.build, gen }) } catch { /* listener */ }
      return { tf, status: 'ingested', build: entry.build, count: index.count, via: 'full' }
    } catch (e) {
      // ⛔ DISCARDED WHOLE, NEVER RESUMED: a file that is not the manifest's (M7: recorded, backed off) and a file the
      // disk refused to write (M5: no partial kept in a quota shared with IndexedDB; "no room" recorded on a refusal)
      if (e?.badPack === true || _writeFailed(e) || _isQuota(e)) {
        if (h) { try { h.close() } catch { /* gone */ } h = null }
        await _removeGen(tf, gen)
        if (e?.badPack === true) await _noteBad(tf, entry, e)
        else if (e instanceof NoRoomError || _isQuota(e)) return _noRoom(tf, 'write', { error: String(e?.message || e).slice(0, 200) })
      }
      throw e
    } finally {
      if (h) h.close()
    }
  }

  function _probe(h, index) {
    const len = index.len[0]
    const b = new Uint8Array(len)
    h.read(b, index.off[0])
    return b
  }

  return api
}
