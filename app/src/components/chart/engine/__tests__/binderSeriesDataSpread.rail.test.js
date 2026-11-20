// ─── ⭐⭐ A HEAVY PASS'S INDICATOR DATA, SPREAD OVER TASKS: THE FINAL PICTURE IS IDENTICAL (switch smoothness) ────
//
// MEASURED (patrick-54's trace, RDDT 1D -> 5m with Fred RS): every deep-history pass handed every indicator series its
// data in one task (25-31 ms of the binder's `setData` inside tasks of 198-236 ms). With `deferSeriesData` the binder
// queues the new data of a series it already drew and drains the queue one task at a time (`binder.js`,
// `SERIES_DATA_DEFER_MIN_ROWS`). These rails drive the SAME sequence of passes through two binders over two recording
// renderers, one at once (as before) and one spread, and hold:
//   1. ⛔⛔ the final picture is identical: every live series holds the same points, options and pane, and no data
//      ever reaches a removed series;
//   2. while data waits, every point any series holds is at a bar time of the pass's bars (the candles' own time
//      scale), so the chart's framing reads the same index space either way;
//   3. it is spread: a pass queued work, and a slow renderer is drained over several tasks, each within the slice;
//   4. the queue is applied before anything that extends or reads a series: an incremental update in a later pass,
//      `flushPendingData` (a live writer, an end label), a removal (dropped, never applied);
//   5. a light pass, a first bind, and a pass whose bars do not hold the picture on screen (a switch) are not spread.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createBinder, SERIES_DATA_DEFER_MIN_ROWS, SERIES_DATA_SLICE_MS, barTimesWithin } from '../binder'
import { createFakeChart, makeBars } from './fakeChart'
import * as registry from '../nativeRegistry'
import { FIRST_PAINT_MAX } from '../../../../utils/barsBackfill'

// ── tasks, by hand: the binder posts each drain slice through a MessageChannel; this one queues them for the test
const TASKS = []
class ManualChannel {
  constructor() {
    const port1 = { onmessage: null }
    this.port1 = port1
    this.port2 = { postMessage: () => { TASKS.push(() => { if (port1.onmessage) port1.onmessage({ data: 0 }) }) } }
  }
}
beforeAll(() => { vi.stubGlobal('MessageChannel', ManualChannel) })
afterAll(() => { vi.unstubAllGlobals() })
beforeEach(() => { TASKS.length = 0 })
const runTask = () => { const f = TASKS.shift(); if (f) f(); return !!f }
const drainAll = () => { let n = 0; while (runTask()) n += 1; return n }

const inst = (defId) => ({ instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false })
const INSTANCES = [inst('rsi'), inst('macd'), inst('bb')]
const placement = (instance) => ({ paneIndex: 0, scaleId: instance.defId, scaleOptions: { autoScale: true } })
/** `StockChart._applyData`, faithfully: nothing on a noop, the newest point on an incremental plan, else a full set. */
const applyDataLike = (plan) => (series, data) => {
  if (!series || !data) return
  if (plan.noop) return
  if (plan.incr && data.length) { try { series.update(data[data.length - 1]); return } catch { /* full */ } }
  series.setData(data)
}
const ctxFor = (bars, plan, defer, instances = INSTANCES) => ({
  enabled: true, instances, registry, bars, adjustTime: (t) => t, plan, applyData: applyDataLike(plan),
  resolvePlacement: placement, deferSeriesData: defer,
})

/** What the renderer holds, replayed from the log: per series id its points, options and pane; the removed ids;
 *  and any data call that reached a series after its removal. */
function rendererOf(fake) {
  const data = new Map()
  const removed = new Set()
  const afterRemoval = []
  for (const c of fake.calls) {
    if (c.on === 'chart' && c.method === 'removeSeries') { removed.add(c.args[0] && c.args[0].__id); continue }
    if (c.on !== 'series') continue
    if ((c.method === 'setData' || c.method === 'update') && removed.has(c.id)) afterRemoval.push(`${c.method} ${c.id}`)
    if (c.method === 'setData') data.set(c.id, (c.args[0] || []).map((p) => ({ ...p })))
    else if (c.method === 'update') {
      const arr = data.get(c.id) || []
      const p = { ...c.args[0] }
      if (arr.length && arr[arr.length - 1].time === p.time) arr[arr.length - 1] = p
      else arr.push(p)
      data.set(c.id, arr)
    }
  }
  const live = fake.seriesCreated.filter((s) => !removed.has(s.__id))
  return {
    afterRemoval,
    picture: live.map((s) => ({ id: s.__id, pane: s.__pane, options: s.__options, points: data.get(s.__id) || [] })),
  }
}
const dataCalls = (fake) => fake.calls.filter((c) => c.on === 'series' && (c.method === 'setData' || c.method === 'update')).length

