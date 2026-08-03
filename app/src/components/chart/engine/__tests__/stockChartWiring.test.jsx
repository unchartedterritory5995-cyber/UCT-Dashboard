import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'

// ─── The wiring test (Task 7) ───────────────────────────────────────────────
//
// Every other engine suite tests a DECISION. This one tests the one thing none
// of them can see: that the engine is actually connected to StockChart, and —
// far more importantly — that while the flag is off it is connected to NOTHING.
//
// "The engine lands dark" is the whole safety story of Phase B2, and it is only
// true if the component never even constructs a binder. A unit test of
// `binder.sync({enabled:false})` proves the binder behaves; it cannot prove the
// call site respects the flag, which is where a regression would actually live.
//
// The lightweight-charts double is the `StockChart.smoke.test.jsx:13-39` stub
// with one change: `addSeries` RECORDS. Counting series creations is how "zero
// series calls with the flag on and no instances" becomes an assertion rather
// than a claim.

const H = vi.hoisted(() => ({
  addSeriesCalls: [],
  removedSeries: [],
  visibilityCalls: [],
  // EVERY `series.applyOptions`, not just the `visible` ones. A POOLED series is
  // re-purposed through `applyOptions` and never through `addSeries`, so without
  // this the whole re-purpose path — the one B2's Critical #2 lived on — is
  // invisible from the component level: the series that changed tenant is not in
  // `addSeriesCalls` a second time and nothing records what it was told.
  applyOptionsCalls: [],
  // Every `series.createPriceLine`, with the series it was created ON. RSI is
  // the only migrated indicator that draws GUIDES (70/50/30), and the orphan the
  // mid-session gate below exists to catch is a dead line PLUS three dead guides
  // — `removeSeries` is what takes the guides with it, so "which series owns this
  // guide" has to be observable or that half of the symptom is unassertable.
  priceLineCalls: [],
  moveToPaneCalls: [],
  binderCreated: [],
  binderApis: [],
  syncCalls: [],
  crosshairHandlers: [],
  reset() {
    H.addSeriesCalls.length = 0
    H.removedSeries.length = 0
    H.visibilityCalls.length = 0
    H.applyOptionsCalls.length = 0
    H.priceLineCalls.length = 0
    H.moveToPaneCalls.length = 0
    H.binderCreated.length = 0
    H.binderApis.length = 0
    H.syncCalls.length = 0
    H.crosshairHandlers.length = 0
  },
}))

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor) => {
    const s = {
      __ctor: ctor,
      setData: () => {}, update: () => {},
      applyOptions: (o) => {
        H.applyOptionsCalls.push({ series: s, options: o })
        if (o && 'visible' in o) H.visibilityCalls.push({ series: s, visible: o.visible })
      },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: (o) => { H.priceLineCalls.push({ series: s, options: o }); return {} },
      removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      // RECORDED. `binder.moveToPane` relocates a POOLED series between panes via
      // `removeDataSource` + `_addSeriesToPane`, which APPENDS — so a relocated
      // series lands on top of its new pane and the z-order rails below, which
      // read `addSeriesCalls` order, cannot see it. Recording the call is what
      // turns that blind spot into a rail with an expiry condition.
      moveToPane: (paneIndex) => { H.moveToPaneCalls.push({ series: s, paneIndex }) },
      getPane: () => ({ getHeight: () => 300 }),
    }
    return s
  }
  // With REAL bars the component runs far more of itself than the smoke test
  // does (pattern overlays, callout overlays, range subscriptions), and each of
  // those reaches for another time-scale method. A proxy answers anything
  // unlisted with a no-op so this double does not have to chase the surface —
  // the explicit entries are the ones whose RETURN VALUE the component reads.
  const timeScaleBase = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
    getVisibleRange: () => null, setVisibleRange: () => {}, scrollToPosition: () => {}, scrollPosition: () => 0,
    timeToCoordinate: () => 0, coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({}), width: () => 600, height: () => 40, barSpacing: () => 6,
  }
  const timeScale = new Proxy(timeScaleBase, {
    get: (t, p) => {
      if (p in t) return t[p]
      if (typeof p === 'symbol' || p === 'then') return undefined
      return () => undefined
    },
  })
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const s = makeSeries(ctor)
      H.addSeriesCalls.push({ ctor, options, paneIndex, series: s })
      return s
    },
    addCustomSeries: (_impl, options, paneIndex) => {
      const s = makeSeries('custom')
      H.addSeriesCalls.push({ ctor: 'custom', options, paneIndex, series: s })
      return s
    },
    // RECORDED, like `addSeries`. `addSeriesCalls` is cumulative across
    // rerenders — it logs the CALL, not the chart's current contents — so
    // "the line went away" is only assertable if removal is observed too.
    removeSeries: (s) => { H.removedSeries.push(s) },
    applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    // The crosshair handler is CAPTURED, not swallowed. Everything the legend
    // does — including the B3 carry #2 bridge that keeps a migrated indicator in
    // the readout — lives inside it, and a double that drops the callback makes
    // every legend assertion below unreachable.
    subscribeCrosshairMove: (fn) => { H.crosshairHandlers.push(fn) },
    unsubscribeCrosshairMove: (fn) => {
      const i = H.crosshairHandlers.indexOf(fn); if (i >= 0) H.crosshairHandlers.splice(i, 1)
    },
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries', LineSeries: 'LineSeries',
    AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries', BarSeries: 'BarSeries',
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

// The REAL binder, wrapped so its construction and every `sync` are observable.
// A fully faked binder would make "zero series calls" vacuous — the assertion
// only means something if the thing that would have made the calls really ran.
vi.mock('../binder', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    createBinder: (deps) => {
      const real = actual.createBinder(deps)
      H.binderCreated.push(deps)
      const api = {
        sync: (ctx) => { H.syncCalls.push(ctx); return real.sync(ctx) },
        teardown: real.teardown,
        bindings: real.bindings,
      }
      H.binderApis.push(api)
      return api
    },
  }
})

vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// jsdom has no 2D canvas. With real bars in hand StockChart gets far enough to
// run its volume-profile redraw, which the smoke test never reaches — so the
// overlay canvases need a context that records nothing and draws nothing.
const CANVAS_2D_NOOPS = [
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
  'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform',
  'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData',
]
function fakeCanvasContext() {
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of CANVAS_2D_NOOPS) ctx[m] = () => {}
  return ctx
}
HTMLCanvasElement.prototype.getContext = function getContext() { return fakeCanvasContext() }

