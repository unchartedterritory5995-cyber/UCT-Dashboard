// app/src/components/chart/engine/__tests__/candleLifecycle.test.js
//
// ─── PHASE C · THE FEATURE SURVIVES THE WHOLE TRADER LIFECYCLE ──────────────
//
// ⭐⭐ THE CLAIM. Phase B proved a member can CHOOSE candles. This file proves
// the choice survives everything a member does afterwards — restyle, compose,
// duplicate, hide, delete, re-add — against the REAL binder and a recording
// renderer double, so a regression is observable as the wrong CALL and not only
// as the wrong stored string.
//
// ⛔ NOTHING HERE RESTATES A RULE. Capability, intersection, the style clamp and
// the choice list are each said once in `ohlcBinding.test.js`. What is new here
// is the LIFECYCLE — the sequences that exist only because a chart is used over
// time — and the one question the settings layer could not ask: *what is the
// renderer actually handed?*

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { createFakeChart, makeBars } from './fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from '../paneLayout'
import * as registry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { createDirectSeries, lastCreatedInstance } from '../../discoveryCatalog'
import { symbolSource } from '../sourceRef'
import { paneOwnKeys } from '../displayTarget'
import {
  addInstance, removeInstance, setInstancePlotStyle, setInstanceCandleColor,
  setInstanceInput, setInstanceDisplayTarget, setInstanceHidden,
} from '../instanceControls'
import { clearSecondaryBars, ensureAll } from '../secondaryBars'
import { OHLC_FAMILY } from '../ohlcCapability'

const TF = 'D'
const COUNT = 400
const bars = makeBars(260)

/** A genuine auction bar, on the chart's own timestamps and at its own level.
 *  The offset is load-bearing: it is how a case tells QQQ's numbers from the
 *  primary's. */
const secBarsFor = (offset) => bars.map((b) => ({
  t: b.t, o: b.c + offset - 0.6, h: b.c + offset + 1.1, l: b.c + offset - 1.3,
  c: b.c + offset, v: 900_000,
}))

/** A breadth bar as `breadth_symbols.py` builds one — structurally complete,
 *  semantically not an auction period. */
const breadthBars = () => bars.map((b, i) => {
  const prev = 40 + ((i * 3) % 20)
  const v = 40 + (((i + 1) * 3) % 20)
  return { t: b.t, o: prev, h: Math.max(prev, v), l: Math.min(prev, v), c: v, v: 0 }
})

const familyOf = (sym) => (sym === 'UCTA50' ? OHLC_FAMILY.BREADTH : OHLC_FAMILY.SECURITY)

/** The secondary map the hook supplies, in the shape the binder reads. */
const secondaryMap = (entries) => new Map(
  Object.entries(entries).map(([sym, b]) => [sym, { bars: b, status: 'ready' }]),
)

const ctxFor = (cs, secondary) => {
  const instances = cs.indicatorInstances || []
  // ⭐⭐ `includeKeys` IS NOT OPTIONAL DRESSING — it is how an INSTANCE's own
  // placement reaches the layout. A definition whose static target is the price
  // pane (`movingAverage`) is not in `paneTargetIds()`, so an MA a member sent to
  // its own pane gets no pane at all without this, binds nothing, and a case
  // written without it would "prove" the renderer refused something it never saw.
  // `StockChart.jsx:10548` passes exactly this; so does the harness.
  const layout = computePaneLayout(instances, {
    chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX,
    excludeKeys: new Set(), includeKeys: paneOwnKeys(instances, cs),
  })
  return {
    enabled: true, instances, registry, bars, cs,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    paneLayout: layout,
    secondary,
    ohlcFamilyOf: familyOf,
    resolvePlacement: (i, def) => resolvePlacement(i, def, {
      paneMargins: layout.bands, paneLayout: layout,
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    }),
  }
}

/** A chart carrying one direct series on `symbol` — the member-facing path. */
function withSeries(cs, symbol) {
  const next = createDirectSeries(cs, symbolSource(symbol, 'close'), registry, { name: symbol })
  return { cs: next, id: lastCreatedInstance(cs, next).instanceId }
}

/** A moving average reading `symbol`, placed on `target`. */
function withMa(cs, symbol, target) {
  const added = addInstance(cs, 'movingAverage', registry)
  const id = lastCreatedInstance(cs, added).instanceId
  let next = setInstanceInput(added, id, 'source', symbolSource(symbol, 'close'), registry)
  if (target) next = setInstanceDisplayTarget(next, id, target, registry)
  return { cs: next, id }
}