// the passes of a switch and what follows it, over one symbol and timeframe, then another
const DEEP = makeBars(3000)
const FIRST = DEEP.slice(-600)
const TICKED = DEEP.map((b, i) => (i === DEEP.length - 1 ? { ...b, c: b.c + 0.7, h: b.h + 0.7 } : b))
const APPENDED = [...TICKED, { ...TICKED[TICKED.length - 1], t: TICKED[TICKED.length - 1].t + 86400, c: 131 }]
const OTHER = makeBars(2500, 1_500_000_000)
const OTHER_DEEP = makeBars(3200, 1_500_000_000 - 700 * 86400)
const PASSES = [
  ['first paint', FIRST, { fresh: true }],
  ['deep history', DEEP, {}],
  ['a landing on the same bars', DEEP, { noop: true }],
  ['a tick', TICKED, { incr: true }],
  ['a new bar', APPENDED, {}],
  ['a switch', OTHER, {}],
  ['its deep history', OTHER_DEEP, {}],
]

/** Every point every live series holds is at a bar time of `bars`. */
function onTheBars(fake, bars) {
  const times = new Set(bars.map((b) => b.t))
  for (const s of rendererOf(fake).picture) for (const p of s.points) if (!times.has(p.time)) return `${s.id} holds ${p.time}`
  return null
}

describe('the constants are derived', () => {
  it('a pass over more rows than a first paint may spread', () => {
    expect(SERIES_DATA_DEFER_MIN_ROWS).toBe(FIRST_PAINT_MAX + 1)
    expect(SERIES_DATA_SLICE_MS).toBeGreaterThan(0)
    expect(barTimesWithin(FIRST, DEEP)).toBe(true)
    expect(barTimesWithin(DEEP, FIRST)).toBe(false)
    expect(barTimesWithin(DEEP, OTHER_DEEP)).toBe(false)
    expect(barTimesWithin(OTHER, OTHER_DEEP)).toBe(true)
  })
})

describe('⛔⛔ 1 + 2. the same passes, at once and spread: the same final picture, and nothing off the bars meanwhile', () => {
  for (const drainEvery of [Infinity, 1, 2]) {
    it(`drained ${drainEvery === Infinity ? 'only at the end' : `every ${drainEvery} pass(es)`}`, () => {
      const at = createFakeChart()
      const spread = createFakeChart()
      const a = createBinder({ chart: at.chart, LWC: at.LWC })
      const b = createBinder({ chart: spread.chart, LWC: spread.LWC })
      let queued = 0
      PASSES.forEach(([name, bars, plan], i) => {
        a.sync(ctxFor(bars, plan, false))
        b.sync(ctxFor(bars, plan, true))
        queued = Math.max(queued, b.pendingDataCount())
        expect(a.pendingDataCount(), `${name}: the opted-out binder never queues`).toBe(0)
        expect(onTheBars(spread, bars), `${name}: a waiting series holds a point off the bars`).toBeNull()
        if ((i + 1) % drainEvery === 0) drainAll()
      })
      drainAll()
      expect(b.pendingDataCount()).toBe(0)
      expect(queued, 'non-vacuity: some pass queued data').toBeGreaterThan(0)
      const want = rendererOf(at)
      const got = rendererOf(spread)
      expect(got.afterRemoval, 'data reached a removed series').toEqual([])
      expect(want.afterRemoval).toEqual([])
      expect(got.picture.length).toBeGreaterThan(3)
      expect(got.picture).toEqual(want.picture)
    })
  }
})

describe('3. it is spread', () => {
  it('a deep pass hands no already-drawn series its data in the pass; a slow renderer drains over several tasks', () => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    binder.sync(ctxFor(FIRST, { fresh: true }, true))
    drainAll()
    const before = dataCalls(fake)
    // every series the binder holds is slow to set (as a real one is over 28k rows)
    const SLOW_MS = SERIES_DATA_SLICE_MS * 0.75
    for (const s of fake.seriesCreated) {
      const set = s.setData
      s.setData = (d) => { const t0 = performance.now(); while (performance.now() - t0 < SLOW_MS) { /* the renderer's work */ } return set(d) }
    }
    binder.sync(ctxFor(DEEP, {}, true))
    const queued = binder.pendingDataCount()
    expect(queued, 'every drawn series waits').toBe(fake.seriesCreated.length)
    expect(dataCalls(fake), 'no series data was handed over in the pass').toBe(before)
    const perTask = []
    while (TASKS.length) {
      const n0 = dataCalls(fake)
      runTask()
      perTask.push(dataCalls(fake) - n0)
    }
    expect(perTask.reduce((x, y) => x + y, 0)).toBe(queued)
    expect(perTask.length, 'one task drained everything').toBeGreaterThan(1)
    for (const n of perTask) {
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(Math.ceil(SERIES_DATA_SLICE_MS / SLOW_MS) + 1)
    }
  })
})

