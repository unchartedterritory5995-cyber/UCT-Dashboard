// TRACK 6, AL2 rails: the service's `#alerts` handling. A job under profile `alert` may ask for the run's alert()
// record (AL1: `runtimeAlertsOf`, `{fromBar: 0, events: [{bar, message, freq}], dropped}`) with `want: ['#alerts']`;
// the job adapter (job.mjs) writes the run's own record as JSON text, the seal (protocol.mjs) checks it against the
// closed shape and adds `alerts_sha256`, and the result cache files it under a key that names the want.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  ALERTS_MAX_EVENTS, ALERTS_MAX_MESSAGE, ALERTS_PROFILE, ALERTS_WANT, INTEGRITY_GUARD, PROFILES,
  alertsRecordShapeErrors, parseRunRequest, sealRunResults,
} from '../protocol.mjs'
import { OUTPUT_ABSENT_GUARD, encodeResult, runJob } from '../job.mjs'
import { resultKey } from '../cache.mjs'
import { loadBundle } from '../server.mjs'
import * as T3 from '../../../app/src/components/chart/engine/runtime/columnDigest.js'
import { ALERT_LOG_CAP, ALERT_MESSAGE_CAP } from '../../../app/src/components/chart/engine/runtime/collections.js'
import { CODEC, DOOR, IDENTITY, validRequest } from './helpers.mjs'
import { buildRealBundle, docOf, parsedJob } from './poolFixtures.mjs'

// runtimeColumns.js cannot be imported bare under node (it imports JSON); the REAL bundle test below reads its reader
const RUNTIME_ALERTS_KEY = '__runtimeAlerts'
const runtimeAlertsOf = (cols) => (cols && typeof cols[RUNTIME_ALERTS_KEY] === 'object' ? cols[RUNTIME_ALERTS_KEY] : null)
const N = 5
const record = (events = [{ bar: 3, message: 'crossed up', freq: 'once_per_bar_close' }], dropped = 0) =>
  ({ fromBar: 0, events, dropped })
const sha = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
const wantJob = (want = [ALERTS_WANT]) => ({ job: 'J0', bars: { n: N }, want })
const okResult = (over = {}) => ({ job: 'J0', status: 'ok', columns: {}, refusals: [], warmup: { withheldBars: 0 }, ...over })
const seal = (r, job = wantJob()) => sealRunResults(CODEC, IDENTITY, [job], [r])
const refused = (r, re, job) => {
  const out = seal(r, job)
  assert.equal(out.ok, false, `expected a refusal for ${JSON.stringify(r).slice(0, 200)}`)
  if (re) assert.match(out.sentence, re)
}
const rtOf = () => ({
  RUNTIME_INCREMENTAL_KEY: '__inc', RUNTIME_OBJECTS_KEY: '__obj', encodeColumn: T3.encodeColumn, bytesToB64: T3.bytesToB64,
  runtimeWarmupOf: () => null, runtimeAlertsOf,
})
const colsWith = (o, rec) => {
  Object.defineProperty(o, '__inc', { enumerable: false, value: { resumedFrom: null } })
  if (rec !== undefined) Object.defineProperty(o, RUNTIME_ALERTS_KEY, { enumerable: false, value: rec })
  return o
}

test('the want entry and its profile are the protocol\'s, and only `alert` may ask for the record', () => {
  assert.equal(ALERTS_WANT, '#alerts')
  assert.equal(ALERTS_PROFILE, 'alert')
  for (const profile of PROFILES) {
    const req = validRequest({ jobs: 1 })
    req.profile = profile
    req.jobs[0].want = ['value', ALERTS_WANT]
    const out = parseRunRequest(Buffer.from(JSON.stringify(req)), DOOR)
    if (profile === ALERTS_PROFILE) {
      assert.equal(out.ok, true, JSON.stringify(out))
      assert.deepEqual(out.request.jobs[0].want, ['value', ALERTS_WANT])
    } else {
      assert.equal(out.ok, false, profile)
      assert.equal(out.status, 400)
      assert.match(out.sentence, /only profile "alert" may ask for/)
    }
  }
  // control: the same request without the record is accepted under every profile
  for (const profile of PROFILES) {
    const req = validRequest({ jobs: 1 })
    req.profile = profile
    req.jobs[0].want = ['value']
    assert.equal(parseRunRequest(Buffer.from(JSON.stringify(req)), DOOR).ok, true, profile)
  }
})