beforeEach(() => {
  cleanup()
  H.reset()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

const { default: StockChart, ENGINE_MIGRATED_DEF_IDS } = await import('../../../StockChart')
const registry = await import('../nativeRegistry')
// The two settings ALLOW-LISTS a migrated instance has to survive — see the
// round-trip suite at the bottom of this file.
const { mergeChartSettings, mergeSettingsOverride } = await import('../../chartDefaults')

const BARS = bars200.bars
const RSI_INSTANCE = { instanceId: 'engine-test:rsi', defId: 'rsi', inputs: { period: 14, color: '#7b68ee' }, hidden: false }

const draw = (settingsOverride) => render(
  <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settingsOverride} />,
)

describe('StockChart × indicator engine — the flag OFF is the whole safety story', () => {
  it('never constructs a binder and never calls sync while the flag is off', () => {
    draw(undefined)
    expect(H.binderCreated).toHaveLength(0)
    expect(H.syncCalls).toHaveLength(0)
  })

  it('stays dark even with instances stored in the blob', () => {
    // The realistic B3 crossover state: instances migrated into the settings, the
    // flag not yet flipped. Data present must not be enough to start rendering.
    draw({ indicatorInstances: [RSI_INSTANCE] })
    expect(H.binderCreated).toHaveLength(0)
    expect(H.syncCalls).toHaveLength(0)
  })

  it('treats a truthy-but-not-true flag as OFF', () => {
    // `mergeChartSettings` reads `engineEnabled === true`. A "1" out of a URL
    // param or a leftover string must not light up a second render path.
    for (const value of ['1', 1, 'true', {}]) {
      cleanup(); H.reset()
      draw({ engineEnabled: value })
      expect(H.binderCreated, `engineEnabled: ${JSON.stringify(value)}`).toHaveLength(0)
    }
  })
})

describe('StockChart × indicator engine — the flag ON', () => {
  it('constructs exactly ONE binder and syncs it on every updateChart pass', () => {
    draw({ engineEnabled: true })
    // One binder for the life of the chart — not one per paint. A binder rebuilt
    // each pass would hold no previous bindings, so every series would be created
    // fresh and the pool would never pool.
    expect(H.binderCreated).toHaveLength(1)
    expect(H.syncCalls.length).toBeGreaterThan(0)
  })

  it('hands the binder a ctx that satisfies its stated requirements', () => {
    draw({ engineEnabled: true })
    for (const ctx of H.syncCalls) {
      // `binder.sync` makes ZERO calls and says "no placement resolver" without
      // this one — the contract Task 6 exists to satisfy.
      expect(typeof ctx.resolvePlacement).toBe('function')
      expect(ctx.enabled).toBe(true)
      expect(ctx.registry).toBeTruthy()
      expect(typeof ctx.registry.getDefinition).toBe('function')
      // The render plan is a LOCAL of updateChart; if this is ever empty the
      // engine has been lifted out of the function and the plan is being guessed.
      expect(ctx.plan).toBeTruthy()
      expect(typeof ctx.plan.noop).toBe('boolean')
      expect(ctx.paneMargins).toBeTruthy()
      expect(ctx.VOL_PANE_INDEX).toBe(1)
      expect(typeof ctx.adjustTime).toBe('function')
      expect(typeof ctx.applyData).toBe('function')
      expect(Array.isArray(ctx.bars)).toBe(true)
      // `visible` is part of the option set the binder re-asserts on every bind,
      // so the declutter toggle's state has to arrive with the rest of the ctx —
      // otherwise the next paint silently re-shows a hidden indicator.
      expect(typeof ctx.indicatorsHidden).toBe('boolean')
    }
  })

  it('makes ZERO series calls with the flag on and no instances', () => {
    // The number of series the chart creates must be IDENTICAL to the flag-off
    // render. Anything the engine adds while it has nothing to draw is a pixel
    // it had no right to paint.
    draw(undefined)
    const darkSeries = H.addSeriesCalls.length
    cleanup(); H.reset()

    draw({ engineEnabled: true })
    expect(H.syncCalls.length).toBeGreaterThan(0)
    expect(H.addSeriesCalls).toHaveLength(darkSeries)
  })

  it('draws an engine instance — one more series than the same chart dark', () => {
    draw({ engineEnabled: true })
    const noInstances = H.addSeriesCalls.length
    cleanup(); H.reset()

    // ⚠️ `indicators.rsi.enabled` IS THE CROSSOVER STATE, not decoration. Under
    // Flip A the legacy toggle is still the switch (`StockChart.jsx`, the
    // `legacyEnabled` projection): it reserves the band `computePaneMargins`
    // hands the engine, and an instance whose toggle is off is treated as hidden
    // so Ctrl+I and the toolbar checkbox keep working. Every case in this file
    // that draws an engine instance therefore states the toggle.
    draw({ engineEnabled: true, indicators: { rsi: { enabled: true } }, indicatorInstances: [RSI_INSTANCE] })
    // RSI declares one data-bearing plot (its two guide plots are price lines on
    // that same series, not series of their own).
    expect(H.addSeriesCalls.length).toBe(noInstances + 1)
    // Found by its SCALE, not by position: the engine's call site sits before the
    // volume block and every legacy indicator block, so it is not the last one.
    const added = H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi')
    expect(added).toHaveLength(1)
    expect(added[0].ctor).toBe('LineSeries')   // pool key = the LWC constructor
    expect(added[0].paneIndex).toBe(0)         // Flip A: a band inside pane 0
  })
})

// ─── the crossover: ONE RSI on the chart, never two (Task 8) ────────────────
//
// Flip A renders the engine's RSI into the SAME band on the SAME price scale as
// the legacy block, and that band exists only while `cs.indicators.rsi.enabled`
// is true — `computePaneMargins` reads exactly that. So the legacy toggle has to
// STAY ON for the layout to be identical, which means the legacy block would
// draw a second copy unless something stands it down. `engineOwnedDefIds` is
// that something, and this is where the component honours it.
//
// The pixel gate (`--cases engine_rsi_vs_legacy`, 0 changed pixels) is the real
// proof; two RSI lines would trivially fail it. This is the version that runs on
// every commit.
describe('legacy suppression — an engine instance stands its legacy block down', () => {
  const RSI_ON = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
  const rsiSeries = () => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi')

  it('draws exactly one RSI series with the engine OFF (the shipped behaviour)', () => {
    draw(RSI_ON)
    expect(rsiSeries()).toHaveLength(1)
  })

  it('STILL draws exactly one when the engine owns it — and it is the ENGINE\'s', () => {
    draw({ ...RSI_ON, engineEnabled: true, indicatorInstances: [RSI_INSTANCE] })

    const drawn = rsiSeries()
    expect(drawn, 'two RSI lines on one scale is not parity, it is a different picture').toHaveLength(1)

    // Which one survived is the whole question. Identified by the binder's own
    // holdings rather than by call order, because "the engine's series is not the
    // last addSeries" is already a documented property of this call site.
    const owned = H.binderApis[0].bindings().map(b => b.series)
    expect(owned).toHaveLength(1)
    expect(drawn[0].series).toBe(owned[0])
  })

  it('leaves every OTHER legacy indicator alone — ownership is per definition', () => {
    // An RSI instance must not silence MACD. If it did, B3's first migration
    // would blank fourteen indicators at once.
    const both = { indicators: { ...RSI_ON.indicators, macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } } }
    draw(both)
    const legacyMacd = H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'macd').length
    expect(legacyMacd).toBeGreaterThan(0)
    cleanup(); H.reset()

    draw({ ...both, engineEnabled: true, indicatorInstances: [RSI_INSTANCE] })
    expect(rsiSeries()).toHaveLength(1)
    expect(H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'macd').length).toBe(legacyMacd)
  })

  it('a HIDDEN instance draws NOTHING — it does not hand the legacy block back', () => {
    // Ownership is authority, not paint: the engine skips a hidden instance, and
    // if hiding also released authority the user would hide RSI and watch the
    // legacy copy appear in its place.
    draw({ ...RSI_ON, engineEnabled: true, indicatorInstances: [{ ...RSI_INSTANCE, hidden: true }] })
    expect(rsiSeries()).toHaveLength(0)
  })

  it('an instance the VALIDATOR drops owns nothing — ownership follows the binder', () => {
    // `bogus` is not a declared RSI input, so `normalizeInstances` drops the
    // whole record and the binder never sees it. If ownership were read off the
    // RAW blob instead of the normalised list, the legacy block would stand down
    // for an instance nobody is going to draw and RSI would vanish from the
    // chart — the worst outcome available here, because the settings still say
    // it is on.
    draw({
      ...RSI_ON,
      engineEnabled: true,
      indicatorInstances: [{ ...RSI_INSTANCE, inputs: { ...RSI_INSTANCE.inputs, bogus: 1 } }],
    })
    expect(H.binderApis[0].bindings(), 'the binder must have refused it').toHaveLength(0)
    expect(rsiSeries()).toHaveLength(1)
  })

  it('an instance of an UNKNOWN definition owns nothing — legacy keeps drawing', () => {
    // The binder cannot render it, so standing the legacy block down on its
    // behalf would erase RSI from the chart entirely.
    draw({ ...RSI_ON, engineEnabled: true, indicatorInstances: [{ ...RSI_INSTANCE, defId: 'not-an-indicator' }] })
    expect(rsiSeries()).toHaveLength(1)
    expect(H.binderApis[0].bindings()).toHaveLength(0)
  })
})

// ─── M-2: the double-draw rail ──────────────────────────────────────────────
//
// `engineOwnedDefIds` decides which legacy blocks stand down; the binder
// separately draws whatever instances it is handed. Those are two decisions, and
// they could disagree — an instance of a definition whose legacy block has no
// `!engineOwned.has(...)` guard meant BOTH drew it, on the same scale, in the
// same band. The symptom is a slightly bolder line and nothing else. The
// documented B3 obligation was "one line per migrated indicator", and nothing
// FAILED if B3 forgot one. `ENGINE_MIGRATED_DEF_IDS` pairs the two, and this is
// the test that makes forgetting fail.

describe('a migrated definition is drawn ONCE — never by the engine and legacy both', () => {
  const instanceOf = (defId) => ({ instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false })

  it('names at least one definition — otherwise every case below is vacuous', () => {
    expect(ENGINE_MIGRATED_DEF_IDS.size).toBeGreaterThan(0)
  })

  it.each([...ENGINE_MIGRATED_DEF_IDS])(
    '%s: legacy toggle ON + an engine instance ⇒ the SAME number of series as legacy alone',
    (defId) => {
      // Series COUNT, not scale id: it holds for a price overlay (which has no
      // named scale) exactly as it does for a banded oscillator, so B3 can add an
      // id here without also writing a bespoke assertion.
      const legacyOn = { indicators: { [defId]: { enabled: true } } }
      draw(legacyOn)
      const legacyOnly = H.addSeriesCalls.length
      expect(legacyOnly, `${defId} drew nothing with the engine off`).toBeGreaterThan(0)
      cleanup(); H.reset()

      draw({ ...legacyOn, engineEnabled: true, indicatorInstances: [instanceOf(defId)] })
      expect(H.binderApis[0].bindings().length, `the engine bound nothing for ${defId}`).toBeGreaterThan(0)
      expect(H.addSeriesCalls.length, `${defId} is drawn twice — its legacy block has no guard`)
        .toBe(legacyOnly)
    },
  )

  it('an instance of a NOT-yet-migrated definition is refused rather than double-drawn', () => {
    const notMigrated = registry.listDefinitions()
      .map(d => d.id)
      .filter(id => !ENGINE_MIGRATED_DEF_IDS.has(id))
    expect(notMigrated.length, 'every definition is migrated — this case is now empty').toBeGreaterThan(0)

    const defId = notMigrated[0]
    const legacyOn = { indicators: { [defId]: { enabled: true } } }
    draw(legacyOn)
    const legacyOnly = H.addSeriesCalls.length
    cleanup(); H.reset()

    draw({ ...legacyOn, engineEnabled: true, indicatorInstances: [instanceOf(defId)] })
    // The binder never sees it, so it cannot draw a second copy …
    expect(H.binderApis[0].bindings()).toHaveLength(0)
    // … and the legacy block is untouched, so the indicator is still on the chart.
    expect(H.addSeriesCalls.length).toBe(legacyOnly)
  })
})

