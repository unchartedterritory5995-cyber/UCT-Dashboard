// app/src/components/chart/engine/runtime/columnDigest.js
//
// ─── W5 T3 — THE CANONICAL COLUMN CODEC (JS HALF) ────────────────────────────────
//
// docs/pine/SERVER-RUNTIME-DESIGN.md section 2.3. The server runtime and the chart's
// worker must be provable to have produced the SAME columns, bit for bit, so both
// hosts reduce a run to one byte string and one sha256. This file is the JS half;
// `api/services/pine_runtime_codec.py` is the Python half. They are held equal by ONE
// fixture, `tests/fixtures/pine_runtime/codec_parity.json`, which `columnDigest.test.js`
// (this half) and `tests/test_pine_runtime_codec.py` (the other half) both read. A rule
// changed in one language only turns the other language's test red against the fixture.
//
// NOTHING CALLS THIS YET (T4/T6/T11 will). It is pure: no DOM, no node: module, no
// clock, no I/O, so it can sit in the compute closure (T2) and in the worker.
//
// THE ENCODING (every integer is little-endian; "str" is u32 byte length + UTF-8):
//
//   column   n * 8 bytes: one little-endian IEEE-754 Float64 per row.
//            null, undefined and EVERY NaN (any payload, either sign) -> 7FF8000000000000.
//            Pine's `na` IS a NaN in a column, so na, null, undefined and NaN are ONE
//            value on the wire. -0 stays -0 (8000000000000000): bit-identical means
//            bit-identical. +Infinity and -Infinity are their own bit patterns and are
//            NOT na.
//   preimage str("pine-runtime-columns/1")                       the codec's own tag
//            str(script_engine) str(runtime_language) str(runtime_frontend)
//            str(runtime_ir) str(bundle_sha256)                   engine identity, in that order
//            u32 column count, then per column in UTF-8 BYTE order of its key:
//                 str(key) u32 rows, rows*8 bytes
//            u32 refusal count, then per refusal, sorted by (key, guard, bar), each
//            compared on UTF-8 bytes and a null bar first:
//                 str(key | '*') str(guard) u8 hasBar [u32 bar]
//   digest   sha256(preimage), lowercase hex.
//
// The refusal SENTENCE is not in the preimage: sentences may change wording ("map by
// guard, never by sentence", PHASE3 3.6 item 6). Column keys are sorted by UTF-8 bytes,
// NOT by JS's default UTF-16 order, because Python sorts by code point and the two
// differ above U+FFFF. A string with a lone surrogate has no UTF-8 form and is refused.
// Every field is length-prefixed, so no two different inputs share a preimage by sliding
// a boundary.
//
// WHAT IS ACCEPTED (the Python half accepts and refuses exactly the same inputs, and every
// case below is in the shared fixture, so a drift turns one half red):
//   container  `engine`, `columns` and each refusal are PLAIN objects (prototype Object.prototype
//              or null). A Map, a class instance or an array is refused, never read as empty.
//   column     an Array or a Float64Array. A string, Set, array-like, Float32Array or
//              Uint8Array is refused. Elements are numbers, null or undefined.
//   rows       null and undefined both mean "not given"; otherwise a non-negative integer.
//   identity   bundle_sha256 must be a STRING of 64 lowercase hex digits (an integer is
//              refused). The other fields may be a non-negative safe integer or a string.
//   numbers    a JSON integer past 2**53 that is exactly a double (9007199254740992,
//              1e20 written out) is that double in both halves. An integer that is NOT exactly a
//              double cannot reach this half (JSON.parse rounds it first) and Python refuses it;
//              that one-sided case is a known gap, pinned in the Python test only.
//
// ⛔ The engine identity is NEVER retyped here. Callers read it from the modules that
// declare it (`scriptEngineVersion.js`, `ast/pineRuntimeFrontend.js`, `runtime/ir.js`)
// plus the bundle's sha256, and pass it in; this file only checks its shape.

export const CODEC_TAG = 'pine-runtime-columns/1'

/** The engine-identity fields, in preimage order. The wire shape (`engine` in 3.2). */
export const ENGINE_FIELDS = Object.freeze([
  'script_engine', 'runtime_language', 'runtime_frontend', 'runtime_ir', 'bundle_sha256',
])

const U32_MAX = 0xFFFFFFFF
const BUNDLE_SHA_RE = /^[0-9a-f]{64}$/
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const ENC = new TextEncoder()

export class CodecError extends Error {
  constructor(message) { super(message); this.name = 'CodecError' }
}

const fail = (msg) => { throw new CodecError(msg) }

