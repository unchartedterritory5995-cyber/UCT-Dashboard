// W5-T7 rail: the job adapter (job.mjs). In-process, against a recording stand-in for the bundle:
// what it builds for the run, how it encodes columns, how each stop is named, and the H6 reset.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DRAWINGS_GUARD, OUTPUT_ABSENT_GUARD, SCRIPT_ERROR_GUARD, encodeColumn, runArgs, runJob,
} from '../job.mjs'
import { INTEGRITY_GUARD } from '../protocol.mjs'
import { decodeColumn, docOf, parsedJob } from './poolFixtures.mjs'

/** A bundle stand-in that records every call and answers with `answer(def, rows, ctx, opts)`. */
function recorder(answer) {
  const rt = {
    RUNTIME_PANE_TIME_BUDGET_MS: 1234, RUNTIME_INCREMENTAL_KEY: '__inc', RUNTIME_OBJECTS_KEY: '__obj',
    RUNTIME_FAILED_GUARD: 'runtime:failed', calls: [], resets: [],
    computeRuntimeColumns(def, rows, ctx, opts) { rt.calls.push({ def, rows, ctx, opts }); return answer(def, rows, ctx, opts) },
    resetRuntimeSessions() { rt.resets.push('sessions') },
    resetRuntimeLedgers() { rt.resets.push('ledgers') },
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
