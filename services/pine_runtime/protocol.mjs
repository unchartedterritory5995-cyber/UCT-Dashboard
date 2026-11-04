// services/pine_runtime/protocol.mjs
//
// W5-T6: the closed schema of `POST /v1/run` (docs/pine/SERVER-RUNTIME-DESIGN.md section 3.2)
// and the door's hash checks (section 4, L5). PURE: no I/O, no clock, no network. The server
// (server.mjs) calls `parseRunRequest` only AFTER the signature verified, and runs no job unless
// it returns `{ ok: true }`.
//
// Every object is a CLOSED set: an unknown key at any level is a 400, never ignored (the
// `extra="forbid"` habit of api/routers/pine_runtime_telemetry.py). Sizes are capped before the
// work they bound. Hashes the caller sends are RECOMPUTED here and a mismatch is refused, so a
// later cache (T8) only ever files a result under content the service hashed itself.
//
// WIRE DECISIONS THIS FILE FIXES (the T11 client mirrors them):
//   definition.doc   the document's canonical JSON TEXT (a string), or null when the caller
//                    believes the service holds `doc_sha256`. doc_sha256 = sha256 of that text's
//                    UTF-8 bytes. Shipping the text, not an object, means both languages hash the
//                    SAME bytes: no second canonical-JSON emitter has to agree with Python's
//                    `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)` on
//                    number formatting. The text must parse to a plain object.
//   bars.<col>       canonical base64 of n little-endian Float64 values (the T3 column layout);
//                    every value finite; `t` strictly increasing.
//   bars.sha256      barsSha256(): sha256 over str("pine-runtime-bars/1") u32le(n) t o h l c v,
//                    where str(x) = u32le(byte length) + UTF-8 bytes.
//   engine           the five identity fields of the T3 codec; an integer and its decimal string
//                    are one value (T3's rule); every field must equal the service's own.
import { createHash } from 'node:crypto'

export const PROTOCOL = 1
export const PROFILES = Object.freeze(['alert', 'on-demand', 'backtest', 'sweep', 'record'])
/** Whole request body; server.mjs enforces it while the body streams in (section 3.2). */
export const MAX_BODY_BYTES = 16 * 1024 * 1024
/** = `scan_run.MAX_RUN_SYMBOLS` (api/services/screener/scan_run.py); a rail reads the Python value. */
export const MAX_JOBS = 500
/** = `runtime_definitions.RUNTIME_MAX_DEFINITION_BYTES` (api/services/runtime_definitions.py);
 *  a rail reads the Python value, so the two cannot drift. */
export const MAX_DOC_BYTES = 128 * 1024
export const ENGINE_FIELDS = Object.freeze(['script_engine', 'runtime_language', 'runtime_frontend', 'runtime_ir', 'bundle_sha256'])
export const BAR_COLUMNS = Object.freeze(['t', 'o', 'h', 'l', 'c', 'v'])
export const BARS_TAG = 'pine-runtime-bars/1'

export const SCHEMA_GUARD = 'runtime:server-schema'
export const INTEGRITY_GUARD = 'runtime:server-integrity'
export const ENGINE_GUARD = 'runtime:server-engine-mismatch'
export const DOC_UNKNOWN_GUARD = 'runtime:server-doc-unknown'

const HEX64 = /^[0-9a-f]{64}$/
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const PRINTABLE = (min, max) => new RegExp(`^[\\x20-\\x7e]{${min},${max}}$`)

class Refused extends Error {
  constructor(status, guard, sentence) { super(sentence); this.status = status; this.guard = guard }
}
const bad = (path, msg) => new Refused(400, SCHEMA_GUARD, `${path}: ${msg}`)

function isPlain(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}

/** A plain object whose keys are exactly `required` plus any of `optional`. */
function closed(v, path, required, optional = []) {
  if (!isPlain(v)) throw bad(path, 'must be an object')
  for (const k of Object.keys(v)) {
    if (!required.includes(k) && !optional.includes(k)) throw bad(path, `unknown key ${JSON.stringify(k)}`)
  }
  for (const k of required) if (!Object.hasOwn(v, k)) throw bad(path, `missing key ${JSON.stringify(k)}`)
  return v
}

function str(v, path, re) {
  if (typeof v !== 'string') throw bad(path, 'must be a string')
  if (!re.test(v)) throw bad(path, 'is not an accepted value')
  return v
}

function nonNegInt(v, path) {
  if (!Number.isSafeInteger(v) || v < 0) throw bad(path, 'must be a non-negative integer')
  return v
}

