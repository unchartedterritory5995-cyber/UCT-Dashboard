// W5-T7 rail: the job adapter (job.mjs). In-process, against a recording stand-in for the bundle:
// what it builds for the run, how it encodes columns, how each stop is named, and the H6 reset.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import {
  DRAWINGS_GUARD, OUTPUT_ABSENT_GUARD, SCRIPT_ERROR_GUARD, budgetOf, encodeColumn as encodeColumnOf, runArgs, runJob,
} from '../job.mjs'
import { INTEGRITY_GUARD } from '../protocol.mjs'
import { cacheable } from '../cache.mjs'
import * as T3 from '../../../app/src/components/chart/engine/runtime/columnDigest.js'
import { buildRealBundle, decodeColumn, docOf, parsedJob } from './poolFixtures.mjs'

// W5-INT: the adapter writes bytes with the bundle's T3 codec; these rails pass T3's own module.
const encodeColumn = (col, n) => encodeColumnOf(T3, col, n)

/** A bundle stand-in that records every call and answers with `answer(def, rows, ctx, opts)`. */
function recorder(answer) {
  const rt = {
    RUNTIME_PANE_TIME_BUDGET_MS: 1234, RUNTIME_INCREMENTAL_KEY: '__inc', RUNTIME_OBJECTS_KEY: '__obj',
    RUNTIME_FAILED_GUARD: 'runtime:failed', calls: [], resets: [],
    encodeColumn: T3.encodeColumn, bytesToB64: T3.bytesToB64,
    computeRuntimeColumns(def, rows, ctx, opts) { rt.calls.push({ def, rows, ctx, opts }); return answer(def, rows, ctx, opts) },
    resetRuntimeSessions() { rt.resets.push('sessions') },
    resetRuntimeLedgers() { rt.resets.push('ledgers') },
    runtimeWarmupOf(c) { return (c && c.__warm) || null },
  }
  return rt
}
const cols = (o, inc = { resumedFrom: null }) => Object.defineProperty(o, '__inc', { enumerable: false, value: inc })

test('runArgs builds the def, rows and ctx the browser worker builds, from the validated job', () => {
  const doc = { ...docOf('x'), meta: { runtimeHistory: 'listing', runtimeIr: 1 } }
  const job = parsedJob('A', { n: 2 })
  job.ctx.runtimeInputs = { length: 14 }
  const { def, rows, ctx } = runArgs(doc, job)
  assert.deepEqual(def, { id: doc.id, compute: doc.compute, meta: doc.meta })
  assert.deepEqual(rows, [0, 1].map((i) => ({ t: job.bars.t[i], o: job.bars.o[i], h: job.bars.h[i], l: job.bars.l[i], c: job.bars.c[i], v: job.bars.v[i] })))
  assert.deepEqual(ctx, { tf: 'D', newestBarIsForming: false, historyFromListing: true, runtimeInputs: { length: 14 },
    symbol: { ticker: 'AAPL', exchange: 'NASDAQ' } })
  assert.notEqual(ctx.runtimeInputs, job.ctx.runtimeInputs, 'the inputs are copied, never shared with the job')
  job.ctx.historyFromListing = false
  job.ctx.newestBarIsForming = true
  const off = runArgs(doc, job).ctx
  assert.equal(off.historyFromListing, false)
  assert.equal(off.newestBarIsForming, true)
})

test('encodeColumn: canonical NaN for na, -0 kept, exact length, numbers only', () => {
  const odd = new Float64Array(1)
  new DataView(odd.buffer).setUint32(4, 0x7ff80001, true) // a NaN with a non-canonical payload
  const b = Buffer.from(encodeColumn([1.5, null, undefined, NaN, odd[0], -0, 2], 7), 'base64')
  assert.equal(b.readDoubleLE(0), 1.5)
  for (const i of [1, 2, 3, 4]) assert.equal(b.subarray(i * 8, i * 8 + 8).toString('hex'), '000000000000f87f', `row ${i}`)
  assert.ok(Object.is(b.readDoubleLE(40), -0), '-0 stays -0')
  assert.equal(encodeColumn([1, 2], 3), null)
  assert.equal(encodeColumn([1, 2, 3, 4], 3), null)
  assert.equal(encodeColumn([1, '2', 3], 3), null)
  assert.equal(encodeColumn(null, 3), null)
})

