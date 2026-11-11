// app/src/components/chart/engine/binder.axisHidden.test.js
//
// ─── A4 THROUGH THE BINDER: WHAT THE RENDERER IS ACTUALLY TOLD ──────────────
//
// `placement.axisHidden.test.js` pins the answers; this file pins the CALLS the
// binder makes with them on a recording chart: which scale each series is put on,
// whether it carries a value tag, what is written to which price scale, and that
// a neighbouring RSI/MACD sees the same calls whether or not a hidden-axis pane
// sits beside it. The real-renderer half (no ticks, no tag, autoscale, no wedge)
// is `__tests__/axisHiddenRealChart.test.js`.
//
// ⭐ THE FIXTURE is ATR with `placement.axis: 'hidden'` added — a client-computed
// pane indicator, so the binder has a column to draw without a server lane. It
// stands in for `rsLine`, which VA2 opts in; the engine path is the same.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBinder } from './binder'
import { resolvePlacement, HIDDEN_AXIS_SCALE_ID } from './placement'
import { createFakeChart, makeBars } from './__tests__/fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from './paneLayout'
import * as nativeRegistry from './nativeRegistry'

const bars = makeBars()
const ATR = nativeRegistry.getDefinition('atr')
const ATR_HIDDEN = { ...ATR, placement: { ...ATR.placement, axis: 'hidden' } }

/** The real registry, except that `atr` asks for a hidden axis. */
const hiddenRegistry = {
  ...nativeRegistry,
  getDefinition: (id) => (id === 'atr' ? ATR_HIDDEN : nativeRegistry.getDefinition(id)),
}

const inst = (defId, extra = {}) => ({
  instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...extra,
})
const guestOf = (hostId, defId, n) => inst(defId, {
  instanceId: `${defId}:${n}`, placement: { target: `@${hostId}` },
})

/** One pane per HOST; a guest gets none, by design — it resolves to its host's. */
const layoutFor = (hosts) => computePaneLayout(hosts, {
  chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX,
})

const ctxFor = (instances, { registry = hiddenRegistry, hosts = instances } = {}) => ({
  enabled: true,
  registry,
  instances,
  bars,
  adjustTime: (t) => t,
  resolvePlacement,
  paneMargins: {},
  paneLayout: layoutFor(hosts),
  volOverlaySet: new Set(),
  volSeparatePane: false,
  VOL_PANE_INDEX: 1,
  plan: { fresh: true },
  applyData: (series, data) => { if (series && data) series.setData(data) },
})

let fake
let binder
beforeEach(() => {
  __setPaneModeForTest('panes')
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
})
afterEach(() => { __setPaneModeForTest(null) })

/** The series created for a definition's plot keys, read from what was bound. */
const seriesOn = (scaleId) => fake.seriesCreated.filter((s) => s.__options.priceScaleId === scaleId)
const scaleWritesFor = (series) => fake.calls
  .filter((c) => c.method === 'priceScale.applyOptions' && c.id === series.__id)
  .map((c) => c.args[0])

describe('a hidden-axis definition, bound alone', () => {
  it('its series go on the hidden overlay scale with no value tag', () => {
    binder.sync(ctxFor([inst('atr')]))
    expect(fake.seriesCreated.length, 'ATR bound nothing — the rest is vacuous').toBeGreaterThan(0)
    for (const s of fake.seriesCreated) {
      expect(s.__options.priceScaleId).toBe(HIDDEN_AXIS_SCALE_ID)
      expect(s.__options.lastValueVisible).toBe(false)
    }
    expect(seriesOn('right')).toEqual([])
  })

  it('the scale it writes is the full autoscaling set, and never says `visible`', () => {
    binder.sync(ctxFor([inst('atr')]))
    const writes = fake.seriesCreated.flatMap(scaleWritesFor)
    expect(writes.length).toBeGreaterThan(0)
    for (const w of writes) {
      expect(w).toEqual({ borderVisible: false, scaleMargins: { top: 0.16, bottom: 0.1 }, autoScale: true })
      expect(w).not.toHaveProperty('visible')
    }
    // ⛔ And nothing at chart level: the chart's own right scale is never asked.
    expect(fake.calls.filter((c) => c.id === 'chart:right')).toEqual([])
    expect(fake.callsOf('applyOptions').filter((c) => c.on === 'chart')).toEqual([])
  })

  it('without the field the same definition binds on the visible right scale with its tag', () => {
    binder.sync(ctxFor([inst('atr')], { registry: nativeRegistry }))
    expect(fake.seriesCreated.length).toBeGreaterThan(0)
    for (const s of fake.seriesCreated) expect(s.__options.priceScaleId).toBe('right')
    expect(fake.seriesCreated.some((s) => s.__options.lastValueVisible === true)).toBe(true)
  })
})