test('the caps are AL1\'s own (collections.js), so the seal and the engine cannot drift', () => {
  assert.equal(ALERTS_MAX_EVENTS, ALERT_LOG_CAP)
  assert.equal(ALERTS_MAX_MESSAGE, ALERT_MESSAGE_CAP)
})

test('the adapter writes the run\'s record as JSON text, beside the columns and never one of them', () => {
  const rec = record()
  const cols = colsWith({ value: [1, 2, 3, 4, 5] }, rec)
  const out = encodeResult(rtOf(), { job: 'J0', bars: { n: N }, want: ['value', ALERTS_WANT] }, cols)
  assert.equal(out.status, 'ok', JSON.stringify(out))
  assert.deepEqual(Object.keys(out.columns), ['value'])
  assert.equal(out.alerts, JSON.stringify(rec))
  assert.deepEqual(out.refusals, [])
  // not asked: no record on the wire, even when the run made one
  const plain = encodeResult(rtOf(), { job: 'J0', bars: { n: N }, want: ['value'] }, colsWith({ value: [1, 2, 3, 4, 5] }, rec))
  assert.equal(Object.hasOwn(plain, 'alerts'), false)
})

test('a run that made no record refuses \'#alerts\' by name; a value JSON cannot carry withholds the whole job', () => {
  const none = encodeResult(rtOf(), wantJob(), colsWith({}))
  assert.equal(none.status, 'ok')
  assert.equal(Object.hasOwn(none, 'alerts'), false)
  assert.deepEqual(none.refusals.map((r) => [r.key, r.guard]), [[ALERTS_WANT, OUTPUT_ABSENT_GUARD]])
  const bad = encodeResult(rtOf(), wantJob(), colsWith({}, record([{ bar: NaN, message: 'x', freq: 'all' }])))
  assert.equal(bad.status, 'withheld')
  assert.equal(bad.refusals[0].key, '*')
  assert.equal(bad.refusals[0].guard, INTEGRITY_GUARD)
})

test('the seal carries the record text unchanged, adds its sha256, and leaves the T3 digest as it was', () => {
  const text = JSON.stringify(record())
  const out = seal(okResult({ alerts: text }))
  assert.equal(out.ok, true, JSON.stringify(out))
  const r = out.results[0]
  assert.equal(r.alerts, text)
  assert.equal(r.alerts_sha256, sha(text))
  const without = seal(okResult(), wantJob([]))
  assert.equal(without.ok, true)
  assert.equal(r.digest, without.results[0].digest, 'the record is outside the T3 digest')
  // a withheld message and an empty log are records too
  assert.equal(seal(okResult({ alerts: JSON.stringify(record([{ bar: 0, message: null, freq: '' }])) })).ok, true)
  assert.equal(seal(okResult({ alerts: JSON.stringify(record([])) })).ok, true)
})

test('the seal refuses a record nobody asked for, one asked for and neither served nor refused, and both at once', () => {
  const text = JSON.stringify(record())
  refused(okResult({ alerts: text }), /did not ask for/, wantJob([]))
  refused(okResult(), /neither serves nor refuses/)
  refused(okResult({ alerts: text, refusals: [{ key: ALERTS_WANT, guard: OUTPUT_ABSENT_GUARD, sentence: 'x', bar: null }] }),
    /both serves and refuses/)
  refused(okResult({ columns: { [ALERTS_WANT]: 'AAAA' } }), /alert record as a column/)
  // and a refusal alone is a whole answer
  assert.equal(seal(okResult({ refusals: [{ key: ALERTS_WANT, guard: OUTPUT_ABSENT_GUARD, sentence: 'x', bar: null }] })).ok, true)
})

test('the seal holds the record to its closed shape', () => {
  const shapes = [
    [{ ...record(), extra: 1 }, /keys are/],
    [{ ...record(), fromBar: 2 }, /fromBar is not 0/],
    [{ ...record(), dropped: -1 }, /dropped is not a count/],
    [record([{ bar: N, message: 'x', freq: 'all' }]), /bar is not a bar of this run/],
    [record([{ bar: 1.5, message: 'x', freq: 'all' }]), /bar is not a bar of this run/],
    [record([{ bar: 1, message: 'x'.repeat(ALERTS_MAX_MESSAGE + 1), freq: 'all' }]), /message is not null or a string/],
    [record([{ bar: 1, message: 7, freq: 'all' }]), /message is not null or a string/],
    [record([{ bar: 1, message: 'x', freq: null }]), /freq is not a string/],
    [record([{ bar: 1, message: 'x' }]), /is not \{bar, message, freq\}/],
    [record(Array.from({ length: ALERTS_MAX_EVENTS + 1 }, () => ({ bar: 1, message: 'x', freq: 'all' }))), /more than 500/],
  ]
  for (const [rec, re] of shapes) {
    assert.ok(alertsRecordShapeErrors(rec, N).length > 0, JSON.stringify(rec).slice(0, 120))
    refused(okResult({ alerts: JSON.stringify(rec) }), re)
  }
  refused(okResult({ alerts: '{not json' }), /is not JSON/)
  refused(okResult({ alerts: JSON.stringify([1]) }), /not an object/)
  // control: the cap itself is a record
  const full = record(Array.from({ length: ALERTS_MAX_EVENTS }, (_, i) => ({ bar: i % N, message: 'x', freq: 'all' })), 3)
  assert.deepEqual(alertsRecordShapeErrors(full, N), [])
})

