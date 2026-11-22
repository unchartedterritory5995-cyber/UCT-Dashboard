// ⭐⭐ NEIGHBOR FRAMES (2026-11-20) — a column set and its points computed AHEAD (`binder.prepare`) are
// what the switch would have computed: the renderer is handed the very same data, call for call.
//
// Every case compares TWO binders on one fake chart each: the one under test prepares the next row's
// bars in idle time and then syncs to them; the control syncs to them with the switch OFF (today's path:
// no prepared store, no shared chart times). The assertion is on what the renderer was HANDED (every
// `setData` / `update` / option call of the switch's sync, in order), so a prepared answer that differs
// in one value at one bar is a red, whatever the reason.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createBinder, prepKeyOf, POINTS_SLICE_BARS } from './binder'
import { createFakeChart, makeBars } from './__tests__/fakeChart'
import * as nativeRegistry from './nativeRegistry'
import { primeServerColumns, clearServerColumns, pickServerInputs } from './serverCompute'
import {
  __setNeighborFramesForTests, neighborFramesStats, __resetNeighborFramesStatsForTests,
} from '../neighborFrames'

const RSI = 'legacy:rsi'
const inst = (defId, extra = {}) => ({ instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...extra })
const MIXED = () => [
  inst('rsi'),
  inst('macd'),
  inst('bb'),
  inst('relativeVolume'),
  inst('movingAverage', { instanceId: 'ma:close', inputs: { source: 'close', period: 21 } }),
  // a dependent: an average OF the RSI (an instance source, prepared after its source in one pass)
  inst('movingAverage', { instanceId: 'ma:rsi', inputs: { source: `@${RSI}::rsi`, period: 9 } }),
]

const placement = (instance) => ({ paneIndex: instance.defId === 'movingAverage' || instance.defId === 'bb' ? 0 : 1, scaleId: instance.defId })
const applyData = (plan) => (series, data) => {
  if (!series || !data) return
  if (plan.noop) return
  series.setData(data)
}

function ctxFor({ registry, instances, bars, sym = 'AAA', tf = 'D', cs = null, plan = { fresh: true } }) {
  return {
    enabled: true, registry, instances, bars, sym, tf, cs,
    adjustTime: ADJUST, plan, applyData: applyData(plan), resolvePlacement: placement,
  }
}
// one stable adjustTime per test file, as StockChart's is one `useCallback` per chart
const ADJUST = (t) => (typeof t === 'number' ? t + 0 : t)

/** What the renderer was handed: the ordered data/option calls, without the series ids two fakes number apart. */
const handed = (fake) => fake.calls
  .filter((c) => c.on === 'series' || c.on === 'priceScale')
  .map((c) => [c.method, JSON.stringify(c.args)])

const drain = (gen) => { let n = 0; for (const _ of gen) n += 1; return n }

/** A registry whose `computeFor` is counted per definition. */
function countingRegistry() {
  const calls = []
  const reg = { ...nativeRegistry, computeFor: (def, ...rest) => { calls.push(def.id); return nativeRegistry.computeFor(def, ...rest) } }
  return { reg, calls }
}

const barsA = makeBars(300, 1_700_000_000)
const barsB = makeBars(320, 1_690_000_000).map((b, i) => ({ ...b, c: b.c * 1.3 + Math.cos(i / 3), h: b.h * 1.3 + 2, l: b.l * 1.3 - 2, o: b.o * 1.3 }))

/**
 * The control: switch OFF, A then B. Returns what the B sync handed the renderer.
 * @returns {Array}
 */
function control({ instances, bars1 = barsA, bars2 = barsB, sym2 = 'BBB', ctx1 = {}, ctx2 = {} }) {
  __setNeighborFramesForTests(false)
  const fake = createFakeChart()
  const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
  b.sync({ ...ctxFor({ registry: nativeRegistry, instances, bars: bars1 }), ...ctx1 })
  fake.reset()
  // ⛔ `ctx2` reaches BOTH: `ctxFor`'s named options (`cs`, `plan`) and every other ctx key (`plotWindowFrom`), which
  // `ctxFor` does not pass through. ⚰️ The first cut spread it into `ctxFor` only, so a control asked for a window drew
  // every row, and the window rails compared the binder against a control that was not the same question.
  b.sync({ ...ctxFor({ registry: nativeRegistry, instances, bars: bars2, sym: sym2, ...ctx2 }), ...ctx2 })
  return handed(fake)
}

