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
//                    believes the service holds `doc_sha256` (W5-INT: answered from the T8 document
//                    cache, a fresh copy per request; unknown -> 409 doc-unknown). doc_sha256 = sha256 of that text's
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
//
// THE RESPONSE (W5-T7b, `sealRunResults`): every result the runner returns is checked against a
// CLOSED schema and then SEALED, here, once, before it is sent:
//   ok        { job, status: 'ok', columns, refusals, warmup, digest, ms?, cache? }
//   withheld  { job, status: 'withheld', refusals, digest, ms?, cache? }
//   cache     (W5-INT, design 3.2) 'hit' | 'miss', set by the T8 result cache (cache.mjs); any other
//             value is refused like an unknown key. `instructions` (3.2) is NOT admitted: no run
//             counts it yet, and an unknown field stays a refusal.
//   columns   key -> canonical base64 of exactly bars.n canonical Float64 values (T3 decodeColumn)
//   refusals  [{ key | '*', guard, sentence, bar | null }]; a withheld result holds a '*' one, an
//             ok result none
//   warmup    { withheldBars }: the run's own warm-up (`runtimeWarmupOf`, set by job.mjs), the
//             bars [0, withheldBars) a run off the listing withheld; 0 when the run withheld none
//   digest    T3 `columnDigest({ engine: <this service's identity>, columns: <the decoded wire
//             columns>, refusals, rows: bars.n })` (design 2.3), computed by the bundle's own
//             codec over the bytes that are sent, so a caller can verify what it RECEIVED
//   strategy  (W9-T14, W9 design 3.4) ONLY on an ok result of a job whose `want` names
//             STRATEGY_WANT ('#strategy'), which only profile `backtest` may ask: the run's
//             `strategy` record (design 3.2) as JSON TEXT, exactly as the job adapter wrote it, and
//             checked here by the bundle's ONE shape check (`strategyRecordShapeErrors`). The seal
//             adds `strategy_sha256` = sha256 of the text's UTF-8 bytes. The T3 digest has no field
//             for it and is not changed (W5 identity, codec and HP-6 stand), so the record is
//             verified by its own hash, the way `definition.doc` is: both languages hash the SAME
//             bytes and no second canonical-JSON emitter has to agree. A job that asks for the record
//             and gets none carries a refusal keyed '#strategy' instead; never both, never neither.
// A field outside these sets, a missing one, or a column that does not decode is not a reply:
// the whole request is refused (500 runtime:server-failed). Nothing is passed through unread.
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

/** W9-T14: the `want` entry that asks for the run's `strategy` record (W9 design 3.4) instead of a
 *  column. Not a plot key (a plot key starts with a letter), so it can never name an output.
 *  `api/services/pine_runtime_codec.py` STRATEGY_WANT mirrors it; a rail reads this file. */
export const STRATEGY_WANT = '#strategy'
/** W9-T14: the one profile that may ask for the record (design 3.4: "returns the record under
 *  profile `backtest`"). Any other profile naming STRATEGY_WANT is a schema refusal. */
export const STRATEGY_PROFILE = 'backtest'

const HEX64 = /^[0-9a-f]{64}$/
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

