// W5-T8 rails: document + result LRU and the result key (design 3.3).
// Run: node --test --test-force-exit services/pine_runtime/test/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DocCache, ResultCache, cacheable, resultKey, canonicalCtx } from '../cache.mjs'
import { INTEGRITY_GUARD, parseRunRequest } from '../protocol.mjs'
import { DOC_TEXT, DOOR, validRequest } from './helpers.mjs'

const sha = (t) => createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex')
function parsed(edit) {
  const raw = validRequest()
  if (edit) edit(raw)
  const r = parseRunRequest(Buffer.from(JSON.stringify(raw)), DOOR)
  assert.equal(r.ok, true, r.sentence)
  return r.request
}
const keyOf = (edit) => { const q = parsed(edit); return resultKey(q, q.jobs[0]) }
const BASE = keyOf()

test('the key is stable and ignores request noise (job id, owner, def_id, version, other jobs)', () => {
  assert.match(BASE, /^[0-9a-f]{64}$/)
  assert.equal(keyOf(), BASE)
  assert.equal(keyOf((r) => { r.jobs[0].job = 'OTHER|D'; r.owner = 'hmac:ffffffffffffffff'; r.definition.def_id = 'u_other'; r.definition.version = 99; r.jobs.pop() }), BASE)
  assert.equal(keyOf((r) => { r.jobs[0].want = ['value'] }), BASE)
})

test('KEY SENSITIVITY: each component changes the key', () => {
  const doc2 = JSON.stringify({ id: 'other' })
  const cases = {
    'engine.script_engine': (q) => { q.engine.script_engine = 6 },
    'engine.runtime_language': (q) => { q.engine.runtime_language = 'pine2' },
    'engine.runtime_frontend': (q) => { q.engine.runtime_frontend = 2 },
    'engine.runtime_ir': (q) => { q.engine.runtime_ir = 2 },
    'engine.bundle_sha256': (q) => { q.engine.bundle_sha256 = 'cd'.repeat(32) },
    'doc_sha256': (q) => { q.definition.doc_sha256 = sha(doc2) },
    'ctx.newestBarIsForming': (q) => { q.jobs[0].ctx.newestBarIsForming = true },
    'ctx.historyFromListing': (q) => { q.jobs[0].ctx.historyFromListing = false },
    'ctx.runtimeInputs value': (q) => { q.jobs[0].ctx.runtimeInputs.length = 15 },
    'ctx.runtimeInputs name': (q) => { q.jobs[0].ctx.runtimeInputs = { len: 14 } },
    'ctx.runtimeInputs added': (q) => { q.jobs[0].ctx.runtimeInputs.extra = true },
    'bars.sha256': (q) => { q.jobs[0].bars.sha256 = 'ee'.repeat(32) },
    'want': (q) => { q.jobs[0].want = ['value', 'signal'] },
    'want emptied': (q) => { q.jobs[0].want = [] },
    'profile': (q) => { q.profile = 'backtest' },
    'symbol.ticker': (q) => { q.jobs[0].symbol.ticker = 'ZZZ' },
    'symbol.exchange': (q) => { q.jobs[0].symbol.exchange = 'NYSE' },
    'tf': (q) => { q.jobs[0].tf = 'W' },
  }
  const seen = new Set([BASE])
  for (const [name, edit] of Object.entries(cases)) {
    const q = parsed(); edit(q)
    const k = resultKey(q, q.jobs[0])
    assert.notEqual(k, BASE, `${name} did not move the key`)
    assert.ok(!seen.has(k), `${name} collided with another case`)
    seen.add(k)
  }
})

test('key equalities: want order, runtimeInputs order, int vs decimal-string identity are one key', () => {
  const a = parsed((r) => { r.jobs[0].want = ['b', 'a']; r.jobs[0].ctx.runtimeInputs = { x: 1, y: 2 } })
  const b = parsed((r) => { r.jobs[0].want = ['a', 'b']; r.jobs[0].ctx.runtimeInputs = { y: 2, x: 1 } })
  assert.equal(resultKey(a, a.jobs[0]), resultKey(b, b.jobs[0]))
  const c = parsed(); c.engine.script_engine = '5'
  assert.equal(resultKey(c, c.jobs[0]), BASE)
})

test('typed inputs never collide: 1, "1", true, 0, -0 and field-boundary tricks', () => {
  const k = (inputs) => { const q = parsed(); q.jobs[0].ctx.runtimeInputs = inputs; return resultKey(q, q.jobs[0]) }
  const keys = [k({ a: 1 }), k({ a: '1' }), k({ a: true }), k({ a: 0 }), k({ a: -0 }), k({ a: '' }), k({ a: 'x', b: 'y' }), k({ ax: 'y' }), k({ a: 'xb', '': 'y' })]
  assert.equal(new Set(keys).size, keys.length)
  assert.notEqual(canonicalCtx({ newestBarIsForming: true, historyFromListing: false }), canonicalCtx({ newestBarIsForming: false, historyFromListing: true }))
})

test('doc cache: put recomputes the hash and REFUSES a mismatch; nothing is stored', () => {
  const c = new DocCache()
  const bad = c.put('0'.repeat(64), DOC_TEXT)
  assert.equal(bad.ok, false); assert.equal(bad.status, 422); assert.equal(bad.guard, INTEGRITY_GUARD)
  assert.equal(c.size, 0); assert.equal(c.get('0'.repeat(64)), undefined)
  // a hash of a DIFFERENT document is also refused (a caller cannot file doc B under doc A's key)
  assert.equal(c.put(sha(JSON.stringify({ a: 1 })), DOC_TEXT).ok, false)
  assert.equal(c.size, 0)
  const ok = c.put(sha(DOC_TEXT), DOC_TEXT)
  assert.equal(ok.ok, true)
  assert.deepEqual(c.get(sha(DOC_TEXT)), JSON.parse(DOC_TEXT))
  assert.equal(c.bytes, Buffer.byteLength(DOC_TEXT))
})