test('runJob calls the run ONCE with the worker budget and incremental:false, and resets after it', () => {
  const rt = recorder((d, rows) => cols({ value: rows.map((r) => r.c) }))
  const job = parsedJob('A', { n: 3 })
  const r = runJob(rt, docOf('x'), job)
  assert.equal(rt.calls.length, 1)
  assert.deepEqual(rt.calls[0].opts, { budgetMs: 1234, incremental: false })
  assert.deepEqual(rt.resets, ['sessions', 'ledgers'])
  assert.equal(r.status, 'ok')
  assert.deepEqual(decodeColumn(r.columns.value), [...job.bars.c])
  assert.deepEqual(r.refusals, [])
  assert.ok(Number.isInteger(r.ms) && r.ms >= 0)
})

test('the reset runs after a stop too, and every thrown stop is named run-wide', () => {
  const cases = [
    [Object.assign(new Error('limit hit'), { guard: 'runtime:limit', bar: 7 }), 'runtime:limit', 7],
    [Object.assign(new Error('boom'), { name: 'runtime.error', bar: 3 }), SCRIPT_ERROR_GUARD, 3],
    [new TypeError('unexpected'), 'runtime:failed', null],
    ['a bare string', 'runtime:failed', null],
  ]
  for (const [err, guard, bar] of cases) {
    const rt = recorder(() => { throw err })
    const r = runJob(rt, docOf('x'), parsedJob('A'))
    assert.deepEqual(rt.resets, ['sessions', 'ledgers'], guard)
    assert.equal(r.status, 'withheld')
    assert.equal(r.columns, undefined, 'a stopped job carries no columns')
    assert.equal(r.refusals.length, 1)
    assert.deepEqual({ ...r.refusals[0], sentence: undefined }, { key: '*', guard, sentence: undefined, bar })
    assert.ok(r.refusals[0].sentence.length > 0)
  }
})

test('want: a named output only; a missing one is refused by name and the job stays ok', () => {
  const rt = recorder((d, rows) => cols({ value: rows.map(() => 1), other: rows.map(() => 2) }))
  const r = runJob(rt, docOf('x'), parsedJob('A', { want: ['value', 'gone'] }))
  assert.equal(r.status, 'ok')
  assert.deepEqual(Object.keys(r.columns), ['value'])
  assert.deepEqual(r.refusals.map((x) => [x.key, x.guard]), [['gone', OUTPUT_ABSENT_GUARD]])
  const all = runJob(rt, docOf('x'), parsedJob('B'))
  assert.deepEqual(Object.keys(all.columns), ['value', 'other'], 'want = [] is every column the run produced')
})

test('a non-enumerable record is not an output, and drawings are refused by name', () => {
  const rt = recorder((d, rows) => Object.defineProperty(cols({ value: rows.map(() => 1) }), '__obj',
    { enumerable: false, value: { live: [1] } }))
  const r = runJob(rt, docOf('x'), parsedJob('A', { want: ['value', '__inc'] }))
  assert.equal(r.status, 'ok')
  assert.deepEqual(Object.keys(r.columns), ['value'])
  assert.deepEqual(r.refusals.map((x) => [x.key, x.guard]), [['__inc', OUTPUT_ABSENT_GUARD], ['__obj', DRAWINGS_GUARD]])
})

test('never partial: one column of the wrong length withholds the whole job', () => {
  const rt = recorder((d, rows) => cols({ value: rows.map(() => 1), short: [1] }))
  const r = runJob(rt, docOf('x'), parsedJob('A'))
  assert.equal(r.status, 'withheld')
  assert.equal(r.columns, undefined)
  assert.equal(r.refusals[0].guard, INTEGRITY_GUARD)
})

