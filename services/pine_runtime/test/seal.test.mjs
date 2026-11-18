// W5-T7b rails: the response is a CLOSED schema and every result carries the design 2.3 digest
// (protocol.mjs sealRunResults, wired as step 6 of server.mjs), and an ok result carries the run's
// own warm-up (job.mjs). The codec is T3's module (helpers.CODEC); the service reads the bundle's.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signHeader, SIGNATURE_HEADER } from '../auth.mjs'
import { CACHE_STATES, RESULT_FIELDS, RUNNER_RESULT_FIELDS, REFUSAL_FIELDS, WARMUP_FIELDS, sealRunResults } from '../protocol.mjs'
import { bytesToB64, encodeColumn } from '../../../app/src/components/chart/engine/runtime/columnDigest.js'
import { createPineRuntimeServer, listenDualStack, loadBundle } from '../server.mjs'
import { encodeResult, runJob } from '../job.mjs'
import { createPool } from '../pool.mjs'
import { CODEC, DOOR, IDENTITY, SECRET, f64b64, validRequest } from './helpers.mjs'
import { FAKE_BUNDLE, parsedJob, parsedRequest } from './poolFixtures.mjs'

const N = 5
const jobs = (k = 1) => Array.from({ length: k }, (_, i) => ({ job: `J${i}`, bars: { n: N } }))
const okResult = (over = {}) => ({
  job: 'J0', status: 'ok', columns: { value: f64b64([1, 2, NaN, -0, 5]) },
  refusals: [{ key: 'gone', guard: 'runtime:server-output-absent', sentence: 'no `gone`.', bar: null }],
  warmup: { withheldBars: 2 }, ms: 3, ...over,
})
const heldResult = (over = {}) => ({
  job: 'J0', status: 'withheld', refusals: [{ key: '*', guard: 'runtime:limit', sentence: 'too much.', bar: 4 }], ...over,
})
const seal = (r, js = jobs()) => sealRunResults(CODEC, IDENTITY, js, Array.isArray(r) ? r : [r])
const refused = (r, re, js) => {
  const out = seal(r, js)
  assert.equal(out.ok, false, `expected a refusal for ${JSON.stringify(r)}`)
  if (re) assert.match(out.sentence, re)
}
const b64Of = (text) => new Uint8Array(Buffer.from(text, 'base64'))

test('an ok result is sealed with the T3 digest of the DECODED wire columns, the refusals and the service identity', () => {
  const out = seal(okResult())
  assert.equal(out.ok, true)
  const [r] = out.results
  const value = CODEC.decodeColumn(b64Of(okResult().columns.value), N)
  assert.equal(r.digest, CODEC.columnDigest({ engine: IDENTITY, columns: { value }, refusals: okResult().refusals }))
  assert.match(r.digest, /^[0-9a-f]{64}$/)
  assert.deepEqual(Object.keys(r).sort(), [...RESULT_FIELDS.ok.required, 'ms'].sort(), 'the wire result is exactly the declared set')
  assert.deepEqual(r.warmup, { withheldBars: 2 })
  assert.equal(r.columns.value, okResult().columns.value, 'the column bytes are sent as received')
  // the digest moves with each input it covers: a column byte, the identity, a refusal
  const flipped = Buffer.from(okResult().columns.value, 'base64'); flipped[0] ^= 1
  assert.notEqual(seal(okResult({ columns: { value: flipped.toString('base64') } })).results[0].digest, r.digest)
  assert.notEqual(sealRunResults(CODEC, { ...IDENTITY, script_engine: 6 }, jobs(), [okResult()]).results[0].digest, r.digest)
  assert.notEqual(seal(okResult({ refusals: [] })).results[0].digest, r.digest)
})

test('a withheld result is sealed too: the digest of no columns and its refusals', () => {
  const out = seal(heldResult())
  assert.equal(out.ok, true)
  const [r] = out.results
  assert.equal(r.digest, CODEC.columnDigest({ engine: IDENTITY, columns: {}, refusals: heldResult().refusals }))
  assert.deepEqual(Object.keys(r).sort(), [...RESULT_FIELDS.withheld.required].sort())
  assert.equal(r.columns, undefined)
  assert.equal(r.warmup, undefined)
})