describe('CONTROL — RSI and MACD get byte-identical calls beside a hidden pane', () => {
  /** Every call that touches the RSI and MACD series, serialised. They are bound
   *  first, so their series ids are the same in both runs. */
  const callsFor = (instances) => {
    const f = createFakeChart()
    createBinder({ chart: f.chart, LWC: f.LWC }).sync(ctxFor(instances))
    const ids = new Set(f.seriesCreated
      .filter((s) => s.__options.priceScaleId === 'right')
      .map((s) => s.__id))
    return {
      ids,
      log: f.calls
        .filter((c) => ids.has(c.id) || (c.method === 'addSeries' && c.result && ids.has(c.result.__id)))
        .map((c) => `${c.method}|${c.id}|${JSON.stringify(c.args, (k, v) => (typeof v === 'function' ? `fn:${v.name}` : v))}`),
    }
  }

  it('the RSI/MACD call log is the same with and without a hidden-axis pane after them', () => {
    const alone = callsFor([inst('rsi'), inst('macd')])
    const beside = callsFor([inst('rsi'), inst('macd'), inst('atr')])
    expect(alone.log.length).toBeGreaterThan(5)   // non-vacuity
    expect(beside.ids).toEqual(alone.ids)
    expect(beside.log).toEqual(alone.log)
  })

  it('RSI and MACD keep the right axis and their value tags', () => {
    binder.sync(ctxFor([inst('rsi'), inst('macd'), inst('atr')]))
    const right = seriesOn('right')
    expect(right.length).toBeGreaterThan(0)
    expect(right.some((s) => s.__options.lastValueVisible === true)).toBe(true)
    expect(seriesOn(HIDDEN_AXIS_SCALE_ID).length).toBeGreaterThan(0)
  })
})

describe('two tenants in one pane — the axis hides only when every tenant asks', () => {
  const HOST = inst('atr')

  it('host and guest both ask → every series on the hidden overlay', () => {
    const guest = guestOf(HOST.instanceId, 'atr', 2)
    binder.sync(ctxFor([HOST, guest], { hosts: [HOST] }))
    const panes = new Set(fake.seriesCreated.map((s) => s.__pane))
    expect(fake.seriesCreated.length).toBe(2)
    expect(panes.size).toBe(1)                       // same pane, really
    for (const s of fake.seriesCreated) expect(s.__options.priceScaleId).toBe(HIDDEN_AXIS_SCALE_ID)
  })

  it('only the host asks → the axis comes back: both on `right`, the host still untagged', () => {
    const guest = guestOf(HOST.instanceId, 'rsi', 2)
    binder.sync(ctxFor([HOST, guest], { hosts: [HOST] }))
    expect(fake.seriesCreated.length).toBeGreaterThan(1)
    expect(new Set(fake.seriesCreated.map((s) => s.__pane)).size).toBe(1)
    for (const s of fake.seriesCreated) expect(s.__options.priceScaleId).toBe('right')
    const [hostSeries] = fake.seriesCreated
    expect(hostSeries.__options.lastValueVisible).toBe(false)
    // The host still writes its scale — onto `right` now, the full set, no `visible`.
    const writes = scaleWritesFor(hostSeries)
    expect(writes.length).toBe(1)
    expect(writes[0]).not.toHaveProperty('visible')
  })

  it('a guest arriving and leaving moves the host between the two scales, never recreating it', () => {
    const guest = guestOf(HOST.instanceId, 'rsi', 2)
    binder.sync(ctxFor([HOST], { hosts: [HOST] }))
    const [hostSeries] = fake.seriesCreated
    expect(hostSeries.__options.priceScaleId).toBe(HIDDEN_AXIS_SCALE_ID)

    fake.reset()
    binder.sync(ctxFor([HOST, guest], { hosts: [HOST] }))
    expect(hostSeries.__options.priceScaleId).toBe('right')
    expect(fake.count('removeSeries')).toBe(0)

    fake.reset()
    binder.sync(ctxFor([HOST], { hosts: [HOST] }))
    expect(hostSeries.__options.priceScaleId).toBe(HIDDEN_AXIS_SCALE_ID)
  })

  it('a pooled series leaving the hidden pane for RSI\'s gets the right scale and its tag back', () => {
    binder.sync(ctxFor([HOST]))
    const [pooled] = fake.seriesCreated
    expect(pooled.__options.priceScaleId).toBe(HIDDEN_AXIS_SCALE_ID)
    fake.reset()
    binder.sync(ctxFor([inst('rsi')]))
    expect(fake.count('addSeries')).toBe(0)          // re-tenanted, not recreated
    expect(pooled.__options.priceScaleId).toBe('right')
    expect(pooled.__options.lastValueVisible).toBe(true)
  })
})
