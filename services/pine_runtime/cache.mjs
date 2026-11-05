// services/pine_runtime/cache.mjs
//
// W5-T8: the document LRU and the result LRU of docs/pine/SERVER-RUNTIME-DESIGN.md 3.3. PURE: no
// I/O, no clock. Both caches are filed under content THIS service hashed itself (protocol.mjs
// recomputes doc_sha256 and bars.sha256 before a request is accepted), so a caller can never file
// a result under another document's key.
//
//   document cache  key doc_sha256 -> the parsed document. `put` recomputes the hash of the text
//                   and REFUSES a mismatch (runtime:server-integrity); the caller's hash is never
//                   trusted. Bound 2,000 docs / 256 MB (bytes counted as the text's UTF-8 length).
//   result cache    key resultKey() -> { columns, refusals, digest } (opaque to this file). Bound
//                   512 MB. Never stores a non-deterministic stop (see `cacheable`).
//
// KEY COMPONENTS (design 3.3, every one moves the key; a rail proves each):
//   engine identity (the 5 T3 fields; an integer and its decimal string are one value),
//   doc_sha256, canonical ctx (newestBarIsForming, historyFromListing, runtimeInputs with sorted
//   keys, typed values), bars.sha256, sorted want, profile.
//   Also the job's symbol (ticker, exchange) and tf: they are existing request fields and the
//   script reads them (syminfo.*, timeframe.*), so two jobs with equal bars on different symbols
//   must not share a result. The design row omits them; including them can only lower the hit
//   rate, never serve a wrong value.
// Kill and stage are NOT in the key: the caller asks server_lane_refusal before every use (3.5).
import { createHash } from 'node:crypto'
import { ENGINE_FIELDS, INTEGRITY_GUARD } from './protocol.mjs'

export const DOC_CACHE_MAX_DOCS = 2000
export const DOC_CACHE_MAX_BYTES = 256 * 1024 * 1024
export const RESULT_CACHE_MAX_BYTES = 512 * 1024 * 1024
export const KEY_TAG = 'pine-runtime-result/1'
export const TIME_BUDGET_GUARD = 'runtime:time-budget'
export const SERVER_GUARD_PREFIX = 'runtime:server-'

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
function lp(text) { const b = Buffer.from(String(text), 'utf8'); return Buffer.concat([u32(b.length), b]) }
const num = (x) => (Object.is(x, -0) ? '-0' : String(x))

/** A typed, unambiguous text for one input value: 1, "1" and true are three different keys. */
function inputText(x) {
  if (typeof x === 'boolean') return `b:${x}`
  if (typeof x === 'number') return `n:${num(x)}`
  return `s:${x}`
}

/** The ctx as canonical text: fixed fields, then runtimeInputs in sorted-key order. */
export function canonicalCtx(ctx) {
  const inputs = ctx.runtimeInputs || {}
  const parts = [`forming=${ctx.newestBarIsForming === true}`, `listing=${ctx.historyFromListing === true}`]
  for (const k of Object.keys(inputs).sort()) parts.push(`${lp(k).toString('hex')}=${lp(inputText(inputs[k])).toString('hex')}`)
  return parts.join('|')
}

/**
 * The result key of one job. Inputs are the PARSED request (protocol.mjs parseRunRequest output):
 * `request.engine`, `request.definition.doc_sha256`, `request.profile` and the job.
 * @returns {string} 64 hex characters
 */
export function resultKey(request, job) {
  const h = createHash('sha256').update(lp(KEY_TAG))
  for (const k of ENGINE_FIELDS) h.update(lp(String(request.engine[k])))
  h.update(lp(request.definition.doc_sha256))
  h.update(lp(canonicalCtx(job.ctx)))
  h.update(lp(job.bars.sha256))
  h.update(lp(job.symbol.ticker)).update(lp(job.symbol.exchange)).update(lp(job.tf))
  const want = [...(job.want || [])].sort()
  h.update(u32(want.length))
  for (const w of want) h.update(lp(w))
  h.update(lp(request.profile))
  return h.digest('hex')
}

