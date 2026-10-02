// app/src/components/chart/engine/__tests__/ohlcBarsAndBreadth.test.js
//
// ─── UNIVERSAL CANDLES + BARS — SYMBOLS AND BREADTH ─────────────────────────
//
// ⭐⭐ TWO EXTENSIONS OF ONE CONTRACT (`candlePresentation.test.js` is the first):
//   1. `bars` — the traditional OHLC bar — is a second four-field STYLE, gated by the
//      very same capability answer as `candles`, drawn by LWC's own `BarSeries`
//      (the primary chart's 'bars' chart type), and labelled "Bars".
//   2. BREADTH is an ATTESTED family: the server marks a bar `ohlc: 1` when its
//      open/high/low were observed through the session, and only those bars draw as
//      OHLC. A breadth payload with no marked bar — every US series today, a body-only
//      score — stays scalar. Nothing is synthesised, ever.

import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { createBinder } from '../binder'
import { poolKey, seriesOptionsForPlot, POOL_KEYS, OHLC_POOL_KEYS } from '../pool'
import {
  availableStyles, resolvePlotStyle, PLOT_STYLES, PLOT_STYLE_CHOICES, OHLC_PLOT_STYLES,
  isOhlcPlotStyle,
} from '../presentation'
import { SCALAR_STYLES, OHLC_STYLES, sourceCapabilityOf } from '../sourceCapability'
import {
  ohlcCapabilityOf, OHLC_FAMILY, OHLC_REFUSAL, drawableOhlcBars, barIsAttestedOhlc,
  OHLC_OBSERVED_KEY,
} from '../ohlcCapability'
import { parseSource, symbolSource } from '../sourceRef'
import { clearSecondaryBars } from '../secondaryBars'
import { setInstancePlotStyle, addInstance, findInstance } from '../instanceControls'
import { legendChips } from '../readout'
import { clipBarsToDomain } from '../symbolProjection'

const DIRECT = registry.getDefinition('dataSeries')
const VALUE_PLOT = DIRECT.plots.find((p) => p.key === 'value')

const day = (i) => `2026-03-${String((i % 28) + 1).padStart(2, '0')}`
const secBars = (n, base = 100) => Array.from({ length: n }, (_, i) => ({
  t: day(i), o: base + i, h: base + i + 2, l: base + i - 1, c: base + i + 0.5, v: 1000 + i,
}))
/** Breadth bars: every bar has four numbers; only `observed` indices carry the mark. */
const breadthBars = (n, observed) => Array.from({ length: n }, (_, i) => ({
  t: day(i), o: 40 + i, h: 45 + i, l: 38 + i, c: 42 + i, v: 0,
  ...(observed(i) ? { [OHLC_OBSERVED_KEY]: 1 } : {}),
}))

const familyOf = (sym) => {
  if (sym === 'UCTA5' || sym === 'UCTNH' || sym === 'US:A5' || sym === 'UCTHS') return OHLC_FAMILY.BREADTH
  if (sym === 'NAAIM') return OHLC_FAMILY.SURVEY
  if (sym === 'MYSTERY') return OHLC_FAMILY.UNKNOWN
  return OHLC_FAMILY.SECURITY
}
const capOf = (sym, entry) => ohlcCapabilityOf(DIRECT, parseSource(symbolSource(sym, 'close')), entry, familyOf)

