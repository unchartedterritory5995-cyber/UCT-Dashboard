// app/src/data/deviceStore/codec.js — the on-device bar store's file format: ONE container per
// timeframe holding every symbol's newest bars, and PLUGGABLE per-symbol record decoders.
//
// ⭐ THE CONTAINER is the history lake's pack layout (tools/history_lake/FORMAT.md §9), so the seed
// can be built by the lake's own publisher:
//
//     record 0 | record 1 | ... | trailer JSON | u64 LE trailer length | "UBHPACK1"
//
// trailer = {"v":1, "series":<tf>, "codec":<name>?, "pieces":{"<SYM>":[off,len,bars,first,last,crc],...}}
// Read once when a timeframe file is opened: the worker keeps the index in memory (compact typed
// arrays, one Map from symbol to row), and a symbol read is ONE positioned read of [off, off+len).
//
// ⭐ THE RECORD is decoded by a named codec (the manifest's / trailer's `codec`, default 'ubh1'):
//   'ubh1'  a history-lake piece (FORMAT.md §3: "UBH" v1 prefix, JSON header, header CRC, then the
//           8 varint columns) whose body is stored RAW, not Brotli: page code has no Brotli decoder
//           and the read path is synchronous. The column rule is historyLake/piece.js `decodeBody`
//           (ONE owner of it; its column CRC proves every decoded value). Transport compression is
//           the file's business (Content-Encoding, or a `.gz` file inflated while it streams in).
//   'f64'   raw little-endian Float64 columns (test fixture / a trivially decodable fallback).
// `registerCodec(name, fn)` adds another (the seed's final format, if it differs).
//
// A decoder returns { t, o, h, l, c, v }: Float64Arrays, `t` unix seconds, prices and volume as
// doubles (integer / scale: exactly the double the vendor's decimal text parses to).

import { decodeBody, crc32 } from '../historyLake/piece'

export class DeviceFormatError extends Error {
  constructor(message) { super(message); this.name = 'DeviceFormatError' }
}
const fail = (m) => { throw new DeviceFormatError(m) }

export const PACK_MAGIC = 'UBHPACK1'
/** u64 trailer length + 8-byte magic. */
export const PACK_TAIL_BYTES = 16
const MAGIC_BYTES = new TextEncoder().encode(PACK_MAGIC)
const POWERS_OF_TEN = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]

// ── records ──────────────────────────────────────────────────────────────────

const _utf8 = new TextDecoder('utf-8', { fatal: true })
const HEADER_KEYS = ['bars', 'first', 'last', 'tunit', 'pscale', 'vscale', 'body', 'crc']

/** Divide an exact-integer column by its scale, in place. */
function _scaleInPlace(col, scale) {
  if (scale !== 1) for (let i = 0; i < col.length; i++) col[i] /= scale
  return col
}

/** 'ubh1': a history-lake piece with a RAW body. Throws DeviceFormatError on any failed check. */
export function decodeUbhRecord(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 10) fail('record truncated')
  if (bytes[0] !== 0x55 || bytes[1] !== 0x42 || bytes[2] !== 0x48) fail('record: bad magic')
  if (bytes[3] !== 1) fail(`record: unsupported version ${bytes[3]}`)
  const end = 6 + bytes[4] + 256 * bytes[5]
  if (bytes.length < end + 4) fail('record: header truncated')
  const stored = (bytes[end] + 256 * bytes[end + 1] + 65536 * bytes[end + 2] + 16777216 * bytes[end + 3]) >>> 0
  if (crc32(bytes.subarray(0, end)) !== stored) fail('record: header CRC mismatch')
  let header
  try { header = JSON.parse(_utf8.decode(bytes.subarray(6, end))) } catch { fail('record: header is not JSON') }
  if (!header || typeof header !== 'object' || HEADER_KEYS.some((k) => !Number.isSafeInteger(header[k]) || header[k] < 0)) {
    fail('record: header is missing a field')
  }
  if (header.bars < 1 || header.tunit < 1) fail('record: empty')
  if (!POWERS_OF_TEN.includes(header.pscale) || !POWERS_OF_TEN.includes(header.vscale)) fail('record: scales')
  // The body must be stored RAW: a Brotli / gzip body (shorter than `header.body`) is refused by
  // decodeBody's own length check (ONE copy of that guard), as is a truncated one.
  let d
  try { d = decodeBody(header, bytes.subarray(end + 4)) } catch (e) { fail(`record: ${e?.message || e}`) }
  return {
    t: d.t,
    o: _scaleInPlace(d.o, header.pscale), h: _scaleInPlace(d.h, header.pscale),
    l: _scaleInPlace(d.l, header.pscale), c: _scaleInPlace(d.c, header.pscale),
    v: _scaleInPlace(d.v, header.vscale),
  }
}