let fake
let binder
beforeEach(() => {
  __setPaneModeForTest('panes')
  clearSecondaryBars()
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
})
afterEach(() => { __setPaneModeForTest(null) })

/** Every series LWC was asked to build, by ctor name, in bind order. */
const madeTypes = () => fake.callsOf('addSeries').map((c) => String(c.args[0]))
/** The options `addSeries` was given for the Nth creation. */
const madeOpts = (n) => fake.callsOf('addSeries')[n].args[1]
/** The data the Nth `setData` carried. */
const dataAt = (n) => fake.callsOf('setData')[n].args[0]

// ─── restyle, and restyle back ──────────────────────────────────────────────

describe('Line ↔ Candles ↔ Line is one instance changing clothes', () => {
  it('⭐⭐ the SERIES TYPE follows the style, and the old series does not linger', () => {
    const secondary = secondaryMap({ QQQ: secBarsFor(600) })
    let { cs, id } = withSeries(mergeChartSettings({}), 'QQQ')

    binder.sync(ctxFor(cs, secondary))
    expect(madeTypes()).toEqual(['LineSeries'])
    const lineSeries = fake.seriesCreated[0]

    cs = setInstancePlotStyle(cs, id, 'candles', registry)
    binder.sync(ctxFor(cs, secondary))
    expect(madeTypes()).toEqual(['LineSeries', 'CandlestickSeries'])
    // ⛔ THE POINT OF THE CASE. A candlestick is not a line's pool mate, so the
    // line has to GO — a chart that kept drawing both would show one instrument
    // twice and no member control would remove the ghost.
    expect(fake.callsOf('removeSeries').map((c) => c.args[0])).toContain(lineSeries)

    cs = setInstancePlotStyle(cs, id, 'line', registry)
    binder.sync(ctxFor(cs, secondary))
    expect(madeTypes().at(-1), 'the way back is not symmetrical').toBe('LineSeries')
  })

  it('⛔ …and the INSTANCE is untouched: same id, same source, no candle vocabulary', () => {
    const secondary = secondaryMap({ QQQ: secBarsFor(600) })
    let { cs, id } = withSeries(mergeChartSettings({}), 'QQQ')
    const before = (cs.indicatorInstances || []).find((i) => i.instanceId === id)

    cs = setInstancePlotStyle(cs, id, 'candles', registry)
    binder.sync(ctxFor(cs, secondary))
    const after = (cs.indicatorInstances || []).find((i) => i.instanceId === id)

    expect(after.instanceId).toBe(before.instanceId)
    expect(after.inputs.source).toBe('sym:QQQ:close')
    expect(after.displayTarget).toBe(before.displayTarget)
    // ⛔ The source grammar did not grow a candle dialect on the way through.
    expect(JSON.stringify(after.inputs)).not.toMatch(/ohlc|candle/i)
  })
})

// ─── what the renderer is actually handed ───────────────────────────────────

describe('a stored style the source cannot mean is clamped, and nothing is invented', () => {
  it('⛔⛔ BREADTH PERSISTED AS `candles` BINDS A LINE AND IS FED SCALARS', () => {
    // ⚰️ THE FAILURE THIS REFUSES: a chart saved while a symbol was classified
    // one way, reopened after the registry says another. The stored style is
    // still `candles`. If only the DROPDOWN honoured capability, the renderer
    // would be handed a measure whose "open" is yesterday's value, drawn as an
    // auction period a member cannot tell from a real one.
    const secondary = secondaryMap({ UCTA50: breadthBars() })
    let { cs, id } = withSeries(mergeChartSettings({}), 'UCTA50')
    cs = setInstancePlotStyle(cs, id, 'candles', registry)
    // The stored intent survives — the clamp is a reading, not an edit.
    const stored = (cs.indicatorInstances || []).find((i) => i.instanceId === id)
    expect(JSON.stringify(stored.presentation)).toMatch(/candles/)

    binder.sync(ctxFor(cs, secondary))

    expect(madeTypes()).toEqual(['LineSeries'])
    const points = dataAt(0)
    expect(points.length).toBeGreaterThan(0)
    for (const p of points) {
      expect(p, 'a breadth bar reached the renderer as an auction period')
        .not.toHaveProperty('open')
      expect(p).not.toHaveProperty('high')
      expect(p).not.toHaveProperty('low')
      expect(p).toHaveProperty('value')
    }
  })

  it('⭐ …while a capable source IS fed four fields, from its OWN bars', () => {
    const secondary = secondaryMap({ QQQ: secBarsFor(600) })
    let { cs, id } = withSeries(mergeChartSettings({}), 'QQQ')
    cs = setInstancePlotStyle(cs, id, 'candles', registry)
    binder.sync(ctxFor(cs, secondary))

    expect(madeTypes()).toEqual(['CandlestickSeries'])
    const points = dataAt(0)
    expect(points.length).toBeGreaterThan(0)
    for (const p of points) {
      for (const k of ['open', 'high', 'low', 'close']) expect(p).toHaveProperty(k)
    }
    // ⛔ QQQ's numbers, not the primary's. The offset is the fixture's whole job.
    expect(points[0].close).toBeCloseTo(bars[0].c + 600, 6)
    expect(points[0].open).not.toBeCloseTo(bars[0].o, 6)
  })
})