beforeEach(() => { __resetNeighborFramesStatsForTests(); clearServerColumns() })
afterEach(() => { __setNeighborFramesForTests(null); clearServerColumns() })

describe('a row prepared ahead is the row computed on the switch', () => {
  it('natives, an average of close and an average OF the RSI: the switch hands the renderer exactly what the control does, and computes nothing', () => {
    const want = control({ instances: MIXED() })

    __setNeighborFramesForTests(true)
    const { reg, calls } = countingRegistry()
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const instances = MIXED()
    b.sync(ctxFor({ registry: reg, instances, bars: barsA }))
    const pieces = drain(b.prepare({ bars: barsB, sym: 'BBB' }))
    expect(pieces).toBeGreaterThan(6)
    calls.length = 0
    fake.reset()
    b.sync(ctxFor({ registry: reg, instances, bars: barsB, sym: 'BBB' }))

    expect(handed(fake)).toEqual(want)
    expect(calls, 'the switch computed what was prepared').toEqual([])
    const st = neighborFramesStats()
    expect(st.colsHit).toBe(instances.length)
    expect(st.pointsHit).toBeGreaterThan(0)
  })

  it('an EQUAL copy of the bars is a different question: everything is computed, and the answer is the same', () => {
    const want = control({ instances: MIXED() })
    __setNeighborFramesForTests(true)
    const { reg, calls } = countingRegistry()
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const instances = MIXED()
    b.sync(ctxFor({ registry: reg, instances, bars: barsA }))
    drain(b.prepare({ bars: barsB, sym: 'BBB' }))
    calls.length = 0
    fake.reset()
    b.sync(ctxFor({ registry: reg, instances, bars: barsB.map((x) => ({ ...x })), sym: 'BBB' }))
    expect(handed(fake)).toEqual(want)
    expect(calls.length).toBe(instances.length)
    expect(neighborFramesStats().colsHit).toBe(0)
  })

  it('an input changed after the row was prepared: that instance is computed with the new input, the rest are taken', () => {
    const changed = () => MIXED().map((i) => (i.instanceId === RSI ? { ...i, inputs: { period: 6 } } : i))
    const want = control({ instances: changed() })
    __setNeighborFramesForTests(true)
    const { reg, calls } = countingRegistry()
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    b.sync(ctxFor({ registry: reg, instances: MIXED(), bars: barsA }))
    drain(b.prepare({ bars: barsB, sym: 'BBB' }))
    calls.length = 0
    fake.reset()
    b.sync(ctxFor({ registry: reg, instances: changed(), bars: barsB, sym: 'BBB' }))
    expect(handed(fake)).toEqual(want)
    // the RSI, and the average OF it (its source column is a new array now), are computed again
    expect(calls.sort()).toEqual(['movingAverage', 'rsi'])
  })

  it('the chart\'s colours changed after the row was prepared: the points are made again, in the new colours', () => {
    const csX = { candles: { upColor: '#00ff00', downColor: '#ff0000' } }
    const csY = { candles: { upColor: '#0000ff', downColor: '#ffff00' } }
    const want = control({ instances: MIXED(), ctx2: { cs: csY } })
    __setNeighborFramesForTests(true)
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    b.sync(ctxFor({ registry: nativeRegistry, instances: MIXED(), bars: barsA, cs: csX }))
    drain(b.prepare({ bars: barsB, sym: 'BBB' }))
    fake.reset()
    b.sync(ctxFor({ registry: nativeRegistry, instances: MIXED(), bars: barsB, sym: 'BBB', cs: csY }))
    expect(handed(fake)).toEqual(want)
  })

  it('prepare writes nothing the chart can see: no renderer call, no memo the next sync of the CURRENT row would read', () => {
    __setNeighborFramesForTests(true)
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    b.sync(ctxFor({ registry: nativeRegistry, instances: MIXED(), bars: barsA }))
    fake.reset()
    drain(b.prepare({ bars: barsB, sym: 'BBB' }))
    expect(fake.calls).toEqual([])
  })

  it('with the switch off, prepare is never consulted and a sync is today\'s', () => {
    __setNeighborFramesForTests(false)
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    b.sync(ctxFor({ registry: nativeRegistry, instances: MIXED(), bars: barsA }))
    // no ctx was kept while off: nothing to prepare from
    expect(drain(b.prepare({ bars: barsB, sym: 'BBB' }))).toBe(0)
  })
})