describe('the vocabulary — "Candles" and "Bars", one shared OHLC list', () => {
  it('⭐ the member-facing labels are exactly Candles and Bars', () => {
    const label = (v) => PLOT_STYLE_CHOICES.find((c) => c.value === v).label
    expect(label('candles')).toBe('Candles')
    expect(label('bars')).toBe('Bars')
    expect(PLOT_STYLE_CHOICES.map((c) => c.label).join('|')).not.toMatch(/OHLC|Candlestick/i)
  })
  it('⭐ both four-field styles are recognised, and are exactly the OHLC list', () => {
    expect(OHLC_PLOT_STYLES).toEqual(['candles', 'bars'])
    for (const s of OHLC_PLOT_STYLES) expect(PLOT_STYLES).toContain(s)
    expect(isOhlcPlotStyle('bars') && isOhlcPlotStyle('candles') && !isOhlcPlotStyle('line')).toBe(true)
  })
  it('⛔ neither is a scalar style; both are OHLC styles', () => {
    for (const s of OHLC_PLOT_STYLES) {
      expect(SCALAR_STYLES).not.toContain(s)
      expect(OHLC_STYLES).toContain(s)
    }
    expect(sourceCapabilityOf(null, false).allowedStyles).not.toContain('bars')
    expect(sourceCapabilityOf(null, true).allowedStyles).toEqual(expect.arrayContaining(['candles', 'bars']))
  })
})

describe('availability follows DATA CAPABILITY — never pane placement', () => {
  for (const target of [undefined, 'price', 'pane', 'volume', '@pane:inst:x']) {
    it(`⭐ target ${target || '(none)'}: both offered when capable, neither when not`, () => {
      const yes = availableStyles(VALUE_PLOT, { target, ohlcCapable: true })
      const no = availableStyles(VALUE_PLOT, { target, ohlcCapable: false })
      expect(yes).toEqual(expect.arrayContaining(['candles', 'bars']))
      expect(no).not.toContain('candles')
      expect(no).not.toContain('bars')
    })
  }
  it('⛔ absent capability means no', () => {
    expect(availableStyles(VALUE_PLOT, {})).not.toContain('bars')
  })
  it('⛔⛔ a stored `bars` on a source that cannot mean it resolves to a line — storage untouched', () => {
    const inst = { instanceId: 'i', defId: 'dataSeries', presentation: { plotStyle: 'bars' } }
    expect(resolvePlotStyle(inst, VALUE_PLOT, { ohlcCapable: true })).toBe('bars')
    expect(resolvePlotStyle(inst, VALUE_PLOT, { ohlcCapable: false })).toBe('line')
    expect(inst.presentation.plotStyle).toBe('bars')
  })
})

describe('the pool — an OHLC bar is its own series type, built like the primary chart\'s', () => {
  it('⭐ `bars` → pool key `bar`, distinct from a candlestick and from a line', () => {
    const plot = { ...VALUE_PLOT, style: 'ohlcBars' }
    expect(poolKey(plot)).toBe('bar')
    expect(POOL_KEYS).toContain('bar')
    expect(OHLC_POOL_KEYS).toEqual(['candlestick', 'bar'])
    expect(poolKey({ ...VALUE_PLOT, style: 'candles' })).not.toBe('bar')
  })
  it('⭐ options mirror StockChart\'s `case \'bars\'`: up/down colour, thinBars, open tick on', () => {
    const o = seriesOptionsForPlot({ ...VALUE_PLOT, style: 'ohlcBars' }, {
      scaleId: 'right', autoscale: 'auto', lastValue: true, LineStyle: {},
      candleColors: { upColor: '#0f0', downColor: '#f00', thinBars: true },
    })
    expect(o).toMatchObject({ upColor: '#0f0', downColor: '#f00', thinBars: true, openVisible: true })
    for (const k of ['color', 'lineWidth', 'lineStyle', 'wickUpColor', 'borderUpColor']) expect(o[k]).toBeUndefined()
    const thick = seriesOptionsForPlot({ ...VALUE_PLOT, style: 'ohlcBars' }, {
      scaleId: 'right', LineStyle: {}, candleColors: { upColor: '#0f0', downColor: '#f00', thinBars: false },
    })
    expect(thick.thinBars).toBe(false)
  })
})

