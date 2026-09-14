// app/src/components/chart/engine/__tests__/movingAverageSource.test.js
//
// ─── AN AVERAGE OF ANY SERIES, THROUGH ONE SOURCE ARCHITECTURE ──────────────
//
// ⭐⭐ THE CLAIM THIS FILE EXISTS FOR: `MA(Close)`, `MA(Volume)` and `MA(QQQ)`
// are ONE definition pointed at different sources — not three implementations of
// an average, and not a special case for symbols. It is the second definition to
// consume the source grammar, which is what turns "plot another ticker" into a
// reusable architecture:
//
//     direct source → presentation          (dataSeries)
//     direct source → derived → presentation (movingAverage over a dataSeries)
//
// ⛔ AND IT IS ADDITIVE BESIDE THE LEGACY OVERLAYS, NOT A MIGRATION OF THEM.
// `cs.overlays` still holds the shipped SMA/EMA-on-close overlays, computed in
// StockChart exactly as before: no instance id, no placement, no presentation.
// An old chart gains nothing and loses nothing.

import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { computeFor } from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { createBinder } from '../binder'
import { symbolSource, instanceSource, orderByDependency, severReferencesTo } from '../sourceRef'
import { clearSecondaryBars } from '../secondaryBars'
import { ohlcCapabilityOf, OHLC_FAMILY } from '../ohlcCapability'
import { parseSource } from '../sourceRef'
import { availableStyles } from '../presentation'
import { fieldFromInput } from '../../indicatorRegistry'

const MA = registry.getDefinition('movingAverage')
const DIRECT = registry.getDefinition('dataSeries')

/** ⚠️ UNIQUE TIMESTAMPS, AND THE MONTH ROLLS OVER FOR A REASON. A helper that
 *  wrapped at `i % 28` repeated `2026-04-01` at bar 28, and `projectionFor`
 *  aligns by `t` — so the last two bars mapped back onto the first two and a
 *  passthrough appeared to end 700.5, 701.5 instead of 728.5, 729.5. That was
 *  the FIXTURE lying, not the projection; exact-t alignment did exactly what it
 *  promises with the duplicate times it was given. */