/** Every `guard` string anywhere in a result (run-wide, per-output, nested). */
function guardsOf(v, out = [], depth = 0) {
  if (depth > 8 || v === null || typeof v !== 'object') return out
  if (Array.isArray(v)) { for (const x of v) guardsOf(x, out, depth + 1); return out }
  for (const [k, x] of Object.entries(v)) {
    if (k === 'guard' && typeof x === 'string') out.push(x)
    else guardsOf(x, out, depth + 1)
  }
  return out
}

/**
 * May this runner reply be stored? Only a deterministic answer is: `ok`, or `withheld` where every
 * named guard is deterministic. NEVER `runtime:time-budget` (a wall-clock safety stop), never
 * `runtime:server-*` (busy, worker-oom, failed, ...), never a crash, and a `withheld` that names
 * no guard at all (cannot be proved deterministic) fails closed.
 */
export function cacheable(result) {
  if (!result || typeof result !== 'object') return false
  if (result.status !== 'ok' && result.status !== 'withheld') return false
  if (result.crashed === true || result.timedOut === true) return false
  const guards = guardsOf(result)
  if (guards.some((g) => g === TIME_BUDGET_GUARD || g.startsWith(SERVER_GUARD_PREFIX))) return false
  if (result.status === 'withheld' && guards.length === 0) return false
  return true
}

/** Insertion-ordered Map as an LRU bounded by entry count and bytes. */
class Lru {
  constructor(maxEntries, maxBytes) {
    this.maxEntries = maxEntries; this.maxBytes = maxBytes
    this.map = new Map(); this.bytes = 0
  }
  get size() { return this.map.size }
  get(k) {
    const e = this.map.get(k)
    if (!e) return undefined
    this.map.delete(k); this.map.set(k, e)
    return e.value
  }
  set(k, value, size) {
    if (size > this.maxBytes) return false // one entry larger than the whole cache is never kept
    const old = this.map.get(k)
    if (old) { this.bytes -= old.size; this.map.delete(k) }
    this.map.set(k, { value, size }); this.bytes += size
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const [oldest, e] = this.map.entries().next().value
      this.map.delete(oldest); this.bytes -= e.size
    }
    return true
  }
}

export class DocCache {
  constructor({ maxDocs = DOC_CACHE_MAX_DOCS, maxBytes = DOC_CACHE_MAX_BYTES } = {}) {
    this.lru = new Lru(maxDocs, maxBytes)
  }
  get size() { return this.lru.size }
  get bytes() { return this.lru.bytes }
  /** The parsed document for `docSha256`, or undefined. */
  get(docSha256) { return this.lru.get(docSha256) }
  /**
   * File `text` under `docSha256`. The service recomputes the hash of the text; a caller's hash
   * that does not match is REFUSED and nothing is stored.
   * @returns {{ ok: true, doc: object } | { ok: false, status: 422, guard: string, sentence: string }}
   */
  put(docSha256, text) {
    const bytes = Buffer.from(text, 'utf8')
    if (createHash('sha256').update(bytes).digest('hex') !== docSha256) {
      return { ok: false, status: 422, guard: INTEGRITY_GUARD, sentence: 'definition.doc_sha256 does not match the document, so it is not cached.' }
    }
    const doc = JSON.parse(text)
    this.lru.set(docSha256, doc, bytes.length)
    return { ok: true, doc }
  }
}

export class ResultCache {
  constructor({ maxBytes = RESULT_CACHE_MAX_BYTES, maxEntries = Infinity } = {}) {
    this.lru = new Lru(maxEntries, maxBytes)
  }
  get size() { return this.lru.size }
  get bytes() { return this.lru.bytes }
  get(key) { return this.lru.get(key) }
  /** Store `result` under `key` when `cacheable(result)`. @returns {boolean} whether it was stored */
  put(key, result, bytes = Buffer.byteLength(JSON.stringify(result))) {
    if (!cacheable(result)) return false
    return this.lru.set(key, result, bytes)
  }
}
