import { describe, it, expect } from 'vitest'
import {
  POOL_KEYS,
  poolKey,
  bindingKey,
  guideSignature,
  planBindings,
  firstBindNeedsSetData,
  seriesOptionsForPlot,
  resolvePlotForInstance,
  lineStyleValue,
} from './pool'
import * as registry from './nativeRegistry'

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
    expect(o).toEqual({
      priceScaleId: 'rsi',
      color: '#7b68ee',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
  })

  it('an UNDECLARED lineStyle stays undeclared — absent means "leave the series alone"', () => {
    expect('lineStyle' in seriesOptionsForPlot(plotOf('rsi', 'rsi'), {})).toBe(false)
    expect(seriesOptionsForPlot(plotOf('bb', 'upper'), {}).lineStyle).toBe(2)   // dashed
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