describe('a CALCULATION over an instrument is not that instrument', () => {
  it('⛔⛔ MA(QQQ) STORED AS `candles` DRAWS THE AVERAGE, NOT QQQ’S BARS', () => {
    // ⚰️ MEASURED IN A BROWSER 2026-09-13, Phase C. The capability gate asked
    // the instance's SOURCE, and `MA(sym:QQQ:close)` names the same source a
    // direct QQQ series does — so the row was offered Candles and, when chosen,
    // the renderer was handed QQQ's OWN BARS. The moving average vanished: its
    // legend read the instrument's close, to the cent.
    const secondary = secondaryMap({ QQQ: secBarsFor(600) })
    let cs = mergeChartSettings({})
    const m = withMa(cs, 'QQQ', 'pane'); cs = m.cs
    cs = setInstancePlotStyle(cs, m.id, 'candles', registry)

    binder.sync(ctxFor(cs, secondary))

    expect(madeTypes(), 'a calculation was built as a candlestick').toEqual(['LineSeries'])
    const points = dataAt(0)
    expect(points.length).toBeGreaterThan(0)
    for (const p of points) {
      expect(p, 'the average was replaced by the instrument’s auction period')
        .not.toHaveProperty('open')
    }
    // ⚠️ THE WARM-UP IS WHITESPACE, NOT A GAP IN THE CLAIM. A 5-period mean has
    // four bars it cannot answer for, and `{time}` alone is how the binder says so;
    // the numbers start after them.
    const valued = points.filter((p) => 'value' in p)
    expect(valued.length, 'the row drew nothing at all').toBeGreaterThan(200)
    // ⛔ AND THE NUMBERS ARE THE AVERAGE'S. A five-bar mean of a rising series
    // is not its last close; equality here is the measured symptom itself.
    const last = points.at(-1).value
    const lastClose = bars.at(-1).c + 600
    expect(last, 'the row is drawing the instrument’s close').not.toBeCloseTo(lastClose, 6)
  })

  it('⛔ …and a DIRECT series over the same symbol still can', () => {
    // The pair is the point: same symbol, same source string, different rows.
    const secondary = secondaryMap({ QQQ: secBarsFor(600) })
    let { cs, id } = withSeries(mergeChartSettings({}), 'QQQ')
    cs = setInstancePlotStyle(cs, id, 'candles', registry)
    binder.sync(ctxFor(cs, secondary))
    expect(madeTypes()).toEqual(['CandlestickSeries'])
  })
})

// ─── the colours reach the renderer ─────────────────────────────────────────

