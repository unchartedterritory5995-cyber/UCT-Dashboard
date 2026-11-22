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
// Float64 columns. W and M are derived from D (resample.js). Symbols are keyed as /api/bars names them
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

import { decodeRecord, trailerLengthOf, parseTrailer, PACK_TAIL_BYTES, DeviceFormatError, SEED_FIELDS, SEED_MAGIC } from './codec'
import { parseDelta, applyDelta, newSetOf } from './delta'
import { createSha256 } from './sha256'
import { deriveFromDaily } from './resample'
import { isoOfYmd, nextSessionISO } from './sessions'
import { etDateLabel } from '../../components/chart/barTime'

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

export function createDeviceEngine({ io, fetchFn = (...a) => fetch(...a), onEvent = null, flushEvery = 8 << 20, now = () => Date.now(), deltaSliceMs = DELTA_SLICE_MS } = {}) {
  if (!io) throw new Error('device engine: no io')
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
  function _install(tf, entry) {
    names = null
    const old = live.get(tf)
    live.set(tf, { ...entry, scratch: new Uint8Array(4096), bad: 0 })
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
    /** Open every committed generation (newest valid one per timeframe). Idempotent. */
    open() {
      if (opening) return opening
      opening = (async () => {
        const all = await io.list()
        if (all.includes(SPLITS_FILE)) {
          try { const j = await _readJson(SPLITS_FILE); splits = _splitsOf({ splits: j && { session: j.session, symbols: Object.fromEntries((j.symbols || []).map((x) => [x, 1])) } }) } catch { splits = null }
        }
        const by = _scan(all)
        for (const tf of STORED_TFS) {
          const gens = by.get(tf)
          if (!gens) continue
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
              break
            } catch { /* unreadable: the next older generation */ } finally { if (h) h.close() }
          }
        }
        return api.info()
      })()
      return opening
    },

    /**
     * SYNCHRONOUS read of (sym, tf): {t, o, h, l, c, v} Float64Arrays, or null (not held, or a record
     * that fails its checks: counted in info().bad, never thrown at the caller).
     */
    read: (sym, tf) => _lookup(sym, tf).out,

    /**
     * Diagnostics: why read(sym, tf) answers what it does. 'ok' (seed and today's overlay), 'seed-only:<rule>'
     * (the seed alone: the overlay is absent or refused, live.js why()), or the rule that made it null:
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
     * (`delta`: why an offered delta was not used); rejects on a failure (a partial download stays on disk
     * and resumes on the next call; a file whose sha256 does not match is discarded whole). The delta is
     * tried first when the held generation is its base, the full pack on any doubt (see the header). One
     * ingest per timeframe at a time.
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
      }
      return out
    },

    close() {
      for (const L of live.values()) { try { L.handle.close() } catch { /* gone */ } }
      live.clear()
      opening = null
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

  async function _ingestAny(entry, opts = {}) {
    const tf = _checkEntry(entry)
    await api.open()
    const cur = live.get(tf)
    if (_isCurrent(cur, entry)) return { tf, status: 'current', build: cur.build, via: cur.via ?? 'full' }
    let why = null
    if (entry.delta != null) {
      why = _deltaRefusal(entry, cur)
      if (!why) {
        try { return await _ingestDelta(tf, entry, cur, opts) } catch (e) { why = `failed: ${String(e?.message || e).slice(0, 200)}` }
      }
    }
    const r = await _ingest(entry, opts)
    return why && r.status === 'ingested' ? { ...r, delta: why } : r
  }

  /** The delta file, whole, in memory: exactly `d.bytes`, sha256 `d.sha256`, or IngestError. */
  async function _fetchDelta(tf, d, signal) {
    const res = await fetchFn(d.url, { signal, credentials: 'same-origin' })
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
        if (h.write(blob, at) !== blob.length) throw new IngestError('delta: short write')
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
      if (h.write(tb, at) !== tb.length || h.write(tail, at + tb.length) !== tail.length) throw new IngestError('delta: short write')
      const size = at + tb.length + tail.length
      h.flush()
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
        const res = await fetchFn(entry.url, { headers, signal, credentials: 'same-origin' })
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
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            if (signal?.aborted) throw new IngestError('ingest: aborted')
            if (have + value.length > entry.bytes) throw new IngestError('ingest: longer than the manifest says')
            h.write(value, have)
            hasher.update(value)
            have += value.length
            since += value.length
            if (since >= flushEvery) { h.flush(); since = 0 }
            onProgress?.(tf, have, entry.bytes)
          }
        } finally {
          h.flush()
          try { reader.releaseLock() } catch { /* done */ }
        }
      }
      if (have !== entry.bytes) throw new IngestError(`ingest: ${tf} is ${have} bytes, the manifest says ${entry.bytes}`)
      if (hasher.hex() !== entry.sha256) {
        // never resumed: the bytes on disk are wrong somewhere
        h.truncate(0)
        h.flush()
        h.close(); h = null
        await _removeGen(tf, gen)
        throw new IngestError(`ingest: ${tf} sha256 mismatch`)
      }
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
        h.close(); h = null
        await _removeGen(tf, gen)
        throw e
      }
      await _writeJson(okName(tf, gen), { v: 1, tf, gen, build: entry.build, sha256: entry.sha256, bytes: entry.bytes })
      _install(tf, { gen, build: entry.build, handle: h, index, bytes: entry.bytes, src: { sha256: entry.sha256, bytes: entry.bytes }, via: 'full' })
      h = null
      try { await io.remove(progName(tf, gen)) } catch { /* harmless */ }
      for (const g of gens.keys()) if (g !== gen) await _removeGen(tf, g)
      try { onEvent?.({ type: 'gen', tf, build: entry.build, gen }) } catch { /* listener */ }
      return { tf, status: 'ingested', build: entry.build, count: index.count, via: 'full' }
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