/** 'f64': "F64C" | u32 LE n | u32 0 | t[n] o[n] h[n] l[n] c[n] v[n] as f64 LE. */
export function decodeF64Record(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) fail('record truncated')
  if (bytes[0] !== 0x46 || bytes[1] !== 0x36 || bytes[2] !== 0x34 || bytes[3] !== 0x43) fail('record: bad magic')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const n = dv.getUint32(4, true)
  if (n < 1 || bytes.length !== 12 + n * 48) fail('record: size does not match its count')
  const cols = {}
  let at = 12
  for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) {
    const col = new Float64Array(n)
    for (let i = 0; i < n; i++, at += 8) col[i] = dv.getFloat64(at, true)
    cols[k] = col
  }
  for (let i = 1; i < n; i++) if (!(cols.t[i] > cols.t[i - 1])) fail('record: times not increasing')
  return cols
}

const CODECS = new Map([['ubh1', decodeUbhRecord], ['f64', decodeF64Record]])
export const DEFAULT_CODEC = 'ubh1'

/** Add (or replace) a record decoder: `fn(bytes: Uint8Array) -> {t,o,h,l,c,v}`, synchronous. */
export function registerCodec(name, fn) {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') throw new TypeError('registerCodec(name, fn)')
  CODECS.set(name, fn)
}
export function codecFor(name) {
  const fn = CODECS.get(name || DEFAULT_CODEC)
  if (!fn) fail(`unknown record codec ${JSON.stringify(name)}`)
  return fn
}

// ── the container ────────────────────────────────────────────────────────────

/** The trailer length from the file's last PACK_TAIL_BYTES bytes. */
export function trailerLengthOf(tail, fileSize) {
  if (!(tail instanceof Uint8Array) || tail.length !== PACK_TAIL_BYTES) fail('pack: tail truncated')
  for (let i = 0; i < 8; i++) if (tail[8 + i] !== MAGIC_BYTES[i]) fail('pack: bad magic')
  const dv = new DataView(tail.buffer, tail.byteOffset, 16)
  const len = dv.getUint32(0, true) + dv.getUint32(4, true) * 4294967296
  if (!Number.isSafeInteger(len) || len < 2 || len + PACK_TAIL_BYTES > fileSize) fail('pack: bad trailer length')
  return len
}

/**
 * Parse a trailer into the in-memory index. `dataEnd` = where the trailer starts (every record must
 * lie inside [0, dataEnd)). Compact: one Map symbol → row, five Float64Arrays.
 */
export function parseTrailer(bytes, dataEnd) {
  let tr
  try { tr = JSON.parse(_utf8.decode(bytes)) } catch { fail('pack: trailer is not JSON') }
  if (!tr || typeof tr !== 'object' || tr.v !== 1 || !tr.pieces || typeof tr.pieces !== 'object') fail('pack: trailer shape')
  const syms = Object.keys(tr.pieces)
  const n = syms.length
  const off = new Float64Array(n), len = new Float64Array(n), bars = new Float64Array(n)
  const first = new Float64Array(n), last = new Float64Array(n)
  const row = new Map()
  for (let i = 0; i < n; i++) {
    const e = tr.pieces[syms[i]]
    if (!Array.isArray(e) || e.length < 5) fail(`pack: entry ${syms[i]}`)
    const [o, l, b, f, z] = e
    if (![o, l, b, f, z].every(Number.isSafeInteger) || o < 0 || l < 1 || o + l > dataEnd) fail(`pack: entry ${syms[i]} out of range`)
    off[i] = o; len[i] = l; bars[i] = b; first[i] = f; last[i] = z
    row.set(syms[i], i)
  }
  return { series: tr.series ?? null, codec: typeof tr.codec === 'string' ? tr.codec : null, build: tr.build ?? null,
    count: n, row, off, len, bars, first, last }
}

/** One index row as a plain object (diagnostics / tests). */
export function indexEntry(index, sym) {
  const i = index?.row.get(sym)
  if (i == null) return null
  return { off: index.off[i], len: index.len[i], bars: index.bars[i], first: index.first[i], last: index.last[i] }
}

/**
 * Build a pack (the seed builder's half, in JS: tests, the benchmark). `records`: [{sym, bytes, bars,
 * first, last, crc?}]. Keys sorted in the trailer, like publish.py.
 */
export function encodePack(records, { series = null, codec = null, build = null } = {}) {
  const pieces = {}
  let size = 0
  for (const r of records) size += r.bytes.length
  const body = new Uint8Array(size)
  let at = 0
  for (const r of records) {
    body.set(r.bytes, at)
    pieces[r.sym] = [at, r.bytes.length, r.bars, r.first, r.last, r.crc ?? 0]
    at += r.bytes.length
  }
  const sorted = {}
  for (const k of Object.keys(pieces).sort()) sorted[k] = pieces[k]
  const tr = { v: 1, series, pieces: sorted }
  if (codec) tr.codec = codec
  if (build) tr.build = build
  const trailer = new TextEncoder().encode(JSON.stringify(tr))
  const out = new Uint8Array(size + trailer.length + PACK_TAIL_BYTES)
  out.set(body, 0)
  out.set(trailer, size)
  const dv = new DataView(out.buffer)
  dv.setUint32(size + trailer.length, trailer.length % 4294967296, true)
  dv.setUint32(size + trailer.length + 4, Math.floor(trailer.length / 4294967296), true)
  out.set(MAGIC_BYTES, size + trailer.length + 8)
  return out
}
