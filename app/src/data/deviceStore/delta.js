// app/src/data/deviceStore/delta.js — the first-frame seed's DAILY DELTA (`UFFSDLT2`), as the device applies it.
//
// ⭐ THE CONTRACT IS docs/charts/first-frame-seed-format.md section 10; the server's builder and reference
// applier are api/services/ffseed_delta.py (`build_delta`, `apply_delta_iter`). A device holding build N of a
// timeframe downloads the delta N → N+1 instead of the whole pack and rebuilds the new pack's records from its
// own copy of N:
//
//     blob 0 | ... | blob k-1 | trailer (gzip of ASCII JSON) | u64 LE trailer length | "UFFSDLT2"
//
// Version 1 ("UFFSDLT1", the same JSON uncompressed, `v` 1) is still read; the server writes version 2 (the
// JSON trailer is ~0.3 MB a timeframe, gzip takes it to ~0.06-0.09 MB).
//
// trailer = {v:2, kind:"ffseed-delta", tf, tunit, comp, build (NEW), base, base_asof, asof, depth, basis, grid,
//            fields:[12 names], symbols:{SYM:[op,off,len,rows,bars,first,last,asof,crc,body,pscale,vscale]}}
// op: 0 keep · 1 merge · 2 replace · 3 remove. `bars first last crc pscale vscale` are the NEW window's, exactly
// as the new full pack's entry states them.
//
// ⭐ WHAT PROVES THE RESULT, AND WHERE: this file COMPUTES the new build's records; the engine PROVES them
// (engine.js `_ingestDelta`): the delta file's own sha256 against the manifest before it is parsed, and after
// the new file is written, ONE read-back of every record through the reader (codec.decodeRecord →
// historyLake/piece.js `decodeBody`, the one owner of the column rule) against the new build's entry: bars,
// first, last and the column CRC the server computed for its full pack. The rebuilt pack is NOT byte-identical
// to the server's (the device re-gzips with fflate, the server with zlib), so the manifest's full-pack sha256
// cannot be the check; the format's stated check (section 10, apply step 4) is, on the bytes as stored.
// Anything that fails, here or there, throws: the engine discards the delta and downloads the full pack.
//
// Production encodes here and only here: a keep/merge window is a new body (format section 4). The test
// encoder (testing/fixtures.js) builds packs from served rows; this one encodes exact integer columns.

import { gunzipSync, gzipSync } from 'fflate'
import { DeviceFormatError, PACK_TAIL_BYTES, SEED_TUNIT, hasComp, inflateBlob } from './codec'

export const DELTA_MAGIC = 'UFFSDLT2'
/** The magics this reader takes → their version (2: gzip trailer; 1: plain JSON trailer). */
export const DELTA_VERSIONS = new Map([[DELTA_MAGIC, 2], ['UFFSDLT1', 1]])
/** A delta entry's 12 numbers, in order (the same in versions 1 and 2). */
export const DELTA_FIELDS = Object.freeze(['op', 'off', 'len', 'rows', 'bars', 'first', 'last', 'asof', 'crc', 'body', 'pscale', 'vscale'])
export const OP = Object.freeze({ keep: 0, merge: 1, replace: 2, remove: 3 })

const fail = (m) => { throw new DeviceFormatError(m) }
const POWERS_OF_TEN = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]
const MAX = Number.MAX_SAFE_INTEGER
const _utf8 = new TextDecoder('utf-8', { fatal: true })
/** Symbols in code-point order (the pack's blob order; every ticker is ASCII). */
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** comp → (body) => blob. The device writes the delta's own comp, so the new file reads like a full one. */
const COMPRESS = new Map([
  ['raw', (body) => body],
  // level 1: measured on 800 x 1000-bar 60m records, 1.5% more bytes than level 6 for 30% less time
  ['gzip', (body) => gzipSync(body, { level: 1, mtime: 0 })],
])

// ── the container ────────────────────────────────────────────────────────────

/**
 * Parse a whole delta file. `tf` = the timeframe it was downloaded for (must be the trailer's). Returns
 * {tf, tunit, comp, build, base, baseAsof, asof, depth, basis, grid, dataEnd, symbols: Map sym → entry[12]}.
 * Throws DeviceFormatError on anything a version-2 (or version-1) delta cannot be.
 */