// ─── I-3: series creation ORDER, which LWC turns into z-order ───────────────

describe('an engine series is inserted where its legacy twin would have been', () => {
  // Under Flip A everything shares pane 0 — candles, volume, the MA overlays,
  // every price overlay, every oscillator band — and lightweight-charts z-orders
  // by INSERTION ORDER. The call site used to sit before the volume block, so an
  // engine-drawn price overlay painted UNDER the MA overlays and the volume bars
  // that its legacy twin paints over. Invisible to the RSI rehearsal by
  // construction: RSI has its own scale in its own band and overlaps nothing.
  const MA_COLOURS = ['#4ade80', '#f472b6', '#60a5fa', '#fb923c', 'rgba(168,162,144,0.55)']
  const BB_COLOUR = 'rgba(156,39,176,0.85)'
  const idxWhere = (pred) => H.addSeriesCalls.findIndex(c => pred(c.options || {}))
  const lastIdxWhere = (pred) => H.addSeriesCalls.map(c => c.options || {}).reduce(
    (acc, o, i) => (pred(o) ? i : acc), -1,
  )

  it('lands AFTER volume and the MA overlays, and BEFORE the first legacy indicator', () => {
    draw({
      engineEnabled: true,
      indicatorInstances: [RSI_INSTANCE],
      volume: { show: true },
      indicators: { rsi: { enabled: true }, bb: { enabled: true } },
    })

    const engineIdx = idxWhere(o => o.priceScaleId === 'rsi')
    const volumeIdx = idxWhere(o => o.priceFormat && o.priceFormat.type === 'custom')
    const lastMaIdx = lastIdxWhere(o => MA_COLOURS.includes(o.color))
    const bbIdx = idxWhere(o => o.color === BB_COLOUR)

    // Every landmark has to actually be on the chart or the comparisons below are
    // comparisons against -1.
    expect(engineIdx, 'the engine drew nothing').toBeGreaterThan(-1)
    expect(volumeIdx, 'no volume series').toBeGreaterThan(-1)
    expect(lastMaIdx, 'no MA overlays').toBeGreaterThan(-1)
    expect(bbIdx, 'no Bollinger bands').toBeGreaterThan(-1)

    expect(engineIdx).toBeGreaterThan(volumeIdx)
    expect(engineIdx).toBeGreaterThan(lastMaIdx)
    expect(engineIdx).toBeLessThan(bbIdx)
  })

  it('and BEFORE every other legacy indicator block, not just the first', () => {
    draw({
      engineEnabled: true,
      indicatorInstances: [RSI_INSTANCE],
      indicators: { rsi: { enabled: true }, bb: { enabled: true }, macd: { enabled: true }, obv: { enabled: true } },
    })
    const engineIdx = idxWhere(o => o.priceScaleId === 'rsi')
    // -1 is LESS THAN every index, so without this the loop below passes when the
    // engine drew nothing at all.
    expect(engineIdx, 'the engine drew nothing').toBeGreaterThan(-1)
    for (const scale of ['macd', 'obv']) {
      const legacyIdx = idxWhere(o => o.priceScaleId === scale)
      expect(legacyIdx, `${scale} did not draw`).toBeGreaterThan(-1)
      expect(engineIdx, `engine must precede the ${scale} block`).toBeLessThan(legacyIdx)
    }
  })

  it('⏳ EXPIRES when a pooled series first CROSSES PANES — the rails above go blind then', () => {
    // ⚠️ THE BLIND SPOT, WRITTEN AS A RAIL RATHER THAN AS A PARAGRAPH.
    //
    // Both assertions above read `H.addSeriesCalls` ORDER. A pooled series that
    // is relocated by `series.moveToPane(paneIndex)` (`binder.js`) is NOT a new
    // `addSeries` call — LWC's `_internal_moveSeriesToPane` does
    // `removeDataSource` + `_addSeriesToPane`, which **appends** — so the series
    // silently changes its z-position in the new pane and neither rail above can
    // see it. The pixel gate cannot see it either: every parity case is a fresh
    // page load, so it never photographs a transition at all.
    //
    // It is BENIGN TODAY, verified against the installed lightweight-charts
    // 5.2.0: `chart.addSeries` also appends, so a mid-session engine create and a
    // mid-session legacy create land in the same place, and — the reason this
    // test currently passes — the two migrated definitions never cross panes.
    // `rsi` is a pane indicator and `bb` is a price overlay; neither instance
    // moves once bound.
    //
    // It stops being benign when `vwap`/`sar`/`ichimoku`/`donchian` migrate and
    // several pane-crossing overlays are pooled in ONE sync. So this asserts the
    // precondition of the rails above — nothing relocates — and goes RED on the
    // day that stops being true. When it does: do not delete it. Write the
    // ordering assertion it is standing in for, over `H.moveToPaneCalls`.
    draw({
      engineEnabled: true,
      // `BB_INSTANCE` is declared further down the file; a `const` at module
      // scope is fully initialised long before any `it` body runs.
      indicatorInstances: [RSI_INSTANCE, BB_INSTANCE],
      volume: { show: true },
      indicators: { rsi: { enabled: true }, bb: { enabled: true }, macd: { enabled: true } },
    })
    expect(H.binderApis[0].bindings().length, 'the engine bound nothing — vacuous').toBeGreaterThan(0)
    expect(H.moveToPaneCalls, (
      'a pooled series was relocated between panes. The z-order rails in this '
      + 'describe read addSeries ORDER and are now blind to where that series '
      + 'actually paints; the pixel gate never photographs a transition either. '
      + 'Write the real ordering assertion over H.moveToPaneCalls before shipping '
      + 'the migration that did this.'
    )).toHaveLength(0)
  })
})

describe('hide-all-indicators reaches engine series through the binding map', () => {
  const engineSeriesOf = () => H.addSeriesCalls
    .filter(c => c.options && c.options.priceScaleId === 'rsi')
    .map(c => c.series)

  it('hides and re-shows an engine-bound series with the toggle', () => {
    draw({ engineEnabled: true, indicators: { rsi: { enabled: true } }, indicatorInstances: [RSI_INSTANCE] })
    const [engineSeries] = engineSeriesOf()
    expect(engineSeries, 'the engine bound no series — the rest of this test is vacuous').toBeTruthy()

    const hiddenBefore = H.visibilityCalls.filter(v => v.series === engineSeries && v.visible === false)
    expect(hiddenBefore).toHaveLength(0)

    // Alt+Shift+I — the declutter toggle. Dispatched on DOCUMENT, which is where
    // StockChart listens (`:3483`); an event fired at `window` never reaches it.
    const toggle = () => act(() => {
      fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' })
    })

    toggle()
    expect(H.visibilityCalls.filter(v => v.series === engineSeries && v.visible === false).length).toBeGreaterThan(0)

    toggle()
    expect(H.visibilityCalls.filter(v => v.series === engineSeries && v.visible === true).length).toBeGreaterThan(0)
  })

  it('the hidden state reaches the BINDER, so the next paint cannot undo it', () => {
    // The effect above applies `visible:false` once. `updateChart` then runs again
    // on the next data poll — ~1×/sec in extended hours — and re-asserts the
    // complete option set, `visible` included. If the toggle's state does not
    // reach the binder, that paint silently shows the indicator again.
    const settings = { engineEnabled: true, indicators: { rsi: { enabled: true } }, indicatorInstances: [RSI_INSTANCE] }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings} />)
    expect(H.syncCalls.at(-1).indicatorsHidden).toBe(false)

    act(() => { fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' }) })

    // Force another `updateChart` pass the way a data poll would: new bars.
    const before = H.syncCalls.length
    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS.slice(0, BARS.length - 1)} settingsOverride={settings} />,
    )
    expect(H.syncCalls.length, 'no further sync happened — the assertion below would be vacuous')
      .toBeGreaterThan(before)
    expect(H.syncCalls.at(-1).indicatorsHidden).toBe(true)
  })
})

