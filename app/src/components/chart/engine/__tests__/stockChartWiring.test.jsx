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
  visibilityCalls: [],
  binderCreated: [],
  binderApis: [],
  syncCalls: [],
  crosshairHandlers: [],
  reset() {
    H.addSeriesCalls.length = 0
    H.visibilityCalls.length = 0
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
      applyOptions: (o) => { if (o && 'visible' in o) H.visibilityCalls.push({ series: s, visible: o.visible }) },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      moveToPane: () => {}, getPane: () => ({ getHeight: () => 300 }),
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
    removeSeries: () => {}, applyOptions: () => {},
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

    draw({ engineEnabled: true, indicatorInstances: [RSI_INSTANCE] })
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
      indicators: { bb: { enabled: true } },
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
      indicators: { bb: { enabled: true }, macd: { enabled: true }, obv: { enabled: true } },
    })
    const engineIdx = idxWhere(o => o.priceScaleId === 'rsi')
    for (const scale of ['macd', 'obv']) {
      const legacyIdx = idxWhere(o => o.priceScaleId === scale)
      expect(legacyIdx, `${scale} did not draw`).toBeGreaterThan(-1)
      expect(engineIdx, `engine must precede the ${scale} block`).toBeLessThan(legacyIdx)
    }
  })
})

describe('hide-all-indicators reaches engine series through the binding map', () => {
  const engineSeriesOf = () => H.addSeriesCalls
    .filter(c => c.options && c.options.priceScaleId === 'rsi')
    .map(c => c.series)

  it('hides and re-shows an engine-bound series with the toggle', () => {
    draw({ engineEnabled: true, indicatorInstances: [RSI_INSTANCE] })
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
    const settings = { engineEnabled: true, indicatorInstances: [RSI_INSTANCE] }
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

  it('a HIDDEN instance contributes no chip — there is no line to describe', async () => {
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
    // ⚠️ FLIP-A SEMANTICS, PINNED DELIBERATELY. `cs.indicators.rsi.enabled` is
    // the LEGACY authority: it drives `computePaneMargins` (the band) and the
    // legacy block. The ENGINE draws from the instance, so switching the legacy
    // toggle off does NOT remove an engine-drawn RSI — it removes its reserved
    // band, and placement falls back to `{top:0.82, bottom:0}`. Making the two
    // agree is the Flip-B projection (`csForPaneMargins`, plan Task 9); what
    // must hold TODAY, in every combination, is that the user never ends up
    // looking at two RSI lines or at an orphaned legacy one.
    const off = { indicators: { rsi: { enabled: false } } }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    expect(rsiSeries()).toHaveLength(1)

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings(off)} />)
    expect(rsiSeries(), 'legacy toggle off: still exactly one, the engine one').toHaveLength(1)
    expect(H.binderApis[0].bindings()).toHaveLength(1)

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    expect(rsiSeries(), 'toggled back on: the legacy block must not add a second').toHaveLength(1)
    expect(H.binderApis[0].bindings()).toHaveLength(1)
  })
})