export function parseDelta(bytes, { tf = null } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < PACK_TAIL_BYTES + 2) fail('delta: too small')
  const n = bytes.length
  const version = DELTA_VERSIONS.get(String.fromCharCode(...bytes.subarray(n - 8)))
  if (!version) fail('delta: not a UFFSDLT2 or UFFSDLT1 file')
  const dv = new DataView(bytes.buffer, bytes.byteOffset + n - PACK_TAIL_BYTES, 8)
  const tlen = dv.getUint32(0, true) + dv.getUint32(4, true) * 4294967296
  const dataEnd = n - PACK_TAIL_BYTES - tlen
  if (!Number.isSafeInteger(tlen) || tlen < 2 || dataEnd < 0) fail('delta: bad trailer length')
  let tr
  try {
    const raw = bytes.subarray(dataEnd, dataEnd + tlen)
    tr = JSON.parse(_utf8.decode(version === 2 ? gunzipSync(raw) : raw))
  } catch { fail(`delta: trailer is not ${version === 2 ? 'gzip ' : ''}JSON`) }
  if (!tr || typeof tr !== 'object' || tr.v !== version || tr.kind !== 'ffseed-delta') fail(`delta: not an ffseed-delta v${version} trailer`)
  if (!Array.isArray(tr.fields) || tr.fields.length !== DELTA_FIELDS.length || tr.fields.some((f, i) => f !== DELTA_FIELDS[i])) {
    fail('delta: unknown entry fields')
  }
  const T = String(tr.tf)
  if (!Object.hasOwn(SEED_TUNIT, T) || tr.tunit !== SEED_TUNIT[T]) fail('delta: tf / tunit')
  if (tf != null && String(tf) !== T) fail(`delta: holds tf ${T}, expected ${tf}`)
  if (!hasComp(tr.comp) || !COMPRESS.has(tr.comp)) fail(`delta: unknown comp ${JSON.stringify(tr.comp)}`)
  if (typeof tr.build !== 'string' || !tr.build || typeof tr.base !== 'string' || !tr.base || tr.base === tr.build) fail('delta: build / base')
  if (!tr.symbols || typeof tr.symbols !== 'object' || Array.isArray(tr.symbols)) fail('delta: no symbols')
  const symbols = new Map()
  for (const [sym, e] of Object.entries(tr.symbols)) {
    if (!Array.isArray(e) || e.length !== DELTA_FIELDS.length || !e.every((x) => Number.isSafeInteger(x) && x >= 0)) fail(`delta: entry ${sym}`)
    const [op, off, len, rows, bars, first, last, , , body, pscale, vscale] = e
    if (op > OP.remove) fail(`delta: entry ${sym} op ${op}`)
    if (off + len > dataEnd) fail(`delta: entry ${sym} out of range`)
    if (op === OP.remove) { symbols.set(sym, e); continue }
    if (op === OP.keep ? (len !== 0 || rows !== 0) : (len < 1 || rows < 1 || body < 8 * rows)) fail(`delta: entry ${sym} blob`)
    if (op === OP.replace && rows !== bars) fail(`delta: entry ${sym} replace holds ${rows} of ${bars} bars`)
    if (bars < 1 || first > last || !POWERS_OF_TEN.includes(pscale) || !POWERS_OF_TEN.includes(vscale)) fail(`delta: entry ${sym} window`)
    symbols.set(sym, e)
  }
  return {
    tf: T, tunit: tr.tunit, comp: tr.comp, build: tr.build, base: tr.base, baseAsof: tr.base_asof ?? null,
    asof: tr.asof ?? null, depth: tr.depth ?? null, basis: tr.basis ?? null, grid: tr.grid ?? null, dataEnd, symbols,
  }
}

/** The new build's symbol set and bar total (every entry but `remove`), for the manifest cross-check. */
export function newSetOf(delta) {
  let count = 0, bars = 0
  for (const e of delta.symbols.values()) if (e[0] !== OP.remove) { count++; bars += e[4] }
  return { count, bars }
}

// ── the columns ──────────────────────────────────────────────────────────────

const COLS = ['t', 'o', 'h', 'l', 'c', 'v', 'n']
const unzz = (u) => (u % 2 === 0 ? u / 2 : -(u + 1) / 2)
const zz = (x) => (x >= 0 ? 2 * x : -2 * x - 1)

/** A body's rows: section 5 step 5 WITHOUT the column CRC (the applied window's CRC, checked once by the
 *  engine's read-back, proves them). A merge blob (section 10 apply step 3) and a base record both decode
 *  here. Exact integer columns at the record's scales. */
