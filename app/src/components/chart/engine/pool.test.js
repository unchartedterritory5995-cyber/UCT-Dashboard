import { describe, it, expect } from 'vitest'
import {
  POOL_KEYS,
  poolKey,
  bindingKey,
  guideSignature,
  planBindings,
  firstBindNeedsSetData,
  seriesOptionsForPlot,
  signColorsForPlot,
  plotAlpha,
  resolvePlotForInstance,
  lineStyleValue,
} from './pool'
import { MAIN_PRICE_SCALE_ID } from './placement'
import { PLOT_STYLES } from './defSchema'
import * as registry from './nativeRegistry'
// The INSTALLED renderer, imported for one purpose: to read its real series
// defaults. This is the only `lightweight-charts` import under `engine/` outside
// `binder.js`, and it is a TEST-only import — the modules under test stay pure.
import {
  LineSeries, AreaSeries, BaselineSeries, HistogramSeries, version as lwcVersion,
} from 'lightweight-charts'

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// Real definitions, deliberately. The pool key is a claim about which LWC
// constructor each shipped plot needs, and a made-up definition cannot be wrong
// about that in a way anyone would notice.

const inst = (defId, extra = {}) => ({
  instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...extra,
})

const plotOf = (defId, plotKey) =>
  registry.getDefinition(defId).plots.find(p => p.key === plotKey)

/** Run a pass and feed its own bindings into the next one, like the binder does. */
const bindingsFrom = (result) => result.bind

const keysOf = (list) => list.map(b => b.key)
const bySource = (result, source) => result.bind.filter(b => b.source === source)

// A stand-in series handle. The planner must never call anything on it — it only
// carries it from one pass to the next — so an object with no methods is exactly
// the right double, and would throw if the planner ever reached into it.
let _n = 0
const fakeSeries = (tag) => ({ tag: tag || `series#${++_n}` })

/** The shape the binder hands back in: one record per bound plot. */
const withSeries = (bindings) => bindings.map(b => ({ ...b, series: b.series || fakeSeries(b.key) }))

describe('poolKey — the pool key is the LWC constructor and nothing else', () => {
  it('two line plots of the same indicator share a key', () => {
    expect(poolKey(plotOf('macd', 'macd'))).toBe('line')
    expect(poolKey(plotOf('macd', 'signal'))).toBe('line')
  })

  it('two line plots of DIFFERENT indicators share a key — that is the whole point', () => {
    // A pooled LineSeries can be moved between panes, re-scaled and recoloured;
    // only its TYPE is fixed. So RSI's line and ATR's line are interchangeable.
    expect(poolKey(plotOf('rsi', 'rsi'))).toBe(poolKey(plotOf('atr', 'atr')))
  })

  it('a histogram never matches a line', () => {
    expect(poolKey(plotOf('macd', 'histogram'))).toBe('histogram')
    expect(poolKey(plotOf('macd', 'histogram'))).not.toBe(poolKey(plotOf('macd', 'macd')))
  })

  it('stepline is a LINE — same constructor, an option apart', () => {
    // `lineType: WithSteps` is an applyOptions away, so a stepline and a line are
    // the same pooled object. Giving stepline its own key would fragment the pool
    // for a difference the renderer does not have.
    expect(poolKey({ style: 'stepline' })).toBe('line')
  })

  it('band and markers are BOTH LineSeries — the two the plan left unmapped', () => {
    // `band` today is BB's / Donchian's middle: a plain line, drawn between two
    // sibling line plots, with NO fill (see the nativeRegistry docstring).
    // `markers` is SAR: a LineSeries with lineWidth 0 and point markers.
    expect(poolKey(plotOf('bb', 'middle'))).toBe('line')
    expect(poolKey(plotOf('sar', 'sar'))).toBe('line')
  })

  it('hlines needs NO SERIES AT ALL and says so', () => {
    // Guides are price lines on somebody else's series. Handing them a pool key
    // would allocate a series with no column to put in it.
    expect(poolKey(plotOf('rsi', 'bands'))).toBeNull()
    expect(poolKey(plotOf('rsi', 'midline'))).toBeNull()
  })

  it('every registered data-bearing plot maps to a known pool key', () => {
    for (const def of registry.listDefinitions()) {
      for (const plotKey of registry.columnKeys(def)) {
        const k = poolKey(def.plots.find(p => p.key === plotKey))
        expect(POOL_KEYS, `${def.id}.${plotKey}`).toContain(k)
      }
    }
  })

  it('an unknown style is NULL, never a guessed default', () => {
    // Same posture as defSchema: a style nobody mapped must render nothing rather
    // than quietly become a line of the wrong shape.
    expect(poolKey({ style: 'hologram' })).toBeNull()
    expect(poolKey(null)).toBeNull()
    expect(poolKey({})).toBeNull()
  })
})