function bool(v, path) {
  if (typeof v !== 'boolean') throw bad(path, 'must be true or false')
  return v
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
function lp(text) { const b = Buffer.from(text, 'utf8'); return Buffer.concat([u32(b.length), b]) }

/** The bars hash (see the header). `cols` maps each of BAR_COLUMNS to its n*8 canonical bytes. */
export function barsSha256(n, cols) {
  const h = createHash('sha256').update(lp(BARS_TAG)).update(u32(n))
  for (const k of BAR_COLUMNS) h.update(cols[k])
  return h.digest('hex')
}

/** Strict canonical base64 -> bytes; refuses any text that is not exactly what we would write. */
function b64Bytes(v, path) {
  if (typeof v !== 'string' || !B64.test(v)) throw bad(path, 'must be canonical base64')
  const bytes = Buffer.from(v, 'base64')
  if (bytes.toString('base64') !== v) throw bad(path, 'must be canonical base64')
  return bytes
}

function barsOf(v, path, maxBars) {
  closed(v, path, ['n', ...BAR_COLUMNS, 'sha256'])
  if (!Number.isSafeInteger(v.n) || v.n < 1 || v.n > maxBars) throw bad(`${path}.n`, `must be an integer from 1 to ${maxBars}`)
  const n = v.n
  const bytes = {}
  const cols = {}
  for (const k of BAR_COLUMNS) {
    const b = b64Bytes(v[k], `${path}.${k}`)
    if (b.length !== n * 8) throw bad(`${path}.${k}`, `must hold exactly n = ${n} Float64 values`)
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const col = new Float64Array(n)
    for (let i = 0; i < n; i += 1) {
      const x = view.getFloat64(i * 8, true)
      if (!Number.isFinite(x)) throw bad(`${path}.${k}`, `row ${i} is not a finite number`)
      if (k === 't' && i > 0 && !(x > col[i - 1])) throw bad(`${path}.t`, `is not strictly increasing at row ${i}`)
      col[i] = x
    }
    bytes[k] = b
    cols[k] = col
  }
  const sha256 = str(v.sha256, `${path}.sha256`, HEX64)
  return { n, ...cols, sha256, bytes }
}

function runtimeInputsOf(v, path) {
  if (!isPlain(v)) throw bad(path, 'must be an object')
  const keys = Object.keys(v)
  if (keys.length > 256) throw bad(path, 'has more than 256 inputs')
  const out = {}
  for (const k of keys) {
    if (k.length < 1 || k.length > 128) throw bad(path, 'has an input name outside 1-128 characters')
    const x = v[k]
    const ok = typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x))
      || (typeof x === 'string' && x.length <= 4096)
    if (!ok) throw bad(`${path}.${JSON.stringify(k)}`, 'must be a finite number, a string of at most 4096 characters, or a boolean')
    out[k] = x
  }
  return out
}

function wantOf(v, path) {
  if (!Array.isArray(v)) throw bad(path, 'must be an array')
  if (v.length > 256) throw bad(path, 'names more than 256 outputs')
  const seen = new Set()
  v.forEach((k, i) => {
    str(k, `${path}[${i}]`, PRINTABLE(1, 128))
    if (seen.has(k)) throw bad(`${path}[${i}]`, `repeats ${JSON.stringify(k)}`)
    seen.add(k)
  })
  return [...v]
}

function identityField(v, path) {
  if (typeof v === 'string' && v.length >= 1 && v.length <= 64) return v
  if (Number.isSafeInteger(v) && v >= 0) return v
  throw bad(path, 'must be a non-negative integer or a string of 1 to 64 characters')
}

/** Two identities are one when every field's decimal/string form is equal (T3's rule). */
export function sameIdentity(a, b) {
  return ENGINE_FIELDS.every((k) => String(a[k]) === String(b[k]))
}

function jobOf(v, path, { tfSet, maxBars }) {
  closed(v, path, ['job', 'symbol', 'tf', 'bars', 'ctx'], ['want'])
  const job = str(v.job, `${path}.job`, PRINTABLE(1, 128))
  const sym = closed(v.symbol, `${path}.symbol`, ['ticker', 'exchange'])
  const symbol = {
    ticker: str(sym.ticker, `${path}.symbol.ticker`, /^[\x21-\x7e]{1,32}$/),
    exchange: str(sym.exchange, `${path}.symbol.exchange`, PRINTABLE(0, 32)),
  }
  if (typeof v.tf !== 'string' || !tfSet.includes(v.tf)) throw bad(`${path}.tf`, `must be one of ${tfSet.join(', ')}`)
  const bars = barsOf(v.bars, `${path}.bars`, maxBars)
  const c = closed(v.ctx, `${path}.ctx`, ['newestBarIsForming', 'historyFromListing'], ['runtimeInputs'])
  const ctx = {
    newestBarIsForming: bool(c.newestBarIsForming, `${path}.ctx.newestBarIsForming`),
    historyFromListing: bool(c.historyFromListing, `${path}.ctx.historyFromListing`),
    runtimeInputs: Object.hasOwn(c, 'runtimeInputs') ? runtimeInputsOf(c.runtimeInputs, `${path}.ctx.runtimeInputs`) : {},
  }
  const want = Object.hasOwn(v, 'want') ? wantOf(v.want, `${path}.want`) : []
  return { job, symbol, tf: v.tf, bars, ctx, want }
}

