// History-lake piece reader (.ubh, format version 1).
//
// The browser half of tools/history_lake/piece.py. The format and the decoding procedure are
// tools/history_lake/FORMAT.md, sections 3 and 4; this file follows that procedure step by step and
// is pinned to the Python encoder by piece.test.js (pieces built by the Python encoder, decoded here).
//
// One piece = one symbol, one series, one period, RAW (unadjusted) prices. Every decoded value is an
// integer below 2^53, so plain Numbers (Float64Array) hold all of them exactly.
//
// The body is one Brotli stream. Decompression is a parameter (`inflate`) so the decoder itself has
// no dependency and runs anywhere; `nativeBrotliInflate` is the platform one where it exists.

export class PieceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PieceError'
  }
}

export const FORMAT_VERSION = 1
export const T_UNIT = Object.freeze({ 1: 60, 5: 300, 15: 900, 30: 1800, 60: 1800, '60e': 3600 })
export const SERIES_IDS = Object.freeze(['1', '5', '15', '30', '60', '60e'])
export const COLUMNS = Object.freeze(['t', 'o', 'h', 'l', 'c', 'v', 'n'])
const MAX_VALUE = Number.MAX_SAFE_INTEGER // 2^53 - 1
const HEADER_KEYS = ['v', 'basis', 'symbol', 'series', 'period', 'bars', 'first', 'last',
  'tunit', 'pscale', 'vscale', 'body', 'crc']
const POWERS_OF_TEN = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]
const PERIOD_RE = { 1: /^\d{4}-(0[1-9]|1[0-2])$/, 5: /^\d{4}Q[1-4]$/ }
const YEAR_RE = /^\d{4}$/

const fail = (message) => { throw new PieceError(message) }

// ---- CRC-32 (IEEE, the zlib one) ---------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table[i] = c >>> 0
  }
  return table
})()