// ─── B3 carry #2: the readout the pixel gate cannot see ─────────────────────
//
// `processCrosshair` read `rsiSeriesRef.current`. When the engine draws RSI that
// ref is null, so `crosshairData.rsi` stayed null and the `RSI(14) 54.3` chip
// simply vanished from the legend. THE PIXEL GATE CANNOT SEE IT: a headless
// capture has no cursor, so no chip is drawn on either side and the diff is 0
// whichever way the bridge behaves. This suite is that gate.
describe('an engine-drawn indicator still appears in the crosshair legend', () => {
  const RSI_ON = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }

  /**
   * Drive one crosshair move over the newest bar and return the rendered chips.
   *
   * ⚠️ EVERY subscriber gets the event, which is what `subscribeCrosshairMove`
   * does and is NOT a detail to shortcut. StockChart registers TWO handlers on
   * the same chart — the legend's (`:7945`) and the hovered-bar recorder's
   * (`:8257`) — so `crosshairHandlers.at(-1)` delivers the event to the one that
   * never touches the legend, and every assertion here reads a legend that was
   * never asked to update. That is a green-looking harness measuring nothing.
   */
  const hover = async (view, extraSeriesData) => {
    expect(H.crosshairHandlers.length,
      'nothing subscribed to crosshairMove — this test is vacuous').toBeGreaterThan(0)
    const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
    expect(candle, 'no candle series').toBeTruthy()
    const seriesData = new Map([[candle.series, { open: 1, high: 2, low: 0.5, close: 1.5 }]])
    for (const [series, point] of (extraSeriesData || [])) seriesData.set(series, point)
    const param = { time: BARS.at(-1).t, point: { x: 100, y: 100 }, logical: BARS.length - 1, seriesData }
    await act(async () => {
      for (const fn of [...H.crosshairHandlers]) fn(param)
      // the legend handler coalesces through rAF; a real timer outlives it
      await new Promise(r => setTimeout(r, 40))
    })
    return view.container.textContent
  }

  /** …with whatever is on the `rsi` price scale carrying 54.321. */
  const hoverLatest = async (view) => {
    const rsi = H.addSeriesCalls.find(c => c.options && c.options.priceScaleId === 'rsi')
    return hover(view, rsi ? [[rsi.series, { value: 54.321 }]] : [])
  }

  /** The inline colour the RSI chip is painted in, as jsdom reports it. */
  const rsiChipColor = (view) => {
    const span = [...view.container.querySelectorAll('span')].find(s => s.textContent.startsWith('RSI('))
    return span ? span.style.color : null
  }

  it('LEGACY draws the chip — the control', async () => {
    const view = draw(RSI_ON)
    expect(await hoverLatest(view)).toContain('RSI(14) 54.3')
    expect(rsiChipColor(view)).toBe('rgb(123, 104, 238)')   // #7b68ee
  })

  it('ENGINE draws the same chip, same text, same period', async () => {
    const view = draw({ ...RSI_ON, engineEnabled: true, indicatorInstances: [RSI_INSTANCE] })
    // The legacy ref is null here by construction — the block stood down.
    expect(H.binderApis[0].bindings(), 'the engine bound nothing — vacuous').toHaveLength(1)
    expect(await hoverLatest(view)).toContain('RSI(14) 54.3')
  })

  it('and it follows the INSTANCE period, not the settings blob', async () => {
    const view = draw({
      ...RSI_ON,
      engineEnabled: true,
      indicatorInstances: [{ ...RSI_INSTANCE, inputs: { period: 7, color: '#7b68ee' } }],
    })
    const text = await hoverLatest(view)
    expect(text).toContain('RSI(7) 54.3')
    expect(text).not.toContain('RSI(14)')
  })

  it('and its COLOUR from the instance too, not from cs.indicators.rsi', async () => {
    // The legacy row reads `cs.indicators.rsi.color`. An engine line is coloured
    // by its instance, so a chip that kept reading the settings blob would print
    // the right number in the wrong colour — and the legend would disagree with
    // the line it is describing.
    const view = draw({
      ...RSI_ON,
      engineEnabled: true,
      indicatorInstances: [{ ...RSI_INSTANCE, inputs: { period: 14, color: '#ff0000' } }],
    })
    expect(await hoverLatest(view)).toContain('RSI(14) 54.3')
    expect(rsiChipColor(view)).toBe('rgb(255, 0, 0)')
  })

  it('a HIDDEN instance binds nothing, and NEITHER side puts a chip in the legend', async () => {
    // ⚠️ WHAT EACH HALF PROVES (review M-4 corrected a report claim here). The
    // FIRST assertion is the gate on `legend.hide`-adjacent behaviour: a hidden
    // instance binds nothing. The SECOND does NOT prove the chip logic dropped
    // it — `hoverLatest` finds no `rsi`-scale series, so no value was offered in
    // the first place. What it DOES prove, and the reason it stays, is that the
    // legacy block did not step in with a chip of its own while the engine still
    // owns the definition. `legend.hide` itself is gated in `readout.test.js`
    // (`emits NO chip for a price overlay`), on the pure function, where a
    // mutation actually reaches it.
    const view = draw({
      ...RSI_ON, engineEnabled: true, indicatorInstances: [{ ...RSI_INSTANCE, hidden: true }],
    })
    expect(H.binderApis[0].bindings(), 'a hidden instance must bind nothing').toHaveLength(0)
    expect(await hoverLatest(view)).not.toContain('RSI(')
  })

  // ── THE DEVELOPING BAR — the live sequence, not a synthetic one ───────────
  //
  // The producer is the bars push feed. Writer B appends the developing candle
  // IMPERATIVELY (`StockChart.jsx:4553` — `candleSeriesRef.current.update()`, no
  // `updateChart` pass and therefore no `binder.sync`), so on an intraday chart
  // the newest bar exists on the CANDLE series and on no indicator series until
  // the next SWR refresh — 30 s away. lightweight-charts' `seriesData` map
  // carries only the series that HAVE a point at the hovered time, so "the
  // candle is in the map and the RSI line is not" IS that state, and it is
  // reachable only from a live tape: every fixture in this repo hands both
  // series the same bar count.
  //
  // Legacy printed `RSI(14) <last computed>` there
  // (`:7829` — `d?.value ?? indicatorData.rsi.at(-1)?.value`). The engine printed
  // NOTHING until this round: `engineChips` dropped any binding whose hovered
  // value was not finite, and the legacy rescue below it can never run in the
  // crossover because `rsiSeriesRef.current` is null by construction.
  const hoverDevelopingBar = (view) => hover(view, [])

  it('LEGACY prints the last computed RSI on a bar the line has no point for', async () => {
    const view = draw(RSI_ON)
    // The control. If this ever stops printing a chip the asymmetry below is not
    // a regression but a shared behaviour, and the engine assertion means nothing.
    expect(await hoverDevelopingBar(view)).toMatch(/RSI\(14\) \d/)
  })

  it('ENGINE prints the SAME chip — the fallback rides the binding', async () => {
    const view = draw({ ...RSI_ON, engineEnabled: true, indicatorInstances: [RSI_INSTANCE] })
    const bound = H.binderApis[0].bindings()
    expect(bound, 'the engine bound nothing — vacuous').toHaveLength(1)
    // The fallback is REAL DATA, not a constant: it is the last point the binder
    // set on this series, which is what `indicatorData.rsi.at(-1)` is for legacy.
    expect(Number.isFinite(bound[0].lastValue),
      'the binding carries no lastValue — there is nothing to fall back to').toBe(true)
    expect(await hoverDevelopingBar(view)).toContain(`RSI(14) ${bound[0].lastValue.toFixed(1)}`)
  })

  it('legacy and engine print the IDENTICAL developing-bar chip', async () => {
    // The parity claim stated as one assertion, so a future change that moves
    // BOTH stays green and one that moves either does not.
    const legacyView = draw(RSI_ON)
    const legacyText = await hoverDevelopingBar(legacyView)
    const legacyChip = /RSI\(14\) [\d.]+/.exec(legacyText)
    expect(legacyChip, 'the legacy control printed no chip — vacuous').toBeTruthy()

    cleanup(); H.reset()
    const engineView = draw({ ...RSI_ON, engineEnabled: true, indicatorInstances: [RSI_INSTANCE] })
    expect(H.binderApis[0].bindings(), 'the engine bound nothing — vacuous').toHaveLength(1)
    expect(await hoverDevelopingBar(engineView)).toContain(legacyChip[0])
  })

  it('leaves a NON-migrated indicator chip exactly as the legacy block wrote it', async () => {
    // MACD is not in ENGINE_MIGRATED_DEF_IDS yet, so its chip must still come
    // from `cs.indicators.macd` through the hand-written row. A bridge that
    // hijacked every slot would break the fourteen indicators it has not reached.
    const view = draw({
      ...RSI_ON,
      engineEnabled: true,
      indicatorInstances: [RSI_INSTANCE],
      indicators: { ...RSI_ON.indicators, macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
    })
    const macdLine = H.addSeriesCalls.find(c => c.options && c.options.priceScaleId === 'macd' && c.ctor === 'LineSeries')
    expect(macdLine, 'no legacy MACD line — vacuous').toBeTruthy()
    // 0.25 rather than a value whose 4th decimal is a rounding coin-flip — this
    // case is about WHICH code path formatted the chip, not about `toFixed`.
    expect(await hover(view, [[macdLine.series, { value: 0.25 }]])).toContain('MACD 0.2500')
  })
})

// ─── the rest of what pixels cannot see ─────────────────────────────────────
//
// The pixel gate proves ONE picture, captured with no cursor, no keyboard and no
// settings write. Everything a user does to a migrated indicator afterwards is
// outside it. These are the paths that name RSI.

describe('Alt+Shift+I still reaches an engine-drawn RSI in the CROSSOVER state', () => {
  // The existing hide-all suite draws the engine with `cs.indicators.rsi` absent.
  // Flip A's real state is the crossover: the legacy toggle stays ON (it is what
  // `computePaneMargins` reads to reserve the band) while the engine owns the
  // drawing. That is the configuration the toggle has to work in.
  const RSI_ON = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }

  it('hides and re-shows the engine series while the legacy toggle is on', () => {
    draw({ ...RSI_ON, engineEnabled: true, indicatorInstances: [RSI_INSTANCE] })
    const drawn = H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi')
    expect(drawn, 'exactly one RSI line, and it is the engine one').toHaveLength(1)
    const engineSeries = drawn[0].series
    expect(H.binderApis[0].bindings().map(b => b.series)).toEqual([engineSeries])

    const toggle = () => act(() => {
      fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' })
    })

    toggle()
    expect(H.visibilityCalls.filter(v => v.series === engineSeries && v.visible === false).length).toBeGreaterThan(0)
    toggle()
    expect(H.visibilityCalls.filter(v => v.series === engineSeries && v.visible === true).length).toBeGreaterThan(0)
  })
})

