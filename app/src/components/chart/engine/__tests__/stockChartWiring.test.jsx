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
  syncCalls: [],
  reset() {
    H.addSeriesCalls.length = 0
    H.visibilityCalls.length = 0
    H.binderCreated.length = 0
    H.syncCalls.length = 0
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
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
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
      return {
        sync: (ctx) => { H.syncCalls.push(ctx); return real.sync(ctx) },
        teardown: real.teardown,
        bindings: real.bindings,
      }
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

const { default: StockChart } = await import('../../../StockChart')

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
})
