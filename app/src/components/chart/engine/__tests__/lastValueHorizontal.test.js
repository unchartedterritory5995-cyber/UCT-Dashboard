import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { createFakeChart, makeBars } from './fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from '../paneLayout'
import * as registry from '../nativeRegistry'
import { resolvePlotStyle, DEFAULT_PLOT_STYLE, PLOT_STYLES } from '../presentation'
import { setInstancePlotStyle } from '../instanceControls'

// ─── POC D · CALCULATION ≠ PLACEMENT ≠ PRESENTATION ──────────────────────────
//
// The claim this file exists to hold: changing HOW an output draws changes
// neither WHAT it computes nor WHERE it goes. "Last value horizontal" is the
// first style that makes the difference visible — the history disappears and a
// single native price line stands in for it — so it is the one that can prove
// the seam, or expose that there isn't one.

const bars = makeBars()

const inst = (defId, extra = {}) => ({
  instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...extra,
})

const layoutFor = (instances) => computePaneLayout(instances, {
  chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX,
})

const ctxFor = (instances, { cs = {}, volOverlay = null } = {}) => {
  const layout = layoutFor(instances)
  return {
    enabled: true,
    instances,
    registry,
    bars,
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
    cs,
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

/** The option set a series is currently carrying.
 *
 *  ⚠️ IT COMES FROM `addSeries` ON A FIRST BIND AND `applyOptions` ON A RE-BIND,
 *  and reading only the second is how this file first "failed": a fresh sync
 *  creates the series WITH its options and never calls `applyOptions` at all. The
 *  later call wins when both happened, which is the order the renderer saw them.
 *  `chart` and `priceScale` share the method name `applyOptions`, hence the
 *  `on === 'series'` filter. */
const lastOptions = () => {
  const applied = fake.callsOf('applyOptions').filter(c => c.on === 'series')
  if (applied.length) return applied[applied.length - 1].args[0]
  const created = fake.callsOf('addSeries')
  return created.length ? created[created.length - 1].args[1] : null
}
/** The LAST-VALUE levels only. RSI's 70/50/30 guides are price lines too, and
 *  they are told apart the same way the axis tells them apart: a guide is a
 *  reference line with `axisLabelVisible: false`, a last-value level wears its
 *  number (`guideSpecs` vs the `lvh` block in `binder.js`). */
const lvhLines = () => fake.callsOf('createPriceLine')
  .map(c => c.args[0])
  .filter(l => l && l.axisLabelVisible === true)

describe('resolvePlotStyle', () => {
  it('absent means the default, and the default is Line', () => {
    expect(resolvePlotStyle(inst('rsi'))).toBe(DEFAULT_PLOT_STYLE)
    expect(DEFAULT_PLOT_STYLE).toBe('line')
  })

  it('a stored style is honoured', () => {
    expect(resolvePlotStyle(inst('rsi', { presentation: { plotStyle: 'lastValueHorizontal' } })))
      .toBe('lastValueHorizontal')
  })

  it('⛔ an UNKNOWN style reads as the default rather than as a guess', () => {
    // Data that bypassed validation must not reach the binder as a style it will
    // try to draw — the same fail-safe direction `resolvePlacement` takes.
    for (const bad of ['histogram', 'Line', '', null, 42, {}]) {
      expect(resolvePlotStyle(inst('rsi', { presentation: { plotStyle: bad } })))
        .toBe(DEFAULT_PLOT_STYLE)
    }
    expect(PLOT_STYLES).not.toContain('histogram')   // …not yet
  })
})

describe('setInstancePlotStyle', () => {
  const base = () => ({ indicatorInstances: [inst('rsi')] })

  it('⛔ the DEFAULT deletes rather than writes — one representation on disk', () => {
    const on = setInstancePlotStyle(base(), 'legacy:rsi', 'lastValueHorizontal', registry)
    expect(on.indicatorInstances[0].presentation).toEqual({ plotStyle: 'lastValueHorizontal' })
    const off = setInstancePlotStyle(on, 'legacy:rsi', 'line', registry)
    expect(off.indicatorInstances[0].presentation, 'an empty presentation object was left behind')
      .toBeUndefined()
  })

  it('⭐ PRESENTATION AND PLACEMENT ARE SEPARATE KEYS — neither disturbs the other', () => {
    const withPlacement = {
      indicatorInstances: [inst('rsi', { placement: { position: 'above', target: 'volume' } })],
    }
    const next = setInstancePlotStyle(withPlacement, 'legacy:rsi', 'lastValueHorizontal', registry)
    expect(next.indicatorInstances[0].placement, 'changing the style moved the indicator')
      .toEqual({ position: 'above', target: 'volume' })
    expect(next.indicatorInstances[0].presentation).toEqual({ plotStyle: 'lastValueHorizontal' })
  })

  it('refuses a style it cannot draw, and an instance it cannot find', () => {
    const cs = base()
    expect(setInstancePlotStyle(cs, 'legacy:rsi', 'dots', registry)).toBe(cs)
    expect(setInstancePlotStyle(cs, 'inst:nope:9', 'lastValueHorizontal', registry)).toBe(cs)
  })
})

describe('the binder, drawing a last-value-horizontal RSI', () => {
  it('⛔⛔ HIDES THE LINE, NOT THE SERIES — `lineVisible`, never `visible`', () => {
    // The whole feature turns on this distinction. `visible: false` takes the
    // series' PRICE LINES down with it, so the history vanished correctly and the
    // horizontal line that was supposed to replace it vanished too — measured in
    // the browser as an empty pane with a ladder in it.
    binder.sync(ctxFor([inst('rsi', { presentation: { plotStyle: 'lastValueHorizontal' } })]))
    const o = lastOptions()
    expect(o.lineVisible, 'the history is still drawn').toBe(false)
    expect(o.visible, 'the SERIES was hidden — its price line goes with it').toBe(true)
  })

  it('draws exactly ONE price line, at the newest value, full width by construction', () => {
    binder.sync(ctxFor([inst('rsi', { presentation: { plotStyle: 'lastValueHorizontal' } })]))
    // `createPriceLine` belongs to the series, so "full width" is not something
    // this can assert about pixels — it is what the API gives. What it CAN hold is
    // that there is one of them, at a real value, wearing its own axis label.
    const lines = lvhLines()
    expect(lines).toHaveLength(1)
    expect(Number.isFinite(lines[0].price)).toBe(true)
    expect(lines[0].axisLabelVisible).toBe(true)
  })

  it('⛔ and the SERIES tag is suppressed so the axis carries ONE number, not two', () => {
    // Measured in the browser before this: `62.54` printed twice, stacked.
    binder.sync(ctxFor([inst('rsi', { presentation: { plotStyle: 'lastValueHorizontal' } })]))
    expect(lastOptions().lastValueVisible).toBe(false)
  })

  it('⭐ the plain Line style is untouched — no price line, line drawn, tag on', () => {
    binder.sync(ctxFor([inst('rsi')]))
    const o = lastOptions()
    expect(o.lineVisible).toBe(true)
    expect(o.lastValueVisible).toBe(true)
    expect(lvhLines()).toHaveLength(0)
  })

  it('⭐⭐ SWITCHING STYLE KEEPS THE SAME SERIES — presentation is not a rebuild', () => {
    // The load-bearing claim. If the binder tore the series down and built a new
    // one, "no recalculation" would be a statement about a thing that no longer
    // exists — and every pooled scale, guide and handle would churn with it.
    const line = inst('rsi')
    const lvh = inst('rsi', { presentation: { plotStyle: 'lastValueHorizontal' } })

    binder.sync(ctxFor([line]))
    const before = binder.bindings().map(b => b.series)
    expect(before.length).toBeGreaterThan(0)
    const createdBefore = fake.seriesCreated.length

    binder.sync(ctxFor([lvh]))
    const after = binder.bindings().map(b => b.series)

    expect(after, 'the series was recreated to change how it draws').toEqual(before)
    expect(fake.seriesCreated.length, 'a new series was added').toBe(createdBefore)
    expect(fake.count('removeSeries'), 'a series was destroyed').toBe(0)
  })

  it('⭐ …and the DATA it is given is identical, point for point', () => {
    // "No recalculation" made checkable: the numbers handed to the renderer are
    // the same numbers, so nothing upstream re-ran to produce different ones.
    const read = () => {
      const c = fake.callsOf('setData')
      return c.length ? c[c.length - 1].args[0] : null
    }
    binder.sync(ctxFor([inst('rsi')]))
    const asLine = read()
    fake.reset()
    binder.sync(ctxFor([inst('rsi', { presentation: { plotStyle: 'lastValueHorizontal' } })]))
    const asLvh = read()
    expect(asLvh).toEqual(asLine)
  })

  it('⛔ switching BACK removes the price line — a pooled series outlives its tenant', () => {
    binder.sync(ctxFor([inst('rsi', { presentation: { plotStyle: 'lastValueHorizontal' } })]))
    expect(lvhLines()).toHaveLength(1)
    const removedBefore = fake.count('removePriceLine')

    binder.sync(ctxFor([inst('rsi')]))
    expect(fake.count('removePriceLine'), 'the level stayed drawn under a plain line')
      .toBeGreaterThan(removedBefore)
    expect(lastOptions().lineVisible).toBe(true)
  })

  it('⭐ it draws on the VOLUME pane too — the level does not depend on owning a pane', () => {
    // The gate was `lastValue === true`, which only the OWN-PANE branch returns,
    // so an overlaid oscillator hid its history and drew no level: nothing at all.
    const i = inst('rsi', {
      presentation: { plotStyle: 'lastValueHorizontal' },
      placement: { target: 'volume' },
    })
    binder.sync(ctxFor([i], { volOverlay: ['rsi'] }))
    expect(lastOptions().lineVisible).toBe(false)
    expect(lvhLines(), 'the overlaid oscillator drew nothing at all').toHaveLength(1)
  })
})