describe('the settings round-trip — what a user changes after the flip', () => {
  const RSI_ON = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
  const rsiSeries = () => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi')
  const settings = (over) => ({ ...RSI_ON, engineEnabled: true, indicatorInstances: [RSI_INSTANCE], ...over })

  it('a COLOUR change re-styles the SAME series — never destroys and recreates it', () => {
    // lightweight-charts#2049 is open: a mass removeSeries is a 2-4s main-thread
    // block. The pool exists so a restyle is an applyOptions, and the only way to
    // see that from here is that no SECOND series was ever created.
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    expect(rsiSeries()).toHaveLength(1)
    const before = rsiSeries()[0].series

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings({
        indicatorInstances: [{ ...RSI_INSTANCE, inputs: { period: 14, color: '#ff0000' } }],
      })} />,
    )
    expect(rsiSeries(), 'the engine created a second RSI line instead of restyling').toHaveLength(1)
    expect(H.binderApis[0].bindings()[0].series, 'the binding changed series').toBe(before)
  })

  it('a PERIOD change keeps one series and re-binds it', () => {
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    const before = rsiSeries()[0].series

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings({
        indicatorInstances: [{ ...RSI_INSTANCE, inputs: { period: 7, color: '#7b68ee' } }],
      })} />,
    )
    expect(rsiSeries()).toHaveLength(1)
    expect(H.binderApis[0].bindings()[0].series).toBe(before)
  })

  it('toggling the legacy switch OFF and back ON never leaves TWO RSI lines', () => {
    // ⚠️ FLIP-A SEMANTICS, PINNED DELIBERATELY — see the band suite below for the
    // half this one cannot see. `cs.indicators.rsi.enabled` is still the SWITCH:
    // off means no band AND no line; on means the engine's line in the legacy
    // band. What must hold in EVERY combination is that the user never ends up
    // looking at two RSI lines or at an orphaned legacy one.
    const off = { indicators: { rsi: { enabled: false } } }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    expect(rsiSeries()).toHaveLength(1)
    const first = rsiSeries()[0].series

    // `rsiSeries()` counts addSeries CALLS and never shrinks, so "the line went
    // away" has to be read off the REMOVAL and off what the binder still holds.
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings(off)} />)
    expect(H.binderApis[0].bindings(), 'legacy toggle off: the engine still holds a series').toHaveLength(0)
    expect(H.removedSeries, 'the engine\'s RSI line is still on the chart').toContain(first)
    expect(rsiSeries(), 'and nothing drew a replacement').toHaveLength(1)

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    expect(H.binderApis[0].bindings(), 'toggled back on: the engine draws it again').toHaveLength(1)
    expect(rsiSeries(), 'toggled back on: exactly one more, and the legacy block did not add its own').toHaveLength(2)
  })

  it('an rsi instance arriving MID-SESSION removes the line AND the three guides legacy already drew', () => {
    // ⛔ M8's EXACT SHAPE, ON THE OTHER MIGRATED INDICATOR. BB got this gate in
    // `c0c5a8cb`; RSI never did, and the mutation below SURVIVED the entire
    // 3,733-test suite with exit 0 — measured, not imagined.
    //
    // Every other RSI case in this file starts with `indicatorInstances:
    // [RSI_INSTANCE]` already present, so the legacy ref is null and there is
    // nothing to orphan. The real crossover is the other order: the chart is up,
    // LEGACY has drawn its line and its 70/50/30 guides, and THEN an instance
    // appears — a settings sync from another widget, a grid cell's
    // `settingsOverride`, Task 9's future "move this to the engine" control.
    //
    // The `else if` that removes the legacy series is only reachable while the
    // guard sits INSIDE the first condition. Hoist it —
    // `if (engineOwned.has('rsi')) { } else if (indicatorData.rsi.length)`,
    // which reads like the same thing — and the removal branch becomes
    // unreachable the moment the engine takes over: two RSI lines on the `rsi`
    // scale, one of them dead and frozen at whatever data it last received, plus
    // three orphaned guides underneath the engine's copy.
    //
    // ⚠️ RSI IS STRICTLY WORSE THAN BB HERE, which is why this asserts the guides
    // too. BB's orphan is three dead lines; RSI's is a dead line AND three price
    // lines that `removeSeries` would have taken with it.
    const legacyFirst = { ...RSI_ON, engineEnabled: true, indicatorInstances: [] }
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legacyFirst} />,
    )
    const legacyDrawn = rsiSeries().map(c => c.series)
    expect(legacyDrawn, 'the LEGACY block drew no RSI — nothing to orphan').toHaveLength(1)
    expect(H.binderApis[0].bindings(), 'the engine already owns it — vacuous').toHaveLength(0)

    const legacyGuides = H.priceLineCalls.filter(p => p.series === legacyDrawn[0])
    expect(legacyGuides.map(g => g.options.price).sort((a, b) => b - a),
      'legacy drew no 70/50/30 guides — the guide half of this test is vacuous').toEqual([70, 50, 30])

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={{ ...legacyFirst, indicatorInstances: [RSI_INSTANCE] }} />,
    )

    const engineDrawn = H.binderApis[0].bindings().map(b => b.series)
    expect(engineDrawn, 'the engine did not take over').toHaveLength(1)
    expect(engineDrawn, 'the engine re-used the LEGACY series — it does not own that one')
      .not.toContain(legacyDrawn[0])
    expect(H.removedSeries,
      'the legacy RSI line was left on the chart under the engine\'s copy — and its three guides with it')
      .toContain(legacyDrawn[0])
    // The guides go with the series: nothing removes a price line individually
    // here, so the ONLY thing that clears them is the series removal above. If
    // that assertion ever has to be weakened, these guides are what is left
    // behind on the `rsi` scale.
    expect(H.priceLineCalls.filter(p => p.series === legacyDrawn[0]),
      'the legacy guides were re-created rather than removed with their series').toHaveLength(3)
  })

  it('and the reverse — the instance LEAVING hands the RSI line back to legacy', () => {
    // The same seam from the other side, with the legacy TOGGLE still on. If the
    // legacy block did not stand back up, removing an instance would delete the
    // indicator the settings still say is enabled. Distinct from `toggling the
    // legacy switch OFF and back ON` above: that one moves
    // `cs.indicators.rsi.enabled`, this one moves only the instance list.
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />,
    )
    const engineDrawn = H.binderApis[0].bindings().map(b => b.series)
    expect(engineDrawn).toHaveLength(1)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={settings({ indicatorInstances: [] })} />,
    )
    expect(H.binderApis[0].bindings(), 'the engine still holds a series').toHaveLength(0)
    expect(H.removedSeries).toContain(engineDrawn[0])
    // …and legacy drew one of its own, so the user still sees an RSI.
    const live = rsiSeries().map(c => c.series).filter(s => !H.removedSeries.includes(s))
    expect(live, 'the RSI vanished when the instance was removed').toHaveLength(1)
    // …with its guides back, which is the half a series count alone would miss.
    expect(H.priceLineCalls.filter(p => p.series === live[0]).map(g => g.options.price).sort((a, b) => b - a),
      'legacy stood back up without its 70/50/30 guides').toEqual([70, 50, 30])
  })
})

