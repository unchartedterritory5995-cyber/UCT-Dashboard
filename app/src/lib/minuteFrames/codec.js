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
/** A DAILY section follows the blocks: the server's day row per symbol (api/services/minute_frames.py). */
export const FLAG_DAILY = 0x04
/** Every flag bit this decoder understands. A frame with any other bit is REFUSED (permanently, see
 *  FrameError.frame): a future bit may change what the bytes mean, and a misread frame is worse than a gap. */
export const KNOWN_FLAGS = FLAG_AV | FLAG_INCOMPLETE | FLAG_DAILY
export const NO_SEQ = 0xFFFFFFFF
export const KIND_ONTIME = 0
export const KIND_LATE = 1
export const KIND_REPLACE = 2
export const RAW_SCALE = 15
export const SESSION_START_MIN = 240
export const SESSION_MINUTES = 960

const POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8]

/** A frame that cannot be read. `frame` is set when the CRC proved the bytes are the publisher's own (so the
 *  refusal is PERMANENT, a retry gets the same bytes): its header { day, seq, prevSeq, epoch, minute, flags },
 *  which lets a reader account for the minute as a gap and move on (consumer.js) instead of asking again. */
export class FrameError extends Error {
  constructor(message, frame = null) { super(message); this.frame = frame }
}

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
 *     n, sym: Uint32Array, o, h, l, c, v: Float64Array, av: Float64Array|null (NaN = absent),
 *     daily: null | { n, sym: Uint32Array, o, h, l, c, v: Float64Array } }   // FLAG_DAILY: the server's day rows
 */
export function decodeFrame(u8, start = 0, end = u8.length) {
  const b = u8
  if (end - start < 32) throw new FrameError('truncated')
  if (magicAt(b, start) !== MAGIC) throw new FrameError('not a minute frame')
  if (b[start + 4] !== VERSION) throw new FrameError(`unsupported version ${b[start + 4]}`)
  checkCrc(b, start, end)
  const flags = b[start + 5]
  const head = { day: u32(b, start + 8), seq: u32(b, start + 12), prevSeq: u32(b, start + 16),
    epoch: u32(b, start + 20), minute: u32(b, start + 24), flags }
  // past the CRC every refusal is permanent: the bytes are what the publisher wrote
  try {
    return _decodeBody(b, start, end, head)
  } catch (e) {
    if (e instanceof FrameError && !e.frame) e.frame = head
    throw e
  }
}