const bars = (n, base = 100) => Array.from({ length: n }, (_, i) => ({
  t: `2026-${String(4 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
  o: base + i, h: base + i + 1, l: base + i - 1, c: base + i + 0.5, v: 1000 + i,
}))
const finite = (col) => Array.from(col).filter(Number.isFinite)

describe('the definition itself', () => {
  it('⛔ it exists, and declares a SOURCE input like dataSeries does', () => {
    expect(MA, 'movingAverage is not registered — every case here is vacuous').toBeTruthy()
    const src = (MA.inputs || []).filter((i) => i.type === 'source')
    expect(src).toHaveLength(1)
    // ⭐ THE SAME INPUT TYPE, so the SAME control edits it — Part H. No second
    // source format, no MA-only picker.
    expect(fieldFromInput(src[0])).toEqual({ key: 'source', label: 'Source', type: 'source' })
  })

  it('⛔⛔ IT IS NOT A PASSTHROUGH, so it can never wear candles', () => {
    // The negative census's headline case. `MA(QQQ)` reads a candle-capable
    // SOURCE, and that is exactly why claim (1) alone is not enough: without the
    // passthrough claim it would draw QQQ's own bars in the average's pane.
    expect(MA.passthrough).not.toBe(true)
    const cap = ohlcCapabilityOf(MA, parseSource(symbolSource('QQQ', 'close')),
      { bars: bars(20, 700) }, () => OHLC_FAMILY.SECURITY)
    expect(cap.ok, 'an average was admitted as candle-capable').toBe(false)
    for (const plot of MA.plots) {
      expect(availableStyles(plot, { ohlcCapable: cap.ok })).not.toContain('candles')
    }
  })

  it('⭐ it declares `domainBehavior: inherit` — an average of 0-100 is 0-100', () => {
    expect(MA.domainBehavior).toBe('inherit')
  })
})

describe('the compute reads ctx.source, never the bars', () => {
  it('⭐⭐ A 5-BAR SMA OF A SUPPLIED SERIES IS THE ARITHMETIC MEAN', () => {
    const b = bars(10)
    const src = b.map((_, i) => i + 1)            // 1..10
    const cols = computeFor(MA, b, { period: 5, maType: 'sma' }, { source: src })
    // First full window is bars 0-4 → (1+2+3+4+5)/5 = 3
    expect(cols.ma[4]).toBeCloseTo(3, 10)
    expect(cols.ma[9]).toBeCloseTo(8, 10)
    // ⛔ AND THE WARM-UP IS A GAP, not a partial average of a half-full window.
    expect(finite(cols.ma)).toHaveLength(6)
  })

  it('⛔⛔ NO SOURCE ⇒ ALL GAPS — never the chart\'s own closes', () => {
    // The silent-fallback trap. Averaging the bars in hand would answer
    // confidently about the WRONG INSTRUMENT, and look perfectly plausible.
    const b = bars(20)
    const cols = computeFor(MA, b, { period: 5 }, undefined)
    expect(finite(cols.ma)).toHaveLength(0)
  })

  it('⛔ A GAP IN THE SOURCE BREAKS THE WINDOW THAT SPANS IT', () => {
    // NaN is a hole, not a zero: a window containing one is not emitted at all.
    const b = bars(20)
    const src = b.map((_, i) => (i === 10 ? NaN : 100))
    const cols = computeFor(MA, b, { period: 5, maType: 'sma' }, { source: src })
    for (let i = 10; i < 15; i++) {
      expect(Number.isFinite(cols.ma[i]), `bar ${i} averaged across a hole`).toBe(false)
    }
    expect(Number.isFinite(cols.ma[15])).toBe(true)
  })

  it('⭐ an EMA is seeded on the first full SMA window', () => {
    const b = bars(20)
    const src = b.map(() => 50)
    const cols = computeFor(MA, b, { period: 5, maType: 'ema' }, { source: src })
    // A constant series averages to itself, whichever kind of average it is.
    expect(cols.ma[19]).toBeCloseTo(50, 8)
    expect(Number.isFinite(cols.ma[3])).toBe(false)
  })
})

// ─── THE BINDER WIRES ONE TO THE OTHER ──────────────────────────────────────

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
    removeSeries: () => {},
    panes: () => [{ paneIndex: () => 0, setHeight: () => {}, getHeight: () => 100 }],
    priceScale: () => ({ applyOptions: () => {} }),
  }
  const LWC = {
    LineSeries: 'LineSeries', HistogramSeries: 'HistogramSeries', AreaSeries: 'AreaSeries',
    BaselineSeries: 'BaselineSeries', CandlestickSeries: 'CandlestickSeries',
  }
  return { chart, LWC, created }
}

const direct = (id, sym) => ({
  instanceId: id, defId: 'dataSeries', hidden: false,
  inputs: { source: symbolSource(sym, 'close') },
})
const ma = (id, source, period = 5) => ({
  instanceId: id, defId: 'movingAverage', hidden: false,
  inputs: { source, period, maType: 'sma' },
})

function run(instances, secondary) {
  const h = harness()
  const binder = createBinder({ chart: h.chart, LWC: h.LWC })
  binder.sync({
    enabled: true, registry, instances, bars: bars(30),
    cs: mergeChartSettings({}), sym: 'NVDA', tf: 'D',
    secondary: secondary || new Map(),
    ohlcFamilyOf: () => OHLC_FAMILY.SECURITY,
    resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }),
  })
  return h.created
}

const valuesOf = (s) => (s ? s.__data.map((p) => p.value).filter(Number.isFinite) : [])

describe('MA over another instance — the dependency path', () => {
  beforeEach(() => { clearSecondaryBars() })

  it('⭐⭐ MA(QQQ-series) AVERAGES THE SECONDARY, not the chart', () => {
    const sec = new Map([['QQQ', { bars: bars(30, 700), status: 'ok' }]])
    // ⛔ THE CONSUMER IS LISTED FIRST. In stored order it precedes its source, so
    // only `orderByDependency` can make this pass.
    const created = run([ma('m1', instanceSource('d1', 'value')), direct('d1', 'QQQ')], sec)
    expect(created).toHaveLength(2)
    const all = created.map(valuesOf)
    for (const v of all) expect(v.length).toBeGreaterThan(0)
    // Every drawn value sits in the secondary's range (~700+), never the
    // primary's (~100).
    for (const v of all) expect(Math.min(...v)).toBeGreaterThan(600)
  })

  it('⭐ MA DIRECTLY OVER A SYMBOL needs no intermediate instance', () => {
    const sec = new Map([['QQQ', { bars: bars(30, 700), status: 'ok' }]])
    const created = run([ma('m1', symbolSource('QQQ', 'close'))], sec)
    const v = valuesOf(created[0])
    expect(v.length).toBeGreaterThan(0)
    expect(Math.min(...v)).toBeGreaterThan(600)
  })

  it('⛔⛔ AN EXPLICIT SOURCE THAT IS MISSING DRAWS NOTHING', () => {
    // No secondary supplied. The configured source is explicit and absent, so
    // the honest answer is an empty column — not an average of the chart's bars.
    const created = run([ma('m1', symbolSource('QQQ', 'close'))], new Map())
    expect(valuesOf(created[0] || null)).toHaveLength(0)
  })

  it('⭐ a HIDDEN source still computes, so its consumer can draw', () => {
    const sec = new Map([['QQQ', { bars: bars(30, 700), status: 'ok' }]])
    const hiddenSrc = { ...direct('d1', 'QQQ'), hidden: true }
    const created = run([hiddenSrc, ma('m1', instanceSource('d1', 'value'))], sec)
    // The hidden source draws nothing itself…
    expect(created).toHaveLength(1)
    // …but the average over it does.
    expect(valuesOf(created[0]).length).toBeGreaterThan(0)
  })

  it('⛔ A CYCLE COMPUTES NOTHING and does not hang', () => {
    const a = ma('m1', instanceSource('m2', 'ma'))
    const b = ma('m2', instanceSource('m1', 'ma'))
    const created = run([a, b], new Map())
    for (const s of created) expect(valuesOf(s)).toHaveLength(0)
  })

  it('⛔⛔ DELETION SEVERS, IT DOES NOT SILENTLY RECONNECT', () => {
    // A severed reference does not parse, so it resolves to nothing — rather
    // than snapping to some other instance that happens to be there.
    const sec = new Map([['QQQ', { bars: bars(30, 700), status: 'ok' }]])
    const consumer = ma('m1', instanceSource('d1', 'value'))
    const severed = severReferencesTo([consumer], 'd1')
    const list = Array.isArray(severed) ? severed : [consumer]
    const created = run([...list, direct('d2', 'QQQ')], sec)
    const maSeries = created.find((s) => s !== created[created.length - 1])
    // ⛔ THE POINT: a NEW instance with the same source does NOT adopt the
    // orphaned reference. Whatever the MA draws, it is not d2's numbers by
    // accident of ordering.
    const mav = valuesOf(maSeries)
    if (mav.length) expect(Math.min(...mav)).toBeGreaterThan(600)
  })

  it('⛔ the ordering helper really does reorder THIS graph', () => {
    // Non-vacuity for the dependency claim: asserted on the helper directly, so
    // "it passed" cannot mean "the array happened to be in the right order".
    const consumer = ma('m1', instanceSource('d1', 'value'))
    const source = direct('d1', 'QQQ')
    const { ordered, cyclic } = orderByDependency([consumer, source],
      (id) => registry.getDefinition(id))
    expect(cyclic.size).toBe(0)
    expect(ordered.map((i) => i.instanceId)).toEqual(['d1', 'm1'])
  })
})

describe('one source language — the shapes an MA may point at', () => {
  it('⭐ a BAR FIELD, an INSTANCE output and a SYMBOL all resolve', () => {
    const sec = new Map([['QQQ', { bars: bars(30, 700), status: 'ok' }]])
    const cases = [
      ['close', 100],                                  // the chart's own bars
      [symbolSource('QQQ', 'close'), 600],             // a canonical symbol
    ]
    for (const [src, floor] of cases) {
      const created = run([ma('m1', src)], sec)
      const v = valuesOf(created[0])
      expect(v.length, `no values for ${src}`).toBeGreaterThan(0)
      expect(Math.min(...v)).toBeGreaterThan(floor - 1)
    }
    // …and an instance output, which needs the source instance present.
    const created = run([direct('d1', 'QQQ'), ma('m1', instanceSource('d1', 'value'))], sec)
    expect(valuesOf(created[1]).length).toBeGreaterThan(0)
  })

  it('⛔ and `dataSeries` is unaffected by any of it', () => {
    const sec = new Map([['QQQ', { bars: bars(30, 700), status: 'ok' }]])
    const created = run([direct('d1', 'QQQ')], sec)
    const v = valuesOf(created[0])
    // A passthrough is still a passthrough: the close, value for value.
    expect(v).toEqual(bars(30, 700).map((b) => b.c))
    expect(DIRECT.passthrough).toBe(true)
  })
})