// ─── THE RESERVED BAND, AND THE FOUR DOORS THAT WRITE THE LEGACY TOGGLE ─────
//
// The carried item, gated. `computePaneMargins` reserves RSI's band from
// `cs.indicators.rsi.enabled` (`paneMargins.js:47`) — so with the toggle off the
// layout reserves NOTHING and `resolvePlacement` falls through to
// `{top:0.82, bottom:0}` (`placement.js:103`), which overlaps volume's
// `{top:0.85, bottom:0}`. That is not "a line in the wrong band": it is an RSI
// drawn ON TOP OF the volume bars, and Ctrl+I / the toolbar checkbox / the two
// right-click items were all one keystroke away from it.
//
// ⛔ THIS SUITE IS TASK 10's TRIPWIRE. Flip B moves the authority the other way
// (`csForPaneMargins` projects the instance list onto the blob
// `computePaneMargins` reads); every assertion below that names the toggle-OFF
// state has to be rewritten when it lands, which is the point — the deferred
// semantic can no longer change with the whole suite green.
describe('the reserved band — an engine-drawn RSI is never painted over the volume bars', () => {
  const RSI_ON = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
  const rsiSeries = () => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi')
  const settings = (over) => ({ ...RSI_ON, engineEnabled: true, indicatorInstances: [RSI_INSTANCE], ...over })

  /** Two `scaleMargins`, as fractions from the TOP and from the BOTTOM of the
   *  pane: band A spans [top, 1-bottom]. They overlap when each starts before
   *  the other ends. */
  const overlaps = (a, b) => a.top < (1 - b.bottom) && b.top < (1 - a.bottom)

  /** What placement resolves for THIS instance, through the ctx the binder was
   *  actually handed — not a reconstruction of it. */
  const placementFor = (instance) => {
    const ctx = H.syncCalls.at(-1)
    expect(ctx, 'the binder was never synced — this test is vacuous').toBeTruthy()
    return ctx.resolvePlacement(instance, registry.getDefinition('rsi'), ctx)
  }

  it('the toggle ON: the engine lands in the band the LAYOUT reserved, clear of volume', () => {
    draw(settings())
    const ctx = H.syncCalls.at(-1)
    expect(H.binderApis[0].bindings(), 'the engine bound nothing — vacuous').toHaveLength(1)
    expect(ctx.paneMargins.volume, 'no volume band — the overlap check would be vacuous').toBeTruthy()

    // The band itself, pinned. Counts alone let Task 9's projection change the
    // deferred semantic with 956 tests green (review I-1).
    expect(ctx.paneMargins.rsi).toEqual({ top: 0.85, bottom: 0 })
    const band = placementFor(RSI_INSTANCE).scaleOptions.scaleMargins
    expect(band).toEqual({ top: 0.85, bottom: 0 })
    expect(overlaps(band, ctx.paneMargins.volume),
      'the engine\'s RSI band overlaps the volume band').toBe(false)
  })

  it('the toggle OFF: no band is reserved, and the engine therefore draws NOTHING', () => {
    // ⛔ THE TASK 9 / TASK 10 TRIPWIRE. `csForPaneMargins` makes `paneMargins.rsi`
    // a real band here (the instance, not the toggle, reserves it) and the
    // authority flip makes the engine draw into it — so BOTH assertions below go
    // red the moment Flip B lands, which is exactly what "the deferred semantic
    // cannot change silently" means.
    draw(settings({ indicators: { rsi: { enabled: false } } }))
    const ctx = H.syncCalls.at(-1)
    expect(ctx.paneMargins.rsi,
      'a band is reserved for an rsi the legacy toggle says is off').toBeUndefined()
    expect(H.binderApis[0].bindings()).toHaveLength(0)
    expect(rsiSeries()).toHaveLength(0)
  })

  it('…because the band it WOULD get sits on top of the volume bars', () => {
    // The mechanism, stated as an assertion rather than a comment: the fallback
    // `resolvePlacement` reaches with nothing reserved is `{top:0.82, bottom:0}`,
    // and volume owns `{top:0.85, bottom:0}`. This is the exact picture the fix
    // above prevents, and it fails if either number moves.
    draw(settings({ indicators: { rsi: { enabled: false } } }))
    const ctx = H.syncCalls.at(-1)
    expect(ctx.paneMargins.volume, 'no volume band — vacuous').toEqual({ top: 0.85, bottom: 0 })
    const would = placementFor(RSI_INSTANCE).scaleOptions.scaleMargins
    expect(would).toEqual({ top: 0.82, bottom: 0 })
    expect(overlaps(would, ctx.paneMargins.volume)).toBe(true)
  })

  it('Ctrl+I hides an engine-drawn RSI — the keystroke, and what the keystroke writes', () => {
    // `keyboardShortcuts.js:99` → `StockChart.jsx:3495` writes
    // `cs.indicators.rsi.enabled`. Before this fix round that reached
    // `computePaneMargins` and nothing else: the band went, the engine's line
    // stayed, and it stayed ON TOP OF the volume bars.
    //
    // Two halves, because they are two different failures. `onSettingsPersist`
    // is how the write is observed at all — a `settingsOverride` chart re-applies
    // its override on the next render, so the keystroke's effect has to be read
    // from what it PERSISTED and then rendered back.
    const persisted = []
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={settings()} onSettingsPersist={(s) => persisted.push(s)} />,
    )
    expect(rsiSeries(), 'nothing drawn to hide — vacuous').toHaveLength(1)

    act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'i' }) })

    expect(persisted.length, 'Ctrl+I persisted nothing — the shortcut is not wired').toBeGreaterThan(0)
    const next = persisted.at(-1)
    expect(next.indicators.rsi.enabled, 'Ctrl+I did not flip the toggle').toBe(false)
    expect(next.indicatorInstances, 'the keystroke must not rewrite the instance list')
      .toEqual([RSI_INSTANCE])

    view.unmount(); cleanup(); H.reset()
    render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={next} />)
    expect(rsiSeries(), 'Ctrl+I left the engine\'s RSI on the chart').toHaveLength(0)
    expect(H.binderApis[0].bindings()).toHaveLength(0)
  })
})

// ─── BOLLINGER BANDS — THE FIRST PRICE OVERLAY (Task 3) ─────────────────────
//
// Everything above this line is about RSI, which has its OWN price scale in its
// OWN band and overlaps nothing. BB is the opposite case and the reason Task 1
// exists: three LineSeries on the CANDLES' scale, in pane 0, over the volume
// bars and the MA overlays. Two things become observable here for the first
// time — that the engine's series are excluded from the candles' autoscale, and
// that they are inserted where their legacy twins were rather than 300 lines
// earlier — and only the second of them is visible from a unit test.

const BB_COLOUR = 'rgba(156,39,176,0.85)'
const BB_ON = { indicators: { bb: { enabled: true, period: 20, stdDev: 2, color: BB_COLOUR } } }
const BB_INSTANCE = {
  instanceId: 'legacy:bb', defId: 'bb',
  inputs: { period: 20, stdDev: 2, color: BB_COLOUR },
  placement: { target: 'price' }, hidden: false,
}
const purple = () => H.addSeriesCalls.filter(c => c.options && c.options.color === BB_COLOUR)

describe('BB Flip A — the legacy block stands down, z-order is preserved', () => {
  it('draws three BB lines with the engine OFF (the shipped behaviour)', () => {
    draw(BB_ON)
    expect(purple()).toHaveLength(3)
  })

  it('STILL draws exactly three when the engine owns it — and they are the ENGINE\'s', () => {
    draw({ ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE] })
    const drawn = purple()
    expect(drawn, 'six purple lines is not parity, it is a bolder chart').toHaveLength(3)
    const owned = H.binderApis[0].bindings().map(b => b.series)
    expect(owned).toHaveLength(3)
    expect(drawn.map(c => c.series).sort()).toEqual(owned.sort())
  })

  it('keeps the dashed/solid/dashed pattern in upper·middle·lower order', () => {
    // Three lines in ONE colour: the diff can see that the dash pattern moved,
    // and cannot say which of the three moved where. `lineStyle` in insertion
    // order is the assertion that can. 2 = LWC Dashed, 0 = Solid.
    draw({ ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE] })
    expect(purple().map(c => c.options.lineStyle)).toEqual([2, 0, 2])
    // …and every one of them is a GUEST on the candles' axis. This is the option
    // Task 1 exists to deliver and the whole reason BB is the pilot: without it
    // a band 2σ above price stretches the CANDLES' range.
    for (const c of purple()) {
      expect(c.options.priceScaleId, 'a price overlay binds to the candles\' scale').toBe('right')
      expect(typeof c.options.autoscaleInfoProvider).toBe('function')
      expect(c.options.autoscaleInfoProvider(), 'the band must contribute NOTHING to the autoscale').toBe(null)
      expect(c.paneIndex, 'a price overlay lives in pane 0').toBe(0)
    }
  })

  it('the LEGACY block draws the same three styles — the transcription, from the component', () => {
    // The control for the case above. If the shipped block's own pattern were
    // 0/2/0 the engine assertion would be pinning the wrong picture, and the
    // pixel gate would be the only thing that noticed.
    draw(BB_ON)
    expect(purple().map(c => c.options.lineStyle)).toEqual([2, 0, 2])
    for (const c of purple()) {
      expect(c.options.autoscaleInfoProvider(), 'legacy excludes them too').toBe(null)
    }
  })

  it('lands AFTER volume and the MA overlays — it draws OVER them, as legacy does', () => {
    draw({ ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE], volume: { show: true } })
    const MA_COLOURS = ['#4ade80', '#f472b6', '#60a5fa', '#fb923c', 'rgba(168,162,144,0.55)']
    const first = H.addSeriesCalls.findIndex(c => (c.options || {}).color === BB_COLOUR)
    const volumeIdx = H.addSeriesCalls.findIndex(c => (c.options || {}).priceFormat?.type === 'custom')
    const lastMa = H.addSeriesCalls.map(c => c.options || {}).reduce((a, o, i) => (MA_COLOURS.includes(o.color) ? i : a), -1)
    expect(first).toBeGreaterThan(-1)
    expect(volumeIdx).toBeGreaterThan(-1)
    expect(lastMa).toBeGreaterThan(-1)
    expect(first).toBeGreaterThan(volumeIdx)
    expect(first).toBeGreaterThan(lastMa)
  })

  it('still draws BEFORE every un-migrated legacy indicator block', () => {
    // The engine draws its whole set contiguously at ONE call site; legacy
    // interleaves its blocks down the function. That call site sits where BB's
    // block is, so everything legacy still draws — MACD, OBV, and the ten others
    // — must stay after it. If the call site ever moved DOWN, the engine's BB
    // would paint under a legacy overlay it paints over today.
    draw({
      ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE],
      indicators: { ...BB_ON.indicators, macd: { enabled: true }, obv: { enabled: true } },
    })
    const bbIdx = H.addSeriesCalls.findIndex(c => (c.options || {}).color === BB_COLOUR)
    expect(bbIdx, 'the engine drew no BB').toBeGreaterThan(-1)
    for (const scale of ['macd', 'obv']) {
      const legacyIdx = H.addSeriesCalls.findIndex(c => (c.options || {}).priceScaleId === scale)
      expect(legacyIdx, `${scale} did not draw`).toBeGreaterThan(-1)
      expect(bbIdx, `engine BB must precede the ${scale} block`).toBeLessThan(legacyIdx)
    }
  })
})