/** CRC-32 of `bytes`, continuing from `crc` (0 to start). Same contract as zlib.crc32. */
export function crc32(bytes, crc = 0) {
  let c = (crc ^ 0xFFFFFFFF) >>> 0
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

// ---- paths --------------------------------------------------------------------------------------
/** `s-` + the ticker, every byte outside A-Z / 0-9 written as `_` + two upper-case hex digits. */
export function encodeSymbol(symbol) {
  if (typeof symbol !== 'string' || !symbol) fail('symbol must be a non-empty string')
  let out = 's-'
  for (const b of new TextEncoder().encode(symbol)) {
    out += (b >= 48 && b <= 57) || (b >= 65 && b <= 90)
      ? String.fromCharCode(b)
      : '_' + b.toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

function checkPeriodForm(series, period) {
  const rx = PERIOD_RE[series] || YEAR_RE
  if (typeof period !== 'string' || !rx.test(period)) {
    fail(`period ${JSON.stringify(period)} is not a valid period for series ${JSON.stringify(series)}`)
  }
}

/** `v1/<series>/<encoded symbol>/<period>.ubh` */
export function pieceRelpath(series, symbol, period) {
  if (!Object.hasOwn(T_UNIT, series)) fail(`unknown series ${JSON.stringify(series)}`)
  checkPeriodForm(series, period)
  return `v${FORMAT_VERSION}/${series}/${encodeSymbol(symbol)}/${period}.ubh`
}

/** `v1/index/<encoded symbol>.json` */
export function indexRelpath(symbol) {
  return `v${FORMAT_VERSION}/index/${encodeSymbol(symbol)}.json`
}

/** Period id holding bars of ET calendar date (y, m) for `series`. */
export function periodOf(series, year, month) {
  if (!Object.hasOwn(T_UNIT, series)) fail(`unknown series ${JSON.stringify(series)}`)
  const y = String(year).padStart(4, '0')
  if (series === '1') return `${y}-${String(month).padStart(2, '0')}`
  if (series === '5') return `${y}Q${Math.floor((month - 1) / 3) + 1}`
  return y
}

// ---- prefix (FORMAT.md section 4, steps 1-4) ------------------------------------------------------
const isCount = (x) => Number.isSafeInteger(x) && x >= 0

/** Validate magic, version, header CRC and header fields. Returns `{ header, offset }` where
 *  `offset` is the first byte of the Brotli body. No decompression. */
export function parsePrefix(data) {
  if (!(data instanceof Uint8Array)) fail('piece must be a Uint8Array')
  if (data.length < 10) fail(`truncated piece: ${data.length} bytes`)
  if (data[0] !== 0x55 || data[1] !== 0x42 || data[2] !== 0x48) fail('bad magic: not a history-lake piece')
  if (data[3] !== FORMAT_VERSION) fail(`unsupported format version ${data[3]} (this reader knows ${FORMAT_VERSION})`)
  const hlen = data[4] + 256 * data[5]
  const end = 6 + hlen
  if (data.length < end + 4) fail('truncated piece: header incomplete')
  const stored = (data[end] + 256 * data[end + 1] + 65536 * data[end + 2] + 16777216 * data[end + 3]) >>> 0
  if (crc32(data.subarray(0, end)) !== stored) fail('header CRC mismatch')
  let header
  try {
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(6, end)))
  } catch (err) {
    fail(`header is not valid JSON: ${err && err.message}`)
  }
  return { header: checkHeader(header), offset: end + 4 }
}

/** Validate a parsed header object (FORMAT.md section 4, step 4). Returns it; throws PieceError. */
export function checkHeader(header) {
  if (header === null || typeof header !== 'object' || Array.isArray(header)
      || HEADER_KEYS.some((k) => !Object.hasOwn(header, k))) fail('header is missing required keys')
  if (header.v !== FORMAT_VERSION) fail('header version does not match the version byte')
  if (header.basis !== 'raw') fail(`unsupported basis ${JSON.stringify(header.basis)}`)
  const series = header.series
  if (typeof series !== 'string' || !Object.hasOwn(T_UNIT, series) || header.tunit !== T_UNIT[series]) {
    fail('header series/tunit are inconsistent')
  }
  for (const key of ['bars', 'first', 'last', 'body', 'crc']) {
    if (!isCount(header[key])) fail(`header field ${JSON.stringify(key)} is not a non-negative integer`)
  }
  if (header.bars < 1) fail('header says the piece has no bars')
  if (!POWERS_OF_TEN.includes(header.pscale) || !POWERS_OF_TEN.includes(header.vscale)) {
    fail('header scales are not powers of ten')
  }
  if (typeof header.symbol !== 'string' || !header.symbol) fail('header symbol is empty')
  checkPeriodForm(series, header.period)
  return header
}

/** The validated header only. */
export function readHeader(data) {
  return parsePrefix(data).header
}

// ---- body (steps 6-8) -----------------------------------------------------------------------------
function columnsCrc(cols, n) {
  const buf = new Uint8Array(n * 8)
  const view = new DataView(buf.buffer)
  let crc = 0
  for (const name of COLUMNS) {
    const col = cols[name]
    for (let i = 0; i < n; i++) {
      const value = col[i]
      const high = Math.floor(value / 4294967296)
      view.setUint32(i * 8, value - high * 4294967296, true)
      view.setUint32(i * 8 + 4, high, true)
    }
    crc = crc32(buf, crc)
  }
  return crc
}

const unzz = (u) => (u % 2 === 0 ? u / 2 : -(u + 1) / 2)

/** Decode a DEcompressed body against its validated header. Returns
 *  `{ header, t, o, h, l, c, v, n }`: Float64Arrays of exact integers (`t` epoch seconds, prices at
 *  `header.pscale`, volume at `header.vscale`). Throws PieceError on any failed check. */
export function decodeBody(header, body) {
  if (!(body instanceof Uint8Array)) fail('body must be a Uint8Array')
  if (body.length !== header.body) fail(`body is ${body.length} bytes, header says ${header.body}`)
  const n = header.bars
  const { tunit, vscale } = header
  const len = body.length
  // a varint is at least one byte: a header claiming more bars than the body can hold is corrupt,
  // and must be refused BEFORE it sizes an allocation
  if (n * 8 > len) fail(`body holds fewer than ${n * 8} values`)

  let pos = 0
  const raw = new Array(8)
  for (let k = 0; k < 8; k++) {
    const col = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let value = 0
      let mult = 1
      let count = 0
      let byte
      do {
        if (pos >= len) fail('body ends inside a varint')
        byte = body[pos++]
        if (++count > 8) fail('varint longer than 8 bytes')
        value += (byte & 0x7F) * mult // multiply: shifts are 32-bit
        mult *= 128
      } while (byte >= 0x80)
      if (byte === 0 && count > 1) fail('non-canonical varint')
      if (value > MAX_VALUE) fail('value above 2**53 - 1')
      col[i] = value
    }
    raw[k] = col
  }
  if (pos !== len) fail('body has bytes left over after the last column')
  const [T, O, H, L, C, V, VF, N] = raw

  const t = new Float64Array(n)
  const o = new Float64Array(n)
  const h = new Float64Array(n)
  const l = new Float64Array(n)
  const c = new Float64Array(n)
  const v = new Float64Array(n)
  const inRange = (x) => x >= 0 && x <= MAX_VALUE
  let prevT = 0
  let prevC = 0
  for (let i = 0; i < n; i++) {
    const ti = prevT + T[i] * tunit
    const oi = prevC + unzz(O[i])
    const ci = oi + unzz(C[i])
    const hi = Math.max(oi, ci) + unzz(H[i])
    const li = Math.min(oi, ci) - unzz(L[i])
    if (VF[i] >= vscale) fail('fractional volume is not below vscale')
    const vi = V[i] * vscale + VF[i]
    if (!inRange(ti)) fail("decoded column 't' is out of range")
    if (!inRange(oi)) fail("decoded column 'o' is out of range")
    if (!inRange(hi)) fail("decoded column 'h' is out of range")
    if (!inRange(li)) fail("decoded column 'l' is out of range")
    if (!inRange(ci)) fail("decoded column 'c' is out of range")
    if (!inRange(vi)) fail("decoded column 'v' is out of range")
    if (i > 0 && ti <= prevT) fail('decoded bar times are not strictly increasing')
    t[i] = ti; o[i] = oi; h[i] = hi; l[i] = li; c[i] = ci; v[i] = vi
    prevT = ti
    prevC = ci
  }
  if (t[0] !== header.first || t[n - 1] !== header.last) fail('first/last bar time does not match the header')
  const cols = { t, o, h, l, c, v, n: N }
  if (columnsCrc(cols, n) !== header.crc) fail('column CRC mismatch')
  return { header, ...cols }
}