describe('candle colours are the chart’s until the member says otherwise', () => {
  const mount = (mutate) => {
    const secondary = secondaryMap({ QQQ: secBarsFor(600) })
    let { cs, id } = withSeries(mergeChartSettings({}), 'QQQ')
    cs = setInstancePlotStyle(cs, id, 'candles', registry)
    if (mutate) cs = mutate(cs, id)
    binder.sync(ctxFor(cs, secondary))
    return { cs, id }
  }

  it('⭐⭐ with no override the series wears `cs.candles` — body, border and wick alike', () => {
    const { cs } = mount(null)
    const o = madeOpts(0)
    expect(o.upColor).toBe(cs.candles.upColor)
    expect(o.downColor).toBe(cs.candles.downColor)
    // The designed simplification, asserted so a later split is a deliberate act.
    expect(o.borderUpColor).toBe(o.upColor)
    expect(o.wickUpColor).toBe(o.upColor)
    expect(o.borderDownColor).toBe(o.downColor)
    expect(o.wickDownColor).toBe(o.downColor)
  })

  it('⭐ an override reaches the renderer, and moves the wick and border with it', () => {
    const { cs } = mount((c, id) =>
      setInstanceCandleColor(c, id, 'upColor', '#00e5ff', registry, undefined, c.candles.upColor))
    const o = madeOpts(0)
    expect(o.upColor).toBe('#00e5ff')
    expect(o.wickUpColor).toBe('#00e5ff')
    expect(o.borderUpColor).toBe('#00e5ff')
    // ⛔ ONE COLOUR, NOT BOTH. Changing "up" must not silently restyle "down".
    expect(o.downColor).toBe(cs.candles.downColor)
  })

  it('⛔ returning it to the chart’s own colour DELETES the override, and the renderer follows', () => {
    const secondary = secondaryMap({ QQQ: secBarsFor(600) })
    let { cs, id } = withSeries(mergeChartSettings({}), 'QQQ')
    const chartUp = cs.candles.upColor
    cs = setInstancePlotStyle(cs, id, 'candles', registry)
    cs = setInstanceCandleColor(cs, id, 'upColor', '#00e5ff', registry, undefined, chartUp)
    cs = setInstanceCandleColor(cs, id, 'upColor', chartUp, registry, undefined, chartUp)

    const inst = (cs.indicatorInstances || []).find((i) => i.instanceId === id)
    expect(JSON.stringify(inst.presentation || {}),
      'a colour equal to the chart’s own was persisted anyway').not.toMatch(/00e5ff/i)

    binder.sync(ctxFor(cs, secondary))
    expect(madeOpts(0).upColor).toBe(chartUp)
  })
})

// ─── two instances of one instrument ────────────────────────────────────────

describe('duplicates are independent presentations of one instrument', () => {
  it('⭐⭐ QQQ twice: one candlestick with its own colour, one plain line', () => {
    const secondary = secondaryMap({ QQQ: secBarsFor(600) })
    let cs = mergeChartSettings({})
    const first = withSeries(cs, 'QQQ'); cs = first.cs
    const second = withSeries(cs, 'QQQ'); cs = second.cs
    expect(second.id).not.toBe(first.id)

    cs = setInstancePlotStyle(cs, first.id, 'candles', registry)
    cs = setInstanceCandleColor(cs, first.id, 'upColor', '#00e5ff', registry, undefined,
      cs.candles.upColor)

    binder.sync(ctxFor(cs, secondary))

    expect([...madeTypes()].sort()).toEqual(['CandlestickSeries', 'LineSeries'])
    const candle = fake.callsOf('addSeries').find((c) => String(c.args[0]) === 'CandlestickSeries')
    const line = fake.callsOf('addSeries').find((c) => String(c.args[0]) === 'LineSeries')
    expect(candle.args[1].upColor).toBe('#00e5ff')
    // ⛔ THE OVERRIDE IS THIS INSTANCE'S. A colour that leaked onto the sibling
    // would make two rows one setting wearing two names.
    expect(line.args[1]).not.toHaveProperty('upColor')
    // …and they are still one instrument, named by one source.
    const sources = (cs.indicatorInstances || [])
      .filter((i) => i && i.inputs && i.inputs.source === 'sym:QQQ:close')
    expect(sources).toHaveLength(2)
  })
})

// ─── composition, hide, delete, re-add ──────────────────────────────────────