describe('the five price overlays migrate in REGISTRY order, or z-order inverts', () => {
  // The engine draws ALL its series contiguously, immediately before the legacy
  // Bollinger block; legacy interleaves them down the function. Registry order IS
  // legacy render order for the five price overlays (bb, vwap, sar, ichimoku,
  // donchian), so migrating in that order preserves the picture. Migrating a
  // LATER one while an EARLIER one is still legacy puts the engine's copy above
  // a legacy overlay it should sit below — two translucent lines crossing, and
  // the top one wins the pixel.
  const PRICE_ORDER = ['bb', 'vwap', 'sar', 'ichimoku', 'donchian']

  it('no price overlay is migrated ahead of an earlier one', () => {
    const migratedPrice = PRICE_ORDER.filter(id => ENGINE_MIGRATED_DEF_IDS.has(id))
    expect(migratedPrice.length,
      'no price overlay has migrated — this rail is vacuous until one has').toBeGreaterThan(0)
    const lastMigrated = PRICE_ORDER.indexOf(migratedPrice.at(-1))
    for (let i = 0; i <= lastMigrated; i++) {
      expect(ENGINE_MIGRATED_DEF_IDS.has(PRICE_ORDER[i]),
        `${PRICE_ORDER[i]} must migrate before ${PRICE_ORDER[lastMigrated]} — see the plan's z-order rule`)
        .toBe(true)
    }
  })

  it('registry order still equals legacy render order for the five', () => {
    // If the registry is ever reordered, the rule above stops meaning anything.
    const inRegistry = registry.listDefinitions().map(d => d.id).filter(id => PRICE_ORDER.includes(id))
    expect(inRegistry).toEqual(PRICE_ORDER)
  })
})

// ─── what pixels cannot see, for a PRICE OVERLAY ────────────────────────────
//
// The pixel gate proves one picture, captured with no cursor, no keyboard and no
// settings write. These are the paths that name BB. Every one of them is a
// different failure from RSI's equivalent, because BB is three series rather
// than one: a control that reaches "the" series reaches one of three and leaves
// two behind, which reads as a band that lost an edge.

describe('the crossover keyboard + toggles reach all THREE Bollinger lines', () => {
  const settings = (over) => ({ ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE], ...over })

  it('Alt+Shift+I hides and re-shows every one of the three, not just the first', () => {
    draw(settings())
    const owned = H.binderApis[0].bindings().map(b => b.series)
    expect(owned, 'the engine bound no BB — the rest of this test is vacuous').toHaveLength(3)

    const toggle = () => act(() => {
      fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' })
    })

    toggle()
    for (const s of owned) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === false).length,
        'one of the three bands stayed visible').toBeGreaterThan(0)
    }
    toggle()
    for (const s of owned) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === true).length,
        'one of the three bands never came back').toBeGreaterThan(0)
    }
  })

  it('Ctrl+B hides an engine-drawn BB — the keystroke, and what the keystroke writes', () => {
    // ⚠️ BB's shortcut is Ctrl+**B** (`keyboardShortcuts.js:101` →
    // `StockChart.jsx:3482`, `toggle:bb`); Ctrl+I is RSI's. Same mechanism, same
    // failure if it half-works: the write reaches `computePaneMargins`, which for
    // a PRICE overlay reserves nothing at all — so before the Flip-A projection
    // the band would simply have stayed on the chart with its switch off.
    const persisted = []
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={settings()} onSettingsPersist={(s) => persisted.push(s)} />,
    )
    expect(purple(), 'nothing drawn to hide — vacuous').toHaveLength(3)

    act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'b' }) })

    expect(persisted.length, 'Ctrl+B persisted nothing — the shortcut is not wired').toBeGreaterThan(0)
    const next = persisted.at(-1)
    expect(next.indicators.bb.enabled, 'Ctrl+B did not flip the toggle').toBe(false)
    expect(next.indicatorInstances, 'the keystroke must not rewrite the instance list')
      .toEqual([BB_INSTANCE])

    view.unmount(); cleanup(); H.reset()
    render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={next} />)
    expect(purple(), 'Ctrl+B left the engine\'s bands on the chart').toHaveLength(0)
    expect(H.binderApis[0].bindings()).toHaveLength(0)
  })

  it('toggling the legacy switch OFF and back ON never leaves SIX purple lines', () => {
    // ⚠️ FLIP-A SEMANTICS. `cs.indicators.bb.enabled` is still the SWITCH: off
    // means no bands at all; on means the engine's three. What must hold in every
    // combination is that the user never ends up looking at six purple lines or
    // at three orphaned legacy ones.
    const off = { indicators: { bb: { enabled: false } } }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    expect(purple()).toHaveLength(3)
    const first = H.binderApis[0].bindings().map(b => b.series)

    // `purple()` counts addSeries CALLS and never shrinks, so "the bands went
    // away" has to be read off the REMOVAL and off what the binder still holds.
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings(off)} />)
    expect(H.binderApis[0].bindings(), 'legacy toggle off: the engine still holds series').toHaveLength(0)
    for (const s of first) expect(H.removedSeries, 'a band is still on the chart').toContain(s)
    expect(purple(), 'and nothing drew a replacement').toHaveLength(3)

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    expect(H.binderApis[0].bindings(), 'toggled back on: the engine draws them again').toHaveLength(3)
    expect(purple(), 'toggled back on: three more, and the legacy block added none of its own').toHaveLength(6)
  })

  it('an instance arriving MID-SESSION removes the three lines legacy already drew', () => {
    // ⛔ THE MUTATION THAT SURVIVED EVERYTHING ELSE (M8). Every other case in this
    // file starts with the engine already owning BB, so the legacy refs are null
    // and there is nothing to orphan. The real crossover is the other order: the
    // chart is up, legacy has drawn its three bands, and THEN an instance
    // appears — a settings sync, a grid cell's override, Task 9's future "move
    // this to the engine" control.
    //
    // The `else` that removes them lives INSIDE the per-band condition. Hoist the
    // guard to the loop's entry — `for (… of (bbEngineOwned ? [] : BB_BANDS))`,
    // which reads like the same thing — and the loop no longer runs at all, so
    // the removal never fires: six purple lines, three of them dead, and every
    // other assertion in this suite still green. Measured, not imagined.
    const legacyFirst = { ...BB_ON, engineEnabled: true, indicatorInstances: [] }
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legacyFirst} />,
    )
    const legacyDrawn = purple().map(c => c.series)
    expect(legacyDrawn, 'the LEGACY block drew no bands — nothing to orphan').toHaveLength(3)
    expect(H.binderApis[0].bindings(), 'the engine already owns it — vacuous').toHaveLength(0)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={{ ...legacyFirst, indicatorInstances: [BB_INSTANCE] }} />,
    )

    const engineDrawn = H.binderApis[0].bindings().map(b => b.series)
    expect(engineDrawn, 'the engine did not take over').toHaveLength(3)
    for (const s of legacyDrawn) {
      expect(engineDrawn, 'the engine re-used a LEGACY series — it does not own those')
        .not.toContain(s)
      expect(H.removedSeries,
        'a legacy Bollinger line was left on the chart under the engine\'s copy').toContain(s)
    }
  })

  it('and the reverse — the instance LEAVING hands the three bands back to legacy', () => {
    // The same seam from the other side. If the legacy block did not stand back
    // up, removing an instance would delete the indicator the settings still say
    // is on.
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />,
    )
    const engineDrawn = H.binderApis[0].bindings().map(b => b.series)
    expect(engineDrawn).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={{ ...settings(), indicatorInstances: [] }} />,
    )
    expect(H.binderApis[0].bindings(), 'the engine still holds series').toHaveLength(0)
    for (const s of engineDrawn) expect(H.removedSeries).toContain(s)
    // …and legacy drew three of its own, so the user still sees Bollinger bands.
    const live = purple().map(c => c.series).filter(s => !H.removedSeries.includes(s))
    expect(live, 'the bands vanished when the instance was removed').toHaveLength(3)
  })

  it('a COLOUR change re-styles the SAME three series — never destroys and recreates', () => {
    // lightweight-charts#2049: a mass removeSeries is a 2-4s main-thread block,
    // and a price overlay is three series rather than one, so the pool matters
    // three times as much here.
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(before).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings({
        indicatorInstances: [{ ...BB_INSTANCE, inputs: { period: 20, stdDev: 2, color: '#00ff00' } }],
      })} />,
    )
    expect(H.binderApis[0].bindings().map(b => b.series),
      'the engine created new series instead of restyling').toEqual(before)
    expect(H.removedSeries.filter(s => before.includes(s)),
      'a band was destroyed and recreated — that is the #2049 path').toHaveLength(0)
  })

  it('a PERIOD or STD-DEV change keeps the same three series and re-binds them', () => {
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(before).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings({
        indicatorInstances: [{ ...BB_INSTANCE, inputs: { period: 10, stdDev: 3, color: BB_COLOUR } }],
      })} />,
    )
    expect(H.binderApis[0].bindings().map(b => b.series)).toEqual(before)
    expect(purple(), 'a fourth purple line appeared').toHaveLength(3)
  })
})