test('LIMITS r1: a refusal may carry its engine limit NAME as a field, kept on the wire and out of the digest', () => {
  const held = heldResult()
  const named = { ...held, refusals: held.refusals.map((x, i) => (i === 0 ? { ...x, limit: 'CALL_COUNT' } : x)) }
  const out = seal(named)
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.results[0].refusals[0].limit, 'CALL_COUNT')
  assert.equal(out.results[0].digest, seal(heldResult()).results[0].digest, 'the name is not in the preimage')
  assert.equal(seal(heldResult()).results[0].refusals[0].limit, undefined, 'absent stays absent')
  for (const bad of ['call_count', '', 7, null, 'CALL COUNT']) {
    refused({ ...held, refusals: held.refusals.map((x, i) => (i === 0 ? { ...x, limit: bad } : x)) }, /limit: must be an engine limit name/)
  }
})

test('the schema stays CLOSED: an unknown field anywhere in a result is refused, and so is a missing one', () => {
  for (const extra of ['digest', 'instructions', 'warmUp', 'secret', 'cached', 'Cache']) {
    refused(okResult({ [extra]: 'x' }), /unknown key/)
    refused(heldResult({ [extra]: 'x' }), /unknown key/)
  }
  refused(heldResult({ warmup: { withheldBars: 0 } }), /unknown key "warmup"/)
  refused(heldResult({ columns: {} }), /unknown key "columns"/)
  refused(okResult({ refusals: [{ ...okResult().refusals[0], extra: 1 }] }), /unknown key "extra"/)
  refused(okResult({ warmup: { withheldBars: 1, shift: 73 } }), /unknown key "shift"/)
  for (const k of RUNNER_RESULT_FIELDS.ok.required) { const r = okResult(); delete r[k]; refused(r) }
  for (const k of RUNNER_RESULT_FIELDS.withheld.required) { const r = heldResult(); delete r[k]; refused(r) }
  for (const k of REFUSAL_FIELDS) {
    const x = { ...okResult().refusals[0] }
    delete x[k]
    refused(okResult({ refusals: [x] }), /missing key/)
  }
  for (const k of WARMUP_FIELDS) refused(okResult({ warmup: {} }), new RegExp(`missing key "${k}"`))
  refused(okResult({ status: 'maybe' }), /must be 'ok' or 'withheld'/)
  refused(Object.assign(Object.create({ status: 'ok' }), { job: 'J0' }), /must be an object/)
  refused(null, /results\[0\]: must be an object/)
})

test('the warm-up is a bar count from 0 to n, never guessed', () => {
  for (const ok of [0, 1, N]) assert.equal(seal(okResult({ warmup: { withheldBars: ok } })).ok, true, String(ok))
  for (const bad of [-1, N + 1, 1.5, '2', null, true, Number.NaN]) {
    refused(okResult({ warmup: { withheldBars: bad } }), /warmup\.withheldBars: must be a bar count from 0 to 5/)
  }
  refused(okResult({ warmup: null }), /warmup: must be an object/)
})

test('a column must decode to exactly n canonical values: length, NaN payload and base64 are each checked', () => {
  refused(okResult({ columns: { value: f64b64([1, 2, 3, 4]) } }), /is not 5 canonical values/)
  refused(okResult({ columns: { value: f64b64([1, 2, 3, 4, 5, 6]) } }), /is not 5 canonical values/)
  const odd = Buffer.from(f64b64([1, 2, 3, 4, 5]), 'base64')
  odd.writeUInt32LE(0x7ff80001, 4) // row 0 becomes a NaN whose payload is not the canonical one
  refused(okResult({ columns: { value: odd.toString('base64') } }), /non-canonical payload/)
  refused(okResult({ columns: { value: `${f64b64([1, 2, 3, 4, 5])}\n` } }), /canonical base64/)
  refused(okResult({ columns: { value: 7 } }), /canonical base64/)
  refused(okResult({ columns: [] }), /columns: must be an object/)
})

test('the ok / withheld rules: never ok and run-wide at once, never withheld without a reason, never served and refused', () => {
  refused(okResult({ refusals: [{ key: '*', guard: 'runtime:limit', sentence: '', bar: null }] }), /an ok job cannot carry a run-wide/)
  refused(heldResult({ refusals: [{ key: 'value', guard: 'g', sentence: '', bar: null }] }), /must name a run-wide/)
  refused(heldResult({ refusals: [] }), /must name a run-wide/)
  refused(okResult({ refusals: [{ key: 'value', guard: 'g', sentence: '', bar: null }] }), /both serves and refuses/)
  for (const bar of [-1, 1.5, 2 ** 32, '3']) refused(heldResult({ refusals: [{ key: '*', guard: 'g', sentence: '', bar }] }), /bar/)
  refused(heldResult({ refusals: [{ key: '', guard: 'g', sentence: '', bar: null }] }), /key/)
  refused(heldResult({ refusals: [{ key: '*', guard: '', sentence: '', bar: null }] }), /guard/)
  refused(heldResult({ refusals: [{ key: '*', guard: 'g', sentence: 5, bar: null }] }), /sentence/)
  refused(okResult({ ms: -1 }), /ms/)
})