function posInt(v, path) {
  if (!Number.isSafeInteger(v) || v < 1) throw bad(path, 'must be a positive integer')
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

/** Strict canonical base64 -> bytes. ONE rule: the text must be exactly what Buffer would write for
 *  the bytes it decodes to (no whitespace, URL-safe letters, missing padding or stray pad bits). */
function b64Bytes(v, path) {
  if (typeof v !== 'string') throw bad(path, 'must be canonical base64')
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

function jobOf(v, path, { tfSet, maxBars, profile }) {
  closed(v, path, ['job', 'symbol', 'tf', 'bars', 'ctx'], ['want'])
  const job = str(v.job, `${path}.job`, PRINTABLE(1, 128))
  const sym = closed(v.symbol, `${path}.symbol`, ['ticker', 'exchange'])
  const symbol = {
    ticker: str(sym.ticker, `${path}.symbol.ticker`, /^[\x21-\x7e]{1,32}$/),
    exchange: str(sym.exchange, `${path}.symbol.exchange`, PRINTABLE(0, 32)),
  }
  if (typeof v.tf !== 'string' || !tfSet.includes(v.tf)) throw bad(`${path}.tf`, `must be one of ${tfSet.join(', ')}`)
  const bars = barsOf(v.bars, `${path}.bars`, maxBars)
  const c = closed(v.ctx, `${path}.ctx`, ['newestBarIsForming', 'historyFromListing'], ['runtimeInputs', 'historyWindowBars'])
  const ctx = {
    newestBarIsForming: bool(c.newestBarIsForming, `${path}.ctx.newestBarIsForming`),
    historyFromListing: bool(c.historyFromListing, `${path}.ctx.historyFromListing`),
    runtimeInputs: Object.hasOwn(c, 'runtimeInputs') ? runtimeInputsOf(c.runtimeInputs, `${path}.ctx.runtimeInputs`) : {},
    // W9-T11: the history window a strategy (broker) run takes (design 3.4), as the CALLER states it
    // (the API reads bars_window.HISTORY_WINDOW_BARS). Optional: a job without it is a job as before,
    // and a broker run told no window refuses `runtime:strategy-start` by name (vm.js).
    ...(Object.hasOwn(c, 'historyWindowBars') ? { historyWindowBars: posInt(c.historyWindowBars, `${path}.ctx.historyWindowBars`) } : {}),
  }
  const want = Object.hasOwn(v, 'want') ? wantOf(v.want, `${path}.want`) : []
  if (want.includes(STRATEGY_WANT) && profile !== STRATEGY_PROFILE) {
    throw bad(`${path}.want`, `names ${JSON.stringify(STRATEGY_WANT)}, which only profile ${JSON.stringify(STRATEGY_PROFILE)} may ask for`)
  }
  return { job, symbol, tf: v.tf, bars, ctx, want }
}

const FATAL_UTF8 = new TextDecoder('utf-8', { fatal: true })

/**
 * Validate one signed request body against the service's own identity.
 * @param {Buffer} body  the raw bytes the signature covered
 * @param {{ identity: object, tfSet: string[], maxBars: number }} door  read from the bundle
 * @returns {{ ok: true, request: object } | { ok: false, status: number, guard: string, sentence: string }}
 */
export function parseRunRequest(body, door, docs = null) {
  try {
    return { ok: true, request: parse(body, door, docs) }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, status: e.status, guard: e.guard, sentence: e.message }
    throw e
  }
}

/** @param {{ get(sha:string): object|undefined, put(sha:string, text:string): object }|null} docs
 *  the T8 DocCache (W5-INT), or null for none. */
function parse(body, { identity, tfSet, maxBars }, docs) {
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
    const job = jobOf(j, `jobs[${i}]`, { tfSet, maxBars, profile: raw.profile })
    if (ids.has(job.job)) throw bad(`jobs[${i}].job`, `repeats ${JSON.stringify(job.job)}`)
    ids.add(job.job)
    return job
  })

  // The shape holds. Now the facts the caller asserts, each recomputed here.
  if (!sameIdentity(engine, identity)) {
    throw new Refused(409, ENGINE_GUARD, 'the request was built for a different engine than this service runs, so nothing is computed.')
  }
  let doc
  if (d.doc === null) {
    // W5-INT: the T8 document cache, filed only under a hash THIS service recomputed (below). A
    // fresh copy per request: no request can reach (or change) another's document object.
    const held = docs ? docs.get(docSha) : undefined
    if (held === undefined) {
      throw new Refused(409, DOC_UNKNOWN_GUARD, 'this service does not hold that document; resend the request with it.')
    }
    doc = structuredClone(held)
  } else {
    const docBytes = Buffer.from(d.doc, 'utf8')
    if (docBytes.length > MAX_DOC_BYTES) throw bad('definition.doc', `is larger than ${MAX_DOC_BYTES} bytes`)
    if (createHash('sha256').update(docBytes).digest('hex') !== docSha) {
      throw new Refused(422, INTEGRITY_GUARD, 'definition.doc_sha256 does not match the document sent, so nothing is computed.')
    }
    try { doc = JSON.parse(d.doc) } catch { throw bad('definition.doc', 'is not JSON') }
    if (!isPlain(doc)) throw bad('definition.doc', 'must be a JSON object')
  }
  for (const [i, j] of jobs.entries()) {
    const { bytes, ...bars } = j.bars
    if (barsSha256(bars.n, bytes) !== bars.sha256) {
      throw new Refused(422, INTEGRITY_GUARD, `jobs[${i}].bars.sha256 does not match the bars sent, so nothing is computed.`)
    }
    j.bars = bars
  }
  // the request is whole and every hash is the service's own: only now is a sent document kept
  if (docs && d.doc !== null) docs.put(docSha, d.doc)
  return {
    protocol: PROTOCOL, profile: raw.profile, engine, owner,
    definition: { def_id: defId, version, doc_sha256: docSha, doc }, jobs,
  }
}

