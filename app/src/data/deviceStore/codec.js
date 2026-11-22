// app/src/data/deviceStore/codec.js — the first-frame seed pack, as the device store reads it.
//
// ⭐ THE CONTRACT IS docs/charts/first-frame-seed-format.md (`UFFSEED1`, version 1; the server's encoder is
// api/services/ffseed_format.py). One file per timeframe:
//
//     blob 0 | blob 1 | ... | trailer (ASCII JSON) | u64 LE trailer length | "UFFSEED1"
//
// trailer = {v:1, kind:"ffseed", tf, tunit, comp:"gzip"|"raw", build, asof, depth, fields:[10 names],
//            symbols:{SYM:[off,len,bars,first,last,asof,crc,body,pscale,vscale]}}
// Read ONCE when a timeframe file is opened: the worker keeps it as an index in memory (one Map from
// symbol to row, Float64Array columns). A symbol read is ONE positioned read of [off, off+len), the
// blob inflated (comp) to exactly `body` bytes, then historyLake/piece.js `decodeBody`: ONE owner of
// the column rule, whose column CRC proves every decoded value. price = int / pscale, volume = int /
// vscale. A failed check of any kind is a corrupt entry: never painted.
//
// ⭐ PLUGGABLE where the format says it may vary: the blob compression (`registerComp`), and the version
// (the magic's trailing digit: a `UFFSEED2` is refused until a reader for it exists).
// The inflate is SYNCHRONOUS (fflate, already an app dependency): the worker's read path is a sync
// positioned read, and the format doc measured a sync gunzip at 0.04-0.10 ms a symbol.

import { decodeBody } from '../historyLake/piece'
import { gunzipSync } from 'fflate'

export class DeviceFormatError extends Error {
  constructor(message) { super(message); this.name = 'DeviceFormatError' }
}
const fail = (m) => { throw new DeviceFormatError(m) }

export const SEED_MAGIC = 'UFFSEED1'
/** u64 trailer length + 8-byte magic. */
export const PACK_TAIL_BYTES = 16
/** A symbol entry's 10 numbers, in order (fixed in version 1; a change is a new version). */
export const SEED_FIELDS = Object.freeze(['off', 'len', 'bars', 'first', 'last', 'asof', 'crc', 'body', 'pscale', 'vscale'])
/** tf → tunit (seconds), format section 1. */
export const SEED_TUNIT = Object.freeze({ 1: 60, 5: 300, 15: 900, 30: 1800, 60: 1800, D: 86400 })
const MAGIC_BYTES = new TextEncoder().encode(SEED_MAGIC)
const POWERS_OF_TEN = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]
const _utf8 = new TextDecoder('utf-8', { fatal: true })

// ── blob compression ─────────────────────────────────────────────────────────

/** comp → (blob, bodyLength) => body bytes. fflate's `out` is sized one past the body: a gzip member that
 *  inflates SHORT or LONG comes back at the wrong length (fflate truncates silently into a too-small
 *  buffer, measured), and the length check below refuses it. */
const COMPS = new Map([
  ['raw', (blob) => blob],
  ['gzip', (blob, n) => gunzipSync(blob, { out: new Uint8Array(n + 1) })],
])
/** Add a blob compression: `fn(blob: Uint8Array, bodyLength: number) -> Uint8Array`, synchronous. */
export function registerComp(name, fn) {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') throw new TypeError('registerComp(name, fn)')
  COMPS.set(name, fn)
}
/** Is `comp` a blob compression this reader can inflate? */
export const hasComp = (comp) => COMPS.has(comp)
/** A blob → its body (`n` = the entry's decompressed length; a record's body of another length is refused
 *  by decodeBody's own length check). Throws DeviceFormatError. The ONE inflate of a blob: the daily delta
 *  (delta.js) inflates through it too. */
export function inflateBlob(comp, blob, n) {
  const fn = COMPS.get(comp)
  if (!fn) fail(`record: unknown comp ${JSON.stringify(comp)}`)
  try { return fn(blob, n) } catch (e) { fail(`record: inflate: ${e?.message || e}`) }
}

// ── the container ────────────────────────────────────────────────────────────