describe('planBindings — one binding per data-bearing plot', () => {
  it('a fresh pass creates one series per data plot, and none for the guides', () => {
    const r = planBindings([inst('rsi')], registry, [])
    expect(keysOf(r.bind)).toEqual(['legacy:rsi::rsi'])
    expect(r.bind[0].source).toBe('create')
    expect(r.bind[0].series).toBeNull()
    expect(r.release).toEqual([])
    expect(r.reuse).toEqual([])
  })

  it('the instance\'s GUIDES ride on its first data-bearing series', () => {
    // RSI's 70/30 and 50 are `createPriceLine` calls on the RSI line today. They
    // belong to a series, so the plan has to say WHICH one.
    const r = planBindings([inst('rsi')], registry, [])
    expect(r.bind[0].guides.map(g => g.key)).toEqual(['bands', 'midline'])
  })

  it('only the FIRST data plot carries the guides — not every series of the instance', () => {
    const r = planBindings([inst('stoch')], registry, [])
    expect(keysOf(r.bind)).toEqual(['legacy:stoch::k', 'legacy:stoch::d'])
    expect(r.bind[0].guides.map(g => g.key)).toEqual(['overbought', 'oversold'])
    expect(r.bind[1].guides).toEqual([])
  })

  it('a hidden instance binds nothing', () => {
    expect(planBindings([inst('rsi', { hidden: true })], registry, []).bind).toEqual([])
  })

  it('an unknown defId binds nothing rather than throwing', () => {
    expect(planBindings([inst('hologram')], registry, []).bind).toEqual([])
  })

  it('a plot with NO FINITE DATA binds nothing — the pane-existence test', () => {
    // trap #4: post-B1 every column is input-length, so `.length` is always
    // truthy. `hasData` is `hasAnyFinite`, supplied by the caller that computed.
    const r = planBindings([inst('rsi')], registry, [], { hasData: () => false })
    expect(r.bind).toEqual([])
  })
})

describe('planBindings — reuse, the #2049 escape', () => {
  it('a same-key binding keeps its OWN series and is not counted as reuse', () => {
    const first = withSeries(bindingsFrom(planBindings([inst('rsi')], registry, [])))
    const r = planBindings([inst('rsi')], registry, first)

    expect(r.bind[0].source).toBe('same')
    expect(r.bind[0].series).toBe(first[0].series)
    expect(r.reuse, 'continuity is not re-purposing').toEqual([])
    expect(r.release).toEqual([])
  })

  it('a released line is REUSED by the next line rather than recreated', () => {
    // The headline case: RSI goes away, ATR arrives. Both are one pane line, so
    // the same LineSeries survives — no removeSeries, no addSeries, no 2-4s
    // main-thread block from lightweight-charts#2049.
    const first = withSeries(bindingsFrom(planBindings([inst('rsi')], registry, [])))
    const r = planBindings([inst('atr')], registry, first)

    expect(r.bind).toHaveLength(1)
    expect(r.bind[0].source).toBe('pooled')
    expect(r.bind[0].series).toBe(first[0].series)
    expect(r.bind[0].from.key).toBe('legacy:rsi::rsi')
    expect(r.release, 'nothing is freed that this pass could use').toEqual([])
    expect(keysOf(r.reuse)).toEqual(['legacy:atr::atr'])
  })

  it('a histogram is NEVER handed to a line', () => {
    const first = withSeries(bindingsFrom(planBindings([inst('macd')], registry, [])))
    expect(first.map(b => b.poolKey)).toEqual(['line', 'line', 'histogram'])

    const r = planBindings([inst('rsi')], registry, first)
    expect(r.bind[0].source).toBe('pooled')
    expect(r.bind[0].from.poolKey).toBe('line')
    // The histogram and the spare line are freed; neither could serve an RSI line
    // AND be kept, and only one line was needed.
    expect(r.release.map(b => b.poolKey).sort()).toEqual(['histogram', 'line'])
  })

  it('NEVER releases something a bind in the same pass could have reused', () => {
    // The property, asserted structurally rather than case by case: for every
    // release, there is no created binding of the same pool key that could have
    // taken it instead.
    const before = withSeries(bindingsFrom(planBindings(
      [inst('macd'), inst('rsi'), inst('stoch')], registry, [],
    )))
    const r = planBindings([inst('adx'), inst('bb'), inst('cci')], registry, before)

    const createdKeys = bySource(r, 'create').map(b => b.poolKey)
    for (const rel of r.release) {
      expect(createdKeys, `released a ${rel.poolKey} while creating one`).not.toContain(rel.poolKey)
    }
  })

  it('reuse is deterministic — the same inputs plan the same way twice', () => {
    const before = withSeries(bindingsFrom(planBindings([inst('macd')], registry, [])))
    const a = planBindings([inst('stoch')], registry, before)
    const b = planBindings([inst('stoch')], registry, before)
    expect(a.bind.map(x => x.series.tag)).toEqual(b.bind.map(x => x.series.tag))
  })

  it('a key that survives but CHANGES TYPE cannot keep its series — type is immutable', () => {
    // The one property `applyOptions` cannot touch (`seriesType()` is a read-only
    // getter). A binding whose plot style changed under the same key has to give
    // its series back to the pool and take a different one.
    const before = withSeries(bindingsFrom(planBindings([inst('rsi')], registry, [])))
    const mutated = before.map(b => ({ ...b, poolKey: 'histogram' }))

    const r = planBindings([inst('rsi')], registry, mutated)
    expect(r.bind[0].source).toBe('create')
    expect(r.release.map(b => b.poolKey)).toEqual(['histogram'])
  })

  it('everything is released when the last instance goes away', () => {
    const before = withSeries(bindingsFrom(planBindings([inst('rsi'), inst('macd')], registry, [])))
    const r = planBindings([], registry, before)
    expect(r.bind).toEqual([])
    expect(r.release).toHaveLength(before.length)
  })

  it('a nullish instance list is an empty plan, not a crash', () => {
    expect(planBindings(null, registry, null)).toEqual({ bind: [], release: [], reuse: [] })
    expect(planBindings(undefined, registry, undefined)).toEqual({ bind: [], release: [], reuse: [] })
  })
})