test('H6: a run that says it resumed from an earlier run is refused, never served', () => {
  for (const resumedFrom of [0, 41]) {
    const rt = recorder((d, rows) => cols({ value: rows.map(() => 1) }, { resumedFrom }))
    const r = runJob(rt, docOf('x'), parsedJob('A'))
    assert.equal(r.status, 'withheld', `resumedFrom ${resumedFrom}`)
    assert.equal(r.refusals[0].guard, INTEGRITY_GUARD)
  }
  const cold = recorder((d, rows) => cols({ value: rows.map(() => 1) }, { resumedFrom: null }))
  assert.equal(runJob(cold, docOf('x'), parsedJob('A')).status, 'ok')
})

// ─── W5-INT ──────────────────────────────────────────────────────────────────────

/** The encoding job.mjs carried before W5-INT (its own copy of design 2.3), kept HERE only as the
 *  reference the T3-codec path must reproduce byte for byte. */
function legacyEncode(col, n) {
  if (!col || typeof col.length !== 'number' || col.length !== n) return null
  const b = Buffer.alloc(n * 8)
  for (let i = 0; i < n; i += 1) {
    const x = col[i]
    if (x === null || x === undefined || (typeof x === 'number' && Number.isNaN(x))) {
      b.writeUInt32LE(0, i * 8); b.writeUInt32LE(0x7ff80000, i * 8 + 4)
    } else if (typeof x === 'number') b.writeDoubleLE(x, i * 8)
    else return null
  }
  return b.toString('base64')
}

test('one authority: the adapter\'s column bytes are T3\'s, byte-identical to the encoding it replaced', () => {
  const nanPayloads = [0x7ff80001, 0xfff80000, 0x7ff00001, 0xffffffff].map((hi) => {
    const f = new Float64Array(1); new DataView(f.buffer).setUint32(4, hi, true); new DataView(f.buffer).setUint32(0, 7, true); return f[0]
  })
  const specials = [0, -0, 1.5, -2.25, Infinity, -Infinity, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE,
    2 ** 53 + 2, 1e-310, null, undefined, NaN, ...nanPayloads]
  let seed = 7
  const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32 }
  const cols = [[], specials, Float64Array.from([1, NaN, -0]),
    // past one 0x8000-byte chunk of bytesToB64
    Array.from({ length: 9000 }, (_, i) => (i % 97 === 0 ? null : specials[i % specials.length] ?? (rand() - 0.5) * 1e6))]
  for (const col of cols) {
    const got = encodeColumnOf(T3, col, col.length)
    assert.equal(typeof got, 'string')
    assert.equal(got, legacyEncode(col, col.length), `length ${col.length}`)
  }
  // the refusals agree too (null = the whole job withheld)
  for (const [col, n] of [[[1, 2], 3], [[1, 2, 3, 4], 3], [[1, '2', 3], 3], [null, 3], [[1, {}, 3], 3]]) {
    assert.equal(encodeColumnOf(T3, col, n), null, JSON.stringify(col))
    assert.equal(legacyEncode(col, n), null)
  }
  // the adapter holds no encoder of its own: a codec that writes other bytes moves its output
  const other = { encodeColumn: () => new Uint8Array(16).fill(1), bytesToB64: T3.bytesToB64 }
  assert.notEqual(encodeColumnOf(other, [1, 2], 2), legacyEncode([1, 2], 2))
})

test('the wall budget is explicit: a bundle without a positive finite one is refused, by name', () => {
  assert.equal(budgetOf({ RUNTIME_PANE_TIME_BUDGET_MS: 1000 }), 1000)
  for (const v of [undefined, null, 0, -1, NaN, Infinity, '1000']) {
    assert.throws(() => budgetOf({ RUNTIME_PANE_TIME_BUDGET_MS: v }), /RUNTIME_PANE_TIME_BUDGET_MS/, String(v))
  }
})

let real
after(() => real && real.cleanup())