/** A plain object: `{}`, `Object.create(null)` or JSON.parse output, from any realm. A Map, a
 *  Set, an Array, a class instance or a typed array is not (Object.keys of a Map is empty, so
 *  it would otherwise digest as an empty run). */
function isPlainObject(x) {
  if (x === null || typeof x !== 'object' || Object.prototype.toString.call(x) !== '[object Object]') return false
  const proto = Object.getPrototypeOf(x)
  return proto === null || Object.getPrototypeOf(proto) === null
}

/** `rows`: null and undefined mean "not given" (as None does in Python); otherwise a
 *  non-negative integer. Returns the integer or undefined. */
function rowsArg(rows) {
  if (rows === null || rows === undefined) return undefined
  if (!Number.isInteger(rows) || rows < 0) fail('rows must be null or a non-negative integer')
  return rows
}

// ─── strings ────────────────────────────────────────────────────────────────────

/** UTF-8 bytes of `s`; a lone surrogate has no UTF-8 form, so it is refused (TextEncoder
 *  would silently write U+FFFD, and Python would raise: the two hosts must agree). */
function utf8(s, what) {
  if (typeof s !== 'string') fail(`${what} must be a string`)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xD800 && c <= 0xDBFF) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xDC00 && d <= 0xDFFF) { i++; continue }
      fail(`${what} holds a lone surrogate`)
    }
    if (c >= 0xDC00 && c <= 0xDFFF) fail(`${what} holds a lone surrogate`)
  }
  return ENC.encode(s)
}

/** Lexicographic compare of two byte arrays (a shorter prefix sorts first). */
function cmpBytes(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return a.length === b.length ? 0 : (a.length < b.length ? -1 : 1)
}

// ─── byte writer ────────────────────────────────────────────────────────────────

class Writer {
  constructor() { this.parts = []; this.size = 0 }
  push(u8) { this.parts.push(u8); this.size += u8.length }
  u8(v) { this.push(Uint8Array.of(v)) }
  u32(v) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v, true)
    this.push(b)
  }
  str(bytes) { this.u32(bytes.length); this.push(bytes) }
  done() {
    const out = new Uint8Array(this.size)
    let o = 0
    for (const p of this.parts) { out.set(p, o); o += p.length }
    return out
  }
}

// ─── columns ────────────────────────────────────────────────────────────────────

/** Row count of a column input, or a refusal. Float64Array or a plain Array only. */
function rowsOf(col, what) {
  if (col instanceof Float64Array || Array.isArray(col)) return col.length
  return fail(`${what} must be a Float64Array or an Array`)
}

/** Canonical bytes of one column: 8 bytes per row, NaN/null/undefined canonicalised. */
export function encodeColumn(col, what = 'column') {
  const n = rowsOf(col, what)
  const out = new Uint8Array(n * 8)
  const dv = new DataView(out.buffer)
  for (let i = 0; i < n; i++) {
    const x = col[i]
    const o = i * 8
    if (x === null || x === undefined) { out[o + 6] = 0xF8; out[o + 7] = 0x7F; continue }
    if (typeof x !== 'number') fail(`${what}[${i}] must be a number, null or undefined`)
    if (x !== x) { out[o + 6] = 0xF8; out[o + 7] = 0x7F; continue }
    dv.setFloat64(o, x, true)
  }
  return out
}

/** Decode canonical column bytes to a Float64Array. Strict: the length must be a whole
 *  number of rows (and equal `rows` when given), and every NaN must be the canonical one,
 *  so decode(encode(x)) is x and encode(decode(b)) is b for every byte string we accept. */
export function decodeColumn(bytes, rows) {
  if (!(bytes instanceof Uint8Array)) fail('column bytes must be a Uint8Array')
  if (bytes.length % 8 !== 0) fail(`column bytes length ${bytes.length} is not a multiple of 8`)
  const n = bytes.length / 8
  const want = rowsArg(rows)
  if (want !== undefined && want !== n) fail(`column has ${n} rows, expected ${want}`)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const v = dv.getFloat64(i * 8, true)
    if (v !== v && (dv.getUint32(i * 8, true) !== 0 || dv.getUint32(i * 8 + 4, true) !== 0x7FF80000)) {
      fail(`row ${i} is a NaN with a non-canonical payload`)
    }
    out[i] = v
  }
  return out
}

export function bytesToB64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function b64ToBytes(text) {
  if (!B64_RE.test(text)) fail('not canonical base64')
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  if (bytesToB64(out) !== text) fail('not canonical base64')
  return out
}

// ─── identity and refusals ──────────────────────────────────────────────────────

