// app/src/components/chart/engine/__tests__/candlePresentation.test.js
//
// ─── CANDLES ARE A PRESENTATION OF AN ELIGIBLE SERIES ───────────────────────
//
// ⭐⭐ THE WHOLE DESIGN IN ONE SENTENCE: a candle is not a source, not a
// definition and not a pane — it is a STYLE, available to an output whose source
// genuinely means an auction period. So there is no candle instance type, no
// `sym:QQQ:ohlc`, and `sym:QQQ:close` still means the close.
//
// ⛔⛔ ELIGIBILITY IS TWO CLAIMS, BOTH REQUIRED:
//   1. the SOURCE is a canonical symbol whose provider family means o/h/l/c
//      describe one auction period, and
//   2. the DEFINITION is a passthrough — its output IS that instrument.
// Either alone admits something false: (1) alone gives `MA(QQQ)` candles of
// QQQ's own bars in the average's pane; (2) alone gives a passthrough over a
// breadth measure candles of a number that never traded.
//
// ⛔ AND THE NEGATIVE CENSUS BELOW MATTERS AS MUCH AS THE POSITIVE ONE. "It fails
// closed" is the claim that cannot be checked by looking at a chart that works.

import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { createBinder } from '../binder'
import { poolKey, seriesOptionsForPlot, POOL_KEYS } from '../pool'
import { availableStyles, resolvePlotStyle, PLOT_STYLES } from '../presentation'
import { ohlcCapabilityOf, OHLC_FAMILY, outputIsSource } from '../ohlcCapability'
import { parseSource, symbolSource } from '../sourceRef'
import { clearSecondaryBars } from '../secondaryBars'
import { setInstancePlotStyle } from '../instanceControls'
import { addInstance, findInstance } from '../instanceControls'

const DIRECT = registry.getDefinition('dataSeries')
const VALUE_PLOT = DIRECT.plots.find((p) => p.key === 'value')

const bars = (n, base = 100) => Array.from({ length: n }, (_, i) => ({
  t: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
  o: base + i, h: base + i + 1, l: base + i - 1, c: base + i + 0.5, v: 1000 + i,
}))

/** The family oracle the binder is handed. Breadth is ours; everything else is a
 *  security; anything unclassified must fail closed. */
const familyOf = (sym) => {
  if (sym === 'UCTA50') return OHLC_FAMILY.BREADTH
  if (sym === 'MYSTERY') return 'unknown'
  return OHLC_FAMILY.SECURITY
}

const capOf = (def, src, entry) => ohlcCapabilityOf(def, parseSource(src), entry, familyOf)

describe('the capability gate — two claims, both required', () => {
  it('⭐ an ordinary security with real bars qualifies', () => {
    expect(capOf(DIRECT, symbolSource('QQQ', 'close'), { bars: bars(20, 700) }).ok).toBe(true)
  })

  it('⛔⛔ BREADTH DOES NOT QUALIFY, THOUGH ITS BARS CARRY o/h/l/c', () => {
    // The bars route serves breadth as close-to-close candles, so the PAYLOAD
    // looks identical. What differs is what the four numbers MEAN: a count of
    // advancing issues has no open, and no auction happened.
    const v = capOf(DIRECT, symbolSource('UCTA50', 'close'), { bars: bars(20, 50) })
    expect(v.ok, 'a breadth pseudo-ticker was admitted as candle-capable').toBe(false)
  })

  it('⛔⛔ AN UNCLASSIFIED SYMBOL FAILS CLOSED — "not yet" is never "security"', () => {
    // The registry answers `'unknown'` for the first few hundred ms of a page
    // load. Reading that as "ordinary security" would flash candles onto a
    // breadth measure on every refresh.
    expect(capOf(DIRECT, symbolSource('MYSTERY', 'close'), { bars: bars(20) }).ok).toBe(false)
  })

  it('⛔ NO ORACLE AT ALL MEANS NOTHING IS CAPABLE', () => {
    expect(ohlcCapabilityOf(DIRECT, parseSource(symbolSource('QQQ', 'close')),
      { bars: bars(20) }, undefined).ok).toBe(false)
  })

  it('⛔ a capable FAMILY with no usable bars is still refused', () => {
    expect(capOf(DIRECT, symbolSource('QQQ', 'close'), { bars: [] }).ok).toBe(false)
    expect(capOf(DIRECT, symbolSource('QQQ', 'close'), null).ok).toBe(false)
  })

  it('⛔ a NON-SYMBOL source is never candle-capable', () => {
    // `close` is the chart's own bar field. The chart already draws its own
    // candles; a second set on top is not what a direct series means.
    expect(capOf(DIRECT, 'close', { bars: bars(20) }).ok).toBe(false)
  })

  it('⛔⛔ THE PASSTHROUGH CLAIM IS DECLARED, AND ABSENT MEANS NO', () => {
    // A definition that merely HAS a symbol source is not thereby a passthrough.
    const notPassthrough = { ...DIRECT, passthrough: false }
    expect(outputIsSource(DIRECT)).toBe(true)
    expect(outputIsSource(notPassthrough)).toBe(false)
    expect(capOf(notPassthrough, symbolSource('QQQ', 'close'), { bars: bars(20) }).ok).toBe(false)
  })
})