function _rows(body, n, tunit, vscale) {
  const len = body.length
  if (n * 8 > len) fail('rows: body holds fewer than 8 values a row')
  const raw = new Array(8)
  let pos = 0
  for (let k = 0; k < 8; k++) {
    const col = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let value = 0, mult = 1, count = 0, byte
      do {
        if (pos >= len) fail('rows: body ends inside a varint')
        byte = body[pos++]
        if (++count > 8) fail('rows: varint longer than 8 bytes')
        value += (byte & 0x7f) * mult       // multiply: shifts are 32-bit
        mult *= 128
      } while (byte >= 0x80)
      if (byte === 0 && count > 1) fail('rows: non-canonical varint')
      if (value > MAX) fail('rows: value above 2**53 - 1')
      col[i] = value
    }
    raw[k] = col
  }
  if (pos !== len) fail('rows: body has bytes left over')
  const [T, O, H, L, C, V, VF, N] = raw
  const out = { len: n }
  for (const c of COLS) out[c] = new Float64Array(n)
  let pt = 0, pc = 0
  for (let i = 0; i < n; i++) {
    if (i > 0 && T[i] < 1) fail('rows: bar times are not strictly increasing')
    const t = pt + T[i] * tunit
    const o = pc + unzz(O[i])
    const c = o + unzz(C[i])
    const h = Math.max(o, c) + unzz(H[i])
    const l = Math.min(o, c) - unzz(L[i])
    if (VF[i] >= vscale) fail('rows: fractional volume is not below vscale')
    const v = V[i] * vscale + VF[i]
    for (const x of [t, o, h, l, c, v]) if (!(x >= 0 && x <= MAX)) fail('rows: a decoded value is out of range')
    out.t[i] = t; out.o[i] = o; out.h[i] = h; out.l[i] = l; out.c[i] = c; out.v[i] = v; out.n[i] = N[i]
    pt = t; pc = c
  }
  return out
}

/** Column `src[lo, hi)` from scale `from` to scale `to` (powers of ten), exactly, or throw. */
function _rescale(src, lo, hi, from, to) {
  const out = new Float64Array(hi - lo)
  if (to >= from) {
    const f = to / from
    for (let k = 0; k < out.length; k++) {
      const x = src[lo + k] * f
      if (!(x <= MAX)) fail('apply: a kept row does not fit the new scale')
      out[k] = x
    }
  } else {
    const f = from / to
    for (let k = 0; k < out.length; k++) {
      const x = src[lo + k]
      if (x % f !== 0) fail('apply: a kept row is not exact at the new scale')
      out[k] = x / f
    }
  }
  return out
}

/** Apply steps 1-2: the base rows with first <= t <= last, at the new scales. */
function _kept(b, first, last, fromP, fromV, toP, toV) {
  const t = b.t
  let lo = 0
  while (lo < t.length && t[lo] < first) lo++
  let hi = lo
  while (hi < t.length && t[hi] <= last) hi++
  const out = { len: hi - lo, t: t.slice(lo, hi), n: b.n.slice(lo, hi) }
  for (const c of ['o', 'h', 'l', 'c']) out[c] = _rescale(b[c], lo, hi, fromP, toP)
  out.v = _rescale(b.v, lo, hi, fromV, toV)
  return out
}

/** Apply step 3: `add`'s rows in place of the kept row with the same `t`, or added (both sorted). */
function _upsert(a, add) {
  const cap = a.len + add.len
  const from = new Int32Array(cap)           // >= 0: the kept row; < 0: the blob's row -1 - j
  const at = a.t, bt = add.t
  let i = 0, j = 0, k = 0
  while (i < a.len || j < add.len) {
    if (j >= add.len || (i < a.len && at[i] < bt[j])) from[k++] = i++
    else { if (i < a.len && at[i] === bt[j]) i++; from[k++] = -1 - j++ }    // a tie: the blob's row wins
  }
  const out = { len: k }
  for (const c of COLS) {
    const x = a[c], y = add[c], o = new Float64Array(k)
    for (let q = 0; q < k; q++) { const f = from[q]; o[q] = f >= 0 ? x[f] : y[-1 - f] }
    out[c] = o
  }
  return out
}

let _scratch = new Uint8Array(1 << 16)