// ─── the response (W5-T7b) ──────────────────────────────────────────────────────

/** The closed key sets of one result as the RUNNER returns it, by status (before the seal). */
export const RUNNER_RESULT_FIELDS = Object.freeze({
  ok: Object.freeze({ required: Object.freeze(['job', 'status', 'columns', 'refusals', 'warmup']), optional: Object.freeze(['ms', 'cache', 'strategy']) }),
  withheld: Object.freeze({ required: Object.freeze(['job', 'status', 'refusals']), optional: Object.freeze(['ms', 'cache']) }),
})
/** W5-INT: the values of a result's `cache` field (design 3.2). */
export const CACHE_STATES = Object.freeze(['hit', 'miss'])
/** The closed key sets of one result ON THE WIRE: the runner's, plus the digest the seal adds.
 *  `sealOne` builds each result from these fields only (a rail holds its output to this set). */
export const RESULT_FIELDS = Object.freeze({
  ok: Object.freeze({ required: Object.freeze([...RUNNER_RESULT_FIELDS.ok.required, 'digest']), optional: Object.freeze([...RUNNER_RESULT_FIELDS.ok.optional, 'strategy_sha256']) }),
  withheld: Object.freeze({ required: Object.freeze([...RUNNER_RESULT_FIELDS.withheld.required, 'digest']), optional: RUNNER_RESULT_FIELDS.withheld.optional }),
})
export const REFUSAL_FIELDS = Object.freeze(['key', 'guard', 'sentence', 'bar'])
/** LIMITS r1: a run-wide stop may name the engine limit it met, as a field (never in the sentence). */
export const REFUSAL_OPTIONAL_FIELDS = Object.freeze(['limit'])
const LIMIT_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
export const WARMUP_FIELDS = Object.freeze(['withheldBars'])
const U32_MAX = 0xffffffff

function refusalsOf(v, path) {
  if (!Array.isArray(v)) throw bad(path, 'must be an array')
  return v.map((r, i) => {
    const p = `${path}[${i}]`
    closed(r, p, REFUSAL_FIELDS, REFUSAL_OPTIONAL_FIELDS)
    if (typeof r.key !== 'string' || r.key.length === 0) throw bad(`${p}.key`, 'must be a non-empty string')
    if (typeof r.guard !== 'string' || r.guard.length === 0) throw bad(`${p}.guard`, 'must be a non-empty string')
    if (typeof r.sentence !== 'string') throw bad(`${p}.sentence`, 'must be a string')
    if (r.bar !== null && (!Number.isSafeInteger(r.bar) || r.bar < 0 || r.bar > U32_MAX)) {
      throw bad(`${p}.bar`, 'must be null or a bar index')
    }
    if (Object.hasOwn(r, 'limit') && (typeof r.limit !== 'string' || !LIMIT_NAME.test(r.limit))) {
      throw bad(`${p}.limit`, 'must be an engine limit name')
    }
    return { key: r.key, guard: r.guard, sentence: r.sentence, bar: r.bar, ...(Object.hasOwn(r, 'limit') ? { limit: r.limit } : {}) }
  })
}

/** W9-T14: the ok result's `strategy` text, checked (see the header), with its sha256; or null when
 *  the result carries none, which is allowed only when the job did not ask for it or refuses it. */
