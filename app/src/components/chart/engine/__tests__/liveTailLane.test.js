// app/src/components/chart/engine/__tests__/liveTailLane.test.js
//
// ─── RS split, unit U2b: the live tail THROUGH THE LANE ─────────────────────
//
// `liveTail.test.js` proves the math and the store against a hand-built
// definition. This file proves the wiring on the REAL one: `getDefinition('rsLine')`
// through `computeFor` (the binder's one call), a cached envelope primed as the
// server sends it, a benchmark tail primed as `/api/bars` sends it. The claims:
//
//   1. a live last bar updates the RS line's and the average's LAST point and
//      nothing else — every other cell, every dot column, the scalars, the
//      cached envelope itself: byte-identical;
//   2. a definition with no `liveTail` goes through the same path untouched;
//   3. a derived glyph on the last bar rides the LIVE line;
//   4. the binder's memo moves when the tail lands (`computeSignature`), and
//      the binder recomputes on exactly that — no benchmark tail landed ⇒ the
//      memo holds as before.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { getDefinition, computeFor, computeSignature } from '../nativeRegistry'
import {
  primeServerColumns, clearServerColumns, cachedColumns, serverColumnsFor, subscribe, pickServerInputs,
} from '../serverCompute'
import {
  primeBenchmarkTail, _resetBenchmarkTailsForTests, __setBenchmarkTailFetcherForTests,
  _inflightBenchmarkTails, benchmarkTailUrl,
} from '../liveTail'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'

const DEF = getDefinition('rsLine')
const SYM = 'NVDA'
const TF = 'D'
const INPUTS = { benchmark: 'SPY', maLength: 3, maType: 'EMA' }