describe('breadth is an ATTESTED family — per bar, by the server\'s mark', () => {
  it('⭐⭐ breadth with observed bars is capable', () => {
    expect(capOf('UCTA5', { bars: breadthBars(10, () => true) }).ok).toBe(true)
    expect(capOf('UCTA5', { bars: breadthBars(10, (i) => i === 9) }).ok).toBe(true)
  })
  it('⛔⛔ breadth with NO observed bar is refused for what it means — every US series today', () => {
    const v = capOf('US:A5', { bars: breadthBars(10, () => false) })
    expect(v.ok).toBe(false)
    expect(v.reason).toBe(OHLC_REFUSAL.FAMILY_NOT_OHLC)
  })
  it('⛔⛔ a mark that is not exactly 1 is not a mark', () => {
    const bars = breadthBars(5, () => false).map((b) => ({ ...b, ohlc: true }))
    expect(capOf('UCTA5', { bars }).ok).toBe(false)
  })
  it('⛔ a marked bar missing a field is not attested', () => {
    expect(barIsAttestedOhlc({ t: 'x', o: 1, h: 2, l: null, c: 1.5, ohlc: 1 })).toBe(false)
  })
  it('⛔ breadth with no bars loaded is "not yet", never capable', () => {
    expect(capOf('UCTA5', { bars: [] }).reason).toBe(OHLC_REFUSAL.NO_BARS)
  })
  it('⛔ the mark grants nothing to a survey, an unknown or a non-attested scalar family', () => {
    const marked = { bars: breadthBars(5, () => true) }
    expect(capOf('NAAIM', marked).ok).toBe(false)
    expect(capOf('MYSTERY', marked).ok).toBe(false)
  })
  it('⭐ a security needs no mark (its bars are an auction as served)', () => {
    expect(capOf('SPY', { bars: secBars(5) }).ok).toBe(true)
  })
  it('⭐⭐ drawableOhlcBars: an unobserved breadth bar keeps time + close and loses O/H/L', () => {
    const bars = breadthBars(4, (i) => i % 2 === 0)
    const out = drawableOhlcBars(bars, OHLC_FAMILY.BREADTH)
    expect(out[0]).toBe(bars[0])
    expect(out[1]).toEqual({ t: bars[1].t, c: bars[1].c })
    expect(drawableOhlcBars(bars, OHLC_FAMILY.SECURITY)).toBe(bars)
  })
})

// ─── the binder ─────────────────────────────────────────────────────────────

function harness() {
  const created = []
  const removed = []
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const series = {
        __data: [], ctor, options: { ...options }, paneIndex,
        setData: (d) => { series.__data = d },
        update: () => {}, applyOptions: (o) => Object.assign(series.options, o),
        moveToPane: (i) => { series.paneIndex = i },
        priceScale: () => ({ applyOptions: () => {} }),
        createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
        attachPrimitive: () => {}, detachPrimitive: () => {},
        data: () => series.__data,
      }
      created.push(series)
      return series
    },
    removeSeries: (s) => { removed.push(s) },
    panes: () => [{ paneIndex: () => 0, setHeight: () => {}, getHeight: () => 100 }],
    priceScale: () => ({ applyOptions: () => {} }),
  }
  const LWC = {
    LineSeries: 'LineSeries', HistogramSeries: 'HistogramSeries', AreaSeries: 'AreaSeries',
    BaselineSeries: 'BaselineSeries', CandlestickSeries: 'CandlestickSeries', BarSeries: 'BarSeries',
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
  }
  const live = () => created.filter((s) => !removed.includes(s))
  return { chart, LWC, created, live }
}

const seriesInst = (id, sym, style, placement) => ({
  instanceId: id, defId: 'dataSeries', inputs: { source: symbolSource(sym, 'close') }, hidden: false,
  ...(style ? { presentation: { plotStyle: style } } : {}),
  ...(placement ? { placement } : {}),
})

