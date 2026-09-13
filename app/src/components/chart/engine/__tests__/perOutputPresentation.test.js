import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { createFakeChart, makeBars } from './fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from '../paneLayout'
import * as registry from '../nativeRegistry'
import {
  resolvePlotStyle, resolveDotSize, availableStyles, presentedPlot,
  histogramBaseline, styleIrrelevantInputs, PLOT_STYLES, DOT_SIZES,
} from '../presentation'
import { setInstancePlotStyle, setInstanceDotSize } from '../instanceControls'

// ─── PRESENTATION, PER OUTPUT ────────────────────────────────────────────────
//
// ⭐ MACD IS THE WHOLE REASON THIS IS NOT A SINGLE VALUE. One instance, three
// outputs, and "the line is a line, the signal is dots, the histogram is a
// histogram" cannot be said once. RSI keeps working because the per-output map
// is an OVERRIDE over the instance-level answer, not a replacement for it.

const bars = makeBars()
const inst = (defId, extra = {}) => ({
  instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...extra,
})
const plotsOf = (defId) => registry.getDefinition(defId).plots
const plotOf = (defId, key) => plotsOf(defId).find(p => p.key === key)

const ctxFor = (instances, { volOverlay = null } = {}) => {
  const layout = computePaneLayout(instances, {
    chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX,
    excludeKeys: volOverlay ? new Set(volOverlay) : new Set(),
  })
  return {
    enabled: true, instances, registry, bars,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    paneLayout: layout,
    resolvePlacement: (i, def) => resolvePlacement(i, def, {
      paneMargins: layout.bands,
      paneLayout: layout,
      volOverlaySet: volOverlay ? new Set(volOverlay) : new Set(),
      volSeparatePane: !!volOverlay,
      VOL_PANE_INDEX: 1,
    }),
  }
}

let fake
let binder
beforeEach(() => {
  __setPaneModeForTest('panes')
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
})
afterEach(() => { __setPaneModeForTest(null) })

/** The series LWC was asked to make, by ctor name, in bind order. */
const madeTypes = () => fake.callsOf('addSeries').map(c => String(c.args[0]))
const madeOpts = () => fake.callsOf('addSeries').map(c => c.args[1])

describe('the fallback hierarchy', () => {
  it('1 · a per-output override wins', () => {
    const i = inst('macd', { presentation: { plots: { signal: { style: 'dots' } } } })
    expect(resolvePlotStyle(i, plotOf('macd', 'signal'))).toBe('dots')
  })

  it('2 · else the instance-level answer — which is what POC D saved', () => {
    const i = inst('rsi', { presentation: { plotStyle: 'lastValueHorizontal' } })
    expect(resolvePlotStyle(i, plotOf('rsi', 'rsi'))).toBe('lastValueHorizontal')
  })

  it('3 · ⛔⛔ else the DEFINITION\'s own shape, PER OUTPUT — not a flat "line"', () => {
    // The regression that would have redrawn every multi-output indicator on the
    // first load: MACD's histogram is a HISTOGRAM because its plot says so.
    const i = inst('macd')
    expect(resolvePlotStyle(i, plotOf('macd', 'macd'))).toBe('line')
    expect(resolvePlotStyle(i, plotOf('macd', 'signal'))).toBe('line')
    expect(resolvePlotStyle(i, plotOf('macd', 'histogram'))).toBe('histogram')
  })

  it('⭐ an override on ONE output leaves its siblings on their own defaults', () => {
    const i = inst('macd', { presentation: { plots: { signal: { style: 'dots' } } } })
    expect(resolvePlotStyle(i, plotOf('macd', 'macd'))).toBe('line')
    expect(resolvePlotStyle(i, plotOf('macd', 'signal'))).toBe('dots')
    expect(resolvePlotStyle(i, plotOf('macd', 'histogram'))).toBe('histogram')
  })

  it('⭐ an INSTANCE-level value still reaches every output that has no override', () => {
    const i = inst('macd', {
      presentation: { plotStyle: 'area', plots: { histogram: { style: 'histogram' } } },
    })
    expect(resolvePlotStyle(i, plotOf('macd', 'macd'))).toBe('area')
    expect(resolvePlotStyle(i, plotOf('macd', 'signal'))).toBe('area')
    expect(resolvePlotStyle(i, plotOf('macd', 'histogram'))).toBe('histogram')
  })

  it('⚠️ keyed by plot.key — NOT by index, and not by label', () => {
    // Stored against a key that is not this output's: it must not apply.
    const i = inst('macd', { presentation: { plots: { 0: { style: 'dots' }, Signal: { style: 'area' } } } })
    expect(resolvePlotStyle(i, plotOf('macd', 'macd'))).toBe('line')
    expect(resolvePlotStyle(i, plotOf('macd', 'signal'))).toBe('line')
  })
})