// Four sessions; the envelope was built when today's close was 103 and SPY 500.
const BARS = [
  { t: '2026-11-04', o: 99, h: 101, l: 98, c: 100, v: 1 },
  { t: '2026-11-05', o: 100, h: 103, l: 99, c: 102, v: 1 },
  { t: '2026-11-06', o: 102, h: 103, l: 100, c: 101, v: 1 },
  { t: '2026-11-09', o: 101, h: 105, l: 100, c: 104, v: 1 },
]
const RS = [100 / 490, 102 / 495, 101 / 498, 103 / 500]
const k = 2 / 4
const MA2 = (RS[0] + RS[1] + RS[2]) / 3
const MA = [null, null, MA2, MA2 + k * (RS[3] - MA2)]
const WIRE = {
  times: [20261104, 20261105, 20261106, 20261109],
  rev: DEF.compute.rev,
  columns: {
    rsLine: RS, rsMa: MA, rsAbove: [1, 1, 0, 1],
    dotNH: [null, RS[1], null, RS[3]],
    crossUp: [0, 0, 0, 1], crossDown: [0, 0, 1, 0],
  },
  payload: { benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500', fallback: false }, rating: { ibd: 88 } },
}
const BENCH_LIVE = 505
const LIVE_RS = 104 / BENCH_LIVE

const sent = () => pickServerInputs(DEF, registry.resolveInputs(DEF, INPUTS))
const ctx = { sym: SYM, tf: TF, newestBarIsForming: true }

beforeEach(() => {
  clearServerColumns()
  _resetBenchmarkTailsForTests()
  __setBenchmarkTailFetcherForTests(null)
  primeServerColumns(DEF.id, SYM, TF, sent(), WIRE)
})
afterEach(() => { __setBenchmarkTailFetcherForTests(null) })

const asList = (col) => Array.from(col).map((v) => (Number.isNaN(v) ? 'nan' : v))

describe('the RS line declares its tail; the three dot / event columns do not', () => {
  it('rsLine is a ratio tail on the resolved benchmark; rsMa continues it from the member\'s own average inputs', () => {
    const line = DEF.plots.find((p) => p.key === 'rsLine')
    const ma = DEF.plots.find((p) => p.key === 'rsMa')
    expect(line.liveTail).toEqual({ kind: 'ratio', benchmark: 'scalar:benchmark.resolved' })
    expect(ma.liveTail).toEqual({ kind: 'ma', of: 'rsLine', length: 'input:maLength', type: 'input:maType' })
    expect(DEF.plots.filter((p) => p.liveTail).map((p) => p.key)).toEqual(['rsLine', 'rsMa'])
    // the rating is end-of-day everywhere: no rating plot carries a tail
    for (const p of DEF.plots) if (/rating/i.test(p.key)) expect(p.liveTail).toBeUndefined()
  })
})

describe('1. a live last bar moves the last point of the line and the average, and nothing else', () => {
  it('before any benchmark tail lands, the columns are the server\'s (the stale forming bar)', () => {
    const cols = computeFor(DEF, BARS, INPUTS, ctx)
    expect(asList(cols.rsLine)).toEqual(RS)
    expect(cols.rsMa[3]).toBeCloseTo(MA[3], 12)
  })

  it('after the tail lands: last cell = close / benchmark close, average stepped exactly; all else identical', () => {
    const before = computeFor(DEF, BARS, INPUTS, ctx)
    primeBenchmarkTail('SPY', TF, [{ t: '2026-11-06', c: 498 }, { t: '2026-11-09', c: BENCH_LIVE }])
    const after = computeFor(DEF, BARS, INPUTS, ctx)

    expect(after.rsLine[3]).toBe(LIVE_RS)
    expect(after.rsMa[3]).toBeCloseTo(MA2 + k * (LIVE_RS - MA2), 12)
    // history: identical
    expect(asList(after.rsLine.slice(0, 3))).toEqual(asList(before.rsLine.slice(0, 3)))
    expect(asList(after.rsMa.slice(0, 3))).toEqual(asList(before.rsMa.slice(0, 3)))
    // every other column: identical cell for cell, INCLUDING the dots and the colour column
    for (const key of Object.keys(before)) {
      if (key === 'rsLine' || key === 'rsMa') continue
      expect(asList(after[key]), key).toEqual(asList(before[key]))
    }
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    // the cached envelope was never written to
    const parsed = cachedColumns(DEF.id, SYM, TF, sent())
    expect(Array.from(parsed.columns.rsLine)).toEqual(RS)
    expect(parsed.payload).toEqual(WIRE.payload)
  })

  it('the dots and the rating stay the session\'s values: a dot on the last bar keeps the SERVER\'s level', () => {
    primeBenchmarkTail('SPY', TF, [{ t: '2026-11-09', c: BENCH_LIVE }])
    const cols = computeFor(DEF, BARS, INPUTS, ctx)
    expect(cols.dotNH[3]).toBe(RS[3])            // the server's dot, not the live ratio
    expect(cols.rsLine[3]).toBe(LIVE_RS)
  })

  it('a sealed newest bar (`newestBarIsForming: false`) is the server\'s, tail or no tail', () => {
    primeBenchmarkTail('SPY', TF, [{ t: '2026-11-09', c: BENCH_LIVE }])
    const cols = computeFor(DEF, BARS, INPUTS, { ...ctx, newestBarIsForming: false })
    expect(asList(cols.rsLine)).toEqual(RS)
  })

  it('a benchmark tail with no bar at the chart\'s last time is not joined (by TIME, never by index)', () => {
    primeBenchmarkTail('SPY', TF, [{ t: '2026-11-05', c: 1 }, { t: '2026-11-06', c: 2 }, { t: '2026-11-07', c: 3 }])
    const cols = computeFor(DEF, BARS, INPUTS, ctx)
    expect(asList(cols.rsLine)).toEqual(RS)
  })

  it('the compute ASKS for the benchmark tail through the chart\'s own bars route, once per (benchmark, timeframe)', async () => {
    const calls = []
    __setBenchmarkTailFetcherForTests((url) => { calls.push(url); return Promise.resolve({ bars: [{ t: '2026-11-09', c: BENCH_LIVE }] }) })
    computeFor(DEF, BARS, INPUTS, ctx)
    computeFor(DEF, BARS, INPUTS, ctx)
    computeFor(DEF, BARS, { ...INPUTS, lineColor: '#fff' }, ctx)   // another instance on the same benchmark
    expect(calls).toEqual([benchmarkTailUrl('SPY', TF)])
    const landed = []
    const unsub = subscribe((key) => landed.push(key))
    await Promise.all(_inflightBenchmarkTails())
    unsub()
    expect(landed, 'the lane is told, exactly as for a landed envelope').toEqual(['liveTail:SPY:D'])
    expect(computeFor(DEF, BARS, INPUTS, ctx).rsLine[3]).toBe(LIVE_RS)
  })
})

describe('2. a definition without `liveTail` goes through the same path untouched', () => {
  it('a server definition with no tail: identical columns before and after a tail lands', () => {
    const plain = {
      ...DEF, id: 'plainServer', plots: DEF.plots.map(({ liveTail, ...p }) => p),
    }
    primeServerColumns(plain.id, SYM, TF, pickServerInputs(plain, registry.resolveInputs(plain, INPUTS)), WIRE)
    const before = serverColumnsFor(plain, BARS, registry.resolveInputs(plain, INPUTS), ctx)
    primeBenchmarkTail('SPY', TF, [{ t: '2026-11-09', c: BENCH_LIVE }])
    const after = serverColumnsFor(plain, BARS, registry.resolveInputs(plain, INPUTS), ctx)
    for (const key of Object.keys(before)) expect(asList(after[key]), key).toEqual(asList(before[key]))
    expect(asList(after.rsLine)).toEqual(RS)
    expect(computeSignature(plain, INPUTS, ctx)).toBe('')
  })
})

describe('3. a derived glyph on the last bar rides the LIVE line', () => {
  it('`crossUpDot` (derived from rsLine where crossUp fired) sits at the live ratio on the forming bar', () => {
    const derived = DEF.plots.find((p) => p.derive && p.derive.from === 'rsLine' && p.derive.where === 'crossUp')
    expect(derived, 'the RS definition derives a cross glyph from the line').toBeTruthy()
    const inputs = { ...INPUTS, showCrossMarkers: true }
    primeBenchmarkTail('SPY', TF, [{ t: '2026-11-09', c: BENCH_LIVE }])
    const cols = computeFor(DEF, BARS, inputs, ctx)
    expect(cols[derived.key][3]).toBe(LIVE_RS)
    expect(Number.isNaN(cols[derived.key][2])).toBe(true)
  })
})

describe('4. the binder recomputes when the tail lands — and only then', () => {
  const placement = (instance) => ({ paneIndex: 0, scaleId: instance.defId, scaleOptions: { autoScale: true } })
  const inst = { instanceId: 'rs:1', defId: DEF.id, inputs: INPUTS, hidden: false }
  const countingRegistry = () => {
    const computes = []
    return {
      computes,
      getDefinition: registry.getDefinition,
      listDefinitions: registry.listDefinitions,
      hasAnyFinite: registry.hasAnyFinite,
      computeSignature: registry.computeSignature,
      computeFor: (def, b, inputs, c) => { computes.push(def.id); return registry.computeFor(def, b, inputs, c) },
    }
  }
  const ctxFor = (reg) => ({
    enabled: true, instances: [inst], registry: reg, bars: BARS, sym: SYM, tf: TF,
    newestBarIsForming: true, adjustTime: (t) => t, plan: { fresh: true },
    applyData: (series, data) => { if (series && data) series.setData(data) },
    resolvePlacement: placement,
  })

  it('`computeSignature` names the benchmark tail\'s version once the payload is cached', () => {
    expect(computeSignature(DEF, INPUTS, ctx)).toBe('SPY:D@0')
    primeBenchmarkTail('SPY', TF, [{ t: '2026-11-09', c: BENCH_LIVE }])
    expect(computeSignature(DEF, INPUTS, ctx)).toBe('SPY:D@1')
    clearServerColumns()
    expect(computeSignature(DEF, INPUTS, ctx), 'no payload, nothing to name').toBe('')
    expect(computeSignature(registry.getDefinition('rsi'), {}, ctx), 'a native: byte-unchanged key').toBe('')
  })

  it('same bars, same inputs: computed once; the landed tail is a memo miss and the last point moves', () => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const reg = countingRegistry()
    const c = ctxFor(reg)
    binder.sync(c)
    binder.sync(c)
    binder.sync(c)
    expect(reg.computes).toEqual([DEF.id])
    // What the renderer was HANDED for the line: the newest `setData` on its series.
    const lineSeries = () => binder.bindings().find((b) => b.plotKey === 'rsLine').series
    const handed = () => {
      const id = lineSeries().__id
      const sets = fake.callsOf('setData').filter((x) => x.id === id)
      return sets[sets.length - 1].args[0]
    }
    const pointsBefore = handed()
    const lastBefore = pointsBefore[pointsBefore.length - 1]
    expect(lastBefore.value).toBe(RS[3])

    primeBenchmarkTail('SPY', TF, [{ t: '2026-11-09', c: BENCH_LIVE }])
    binder.sync(c)
    expect(reg.computes, 'exactly one more compute for the landed tail').toEqual([DEF.id, DEF.id])
    const pointsAfter = handed()
    const lastAfter = pointsAfter[pointsAfter.length - 1]
    expect(lastAfter.value).toBe(LIVE_RS)
    expect(lastAfter.time).toBe(lastBefore.time)
    expect(pointsAfter.length).toBe(pointsBefore.length)
    for (let i = 0; i < pointsAfter.length - 1; i += 1) expect(pointsAfter[i]).toEqual(pointsBefore[i])
    binder.sync(c)
    expect(reg.computes, 'and the memo holds again').toEqual([DEF.id, DEF.id])
    binder.teardown()
  })
})