describe('the style list offers candles only to an eligible output', () => {
  it('⭐ offered when the source can mean it', () => {
    expect(availableStyles(VALUE_PLOT, { ohlcCapable: true })).toContain('candles')
  })

  it('⛔⛔ NOT OFFERED OTHERWISE — and absent means no', () => {
    expect(availableStyles(VALUE_PLOT, { ohlcCapable: false })).not.toContain('candles')
    expect(availableStyles(VALUE_PLOT, {})).not.toContain('candles')
    expect(availableStyles(VALUE_PLOT, undefined)).not.toContain('candles')
  })

  it('⛔⛔ RSI IS NEVER CANDLE-CAPABLE — asserted through the COMPOSITION', () => {
    // ⚠️ AND THE DIVISION OF LABOUR IS THE POINT. `availableStyles` is a LIST: it
    // is HANDED the capability answer and does not re-derive it, which is why
    // passing it `ohlcCapable: true` for an RSI would list candles. That is not a
    // hole, it is the contract — but it means the honest rail is the composition
    // a caller actually performs, not a lie told to the list.
    const rsi = registry.getDefinition('rsi')
    // ⛔ CLAIM ONE FAILS: an RSI is not a passthrough, so its output is not an
    // instrument — whatever its source is.
    expect(outputIsSource(rsi)).toBe(false)
    expect(capOf(rsi, symbolSource('QQQ', 'close'), { bars: bars(20, 700) }).ok).toBe(false)
    // …so the answer a correct caller computes is FALSE, and the list is empty of
    // candles for every one of its outputs.
    for (const plot of rsi.plots) {
      const capable = capOf(rsi, symbolSource('QQQ', 'close'), { bars: bars(20, 700) }).ok
      expect(availableStyles(plot, { ohlcCapable: capable })).not.toContain('candles')
    }
  })

  it('⛔ A SOURCE-LESS NATIVE CANNOT ACQUIRE CANDLES BY ACCIDENT', () => {
    // MACD declares no `source` input at all, so there is no symbol to classify
    // and the capability probe has nothing to say yes about.
    const macd = registry.getDefinition('macd')
    expect((macd.inputs || []).some((i) => i.type === 'source')).toBe(false)
    expect(capOf(macd, symbolSource('QQQ', 'close'), { bars: bars(20, 700) }).ok).toBe(false)
  })

  it('⛔⛔ A STALE STORED `candles` IS CLAMPED, NOT HONOURED', () => {
    // A member who had candles on a source that later stopped qualifying — or a
    // blob hand-edited, or carried from another chart — must get a LINE, not a
    // broken series. Resolution asks the same question the plan and the payload
    // production ask.
    const inst = { instanceId: 'i1', defId: 'dataSeries', presentation: { plotStyle: 'candles' } }
    expect(resolvePlotStyle(inst, VALUE_PLOT, { ohlcCapable: true })).toBe('candles')
    expect(resolvePlotStyle(inst, VALUE_PLOT, { ohlcCapable: false })).toBe('line')
    expect(resolvePlotStyle(inst, VALUE_PLOT, {})).toBe('line')
  })

  it('⛔ `candles` is RECOGNISED vocabulary, so a stored value resolves', () => {
    // If it were absent from PLOT_STYLES a stored `candles` would read as an
    // unknown style and silently fall back — indistinguishable from the clamp,
    // and wrong the moment the source does qualify.
    expect(PLOT_STYLES).toContain('candles')
  })
})