/** A window's body (format section 4) from exact integer columns. Throws on anything the format cannot hold. */
export function encodeBody(w, tunit, vscale) {
  const n = w.len
  const need = n * 8 * 8                        // 8 columns, a varint <= 8 bytes (values <= 2^53, zz <= 2^54)
  if (_scratch.length < need) _scratch = new Uint8Array(Math.max(need, _scratch.length * 2))
  const buf = _scratch
  let pos = 0
  const put = (x) => {
    if (!(Number.isSafeInteger(x) && x >= 0)) fail(`encode: ${x} is not a varint`)
    while (x >= 128) { buf[pos++] = (x % 128) | 128; x = Math.floor(x / 128) }
    buf[pos++] = x
  }
  const { t, o, h, l, c, v } = w
  let pt = 0
  for (let i = 0; i < n; i++) {
    const d = (t[i] - pt) / tunit
    if (!Number.isInteger(d) || (i > 0 && d < 1)) fail('encode: bar times are not increasing on the tunit grid')
    put(d); pt = t[i]
  }
  let pc = 0
  for (let i = 0; i < n; i++) { put(zz(o[i] - pc)); pc = c[i] }
  for (let i = 0; i < n; i++) put(zz(h[i] - Math.max(o[i], c[i])))
  for (let i = 0; i < n; i++) put(zz(Math.min(o[i], c[i]) - l[i]))
  for (let i = 0; i < n; i++) put(zz(c[i] - o[i]))
  for (let i = 0; i < n; i++) put(Math.floor(v[i] / vscale))
  for (let i = 0; i < n; i++) put(v[i] % vscale)
  for (let i = 0; i < n; i++) put(w.n[i])
  return buf.slice(0, pos)
}

// ── the apply ────────────────────────────────────────────────────────────────

/**
 * The new build's records, one symbol at a time, in code-point order: yields `{sym, blob, entry}` where
 * `entry` is the new pack's 10-number entry (format section 3) with `off` left 0 for the writer to fill.
 * `base` = {index (codec.parseTrailer of the held build), read(i) → that row's blob bytes (may be a reused
 * buffer: consumed before the next call)}; `delta` = parseDelta(bytes); `bytes` = the delta file.
 *
 * ⛔ THIS COMPUTES, IT DOES NOT PROVE. The proof is ONE check, the engine's read-back (engine.js
 * `_ingestDelta` step 3): every record of the written file decoded by the reader against the new build's
 * entry (bars, first, last, column CRC). A second copy of that check here could never be shown to fail on
 * its own. What throws here is what cannot be computed at all: a base symbol the delta does not name, a
 * keep/merge for a symbol the base lacks, a base record or merge blob that does not decode, a kept row that
 * is not exact at the new scale.
 */
export function* applyDelta(base, delta, bytes) {
  const bi = base.index
  // "Every symbol of the base and of the new build has exactly one entry": a base symbol the delta does not
  // name would silently vanish from the device
  for (const sym of bi.row.keys()) if (!delta.symbols.has(sym)) fail(`delta: no entry for base symbol ${sym}`)
  const { tunit, comp } = delta
  const compress = COMPRESS.get(comp)
  for (const sym of [...delta.symbols.keys()].sort(byCodePoint)) {
    const e = delta.symbols.get(sym)
    const [op, off, len, rows, bars, first, last, asof, crc, body, pscale, vscale] = e
    if (op === OP.remove) continue
    let blob, bodyLen
    if (op === OP.replace) {
      // the new pack's own blob, as the server wrote it
      blob = bytes.subarray(off, off + len)
      bodyLen = body
    } else {
      const i = bi.row.get(sym)
      if (i == null) fail(`${sym}: ${op === OP.keep ? 'keep' : 'merge'} needs the symbol in the base`)
      const baseBlob = base.read(i)
      const unchanged = op === OP.keep && bi.bars[i] === bars && bi.first[i] === first && bi.last[i] === last
        && bi.crc[i] === crc && bi.pscale[i] === pscale && bi.vscale[i] === vscale
      if (unchanged && bi.comp === comp) {
        // the kept rows ARE every base row, at the same scales: the base blob is the new blob, byte for byte
        blob = baseBlob.slice()
        bodyLen = bi.body[i]
      } else {
        // the base record's columns WITHOUT its own CRC: a damaged base gives a window the read-back refuses,
        // and a second CRC pass here would be a second copy of that one check (and a third of this apply's time)
        const b = _rows(inflateBlob(bi.comp, baseBlob, bi.body[i]), bi.bars[i], tunit, bi.vscale[i])
        let w = _kept(b, first, last, bi.pscale[i], bi.vscale[i], pscale, vscale)
        if (op === OP.merge) w = _upsert(w, _rows(inflateBlob(comp, bytes.subarray(off, off + len), body), rows, tunit, vscale))
        if (!w.len) fail(`${sym}: the applied window is empty`)
        const nb = encodeBody(w, tunit, vscale)
        blob = compress(nb)
        bodyLen = nb.length
      }
    }
    yield { sym, blob, entry: [0, blob.length, bars, first, last, asof, crc, bodyLen, pscale, vscale] }
  }
}
