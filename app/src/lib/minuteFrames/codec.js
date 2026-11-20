// app/src/lib/minuteFrames/codec.js — the browser's decoder for universe minute frames.
//
// The format is defined (and encoded) by api/services/minute_frames.py; read its header before
// changing anything here. tests/fixtures/minute_frames/ holds frames the Python encoder wrote,
// with the values they must decode to (codec.test.js), so the two cannot drift apart silently.
//
// ⭐ EXACT. Prices travel as integers at a per-record decimal scale k (or as raw float64), and
// `n / 10 ** k` here is the same IEEE division the encoder verified, so every value decodes to
// the encoder's float bit for bit. Varints carry values up to 2**51, past the 32-bit range of
// JavaScript's bitwise operators, so they are read with arithmetic, never with `<<` or `|`.
//
// ⭐ COLUMNAR. A full-market minute is ~8,500 records and the day ~1.9 M, so a frame decodes
// to typed arrays (one row per record) instead of an object per bar.

export const MAGIC = 'UMF1'
export const TODAY_MAGIC = 'UMT1'
export const VERSION = 1
export const FLAG_AV = 0x01
export const FLAG_INCOMPLETE = 0x02
export const NO_SEQ = 0xFFFFFFFF
export const KIND_ONTIME = 0
export const KIND_LATE = 1
export const KIND_REPLACE = 2
export const RAW_SCALE = 15
export const SESSION_START_MIN = 240
export const SESSION_MINUTES = 960

const POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8]

export class FrameError extends Error {}

let CRC_TABLE = null
/** Standard CRC-32 (zlib's). */
export function crc32(bytes, start = 0, end = bytes.length) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let crc = 0xFFFFFFFF
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/** True when `u8` starts with the gzip magic (the edge's `?raw=1` answer, or a test). */
export function isGzip(u8) { return u8 && u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b }

/** Inflate gzip bytes with the platform's own decoder (no Brotli, no shipped inflater). Bytes
 *  that are not gzip are returned as they are: the edge sends `Content-Encoding: gzip`, so a
 *  browser hands the page bytes the HTTP layer already inflated. */
export async function inflateIfGzip(u8) {
  if (!isGzip(u8)) return u8
  if (typeof DecompressionStream !== 'function') throw new FrameError('no gzip decoder on this platform')
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function u32(b, p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216 }

function magicAt(b, p) { return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) }

function checkCrc(b, start, end) {
  if (end - start < 4) throw new FrameError('truncated')
  if (crc32(b, start, end - 4) !== u32(b, end - 4)) throw new FrameError('crc mismatch')
}

/**
 * Decode one RAW frame (`u8[start, end)`). Returns
 *   { day, seq, prevSeq, epoch, minute, flags, complete, withAv, symbols,
 *     blocks: [{ minute, kind, start, end }],   // rows [start, end) of the columns
 *     n, sym: Uint32Array, o, h, l, c, v: Float64Array, av: Float64Array|null (NaN = absent) }
 */