describe('the capability model', () => {
  it('⛔ a GUIDE output is not re-styleable — no dropdown that lies', () => {
    expect(availableStyles(plotOf('rsi', 'bands'))).toEqual([])
    expect(availableStyles(plotOf('rsi', 'midline'))).toEqual([])
    expect(availableStyles(plotOf('macd', 'zero'))).toEqual([])
  })

  it('a scalar numeric output exposes every style a SCALAR can wear', () => {
    // ⚰️ THIS READ `toEqual([...PLOT_STYLES])` — "the whole vocabulary" — and that
    // was the same sentence while every style was a second way to draw ONE column.
    // `candles` is the first that is not: it draws four fields that describe one
    // auction period, so it is a property of what the output READS, not of the
    // output. A scalar is offered everything except that.
    const scalarStyles = PLOT_STYLES.filter((s) => s !== 'candles')
    expect(availableStyles(plotOf('rsi', 'rsi'))).toEqual(scalarStyles)
    expect(availableStyles(plotOf('macd', 'histogram'))).toEqual(scalarStyles)
  })

  it('⛔⛔ CANDLES ARE NOT OFFERED TO A SCALAR OUTPUT, whatever the pane', () => {
    // A dropdown offering candles over an RSI would be a dropdown that lies —
    // the same rule `RESTYLEABLE_DEF_STYLES` states for guides, one level up.
    expect(availableStyles(plotOf('rsi', 'rsi'))).not.toContain('candles')
    expect(availableStyles(plotOf('rsi', 'rsi'), { target: 'volume' })).not.toContain('candles')
    // …and it takes an explicit capability answer to appear at all.
    expect(availableStyles(plotOf('rsi', 'rsi'), { ohlcCapable: true })).toContain('candles')
  })

  it('⛔ Histogram and Area are withheld on the SHARED volume pane', () => {
    // Two histograms in one rectangle on two scales is unreadable, and an area
    // fill covers the bars it is drawn over. Line and LVH read fine over a
    // histogram, which is what POC C proved.
    const on = availableStyles(plotOf('rsi', 'rsi'), { target: 'volume' })
    expect(on).toEqual(['line', 'dots', 'lastValueHorizontal'])
    expect(on).not.toContain('histogram')
    expect(on).not.toContain('area')
  })

  it('answers empty for nothing at all, rather than throwing', () => {
    expect(availableStyles(null)).toEqual([])
    expect(availableStyles({})).toEqual([])
  })

  it('⛔⛔ CAPABILITY BINDS THE RENDERER — a withheld style is not drawn either', () => {
    // Measured in the browser before this existed: an RSI stored as `area` and
    // sent to the Volume pane kept drawing a full-height translucent fill over
    // the candles, because only the `<select>` had been filtered.
    const onVolume = inst('rsi', {
      presentation: { plotStyle: 'area' },
      placement: { target: 'volume' },
    })
    expect(resolvePlotStyle(onVolume, plotOf('rsi', 'rsi'))).toBe('line')
    expect(presentedPlot(plotOf('rsi', 'rsi'), onVolume).style).toBe('line')
  })

  it('⭐ …and the STORED value is not rewritten — sending it home restores Area', () => {
    const stored = { presentation: { plotStyle: 'area' } }
    const home = inst('rsi', stored)
    expect(resolvePlotStyle(home, plotOf('rsi', 'rsi'))).toBe('area')
    // The same instance, only its placement differing, reads differently — which
    // is the clamp being a READING of state at a placement, not an edit of it.
    const away = inst('rsi', { ...stored, placement: { target: 'volume' } })
    expect(resolvePlotStyle(away, plotOf('rsi', 'rsi'))).toBe('line')
    expect(away.presentation.plotStyle, 'the clamp edited the stored state').toBe('area')
  })
})

describe('presentedPlot — the restyle the renderer actually sees', () => {
  it('maps the USER vocabulary onto the DEFINITION vocabulary', () => {
    const p = plotOf('rsi', 'rsi')
    const at = (style) => presentedPlot(p, inst('rsi', { presentation: { plotStyle: style } })).style
    expect(at('line')).toBe('line')
    expect(at('histogram')).toBe('histogram')
    expect(at('dots')).toBe('markers')
    expect(at('area')).toBe('area')
    expect(at('lastValueHorizontal')).toBe('line')
  })

  it('⛔ returns the SAME OBJECT when nothing overrode it', () => {
    // Identity matters downstream (guide signatures, plan diffing), and copying
    // per plot per sync to write the value that was already there is pure churn.
    const p = plotOf('macd', 'histogram')
    expect(presentedPlot(p, inst('macd'))).toBe(p)
  })

  it('⭐ dots carry their SIZE in `width`, which is the field the renderer reads', () => {
    const p = plotOf('rsi', 'rsi')
    const big = presentedPlot(p, inst('rsi', {
      presentation: { plotStyle: 'dots', dotSize: 'large' },
    }))
    expect(big.style).toBe('markers')
    expect(big.width).toBe(DOT_SIZES.large)
    // …and never the declared LINE width, which is 1 and would be invisible.
    expect(big.width).not.toBe(p.width)
  })
})