describe('4. the queue is applied before anything that extends or reads a series', () => {
  it('flushPendingData (a live writer, an end label): one series, then every series', () => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    binder.sync(ctxFor(FIRST, { fresh: true }, true))
    binder.sync(ctxFor(DEEP, {}, true))
    const n = binder.pendingDataCount()
    expect(n).toBeGreaterThan(1)
    const one = binder.bindings()[0].series
    binder.flushPendingData(one)
    expect(binder.pendingDataCount()).toBe(n - 1)
    const pts = rendererOf(fake).picture.find((s) => s.id === one.__id).points
    expect(pts.length, 'the flushed series holds the deep pass\'s points').toBe(DEEP.length)
    binder.flushPendingData()
    expect(binder.pendingDataCount()).toBe(0)
    expect(drainAll(), 'the drain task finds nothing left').toBeLessThanOrEqual(1)
    expect(dataCalls(fake)).toBe(binder.bindings().length + n)
  })

  it('an incremental update while the deep data waits lands on the deep data (the queue is applied first)', () => {
    const at = createFakeChart()
    const spread = createFakeChart()
    const a = createBinder({ chart: at.chart, LWC: at.LWC })
    const b = createBinder({ chart: spread.chart, LWC: spread.LWC })
    for (const [bars, plan] of [[FIRST, { fresh: true }], [DEEP, {}], [TICKED, { incr: true }]]) {
      a.sync(ctxFor(bars, plan, false))
      b.sync(ctxFor(bars, plan, true))
    }
    expect(b.pendingDataCount(), 'the tick applied what waited').toBe(0)
    drainAll()
    expect(rendererOf(spread).picture).toEqual(rendererOf(at).picture)
    const last = rendererOf(spread).picture[0].points
    expect(last.length).toBe(DEEP.length)
  })

  it('an instance removed while its data waits: dropped, never handed to the removed series', () => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    binder.sync(ctxFor(FIRST, { fresh: true }, true))
    binder.sync(ctxFor(DEEP, {}, true))
    expect(binder.pendingDataCount()).toBeGreaterThan(0)
    binder.sync(ctxFor(DEEP, { noop: true }, true, [inst('rsi')]))
    drainAll()
    expect(rendererOf(fake).afterRemoval).toEqual([])
    binder.teardown()
    expect(binder.pendingDataCount()).toBe(0)
  })
})

describe('6. the chart opts in only where the candles are the indicators\' bars, and applies the queue before it reads or writes', () => {
  const SRC = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '..', '..', '..', 'StockChart.jsx'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const body = (from, to) => { const a = SRC.indexOf(from); expect(a, from).toBeGreaterThan(0); return SRC.slice(a, SRC.indexOf(to, a)) }
  it('the sync is handed `deferSeriesData` only when the candles are built from the very bars the binder is', () => {
    const sync = body('engineRef.current.binder.sync({', '\n      })')
    expect(sync).toMatch(/\n\s+bars: filteredBars,/)
    expect(sync).toMatch(/\n\s+deferSeriesData: displayBars === filteredBars,/)
  })
  it('a live writer applies the queue before its first `update`', () => {
    const live = body('const _extendOverlaysLive = useCallback(', '}, [adjustTime, averageBindings])')
    const flush = live.indexOf('flushPendingData')
    expect(flush).toBeGreaterThan(0)
    expect(flush).toBeLessThan(live.indexOf('.update('))
  })
  it('an end label applies its series\' queue before it reads what the series holds', () => {
    const pin = body('const pinEndLabel = useCallback(', 'endLabelLastRef.current.set(b, last)')
    const flush = pin.indexOf('flushPendingData?.(b.series)')
    expect(flush).toBeGreaterThan(0)
    expect(flush).toBeLessThan(pin.indexOf('b.series.data()'))
  })
})

describe('5. not spread', () => {
  it('a light pass, every first bind, and a switch whose bars do not hold the picture on screen', () => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    binder.sync(ctxFor(FIRST, { fresh: true }, true))
    expect(binder.pendingDataCount(), 'first binds are set at once').toBe(0)
    binder.sync(ctxFor(FIRST.slice(-500), {}, true))
    expect(binder.pendingDataCount(), 'a light pass is set at once').toBe(0)
    binder.sync(ctxFor(OTHER, {}, true))
    expect(binder.pendingDataCount(), 'a switch (another symbol\'s bars) is set at once').toBe(0)
    binder.sync(ctxFor(OTHER_DEEP, {}, true))
    expect(binder.pendingDataCount(), 'its deep history is spread').toBeGreaterThan(0)
    binder.sync(ctxFor(DEEP, {}, false))
    expect(binder.pendingDataCount(), 'not opted in: everything waiting is applied, then the pass at once').toBe(0)
    expect(onTheBars(fake, DEEP)).toBeNull()
  })
})