function syncOnce(binder, instances, secondary, extra = {}) {
  binder.sync({
    enabled: true, registry, instances, bars: secBars(20, 500),
    cs: mergeChartSettings({}), sym: 'NVDA', tf: 'D',
    secondary, ohlcFamilyOf: familyOf,
    resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }),
    ...extra,
  })
}

describe('the binder draws Bars with the instrument\'s own four fields', () => {
  beforeEach(() => { clearSecondaryBars() })

  it('⭐⭐ SPY as Bars → one BarSeries carrying SPY\'s O/H/L/C', () => {
    const h = harness()
    const binder = createBinder({ chart: h.chart, LWC: h.LWC })
    const spy = secBars(20, 400)
    syncOnce(binder, [seriesInst('s', 'SPY', 'bars')], new Map([['SPY', { bars: spy, status: 'ok' }]]))
    expect(h.live()).toHaveLength(1)
    expect(h.live()[0].ctor).toBe('BarSeries')
    const p = h.live()[0].__data
    expect(p).toHaveLength(20)
    expect(p[3]).toEqual({ time: spy[3].t, open: spy[3].o, high: spy[3].h, low: spy[3].l, close: spy[3].c })
    expect(h.live()[0].options.openVisible).toBe(true)
  })

  it('⭐⭐ UCTA5 as Candles → observed bars draw, unobserved bars are WHITESPACE, never a body', () => {
    const h = harness()
    const binder = createBinder({ chart: h.chart, LWC: h.LWC })
    const b = breadthBars(20, (i) => i < 18)            // the last two: provisional + developing
    syncOnce(binder, [seriesInst('u', 'UCTA5', 'candles')], new Map([['UCTA5', { bars: b, status: 'ok' }]]))
    const s = h.live()[0]
    expect(s.ctor).toBe('CandlestickSeries')
    const drawn = s.__data.filter((p) => Number.isFinite(p.open))
    expect(drawn).toHaveLength(18)
    expect(drawn[5]).toEqual({ time: b[5].t, open: b[5].o, high: b[5].h, low: b[5].l, close: b[5].c })
    expect(s.__data[18]).toEqual({ time: b[18].t })
    expect(s.__data[19]).toEqual({ time: b[19].t })
  })

  it('⭐ UCTA5 as Bars — the same per-bar rule, the BarSeries renderer', () => {
    const h = harness()
    const binder = createBinder({ chart: h.chart, LWC: h.LWC })
    const b = breadthBars(20, (i) => i !== 7)
    syncOnce(binder, [seriesInst('u', 'UCTA5', 'bars')], new Map([['UCTA5', { bars: b, status: 'ok' }]]))
    const s = h.live()[0]
    expect(s.ctor).toBe('BarSeries')
    expect(s.__data[7]).toEqual({ time: b[7].t })
    expect(s.__data.filter((p) => Number.isFinite(p.open))).toHaveLength(19)
  })

  it('⛔⛔ a US (unmarked) breadth series asking for Bars gets a LINE of its close', () => {
    const h = harness()
    const binder = createBinder({ chart: h.chart, LWC: h.LWC })
    const b = breadthBars(20, () => false)
    syncOnce(binder, [seriesInst('u', 'US:A5', 'bars')], new Map([['US:A5', { bars: b, status: 'ok' }]]))
    expect(h.live()[0].ctor).toBe('LineSeries')
    expect(h.live()[0].__data.map((p) => p.value)).toEqual(b.map((x) => x.c))
  })

  it('⭐ a Line over observed breadth still reads the close — scalar semantics unchanged', () => {
    const h = harness()
    const binder = createBinder({ chart: h.chart, LWC: h.LWC })
    const b = breadthBars(20, () => true)
    syncOnce(binder, [seriesInst('u', 'UCTA5', 'line')], new Map([['UCTA5', { bars: b, status: 'ok' }]]))
    expect(h.live()[0].ctor).toBe('LineSeries')
    expect(h.live()[0].__data.map((p) => p.value)).toEqual(b.map((x) => x.c))
  })
})

