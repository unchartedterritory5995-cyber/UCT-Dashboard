// W5-INT rails: the T8 caches ON THE RUN PATH (cache.mjs createResultLane + DocCache, wired by
// server.mjs, design 3.3). A hit is a COPY under this request's job id; only a sealed, deterministic
// miss is stored; the canary's all-zero hashes never touch the cache; `doc: null` is answered from
// the document cache with a fresh copy.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { signHeader, SIGNATURE_HEADER } from '../auth.mjs'
import { ResultCache, cacheKeyOf, createResultLane } from '../cache.mjs'
import { sealRunResults } from '../protocol.mjs'
import { createPineRuntimeServer, listenDualStack } from '../server.mjs'
import { CODEC, DOOR, IDENTITY, SECRET, validRequest } from './helpers.mjs'

const T = 1_800_000_000
const servers = []
after(async () => { for (const s of servers) await new Promise((d) => s.close(d)) })

const okOf = (j) => ({ job: j.job, status: 'ok', columns: {}, refusals: [], warmup: { withheldBars: 0 }, ms: 7 })
const stopOf = (guard) => (j) => ({ job: j.job, status: 'withheld', refusals: [{ key: '*', guard, sentence: 's', bar: null }], ms: 7 })

/** A server built with the DEFAULTS (so the rails prove the caches are on by default) and a counting runner. */
async function boot({ answer = okOf, server = {} } = {}) {
  const calls = []
  const runner = async (req) => { calls.push(req); return req.jobs.map((j) => answer(j, req)) }
  const s = createPineRuntimeServer({ secrets: [SECRET], door: DOOR, runner, now: () => T, log: () => {}, ...server })
  const port = await listenDualStack(s, 0)
  servers.push(s)
  let t = T - 50
  const post = (obj) => new Promise((done, fail) => {
    const body = Buffer.from(JSON.stringify(obj))
    t += 1 // a fresh signature each time (the replay guard is not under test here)
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/v1/run',
      headers: { 'content-length': body.length, [SIGNATURE_HEADER]: signHeader(SECRET, t, body) } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => done({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    req.on('error', fail)
    req.end(body)
  })
  return { calls, post }
}

const renamed = (req, suffix) => ({ ...req, jobs: req.jobs.map((j) => ({ ...j, job: `${j.job}${suffix}` })) })

test('on by default: a repeated job is answered from the cache, under THIS request job id, with the same digest', async () => {
  const { calls, post } = await boot()
  const a = await post(validRequest())
  assert.equal(a.status, 200)
  assert.deepEqual(a.json.results.map((r) => r.cache), ['miss', 'miss'])
  const b = await post(renamed(validRequest(), '#2'))
  assert.equal(b.status, 200, JSON.stringify(b.json))
  assert.equal(calls.length, 1, 'the second request ran no job')
  assert.deepEqual(b.json.results.map((r) => [r.job, r.cache]), [['SYM0|D#2', 'hit'], ['SYM1|D#2', 'hit']])
  assert.deepEqual(b.json.results.map((r) => r.digest), a.json.results.map((r) => r.digest))
  assert.ok(b.json.results.every((r) => !('ms' in r)), 'a hit carries no run time')
})

test('only the misses reach the runner, as one request, and the answers come back in order', async () => {
  const { calls, post } = await boot()
  await post(validRequest({ jobs: 1 }))
  const r = await post(validRequest({ jobs: 3 })) // SYM0 is held; SYM1, SYM2 are not
  assert.equal(r.status, 200)
  assert.deepEqual(calls[1].jobs.map((j) => j.job), ['SYM1|D', 'SYM2|D'])
  assert.deepEqual(r.json.results.map((x) => [x.job, x.cache]), [['SYM0|D', 'hit'], ['SYM1|D', 'miss'], ['SYM2|D', 'miss']])
})

test('never stored: a wall-clock stop, any runtime:server-* stop; a deterministic stop IS stored', async () => {
  for (const guard of ['runtime:time-budget', 'runtime:server-worker-failed', 'runtime:server-busy', 'runtime:server-worker-oom', 'runtime:server-integrity']) {
    const { calls, post } = await boot({ answer: stopOf(guard) })
    await post(validRequest({ jobs: 1 }))
    const again = await post(validRequest({ jobs: 1 }))
    assert.equal(calls.length, 2, `${guard} was answered from the cache`)
    assert.equal(again.json.results[0].cache, 'miss')
  }
  const { calls, post } = await boot({ answer: stopOf('runtime:limit') })
  await post(validRequest({ jobs: 1 }))
  assert.equal((await post(validRequest({ jobs: 1 }))).json.results[0].cache, 'hit')
  assert.equal(calls.length, 1)
})

test('a reply the seal refuses stores nothing', async () => {
  let bad = true
  const { calls, post } = await boot({ answer: (j) => (bad ? { ...okOf(j), extra: 1 } : okOf(j)) })
  assert.equal((await post(validRequest({ jobs: 1 }))).status, 500)
  bad = false
  const r = await post(validRequest({ jobs: 1 }))
  assert.equal(r.status, 200)
  assert.equal(r.json.results[0].cache, 'miss')
  assert.equal(calls.length, 2)
})

test('no shared objects: a hit is a deep copy, and the runner object is not the stored one', async () => {
  const lane = createResultLane({ cache: new ResultCache() })
  const req = validRequest({ jobs: 1 })
  const fresh = { job: 'SYM0|D', status: 'ok', columns: {}, warmup: { withheldBars: 0 }, ms: 3,
    refusals: [{ key: 'p', guard: 'runtime:limit', sentence: 's', bar: null }] }
  const seal = (rs) => ({ ok: true, results: rs })
  const first = await lane.answer(req, async () => [fresh], seal)
  assert.equal(first.results[0].cache, 'miss')
  fresh.refusals[0].guard = 'runtime:CHANGED' // the runner's object, after the store
  first.results[0].refusals.push({ key: 'z' }) // a caller's copy
  const hit1 = await lane.answer(req, async () => assert.fail('a hit must not run'), seal)
  assert.equal(hit1.results[0].cache, 'hit')
  assert.deepEqual(hit1.results[0].refusals, [{ key: 'p', guard: 'runtime:limit', sentence: 's', bar: null }])
  hit1.results[0].warmup.withheldBars = 99
  hit1.results[0].job = 'mutated'
  const hit2 = await lane.answer(req, async () => assert.fail('a hit must not run'), seal)
  assert.equal(hit2.results[0].warmup.withheldBars, 0, 'mutating one hit cannot reach the next')
  assert.equal(hit2.results[0].job, 'SYM0|D')
  assert.notEqual(hit1.results[0], hit2.results[0])
})

test('the canary all-zero hashes are never a key: nothing is read or stored for them', async () => {
  const zero = '0'.repeat(64)
  const req = validRequest({ jobs: 2 })
  assert.notEqual(cacheKeyOf(req, req.jobs[0]), null)
  const docZero = { ...req, definition: { ...req.definition, doc_sha256: zero } }
  const barsZero = { ...req, jobs: req.jobs.map((j) => ({ ...j, bars: { ...j.bars, sha256: zero } })) }
  for (const r of [docZero, barsZero]) {
    assert.equal(cacheKeyOf(r, r.jobs[0]), null)
    const lane = createResultLane()
    let runs = 0
    const runner = async (x) => { runs += 1; return x.jobs.map(okOf) }
    const seal = (rs) => sealRunResults(CODEC, IDENTITY, r.jobs, rs)
    for (let i = 0; i < 3; i += 1) {
      const out = await lane.answer(r, runner, seal)
      assert.equal(out.ok, true)
      assert.deepEqual(out.results.map((x) => x.cache), ['miss', 'miss'])
    }
    assert.equal(runs, 3, 'every canary run computes')
    assert.equal(lane.stats().entries, 0, 'nothing filed under a placeholder hash')
  }
})

test('doc: null is answered from the document cache once the service has hashed the document, as a fresh copy', async () => {
  const seen = []
  const { calls, post } = await boot({ answer: (j, req) => {
    seen.push(structuredClone(req.definition.doc))
    req.definition.doc.compute.source = 'MUTATED'
    return okOf(j)
  } })
  const withDoc = validRequest({ jobs: 1 })
  const bare = renamed(validRequest({ jobs: 1 }), '#b')
  bare.definition = { ...withDoc.definition, doc: null }
  bare.jobs[0].ctx = { ...bare.jobs[0].ctx, runtimeInputs: { length: 15 } } // another result key, so it runs
  const unknown = await post(bare)
  assert.equal(unknown.status, 409, 'not held yet')
  assert.equal(unknown.json.error.guard, 'runtime:server-doc-unknown')
  assert.equal((await post(withDoc)).status, 200)
  const r = await post(bare)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(calls.length, 2)
  assert.deepEqual(seen[1], JSON.parse(withDoc.definition.doc), 'the held document, unchanged by the run that mutated its own copy')
  // a third run from the cache: the second run mutated ITS copy, never the held document
  const third = { ...bare, jobs: [{ ...bare.jobs[0], ctx: { ...bare.jobs[0].ctx, runtimeInputs: { length: 16 } } }] }
  assert.equal((await post(third)).status, 200)
  assert.deepEqual(seen[2], JSON.parse(withDoc.definition.doc), 'a run cannot change the document another request is served')
  // a document the door refused (wrong hash) is never held
  const wrong = validRequest({ jobs: 1, doc: JSON.stringify({ id: 'u_0123456789ab', compute: { fn: 'runtime', source: 'other' } }) })
  const sha = wrong.definition.doc_sha256
  wrong.definition.doc_sha256 = 'c'.repeat(64)
  assert.equal((await post(wrong)).status, 422)
  assert.equal((await post({ ...wrong, definition: { ...wrong.definition, doc: null } })).status, 409)
  assert.equal((await post({ ...wrong, definition: { ...wrong.definition, doc_sha256: sha, doc: null } })).status, 409)
})

test('the caches can be turned off (null): every doc must be sent and every job runs', async () => {
  const { calls, post } = await boot({ server: { docCache: null, resultLane: null } })
  const req = validRequest({ jobs: 1 })
  assert.equal((await post(req)).status, 200)
  const again = await post(req)
  assert.equal(again.json.results[0].cache, undefined)
  assert.equal(calls.length, 2)
  assert.equal((await post({ ...req, definition: { ...req.definition, doc: null } })).status, 409)
})