test('every job answered once, in order, by id: a short, long or swapped answer is refused whole', () => {
  refused([okResult()], /every job once/, jobs(2))
  refused([okResult(), okResult({ job: 'J1' })], /every job once/, jobs(1))
  refused([okResult({ job: 'J1' }), okResult({ job: 'J0' })], /does not answer the job in its place/, jobs(2))
  assert.equal(sealRunResults(CODEC, IDENTITY, jobs(), 'nope').ok, false)
  assert.equal(seal([okResult(), heldResult({ job: 'J1' })], jobs(2)).ok, true)
})

test("job.mjs: an ok result carries the run's own warm-up, 0 when it withheld none; a stop carries none", () => {
  const rt = {
    RUNTIME_INCREMENTAL_KEY: '__inc', RUNTIME_OBJECTS_KEY: '__obj', RUNTIME_PANE_TIME_BUDGET_MS: 1, RUNTIME_FAILED_GUARD: 'runtime:failed',
    resetRuntimeSessions() {}, resetRuntimeLedgers() {},
    runtimeWarmupOf: (c) => c.__warm || null,
    encodeColumn, bytesToB64,
    computeRuntimeColumns: (def, rows) => {
      const cols = { value: rows.map((r) => r.c) }
      if (def.compute.source === 'curtain') Object.defineProperty(cols, '__warm', { enumerable: false, value: { withheldBars: 2, shift: 9 } })
      if (def.compute.source === 'stop') throw Object.assign(new Error('x'), { guard: 'runtime:limit' })
      return cols
    },
  }
  const doc = (source) => ({ id: 'u_0123456789ab', compute: { kind: 'runtime', source }, meta: {} })
  const job = () => parsedJob('A', { n: 3 })
  assert.deepEqual(runJob(rt, doc('curtain'), job()).warmup, { withheldBars: 2 }, 'only the bar count crosses; shift stays home')
  assert.deepEqual(runJob(rt, doc('plain'), job()).warmup, { withheldBars: 0 })
  assert.equal(runJob(rt, doc('stop'), job()).warmup, undefined)
  const sealed = sealRunResults(CODEC, IDENTITY, [job()], [runJob(rt, doc('curtain'), job())])
  assert.equal(sealed.ok, true, 'what job.mjs returns is exactly the runner schema the seal accepts')
  // a run whose warm-up record is not a bar count is not passed off as 0: the seal refuses it
  const odd = encodeResult({ ...rt, runtimeWarmupOf: () => ({ shift: 9 }) }, job(), rt.computeRuntimeColumns(doc('plain'), [{ c: 1 }, { c: 2 }, { c: 3 }]))
  assert.equal(sealRunResults(CODEC, IDENTITY, [job()], [odd]).ok, false)
})

// ─── over HTTP: step 6 is wired ─────────────────────────────────────────────────