const FATAL_UTF8 = new TextDecoder('utf-8', { fatal: true })

/**
 * Validate one signed request body against the service's own identity.
 * @param {Buffer} body  the raw bytes the signature covered
 * @param {{ identity: object, tfSet: string[], maxBars: number }} door  read from the bundle
 * @returns {{ ok: true, request: object } | { ok: false, status: number, guard: string, sentence: string }}
 */
export function parseRunRequest(body, door) {
  try {
    return { ok: true, request: parse(body, door) }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, status: e.status, guard: e.guard, sentence: e.message }
    throw e
  }
}

function parse(body, { identity, tfSet, maxBars }) {
  // MAX_BODY_BYTES is enforced ONCE, by the server while the body streams in (server.mjs readCapped).
  let raw
  try {
    raw = JSON.parse(FATAL_UTF8.decode(body))
  } catch {
    throw bad('body', 'is not UTF-8 JSON')
  }
  closed(raw, 'body', ['protocol', 'profile', 'engine', 'definition', 'owner', 'jobs'])
  if (raw.protocol !== PROTOCOL) throw bad('protocol', `must be ${PROTOCOL}`)
  if (!PROFILES.includes(raw.profile)) throw bad('profile', `must be one of ${PROFILES.join(', ')}`)
  closed(raw.engine, 'engine', ENGINE_FIELDS)
  const engine = {}
  for (const k of ENGINE_FIELDS) engine[k] = identityField(raw.engine[k], `engine.${k}`)
  str(engine.bundle_sha256, 'engine.bundle_sha256', HEX64)
  const d = closed(raw.definition, 'definition', ['def_id', 'version', 'doc_sha256', 'doc'])
  const defId = str(d.def_id, 'definition.def_id', /^[A-Za-z0-9_.:-]{1,64}$/)
  const version = nonNegInt(d.version, 'definition.version')
  const docSha = str(d.doc_sha256, 'definition.doc_sha256', HEX64)
  if (d.doc !== null && typeof d.doc !== 'string') throw bad('definition.doc', "must be the document's JSON text or null")
  const owner = str(raw.owner, 'owner', /^hmac:[0-9a-f]{16,64}$/)
  if (!Array.isArray(raw.jobs) || raw.jobs.length < 1 || raw.jobs.length > MAX_JOBS) {
    throw bad('jobs', `must be an array of 1 to ${MAX_JOBS} jobs`)
  }
  const ids = new Set()
  const jobs = raw.jobs.map((j, i) => {
    const job = jobOf(j, `jobs[${i}]`, { tfSet, maxBars })
    if (ids.has(job.job)) throw bad(`jobs[${i}].job`, `repeats ${JSON.stringify(job.job)}`)
    ids.add(job.job)
    return job
  })

  // The shape holds. Now the facts the caller asserts, each recomputed here.
  if (!sameIdentity(engine, identity)) {
    throw new Refused(409, ENGINE_GUARD, 'the request was built for a different engine than this service runs, so nothing is computed.')
  }
  if (d.doc === null) {
    throw new Refused(409, DOC_UNKNOWN_GUARD, 'this service does not hold that document; resend the request with it.')
  }
  const docBytes = Buffer.from(d.doc, 'utf8')
  if (docBytes.length > MAX_DOC_BYTES) throw bad('definition.doc', `is larger than ${MAX_DOC_BYTES} bytes`)
  if (createHash('sha256').update(docBytes).digest('hex') !== docSha) {
    throw new Refused(422, INTEGRITY_GUARD, 'definition.doc_sha256 does not match the document sent, so nothing is computed.')
  }
  let doc
  try { doc = JSON.parse(d.doc) } catch { throw bad('definition.doc', 'is not JSON') }
  if (!isPlain(doc)) throw bad('definition.doc', 'must be a JSON object')
  for (const [i, j] of jobs.entries()) {
    const { bytes, ...bars } = j.bars
    if (barsSha256(bars.n, bytes) !== bars.sha256) {
      throw new Refused(422, INTEGRITY_GUARD, `jobs[${i}].bars.sha256 does not match the bars sent, so nothing is computed.`)
    }
    j.bars = bars
  }
  return {
    protocol: PROTOCOL, profile: raw.profile, engine, owner,
    definition: { def_id: defId, version, doc_sha256: docSha, doc }, jobs,
  }
}