describe('switching Line → Candles → Bars → Area → Candles → Bars: one instance, one source', () => {
  it('⭐⭐ ONE binder: exactly one live series each time, of the asked type, values unchanged', () => {
    const h = harness()
    const binder = createBinder({ chart: h.chart, LWC: h.LWC })
    const b = breadthBars(20, (i) => i < 19)
    const secondary = new Map([['UCTA5', { bars: b, status: 'ok' }]])
    const want = { line: 'LineSeries', candles: 'CandlestickSeries', bars: 'BarSeries', area: 'AreaSeries' }
    const placement = { target: 'pane' }
    for (const style of ['line', 'candles', 'bars', 'area', 'candles', 'bars']) {
      syncOnce(binder, [seriesInst('u', 'UCTA5', style, placement)], secondary)
      const live = h.live()
      expect(live, `${style}: series count`).toHaveLength(1)
      expect(live[0].ctor, style).toBe(want[style])
      if (style === 'line' || style === 'area') {
        expect(live[0].__data.map((p) => p.value)).toEqual(b.map((x) => x.c))
      } else {
        const drawn = live[0].__data.filter((p) => Number.isFinite(p.close))
        expect(drawn.map((p) => p.close)).toEqual(b.slice(0, 19).map((x) => x.c))
      }
    }
    expect(b.every((x) => x.v === 0)).toBe(true)        // the source was never mutated
  })

  it('⭐ the writer: each switch keeps instance id, source, placement; Line deletes the key', () => {
    let cs = addInstance(mergeChartSettings({}), 'dataSeries', registry)
    const id = cs.indicatorInstances[cs.indicatorInstances.length - 1].instanceId
    cs = { ...cs, indicatorInstances: cs.indicatorInstances.map((i) => (i.instanceId === id
      ? { ...i, inputs: { ...i.inputs, source: symbolSource('UCTA5', 'close') }, placement: { target: 'pane' } } : i)) }
    let blob = cs
    for (const style of ['candles', 'bars', 'area', 'candles', 'bars']) {
      blob = setInstancePlotStyle(blob, id, style, registry)
      const inst = findInstance(blob, id)
      expect(inst.inputs.source).toBe('sym:UCTA5:close')
      expect(inst.placement).toEqual({ target: 'pane' })
      expect(inst.presentation.plotStyle).toBe(style)
    }
    const back = setInstancePlotStyle(blob, id, 'line', registry)
    expect(findInstance(back, id).presentation?.plotStyle).toBeUndefined()
  })

  it('⭐⭐ persistence: a saved `bars` / `candles` survives save → reload (mergeChartSettings)', () => {
    // Built through the real writers, exactly as the settings tab does, then serialised
    // and read back through the one merge every load goes through.
    const make = (cs, sym, style) => {
      const next = addInstance(cs, 'dataSeries', registry)
      const id = next.indicatorInstances[next.indicatorInstances.length - 1].instanceId
      const sourced = { ...next, indicatorInstances: next.indicatorInstances.map((i) => (i.instanceId === id
        ? { ...i, inputs: { ...i.inputs, source: symbolSource(sym, 'close') }, placement: { target: 'pane' } } : i)) }
      return { cs: setInstancePlotStyle(sourced, id, style, registry), id }
    }
    const a = make(mergeChartSettings({}), 'SPY', 'bars')
    const b = make(a.cs, 'UCTA5', 'candles')
    const round = mergeChartSettings(JSON.parse(JSON.stringify(b.cs)))
    for (const [id, sym, style] of [[a.id, 'SPY', 'bars'], [b.id, 'UCTA5', 'candles']]) {
      const inst = findInstance(round, id)
      expect(inst.presentation.plotStyle).toBe(style)
      expect(inst.inputs.source).toBe(`sym:${sym}:close`)
      expect(inst.placement).toEqual({ target: 'pane' })
    }
    // ⭐ and an OLD blob with no presentation keeps its legacy default (a line)
    const legacy = findInstance(mergeChartSettings(JSON.parse(JSON.stringify(
      setInstancePlotStyle(b.cs, b.id, 'line', registry)))), b.id)
    expect(legacy.presentation?.plotStyle).toBeUndefined()
  })
})