// ─── a long row: its points are made in slices, and the slices make the same array ─────────────────────────
describe('a 13,000-bar row', () => {
  const long1 = makeBars(13_000, 1_000_000_000)
  const long2 = makeBars(13_200, 900_000_000).map((b, i) => ({ ...b, c: b.c + Math.sin(i / 17) * 3 }))
  it('its points are made in slices of POINTS_SLICE_BARS, one piece each, and the switch is still the computed one', () => {
    const want = control({ instances: MIXED(), bars1: long1, bars2: long2 })
    __setNeighborFramesForTests(true)
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    b.sync(ctxFor({ registry: nativeRegistry, instances: MIXED(), bars: long1 }))
    const pieces = drain(b.prepare({ bars: long2, sym: 'BBB' }))
    const st = neighborFramesStats()
    expect(st.pointsPrepared).toBeGreaterThan(0)
    expect(pieces).toBeGreaterThanOrEqual(st.colsPrepared + st.pointsPrepared * Math.ceil(long2.length / POINTS_SLICE_BARS))
    fake.reset()
    b.sync(ctxFor({ registry: nativeRegistry, instances: MIXED(), bars: long2, sym: 'BBB' }))
    expect(handed(fake)).toEqual(want)
    expect(neighborFramesStats().pointsHit).toBeGreaterThan(0)
  })
})

// ─── ⭐ (2026-11-20) a row prepared under a PLOT WINDOW: its points are the rows the switch will draw ──────────────────
// The chart hands each line only the bars from its window start on (`ctx.plotWindowFrom`, `plotWindow.js`). `prepare`
// makes the points of as many of the newest bars as the last sync drew, and a window step more, never every bar;
// a switch that draws from further back than that (the member zoomed out) builds its own. Either way the renderer
// is handed exactly what the control hands it.
describe('a 13,000-bar row prepared under a 2,000-row plot window', () => {
  const long1 = makeBars(13_000, 1_000_000_000)
  const long2 = makeBars(13_200, 900_000_000).map((b, i) => ({ ...b, c: b.c + Math.sin(i / 17) * 3 }))
  // StockChart's `plotWindowFrom` for a window of `rows`: the chart time of the first drawn bar
  const fromOf = (bars, rows) => ADJUST(bars[bars.length - rows].t)
  const W = 2000

  it('its points are made for the drawn rows and one window step (one slice per plot), and the switch takes them', () => {
    const want = control({
      instances: MIXED(), bars1: long1, bars2: long2,
      ctx1: { plotWindowFrom: fromOf(long1, W) }, ctx2: { plotWindowFrom: fromOf(long2, W) },
    })
    __setNeighborFramesForTests(true)
    const { reg, calls } = countingRegistry()
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const instances = MIXED()
    b.sync({ ...ctxFor({ registry: reg, instances, bars: long1 }), plotWindowFrom: fromOf(long1, W) })
    const pieces = drain(b.prepare({ bars: long2, sym: 'BBB' }))
    const st = neighborFramesStats()
    expect(st.pointsPrepared).toBeGreaterThan(0)
    // one piece per compute, one for the chart times, ONE per plot's points (2,500 rows < POINTS_SLICE_BARS);
    // every bar would be ceil(13,200 / 6,000) = 3 per plot
    expect(W + 500).toBeLessThan(POINTS_SLICE_BARS)
    expect(pieces).toBe(st.colsPrepared + 1 + st.pointsPrepared)
    calls.length = 0
    fake.reset()
    b.sync({ ...ctxFor({ registry: reg, instances, bars: long2, sym: 'BBB' }), plotWindowFrom: fromOf(long2, W) })
    expect(handed(fake)).toEqual(want)
    expect(calls).toEqual([])
    expect(neighborFramesStats().pointsHit).toBeGreaterThan(0)
  })

  it('a switch that draws from further back than was prepared (a zoom out) builds its own points: the same picture', () => {
    const W2 = 5000
    const want = control({
      instances: MIXED(), bars1: long1, bars2: long2,
      ctx1: { plotWindowFrom: fromOf(long1, W) }, ctx2: { plotWindowFrom: fromOf(long2, W2) },
    })
    __setNeighborFramesForTests(true)
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    b.sync({ ...ctxFor({ registry: nativeRegistry, instances: MIXED(), bars: long1 }), plotWindowFrom: fromOf(long1, W) })
    drain(b.prepare({ bars: long2, sym: 'BBB' }))
    expect(neighborFramesStats().pointsPrepared).toBeGreaterThan(0)
    fake.reset()
    b.sync({ ...ctxFor({ registry: nativeRegistry, instances: MIXED(), bars: long2, sym: 'BBB' }), plotWindowFrom: fromOf(long2, W2) })
    expect(handed(fake)).toEqual(want)
    expect(neighborFramesStats().pointsHit, 'a prepared array that starts too late was used').toBe(0)
  })
})