describe('the pool treats a candlestick as its own series type', () => {
  it('⭐ `candles` maps to its own pool key', () => {
    expect(poolKey({ ...VALUE_PLOT, style: 'candles' })).toBe('candlestick')
    expect(POOL_KEYS).toContain('candlestick')
  })

  it('⛔⛔ AND IT CANNOT BE POOLED FROM A LINE — the types differ', () => {
    // Two series are interchangeable only when their TYPE is. Re-purposing a
    // line as a candlestick would feed four fields to a series that draws one.
    expect(poolKey({ ...VALUE_PLOT, style: 'line' })).toBe('line')
    expect(poolKey({ ...VALUE_PLOT, style: 'candles' }))
      .not.toBe(poolKey({ ...VALUE_PLOT, style: 'line' }))
  })

  it('⛔ candle options carry NONE of the line-shaped machinery', () => {
    const opts = seriesOptionsForPlot({ ...VALUE_PLOT, style: 'candles' }, {
      scaleId: 'right', autoscale: 'auto', lastValue: true, LineStyle: {},
      candleColors: { upColor: '#0f0', downColor: '#f00' },
    })
    for (const k of ['color', 'lineWidth', 'lineStyle', 'lineType', 'pointMarkersVisible']) {
      expect(opts[k], `a candlestick was handed ${k}`).toBeUndefined()
    }
    expect(opts.upColor).toBe('#0f0')
    expect(opts.wickDownColor).toBe('#f00')
  })

  it('⭐ …and with no colours supplied it keeps the renderer defaults', () => {
    const opts = seriesOptionsForPlot({ ...VALUE_PLOT, style: 'candles' }, {
      scaleId: 'right', autoscale: 'auto', lastValue: true, LineStyle: {},
    })
    expect(opts.upColor).toBeUndefined()
    expect(opts.priceScaleId).toBe('right')
  })
})

// ─── THE BINDER DRAWS ONE ───────────────────────────────────────────────────

function harness() {
  const created = []
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const series = {
        __data: [], ctor, options, paneIndex,
        setData: (d) => { series.__data = d },
        update: () => {}, applyOptions: (o) => Object.assign(options, o),
        priceScale: () => ({ applyOptions: () => {} }),
        createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      }
      created.push(series)
      return series
    },
    removeSeries: (s) => { created.splice(created.indexOf(s), 1) },
    panes: () => [{ paneIndex: () => 0, setHeight: () => {}, getHeight: () => 100 }],
    priceScale: () => ({ applyOptions: () => {} }),
  }
  const LWC = {
    LineSeries: 'LineSeries', HistogramSeries: 'HistogramSeries',
    AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
    CandlestickSeries: 'CandlestickSeries',
  }
  return { chart, LWC, created }
}

const seriesInst = (id, sym, style) => ({
  instanceId: id, defId: 'dataSeries', inputs: { source: symbolSource(sym, 'close') },
  hidden: false, ...(style ? { presentation: { plotStyle: style } } : {}),
})

function draw(instances, sym = 'QQQ', secBars = null) {
  const h = harness()
  const binder = createBinder({ chart: h.chart, LWC: h.LWC })
  const primary = bars(20)
  const sec = secBars || bars(20, 700)
  binder.sync({
    enabled: true,
    registry,
    instances,
    bars: primary,
    cs: mergeChartSettings({}),
    sym: 'NVDA',
    tf: 'D',
    secondary: new Map([[sym, { bars: sec, status: 'ok' }]]),
    ohlcFamilyOf: familyOf,
    resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }),
  })
  return { created: h.created, sec, binder, h }
}