const servers = []
after(async () => { for (const s of servers) await new Promise((d) => s.close(d)) })
const T = 1_800_000_000
async function boot(runner, door = DOOR) {
  const server = createPineRuntimeServer({ secrets: [SECRET], door, runner, now: () => T, log: () => {} })
  const port = await listenDualStack(server, 0)
  servers.push(server)
  return port
}
let seq = 0
function post(port, obj) {
  // a distinct body per call, so T6's replay guard never refuses a rail's second request
  const body = Buffer.from(JSON.stringify({ ...obj, owner: `hmac:${(seq += 1).toString(16).padStart(16, '0')}` }))
  return new Promise((done, fail) => {
    const r = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/v1/run',
      headers: { 'content-length': body.length, [SIGNATURE_HEADER]: signHeader(SECRET, T, body) } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => done({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    r.on('error', fail)
    r.end(body)
  })
}

test('server step 6: every result on the wire is sealed; a runner field outside the schema is a 500 with no results', async () => {
  const good = await boot(async (req) => req.jobs.map((j, i) => (i === 0
    ? okResult({ job: j.job, refusals: [] }) : heldResult({ job: j.job }))))
  const r = await post(good, validRequest())
  assert.equal(r.status, 200)
  const [ok, held] = r.json.results
  const value = CODEC.decodeColumn(b64Of(ok.columns.value), N)
  assert.equal(ok.digest, CODEC.columnDigest({ engine: r.json.engine, columns: { value }, refusals: ok.refusals }), 'verifiable from the reply alone')
  assert.equal(held.digest, CODEC.columnDigest({ engine: r.json.engine, columns: {}, refusals: held.refusals }))
  assert.deepEqual(ok.warmup, { withheldBars: 2 })
  const leaky = await boot(async (req) => req.jobs.map((j) => okResult({ job: j.job, refusals: [], debug: 'x' })))
  const l = await post(leaky, validRequest())
  assert.equal(l.status, 500)
  assert.equal(l.json.results, undefined)
  assert.equal(l.json.error.guard, 'runtime:server-failed')
  const forged = await boot(async (req) => req.jobs.map((j) => okResult({ job: j.job, refusals: [], digest: '0'.repeat(64) })))
  assert.equal((await post(forged, validRequest())).status, 500, "a digest is the seal's, never the runner's")
})

test('loadBundle refuses a bundle that carries no T3 codec: the service never digests with a second implementation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pine-rt-t7b-'))
  try {
    const base = 'export const SCRIPT_ENGINE_VERSION = 1\nexport const RUNTIME_FRONTEND_LANGUAGE = "pine"\n'
      + 'export const RUNTIME_FRONTEND_VERSION = 1\nexport const RUNTIME_IR_VERSION = 1\nexport const NATIVE_TFS = ["D"]\n'
      + 'export const DEFAULT_LIMITS = { HISTORY: 10 }\n'
    for (const [name, text, re] of [
      ['none.mjs', base, /exports no columnDigest/],
      ['half.mjs', `${base}export function columnDigest() { return '' }\n`, /exports no decodeColumn/],
    ]) {
      writeFileSync(join(dir, name), text)
      await assert.rejects(loadBundle(join(dir, name)), re)
    }
    writeFileSync(join(dir, 'both.mjs'), `${base}export function columnDigest() { return 'd' }\nexport function decodeColumn() { return [] }\n`)
    const door = await loadBundle(join(dir, 'both.mjs'))
    assert.equal(door.codec.columnDigest(), 'd', "the codec the seal uses is the bundle's own export")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the pool refuses to start on a bundle with no runtimeWarmupOf, and an ok job through it carries the warm-up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pine-rt-t7b-boot-'))
  try {
    const text = readFileSync(FAKE_BUNDLE, 'utf8')
    const bad = join(dir, 'nowarm.mjs')
    writeFileSync(bad, text.replace('export function runtimeWarmupOf', 'function runtimeWarmupOf'))
    await assert.rejects(createPool({ bundle: bad, workers: 1 }), /exports no runtimeWarmupOf/)
    const pool = await createPool({ bundle: FAKE_BUNDLE, workers: 1 })
    try {
      const [r] = await pool.run(parsedRequest({ source: 'warmup:2', jobs: [parsedJob('W', { n: 3 })] }))
      assert.equal(r.status, 'ok')
      assert.deepEqual(r.warmup, { withheldBars: 2 }, 'the warm-up crosses the worker boundary')
    } finally { await pool.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('W5-INT: the closed schema admits `cache` (design 3.2) by name and value only; `instructions` stays refused', () => {
  assert.deepEqual(CACHE_STATES, ['hit', 'miss'])
  // W9-T14: an ok result may also carry the run's strategy record (and the seal adds its hash);
  // a withheld one never does (strategy.test.mjs holds the record's own rules)
  assert.deepEqual(RUNNER_RESULT_FIELDS.ok.optional, ['ms', 'cache', 'strategy'])
  assert.deepEqual(RESULT_FIELDS.ok.optional, ['ms', 'cache', 'strategy', 'strategy_sha256'])
  assert.deepEqual(RUNNER_RESULT_FIELDS.withheld.optional, ['ms', 'cache'])
  assert.deepEqual(RESULT_FIELDS.withheld.optional, ['ms', 'cache'])
  for (const state of CACHE_STATES) {
    for (const r of [okResult({ cache: state }), heldResult({ cache: state })]) {
      const out = seal(r)
      assert.equal(out.ok, true, JSON.stringify(out))
      assert.equal(out.results[0].cache, state, 'the seal carries it onto the wire')
    }
  }
  for (const bad of ['x', 'HIT', '', null, true, 1, ['hit'], { hit: 1 }]) {
    refused(okResult({ cache: bad }), /cache: must be one of hit, miss/)
    refused(heldResult({ cache: bad }), /cache: must be one of hit, miss/)
  }
  refused(okResult({ instructions: 1830551 }), /unknown key "instructions"/)
  // absent stays absent (a server with no result cache sends none)
  assert.equal(Object.hasOwn(seal(okResult()).results[0], 'cache'), false)
})