describe('firstBindNeedsSetData — trap #1', () => {
  const created = { source: 'create' }
  const pooled = { source: 'pooled' }
  const same = { source: 'same' }

  it('is TRUE for a newly created series under a noop plan', () => {
    // `_applyData` returns early on `_noop`, so a series created this pass would
    // render BLANK. Safe today only because every create is triggered by a `cs`
    // change; pooling breaks that coupling.
    expect(firstBindNeedsSetData(created, 'noop')).toBe(true)
  })

  it('is TRUE for a RE-PURPOSED series under a noop plan — it still holds the last tenant\'s data', () => {
    expect(firstBindNeedsSetData(pooled, 'noop')).toBe(true)
  })

  it('is true under EVERY plan mode for both', () => {
    for (const mode of ['noop', 'incr', 'fresh', undefined, null, 'anything']) {
      expect(firstBindNeedsSetData(created, mode), `create/${mode}`).toBe(true)
      expect(firstBindNeedsSetData(pooled, mode), `pooled/${mode}`).toBe(true)
    }
  })

  it('is FALSE for a series that kept its own binding — the normal plan applies', () => {
    expect(firstBindNeedsSetData(same, 'noop')).toBe(false)
    expect(firstBindNeedsSetData(same, 'incr')).toBe(false)
    expect(firstBindNeedsSetData(same, 'fresh')).toBe(false)
  })

  it('a binding with no recognisable source is treated as a first bind', () => {
    // Fail toward drawing. A missed setData is a blank indicator; a redundant one
    // is a repaint.
    expect(firstBindNeedsSetData({}, 'noop')).toBe(true)
    expect(firstBindNeedsSetData(null, 'noop')).toBe(true)
  })
})

describe('resolvePlotForInstance — the user\'s value, not the definition\'s default', () => {
  // Found by the binder's recolour test. `validateDefinition` resolves
  // `color: '$color'` to the INPUT'S DEFAULT, which is right for a definition and
  // wrong for an instance: without re-applying the reference, every migrated
  // indicator would render in its default colour and silently ignore the stored
  // blob. `$refs` is what makes the re-apply a lookup instead of a guess.

  const rsiLine = () => plotOf('rsi', 'rsi')

  it('the DEFINITION still carries the resolved default — unchanged', () => {
    expect(rsiLine().color).toBe('#7b68ee')
  })

  it('a substituted field remembers WHICH input it came from', () => {
    expect(rsiLine().$refs).toEqual({ color: 'color' })
    expect(plotOf('vwap', 'vwap').$refs).toEqual({ color: 'color', width: 'lineWidth' })
  })

  it('an instance input overrides it', () => {
    expect(resolvePlotForInstance(rsiLine(), { color: '#abcdef' }).color).toBe('#abcdef')
    expect(resolvePlotForInstance(plotOf('vwap', 'vwap'), { lineWidth: 3 }).width).toBe(3)
  })

  it('an input the instance does NOT set keeps the definition default', () => {
    // Same rule the migrator preserves: unset means "whatever the default is
    // today", not "whatever it was when this blob was written".
    expect(resolvePlotForInstance(rsiLine(), { period: 7 }).color).toBe('#7b68ee')
  })

  it('an author\'s LITERAL is never touched', () => {
    // RSI's guides are literal rgba strings, not refs.
    const guide = plotOf('rsi', 'bands')
    expect(guide.$refs).toBeUndefined()
    expect(resolvePlotForInstance(guide, { color: '#abcdef' })).toBe(guide)
  })

  it('returns the SAME OBJECT when there is nothing to re-apply', () => {
    const p = rsiLine()
    expect(resolvePlotForInstance(p, {})).toBe(p)
    expect(resolvePlotForInstance(p, null)).toBe(p)
  })

  it('does not mutate the definition — a second instance sees the default again', () => {
    const p = rsiLine()
    resolvePlotForInstance(p, { color: '#000000' })
    expect(registry.getDefinition('rsi').plots[0].color).toBe('#7b68ee')
    expect(p.color).toBe('#7b68ee')
  })

  it('carries through planBindings, which is where the binder reads it', () => {
    const r = planBindings([inst('rsi', { inputs: { color: '#123456' } })], registry, [])
    expect(r.bind[0].plot.color).toBe('#123456')
  })
})