describe('an engine-drawn Bollinger adds NOTHING to the crosshair legend', () => {
  // BB declares `legend: { hide: true }` on all three plots because the SHIPPED
  // legend has no Bollinger chip (`StockChart.jsx:9677-9687` lists nine, none of
  // them BB). `readout.test.js` gates the pure function; this gates the rendered
  // legend, which is where three unwanted purple chips would actually appear.
  //
  // ⚠️ THE PIXEL GATE CANNOT SEE ANY OF THIS — a headless capture has no cursor,
  // so no chip is drawn on either side whatever the bridge does.
  const hoverText = async (view) => {
    expect(H.crosshairHandlers.length, 'nothing subscribed to crosshairMove — vacuous').toBeGreaterThan(0)
    const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
    expect(candle, 'no candle series').toBeTruthy()
    const seriesData = new Map([[candle.series, { open: 1, high: 2, low: 0.5, close: 1.5 }]])
    // Every purple line carries a value at the hovered bar — the state in which a
    // chip WOULD be emitted if anything asked for one.
    for (const c of purple()) seriesData.set(c.series, { value: 123.456 })
    const param = { time: BARS.at(-1).t, point: { x: 100, y: 100 }, logical: BARS.length - 1, seriesData }
    await act(async () => {
      for (const fn of [...H.crosshairHandlers]) fn(param)
      await new Promise(r => setTimeout(r, 40))
    })
    return view.container.textContent
  }

  it('the ENGINE legend is character-for-character the LEGACY legend', async () => {
    const legacyView = draw(BB_ON)
    const legacyText = await hoverText(legacyView)
    expect(legacyText, 'the legend printed nothing — vacuous').toMatch(/O\s*1/)
    expect(legacyText, 'the shipped legend already has a BB chip?').not.toContain('123.4')

    cleanup(); H.reset()
    const engineView = draw({ ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE] })
    expect(H.binderApis[0].bindings(), 'the engine bound nothing — vacuous').toHaveLength(3)
    expect(await hoverText(engineView)).toBe(legacyText)
  })

  it('and an RSI chip alongside it is untouched — hiding BB must not hide everything', () => {
    // The other direction of the same mistake: a bridge that dropped every chip
    // would satisfy the case above and break the one indicator that HAS one.
    const view = draw({
      ...BB_ON, indicators: { ...BB_ON.indicators, rsi: { enabled: true, period: 14, color: '#7b68ee' } },
      engineEnabled: true, indicatorInstances: [BB_INSTANCE, RSI_INSTANCE],
    })
    expect(H.binderApis[0].bindings(), 'BB (3) + RSI (1) — vacuous otherwise').toHaveLength(4)
    return (async () => {
      const rsi = H.addSeriesCalls.find(c => c.options && c.options.priceScaleId === 'rsi')
      expect(rsi, 'no rsi-scale series').toBeTruthy()
      const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
      const seriesData = new Map([
        [candle.series, { open: 1, high: 2, low: 0.5, close: 1.5 }],
        [rsi.series, { value: 54.321 }],
      ])
      for (const c of purple()) seriesData.set(c.series, { value: 123.456 })
      await act(async () => {
        for (const fn of [...H.crosshairHandlers]) {
          fn({ time: BARS.at(-1).t, point: { x: 100, y: 100 }, logical: BARS.length - 1, seriesData })
        }
        await new Promise(r => setTimeout(r, 40))
      })
      const text = view.container.textContent
      expect(text).toContain('RSI(14) 54.3')
      expect(text, 'a Bollinger chip appeared').not.toContain('123.4')
    })()
  })
})

describe('C-2 — RSI off and BB on in ONE settings write, from the component', () => {
  // ⛔ THE B2 FINAL REVIEW'S CRITICAL #2, REPRODUCED WHERE IT ACTUALLY HAPPENED.
  // The pool re-purposes RSI's freed LineSeries into BB's upper band. `placement`
  // used to return `scaleId: null` for a price overlay, meaning "the candles'
  // scale"; `pool` read that as "say nothing about `priceScaleId`" — and
  // `applyOptions` MERGES, so the series stayed on the `rsi` scale, still
  // `{autoScale:false}`, framed 0-100 for an oscillator. A Bollinger band around
  // $180 on that axis is clipped off the top of the RSI band and simply
  // invisible, with `scaleOptions: null` meaning nothing ever corrects it.
  //
  // `bbFlipAParity.test.js` gates the binder. This gates the COMPONENT: the same
  // flip driven through `settingsOverride`, which is what a user's settings write
  // looks like from inside `updateChart` — both legacy blocks changing state in
  // the same pass, one standing up and one standing down.
  const both = { indicators: {
    rsi: { enabled: true, period: 14, color: '#7b68ee' },
    bb: { enabled: true, period: 20, stdDev: 2, color: BB_COLOUR },
  } }
  const settings = (instances) => ({ ...both, engineEnabled: true, indicatorInstances: instances })

  it('the re-purposed series is moved to the CANDLES\' scale and excluded from it', () => {
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings([RSI_INSTANCE])} />,
    )
    const rsiSeries = H.binderApis[0].bindings().map(b => b.series)
    expect(rsiSeries, 'the engine drew no RSI — nothing to re-purpose').toHaveLength(1)
    const [freed] = rsiSeries
    H.applyOptionsCalls.length = 0

    // ONE write: the RSI instance leaves and the BB instance arrives together.
    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings([BB_INSTANCE])} />,
    )

    const bound = H.binderApis[0].bindings()
    expect(bound, 'the engine did not bind BB\'s three bands').toHaveLength(3)
    expect(bound.every(b => b.defId === 'bb')).toBe(true)
    // The pool did its job — RSI's series IS one of BB's three bands now. If this
    // ever stops holding, everything below is about a freshly-CREATED series
    // (which always gets a full option set through `addSeries`) and proves
    // nothing about a re-purpose, which is the whole subject of C-2.
    expect(bound.map(b => b.series),
      'RSI\'s series was destroyed rather than re-purposed — this case is vacuous')
      .toContain(freed)
    expect(H.removedSeries, 'and it was not removed on the way').not.toContain(freed)

    // THE ASSERTION. `applyOptions` MERGES, so the ONLY thing that can move a
    // pooled series off the `rsi` scale is being told `priceScaleId` explicitly.
    const reused = H.applyOptionsCalls.filter(c => c.series === freed && c.options
      && 'priceScaleId' in c.options)
    expect(reused.length, 'the re-purposed series was never told a price scale').toBeGreaterThan(0)
    for (const c of reused) {
      expect(c.options.priceScaleId, 'BB inherited the rsi scale — C-2 is back').toBe('right')
      expect(c.options.autoscaleInfoProvider(),
        'the re-purposed band would stretch the candles').toBe(null)
      expect(c.options.color, 'and it is wearing BB\'s colour').toBe(BB_COLOUR)
    }
  })

  it('and the RSI band it vacated is gone — no orphan on the rsi scale', () => {
    // The other half of the same write. If the legacy RSI block did NOT stand
    // back up (or the engine left its series bound to the `rsi` scale), the user
    // would be looking at a dead line in an unreserved band.
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings([RSI_INSTANCE])} />,
    )
    expect(H.binderApis[0].bindings()).toHaveLength(1)
    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={{ ...settings([BB_INSTANCE]), indicators: { ...both.indicators, rsi: { enabled: false } } }} />,
    )
    expect(H.binderApis[0].bindings().every(b => b.defId === 'bb')).toBe(true)
    expect(H.binderApis[0].bindings()).toHaveLength(3)
  })
})

describe('a BB instance survives BOTH settings allow-lists', () => {
  // `mergeChartSettings` is an explicit allow-list — a key absent from its return
  // is silently DROPPED on every read — and `mergeSettingsOverride` is the second
  // one, applied by every grid cell and by the parity route. An instance that
  // does not survive both is an indicator that vanishes on the next
  // read-merge-write, and nothing in the picture says so.
  it('mergeChartSettings keeps the instance and the flag through a JSON round-trip', () => {
    const stored = JSON.stringify({ ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE] })
    const merged = mergeChartSettings(stored)
    expect(merged.indicatorInstances).toEqual([BB_INSTANCE])
    expect(merged.engineEnabled).toBe(true)
    expect(merged.indicators.bb.enabled).toBe(true)
  })

  it('mergeSettingsOverride patches ONE input without deleting the instance', () => {
    const base = mergeChartSettings(JSON.stringify({
      ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE, RSI_INSTANCE],
    }))
    const out = mergeSettingsOverride(base, {
      indicatorInstances: [{ instanceId: 'legacy:bb', inputs: { stdDev: 3 } }],
    })
    expect(out.indicatorInstances, 'the generic array path replaced the list').toHaveLength(2)
    const bb = out.indicatorInstances.find(i => i.instanceId === 'legacy:bb')
    expect(bb.inputs).toEqual({ period: 20, stdDev: 3, color: BB_COLOUR })
    expect(out.indicatorInstances.find(i => i.instanceId === RSI_INSTANCE.instanceId))
      .toEqual(RSI_INSTANCE)
  })

  it('and the round-tripped blob still draws exactly three engine bands', () => {
    // The two cases above are about a data structure. This is the one that says
    // the structure still means something: render what came back out of both
    // merges and count the lines.
    const base = mergeChartSettings(JSON.stringify({
      ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE],
    }))
    const out = mergeSettingsOverride(base, {
      indicatorInstances: [{ instanceId: 'legacy:bb', inputs: { color: '#00ff00' } }],
    })
    draw(out)
    expect(H.binderApis[0].bindings()).toHaveLength(3)
    expect(H.addSeriesCalls.filter(c => c.options && c.options.color === '#00ff00')).toHaveLength(3)
    expect(purple(), 'the legacy block drew its own copy alongside').toHaveLength(0)
  })
})