describe('histogramBaseline — metadata, never the visible minimum', () => {
  it('a fixed ladder puts the floor at its own minimum', () => {
    expect(histogramBaseline(plotOf('rsi', 'rsi'), { min: 0, max: 100 })).toBe(0)
    expect(histogramBaseline(plotOf('rsi', 'rsi'), { min: -100, max: 0 })).toBe(-100)
  })

  it('a dynamic indicator grows from ZERO — MACD, and LWC\'s own default', () => {
    expect(histogramBaseline(plotOf('macd', 'histogram'), null)).toBe(0)
  })

  it('an author who says so outright wins', () => {
    expect(histogramBaseline({ base: 42 }, { min: 0, max: 100 })).toBe(42)
  })
})

describe('styleIrrelevantInputs — progressive disclosure, from $refs', () => {
  const withRefs = {
    id: 'probe',
    plots: [
      { key: 'a', style: 'line', $refs: { color: 'aColor', width: 'aWidth', lineStyle: 'aDash' } },
    ],
  }

  it('a LINE keeps its stroke controls', () => {
    expect([...styleIrrelevantInputs(withRefs, inst('probe'))]).toEqual([])
  })

  it('⛔ a HISTOGRAM and DOTS hide width and dash — they have no stroke', () => {
    for (const style of ['histogram', 'dots']) {
      const hidden = styleIrrelevantInputs(withRefs, inst('probe', { presentation: { plotStyle: style } }))
      expect([...hidden].sort()).toEqual(['aDash', 'aWidth'])
      expect(hidden.has('aColor'), 'colour is meaningful in every style').toBe(false)
    }
  })

  it('AREA and LVH keep them — both are drawn with a stroke', () => {
    for (const style of ['area', 'lastValueHorizontal']) {
      expect([...styleIrrelevantInputs(withRefs, inst('probe', { presentation: { plotStyle: style } }))])
        .toEqual([])
    }
  })

  it('⭐ an input shared by two outputs survives if EITHER still uses it', () => {
    const shared = {
      id: 'probe',
      plots: [
        { key: 'a', style: 'line', $refs: { width: 'w' } },
        { key: 'b', style: 'line', $refs: { width: 'w' } },
      ],
    }
    const i = inst('probe', { presentation: { plots: { a: { style: 'histogram' } } } })
    expect([...styleIrrelevantInputs(shared, i)], 'b still draws a stroke with it').toEqual([])
  })
})

describe('the setters', () => {
  const macd = () => ({ indicatorInstances: [inst('macd')] })

  it('writes one output without disturbing the others', () => {
    const next = setInstancePlotStyle(macd(), 'legacy:macd', 'dots', registry, 'signal')
    expect(next.indicatorInstances[0].presentation).toEqual({ plots: { signal: { style: 'dots' } } })
  })

  it('⛔⛔ "back to default" IS THE DEFINITION\'S, not "line"', () => {
    // Setting MACD's histogram output to Histogram must DELETE the override, not
    // store `'histogram'` — and setting the MACD line to Line must delete too.
    // Otherwise "reset" on a multi-output indicator flattens it.
    let cs = setInstancePlotStyle(macd(), 'legacy:macd', 'dots', registry, 'histogram')
    expect(cs.indicatorInstances[0].presentation.plots.histogram).toEqual({ style: 'dots' })
    cs = setInstancePlotStyle(cs, 'legacy:macd', 'histogram', registry, 'histogram')
    expect(cs.indicatorInstances[0].presentation, 'the default was stored instead of deleted')
      .toBeUndefined()
  })

  it('dot size rides the same per-output shape, and deletes its default', () => {
    let cs = setInstanceDotSize(macd(), 'legacy:macd', 'large', registry, 'signal')
    expect(cs.indicatorInstances[0].presentation).toEqual({ plots: { signal: { dotSize: 'large' } } })
    cs = setInstanceDotSize(cs, 'legacy:macd', 'medium', registry, 'signal')
    expect(cs.indicatorInstances[0].presentation).toBeUndefined()
  })

  it('style and dot size coexist on one output', () => {
    let cs = setInstancePlotStyle(macd(), 'legacy:macd', 'dots', registry, 'signal')
    cs = setInstanceDotSize(cs, 'legacy:macd', 'large', registry, 'signal')
    expect(cs.indicatorInstances[0].presentation.plots.signal)
      .toEqual({ style: 'dots', dotSize: 'large' })
    expect(resolveDotSize(cs.indicatorInstances[0], plotOf('macd', 'signal'))).toBe('large')
  })

  it('refuses a size and a style it does not have', () => {
    const cs = macd()
    expect(setInstanceDotSize(cs, 'legacy:macd', 'huge', registry, 'signal')).toBe(cs)
    expect(setInstancePlotStyle(cs, 'legacy:macd', 'hlines', registry, 'signal')).toBe(cs)
  })
})