// ─── a runtime / AST document's bar source stays a fresh array: context its memo key does not name still reaches it ─
describe('the listing fact reaches a non-native document', () => {
  const MA = nativeRegistry.getDefinition('movingAverage')
  // a document on the AST lane (`computeLaneOf`), drawing what the average draws, whose values read `listingStart`
  const AST = { ...MA, id: 'nfAstAverage', compute: { kind: 'ast', fn: 'nfAstAverage' } }
  const astRegistry = () => {
    const calls = []
    const reg = {
      ...nativeRegistry,
      getDefinition: (id) => (id === AST.id ? AST : nativeRegistry.getDefinition(id)),
      computeFor: (def, bars, inputs, ctx) => {
        calls.push(def.id)
        if (def.id !== AST.id) return nativeRegistry.computeFor(def, bars, inputs, ctx)
        const cols = nativeRegistry.computeFor(MA, bars, inputs, ctx)
        const k = ctx && ctx.listingStart ? 2 : 1
        const out = {}
        for (const key of Object.keys(cols)) out[key] = Float64Array.from(cols[key], (v) => v * k)
        return out
      },
    }
    return { reg, calls }
  }
  const instances = () => [
    { instanceId: 'ast:1', defId: AST.id, inputs: { source: 'close', period: 10 }, hidden: false },
    { instanceId: 'ma:1', defId: 'movingAverage', inputs: { source: 'close', period: 10 }, hidden: false },
  ]
  it('the same bars with the listing fact changed: the document recomputes; the native keeps its memo', () => {
    __setNeighborFramesForTests(true)
    const { reg, calls } = astRegistry()
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    b.sync({ ...ctxFor({ registry: reg, instances: instances(), bars: barsA }), listingStart: false })
    expect(calls.sort()).toEqual(['movingAverage', AST.id].sort())
    calls.length = 0
    b.sync({ ...ctxFor({ registry: reg, instances: instances(), bars: barsA }), listingStart: true })
    expect(calls, 'the document kept the answer it gave before the listing fact').toEqual([AST.id])
  })
})

