// W9-T14 rails: the service's `#strategy` handling (W9 design 3.4). A job under profile `backtest`
// may ask for the run's `strategy` record (design 3.2) with `want: ['#strategy']`; the job adapter
// (job.mjs) writes the run's own record as JSON text, the seal (protocol.mjs) checks it with the
// bundle's ONE shape check and adds `strategy_sha256`, and the result cache keeps it.
// TRACK 6, G-BROKER (coordinator ruling D5, 2026-11-22): the broker runs on the service for a job that asks
// for '#strategy' (profile `backtest` only) and for no other job. job.mjs is the ONE service file that turns the
// gate on, only for such a job, and turns it off again after the run. Admission (which strategies may reach the
// lane at all) is the web pod's, with no bypass here.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseRunRequest, sealRunResults, STRATEGY_PROFILE, STRATEGY_WANT, PROFILES } from '../protocol.mjs'
import { OUTPUT_ABSENT_GUARD, encodeResult, recordValueFault, runJob } from '../job.mjs'
import { INTEGRITY_GUARD } from '../protocol.mjs'
import { createResultLane, resultKey } from '../cache.mjs'
import { loadBundle } from '../server.mjs'
import * as T3 from '../../../app/src/components/chart/engine/runtime/columnDigest.js'
import {
  RUNTIME_STRATEGY_KEY, STRATEGY_WINDOW_HISTORY, strategyRecordOf, strategyRecordShapeErrors, runtimeStrategyOf,
} from '../../../app/src/components/chart/engine/runtime/strategyRecord.js'
import { CODEC, DOOR, IDENTITY, f64b64, validRequest } from './helpers.mjs'
import { orderLogFor } from '../../../app/src/components/chart/engine/runtime/__tests__/orderLogFixture.js'
import { buildRealBundle, docOf, parsedJob } from './poolFixtures.mjs'

const SCODEC = Object.freeze({ ...CODEC, strategyRecordShapeErrors })
const N = 5
const TIMES = [1700000000, 1700086400, 1700172800, 1700259200, 1700345600]

/** A v1 record built by the record's own builder (never a hand-typed shape). */
function record({ trades = [{ id: 'L', dir: 1, qty: 3, entry: { time: TIMES[1], price: 101.5, rule: 'B-MARKET' },
  exit: { time: TIMES[3], price: 103.25, rule: 'B-CLOSE' } }] } = {}) {
  // W9-T7-F1: a broker summary carries its order log (`broker.js`); the fixture states the one these trades imply
  return strategyRecordOf({ summary: { record: { trades, orders: orderLogFor(trades), rulesUsed: ['B-MARKET', 'B-CLOSE'] } },
    decl: { version: 5, fromListing: true, initialCapital: 100000, defaultQty: 1, pyramiding: 0, defaulted: { pyramiding: true } },
    barTimes: TIMES, historyWindowBars: 10, confirmed: true })
}
const sha = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
const wantJob = (want = [STRATEGY_WANT]) => ({ job: 'J0', bars: { n: N }, want })
const okResult = (over = {}) => ({ job: 'J0', status: 'ok', columns: {}, refusals: [], warmup: { withheldBars: 0 }, ...over })
const seal = (r, job = wantJob(), codec = SCODEC) => sealRunResults(codec, IDENTITY, [job], [r])
const refused = (r, re, job, codec) => {
  const out = seal(r, job, codec)
  assert.equal(out.ok, false, `expected a refusal for ${JSON.stringify(r).slice(0, 200)}`)
  if (re) assert.match(out.sentence, re)
}

/** A bundle stand-in whose run answers `cols` (the job.test.mjs recorder, cut to what encodeResult reads). */
const rtOf = (extra = {}) => ({
  RUNTIME_INCREMENTAL_KEY: '__inc', RUNTIME_OBJECTS_KEY: '__obj', encodeColumn: T3.encodeColumn, bytesToB64: T3.bytesToB64,
  runtimeWarmupOf: () => null, runtimeStrategyOf, ...extra,
})
const colsWith = (o, rec) => {
  Object.defineProperty(o, '__inc', { enumerable: false, value: { resumedFrom: null } })
  if (rec) Object.defineProperty(o, RUNTIME_STRATEGY_KEY, { enumerable: false, value: rec })
  return o
}