/** The trailer length from the file's last PACK_TAIL_BYTES bytes (magic checked). */
export function trailerLengthOf(tail, fileSize) {
  if (!(tail instanceof Uint8Array) || tail.length !== PACK_TAIL_BYTES) fail('pack: tail truncated')
  for (let i = 0; i < 8; i++) if (tail[8 + i] !== MAGIC_BYTES[i]) fail('pack: not a UFFSEED1 file')
  const dv = new DataView(tail.buffer, tail.byteOffset, 16)
  const len = dv.getUint32(0, true) + dv.getUint32(4, true) * 4294967296
  if (!Number.isSafeInteger(len) || len < 2 || len + PACK_TAIL_BYTES > fileSize) fail('pack: bad trailer length')
  return len
}

/**
 * Parse a trailer into the in-memory index. `dataEnd` = where the trailer starts (every blob must lie
 * inside [0, dataEnd)); `tf` = the timeframe this file was downloaded as (must be the trailer's).
 */
export function parseTrailer(bytes, dataEnd, { tf = null } = {}) {
  let tr
  try { tr = JSON.parse(_utf8.decode(bytes)) } catch { fail('pack: trailer is not JSON') }
  if (!tr || typeof tr !== 'object' || tr.v !== 1 || tr.kind !== 'ffseed') fail('pack: not an ffseed v1 trailer')
  if (!Array.isArray(tr.fields) || tr.fields.length !== SEED_FIELDS.length || tr.fields.some((f, i) => f !== SEED_FIELDS[i])) {
    fail('pack: unknown entry fields')
  }
  const T = String(tr.tf)
  if (!Object.hasOwn(SEED_TUNIT, T) || tr.tunit !== SEED_TUNIT[T]) fail('pack: tf / tunit')
  if (tf != null && String(tf) !== T) fail(`pack: holds tf ${T}, expected ${tf}`)
  if (!COMPS.has(tr.comp)) fail(`pack: unknown comp ${JSON.stringify(tr.comp)}`)
  if (!tr.symbols || typeof tr.symbols !== 'object') fail('pack: no symbols')
  const syms = Object.keys(tr.symbols)
  const n = syms.length
  const cols = {}
  for (const f of SEED_FIELDS) cols[f] = new Float64Array(n)
  const row = new Map()
  for (let i = 0; i < n; i++) {
    const e = tr.symbols[syms[i]]
    if (!Array.isArray(e) || e.length !== SEED_FIELDS.length || !e.every((x) => Number.isSafeInteger(x) && x >= 0)) fail(`pack: entry ${syms[i]}`)
    const [off, len, bars, , , , , , pscale, vscale] = e
    if (len < 1 || off + len > dataEnd || bars < 1) fail(`pack: entry ${syms[i]} out of range`)
    if (!POWERS_OF_TEN.includes(pscale) || !POWERS_OF_TEN.includes(vscale)) fail(`pack: entry ${syms[i]} scales`)
    for (let k = 0; k < SEED_FIELDS.length; k++) cols[SEED_FIELDS[k]][i] = e[k]
    row.set(syms[i], i)
  }
  return { tf: T, tunit: tr.tunit, comp: tr.comp, build: tr.build ?? null, asof: tr.asof ?? null, count: n, row, ...cols }
}

/** One index row as a plain object (diagnostics / tests). */
export function indexEntry(index, sym) {
  const i = index?.row.get(sym)
  if (i == null) return null
  const out = {}
  for (const f of SEED_FIELDS) out[f] = index[f][i]
  return out
}

/** Divide an exact-integer column by its scale, in place. */
function _scaleInPlace(col, scale) {
  if (scale !== 1) for (let i = 0; i < col.length; i++) col[i] /= scale
  return col
}

/**
 * Decode row `i` of `index` from its blob (exactly bytes [off, off+len) of the file). Returns
 * {t, o, h, l, c, v} Float64Arrays (t unix seconds; D: 00:00 UTC of the session date), or throws
 * DeviceFormatError. Never keeps a reference to `blob` (the caller reuses that buffer).
 */
export function decodeRecord(index, i, blob) {
  const n = index.body[i]
  const body = inflateBlob(index.comp, blob, n)
  // (a body of any length but `body` is refused by decodeBody's own length check: ONE copy of that guard)
  const header = { bars: index.bars[i], first: index.first[i], last: index.last[i], tunit: index.tunit,
    vscale: index.vscale[i], body: n, crc: index.crc[i] }
  let d
  try { d = decodeBody(header, body) } catch (e) { fail(`record: ${e?.message || e}`) }
  const ps = index.pscale[i]
  return {
    t: d.t,
    o: _scaleInPlace(d.o, ps), h: _scaleInPlace(d.h, ps), l: _scaleInPlace(d.l, ps), c: _scaleInPlace(d.c, ps),
    v: _scaleInPlace(d.v, header.vscale),
  }
}