test('a wall-clock stop on the REAL bundle is runtime:time-budget, never runtime:limit, and is never cacheable', async () => {
  real = await buildRealBundle()
  const rt = await import(pathToFileURL(real.outfile).href)
  assert.equal(budgetOf(rt), 1000)
  // the run's own clock, advanced 600 ms a read: past the 1,000 ms budget on the second bar
  let t = 0
  const slow = { ...rt, computeRuntimeColumns: (d, r, c, o) => rt.computeRuntimeColumns(d, r, c, { ...o, now: () => (t += 600) }) }
  const doc = docOf('//@version=5\nindicator("w")\nplot(ta.sma(close, 3))')
  const r = runJob(slow, doc, parsedJob('A', { n: 50 }))
  assert.equal(r.status, 'withheld', JSON.stringify(r))
  assert.equal(r.refusals[0].guard, rt.RUNTIME_TIME_BUDGET_GUARD)
  assert.equal(cacheable(r), false, 'a wall-clock stop is never stored')
  // control: the same job on the real clock computes, and that answer IS cacheable
  const ok = runJob(rt, doc, parsedJob('A', { n: 50 }))
  assert.equal(ok.status, 'ok', JSON.stringify(ok.refusals))
  assert.equal(cacheable(ok), true)
}, { timeout: 120000 })

test('LIMITS r1 (B2-a): the VM OWN WALL_TIME stop, with the budget set, is runtime:time-budget, names 5,000 ms, and is never cacheable', async () => {
  real = real || await buildRealBundle()
  const rt = await import(pathToFileURL(real.outfile).href)
  // 6,000 ms a read: the VM's bar-end account (before the pane's hook) is past 5,000 ms on bar 1
  let t = 0
  const stall = { ...rt, computeRuntimeColumns: (d, r, c, o) => rt.computeRuntimeColumns(d, r, c, { ...o, now: () => (t += 6000) }) }
  const r = runJob(stall, docOf('//@version=5\nindicator("w")\nplot(ta.sma(close, 3))'), parsedJob('A', { n: 50 }))
  assert.equal(r.status, 'withheld', JSON.stringify(r))
  assert.equal(r.refusals[0].guard, rt.RUNTIME_TIME_BUDGET_GUARD, JSON.stringify(r.refusals))
  assert.deepEqual(Object.keys(r.refusals[0]).sort(), MASTER_CLIENT_REFUSAL_KEYS, 'an old client accepts it')
  assert.match(r.refusals[0].sentence, /took more than 5000 ms/)
  assert.doesNotMatch(r.refusals[0].sentence, /1000 ms|WALL_TIME/)
  assert.equal(cacheable(r), false, 'a VM wall-clock stop is never stored')
}, { timeout: 120000 })

/** The refusal keys the PRE-r1 Python client admits (`pine_runtime_client.py::_REFUSAL_KEYS` on
 *  master, 46f28be66c): any other key makes that client refuse the whole result as INTEGRITY. */
const MASTER_CLIENT_REFUSAL_KEYS = ['bar', 'guard', 'key', 'sentence']

test('LIMITS r2 phase 1: a limit stop on the REAL bundle reaches the wire with ONLY the keys an old client admits, still in plain words', async () => {
  real = real || await buildRealBundle()
  const rt = await import(pathToFileURL(real.outfile).href)
  const r = runJob(rt, docOf('//@version=5' + String.fromCharCode(10) + 'indicator("w")' + String.fromCharCode(10)
    + 'x = 0' + String.fromCharCode(10) + 'while true' + String.fromCharCode(10) + '    x += 1' + String.fromCharCode(10) + 'plot(x)'), parsedJob('A', { n: 20 }))
  assert.equal(r.status, 'withheld', JSON.stringify(r))
  assert.equal(r.refusals[0].guard, 'runtime:limit')
  assert.deepEqual(Object.keys(r.refusals[0]).sort(), MASTER_CLIENT_REFUSAL_KEYS, JSON.stringify(r.refusals[0]))
  assert.match(r.refusals[0].sentence, /the number of passes one `while` loop may make/)
}, { timeout: 120000 })

test('W9-T11: runArgs forwards the job ctx window (as the browser does), and only when the job states one', () => {
  const doc = docOf('x')
  const job = parsedJob('A', { n: 2 })
  assert.equal('historyWindowBars' in runArgs(doc, job).ctx, false)
  job.ctx.historyWindowBars = 4321
  assert.equal(runArgs(doc, job).ctx.historyWindowBars, 4321)
  job.ctx.historyWindowBars = 77
  assert.equal(runArgs(doc, job).ctx.historyWindowBars, 77)
})