function strategyOf(codec, job, r, refusals, path) {
  const asked = Array.isArray(job.want) && job.want.includes(STRATEGY_WANT)
  const refused = refusals.some((x) => x.key === STRATEGY_WANT)
  if (!Object.hasOwn(r, 'strategy')) {
    if (asked && !refused) throw bad(`${path}.strategy`, 'the job asked for the strategy record and the run neither serves nor refuses it')
    return null
  }
  if (!asked) throw bad(`${path}.strategy`, 'serves a strategy record the job did not ask for')
  if (refused) throw bad(`${path}.strategy`, 'both serves and refuses the strategy record')
  const text = r.strategy
  if (typeof text !== 'string') throw bad(`${path}.strategy`, "must be the record's JSON text")
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.toString('utf8') !== text) throw bad(`${path}.strategy`, 'has no UTF-8 form (a lone surrogate), so its hash could not be checked')
  let rec
  try { rec = JSON.parse(text) } catch { throw bad(`${path}.strategy`, 'is not JSON') }
  if (!isPlain(rec)) throw bad(`${path}.strategy`, 'must be a JSON object')
  if (typeof codec.strategyRecordShapeErrors !== 'function') {
    throw bad(`${path}.strategy`, "cannot be checked: the bundle exports no strategyRecordShapeErrors")
  }
  const errs = codec.strategyRecordShapeErrors(rec)
  if (!Array.isArray(errs) || errs.length) {
    throw bad(`${path}.strategy`, `is not a strategy record (${Array.isArray(errs) ? errs.slice(0, 5).join('; ') : 'no answer'})`)
  }
  return { text, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function sealOne(codec, identity, job, r, path) {
  if (!isPlain(r)) throw bad(path, 'must be an object')
  const shape = Object.hasOwn(RUNNER_RESULT_FIELDS, r.status) ? RUNNER_RESULT_FIELDS[r.status] : null
  if (!shape) throw bad(`${path}.status`, "must be 'ok' or 'withheld'")
  closed(r, path, shape.required, shape.optional)
  if (r.job !== job.job) throw bad(`${path}.job`, 'does not answer the job in its place')
  const refusals = refusalsOf(r.refusals, `${path}.refusals`)
  const runWide = refusals.some((x) => x.key === '*')
  const out = { job: r.job, status: r.status }
  const decoded = {}
  if (r.status === 'withheld') {
    if (!runWide) throw bad(`${path}.refusals`, "a withheld job must name a run-wide ('*') reason")
  } else {
    if (runWide) throw bad(`${path}.refusals`, "an ok job cannot carry a run-wide ('*') refusal")
    if (!isPlain(r.columns)) throw bad(`${path}.columns`, 'must be an object')
    const n = job.bars.n
    const columns = {}
    for (const [k, text] of Object.entries(r.columns)) {
      if (k === STRATEGY_WANT) throw bad(`${path}.columns`, `serves the strategy record as a column`)
      if (refusals.some((x) => x.key === k)) throw bad(`${path}.columns`, `both serves and refuses ${JSON.stringify(k)}`)
      const bytes = b64Bytes(text, `${path}.columns.${JSON.stringify(k)}`)
      try {
        decoded[k] = codec.decodeColumn(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), n)
      } catch (e) {
        throw bad(`${path}.columns.${JSON.stringify(k)}`, `is not ${n} canonical values (${(e && e.message) || e})`)
      }
      columns[k] = text
    }
    const w = closed(r.warmup, `${path}.warmup`, WARMUP_FIELDS)
    if (!Number.isSafeInteger(w.withheldBars) || w.withheldBars < 0 || w.withheldBars > n) {
      throw bad(`${path}.warmup.withheldBars`, `must be a bar count from 0 to ${n}`)
    }
    out.columns = columns
  }
  out.refusals = refusals
  if (r.status === 'ok') out.warmup = { withheldBars: r.warmup.withheldBars }
  if (r.status === 'ok') {
    const record = strategyOf(codec, job, r, refusals, path)
    if (record !== null) { out.strategy = record.text; out.strategy_sha256 = record.sha256 }
  }
  out.digest = codec.columnDigest({ engine: identity, columns: decoded, refusals, rows: job.bars.n })
  if (Object.hasOwn(r, 'ms')) out.ms = nonNegInt(r.ms, `${path}.ms`)
  if (Object.hasOwn(r, 'cache')) {
    if (!CACHE_STATES.includes(r.cache)) throw bad(`${path}.cache`, `must be one of ${CACHE_STATES.join(', ')}`)
    out.cache = r.cache
  }
  return out
}

/**
 * Check what the runner returned for `jobs` against the closed result schema and seal each result
 * with its design 2.3 digest (see the header).
 * @param {{ columnDigest: Function, decodeColumn: Function, strategyRecordShapeErrors?: Function }} codec
 *        the BUNDLE's T3 codec and (W9-T14) its strategy record check (loadBundle)
 * @param {object} identity  the service's own engine identity, the one the reply's `engine` names
 * @returns {{ ok: true, results: object[] } | { ok: false, sentence: string }}
 */
export function sealRunResults(codec, identity, jobs, results) {
  try {
    if (!Array.isArray(results) || results.length !== jobs.length) throw bad('results', 'must answer every job once')
    return { ok: true, results: results.map((r, i) => sealOne(codec, identity, jobs[i], r, `results[${i}]`)) }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, sentence: e.message }
    throw e
  }
}