test('the want entry and its profile are the protocol\'s, and only `backtest` may ask for the record', () => {
  assert.equal(STRATEGY_WANT, '#strategy')
  assert.equal(STRATEGY_PROFILE, 'backtest')
  for (const profile of PROFILES) {
    const req = validRequest({ jobs: 1 })
    req.profile = profile
    req.jobs[0].want = ['value', STRATEGY_WANT]
    const out = parseRunRequest(Buffer.from(JSON.stringify(req)), DOOR)
    if (profile === STRATEGY_PROFILE) {
      assert.equal(out.ok, true, JSON.stringify(out))
      assert.deepEqual(out.request.jobs[0].want, ['value', STRATEGY_WANT])
    } else {
      assert.equal(out.ok, false, profile)
      assert.equal(out.status, 400)
      assert.match(out.sentence, /only profile "backtest" may ask for/)
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

test('the seal carries the record text unchanged, adds its sha256, and leaves the T3 digest as it was', () => {
  const text = JSON.stringify(record())
  const out = seal(okResult({ strategy: text }))
  assert.equal(out.ok, true, JSON.stringify(out))
  const r = out.results[0]
  assert.equal(r.strategy, text)
  assert.equal(r.strategy_sha256, sha(text))
  // the T3 digest has no field for the record: the same result refusing it digests its refusal only
  const plain = seal(okResult(), wantJob([]))
  assert.equal(plain.ok, true)
  assert.equal(r.digest, plain.results[0].digest)
  assert.deepEqual(Object.keys(r), ['job', 'status', 'columns', 'refusals', 'warmup', 'strategy', 'strategy_sha256', 'digest'])
})

test('the seal refuses every record it cannot vouch for, by what is wrong', () => {
  const text = JSON.stringify(record())
  refused(okResult({ strategy: text }), /did not ask for/, wantJob(['value']))
  refused(okResult(), /neither serves nor refuses/)
  refused(okResult({ strategy: text, refusals: [{ key: STRATEGY_WANT, guard: OUTPUT_ABSENT_GUARD, sentence: 'x', bar: null }] }),
    /both serves and refuses the strategy record/)
  refused(okResult({ strategy: JSON.parse(text) }), /must be the record's JSON text/)
  refused(okResult({ strategy: '{"schema":' }), /is not JSON/)
  refused(okResult({ strategy: '[1]' }), /must be a JSON object/)
  refused(okResult({ strategy: JSON.stringify({ ...record(), equity: [] }) }), /is not a strategy record \(equity is unserved and must be null/)
  // W9-T7-F1: the order log is checked by the same one shape check (a trade no order opened)
  refused(okResult({ strategy: JSON.stringify({ ...record(), orders: [] }) }), /is not a strategy record \(trades\[0\] has no opening order/)
  refused(okResult({ strategy: JSON.stringify({ ...record(), schema: 'uct.strategy-record/v0' }) }), /is not a strategy record \(schema/)
  refused(okResult({ strategy: `{"x":"\ud800"}` }), /lone surrogate/)
  refused(okResult({ strategy: text }), /exports no strategyRecordShapeErrors/, wantJob(), CODEC)
  refused(okResult({ columns: { [STRATEGY_WANT]: f64b64([1, 2, 3, 4, 5]) } }), /serves the strategy record as a column/)
  refused({ job: 'J0', status: 'withheld', refusals: [{ key: '*', guard: 'runtime:limit', sentence: 's', bar: null }], strategy: text },
    /unknown key "strategy"/)
  refused(okResult({ strategy: text, strategy_sha256: sha(text) }), /unknown key "strategy_sha256"/)
  // control: a job that asked and is told why not is a sealed answer
  const why = seal(okResult({ refusals: [{ key: STRATEGY_WANT, guard: OUTPUT_ABSENT_GUARD, sentence: 'none', bar: null }] }))
  assert.equal(why.ok, true, JSON.stringify(why))
  assert.equal(Object.hasOwn(why.results[0], 'strategy'), false)
})

test('the adapter writes the run\'s OWN record, never a column, and refuses by name when the run made none', () => {
  const rec = record()
  const both = encodeResult(rtOf(), { job: 'J0', bars: { n: 3 }, want: ['p', STRATEGY_WANT] }, colsWith({ p: [1, 2, 3] }, rec))
  assert.equal(both.status, 'ok')
  assert.deepEqual(Object.keys(both.columns), ['p'])
  assert.equal(both.strategy, JSON.stringify(rec))
  assert.deepEqual(JSON.parse(both.strategy), rec)
  assert.deepEqual(both.refusals, [])
  const only = encodeResult(rtOf(), { job: 'J0', bars: { n: 3 }, want: [STRATEGY_WANT] }, colsWith({ p: [1, 2, 3] }, rec))
  assert.deepEqual(only.columns, {})
  assert.equal(only.strategy, JSON.stringify(rec))
  const none = encodeResult(rtOf(), { job: 'J0', bars: { n: 3 }, want: [STRATEGY_WANT] }, colsWith({ p: [1, 2, 3] }))
  assert.equal(none.status, 'ok')
  assert.equal(Object.hasOwn(none, 'strategy'), false)
  assert.deepEqual(none.refusals.map((r) => [r.key, r.guard]), [[STRATEGY_WANT, OUTPUT_ABSENT_GUARD]])
  // a bundle that cannot read a record answers the same refusal (fails closed)
  const old = encodeResult(rtOf({ runtimeStrategyOf: undefined }), { job: 'J0', bars: { n: 3 }, want: [STRATEGY_WANT] }, colsWith({ p: [1, 2, 3] }, rec))
  assert.deepEqual(old.refusals.map((r) => r.key), [STRATEGY_WANT])
  // not asked: no record rides, whatever the run made
  const plain = encodeResult(rtOf(), { job: 'J0', bars: { n: 3 }, want: [] }, colsWith({ p: [1, 2, 3] }, rec))
  assert.equal(Object.hasOwn(plain, 'strategy'), false)
})

test('a record value JSON cannot carry exactly withholds the whole job, never a silent null', () => {
  for (const [bad, where] of [[NaN, 'strategy.trades[0].entryPrice is NaN'], [Infinity, 'is Infinity'], [undefined, 'is undefined']]) {
    const rec = record()
    rec.trades[0].entryPrice = bad
    const r = encodeResult(rtOf(), { job: 'J0', bars: { n: 3 }, want: [STRATEGY_WANT] }, colsWith({ p: [1, 2, 3] }, rec))
    assert.equal(r.status, 'withheld', String(bad))
    assert.equal(r.refusals[0].guard, INTEGRITY_GUARD)
    assert.ok(r.refusals[0].sentence.includes(where), r.refusals[0].sentence)
  }
  assert.equal(recordValueFault(record()), null)
  assert.match(recordValueFault({ a: [1, { b: () => 1 }] }), /strategy\.a\[1\]\.b is a function/)
  assert.match(recordValueFault({ d: new Date(0) }), /strategy\.d is a object/)
})

test('the result cache keeps the record: a hit is the same text, sealed again to the same hash', async () => {
  const text = JSON.stringify(record())
  const lane = createResultLane()
  const doc = docOf('x')
  const job = { ...parsedJob('A', { n: N }), want: [STRATEGY_WANT] }
  const request = { profile: 'backtest', engine: IDENTITY, definition: { doc_sha256: 'cd'.repeat(32), doc }, jobs: [job] }
  let runs = 0
  const runner = async () => { runs += 1; return [okResult({ job: job.job, strategy: text })] }
  const sealIt = (results) => sealRunResults(SCODEC, IDENTITY, request.jobs, results)
  const first = await lane.answer(request, runner, sealIt)
  const second = await lane.answer(request, runner, sealIt)
  assert.equal(runs, 1)
  assert.equal(first.results[0].cache, 'miss')
  assert.equal(second.results[0].cache, 'hit')
  assert.equal(second.results[0].strategy, text)
  assert.equal(second.results[0].strategy_sha256, sha(text))
  // the record is part of WHAT was asked: a job without '#strategy' is another key
  assert.notEqual(resultKey(request, job), resultKey(request, { ...job, want: [] }))
})

test('G-BROKER: job.mjs is the ONE service file that arms the broker; nothing reads the browser build flag', () => {
  const dir = new URL('../', import.meta.url)
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    const text = readFileSync(new URL(f, dir), 'utf8')
    assert.equal(/strategyBrokerEnabled|VITE_PINE_STRATEGY_BROKER_ENABLED/.test(text), false, f)
    assert.equal(/registerStrategyBrokerGate/.test(text), f === 'job.mjs', f)
  }
  const entry = readFileSync(new URL('../../../app/src/components/chart/engine/runtime/serverEntry.js', import.meta.url), 'utf8')
  assert.equal(/strategyBrokerGate\.js/.test(entry), false, 'the entry exports the registry, never the build-flag reader')
  assert.match(entry, /registerStrategyBrokerGate, strategyBrokerGateOn \} from '\.\.\/strategyBrokerGateRegistry\.js'/)
})

test('G-BROKER: runJob arms the gate for a #strategy job only, and puts it back off even when the run throws', () => {
  const seen = []
  let reader = () => false
  const fake = (wantOn, compute) => ({
    registerStrategyBrokerGate: (fn) => { reader = fn },
    computeRuntimeColumns: () => { seen.push(reader() === true); return compute() },
    resetRuntimeSessions: () => {}, resetRuntimeLedgers: () => {}, runtimeWarmupOf: () => null,
    RUNTIME_PANE_TIME_BUDGET_MS: 1000, RUNTIME_OBJECTS_KEY: '#objects', RUNTIME_STRATEGY_KEY,
    runtimeStrategyOf: () => null,
  })
  const doc = docOf('//@version=5\nindicator("t")\nplot(close)\n', { p: 0 })
  const plain = parsedJob('A', { n: 5 })
  const asks = { ...parsedJob('B', { n: 5 }), want: [STRATEGY_WANT] }
  runJob(fake(false, () => ({ p: [1, 2, 3, 4, 5] })), doc, plain)
  assert.deepEqual(seen, [false], 'a job that does not ask for #strategy never sees the gate on')
  runJob(fake(true, () => ({ p: [1, 2, 3, 4, 5] })), doc, asks)
  assert.deepEqual(seen, [false, true], 'a #strategy job runs with the gate on')
  assert.equal(reader(), false, 'and it is off again after the run')
  runJob(fake(true, () => { throw new Error('boom') }), doc, asks)
  assert.equal(reader(), false, 'off again even when the run throws')
  // a bundle without the registry runs a #strategy job dark (no throw)
  const dark = fake(false, () => ({ p: [1, 2, 3, 4, 5] }))
  delete dark.registerStrategyBrokerGate
  assert.ok(runJob(dark, doc, asks))
})

let real
after(() => real && real.cleanup())

test('the REAL bundle: a #strategy job runs the broker; the same document asked for a plot refuses pine:strategy-call; the gate is off after each', async () => {
  real = await buildRealBundle()
  const door = await loadBundle(real.outfile)
  assert.equal(door.codec.strategyRecordShapeErrors, door.mod.strategyRecordShapeErrors)
  assert.deepEqual(door.codec.strategyRecordShapeErrors(record()), [])
  const rt = await import(pathToFileURL(real.outfile).href)
  assert.equal(typeof rt.runtimeStrategyOf, 'function')
  assert.equal(typeof rt.registerStrategyBrokerGate, 'function')
  assert.equal(rt.strategyBrokerGateOn(), false, 'dark until a job asks')
  const src = ['//@version=5', 'strategy("t")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
    'plot(strategy.position_size)', ''].join('\n')
  const doc = { ...docOf(src, { p: 0 }), meta: { runtimeHistory: STRATEGY_WINDOW_HISTORY } }
  const job = { ...parsedJob('A', { n: 40 }), want: [STRATEGY_WANT] }
  job.ctx.historyWindowBars = 40
  const r = runJob(rt, doc, job)
  // the broker was consulted: never the dark refusal. Whether it serves a record or refuses one BY NAME (a window
  // that does not reach the listing is [B-START], vm.js) is the broker's, not this adapter's.
  assert.notEqual(r.refusals.length && r.refusals[0].guard, 'pine:strategy-call', JSON.stringify(r))
  assert.ok(Object.hasOwn(r, 'strategy') || r.refusals.some((x) => x.key === STRATEGY_WANT || x.key === '*'), JSON.stringify(r))
  assert.equal(rt.strategyBrokerGateOn(), false, 'off again after the #strategy job')
  const sealed = sealRunResults(door.codec, door.identity, [job], [r])
  assert.equal(sealed.ok, true, JSON.stringify(sealed))
  // the SAME document asked for a plot (no '#strategy'): the broker stays dark, as before G-BROKER
  const plotJob = { ...parsedJob('B', { n: 40 }), want: [] }
  plotJob.ctx.historyWindowBars = 40
  const dark = runJob(rt, doc, plotJob)
  assert.equal(dark.status, 'withheld', JSON.stringify(dark))
  assert.equal(dark.refusals[0].guard, 'pine:strategy-call')
  assert.equal(rt.strategyBrokerGateOn(), false)
}, { timeout: 120000 })