function _decodeBody(b, start, end, head) {
  const { flags } = head
  if (flags & ~KNOWN_FLAGS) throw new FrameError(`unknown flags 0x${flags.toString(16)}`)
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

  /** Columns of records, grown by doubling. */
  const columns = (cap, withAv) => ({ cap, n: 0, sym: new Uint32Array(cap), o: new Float64Array(cap),
    h: new Float64Array(cap), l: new Float64Array(cap), c: new Float64Array(cap), v: new Float64Array(cap),
    av: withAv ? new Float64Array(cap) : null })
  const grow = (c) => {
    c.cap *= 2
    const g = (a, T) => { const x = new T(c.cap); x.set(a); return x }
    c.sym = g(c.sym, Uint32Array); c.o = g(c.o, Float64Array); c.h = g(c.h, Float64Array); c.l = g(c.l, Float64Array)
    c.c = g(c.c, Float64Array); c.v = g(c.v, Float64Array); if (c.av) c.av = g(c.av, Float64Array)
  }
  /** `n` records (the block record layout, api/services/minute_frames.py) appended to `cols`. */
  const records = (cols, n) => {
    const withAv = cols.av !== null
    let idx = -1
    for (let r = 0; r < n; r++) {
      if (cols.n >= cols.cap) grow(cols)
      const row = cols.n
      idx += varint() + 1
      if (idx >= nSym) throw new FrameError('symbol index out of range')
      if (pos >= stop) throw new FrameError('truncated record')
      const sc = b[pos++]
      const k = sc & 0x0F, kv = sc >> 4
      if (k === RAW_SCALE) {
        if (pos + 32 > stop) throw new FrameError('truncated record')
        cols.o[row] = dv.getFloat64(pos, true); cols.h[row] = dv.getFloat64(pos + 8, true)
        cols.l[row] = dv.getFloat64(pos + 16, true); cols.c[row] = dv.getFloat64(pos + 24, true)
        pos += 32
      } else {
        if (k > 8) throw new FrameError('bad price scale')
        const o = zz(), dc = zz(), dh = zz(), dl = zz()
        const c = o + dc
        const p = POW10[k]
        cols.o[row] = o / p; cols.c[row] = c / p
        cols.h[row] = (Math.max(o, c) + dh) / p
        cols.l[row] = (Math.min(o, c) - dl) / p
      }
      if (kv === RAW_SCALE) {
        if (pos + (withAv ? 16 : 8) > stop) throw new FrameError('truncated record')
        cols.v[row] = dv.getFloat64(pos, true); pos += 8
        if (withAv) { cols.av[row] = dv.getFloat64(pos, true); pos += 8 }
      } else {
        if (kv > 8) throw new FrameError('bad volume scale')
        cols.v[row] = varint() / POW10[kv]
        if (withAv) { const a = varint(); cols.av[row] = a === 0 ? NaN : (a - 1) / POW10[kv] }
      }
      cols.sym[row] = idx
      cols.n++
    }
  }

  const withAv = (flags & FLAG_AV) !== 0
  const rows = columns(Math.max(16, nSym + 16), withAv)
  const nBlocks = varint()
  const blocks = []
  for (let bi = 0; bi < nBlocks; bi++) {
    const bmin = varint()
    if (pos >= stop) throw new FrameError('truncated block')
    const kind = b[pos++]
    const n = varint()
    const first = rows.n
    records(rows, n)
    blocks.push({ minute: bmin, kind, start: first, end: rows.n })
  }
  // FLAG_DAILY: varint count, then records WITHOUT av (whatever FLAG_AV says): each symbol's day row
  let daily = null
  if (flags & FLAG_DAILY) {
    const n = varint()
    const d = columns(Math.max(1, Math.min(n, nSym)), false)
    records(d, n)
    daily = { n: d.n, sym: d.sym.subarray(0, d.n), o: d.o.subarray(0, d.n), h: d.h.subarray(0, d.n),
      l: d.l.subarray(0, d.n), c: d.c.subarray(0, d.n), v: d.v.subarray(0, d.n) }
  }
  if (pos !== stop) throw new FrameError('trailing bytes')
  const row = rows.n
  return {
    ...head, withAv,
    complete: (flags & FLAG_INCOMPLETE) === 0,
    symbols, blocks, n: row,
    sym: rows.sym.subarray(0, row), o: rows.o.subarray(0, row), h: rows.h.subarray(0, row), l: rows.l.subarray(0, row),
    c: rows.c.subarray(0, row), v: rows.v.subarray(0, row), av: rows.av ? rows.av.subarray(0, row) : null,
    daily,
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
 *  never all of them in memory at once). `refused: true`: a frame this decoder permanently refuses
 *  (FrameError.frame, e.g. a flag bit it does not know) is yielded as `{ refused: true, error, ...header }`
 *  in its place instead of ending the walk (the file's own CRC already proved every byte). */
export function* todayFrames(u8, { refused = false } = {}) {
  const info = todayInfo(u8)
  const end = u8.length - 12
  let pos = 16, count = 0
  while (pos < end) {
    if (pos + 4 > end) throw new FrameError('truncated')
    const len = u32(u8, pos)
    pos += 4
    if (pos + len > end) throw new FrameError('truncated')
    let f
    try { f = decodeFrame(u8, pos, pos + len) } catch (e) {
      if (!refused || !(e instanceof FrameError) || !e.frame) throw e
      f = { refused: true, error: e.message, ...e.frame }
    }
    yield f
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

/** The DAILY rows of a decoded frame as plain objects ({ sym, o, h, l, c, v }; [] without the section). */
export function dailyRows(f) {
  const d = f?.daily
  if (!d) return []
  const out = new Array(d.n)
  for (let r = 0; r < d.n; r++) out[r] = { sym: f.symbols[d.sym[r]], o: d.o[r], h: d.h[r], l: d.l[r], c: d.c[r], v: d.v[r] }
  return out
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