// ─── the server lane: the landed envelope is part of the question ───────────────────────────────────────
const dateBars = (n, startDay, k) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2024, 0, 1) + (startDay + i) * 86400000).toISOString().slice(0, 10)
  const c = 50 + Math.sin(i / 5) * 4 + i * k
  return { t: d, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const keyOfDate = (t) => Number(String(t).replace(/-/g, ''))
const RS = nativeRegistry.getDefinition('rsLine')
const wireFor = (bars, scale) => ({
  columns: { rsLine: bars.map((b, i) => (b.c / 100) * scale + i * 1e-4) },
  times: bars.map((b) => keyOfDate(b.t)),
  rev: RS && RS.compute ? RS.compute.rev : undefined,
})
const rsInst = () => [{ instanceId: 'rs:1', defId: 'rsLine', inputs: {}, hidden: false }]

describe('a server-lane column set is prepared only from a landed envelope, and only that envelope answers', () => {
  const sA = dateBars(200, 0, 0.01)
  const sB = dateBars(220, 30, 0.02)
  const sent = () => pickServerInputs(RS, nativeRegistry.resolveInputs(RS, {}))

  function controlRs() {
    __setNeighborFramesForTests(false)
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    b.sync(ctxFor({ registry: nativeRegistry, instances: rsInst(), bars: sA, sym: 'AAA' }))
    fake.reset()
    b.sync(ctxFor({ registry: nativeRegistry, instances: rsInst(), bars: sB, sym: 'BBB' }))
    return handed(fake)
  }

  it('the definition is a server-lane one (the precondition this block is about)', () => {
    expect(RS && RS.compute && RS.compute.kind).toBe('server')
  })

  it('landed before the row was prepared: the switch takes it and computes nothing', () => {
    primeServerColumns('rsLine', 'AAA', 'D', sent(), wireFor(sA, 1))
    primeServerColumns('rsLine', 'BBB', 'D', sent(), wireFor(sB, 1))
    const want = controlRs()
    __setNeighborFramesForTests(true)
    const { reg, calls } = countingRegistry()
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    b.sync(ctxFor({ registry: reg, instances: rsInst(), bars: sA, sym: 'AAA' }))
    drain(b.prepare({ bars: sB, sym: 'BBB' }))
    calls.length = 0
    fake.reset()
    b.sync(ctxFor({ registry: reg, instances: rsInst(), bars: sB, sym: 'BBB' }))
    expect(handed(fake)).toEqual(want)
    expect(calls).toEqual([])
    expect(want.some(([m]) => m === 'setData')).toBe(true)
  })

  it('a NEWER envelope landed after the row was prepared: the switch draws the newer one', () => {
    primeServerColumns('rsLine', 'AAA', 'D', sent(), wireFor(sA, 1))
    primeServerColumns('rsLine', 'BBB', 'D', sent(), wireFor(sB, 1))
    __setNeighborFramesForTests(true)
    const { reg, calls } = countingRegistry()
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    b.sync(ctxFor({ registry: reg, instances: rsInst(), bars: sA, sym: 'AAA' }))
    drain(b.prepare({ bars: sB, sym: 'BBB' }))
    // the server answers again, with other numbers
    primeServerColumns('rsLine', 'BBB', 'D', sent(), wireFor(sB, 2))
    calls.length = 0
    fake.reset()
    b.sync(ctxFor({ registry: reg, instances: rsInst(), bars: sB, sym: 'BBB' }))
    const got = handed(fake)
    expect(calls).toEqual(['rsLine'])
    expect(got).toEqual(controlRs())
  })

  it('nothing landed for the row: nothing is prepared for it (and nothing is asked)', () => {
    primeServerColumns('rsLine', 'AAA', 'D', sent(), wireFor(sA, 1))
    __setNeighborFramesForTests(true)
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const fetcher = vi.fn()
    b.sync({ ...ctxFor({ registry: nativeRegistry, instances: rsInst(), bars: sA, sym: 'AAA' }), fetcher })
    drain(b.prepare({ bars: sB, sym: 'BBB' }))
    expect(neighborFramesStats().colsPrepared).toBe(0)
    expect(prepKeyOf(nativeRegistry, RS, rsInst()[0], null, { sym: 'BBB', tf: 'D', forming: null })).toBe(null)
  })
})