/** The UTF-8 bytes of one identity field. An integer and its decimal string are one value. */
function identityField(engine, field) {
  const v = engine[field]
  if (field === 'bundle_sha256' && typeof v !== 'string') fail('engine.bundle_sha256 must be a string')
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v) || v < 0) fail(`engine.${field} must be a non-negative integer or a string`)
    return utf8(String(v), `engine.${field}`)
  }
  const bytes = utf8(v, `engine.${field}`) // refuses anything that is not a string
  if (bytes.length === 0) fail(`engine.${field} must not be empty`)
  if (field === 'bundle_sha256' && !BUNDLE_SHA_RE.test(v)) fail('engine.bundle_sha256 must be 64 lowercase hex digits')
  return bytes
}

function writeIdentity(w, engine) {
  if (!isPlainObject(engine)) fail('engine must be an object')
  for (const k of Object.keys(engine)) if (!ENGINE_FIELDS.includes(k)) fail(`engine.${k} is not an identity field`)
  for (const f of ENGINE_FIELDS) w.str(identityField(engine, f))
}

function normaliseRefusals(refusals) {
  if (!Array.isArray(refusals)) fail('refusals must be an array')
  const rows = refusals.map((r, i) => {
    if (!isPlainObject(r)) fail(`refusals[${i}] must be an object`)
    const key = utf8(r.key, `refusals[${i}].key`)
    const guard = utf8(r.guard, `refusals[${i}].guard`)
    if (key.length === 0) fail(`refusals[${i}].key must not be empty (use '*' for the whole run)`)
    if (guard.length === 0) fail(`refusals[${i}].guard must not be empty`)
    let bar = null
    if (r.bar !== null && r.bar !== undefined) {
      if (!Number.isInteger(r.bar) || r.bar < 0 || r.bar > U32_MAX) {
        fail(`refusals[${i}].bar must be null or an integer in [0, 2^32-1]`)
      }
      bar = r.bar
    }
    return { key, guard, bar }
  })
  rows.sort((a, b) => cmpBytes(a.key, b.key) || cmpBytes(a.guard, b.guard)
    || (a.bar === b.bar ? 0 : a.bar === null ? -1 : b.bar === null ? 1 : a.bar - b.bar))
  return rows
}

// ─── the preimage and the digest ────────────────────────────────────────────────

/**
 * The exact bytes the digest hashes.
 * @param {{engine:object, columns:Object<string,(Float64Array|Array)>, refusals?:Array, rows?:number}} run
 *   `columns` maps plot key -> column; `refusals` is `[{key|'*', guard, bar|null, sentence?}]`.
 *   `rows`, when given, is the bar count every column must have.
 */
export function canonicalPreimage({ engine, columns, refusals = [], rows } = {}) {
  if (!isPlainObject(columns)) fail('columns must be an object')
  const w = new Writer()
  w.str(utf8(CODEC_TAG, 'tag'))
  writeIdentity(w, engine)
  const entries = Object.keys(columns).map((k) => ({ key: utf8(k, `column key ${JSON.stringify(k)}`), name: k }))
  for (const e of entries) if (e.key.length === 0) fail('a column key must not be empty')
  entries.sort((a, b) => cmpBytes(a.key, b.key))
  w.u32(entries.length)
  let n = rowsArg(rows)
  for (const e of entries) {
    const bytes = encodeColumn(columns[e.name], `column ${JSON.stringify(e.name)}`)
    const len = bytes.length / 8
    if (n === undefined) n = len
    if (len !== n) fail(`column ${JSON.stringify(e.name)} has ${len} rows, expected ${n}`)
    w.str(e.key)
    w.u32(len)
    w.push(bytes)
  }
  const rs = normaliseRefusals(refusals)
  w.u32(rs.length)
  for (const r of rs) {
    w.str(r.key)
    w.str(r.guard)
    if (r.bar === null) w.u8(0)
    else { w.u8(1); w.u32(r.bar) }
  }
  return w.done()
}

export function columnDigest(run) {
  return sha256Hex(canonicalPreimage(run))
}

// ─── sha256 (pure, synchronous, host-neutral) ───────────────────────────────────
// Verified against node:crypto in columnDigest.test.js. No node: import here, so the
// codec stays inside the compute closure and runs in the worker as it is.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

export function sha256Hex(data) {
  const len = data.length
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6)
  padded.set(data)
  padded[len] = 0x80
  const pv = new DataView(padded.buffer)
  pv.setUint32(padded.length - 8, Math.floor(len / 0x20000000), false)
  pv.setUint32(padded.length - 4, (len << 3) >>> 0, false)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = pv.getUint32(off + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2]
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const mj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + mj) | 0
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh
  }
  let out = ''
  for (let i = 0; i < 8; i++) out += h[i].toString(16).padStart(8, '0')
  return out
}