export function decodeFrame(u8, start = 0, end = u8.length) {
  const b = u8
  if (end - start < 32) throw new FrameError('truncated')
  if (magicAt(b, start) !== MAGIC) throw new FrameError('not a minute frame')
  if (b[start + 4] !== VERSION) throw new FrameError(`unsupported version ${b[start + 4]}`)
  checkCrc(b, start, end)
  const flags = b[start + 5]
  const day = u32(b, start + 8)
  const seq = u32(b, start + 12)
  const prevSeq = u32(b, start + 16)
  const epoch = u32(b, start + 20)
  const minute = u32(b, start + 24)
  const stop = end - 4
  let pos = start + 28
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)

  const varint = () => {
    let n = 0, mul = 1, x
    do {
      if (pos >= stop) throw new FrameError('truncated varint')
      x = b[pos++]
      n += (x & 0x7F) * mul
      mul *= 128
    } while (x & 0x80)
    return n
  }
  const zz = () => { const z = varint(); return z % 2 === 0 ? z / 2 : -(z + 1) / 2 }

  const nSym = varint()
  const symbols = new Array(nSym)
  let prev = ''
  for (let i = 0; i < nSym; i++) {
    if (pos + 2 > stop) throw new FrameError('truncated symbol table')
    const shared = b[pos], len = b[pos + 1]
    pos += 2
    let s = prev.slice(0, shared)
    for (let k = 0; k < len; k++) s += String.fromCharCode(b[pos + k])
    pos += len
    symbols[i] = s
    prev = s
  }

  const withAv = (flags & FLAG_AV) !== 0
  let cap = Math.max(16, nSym + 16)
  let sym = new Uint32Array(cap)
  let O = new Float64Array(cap), H = new Float64Array(cap), L = new Float64Array(cap)
  let C = new Float64Array(cap), V = new Float64Array(cap)
  let AV = withAv ? new Float64Array(cap) : null
  const grow = () => {
    cap *= 2
    const g = (a, T) => { const x = new T(cap); x.set(a); return x }
    sym = g(sym, Uint32Array); O = g(O, Float64Array); H = g(H, Float64Array); L = g(L, Float64Array)
    C = g(C, Float64Array); V = g(V, Float64Array); if (AV) AV = g(AV, Float64Array)
  }

  const nBlocks = varint()
  const blocks = []
  let row = 0
  for (let bi = 0; bi < nBlocks; bi++) {
    const bmin = varint()
    if (pos >= stop) throw new FrameError('truncated block')
    const kind = b[pos++]
    const n = varint()
    const first = row
    let idx = -1
    for (let r = 0; r < n; r++) {
      if (row >= cap) grow()
      idx += varint() + 1
      if (idx >= nSym) throw new FrameError('symbol index out of range')
      if (pos >= stop) throw new FrameError('truncated record')
      const sc = b[pos++]
      const k = sc & 0x0F, kv = sc >> 4
      if (k === RAW_SCALE) {
        if (pos + 32 > stop) throw new FrameError('truncated record')
        O[row] = dv.getFloat64(pos, true); H[row] = dv.getFloat64(pos + 8, true)
        L[row] = dv.getFloat64(pos + 16, true); C[row] = dv.getFloat64(pos + 24, true)
        pos += 32
      } else {
        if (k > 8) throw new FrameError('bad price scale')
        const o = zz(), dc = zz(), dh = zz(), dl = zz()
        const c = o + dc
        const p = POW10[k]
        O[row] = o / p; C[row] = c / p
        H[row] = (Math.max(o, c) + dh) / p
        L[row] = (Math.min(o, c) - dl) / p
      }
      if (kv === RAW_SCALE) {
        if (pos + (withAv ? 16 : 8) > stop) throw new FrameError('truncated record')
        V[row] = dv.getFloat64(pos, true); pos += 8
        if (withAv) { AV[row] = dv.getFloat64(pos, true); pos += 8 }
      } else {
        if (kv > 8) throw new FrameError('bad volume scale')
        V[row] = varint() / POW10[kv]
        if (withAv) { const a = varint(); AV[row] = a === 0 ? NaN : (a - 1) / POW10[kv] }
      }
      sym[row] = idx
      row++
    }
    blocks.push({ minute: bmin, kind, start: first, end: row })
  }
  if (pos !== stop) throw new FrameError('trailing bytes')
  return {
    day, seq, prevSeq, epoch, minute, flags, withAv,
    complete: (flags & FLAG_INCOMPLETE) === 0,
    symbols, blocks, n: row,
    sym: sym.subarray(0, row), o: O.subarray(0, row), h: H.subarray(0, row), l: L.subarray(0, row),
    c: C.subarray(0, row), v: V.subarray(0, row), av: AV ? AV.subarray(0, row) : null,
  }
}

/** Read the header of a RAW "today so far" file: { day, epoch, seq, n }. Proves the CRC. */
export function todayInfo(u8) {
  const b = u8
  if (b.length < 16 + 12) throw new FrameError('truncated')
  if (magicAt(b, 0) !== TODAY_MAGIC) throw new FrameError('not a today file')
  if (b[4] !== VERSION) throw new FrameError(`unsupported version ${b[4]}`)
  checkCrc(b, 0, b.length)
  const t = b.length - 12
  return { day: u32(b, 8), epoch: u32(b, 12), n: u32(b, t), seq: u32(b, t + 4) }
}

/** Every frame of a RAW today file, decoded one at a time (a full-market day is ~1.9 M rows:
 *  never all of them in memory at once). */
export function* todayFrames(u8) {
  const info = todayInfo(u8)
  const end = u8.length - 12
  let pos = 16, count = 0
  while (pos < end) {
    if (pos + 4 > end) throw new FrameError('truncated')
    const len = u32(u8, pos)
    pos += 4
    if (pos + len > end) throw new FrameError('truncated')
    yield decodeFrame(u8, pos, pos + len)
    pos += len
    count++
  }
  if (count !== info.n) throw new FrameError('frame count mismatch')
}

/** `HHMM` of a seq (the minute file's name): seq 0 = 04:00 ET. */
export function hhmmOfSeq(seq) {
  const m = SESSION_START_MIN + seq
  return String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0')
}

/** The rows of a decoded frame as plain objects (tests and diagnostics; not the hot path). */
export function frameRows(f) {
  const out = []
  for (const blk of f.blocks) {
    for (let r = blk.start; r < blk.end; r++) {
      const row = { minute: blk.minute, kind: blk.kind, sym: f.symbols[f.sym[r]],
        o: f.o[r], h: f.h[r], l: f.l[r], c: f.c[r], v: f.v[r] }
      if (f.av) row.av = Number.isNaN(f.av[r]) ? null : f.av[r]
      out.push(row)
    }
  }
  return out
}