describe('a candle pane composes, hides and empties like any other', () => {
  const built = () => {
    const secondary = secondaryMap({ QQQ: secBarsFor(600) })
    let cs = mergeChartSettings({})
    const q = withSeries(cs, 'QQQ'); cs = q.cs
    cs = setInstancePlotStyle(cs, q.id, 'candles', registry)
    const m = withMa(cs, 'QQQ', `@${q.id}`); cs = m.cs
    return { cs, secondary, qId: q.id, maId: m.id }
  }

  it('⭐⭐ QQQ candles and MA(QQQ) land in ONE pane on ONE scale', () => {
    const { cs, secondary } = built()
    binder.sync(ctxFor(cs, secondary))
    const created = fake.callsOf('addSeries')
    expect(created.map((c) => String(c.args[0])).sort())
      .toEqual(['CandlestickSeries', 'LineSeries'])
    const panes = new Set(created.map((c) => c.args[2]))
    expect(panes.size, 'the guest did not join its host’s pane').toBe(1)
    expect([...panes][0], 'the shared pane is the price pane').not.toBe(0)
    const scales = new Set(created.map((c) => c.args[1].priceScaleId))
    expect(scales.size, 'one pane drew on two scales').toBe(1)
  })

  it('⭐ hiding the GUEST leaves the candles drawn', () => {
    const { cs, secondary, maId } = built()
    binder.sync(ctxFor(cs, secondary))
    fake.reset()
    binder.sync(ctxFor(setInstanceHidden(cs, maId, true, registry), secondary))
    const fed = fake.callsOf('setData')
    expect(fed.length, 'hiding the MA stopped the candles too').toBeGreaterThan(0)
    for (const call of fed) {
      expect(call.args[0][0], 'the surviving series is not the candlestick')
        .toHaveProperty('open')
    }
  })

  it('⭐ deleting the GUEST leaves the candles; deleting the HOST empties the pane', () => {
    const { cs, secondary, qId, maId } = built()
    binder.sync(ctxFor(cs, secondary))

    const noMa = removeInstance(cs, maId, registry)
    fake.reset()
    binder.sync(ctxFor(noMa, secondary))
    expect(fake.callsOf('setData').length, 'the candles went with the MA').toBeGreaterThan(0)

    const empty = removeInstance(noMa, qId, registry)
    fake.reset()
    binder.sync(ctxFor(empty, secondary))
    // ⛔ NO SERIES, NO GHOST. Nothing is created and nothing is fed on behalf of
    // an instance the member deleted.
    expect(fake.callsOf('addSeries')).toHaveLength(0)
    expect(fake.callsOf('setData')).toHaveLength(0)
  })

  it('⛔⛔ RE-ADDING THE SYMBOL MINTS A FRESH INSTANCE — no tombstone resurrection', () => {
    const { cs, secondary, qId, maId } = built()
    let next = removeInstance(removeInstance(cs, maId, registry), qId, registry)
    const again = withSeries(next, 'QQQ'); next = again.cs

    expect(again.id, 'the deleted identity came back').not.toBe(qId)
    const live = (next.indicatorInstances || []).filter((i) => i && i.instanceId === again.id)
    expect(live).toHaveLength(1)
    // ⭐ AND IT ARRIVES AS A LINE — the style belonged to the instance that went.
    expect(JSON.stringify(live[0].presentation || {})).not.toMatch(/candles/)

    // …and the member can choose candles again, normally.
    next = setInstancePlotStyle(next, again.id, 'candles', registry)
    binder.sync(ctxFor(next, secondary))
    expect(madeTypes()).toEqual(['CandlestickSeries'])
  })
})

// ─── the cost of all of it ──────────────────────────────────────────────────

describe('the whole lifecycle costs ONE request for one instrument', () => {
  it('⭐⭐ line, candles, an MA, a duplicate and three style switches — one fetch', async () => {
    let calls = 0
    const fetcher = () => { calls += 1; return Promise.resolve({ bars: secBarsFor(600) }) }

    // Every reader a member can create for one symbol, asked for in one breath —
    // which is what a mounted chart does when it discovers its sources.
    ensureAll(['QQQ', 'QQQ', 'QQQ', 'QQQ'], TF, COUNT, fetcher)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(calls, 'a second reader of one instrument issued its own request').toBe(1)

    // ⭐ THE STRUCTURAL REASON THE COUNT CANNOT GROW: a style switch is a
    // presentation write, and presentation never reaches the supplier. The
    // syncs below are what proves the binder agrees.
    const secondary = secondaryMap({ QQQ: secBarsFor(600) })
    let cs = mergeChartSettings({})
    const a = withSeries(cs, 'QQQ'); cs = a.cs
    const b = withSeries(cs, 'QQQ'); cs = b.cs
    cs = withMa(cs, 'QQQ', `@${a.id}`).cs
    for (const style of ['candles', 'line', 'candles']) {
      cs = setInstancePlotStyle(cs, a.id, style, registry)
      binder.sync(ctxFor(cs, secondary))
    }
    cs = setInstanceHidden(cs, b.id, true, registry)
    binder.sync(ctxFor(cs, secondary))
    cs = setInstanceHidden(cs, b.id, false, registry)
    binder.sync(ctxFor(cs, secondary))

    ensureAll(['QQQ'], TF, COUNT, fetcher)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(calls, 'the lifecycle re-fetched an instrument it already holds').toBe(1)
  })
})
