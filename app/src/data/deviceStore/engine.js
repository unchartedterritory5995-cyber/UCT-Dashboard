// app/src/data/deviceStore/engine.js — the on-device bar store's core: ONE file per timeframe, its
// index in memory, synchronous symbol reads, and the ingest (download → verify → atomic commit).
//
// Environment-agnostic: it runs inside the leader's dedicated worker against OPFS (io.opfsIO) and in
// tests against memory (io.memoryIO). No DOM, no main thread.
//
// ⭐ FILES (one directory, io.STORE_DIR):
//   <tf>.<gen>.pack   the timeframe's first-frame seed pack exactly as the edge serves it (codec.js;
//                     docs/charts/first-frame-seed-format.md, `UFFSEED1`)
//   <tf>.<gen>.ok     the COMMIT MARKER: {v, tf, gen, build, sha256, bytes}. Written only after
//                     the whole file is on disk, flushed, its sha256 matched the manifest and its
//                     trailer parsed. A generation without one does not exist for a reader.
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
// ⭐ DESIGN HOOK, NOT BUILT: the daily DELTA (format doc section 9: `<tf>.delta-<base>.ffs`, entries in
// `append` or `replace` mode). Plan: land it as `<tf>.<gen>.d<k>.pack` + a marker naming its base
// build; read() takes a `replace` entry from the newest delta, an `append` entry as base window +
// appended bars (newest N kept); the next full build replaces both. `applyDelta` throws until the seed
// publishes deltas.

import { decodeRecord, trailerLengthOf, parseTrailer, PACK_TAIL_BYTES, DeviceFormatError } from './codec'
import { createSha256 } from './sha256'
import { deriveFromDaily } from './resample'
import { isoOfYmd } from './live'

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

/**
 * @param {object} o
 * @param {object} o.io            io.js interface
 * @param {Function} [o.fetchFn]   fetch (tests inject)
 * @param {Function} [o.onEvent]   ({type:'gen', tf, build, gen}) after a commit
 * @param {number} [o.flushEvery]  bytes between flushes while downloading
 */
export function createDeviceEngine({ io, fetchFn = (...a) => fetch(...a), onEvent = null, flushEvery = 8 << 20 } = {}) {
  if (!io) throw new Error('device engine: no io')
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
  /** The key `sym` is held under in L ('BRK-B' or its 'BRK.B' spelling), or null. */
  function _rowName(L, sym) {
    const S = sym.toUpperCase()
    if (L.index.row.has(S)) return S
    if (S.includes('-') && L.index.row.has(S.replace(/-/g, '.'))) return S.replace(/-/g, '.')
    if (S.includes('.') && L.index.row.has(S.replace(/\./g, '-'))) return S.replace(/\./g, '-')
    return null
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
        const by = _scan(await io.list())
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
              _install(tf, { gen, build: ok.build, handle: h, index, bytes: ok.bytes })
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
    read(sym, tf) {
      const from = DERIVED_TFS[tf]
      if (from) return deriveFromDaily(api.read(sym, from), tf)
      const L = live.get(String(tf))
      if (!L || typeof sym !== 'string') return null
      const S = _rowName(L, sym)
      if (S == null) return null
      const i = L.index.row.get(S)
      let seed
      try { seed = _decodeRow(L, i) } catch { L.bad++; return null }
      if (!seed || !overlay) return seed
      // TODAY, to the last closed minute (live.js): appended only where the overlay vouches for every
      // bar and continues this symbol's window across exactly one night.
      const add = overlay.read(S, String(tf), isoOfYmd(L.index.asof[i]))
      return add ? _append(seed, add) : seed
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
      for (const [tf, L] of live) tfs[tf] = { build: L.build, asof: L.index.asof, gen: L.gen, count: L.index.count, bytes: L.bytes, comp: L.index.comp, bad: L.bad }
      return { tfs }
    },

    /**
     * Download, verify and commit one timeframe file. `entry` = {tf, build, url, bytes, sha256,
     * encoding?: 'identity' | 'gzip'} (the manifest's per-tf entry plus its build). Resolves {tf, status: 'current' | 'ingested', ...};
     * rejects on a failure (a partial download stays on disk and resumes on the next call; a file whose
     * sha256 does not match is discarded whole). One ingest per timeframe at a time.
     */
    ingest(entry, opts = {}) {
      const tf = String(entry?.tf)
      const run = inflight.get(tf)
      if (run) return run
      const p = _ingest(entry, opts).finally(() => { if (inflight.get(tf) === p) inflight.delete(tf) })
      inflight.set(tf, p)
      return p
    },

    /** Every timeframe of a manifest (`latest.json`: {v, kind, build, tfs: {tf: entry}}), ONE AT A TIME,
     *  in STORED_TFS order. */
    async ingestAll(manifest, { signal = null, base = null } = {}) {
      const out = []
      for (const tf of STORED_TFS) {
        const e = manifest?.tfs?.[tf]
        if (!e) continue
        if (signal?.aborted) break
        const url = base ? new URL(e.url, base).href : e.url
        try { out.push(await api.ingest({ build: manifest.build, ...e, tf, url }, { signal })) } catch (err) {
          out.push({ tf, status: 'error', error: String(err?.message || err) })
        }
      }
      return out
    },

    /** The daily delta (see the header): not built yet. */
    async applyDelta() { throw new IngestError('device store: deltas are not implemented yet') },

    close() {
      for (const L of live.values()) { try { L.handle.close() } catch { /* gone */ } }
      live.clear()
      opening = null
    },
  }

  async function _ingest(entry, { signal = null, onProgress = null } = {}) {
    const tf = String(entry?.tf)
    if (!STORED_TFS.includes(tf) || typeof entry.url !== 'string' || !entry.url || !entry.build
        || !Number.isSafeInteger(entry.bytes) || entry.bytes <= PACK_TAIL_BYTES || !/^[0-9a-f]{64}$/.test(entry.sha256 || '')) {
      throw new IngestError(`ingest: bad manifest entry for ${tf}`)
    }
    await api.open()
    const cur = live.get(tf)
    if (cur && cur.build === entry.build && cur.bytes === entry.bytes) return { tf, status: 'current', build: cur.build }

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
      _install(tf, { gen, build: entry.build, handle: h, index, bytes: entry.bytes })
      h = null
      try { await io.remove(progName(tf, gen)) } catch { /* harmless */ }
      for (const g of gens.keys()) if (g !== gen) await _removeGen(tf, g)
      try { onEvent?.({ type: 'gen', tf, build: entry.build, gen }) } catch { /* listener */ }
      return { tf, status: 'ingested', build: entry.build, count: index.count }
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