// ---- whole piece ----------------------------------------------------------------------------------
let _nativeBrotli // undefined = not probed yet

/** True when this platform can inflate Brotli itself (DecompressionStream('brotli')). */
export function hasNativeBrotli() {
  if (_nativeBrotli === undefined) {
    try {
      // eslint-disable-next-line no-new
      new DecompressionStream('brotli')
      _nativeBrotli = true
    } catch {
      _nativeBrotli = false
    }
  }
  return _nativeBrotli
}

/** Inflate one whole Brotli stream with the platform decoder. Rejects on a corrupt or truncated
 *  stream and on trailing bytes after it. */
export async function nativeBrotliInflate(bytes) {
  if (!hasNativeBrotli()) fail('this platform has no Brotli decoder')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('brotli'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Decode a piece. `inflate(bytes) -> Uint8Array | Promise<Uint8Array>` decompresses ONE Brotli
 *  stream (default: the platform's). Resolves `{ header, t, o, h, l, c, v, n }`; rejects with
 *  PieceError when the file is corrupt, truncated or not a piece. */
export async function decodePiece(data, inflate = nativeBrotliInflate) {
  const { header, offset } = parsePrefix(data)
  let body
  try {
    body = await inflate(data.subarray(offset))
  } catch (err) {
    if (err instanceof PieceError) throw err
    fail(`body is corrupt or truncated: ${err && err.message}`)
  }
  if (!(body instanceof Uint8Array)) body = new Uint8Array(body)
  return decodeBody(header, body)
}

/** Decode what the edge sends for a piece (edge/bars-edge-router/history.js): the header as JSON
 *  text (the `X-Ubh-Header` response header) and the body ALREADY inflated by the browser's own
 *  HTTP layer (`Content-Encoding: br`). The file's header CRC is not available on this path; the
 *  header is validated field by field and the column CRC still proves every decoded value. */
export function decodeColumns(headerJson, body) {
  let header
  try {
    header = JSON.parse(headerJson)
  } catch (err) {
    fail(`header is not valid JSON: ${err && err.message}`)
  }
  if (!(body instanceof Uint8Array)) body = new Uint8Array(body)
  return decodeBody(checkHeader(header), body)
}

/** Float prices and volume from a decoded piece: integer / scale, which is exactly the double the
 *  vendor's decimal text parses to. `t` and `n` are returned as they are. */
export function toFloats(decoded) {
  const { pscale, vscale } = decoded.header
  const div = (col, scale) => (scale === 1 ? col.slice() : col.map((x) => x / scale))
  return {
    t: decoded.t,
    o: div(decoded.o, pscale),
    h: div(decoded.h, pscale),
    l: div(decoded.l, pscale),
    c: div(decoded.c, pscale),
    v: div(decoded.v, vscale),
    n: decoded.n,
  }
}