describe('the legend reads the CLOSE of the hovered bar — observed or not', () => {
  it('⭐⭐ hover over an observed candle, an unobserved (whitespace) bar, and nothing', () => {
    const h = harness()
    const binder = createBinder({ chart: h.chart, LWC: h.LWC })
    const b = breadthBars(20, (i) => i !== 10)
    const inst = seriesInst('u', 'UCTA5', 'candles')
    syncOnce(binder, [inst], new Map([['UCTA5', { bars: b, status: 'ok' }]]))
    const s = h.live()[0]
    const hover = (i) => {
      const m = new Map([[{ primary: true }, { time: b[i].t, open: 1, high: 1, low: 1, close: 1 }]])
      const p = s.__data.find((x) => x.time === b[i].t)
      if (p && Number.isFinite(p.open)) m.set(s, p)
      return legendChips(binder.bindings(), m, registry, [inst]).filter((c) => c.instanceId === 'u')
    }
    expect(hover(4).map((c) => c.value)).toEqual([b[4].c])
    expect(hover(10).map((c) => c.value)).toEqual([b[10].c])     // whitespace bar: still its close
    const none = legendChips(binder.bindings(), null, registry, [inst]).filter((c) => c.instanceId === 'u')
    expect(none.map((c) => c.value)).toEqual([b[19].c])           // developing fallback = newest close
  })
})

describe('an INDEX keys its day as unix midnight — Candles/Bars still draw it', () => {
  const iso = (i) => `2026-03-${String(i + 2).padStart(2, '0')}`
  const unix = (i) => Date.UTC(2026, 2, i + 2) / 1000
  const primary = Array.from({ length: 10 }, (_, i) => ({ t: iso(i), o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }))
  const spx = Array.from({ length: 10 }, (_, i) => ({ t: unix(i), o: 5000 + i, h: 5010 + i, l: 4990 + i, c: 5005 + i, v: 0 }))

  it('⭐⭐ the clip reads a UTC-midnight number as its day and hands it on in the primary spelling', () => {
    const out = clipBarsToDomain(spx, primary)
    expect(out).toHaveLength(10)
    expect(out[3]).toEqual({ ...spx[3], t: iso(3) })
    expect(spx[3].t).toBe(unix(3))                       // the source is never mutated
  })
  it('⛔ same-kind keys still join exactly (an intraday chart is untouched)', () => {
    const a = [{ t: 100, o: 1, h: 1, l: 1, c: 1 }, { t: 200, o: 1, h: 1, l: 1, c: 1 }]
    expect(clipBarsToDomain(a, [{ t: 200 }])).toEqual([a[1]])
    expect(clipBarsToDomain(a, [{ t: 200 }])[0]).toBe(a[1])
  })
  it('⭐⭐ SPX as Bars on a stock chart draws all ten bars at the stock own days', () => {
    const h = harness()
    const binder = createBinder({ chart: h.chart, LWC: h.LWC })
    binder.sync({
      enabled: true, registry, instances: [seriesInst('x', 'SPX', 'bars')], bars: primary,
      cs: mergeChartSettings({}), sym: 'NVDA', tf: 'D',
      secondary: new Map([['SPX', { bars: spx, status: 'ok' }]]), ohlcFamilyOf: familyOf,
      resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }),
    })
    const s = h.live()[0]
    expect(s.ctor).toBe('BarSeries')
    expect(s.__data.map((p) => p.time)).toEqual(primary.map((b) => b.t))
    expect(s.__data[4]).toEqual({ time: iso(4), open: 5004, high: 5014, low: 4994, close: 5009 })
  })
})