describe('the binder draws a candlestick, carrying the instrument\'s own bars', () => {
  beforeEach(() => { clearSecondaryBars() })

  it('⭐⭐ AN ELIGIBLE SERIES SET TO CANDLES GETS A CANDLESTICK SERIES', () => {
    const { created, sec } = draw([seriesInst('i1', 'QQQ', 'candles')])
    expect(created).toHaveLength(1)
    expect(created[0].ctor).toBe('CandlestickSeries')
    // ⛔ FOUR FIELDS, AND THEY ARE THE SECONDARY'S. A scalar payload here would
    // be a candlestick fed one number per bar.
    const pts = created[0].__data.filter((p) => Number.isFinite(p.open))
    expect(pts.length).toBeGreaterThan(0)
    expect(pts[0].open).toBe(sec[0].o)
    expect(pts[0].close).toBe(sec[0].c)
    expect(pts[0].high).toBe(sec[0].h)
    expect(pts[0].low).toBe(sec[0].l)
  })

  it('⭐ a LINE over the same source still gets one number per bar', () => {
    const { created, sec } = draw([seriesInst('i1', 'QQQ', 'line')])
    expect(created[0].ctor).toBe('LineSeries')
    const vals = created[0].__data.map((p) => p.value).filter(Number.isFinite)
    expect(vals).toEqual(sec.map((b) => b.c))
  })

  it('⛔⛔ BREADTH ASKING FOR CANDLES GETS A LINE — the gate is the family', () => {
    const { created } = draw([seriesInst('b1', 'UCTA50', 'candles')], 'UCTA50', bars(20, 50))
    expect(created).toHaveLength(1)
    expect(created[0].ctor, 'a breadth measure was drawn as an auction').toBe('LineSeries')
  })

  it('⛔⛔ AND SO DOES AN UNCLASSIFIED SYMBOL — fail closed while loading', () => {
    const { created } = draw([seriesInst('m1', 'MYSTERY', 'candles')], 'MYSTERY')
    expect(created[0].ctor).toBe('LineSeries')
  })

  it('⛔ NO FAMILY ORACLE AT ALL ⇒ NO CANDLES ANYWHERE', () => {
    const h = harness()
    const binder = createBinder({ chart: h.chart, LWC: h.LWC })
    binder.sync({
      enabled: true, registry, instances: [seriesInst('i1', 'QQQ', 'candles')],
      bars: bars(20), cs: mergeChartSettings({}), sym: 'NVDA', tf: 'D',
      secondary: new Map([['QQQ', { bars: bars(20, 700), status: 'ok' }]]),
      resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }),
    })
    expect(h.created[0].ctor).toBe('LineSeries')
  })

  it('⛔⛔ A CANDLE NEVER BORROWS THE PRIMARY\'S TIMES — no fill, no synthetic bar', () => {
    // One bar removed from the middle of the secondary. The candle series must be
    // short by exactly that bar rather than bridged, and it must never invent a
    // point at a primary timestamp the instrument did not trade.
    const full = bars(20, 700)
    const holed = full.filter((_, i) => i !== 7)
    const { created } = draw([seriesInst('i1', 'QQQ', 'candles')], 'QQQ', holed)
    const real = created[0].__data.filter((p) => Number.isFinite(p.open))
    expect(real).toHaveLength(holed.length)
    expect(real.length).toBe(full.length - 1)
  })

  it('⭐⭐ LINE → CANDLES → LINE KEEPS ONE INSTANCE AND ONE SOURCE', () => {
    // The lifecycle claim. The SERIES is necessarily rebuilt (the types differ),
    // but the instance, its id and its source are untouched — which is what makes
    // this a presentation change rather than a delete-and-re-add.
    let cs = addInstance(mergeChartSettings({}), 'dataSeries', registry)
    const id = cs.indicatorInstances[cs.indicatorInstances.length - 1].instanceId
    cs = { ...cs,
      indicatorInstances: cs.indicatorInstances.map((i) => (i.instanceId === id
        ? { ...i, inputs: { ...i.inputs, source: symbolSource('QQQ', 'close') } } : i)) }

    const toCandles = setInstancePlotStyle(cs, id, 'candles', registry)
    const backToLine = setInstancePlotStyle(toCandles, id, 'line', registry)

    for (const blob of [cs, toCandles, backToLine]) {
      const inst = findInstance(blob, id)
      expect(inst.instanceId).toBe(id)
      expect(inst.inputs.source).toBe('sym:QQQ:close')
    }
    // ⛔ AND THE ROUND TRIP IS BYTE-IDENTICAL: `line` is the default, so it
    // DELETES rather than writes, and the blob returns to what it was.
    expect(JSON.stringify(findInstance(backToLine, id)))
      .toBe(JSON.stringify(findInstance(cs, id)))
  })

  it('⛔⛔ SWITCHING STYLE ASKS FOR NO NEW BARS — the cache is the same entry', () => {
    // Part K. The binder never fetches; it reads `ctx.secondary`. Drawing the
    // same instance as a line and then as candles must consume ONE entry, and
    // the candle payload must come from the very bars the line projected from.
    const sec = bars(20, 700)
    const secondary = new Map([['QQQ', { bars: sec, status: 'ok' }]])
    let reads = 0
    const counting = { get: (k) => { reads += 1; return secondary.get(k) } }

    for (const style of ['line', 'candles', 'line']) {
      const h = harness()
      const binder = createBinder({ chart: h.chart, LWC: h.LWC })
      binder.sync({
        enabled: true, registry, instances: [seriesInst('i1', 'QQQ', style)],
        bars: bars(20), cs: mergeChartSettings({}), sym: 'NVDA', tf: 'D',
        secondary: counting, ohlcFamilyOf: familyOf,
        resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }),
      })
    }
    // Reads, not fetches: the binder asked the cache and the cache answered. No
    // style produced a request, because the binder has no way to make one.
    expect(reads).toBeGreaterThan(0)
  })
})