describe('the binder, drawing MACD\'s three outputs', () => {
  it('⛔ DEFAULT MACD IS UNCHANGED — line, line, histogram', () => {
    binder.sync(ctxFor([inst('macd')]))
    const types = madeTypes()
    expect(types).toHaveLength(3)
    expect(types[0]).toMatch(/Line/)
    expect(types[1]).toMatch(/Line/)
    expect(types[2]).toMatch(/Histogram/)
    // …and the histogram still grows from zero.
    expect(madeOpts()[2].base).toBe(0)
  })

  it('⭐⭐ THREE OUTPUTS, THREE STYLES, ONE INSTANCE', () => {
    binder.sync(ctxFor([inst('macd', {
      presentation: { plots: { signal: { style: 'dots' } } },
    })]))
    const types = madeTypes()
    const opts = madeOpts()
    expect(types[0]).toMatch(/Line/)
    expect(types[1]).toMatch(/Line/)            // dots ARE a line series…
    expect(opts[1].lineWidth, 'the signal still drew a connecting stroke').toBe(0)
    expect(opts[1].pointMarkersVisible).toBe(true)   // …with no line and dots on
    expect(opts[1].pointMarkersRadius).toBe(DOT_SIZES.medium)
    expect(types[2]).toMatch(/Histogram/)
  })

  it('⛔ a style change REUSES the series when the series TYPE is the same', () => {
    binder.sync(ctxFor([inst('rsi')]))
    const before = binder.bindings().map(b => b.series)
    binder.sync(ctxFor([inst('rsi', { presentation: { plotStyle: 'dots' } })]))
    // line → markers is still a LineSeries, so nothing is rebuilt.
    expect(binder.bindings().map(b => b.series)).toEqual(before)
    expect(fake.count('removeSeries')).toBe(0)
  })

  it('⚠️ line → HISTOGRAM must rebuild the series, because LWC cannot convert one', () => {
    // Not a failure of the seam — a library fact. What matters is that the DATA
    // is untouched, which the no-recalculation case below holds.
    binder.sync(ctxFor([inst('rsi')]))
    const madeBefore = fake.seriesCreated.length
    binder.sync(ctxFor([inst('rsi', { presentation: { plotStyle: 'histogram' } })]))
    expect(fake.seriesCreated.length, 'the histogram series was never created')
      .toBeGreaterThan(madeBefore)
    expect(madeTypes().pop()).toMatch(/Histogram/)
  })

  it('⭐⭐ NO RECALCULATION — the points are identical across every style', () => {
    const read = () => {
      const c = fake.callsOf('setData')
      return c.length ? c[c.length - 1].args[0] : null
    }
    binder.sync(ctxFor([inst('rsi')]))
    const asLine = read()
    expect(asLine.length).toBeGreaterThan(0)
    for (const style of ['histogram', 'dots', 'area', 'lastValueHorizontal']) {
      const f2 = createFakeChart()
      const b2 = createBinder({ chart: f2.chart, LWC: f2.LWC })
      b2.sync(ctxFor([inst('rsi', { presentation: { plotStyle: style } })]))
      const c = f2.callsOf('setData')
      expect(c[c.length - 1].args[0], `${style} changed the numbers`).toEqual(asLine)
    }
  })

  it('⭐ a fixed-ladder histogram grows from the LADDER\'s floor, not from zero-by-luck', () => {
    binder.sync(ctxFor([inst('williamsR', { presentation: { plotStyle: 'histogram' } })]))
    const hist = madeOpts().find(o => Object.prototype.hasOwnProperty.call(o, 'base'))
    expect(hist, 'williamsR did not draw a histogram').toBeTruthy()
    expect(hist.base, 'bars grew from 0 on a -100..0 ladder').toBe(-100)
  })
})