test('the result cache files an \'#alerts\' answer under a key that names the want', () => {
  const req = { engine: { ...IDENTITY }, definition: { doc_sha256: 'a'.repeat(64) }, profile: 'alert' }
  const job = parsedJob('J0', { n: 3 })
  const plain = resultKey(req, { ...job, want: ['value'] })
  const asks = resultKey(req, { ...job, want: ['value', ALERTS_WANT] })
  assert.notEqual(plain, asks)
  assert.equal(asks, resultKey(req, { ...job, want: [ALERTS_WANT, 'value'] }), 'the want is sorted, never ordered')
})

// The sealed reply `tests/test_pine_runtime_alerts_wire.py` decodes through the Python client: this seal's own
// output, never hand-typed. UPDATE_AL2_FIXTURE=1 writes it; otherwise the committed file must equal it.
const FIXTURE = new URL('../../../tests/fixtures/pine_runtime/al2_alerts_result.json', import.meta.url)
test('the sealed fixture the Python client decodes is this seal\'s own output', () => {
  const identity = { script_engine: 'fixture', runtime_language: 'pine', runtime_frontend: 1, runtime_ir: 1, bundle_sha256: 'ab'.repeat(32) }
  const job = { job: 'SPY', bars: { n: 12 }, want: [ALERTS_WANT] }
  const text = JSON.stringify(record([{ bar: 3, message: 'hit', freq: 'once_per_bar_close' }, { bar: 7, message: null, freq: 'all' }]))
  const out = sealRunResults(CODEC, identity, [job], [okResult({ job: 'SPY', alerts: text })])
  assert.equal(out.ok, true, JSON.stringify(out))
  const fx = { identity, job: { job: 'SPY', n: 12, want: [ALERTS_WANT] }, result: out.results[0] }
  if (process.env.UPDATE_AL2_FIXTURE === '1') writeFileSync(FIXTURE, JSON.stringify(fx, null, 1) + '\n')
  assert.deepEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')), fx)
})

let real
after(() => real && real.cleanup())

test('the REAL bundle: a script\'s alert() calls reach the wire on the bars their branch runs, sealed', async () => {
  real = await buildRealBundle()
  const door = await loadBundle(real.outfile)
  const rt = await import(pathToFileURL(real.outfile).href)
  assert.equal(typeof rt.runtimeAlertsOf, 'function')
  assert.equal(rt.RUNTIME_ALERTS_KEY, RUNTIME_ALERTS_KEY)
  const src = ['//@version=5', 'indicator("t")', 'if bar_index == 3 or bar_index == 7', '    alert("hit", alert.freq_once_per_bar_close)',
    'plot(close, "p")', ''].join('\n')
  const doc = docOf(src, { p: 0 })
  const job = { ...parsedJob('A', { n: 12 }), want: ['p', ALERTS_WANT] }
  const r = runJob(rt, doc, job)
  assert.equal(r.status, 'ok', JSON.stringify(r))
  const rec = JSON.parse(r.alerts)
  assert.deepEqual(rec.events.map((e) => [e.bar, e.message]), [[3, 'hit'], [7, 'hit']], r.alerts)
  assert.equal(rec.fromBar, 0)
  const sealed = sealRunResults(door.codec, door.identity, [job], [r])
  assert.equal(sealed.ok, true, JSON.stringify(sealed))
  assert.equal(sealed.results[0].alerts_sha256, sha(r.alerts))
  // the same run asked for its plot alone carries no record, and its columns are the same
  const plain = runJob(rt, doc, { ...parsedJob('B', { n: 12 }), want: ['p'] })
  assert.equal(Object.hasOwn(plain, 'alerts'), false)
  assert.deepEqual(plain.columns, r.columns)
}, { timeout: 180000 })