describe('seriesOptionsForPlot', () => {
  it('a line carries colour, width and the three "do not decorate" flags', () => {
    const o = seriesOptionsForPlot(plotOf('rsi', 'rsi'), { scaleId: 'rsi' })
    expect(o).toMatchObject({
      priceScaleId: 'rsi',
      color: '#7b68ee',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
  })

  it('an UNDECLARED lineStyle is RESTORED to Solid, never left inherited', () => {
    // ⚠️ THIS TEST USED TO ASSERT THE OPPOSITE ("absent means leave the series
    // alone"), and that sentence is true only of a series nobody else has owned.
    // `binder` re-binds a re-purposed series with `applyOptions`, which MERGES:
    // a Stochastic %D (dashed) released into the pool and taken by an MFI (which
    // declares no style) left the MFI rendering dashed. An option the new plot
    // does not name is the previous tenant's option until something overwrites it.
    expect(seriesOptionsForPlot(plotOf('rsi', 'rsi'), {}).lineStyle).toBe(0)     // solid
    expect(seriesOptionsForPlot(plotOf('bb', 'upper'), {}).lineStyle).toBe(2)    // dashed
  })

  // ⚠️ THE REGRESSION THIS PAIR EXISTS FOR. Every test above passes `{}` as the
  // ctx, so none of them ever exercised the branch PRODUCTION uses: the binder
  // passes the real `LWC.LineStyle`, whose members are capitalised
  // (`Solid/Dotted/Dashed/LargeDashed`) while a plot declares `'dashed'`. The
  // lookup used to be `LineStyle[plot.lineStyle]` — `undefined` on every call —
  // so with the real enum in hand EVERY declared line style was silently
  // dropped, and the numeric fallback that should have caught it was unreachable
  // because a truthy enum always won the `||`. Found by the Task 8 rehearsal.
  const REAL_LWC_LINE_STYLE = { 0: 'Solid', Solid: 0, 1: 'Dotted', Dotted: 1, 2: 'Dashed', Dashed: 2, 3: 'LargeDashed', LargeDashed: 3, 4: 'SparseDotted', SparseDotted: 4 }

  it('maps a declared style THROUGH the real LWC enum, whose members are capitalised', () => {
    const ctx = { LineStyle: REAL_LWC_LINE_STYLE }
    expect(seriesOptionsForPlot(plotOf('bb', 'upper'), ctx).lineStyle).toBe(2)
    expect(seriesOptionsForPlot(plotOf('ichimoku', 'spanB'), ctx).lineStyle)
      .toBe(seriesOptionsForPlot(plotOf('ichimoku', 'spanB'), {}).lineStyle)
  })

  it('the LIBRARY\'s number wins over the frozen one when they disagree', () => {
    // The frozen map is the fallback for a caller with no enum, not a second
    // source of truth. If LWC ever renumbers, the enum is the answer.
    const shifted = { Solid: 90, Dotted: 91, Dashed: 92, LargeDashed: 93 }
    expect(seriesOptionsForPlot(plotOf('bb', 'upper'), { LineStyle: shifted }).lineStyle).toBe(92)
    expect(lineStyleValue('largeDashed', shifted)).toBe(93)
    expect(lineStyleValue('largeDashed', null)).toBe(3)
    expect(lineStyleValue('nonsense', shifted)).toBeUndefined()
    expect(lineStyleValue(undefined, shifted)).toBeUndefined()
  })

  it('a histogram gets a price format and NOT line options', () => {
    const o = seriesOptionsForPlot(plotOf('macd', 'histogram'), { scaleId: 'macd' })
    expect(o.priceFormat).toEqual({ type: 'price', precision: 5 })
    expect(o.lineWidth).toBeUndefined()
    expect(o.crosshairMarkerVisible).toBeUndefined()
  })

  it('markers is a zero-width line with point markers — SAR, exactly as it ships', () => {
    const o = seriesOptionsForPlot(plotOf('sar', 'sar'), { scaleId: 'right' })
    expect(o.lineWidth).toBe(0)
    expect(o.pointMarkersVisible).toBe(true)
    expect(o.pointMarkersRadius).toBe(3)
  })

  it('an unmappable plot has no options at all', () => {
    expect(seriesOptionsForPlot(plotOf('rsi', 'bands'), {})).toBeNull()
    expect(seriesOptionsForPlot({ style: 'hologram' }, {})).toBeNull()
  })

  it('never emits a FUNCTION — options must stay comparable between passes', () => {
    for (const def of registry.listDefinitions()) {
      for (const plot of def.plots) {
        const o = seriesOptionsForPlot(plot, { scaleId: 'x' })
        if (!o) continue
        for (const [k, v] of Object.entries(o)) {
          expect(typeof v, `${def.id}.${plot.key}.${k}`).not.toBe('function')
        }
      }
    }
  })
})

// ─── M-6: the option set, asserted the way the SCALE set already was ────────
//
// The branch had FOUR tests asserting the complete price-scale option object on
// create, on update and on re-purpose — and ZERO asserting the SERIES option
// object on any of them. Three critical defects fell through that hole at once
// (leaked `pointMarkersVisible` / `lineStyle` / `visible`; a pooled overlay
// keeping the previous tenant's named scale; a histogram with no per-point
// colour). This is the series-side equivalent, and it is TABLE-DRIVEN OVER THE
// SCHEMA VOCABULARY so a plot style added in B3 cannot silently skip it.

/** Every style a definition may declare, straight from the schema — not a
 *  hand-copied list. `hlines` is here too, and its expectation is `null`. */
const EVERY_STYLE = PLOT_STYLES

/** A minimal plot per style. Deliberately DECLARES NOTHING beyond what the style
 *  needs, because "what does the engine emit when the author is silent" is the
 *  entire question a leak turns on. */
const bareplot = (style) => {
  const p = { key: 'x', style }
  if (style === 'hlines') p.levels = [50]
  if (style === 'band') p.edges = { upper: 'u', lower: 'l' }
  return p
}

/** The key set each pool key must ALWAYS produce, whatever the plot says. */
const COMPLETE_KEYS = {
  line: [
    'priceLineVisible', 'lastValueVisible', 'visible', 'priceScaleId', 'priceFormat',
    'crosshairMarkerVisible', 'lineWidth', 'lineStyle', 'lineType',
    'pointMarkersVisible', 'pointMarkersRadius', 'color',
  ],
  histogram: [
    'priceLineVisible', 'lastValueVisible', 'visible', 'priceScaleId', 'priceFormat', 'color',
  ],
  area: [
    'priceLineVisible', 'lastValueVisible', 'visible', 'priceScaleId', 'priceFormat',
    'crosshairMarkerVisible', 'lineWidth', 'lineStyle', 'lineType',
    'pointMarkersVisible', 'pointMarkersRadius',
    'lineColor', 'topColor', 'bottomColor',
  ],
  baseline: [
    'priceLineVisible', 'lastValueVisible', 'visible', 'priceScaleId', 'priceFormat',
    'crosshairMarkerVisible', 'lineWidth', 'lineStyle', 'lineType',
    'pointMarkersVisible', 'pointMarkersRadius',
    'topLineColor', 'bottomLineColor',
    'topFillColor1', 'topFillColor2', 'bottomFillColor1', 'bottomFillColor2',
  ],
}

describe('the COMPLETE series option set — one key set per pool key, every call', () => {
  it('covers every style the schema allows — no style is untested by omission', () => {
    // If B3 adds a style to PLOT_STYLES and not to this file, this fails first,
    // with the name of the style nobody wrote an expectation for.
    for (const style of EVERY_STYLE) {
      const pk = poolKey(bareplot(style))
      expect(pk === null || Object.hasOwn(COMPLETE_KEYS, pk), `style ${style} → poolKey ${pk}`).toBe(true)
    }
  })

  it('a BARE plot of every style emits its pool key\'s FULL key set', () => {
    for (const style of EVERY_STYLE) {
      const plot = bareplot(style)
      const pk = poolKey(plot)
      const o = seriesOptionsForPlot(plot, { scaleId: 's' })
      if (pk === null) { expect(o, style).toBeNull(); continue }
      expect(Object.keys(o).sort(), style).toEqual([...COMPLETE_KEYS[pk]].sort())
    }
  })

  it('a FULLY-DECORATED plot emits the SAME key set — never more, never fewer', () => {
    // The leak was never "too few keys on this plot"; it was "different keys on
    // two plots that share a series". Equal key sets is what makes an
    // `applyOptions` merge unable to carry anything across a re-purpose.
    for (const style of EVERY_STYLE) {
      const pk = poolKey(bareplot(style))
      if (pk === null) continue
      const decorated = {
        ...bareplot(style),
        color: '#123456', width: 4, lineStyle: 'largeDashed', precision: 7, opacity: 'band',
        colorMode: 'sign', colorUp: '#0f0', colorDown: '#f00',
      }
      expect(Object.keys(seriesOptionsForPlot(decorated, { scaleId: 's' })).sort(), style)
        .toEqual([...COMPLETE_KEYS[pk]].sort())
    }
  })

  it('every SHIPPED plot emits its pool key\'s full key set too', () => {
    for (const def of registry.listDefinitions()) {
      for (const plot of def.plots) {
        const pk = poolKey(plot)
        const o = seriesOptionsForPlot(plot, { scaleId: 'x' })
        if (pk === null) { expect(o, `${def.id}.${plot.key}`).toBeNull(); continue }
        expect(Object.keys(o).sort(), `${def.id}.${plot.key}`).toEqual([...COMPLETE_KEYS[pk]].sort())
      }
    }
  })

  it('`priceScaleId` is ALWAYS present — a pooled series must never keep the old scale', () => {
    // C-2's other half. `placement` now returns a concrete id for price overlays,
    // and this is the belt: with no scale id at all the answer is the candles'
    // scale, never "leave `priceScaleId` off the object".
    for (const ctx of [undefined, {}, { scaleId: null }, { scaleId: '' }, { scaleId: 7 }]) {
      const o = seriesOptionsForPlot(plotOf('bb', 'upper'), ctx)
      expect(o.priceScaleId, JSON.stringify(ctx)).toBe(MAIN_PRICE_SCALE_ID)
    }
    expect(seriesOptionsForPlot(plotOf('rsi', 'rsi'), { scaleId: 'rsi' }).priceScaleId).toBe('rsi')
  })

  it('`visible` follows the declutter toggle, so a re-bind cannot un-hide a series', () => {
    // Alt+Shift+I applies `visible:false` to every engine series. The binder
    // re-asserts the full set on every paint (~1/s in extended hours), so without
    // this the next paint would silently show the indicator again.
    const plot = plotOf('rsi', 'rsi')
    expect(seriesOptionsForPlot(plot, {}).visible).toBe(true)
    expect(seriesOptionsForPlot(plot, { indicatorsHidden: false }).visible).toBe(true)
    expect(seriesOptionsForPlot(plot, { indicatorsHidden: true }).visible).toBe(false)
  })

  it('an option no plot declares is restored to LWC\'s OWN default, not to a guess', () => {
    // Readable restatement of the values, so the expected picture is visible at
    // the point of use. It is NOT the drift guard — it hand-copies the same
    // literals `pool.js` does, so an upstream change leaves both stale and this
    // green. The guard is 'LWC_DEFAULTS is pinned against the INSTALLED
    // lightweight-charts' at the bottom of this file, which reads the real
    // `defaultOptions`. Keep both: this one says WHAT, that one says STILL TRUE.
    const line = seriesOptionsForPlot(bareplot('line'), {})
    expect(line.color).toBe('#2196f3')          // lineStyleDefaults.color
    expect(line.lineStyle).toBe(0)              // LineStyle.Solid
    expect(line.lineType).toBe(0)               // LineType.Simple
    expect(line.pointMarkersVisible).toBe(false)
    expect(seriesOptionsForPlot(bareplot('histogram'), {}).color).toBe('#26a69a')

    const area = seriesOptionsForPlot(bareplot('area'), {})
    expect(area.lineColor).toBe('#33D778')
    expect(area.topColor).toBe('rgba( 46, 220, 135, 0.4)')
    expect(area.bottomColor).toBe('rgba( 40, 221, 100, 0)')

    const baseline = seriesOptionsForPlot(bareplot('baseline'), {})
    expect(baseline.topLineColor).toBe('rgba(38, 166, 154, 1)')
    expect(baseline.bottomLineColor).toBe('rgba(239, 83, 80, 1)')
  })

  it('a `stepline` says WithSteps and everything else says Simple — never inherited', () => {
    const step = { key: 'x', style: 'stepline' }
    expect(seriesOptionsForPlot(step, { LineType: { Simple: 0, WithSteps: 1, Curved: 2 } }).lineType).toBe(1)
    expect(seriesOptionsForPlot(step, {}).lineType, 'no enum in hand ⇒ the frozen fallback').toBe(1)
    expect(seriesOptionsForPlot(plotOf('rsi', 'rsi'), {}).lineType).toBe(0)
  })
})

// ─── I-2: area and baseline get colour options those types actually have ────

describe('per-type colour mapping — `color` is one field, the four types spell it four ways', () => {
  it('an AREA takes lineColor + a gradient derived from it, never `color`', () => {
    // `AreaStyleOptions` (5.2.0 typings) has topColor / bottomColor / lineColor
    // and NO `color`. Emitting `color` validated, registered, pooled — and then
    // dropped the author's colour and rendered in LWC's palette.
    const o = seriesOptionsForPlot({ key: 'x', style: 'area', color: '#ff0000' }, {})
    expect('color' in o).toBe(false)
    expect(o.lineColor).toBe('#ff0000')
    expect(o.topColor).toBe('rgba(255, 0, 0, 0.4)')
    expect(o.bottomColor).toBe('rgba(255, 0, 0, 0)')
  })

  it('a BASELINE takes topLineColor, never `color`', () => {
    const o = seriesOptionsForPlot({ key: 'x', style: 'baseline', color: '#00ff00' }, {})
    expect('color' in o).toBe(false)
    expect(o.topLineColor).toBe('#00ff00')
    // STATED LIMIT: the bottom half needs a second colour the v1 vocabulary
    // cannot express, so it is re-asserted at LWC's default rather than guessed.
    expect(o.bottomLineColor).toBe('rgba(239, 83, 80, 1)')
  })

  it('an unparseable colour still reaches the line and leaves the fill transparent', () => {
    const o = seriesOptionsForPlot({ key: 'x', style: 'area', color: 'rebeccapurple' }, {})
    expect(o.lineColor).toBe('rebeccapurple')
    expect(o.topColor).toBe('rebeccapurple')
    expect(o.bottomColor).toBe('rgba(0, 0, 0, 0)')
  })
})

// ─── I-4: `plots[].opacity` was validated, documented, and read by nothing ──

describe('plots[].opacity — the schema advertised it, now something resolves it', () => {
  it('an ALPHA ramp step name dims the colour', () => {
    const o = seriesOptionsForPlot({ key: 'x', style: 'line', color: '#ffffff', opacity: 'band' }, {})
    expect(o.color).toBe('rgba(255, 255, 255, 0.16)')     // ALPHA.band
  })

  it('a number in [0,1] dims it too, and MULTIPLIES through an existing alpha', () => {
    expect(seriesOptionsForPlot({ key: 'x', style: 'line', color: '#ffffff', opacity: 0.5 }, {}).color)
      .toBe('rgba(255, 255, 255, 0.5)')
    expect(seriesOptionsForPlot({ key: 'x', style: 'line', color: 'rgba(255,0,0,0.4)', opacity: 0.5 }, {}).color)
      .toBe('rgba(255, 0, 0, 0.2)')
  })

  it('an unknown ramp step leaves the colour ALONE rather than inventing an alpha', () => {
    expect(plotAlpha({ opacity: 'not-a-step' })).toBeNull()
    expect(seriesOptionsForPlot({ key: 'x', style: 'line', color: '#ffffff', opacity: 'not-a-step' }, {}).color)
      .toBe('#ffffff')
  })

  it('no opacity ⇒ the colour is untouched, byte for byte', () => {
    expect(plotAlpha({})).toBeNull()
    expect(seriesOptionsForPlot(plotOf('rsi', 'rsi'), {}).color).toBe('#7b68ee')
  })

  it('it reaches an area\'s FILL as well as its line', () => {
    const o = seriesOptionsForPlot({ key: 'x', style: 'area', color: '#ffffff', opacity: 0.5 }, {})
    expect(o.lineColor).toBe('rgba(255, 255, 255, 0.5)')
    expect(o.topColor).toBe('rgba(255, 255, 255, 0.2)')   // 0.5 × the 0.4 gradient top
  })
})

// ─── C-3: MACD's histogram draws green above zero and red below ─────────────

describe('signColorsForPlot — colorMode "sign" is two colours or it is nothing', () => {
  it('MACD\'s histogram carries StockChart\'s own two colours', () => {
    expect(signColorsForPlot(plotOf('macd', 'histogram')))
      .toEqual({ up: 'rgba(76,175,80,0.75)', down: 'rgba(244,67,54,0.75)' })
  })

  it('every OTHER shipped plot has none — sign colouring is not the default', () => {
    for (const def of registry.listDefinitions()) {
      for (const plot of def.plots) {
        if (def.id === 'macd' && plot.key === 'histogram') continue
        expect(signColorsForPlot(plot), `${def.id}.${plot.key}`).toBeNull()
      }
    }
  })

  it('a mode that is not "sign" — including column:<key> — returns null', () => {
    expect(signColorsForPlot({ style: 'line', colorMode: 'fixed', colorUp: '#0f0', colorDown: '#f00' })).toBeNull()
    expect(signColorsForPlot({ style: 'line', colorMode: 'column:foo' })).toBeNull()
  })

  it('opacity dims both sides', () => {
    expect(signColorsForPlot({ style: 'histogram', colorMode: 'sign', colorUp: '#ffffff', colorDown: '#000000', opacity: 0.5 }))
      .toEqual({ up: 'rgba(255, 255, 255, 0.5)', down: 'rgba(0, 0, 0, 0.5)' })
  })
})

describe('bindingKey / guideSignature', () => {
  it('the binding key is instance + plot, so two instances of one definition never collide', () => {
    expect(bindingKey('a', 'rsi')).toBe('a::rsi')
    expect(bindingKey('a', 'rsi')).not.toBe(bindingKey('b', 'rsi'))
  })

  it('the guide signature changes when a level, colour or width does', () => {
    const base = [{ key: 'bands', levels: [70, 30], color: '#fff', width: 1 }]
    expect(guideSignature(base)).toBe(guideSignature([{ ...base[0] }]))
    expect(guideSignature([{ ...base[0], levels: [80, 20] }])).not.toBe(guideSignature(base))
    expect(guideSignature([{ ...base[0], color: '#000' }])).not.toBe(guideSignature(base))
    expect(guideSignature([{ ...base[0], width: 2 }])).not.toBe(guideSignature(base))
    expect(guideSignature([])).toBe(guideSignature(null))
  })
})

// ─── The drift rail for LWC_DEFAULTS ─────────────────────────────────────────
//
// C-1's whole guarantee is "an option no plot declares is restored to LWC's OWN
// default" — so that a pooled series re-purposed by a plot that is silent about
// an option ends up in EXACTLY the state a freshly-created one would be in.
// `pool.js` spells those defaults out as literals, because it is a pure module
// and must not import the renderer.
//
// Until this block existed, `pool.js`'s docstring claimed "`pool.test.js` pins
// them against the installed bundle" and the test underneath it hand-copied the
// same eleven literals a second time. It asserted one hand-copy against another:
// green by construction, and blind to the only thing it claimed to guard. Bump
// `lightweight-charts` to a version where `areaStyleDefaults.topColor` moves and
// BOTH copies stay stale, the suite stays green, and every bare area/baseline
// plot re-asserts a WRONG "LWC default" onto a pooled series — quietly turning
// the guarantee into "restore to lightweight-charts 5.2.0's default".
//
// These read `defaultOptions` off the installed series definitions, so a
// dependency bump that moves a default fails here, by name, with both values.
// ─── N-4: `plots[].precision` reaches every plot, not just histograms ────────
//
// It was validated by `defSchema` for ANY plot and read only on the histogram
// branch of `seriesOptionsForPlot`. A `line`/`area`/`baseline` plot declaring
// `precision: 5` therefore got no `priceFormat` at all and rendered with LWC's
// default 2-decimal axis labels — silently, because nothing in the schema, the
// registry or the tests connected the two. Third member of the family I-2 and
// I-4 closed; resolved the same way I-4 was, by wiring it.
describe('`plots[].precision` is honoured on every pool key', () => {
  const withPrecision = (style, precision) => ({ ...bareplot(style), precision })

  it('a declared precision reaches the series on EVERY pool key', () => {
    for (const style of ['line', 'area', 'baseline', 'histogram', 'stepline', 'markers']) {
      const o = seriesOptionsForPlot(withPrecision(style, 5), {})
      expect(o.priceFormat, style).toEqual({ type: 'price', precision: 5 })
    }
  })

  it("silence means LWC's OWN default, so a Flip A migration sees no change", () => {
    // 2 is `seriesOptionsDefaults.priceFormat.precision` in the installed bundle
    // (asserted against the real value, not a hand-copy). That is what makes it
    // safe to emit this key unconditionally: for every plot that says nothing —
    // which today is every plot except MACD's histogram — the object the engine
    // applies is the state the series is already in.
    for (const style of ['line', 'area', 'baseline', 'histogram']) {
      expect(seriesOptionsForPlot(bareplot(style), {}).priceFormat, style)
        .toEqual({ type: 'price', precision: 2 })
    }
  })

  it('an absurd or non-integer precision falls back rather than reaching LWC', () => {
    // `defSchema` rejects these at registration; this is the second lock, and it
    // matters because `priceFormat` is one of the few options that can throw
    // inside the renderer rather than just look wrong.
    for (const bad of [undefined, null, NaN, Infinity, '3', {}]) {
      expect(seriesOptionsForPlot({ ...bareplot('line'), precision: bad }, {}).priceFormat)
        .toEqual({ type: 'price', precision: 2 })
    }
    expect(seriesOptionsForPlot({ ...bareplot('line'), precision: 0 }, {}).priceFormat)
      .toEqual({ type: 'price', precision: 0 })
  })

  it("MACD's shipped histogram still asks for 5, exactly as the legacy call did", () => {
    // `StockChart.jsx:6018` — `priceFormat: {type: 'price', precision: 5}`. The
    // registry declares `precision: 5` on that plot and nowhere else, which is
    // why this whole field was latent: engine and legacy already agreed.
    const hist = registry.getDefinition('macd').plots.find(p => p.key === 'histogram')
    expect(hist.precision).toBe(5)
    expect(seriesOptionsForPlot(hist, {}).priceFormat).toEqual({ type: 'price', precision: 5 })
  })

  it("a pooled series cannot inherit the last tenant's precision", () => {
    // The C-1 property, on the new key: MACD's histogram (precision 5) and any
    // other histogram share a pool key, so the one that declares nothing must
    // still say 2 rather than leave 5 in place.
    const macdHist = registry.getDefinition('macd').plots.find(p => p.key === 'histogram')
    expect(seriesOptionsForPlot(macdHist, {}).priceFormat.precision).toBe(5)
    expect(seriesOptionsForPlot(bareplot('histogram'), {}).priceFormat.precision).toBe(2)
  })
})

describe('LWC_DEFAULTS is pinned against the INSTALLED lightweight-charts', () => {
  const REAL = {
    line: LineSeries.defaultOptions,
    histogram: HistogramSeries.defaultOptions,
    area: AreaSeries.defaultOptions,
    baseline: BaselineSeries.defaultOptions,
  }

  /** poolKey → the option keys whose value must be LWC's own default when the
   *  plot declares nothing. The eleven COLOURS `LWC_DEFAULTS` hard-codes. */
  const LWC_COLOURS = {
    line: ['color'],
    histogram: ['color'],
    area: ['lineColor', 'topColor', 'bottomColor'],
    baseline: [
      'topLineColor', 'bottomLineColor',
      'topFillColor1', 'topFillColor2', 'bottomFillColor1', 'bottomFillColor2',
    ],
  }

  /** The same contract for the non-colour options the line family resets. */
  const LWC_SHAPE = {
    line: ['lineStyle', 'lineType', 'pointMarkersVisible'],
    area: ['lineStyle', 'lineType', 'pointMarkersVisible'],
    baseline: ['lineStyle', 'lineType', 'pointMarkersVisible'],
  }

  it('the installed bundle actually exposes defaults (an empty read would pass vacuously)', () => {
    expect(typeof lwcVersion === 'function' ? lwcVersion() : lwcVersion).toBeTypeOf('string')
    for (const [pk, defaults] of Object.entries(REAL)) {
      expect(defaults, `${pk}: no defaultOptions on the series definition`).toBeTypeOf('object')
      expect(Object.keys(defaults || {}).length, pk).toBeGreaterThan(0)
    }
    // Every key this block asserts on must EXIST upstream. A renamed option
    // would otherwise compare undefined-to-undefined and pass silently.
    for (const [pk, keys] of Object.entries({ ...LWC_COLOURS })) {
      for (const key of keys) {
        expect(REAL[pk][key], `lightweight-charts ${pk}.${key} is gone`).toBeTypeOf('string')
      }
    }
    for (const [pk, keys] of Object.entries(LWC_SHAPE)) {
      for (const key of keys) {
        expect(REAL[pk][key], `lightweight-charts ${pk}.${key} is gone`).toBeDefined()
      }
    }
    // Eleven colours, stated as a number so a table edit that drops one is loud.
    expect(Object.values(LWC_COLOURS).reduce((n, k) => n + k.length, 0)).toBe(11)
  })

  for (const [pk, keys] of Object.entries(LWC_COLOURS)) {
    for (const key of keys) {
      it(`a bare ${pk} plot's \`${key}\` is the installed bundle's own default`, () => {
        const emitted = seriesOptionsForPlot(bareplot(pk), {})
        expect(
          emitted[key],
          `pool.js hard-codes ${pk}.${key}; lightweight-charts ` +
          `${typeof lwcVersion === 'function' ? lwcVersion() : lwcVersion} now says ` +
          `${JSON.stringify(REAL[pk][key])}. Update LWC_DEFAULTS — a stale copy means a ` +
          `pooled series is "reset" to a value the renderer no longer uses.`,
        ).toBe(REAL[pk][key])
      })
    }
  }

  for (const [pk, keys] of Object.entries(LWC_SHAPE)) {
    for (const key of keys) {
      it(`a bare ${pk} plot's \`${key}\` is the installed bundle's own default`, () => {
        expect(seriesOptionsForPlot(bareplot(pk), {})[key]).toBe(REAL[pk][key])
      })
    }
  }

  it('`lineWidth` is the ONE deliberate divergence, and it is stated here', () => {
    // Not a drift: every indicator line in `StockChart.jsx` is created at 1, so 1
    // is what "the author did not say" must mean for a Flip A migration to stay
    // pixel-identical. LWC's own default is 3. Asserting the divergence keeps it
    // a decision rather than an oversight — and fails if LWC ever ships 1, at
    // which point the comment in `pool.js` stops being true.
    expect(REAL.line.lineWidth).toBe(3)
    for (const pk of ['line', 'area', 'baseline']) {
      expect(seriesOptionsForPlot(bareplot(pk), {}).lineWidth, pk).toBe(1)
    }
  })
})