test('doc cache: LRU by count and by bytes; a hit refreshes recency', () => {
  const docs = [1, 2, 3].map((i) => JSON.stringify({ i }))
  const c = new DocCache({ maxDocs: 2 })
  c.put(sha(docs[0]), docs[0]); c.put(sha(docs[1]), docs[1])
  c.get(sha(docs[0])) // refresh 0, so 1 is the oldest
  c.put(sha(docs[2]), docs[2])
  assert.equal(c.size, 2)
  assert.ok(c.get(sha(docs[0]))); assert.ok(c.get(sha(docs[2]))); assert.equal(c.get(sha(docs[1])), undefined)
  const big = new DocCache({ maxBytes: Buffer.byteLength(docs[0]) * 2 })
  for (const d of docs) big.put(sha(d), d)
  assert.equal(big.size, 2); assert.ok(big.bytes <= Buffer.byteLength(docs[0]) * 2)
  assert.equal(big.get(sha(docs[0])), undefined)
  const tiny = new DocCache({ maxBytes: 3 }); tiny.put(sha(docs[0]), docs[0])
  assert.equal(tiny.size, 0)
})

test('doc cache: re-putting the same document does not double-count its bytes', () => {
  const c = new DocCache()
  c.put(sha(DOC_TEXT), DOC_TEXT); c.put(sha(DOC_TEXT), DOC_TEXT)
  assert.equal(c.size, 1); assert.equal(c.bytes, Buffer.byteLength(DOC_TEXT))
})

const OK = { job: 'a', status: 'ok', columns: { value: 'AAAA' }, refusals: [], digest: 'd' }
test('result cache stores deterministic answers and returns them; LRU by bytes', () => {
  const c = new ResultCache({ maxBytes: 100 })
  assert.equal(c.put('k1', OK, 40), true)
  assert.equal(c.put('k2', OK, 40), true)
  c.get('k1')
  assert.equal(c.put('k3', OK, 40), true)
  assert.equal(c.get('k2'), undefined); assert.ok(c.get('k1')); assert.ok(c.get('k3'))
  assert.ok(c.bytes <= 100)
  assert.equal(c.put('huge', OK, 101), false); assert.equal(c.get('huge'), undefined)
})

test('NEVER cached: time-budget, runtime:server-*, crashes, non-answers, unnamed withholds', () => {
  const w = (guard, extra = {}) => ({ job: 'a', status: 'withheld', refusals: [{ guard }], ...extra })
  const never = [
    w('runtime:time-budget'), w('runtime:server-busy'), w('runtime:server-worker-oom'), w('runtime:server-failed'),
    w('runtime:server-integrity'), w('runtime:limit', { crashed: true }), w('runtime:limit', { timedOut: true }),
    { job: 'a', status: 'withheld' }, { job: 'a', status: 'crash' }, { job: 'a', status: 'ok', refusals: [{ guard: 'runtime:time-budget' }] },
    { job: 'a', status: 'ok', outputs: { v: { refusal: { guard: 'runtime:server-failed' } } } }, null, 'x',
  ]
  const c = new ResultCache()
  never.forEach((r, i) => {
    assert.equal(cacheable(r), false, `case ${i}`)
    assert.equal(c.put(`k${i}`, r, 10), false)
    assert.equal(c.get(`k${i}`), undefined)
  })
  assert.equal(c.size, 0)
  for (const g of ['runtime:limit', 'runtime:version', 'runtime:failed']) {
    assert.equal(cacheable(w(g)), true, g)
  }
  assert.equal(cacheable(OK), true)
})

test('same-count want lists with different names, and field-boundary shifts, never collide', () => {
  const k = (edit) => keyOf(edit)
  assert.notEqual(k((r) => { r.jobs[0].want = ['a'] }), k((r) => { r.jobs[0].want = ['b'] }))
  assert.notEqual(k((r) => { r.jobs[0].want = ['ab', 'c'] }), k((r) => { r.jobs[0].want = ['a', 'bc'] }))
  assert.notEqual(
    k((r) => { r.jobs[0].symbol = { ticker: 'AB', exchange: 'C' } }),
    k((r) => { r.jobs[0].symbol = { ticker: 'A', exchange: 'BC' } }),
  )
  assert.notEqual(
    k((r) => { r.jobs[0].symbol = { ticker: 'A', exchange: '' }; r.jobs[0].tf = 'D' }),
    k((r) => { r.jobs[0].symbol = { ticker: 'A', exchange: 'D' }; r.jobs[0].tf = 'W' }),
  )
})

test('W9-T11: the window is in the result key only when the job states one (every older key unchanged)', () => {
  const base = { newestBarIsForming: false, historyFromListing: true, runtimeInputs: { a: 1 } }
  assert.equal(canonicalCtx(base), canonicalCtx({ ...base }), 'control')
  assert.equal(canonicalCtx(base).includes('window='), false)
  const a = canonicalCtx({ ...base, historyWindowBars: 5 })
  const b = canonicalCtx({ ...base, historyWindowBars: 6 })
  assert.notEqual(a, canonicalCtx(base))
  assert.notEqual(a, b)
})
