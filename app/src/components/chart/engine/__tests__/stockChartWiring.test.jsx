import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'
import intraday5m from '../../../../pages/parityBars/intraday5m.json'

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
  // Every `series.setData`, with the series it was written to. The only migrated
  // plot whose CONTENT differs per point is MACD's histogram — its bar colours
  // ride on the points (`colorMode: 'sign'`), never on the series options — so
  // without this the whole of B2 review Critical #3 is unreachable from the
  // component level, where the LEGACY control that proves the colours right lives.
  setDataCalls: [],
  moveToPaneCalls: [],
  binderCreated: [],
  binderApis: [],
  syncCalls: [],
  crosshairHandlers: [],
  // Every `csForPaneMargins` call, with the object it RETURNED. Task 9's exit
  // criterion is that the projection is the identity function while nothing is
  // flipped, and identity is not observable from `paneMargins` — two different
  // blobs can produce deep-equal margins. This is the only place the claim can
  // actually be checked from the component level.
  csForPaneMarginsCalls: [],
  // How many times the READ-TIME MIGRATOR ran. Its gate is otherwise
  // unobservable: the per-definition filter behind it already discards every
  // projected instance while the flip set is empty, so removing the gate changes
  // NOTHING a pixel or a binding can see — it just walks the registry and the
  // blob on every paint, for every user, forever. A mutation deleting it survived
  // until this counter existed.
  migrateCalls: 0,
  reset() {
    H.addSeriesCalls.length = 0
    H.removedSeries.length = 0
    H.visibilityCalls.length = 0
    H.applyOptionsCalls.length = 0
    H.priceLineCalls.length = 0
    H.setDataCalls.length = 0
    H.moveToPaneCalls.length = 0
    H.binderCreated.length = 0
    H.binderApis.length = 0
    H.syncCalls.length = 0
    H.crosshairHandlers.length = 0
    H.csForPaneMarginsCalls.length = 0
    H.migrateCalls = 0
  },
}))

// The REAL migrator, counted. `importOriginal` keeps every other export — the
// validator, the ownership walk and the id helper are all used by the component
// and by `flipState` on the same import.
vi.mock('../instances', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    migrateLegacyToInstances: (...args) => {
      H.migrateCalls += 1
      return actual.migrateLegacyToInstances(...args)
    },
  }
})

// The REAL projection, wrapped so its ARGUMENT and its RETURN are both visible.
// A stub returning `cs` would make the identity assertion below prove nothing
// about the shipped function.
vi.mock('../paneMarginsProjection', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    csForPaneMargins: (cs, instances, flipped) => {
      const out = actual.csForPaneMargins(cs, instances, flipped)
      H.csForPaneMarginsCalls.push({ cs, instances, flipped, out })
      return out
    },
  }
})

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor) => {
    const s = {
      __ctor: ctor,
      setData: (data) => { H.setDataCalls.push({ series: s, data }) },
      update: () => {},
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

const { default: StockChart, ENGINE_MIGRATED_DEF_IDS, ENGINE_FLIPPED_DEF_IDS } = await import('../../../StockChart')
const registry = await import('../nativeRegistry')
// The two settings ALLOW-LISTS a migrated instance has to survive — see the
// round-trip suite at the bottom of this file.
const { mergeChartSettings, mergeSettingsOverride } = await import('../../chartDefaults')

const BARS = bars200.bars
const RSI_INSTANCE = { instanceId: 'engine-test:rsi', defId: 'rsi', inputs: { period: 14, color: '#7b68ee' }, hidden: false }

/** The intraday fixture, for the one migrated definition that does not exist on
 *  a daily bar. 579 five-minute bars across three extended-hours ET sessions —
 *  see `pages/parityBars/intraday5m.test.js`. */
const INTRADAY_BARS = intraday5m.bars

/**
 * A DEFINITION'S OWN TIMEFRAME, read off `meta.timeframes` rather than hardcoded.
 *
 * ⚠️ B3 TASK 8 IS WHY THIS EXISTS. `draw` was `tf="D"` for every case, which was
 * fine while every migrated definition rendered everywhere. `vwap` does not: it
 * is gated to 1/5/15/30/60 on BOTH sides (`VWAP_TFS` and `meta.timeframes`), so
 * the double-draw rail below drew a daily chart, found no VWAP on either side,
 * and reported "the engine bound nothing" — a control going red because its
 * SUBJECT was unreachable, not because the wiring was wrong.
 *
 * Deriving it from the registry rather than writing `defId === 'vwap' ? '5' : 'D'`
 * is the point: the next session-gated definition inherits the treatment without
 * anyone editing this file, and a definition that loses its gate silently falls
 * back to the daily fixture and stays covered.
 */
const tfFor = (defId) => {
  const tfs = registry.getDefinition(defId)?.meta?.timeframes
  return (Array.isArray(tfs) && tfs.length) ? (tfs.includes('5') ? '5' : tfs[0]) : 'D'
}
const barsFor = (tf) => (tf === 'D' ? BARS : INTRADAY_BARS)

const draw = (settingsOverride, tf = 'D') => render(
  <StockChart sym="AAPL" tf={tf} barsOverride={barsFor(tf)} settingsOverride={settingsOverride} />,
)

// ─── THE LEGEND READ — POLLED TO STABILITY, NEVER SLEPT ─────────────────────
//
// ⛔ A FLAKY TEST IS A DEFECT, AND ON THIS BRANCH IT IS A LOAD-BEARING ONE.
// Every legend case below is a gate the pixel harness CANNOT replace — a
// headless capture has no cursor, so no chip is drawn on either side and the
// diff is 0 whichever way the crosshair bridge behaves. An intermittently
// passing gate is worse than a missing one: it reads as evidence.
//
// These reads used to be `dispatch, then setTimeout(40)`. That is a race the
// moment the suite runs 400 files in parallel — B3 Task 8 watched a case pass
// alone, pass in the chart selection, then fail once in a full run and pass on
// the retry. The legend coalesces through rAF and jsdom gives no guarantee
// about how many frames a 40 ms real timer outlives on a loaded box.
//
// ⚠️ "IT RENDERED AT ALL" IS NOT ENOUGH TO POLL ON — that was the first fix,
// and it was still wrong. The container also carries the live-price header and
// a "⟳ RECONNECTING" banner, so two reads can both hold the OHLC row while
// holding DIFFERENT amounts of unrelated chrome, and a character-for-character
// legacy-vs-engine comparison then fails on text that has nothing to do with
// the indicator.
//
// So: wait for TWO CONSECUTIVE IDENTICAL READS — the same rule
// `tools/chart_parity.py` applies to a capture (`shots=2/2`), for the same
// reason — and THROW if the DOM never settles, rather than comparing a moving
// target. One implementation, so the next indicator's legend case inherits it
// instead of copying the sleep for a fifth time.
const LEGEND_RENDERED = /O\s*1/           // the OHLC row — the legend exists at all
const SETTLE_TRIES = 60
const SETTLE_MS = 20

/**
 * The LEGEND's text — deliberately NOT the container's.
 *
 * ⛔ `container.textContent` IS NOT DETERMINISTIC, AND NO AMOUNT OF SETTLING
 * MAKES IT SO. This was found the hard way: with every legend read polled to
 * stability, the VWAP case still failed roughly one full-suite run in two, and
 * the diff was
 *
 *     Expected: "…VT%TSEXT01:4[2]?⇄"
 *     Received: "…VT%TSEXT01:4[1]?⇄"
 *
 * — a **WALL CLOCK** in the export footer. `legendOf` renders twice, a second or
 * so apart, and when a minute boundary falls between the two renders the
 * containers differ by one digit. A character-for-character legacy-vs-engine
 * comparison then reports a clock tick as an indicator regression. `⟳
 * RECONNECTING` is in both strings and was the red herring; `chart_parity.py`
 * freezes this same stamp for exactly this reason, and these tests do not run
 * through it.
 *
 * Settling is still required — it is what makes each individual read stable —
 * but it is orthogonal. The comparison has to be scoped to the thing the
 * assertion is ABOUT.
 *
 * The `O 1.00` span's PARENT is the legend row, and `legChips` are its siblings
 * in all three legend variants (`StockChart.jsx:9849-9903` — flat, stacked and
 * default), so every chip these cases assert on is inside it and the header,
 * the feed banner and the footer clock are not. No fallback to the container:
 * a missing legend must fail the `ready` predicate and throw, not quietly widen
 * the read back to the clock.
 */
const legendTextOf = (view) => {
  const o = [...view.container.querySelectorAll('span')]
    .find(s => /^O\s/.test(s.textContent || ''))
  return o && o.parentElement ? o.parentElement.textContent : ''
}

/**
 * Deliver one crosshair event to EVERY subscriber, repeatedly, until the
 * rendered text stops changing; return that settled text.
 *
 * ⚠️ EVERY subscriber gets it, which is what `subscribeCrosshairMove` does and
 * is NOT a detail to shortcut. StockChart registers TWO handlers on the same
 * chart — the legend's (`:7945`) and the hovered-bar recorder's (`:8257`) — so
 * `crosshairHandlers.at(-1)` delivers to the one that never touches the legend,
 * and every assertion then reads a legend nothing asked to update. That is a
 * green-looking harness measuring nothing.
 *
 * @param ready predicate the settled text must ALSO satisfy, so a stable EMPTY
 *              string is never mistaken for a settled legend.
 */
const settledLegend = async (view, param, ready = LEGEND_RENDERED) => {
  expect(H.crosshairHandlers.length,
    'nothing subscribed to crosshairMove — this test is vacuous').toBeGreaterThan(0)
  let text = legendTextOf(view)
  for (let i = 0; i < SETTLE_TRIES; i++) {
    // Sequential on purpose: each read must observe the DOM the PREVIOUS
    // dispatch settled into, so these cannot be awaited in parallel.
    await act(async () => {
      for (const fn of [...H.crosshairHandlers]) fn(param)
      await new Promise(r => setTimeout(r, SETTLE_MS))
    })
    const prev = text
    text = legendTextOf(view)
    if (prev === text && ready.test(text)) return text
  }
  throw new Error(
    'the legend never settled to two identical reads — the comparison would be a race',
  )
}

/** The crosshair event itself: the candle, plus whatever series carry a value. */
const crosshairAt = (bars, extraSeriesData) => {
  const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
  expect(candle, 'no candle series').toBeTruthy()
  const seriesData = new Map([[candle.series, { open: 1, high: 2, low: 0.5, close: 1.5 }]])
  for (const [series, point] of (extraSeriesData || [])) seriesData.set(series, point)
  return { time: bars.at(-1).t, point: { x: 100, y: 100 }, logical: bars.length - 1, seriesData }
}

// ─── the helper's OWN gate ───────────────────────────────────────────────────
//
// ⚠️ `settledLegend` is shared infrastructure under seventeen assertions, and
// its stability rule is NOT falsifiable through them: on an unloaded box the
// legend settles inside the first dispatch, so a mutation that deletes the
// two-identical-reads requirement leaves every legend case green. That is
// precisely the shape of a rule everybody believes and nothing checks.
//
// These four drive it against a fake view whose text is still moving, which
// reproduces on demand what a loaded 400-file run produces by luck.
describe('settledLegend — the read that makes every legend case stable', () => {
  /** A REAL container shaped like the chart's: a legend row holding the `O `
   *  span, plus the chrome that is NOT part of the legend — the feed banner and
   *  the export footer's WALL CLOCK, which is the thing that actually broke the
   *  comparison and which no amount of settling can freeze.
   *
   *  `changes` is how many dispatches the LEGEND keeps moving for; the clock
   *  ticks on every dispatch, forever, exactly as it does in life. */
  const movingView = (changes, { clock = true } = {}) => {
    const container = document.createElement('div')
    container.innerHTML =
      '<div class="banner">⟳ RECONNECTING</div>' +
      '<div class="legend"><span>O 1.00</span><span>H 2.00</span></div>' +
      '<div class="footer">EXT01:41</div>'
    const legend = container.querySelector('.legend')
    const footer = container.querySelector('.footer')
    let n = 0
    H.crosshairHandlers.push(() => {
      n += 1
      legend.lastChild.textContent = n < changes ? `H 2.00${'.'.repeat(n)}` : 'H 2.00'
      if (clock) footer.textContent = `EXT01:${41 + n}`
    })
    return { view: { container }, legend }
  }

  it('reads the LEGEND, not the container — the footer clock is not an indicator change', async () => {
    // ⛔ THE REGRESSION THIS SUITE EXISTS FOR. Two `legendOf` renders a second
    // apart straddle a minute boundary and their CONTAINERS differ by one digit.
    // If the read were `container.textContent` this would never settle at all,
    // because the clock ticks on every dispatch.
    const { view } = movingView(1)
    expect(await settledLegend(view, {})).toBe('O 1.00H 2.00')
  })

  it('returns the text the DOM settled on, not the first one that looked rendered', async () => {
    const { view } = movingView(3, { clock: false })
    expect(await settledLegend(view, {})).toBe('O 1.00H 2.00')
  })

  it('a legend that never stops moving THROWS — it is never compared', async () => {
    // The alternative is a character-for-character comparison against a moving
    // target, which fails on unrelated chrome and reads as an indicator bug.
    const { view } = movingView(Number.MAX_SAFE_INTEGER, { clock: false })
    await expect(settledLegend(view, {})).rejects.toThrow(/never settled/)
  })

  it('a STABLE but unrendered legend throws rather than returning an empty read', async () => {
    // Two identical reads of '' are two identical reads. Without the `ready`
    // predicate every "does not contain a VWAP chip" assertion would be a
    // statement about the empty string.
    H.crosshairHandlers.push(() => {})
    const container = document.createElement('div')
    container.innerHTML = '<div class="banner">⟳ RECONNECTING</div>'
    await expect(settledLegend({ container }, {})).rejects.toThrow(/never settled/)
  })

  it('delivers to EVERY crosshair subscriber, not just the last one', async () => {
    // StockChart registers two handlers on one chart — the legend's and the
    // hovered-bar recorder's. Delivering to `at(-1)` reaches the one that never
    // touches the legend, and every assertion then reads a legend nothing asked
    // to update: a green harness measuring nothing.
    const seen = []
    H.crosshairHandlers.push(() => seen.push('legend'), () => seen.push('recorder'))
    const container = document.createElement('div')
    container.innerHTML = '<div class="legend"><span>O 1.00</span></div>'
    await settledLegend({ container }, {})
    expect(new Set(seen), 'a subscriber was skipped').toEqual(new Set(['legend', 'recorder']))
  })
})

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
      //
      // The timeframe comes from the DEFINITION (`tfFor`) — a session indicator
      // exists on neither side of a daily chart, and a rail that measured
      // "0 === 0" there would be green and vacuous.
      const tf = tfFor(defId)
      const legacyOn = { indicators: { [defId]: { enabled: true } } }
      draw(legacyOn, tf)
      const legacyOnly = H.addSeriesCalls.length
      expect(legacyOnly, `${defId} drew nothing with the engine off`).toBeGreaterThan(0)
      cleanup(); H.reset()

      draw({ ...legacyOn, engineEnabled: true, indicatorInstances: [instanceOf(defId)] }, tf)
      expect(H.binderApis[0].bindings().length, `the engine bound nothing for ${defId}`).toBeGreaterThan(0)
      expect(H.addSeriesCalls.length, `${defId} is drawn twice — its legacy block has no guard`)
        .toBe(legacyOnly)
    },
  )

  it('the rail is running each definition on a timeframe it EXISTS on', () => {
    // ⚠️ THE RAIL'S OWN NON-VACUITY GATE. `tfFor` is derived, so a definition that
    // gains a `meta.timeframes` the daily fixture does not satisfy would silently
    // start drawing nothing on BOTH sides and the case above would pass on
    // `0 === 0`… except that `legacyOnly > 0` catches it. This states the rule the
    // other way round so the intent survives a refactor of that assertion: every
    // migrated definition's chosen tf must be one it declares.
    for (const defId of ENGINE_MIGRATED_DEF_IDS) {
      const tfs = registry.getDefinition(defId)?.meta?.timeframes
      if (Array.isArray(tfs) && tfs.length) expect(tfs, defId).toContain(tfFor(defId))
      else expect(tfFor(defId), defId).toBe('D')
    }
    // …and at least one of them is genuinely gated, or `tfFor` is dead code
    // dressed as a rule. VWAP is that one from Task 8 onward.
    const gated = [...ENGINE_MIGRATED_DEF_IDS].filter(id => registry.getDefinition(id)?.meta?.timeframes)
    expect(gated, 'no migrated definition declares meta.timeframes — tfFor is inert').not.toHaveLength(0)
  })

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

  /** Drive one crosshair move over the newest bar and return the rendered chips.
   *  Polled to two identical reads — see `settledLegend`. */
  const hover = (view, extraSeriesData) =>
    settledLegend(view, crosshairAt(BARS, extraSeriesData))

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
    // ⚠️ THE SUBJECT USED TO BE MACD, AND B3 TASK 6 MIGRATED IT. The claim needs
    // a definition the engine does NOT draw, so its chip must still come from
    // `cs.indicators.<id>` through the hand-written row — a bridge that hijacked
    // every slot would break the twelve indicators it has not reached. ATR is the
    // subject now; when ATR migrates, this case needs another one or it silently
    // stops being a negative control.
    expect(ENGINE_MIGRATED_DEF_IDS.has('atr'),
      'ATR has migrated — this negative control needs a new subject').toBe(false)
    const view = draw({
      ...RSI_ON,
      engineEnabled: true,
      indicatorInstances: [RSI_INSTANCE],
      indicators: { ...RSI_ON.indicators, atr: { enabled: true, period: 14, color: '#FFA726' } },
    })
    const atrLine = H.addSeriesCalls.find(c => c.options && c.options.priceScaleId === 'atr')
    expect(atrLine, 'no legacy ATR line — vacuous').toBeTruthy()
    // 0.25 rather than a value whose 4th decimal is a rounding coin-flip — this
    // case is about WHICH code path formatted the chip, not about `toFixed`.
    expect(await hover(view, [[atrLine.series, { value: 0.25 }]])).toContain('ATR(14) 0.2500')
  })

  it('…and a MIGRATED definition with NO instance still gets its legacy chip', async () => {
    // The other half, and the state a user is actually in before Task 9 gives
    // them a way to create an instance: `macd` IS in ENGINE_MIGRATED_DEF_IDS, the
    // engine holds no MACD instance, so the legacy block draws it and the legacy
    // row formats the chip. Ownership follows the INSTANCE, never the id list.
    expect(ENGINE_MIGRATED_DEF_IDS.has('macd')).toBe(true)
    const view = draw({
      ...RSI_ON,
      engineEnabled: true,
      indicatorInstances: [RSI_INSTANCE],
      indicators: { ...RSI_ON.indicators, macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
    })
    const macdLine = H.addSeriesCalls.find(c => c.options && c.options.priceScaleId === 'macd' && c.ctor === 'LineSeries')
    expect(macdLine, 'no legacy MACD line — vacuous').toBeTruthy()
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
//
// ⏳ `csForPaneMargins` NOW EXISTS (Task 9, `engine/paneMarginsProjection.js`)
// and is wired in — it is `ENGINE_FLIPPED_DEF_IDS` being EMPTY that keeps this
// suite true, not the projection being absent. The Task-9 suite at the bottom of
// this file asserts that emptiness and the projection's identity return; the
// flipped-set half lives in `flipBWithANonEmptySet.test.jsx`, where the
// toggle-OFF case is already red-in-waiting.
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
  const hoverText = (view) =>
    // Every purple line carries a value at the hovered bar — the state in which a
    // chip WOULD be emitted if anything asked for one.
    settledLegend(view, crosshairAt(BARS, purple().map(c => [c.series, { value: 123.456 }])))

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
      const text = await settledLegend(view, crosshairAt(BARS, [
        [rsi.series, { value: 54.321 }],
        ...purple().map(c => [c.series, { value: 123.456 }]),
      ]))
      expect(text).toContain('RSI(14) 54.3')
      expect(text, 'a Bollinger chip appeared').not.toContain('123.4')
    })()
  })

  it('and all three plots still DECLARE the chip hidden — the reason the above holds', () => {
    // ⚠️ THE RENDERED CASES ABOVE CANNOT SEE THIS, AND A MUTATION PROVED IT.
    // `emitChips` skips a plot when `!plot.legend` OR when `plot.legend.hide`
    // is true (`readout.js:107`), so deleting `legend: { hide: true }` from a
    // BB plot changes NOTHING that renders — the chip was already suppressed by
    // having no `LEGACY_SLOTS` entry and no declaration. The flag is the
    // INTENT ("deliberately no chip") as distinct from the omission ("nobody
    // declared one yet"), and until this case existed it could be deleted with
    // the whole suite green. VWAP has carried this assertion since Task 8; BB
    // and MACD had not.
    const def = registry.getDefinition('bb')
    expect(def.plots, 'upper / middle / lower').toHaveLength(3)
    for (const p of def.plots) {
      expect(p.legend && p.legend.hide, `${p.key} grew a legend chip the shipped chart never had`).toBe(true)
    }
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

// ─── MACD: the multi-plot stress test (B3 Task 6) ───────────────────────────
//
// RSI is one series; BB is three of one kind. MACD is the first migration with
// TWO POOL KEYS in one instance — two LineSeries and a HistogramSeries — a
// `largeDashed` zero guide, and a band that AUTOSCALES rather than carrying a
// fixed range. Every failure below is a shape neither pilot could have.

const MACD_CFG = {
  enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
  macdColor: '#2196F3', signalColor: '#FF9800',
}
const MACD_ON = { indicators: { macd: MACD_CFG } }
const MACD_INSTANCE = {
  instanceId: 'legacy:macd', defId: 'macd',
  inputs: {
    fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    macdColor: '#2196F3', signalColor: '#FF9800',
  },
  placement: { target: 'pane' }, hidden: false,
}
/** `StockChart.jsx:81-82`, verbatim — the two colours the histogram's BARS wear. */
const MACD_HIST_UP = 'rgba(76,175,80,0.75)'
const MACD_HIST_DOWN = 'rgba(244,67,54,0.75)'

/** Every series on the `macd` scale, in creation order. Both lanes name it. */
const onMacdScale = () => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'macd')
/** The MACD histogram — the only HistogramSeries in that band. */
const macdHistogram = () => onMacdScale().filter(c => c.ctor === 'HistogramSeries')
/** The LAST array a series was handed. That is what is on screen. */
const lastDataFor = (series) => {
  const writes = H.setDataCalls.filter(c => c.series === series)
  return writes.length ? writes[writes.length - 1].data : null
}

describe('MACD Flip A — the legacy block stands down, all three plots move together', () => {
  it('draws three series on the macd scale with the engine OFF (the shipped behaviour)', () => {
    draw(MACD_ON)
    expect(onMacdScale()).toHaveLength(3)
    expect(onMacdScale().map(c => c.ctor)).toEqual(['LineSeries', 'LineSeries', 'HistogramSeries'])
  })

  it('STILL draws exactly three when the engine owns it — and they are the ENGINE\'s', () => {
    draw({ ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE] })
    const drawn = onMacdScale()
    expect(drawn, 'six series in one band is not parity').toHaveLength(3)
    // TWO POOL KEYS, in legacy's creation order. A binder that bound the
    // histogram as a line would draw a third flat line where the bars are.
    expect(drawn.map(c => c.ctor)).toEqual(['LineSeries', 'LineSeries', 'HistogramSeries'])
    const owned = H.binderApis[0].bindings().map(b => b.series)
    expect(owned).toHaveLength(3)
    expect(drawn.map(c => c.series).sort()).toEqual(owned.sort())
  })

  it('all three share one autoscaled band in pane 0 — and the histogram keeps precision 5', () => {
    draw({ ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE] })
    for (const c of onMacdScale()) {
      expect(c.paneIndex, 'a Flip-A band lives in pane 0').toBe(0)
      expect(typeof c.options.autoscaleInfoProvider).toBe('function')
      // MACD OWNS its scale, so its provider is the IDENTITY one — the opposite of
      // BB's `() => null`. Excluding here would collapse the band to LWC's empty
      // −0.5..0.5 default.
      expect(c.options.autoscaleInfoProvider(() => 'BASE'),
        'the only thing on that axis has to be what sizes it').toBe('BASE')
    }
    expect(macdHistogram()[0].options.priceFormat).toEqual({ type: 'price', precision: 5 })
  })

  it('the zero guide is drawn ONCE, on the MACD line — as legacy draws it', () => {
    draw(MACD_ON)
    const legacyGuides = H.priceLineCalls.filter(c => c.options && c.options.price === 0)
    expect(legacyGuides, 'the legacy block drew no zero guide — control is vacuous').toHaveLength(1)
    const legacySpec = legacyGuides[0].options
    expect(legacyGuides[0].series).toBe(onMacdScale()[0].series)

    cleanup(); H.reset()
    draw({ ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE] })
    const guides = H.priceLineCalls.filter(c => c.options && c.options.price === 0)
    expect(guides, 'the engine drew the wrong number of zero guides').toHaveLength(1)
    // LineStyle 3 = LargeDashed. An OMITTED `createPriceLine` option takes LWC's
    // own default (Dashed, 2) — the 379-px class of finding from RSI's midline.
    expect(guides[0].options).toEqual(legacySpec)
    expect(guides[0].options.lineStyle).toBe(3)
    // …and it hangs off the FIRST data series, so a removeSeries takes it along.
    expect(guides[0].series).toBe(onMacdScale()[0].series)
  })

  it('leaves the other legacy indicator blocks alone — ownership is per definition', () => {
    draw({
      ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE],
      indicators: { ...MACD_ON.indicators, stoch: { enabled: true }, obv: { enabled: true } },
    })
    for (const scale of ['stoch', 'obv']) {
      expect(H.addSeriesCalls.some(c => (c.options || {}).priceScaleId === scale),
        `${scale} stopped drawing`).toBe(true)
    }
  })
})

describe('MACD\'s histogram — the per-bar sign colours, against a LEGACY control', () => {
  // ⛔ B2 REVIEW CRITICAL #3. `toPoints` emitted `{time,value}` only and
  // `seriesOptionsForPlot` ignored `colorMode: 'sign'`, so an engine-drawn MACD
  // histogram came out in ONE flat LWC default across the whole band where legacy
  // is green above zero and red below. The pixel gate would see that as a large
  // and completely unattributable diff. Here it is the arrays themselves, engine
  // against legacy, bar for bar — including the colour on every bar.
  const histogramData = () => {
    const hist = macdHistogram()
    expect(hist, 'no HistogramSeries on the macd scale').toHaveLength(1)
    return lastDataFor(hist[0].series)
  }

  it('LEGACY colours every bar by sign, and uses BOTH colours — the control', () => {
    draw(MACD_ON)
    const data = histogramData()
    expect(data).toHaveLength(BARS.length)
    let ups = 0, downs = 0
    for (const p of data) {
      if (p.value === undefined) { expect(p.color).toBeUndefined(); continue }
      expect(p.color).toBe(p.value >= 0 ? MACD_HIST_UP : MACD_HIST_DOWN)
      if (p.color === MACD_HIST_UP) ups++; else downs++
    }
    // Pinned counts, so a fixture change that flattened the histogram cannot turn
    // the comparison below into two identical all-green arrays.
    expect(ups).toBe(86)
    expect(downs).toBe(81)
  })

  it('the ENGINE hands the renderer the IDENTICAL array — values AND colours', () => {
    draw(MACD_ON)
    const legacyData = histogramData()
    cleanup(); H.reset()

    draw({ ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE] })
    expect(H.binderApis[0].bindings(), 'the engine bound nothing — vacuous').toHaveLength(3)
    const engineData = histogramData()
    // Element for element, colour included. A flat histogram, an inverted
    // comparison, an off-by-one in the colour lookup and a dropped `color` key all
    // fail here, and each of them names itself in the diff.
    expect(engineData).toEqual(legacyData)
  })

  it('…and so do the two LINES, which is what says the histogram case is about colour', () => {
    // The control for the control. If the engine's whole MACD were wrong the case
    // above would fail without telling anyone whether the colour bridge or the
    // compute was at fault.
    const lines = () => onMacdScale().filter(c => c.ctor === 'LineSeries').map(c => lastDataFor(c.series))
    draw(MACD_ON)
    const legacyLines = lines()
    expect(legacyLines).toHaveLength(2)
    cleanup(); H.reset()
    draw({ ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE] })
    expect(lines()).toEqual(legacyLines)
    // …and no point on a LINE carries a colour: `colorMode: 'sign'` is declared on
    // the histogram plot only, and leaking it onto the lines would repaint them
    // green and red bar by bar.
    for (const col of lines()) for (const p of col) expect(p).not.toHaveProperty('color')
  })
})

describe('what pixels cannot see, for MACD', () => {
  const settings = (over) => ({ ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE], ...over })

  it('Alt+Shift+I hides and re-shows all THREE, lines and histogram alike', () => {
    draw(settings())
    const owned = H.binderApis[0].bindings().map(b => b.series)
    expect(owned, 'the engine bound no MACD — the rest of this test is vacuous').toHaveLength(3)
    const toggle = () => act(() => {
      fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' })
    })
    toggle()
    for (const s of owned) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === false).length,
        'one of the three MACD plots stayed visible').toBeGreaterThan(0)
    }
    toggle()
    for (const s of owned) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === true).length,
        'one of the three MACD plots never came back').toBeGreaterThan(0)
    }
  })

  it('Ctrl+O hides an engine-drawn MACD — the keystroke, and what the keystroke writes', () => {
    // ⚠️ MACD's shortcut is Ctrl+**O** (`keyboardShortcuts.js:100` and `:155` →
    // `StockChart.jsx:3481`, `toggle:macd`). Ctrl+I is RSI's, Ctrl+B is BB's.
    const persisted = []
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={settings()} onSettingsPersist={(s) => persisted.push(s)} />,
    )
    expect(onMacdScale(), 'nothing drawn to hide — vacuous').toHaveLength(3)

    act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'o' }) })

    expect(persisted.length, 'Ctrl+O persisted nothing — the shortcut is not wired').toBeGreaterThan(0)
    const next = persisted.at(-1)
    expect(next.indicators.macd.enabled, 'Ctrl+O did not flip the toggle').toBe(false)
    expect(next.indicatorInstances, 'the keystroke must not rewrite the instance list')
      .toEqual([MACD_INSTANCE])

    view.unmount(); cleanup(); H.reset()
    render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={next} />)
    expect(onMacdScale(), 'Ctrl+O left the engine\'s MACD on the chart').toHaveLength(0)
    expect(H.binderApis[0].bindings()).toHaveLength(0)
  })

  it('toggling the legacy switch OFF and back ON never leaves SIX series in the band', () => {
    // ⚠️ FLIP-A SEMANTICS: `cs.indicators.macd.enabled` is still the SWITCH; the
    // instance is only the renderer. Off means nothing in the band — including
    // the band itself, which `computePaneMargins` stops reserving.
    const off = { indicators: { macd: { ...MACD_CFG, enabled: false } } }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    expect(onMacdScale()).toHaveLength(3)
    const first = H.binderApis[0].bindings().map(b => b.series)

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings(off)} />)
    expect(H.binderApis[0].bindings(), 'legacy toggle off: the engine still holds series').toHaveLength(0)
    for (const s of first) expect(H.removedSeries, 'a MACD plot is still on the chart').toContain(s)
    expect(onMacdScale(), 'and nothing drew a replacement').toHaveLength(3)

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    expect(H.binderApis[0].bindings(), 'toggled back on: the engine draws them again').toHaveLength(3)
    expect(onMacdScale(), 'toggled back on: three more, and the legacy block added none').toHaveLength(6)
  })

  it('an instance arriving MID-SESSION removes the three series AND the zero guide', () => {
    // ⛔ THE SINGLE MOST-REPEATED DEFECT ON THIS BRANCH. BB's twin (M8) survived
    // the whole suite; RSI's (R-I1) survived 3,733 tests. Every other case here
    // starts with the engine ALREADY owning MACD, so the legacy refs are null and
    // there is nothing to orphan. The crossover a user actually hits is the other
    // order: the chart is up, legacy has drawn a line, a signal and a histogram
    // with a zero guide on the line, and THEN an instance appears.
    //
    // MACD's guard sits on the block's own `if`, whose `else` removes all three
    // refs — the correct place. Move it inside the body (or hoist it so the `else`
    // stops being reached) and the user gets SIX series in one band, three of them
    // dead, plus an orphaned zero guide, and the picture still looks plausible.
    const legacyFirst = { ...MACD_ON, engineEnabled: true, indicatorInstances: [] }
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legacyFirst} />,
    )
    const legacyDrawn = onMacdScale().map(c => c.series)
    expect(legacyDrawn, 'the LEGACY block drew nothing — nothing to orphan').toHaveLength(3)
    expect(H.binderApis[0].bindings(), 'the engine already owns it — vacuous').toHaveLength(0)
    const guideOwner = H.priceLineCalls.filter(c => c.options && c.options.price === 0)
    expect(guideOwner, 'legacy drew no zero guide').toHaveLength(1)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={{ ...legacyFirst, indicatorInstances: [MACD_INSTANCE] }} />,
    )

    const engineDrawn = H.binderApis[0].bindings().map(b => b.series)
    expect(engineDrawn, 'the engine did not take over').toHaveLength(3)
    for (const s of legacyDrawn) {
      expect(engineDrawn, 'the engine re-used a LEGACY series — it does not own those')
        .not.toContain(s)
      expect(H.removedSeries,
        'a legacy MACD plot was left in the band under the engine\'s copy').toContain(s)
    }
    // The guide goes with its series. If the line survived, so would a second zero
    // line — invisible on top of the engine's, and a leak that grows per flip.
    expect(H.removedSeries, 'the orphaned zero guide\'s series survived')
      .toContain(guideOwner[0].series)
  })

  it('and the reverse — the instance LEAVING hands MACD back to legacy', () => {
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />,
    )
    const engineDrawn = H.binderApis[0].bindings().map(b => b.series)
    expect(engineDrawn).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={settings({ indicatorInstances: [] })} />,
    )
    expect(H.binderApis[0].bindings(), 'the engine still holds series').toHaveLength(0)
    for (const s of engineDrawn) expect(H.removedSeries).toContain(s)
    // …and legacy drew its own three, so the indicator did not vanish with the
    // instance — including the histogram, which is the plot a "lines only"
    // stand-back-up would silently drop.
    const liveCalls = onMacdScale().filter(c => !H.removedSeries.includes(c.series))
    expect(liveCalls, 'MACD vanished when the instance was removed').toHaveLength(3)
    expect(liveCalls.map(c => c.ctor)).toEqual(['LineSeries', 'LineSeries', 'HistogramSeries'])
  })

  it('a COLOUR change re-styles the SAME three series — never destroys and recreates', () => {
    // lightweight-charts#2049: a mass removeSeries is a 2-4s main-thread block.
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(before).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings({
        indicatorInstances: [{ ...MACD_INSTANCE, inputs: { ...MACD_INSTANCE.inputs, macdColor: '#00ff00' } }],
      })} />,
    )
    expect(H.binderApis[0].bindings().map(b => b.series),
      'the engine created new series instead of restyling').toEqual(before)
    expect(H.removedSeries.filter(s => before.includes(s)),
      'a MACD plot was destroyed and recreated — that is the #2049 path').toHaveLength(0)
  })

  it('a PERIOD change keeps the same three series and re-binds them', () => {
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(before).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings({
        indicatorInstances: [{
          ...MACD_INSTANCE,
          inputs: { ...MACD_INSTANCE.inputs, fastPeriod: 5, slowPeriod: 35, signalPeriod: 4 },
        }],
      })} />,
    )
    expect(H.binderApis[0].bindings().map(b => b.series)).toEqual(before)
    expect(onMacdScale(), 'a fourth series appeared in the band').toHaveLength(3)
    // …and the NUMBERS moved, so "same series" is not "nothing happened".
    const hist = macdHistogram()[0].series
    const writes = H.setDataCalls.filter(c => c.series === hist)
    expect(writes.length).toBeGreaterThan(1)
    expect(writes.at(-1).data.at(-1).value).not.toBe(writes[0].data.at(-1).value)
  })
})

describe('an engine-drawn MACD keeps its TWO legend chips, and adds no third', () => {
  // MACD is the only migrated definition with VISIBLE chips besides RSI, and the
  // only one with two of them plus a hidden plot. `readout.js` maps
  // `macd::macd → macd` and `macd::signal → macdSig`; the histogram declares
  // `legend: { hide: true }` because the shipped legend has no histogram chip.
  //
  // ⚠️ THE PIXEL GATE CANNOT SEE ANY OF THIS — a headless capture has no cursor.
  const hoverText = (view) => {
    const band = onMacdScale()
    expect(band, 'no MACD series to hover').toHaveLength(3)
    return settledLegend(view, crosshairAt(BARS, [
      [band[0].series, { value: 0.12345 }],
      [band[1].series, { value: -0.6789 }],
      [band[2].series, { value: 0.802 }],
    ]))
  }

  it('LEGACY prints MACD and SIG at four decimals, and no histogram chip — the control', async () => {
    const text = await hoverText(draw(MACD_ON))
    // 0.12345 formats as 0.1235 in JS, not 0.1234.
    expect(text).toContain('MACD 0.1235')
    expect(text).toContain('SIG -0.6789')
    expect(text, 'the shipped legend already has a histogram chip?').not.toContain('0.8020')
  })

  it('the ENGINE legend is character-for-character the LEGACY legend', async () => {
    const legacyText = await hoverText(draw(MACD_ON))
    cleanup(); H.reset()
    const engineView = draw({ ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE] })
    expect(H.binderApis[0].bindings(), 'the engine bound nothing — vacuous').toHaveLength(3)
    expect(await hoverText(engineView)).toBe(legacyText)
  })

  it('legacy and engine print the IDENTICAL DEVELOPING-BAR chips', async () => {
    // ⛔ THE I-3 REGRESSION, ON THE INDICATOR WITH TWO CHIPS. The bars push feed's
    // writer B appends the developing candle imperatively (`StockChart.jsx:4553` —
    // no `updateChart`, so no `binder.sync`), so on an intraday chart the newest
    // bar is on the CANDLES and on no indicator series until the next SWR refresh.
    // `seriesData` then carries the candle and nothing else. Legacy prints the
    // last computed value there (`:7919`/`:7923`); an engine chip that printed
    // nothing is a readout regression only a live tape produces — and MACD has
    // TWO chips, so a fallback wired to one of them is a half-fix that reads as
    // "the signal line stopped reporting".
    // The candle and NOTHING else — the developing-bar state this case is about.
    const hoverBare = (view) => settledLegend(view, crosshairAt(BARS))

    const legacyText = await hoverBare(draw(MACD_ON))
    const legacyChips = [/MACD -?[\d.]+/, /SIG -?[\d.]+/].map(re => re.exec(legacyText))
    expect(legacyChips[0], 'the legacy control printed no MACD chip — vacuous').toBeTruthy()
    expect(legacyChips[1], 'the legacy control printed no SIG chip — vacuous').toBeTruthy()

    cleanup(); H.reset()
    const bound = (() => {
      const v = draw({ ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE] })
      return { view: v, bindings: H.binderApis[0].bindings() }
    })()
    expect(bound.bindings, 'the engine bound nothing — vacuous').toHaveLength(3)
    // The fallback is REAL DATA, not a constant: `lastValue` is the final point
    // the binder set on that series, which is what `.at(-1)?.value` is for legacy.
    for (const b of bound.bindings.filter(x => x.plotKey !== 'histogram')) {
      expect(Number.isFinite(b.lastValue), `${b.plotKey} carries no lastValue`).toBe(true)
    }
    const engineText = await hoverBare(bound.view)
    expect(engineText).toContain(legacyChips[0][0])
    expect(engineText).toContain(legacyChips[1][0])
  })

  // ⛔ THE STATE THAT IS *NOT* REACHABLE, WRITTEN DOWN SO NOBODY ELSE SPENDS THE
  // AFTERNOON ON IT. MACD's three plots begin on three different bars, which looks
  // like the first chance to bind a SUBSET of a definition's plots (line yes,
  // signal and histogram no) and therefore the first chance to run the per-plot
  // legend rescue at `StockChart.jsx:7915-7933` independently. It is not:
  // `computeMACD` refuses outright below `slowPeriod + signalPeriod` bars
  // (`indicators.js` — `return { macd: [], signal: [], histogram: [] }`), so a
  // fixture short enough to starve the signal starves the LINE too and the engine
  // binds nothing at all. MEASURED on this double: 30 and 33 bars bind `[]`, 40
  // bars bind all three. With the ranges the definition declares (slowPeriod ≤
  // 200, signalPeriod ≤ 50) no bar count splits them.
  //
  // So the plan's Task-6 obligation to gate B2 review M-6's per-plot split — one
  // plot of a definition engine-drawn while another is legacy-drawn — is STILL
  // unreachable: Flip-A ownership is per DEFINITION, and nothing splits MACD's
  // columns. It becomes reachable when a definition can be PARTIALLY migrated,
  // which is B4's shape, not this one's.

  it('and the chips follow the INSTANCE\'s colours, not the settings blob', async () => {
    // A second instance, or an `?instances=` chart, can carry colours the blob
    // never saw. The chip must wear what the LINE wears.
    const view = draw({
      ...MACD_ON, engineEnabled: true,
      indicatorInstances: [{
        ...MACD_INSTANCE,
        inputs: { ...MACD_INSTANCE.inputs, macdColor: '#123456', signalColor: '#654321' },
      }],
    })
    expect(H.binderApis[0].bindings()).toHaveLength(3)
    await hoverText(view)
    // jsdom normalises an inline `color:` to rgb(), so the hex is asserted in the
    // form the DOM actually holds. #123456 → rgb(18,52,86); #654321 → rgb(101,67,33).
    const chips = [...view.container.querySelectorAll('span')]
      .filter(el => /^(MACD|SIG) /.test(el.textContent))
    expect(chips.map(el => el.textContent)).toEqual(['MACD 0.1235', 'SIG -0.6789'])
    expect(chips.map(el => el.style.color)).toEqual(['rgb(18, 52, 86)', 'rgb(101, 67, 33)'])
    // …and the blob's colours are NOT what is showing.
    expect(chips.map(el => el.style.color)).not.toContain('rgb(33, 150, 243)')
  })

  it('and the histogram still DECLARES its chip hidden, while the two lines do not', () => {
    // ⚠️ THE RENDERED CASES ABOVE CANNOT SEE THIS, AND A MUTATION PROVED IT.
    // `emitChips` skips a plot when `!plot.legend` OR when `plot.legend.hide` is
    // true (`readout.js:107`), so deleting `legend: { hide: true }` from the
    // histogram changes NOTHING that renders — it has no `LEGACY_SLOTS` entry
    // either way. The flag is the INTENT ("the shipped legend has no histogram
    // chip") as distinct from the omission ("nobody declared one yet"), and
    // until this case existed it could be deleted with the whole suite green.
    //
    // The second half is the one that matters more: MACD is the only migrated
    // definition with a VISIBLE chip and a hidden plot in the same definition,
    // so "hide everything" and "hide nothing" are both wrong here and only this
    // asserts the split.
    const def = registry.getDefinition('macd')
    const hidden = def.plots.filter(p => p.legend && p.legend.hide === true).map(p => p.key)
    const visible = def.plots.filter(p => p.legend && p.legend.hide !== true).map(p => p.key)
    expect(hidden, 'the histogram grew a chip the shipped legend never had').toEqual(['histogram'])
    expect(visible, 'MACD lost one of its two shipped chips').toEqual(['macd', 'signal'])
  })
})

describe('a MACD instance survives BOTH settings allow-lists', () => {
  it('mergeChartSettings keeps the instance and the flag through a JSON round-trip', () => {
    const stored = JSON.stringify({ ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE] })
    const merged = mergeChartSettings(stored)
    expect(merged.indicatorInstances).toEqual([MACD_INSTANCE])
    expect(merged.engineEnabled).toBe(true)
    expect(merged.indicators.macd.enabled).toBe(true)
  })

  it('mergeSettingsOverride patches ONE input without deleting the instance', () => {
    const base = mergeChartSettings(JSON.stringify({
      ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE, RSI_INSTANCE],
    }))
    const out = mergeSettingsOverride(base, {
      indicatorInstances: [{ instanceId: 'legacy:macd', inputs: { slowPeriod: 35 } }],
    })
    expect(out.indicatorInstances, 'the generic array path replaced the list').toHaveLength(2)
    const macd = out.indicatorInstances.find(i => i.instanceId === 'legacy:macd')
    expect(macd.inputs).toEqual({ ...MACD_INSTANCE.inputs, slowPeriod: 35 })
    expect(out.indicatorInstances.find(i => i.instanceId === RSI_INSTANCE.instanceId))
      .toEqual(RSI_INSTANCE)
  })

  it('and the round-tripped blob still draws exactly three engine plots', () => {
    const base = mergeChartSettings(JSON.stringify({
      ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE],
    }))
    const out = mergeSettingsOverride(base, {
      indicatorInstances: [{ instanceId: 'legacy:macd', inputs: { macdColor: '#00ff00' } }],
    })
    draw(out)
    expect(H.binderApis[0].bindings()).toHaveLength(3)
    expect(onMacdScale(), 'the legacy block drew its own copy alongside').toHaveLength(3)
    expect(onMacdScale().filter(c => c.options.color === '#00ff00')).toHaveLength(1)
  })
})

// ─── VWAP: the session overlay, and the first gated definition (B3 Task 8) ───
//
// The last Flip A, and the only one whose SUBJECT does not exist on the fixture
// every case above uses. VWAP is intraday-only on both sides — `VWAP_TFS` in the
// legacy memo, `meta.timeframes` on the definition — so every case below draws
// `intraday5m` at tf `5`. It is also the only migration whose enable signal is
// not `indicators.<id>.enabled` alone: `vwapOverride` forces it on.

const VWAP_TF = '5'
const VWAP_CFG = { enabled: true, color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 }
const VWAP_ON = { indicators: { vwap: VWAP_CFG } }
const VWAP_INSTANCE = {
  instanceId: 'legacy:vwap', defId: 'vwap',
  inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
  placement: { target: 'price' }, hidden: false,
}

/** Every cyan line on the chart, either lane. VWAP is a PRICE overlay, so there
 *  is no named scale to filter on — the colour is the handle, which is exactly
 *  why the dimmed and override cases below assert on colour STRINGS. */
const vwapLines = (color = '#26C6DA') =>
  H.addSeriesCalls.filter(c => c.options && c.options.color === color && c.ctor === 'LineSeries')
const liveVwapLines = (color) => vwapLines(color).filter(c => !H.removedSeries.includes(c.series))
const drawIntraday = (settingsOverride) => render(
  <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settingsOverride} />,
)

describe('VWAP Flip A — the legacy block stands down on an intraday chart', () => {
  it('draws one cyan line with the engine OFF (the shipped behaviour)', () => {
    drawIntraday(VWAP_ON)
    expect(vwapLines()).toHaveLength(1)
    expect(vwapLines()[0].options.lineWidth).toBe(1)
    expect(vwapLines()[0].options.lineStyle).toBe(0)
  })

  it('STILL draws exactly one when the engine owns it — and it is the ENGINE\'s', () => {
    drawIntraday({ ...VWAP_ON, engineEnabled: true, indicatorInstances: [VWAP_INSTANCE] })
    const bound = H.binderApis[0].bindings()
    expect(bound, 'the engine bound no VWAP').toHaveLength(1)
    expect(vwapLines(), 'a second cyan line — the legacy block has no guard').toHaveLength(1)
    expect(vwapLines()[0].series).toBe(bound[0].series)
  })

  it('the ENGINE\'s line names the candles\' scale, where legacy named none', () => {
    // The one option that is not a restatement of an LWC default. Legacy omits
    // `priceScaleId` and LWC resolves the single visible scale; the engine states
    // it, which is byte-identical on a create and is the FIX on a re-purpose.
    drawIntraday(VWAP_ON)
    expect(vwapLines()[0].options.priceScaleId, 'legacy suddenly names a scale').toBeUndefined()
    cleanup(); H.reset()
    drawIntraday({ ...VWAP_ON, engineEnabled: true, indicatorInstances: [VWAP_INSTANCE] })
    expect(vwapLines()[0].options.priceScaleId).toBe('right')
  })

  it('neither lane draws on a DAILY chart, and neither lane OWNS it', () => {
    // The timeframe gate, from the component. `VWAP_TFS` empties `indicatorData.vwap`
    // and `eligibility` drops the instance — two reads of one list. A double-draw
    // here would mean they had diverged.
    draw({ ...VWAP_ON, engineEnabled: true, indicatorInstances: [VWAP_INSTANCE] }, 'D')
    expect(H.binderApis[0].bindings(), 'the engine drew a session VWAP on daily bars').toHaveLength(0)
    expect(vwapLines(), 'the legacy block drew a session VWAP on daily bars').toHaveLength(0)
  })

  it('leaves every OTHER legacy indicator alone — ownership is per definition', () => {
    drawIntraday({
      indicators: { vwap: VWAP_CFG, rsi: { enabled: true } },
      engineEnabled: true, indicatorInstances: [VWAP_INSTANCE],
    })
    expect(H.binderApis[0].bindings()).toHaveLength(1)
    expect(H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi'),
      'RSI stopped drawing when VWAP migrated').toHaveLength(1)
  })
})

describe('what pixels cannot see, for VWAP', () => {
  const settings = (over) => ({ ...VWAP_ON, engineEnabled: true, indicatorInstances: [VWAP_INSTANCE], ...over })

  it('Alt+Shift+I hides and re-shows the engine-drawn line', () => {
    drawIntraday(settings())
    const owned = H.binderApis[0].bindings().map(b => b.series)
    expect(owned, 'the engine bound no VWAP — the rest of this test is vacuous').toHaveLength(1)
    const toggle = () => act(() => {
      fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' })
    })
    toggle()
    expect(H.visibilityCalls.filter(v => v.series === owned[0] && v.visible === false).length)
      .toBeGreaterThan(0)
    toggle()
    expect(H.visibilityCalls.filter(v => v.series === owned[0] && v.visible === true).length)
      .toBeGreaterThan(0)
  })

  it('Alt+U hides an engine-drawn VWAP — the keystroke, and what the keystroke writes', () => {
    // ⚠️ VWAP's shortcut is **Alt+U**, not a Ctrl chord. Ctrl+I is RSI's, Ctrl+O
    // is MACD's, Ctrl+B is BB's — VWAP is in the Alt family with the display
    // toggles. It is ALSO the one shortcut in the set that does NOT go through
    // `keyboardShortcuts.js`'s `toggle:` switch: `SHORTCUTS` declares
    // `Alt+U -> toggle:vwap`, but `matchShortcut` rejects Alt so the command never
    // reaches that switch (which has no `case 'vwap'` either). The live handler is
    // the `e.altKey` block at `StockChart.jsx:3330`, and it writes the same field.
    // Two declarations, one of them dead — asserting the KEY and the WRITE together
    // is what makes that discoverable if either moves.
    const persisted = []
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS}
        settingsOverride={settings()} onSettingsPersist={(s) => persisted.push(s)} />,
    )
    expect(H.binderApis[0].bindings(), 'nothing drawn to hide — vacuous').toHaveLength(1)

    act(() => { fireEvent.keyDown(document, { altKey: true, code: 'KeyU' }) })

    expect(persisted.length, 'Alt+U persisted nothing — the shortcut is not wired').toBeGreaterThan(0)
    const next = persisted.at(-1)
    expect(next.indicators.vwap.enabled, 'Alt+U did not flip the toggle').toBe(false)
    expect(next.indicatorInstances, 'the keystroke must not rewrite the instance list')
      .toEqual([VWAP_INSTANCE])

    view.unmount(); cleanup(); H.reset()
    render(<StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={next} />)
    expect(H.binderApis[0].bindings(), 'Alt+U left the engine\'s VWAP on the chart').toHaveLength(0)
    expect(vwapLines(), 'Alt+U left a legacy VWAP behind instead').toHaveLength(0)
  })

  it('toggling the legacy switch OFF and back ON never leaves TWO cyan lines', () => {
    // ⚠️ FLIP-A SEMANTICS: `cs.indicators.vwap.enabled` is still the SWITCH; the
    // instance is only the renderer.
    const off = { indicators: { vwap: { ...VWAP_CFG, enabled: false } } }
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings()} />,
    )
    expect(H.binderApis[0].bindings()).toHaveLength(1)
    const first = H.binderApis[0].bindings().map(b => b.series)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings(off)} />,
    )
    expect(H.binderApis[0].bindings(), 'legacy toggle off: the engine still holds a series').toHaveLength(0)
    for (const s of first) expect(H.removedSeries, 'a VWAP line is still on the chart').toContain(s)
    expect(liveVwapLines(), 'and nothing drew a replacement').toHaveLength(0)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings()} />,
    )
    expect(H.binderApis[0].bindings(), 'toggled back on: the engine draws it again').toHaveLength(1)
    expect(liveVwapLines(), 'toggled back on: the legacy block drew one too').toHaveLength(1)
  })

  it('an instance arriving MID-SESSION removes the line legacy already drew', () => {
    // ⛔ THE SINGLE MOST-REPEATED DEFECT ON THIS BRANCH. Every other case here
    // starts with the engine ALREADY owning VWAP, so `vwapSeriesRef` is null and
    // there is nothing to orphan. The crossover a user actually hits is the other
    // order: the chart is up, legacy has drawn a cyan line, and THEN an instance
    // appears. The guard is on the block's own `if`, whose `else if` removes the
    // ref; hoist it into the body and the user gets two cyan lines, one dead.
    const legacyFirst = { ...VWAP_ON, engineEnabled: true, indicatorInstances: [] }
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legacyFirst} />,
    )
    const legacyDrawn = vwapLines().map(c => c.series)
    expect(legacyDrawn, 'the LEGACY block drew nothing — nothing to orphan').toHaveLength(1)
    expect(H.binderApis[0].bindings(), 'the engine already owns it — vacuous').toHaveLength(0)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS}
        settingsOverride={{ ...legacyFirst, indicatorInstances: [VWAP_INSTANCE] }} />,
    )

    const engineDrawn = H.binderApis[0].bindings().map(b => b.series)
    expect(engineDrawn, 'the engine did not take over').toHaveLength(1)
    expect(engineDrawn, 'the engine re-used the LEGACY series — it does not own that')
      .not.toContain(legacyDrawn[0])
    expect(H.removedSeries, 'the legacy VWAP was left under the engine\'s copy')
      .toContain(legacyDrawn[0])
  })

  it('and the reverse — the instance LEAVING hands VWAP back to legacy', () => {
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings()} />,
    )
    const engineDrawn = H.binderApis[0].bindings().map(b => b.series)
    expect(engineDrawn).toHaveLength(1)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS}
        settingsOverride={settings({ indicatorInstances: [] })} />,
    )
    expect(H.binderApis[0].bindings(), 'the engine still holds a series').toHaveLength(0)
    for (const s of engineDrawn) expect(H.removedSeries).toContain(s)
    expect(liveVwapLines(), 'VWAP vanished when the instance was removed').toHaveLength(1)
  })

  it('a TIMEFRAME change to daily removes the engine\'s line, and back restores it', () => {
    // The gate's own mid-session crossover, and the one no other definition has.
    // A user switching 5m -> D -> 5m must not accumulate lines, and must not lose
    // the indicator when they come back.
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings()} />,
    )
    const first = H.binderApis[0].bindings().map(b => b.series)
    expect(first).toHaveLength(1)

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings()} />)
    expect(H.binderApis[0].bindings(), 'the engine kept a session VWAP on daily bars').toHaveLength(0)
    for (const s of first) expect(H.removedSeries, 'the engine\'s line survived the tf change').toContain(s)
    expect(liveVwapLines(), 'the legacy block picked it up on daily bars').toHaveLength(0)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings()} />,
    )
    expect(H.binderApis[0].bindings(), 'VWAP never came back on the intraday chart').toHaveLength(1)
    expect(liveVwapLines(), 'and legacy drew a second one alongside it').toHaveLength(1)
  })

  it('a COLOUR change re-styles the SAME series — never destroys and recreates', () => {
    // lightweight-charts#2049.
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings()} />,
    )
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(before).toHaveLength(1)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings({
        indicatorInstances: [{ ...VWAP_INSTANCE, inputs: { ...VWAP_INSTANCE.inputs, color: '#00ff00' } }],
      })} />,
    )
    expect(H.binderApis[0].bindings().map(b => b.series),
      'the engine created a new series instead of restyling').toEqual(before)
    expect(H.removedSeries.filter(s => before.includes(s)),
      'the VWAP line was destroyed and recreated — that is the #2049 path').toHaveLength(0)
  })

  it('an OPACITY change re-styles the same series, and the colour STRING changes', () => {
    // The fold, from the component. `opacity` reaches no plot field — it is
    // composed into the colour by `eligibility` — so "the series was re-bound" is
    // not enough: the string it was re-bound WITH is the assertion.
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings()} />,
    )
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(vwapLines('#26C6DA'), 'the full-strength colour is not the base string').toHaveLength(1)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings({
        indicatorInstances: [{ ...VWAP_INSTANCE, inputs: { ...VWAP_INSTANCE.inputs, opacity: 40 } }],
      })} />,
    )
    expect(H.binderApis[0].bindings().map(b => b.series)).toEqual(before)
    // ⚠️ The LAST applyOptions on a series is not necessarily the STYLE one — the
    // hide-all effect writes `{visible}` on every paint. Filter to the calls that
    // carry the key under test, and require at least one, or a suite where the
    // engine stopped re-styling entirely would pass on `undefined === undefined`.
    const styled = H.applyOptionsCalls.filter(c => c.series === before[0] && c.options && 'color' in c.options)
    expect(styled.length, 'the series was never re-styled at all').toBeGreaterThan(0)
    expect(styled.at(-1).options.color, 'opacity never reached the series')
      .toBe('rgba(38, 198, 218, 0.4)')
  })

  it('a LINE-STYLE change reaches the series — the divergence Task 8 found', () => {
    // `lineStyle` was not a substitutable plot field, so the engine drew SOLID for
    // every user who had chosen dashed. From the component, because the unit test
    // and the parity case both go through paths a reader can dismiss as synthetic:
    // this is `cs.indicatorInstances` -> the real chart -> the real series option.
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings()} />,
    )
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(vwapLines()[0].options.lineStyle, 'solid is not 0 — the map moved').toBe(0)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={settings({
        indicatorInstances: [{ ...VWAP_INSTANCE, inputs: { ...VWAP_INSTANCE.inputs, lineStyle: 'dashed' } }],
      })} />,
    )
    const styled = H.applyOptionsCalls.filter(c => c.series === before[0] && c.options && 'lineStyle' in c.options)
    expect(styled.length, 'the series was never re-styled at all').toBeGreaterThan(0)
    expect(styled.at(-1).options.lineStyle, 'the user\'s dashed VWAP renders solid').toBe(2)
  })
})

describe('an engine-drawn VWAP adds NOTHING to the crosshair legend', () => {
  // `plots[0].legend.hide` is the declaration; this is what it has to MEAN.
  // The LEGACY read is the control: the absence has to be legacy's, not a bug in
  // the engine's chip builder, or "no chip" would be indistinguishable from "the
  // readout is broken for price overlays".
  // ⚠️ THE LEGEND IS A CROSSHAIR-DRIVEN RENDER, NOT A STATIC ONE. A helper that
  // just read `container.textContent` after mount returned the empty string for
  // BOTH lanes, and every assertion below passed on `'' === ''`. The chips only
  // exist after a `crosshairMove` reaches the LEGEND's subscriber — and StockChart
  // registers two subscribers on the same chart, so the event has to go to all of
  // them. This is the same `hover` shape the RSI suite above uses, with a
  // non-vacuity check that the legend rendered SOMETHING before anything is
  // concluded from what it does not contain.
  // ⚠️ POLLED TO STABILITY, NOT SLEPT — `settledLegend`, at the top of this file.
  // This case is where that rule was found: it passed alone, passed in the chart
  // selection, then failed once in a full 400-file run and passed on the retry.
  // It used to carry its own copy of the poll while the RSI/BB/MACD helpers above
  // still slept a fixed 40 ms; all five now share ONE implementation, so the next
  // legend case inherits it instead of copying the sleep for a sixth time.
  const legendOf = (over) => {
    cleanup(); H.reset()
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={over} alwaysShowLegend />,
    )
    const vwap = vwapLines()[0]
    return settledLegend(view, crosshairAt(INTRADAY_BARS, vwap ? [[vwap.series, { value: 101.5 }]] : []))
  }

  it('LEGACY prints no VWAP chip, and the ENGINE prints the same legend', async () => {
    const legacy = await legendOf(VWAP_ON)
    // Non-vacuity FIRST: the legend has to have rendered, or "contains no VWAP"
    // is a statement about an empty string.
    expect(legacy, 'the legend rendered nothing — the comparison below is vacuous').toMatch(/O\s*1/)
    const engine = await legendOf({ ...VWAP_ON, engineEnabled: true, indicatorInstances: [VWAP_INSTANCE] })
    expect(engine, 'the ENGINE legend rendered nothing').toMatch(/O\s*1/)
    expect(legacy, 'the LEGACY legend grew a VWAP chip').not.toMatch(/VWAP/i)
    expect(engine, 'the ENGINE legend is not character-for-character the legacy one').toBe(legacy)
    // …and the value the engine's series was hovered WITH does not appear either,
    // which is the sharper claim: `legend.hide` suppresses the chip, it does not
    // merely omit the label.
    expect(engine, 'the engine printed VWAP\'s value without a label').not.toContain('101.5')
  })

  it('and the definition still DECLARES the chip hidden — the reason the above holds', () => {
    const def = registry.getDefinition('vwap')
    expect(def.plots).toHaveLength(1)
    expect(def.plots[0].legend.hide, 'VWAP grew a legend chip the shipped chart never had').toBe(true)
  })
})

describe('vwapOverride — the enable signal that is not a toggle', () => {
  // The Model Book intraday popup passes `vwapOverride={{color}}`, which FORCES
  // the indicator on regardless of `indicators.vwap.enabled` and forces its
  // colour. No other migrated definition has an enable signal outside its own
  // settings key, and getting it wrong is silent: the popup simply loses its VWAP.
  const withOverride = (settingsOverride, override) => render(
    <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS}
      settingsOverride={settingsOverride} vwapOverride={override} />,
  )

  it('LEGACY draws a forced white VWAP with the toggle OFF — the control', () => {
    withOverride({ indicators: { vwap: { ...VWAP_CFG, enabled: false } } }, { color: '#ffffff' })
    expect(vwapLines('#ffffff'), 'the override stopped forcing VWAP on').toHaveLength(1)
  })

  it('the ENGINE draws it too — an instance is MANUFACTURED for a blob that has none', () => {
    // `eligibility` may only ever NARROW, so the forced instance is built where
    // instances are built. Without it the engine owns nothing, the legacy block
    // draws — which looks fine until the day the legacy block is deleted.
    withOverride({
      indicators: { vwap: { ...VWAP_CFG, enabled: false } },
      engineEnabled: true, indicatorInstances: [],
    }, { color: '#ffffff' })
    expect(H.binderApis[0].bindings(), 'no instance was manufactured for the override').toHaveLength(1)
    expect(vwapLines('#ffffff'), 'a second white line — the legacy block did not stand down').toHaveLength(1)
  })

  it('the forced instance carries ONLY declared input keys', () => {
    // It never passes through `validateInstance`, so `enabled` — which every
    // legacy indicator blob carries — would ride along into `inputsSignature` and
    // the folds. Today that key is INERT (nothing downstream reads it), which is
    // exactly why this has to be asserted at the SEAM rather than through the
    // picture: a mutation replacing the key filter with `{...cs.indicators.vwap}`
    // changes no pixel and no series option, and every behavioural assertion in
    // this file stays green. The instance list the binder is HANDED is the only
    // place the difference exists, and `H.syncCalls` is where it is visible.
    withOverride({
      indicators: { vwap: { enabled: false, color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 3 } },
      engineEnabled: true, indicatorInstances: [],
    }, { color: '#ffffff' })
    const bound = H.binderApis[0].bindings()
    expect(bound).toHaveLength(1)
    expect(vwapLines('#ffffff')[0].options.lineWidth, 'the blob\'s width did not reach the series').toBe(3)

    const handed = H.syncCalls.at(-1).instances.filter(i => i.defId === 'vwap')
    expect(handed, 'the binder was handed no vwap instance').toHaveLength(1)
    const declared = registry.getDefinition('vwap').inputs.map(d => d.key)
    expect(declared, 'the definition declares no inputs — this check is vacuous').not.toHaveLength(0)
    for (const k of Object.keys(handed[0].inputs)) {
      expect(declared, `undeclared input key ${k} rode into the manufactured instance`).toContain(k)
    }
    expect(Object.keys(handed[0].inputs), 'the blob\'s `enabled` reached the binder').not.toContain('enabled')
  })

  it('an EXISTING instance draws under the override even with the toggle OFF', () => {
    // ⚠️ THE PROJECTION, NOT THE MANUFACTURE. Every other override case here has
    // an EMPTY instance list, so the forced-instance branch supplies the instance
    // and its `hidden: false` carries it. When the blob ALREADY has one, the
    // branch does nothing and the only thing keeping it visible is
    // `legacyEnabled('vwap')` reading `(vwapOverride || enabled)`. Drop the
    // override from that read and the Model Book popup projects the instance to
    // `hidden` and silently loses its VWAP — with the legacy block ALSO stood
    // down, because ownership survives hiding. Nothing else in this file can see
    // it: the manufactured path stays green.
    withOverride({
      indicators: { vwap: { ...VWAP_CFG, enabled: false } },
      engineEnabled: true, indicatorInstances: [VWAP_INSTANCE],
    }, { color: '#ffffff' })
    const handed = H.syncCalls.at(-1).instances.filter(i => i.defId === 'vwap')
    expect(handed, 'the instance was dropped entirely').toHaveLength(1)
    expect(handed[0].hidden, 'the override did not count as an enable signal').toBe(false)
    expect(H.binderApis[0].bindings(), 'the engine drew nothing under the override').toHaveLength(1)
    expect(vwapLines('#ffffff'), 'the forced white line is missing').toHaveLength(1)
  })

  it('an EXISTING instance is recoloured, not duplicated', () => {
    withOverride({
      ...VWAP_ON, engineEnabled: true, indicatorInstances: [VWAP_INSTANCE],
    }, { color: '#ffffff' })
    expect(H.binderApis[0].bindings(), 'the override manufactured a SECOND instance').toHaveLength(1)
    expect(vwapLines('#ffffff')).toHaveLength(1)
    expect(vwapLines('#26C6DA'), 'the override failed to recolour the existing instance').toHaveLength(0)
  })

  it('the override does NOT beat the timeframe gate', () => {
    // Forcing an indicator ON cannot conjure a session on a daily bar. Legacy
    // agrees — `(vwapOverride || enabled) && VWAP_TFS.has(tf)`, the gate is the
    // outer `&&`.
    render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={{ engineEnabled: true, indicatorInstances: [] }} vwapOverride={{ color: '#ffffff' }} />,
    )
    expect(H.binderApis[0].bindings()).toHaveLength(0)
    expect(vwapLines('#ffffff')).toHaveLength(0)
  })
})

describe('a VWAP instance survives BOTH settings allow-lists', () => {
  it('mergeChartSettings keeps the instance and the flag through a JSON round-trip', () => {
    const merged = mergeChartSettings(JSON.stringify({
      ...VWAP_ON, engineEnabled: true, indicatorInstances: [VWAP_INSTANCE],
    }))
    expect(merged.indicatorInstances).toEqual([VWAP_INSTANCE])
    expect(merged.engineEnabled).toBe(true)
    expect(merged.indicators.vwap.enabled).toBe(true)
    // …and the three style keys the row offers, which a narrower allow-list drops.
    expect(merged.indicators.vwap).toMatchObject({ opacity: 100, lineStyle: 'solid', lineWidth: 1 })
  })

  it('mergeSettingsOverride patches ONE input without deleting the instance', () => {
    const base = mergeChartSettings(JSON.stringify({
      ...VWAP_ON, engineEnabled: true, indicatorInstances: [VWAP_INSTANCE, RSI_INSTANCE],
    }))
    const out = mergeSettingsOverride(base, {
      indicatorInstances: [{ instanceId: 'legacy:vwap', inputs: { lineStyle: 'dotted' } }],
    })
    expect(out.indicatorInstances, 'the generic array path replaced the list').toHaveLength(2)
    const vwap = out.indicatorInstances.find(i => i.instanceId === 'legacy:vwap')
    expect(vwap.inputs).toEqual({ ...VWAP_INSTANCE.inputs, lineStyle: 'dotted' })
    expect(out.indicatorInstances.find(i => i.instanceId === RSI_INSTANCE.instanceId))
      .toEqual(RSI_INSTANCE)
  })

  it('and the round-tripped blob still draws exactly one engine line, dotted', () => {
    const base = mergeChartSettings(JSON.stringify({
      ...VWAP_ON, engineEnabled: true, indicatorInstances: [VWAP_INSTANCE],
    }))
    const out = mergeSettingsOverride(base, {
      indicatorInstances: [{ instanceId: 'legacy:vwap', inputs: { lineStyle: 'dotted' } }],
    })
    drawIntraday(out)
    expect(H.binderApis[0].bindings()).toHaveLength(1)
    expect(vwapLines(), 'the legacy block drew its own copy alongside').toHaveLength(1)
    expect(vwapLines()[0].options.lineStyle, 'the round-tripped style did not reach the series').toBe(1)
  })
})

// ─── THE FLIP-B MACHINERY IS INERT WHILE NOTHING IS FLIPPED (B3 Task 9) ─────
//
// Task 9 lands three pieces — `csForPaneMarginsProjection`, `instanceControls`
// and the gated read-time migrator — with `ENGINE_FLIPPED_DEF_IDS` EMPTY. Its
// whole gate is that NOTHING CHANGES in that state, and "nothing changed" is
// only a claim until something asserts each way it could.
//
// ⚠️ INERTNESS IS HALF A GATE. A projection wired to a constant `false`, a
// migrator gate that can never open, a control branch nothing can reach — all
// three pass every case below. The other half is
// `flipBWithANonEmptySet.test.jsx`, which mocks the set non-empty and drives the
// same component through the machinery. Neither file is worth much without the
// other.
describe('the Flip-B machinery is inert while nothing is flipped (Task 9)', () => {
  it('ENGINE_FLIPPED_DEF_IDS is empty, and is a SUBSET of the migrated set', () => {
    // Flipped-but-not-migrated means the legacy block was deleted and nothing
    // replaced it — an indicator that renders nothing at all.
    expect(ENGINE_FLIPPED_DEF_IDS.size).toBe(0)
    for (const id of ENGINE_FLIPPED_DEF_IDS) expect(ENGINE_MIGRATED_DEF_IDS.has(id), id).toBe(true)
  })

  it('a legacy toggle alone still draws the LEGACY series, not the engine\'s', () => {
    // With nothing flipped, only STORED instances reach the binder. If the
    // read-time migrator were ungated, turning the flag on would silently move
    // four indicators onto the engine with no instance anywhere.
    draw({ engineEnabled: true, indicators: { rsi: { enabled: true } } })
    expect(H.binderApis[0].bindings()).toHaveLength(0)
    expect(H.addSeriesCalls.filter(c => c.options?.priceScaleId === 'rsi')).toHaveLength(1)
  })

  it('…and the read-time migrator is never RUN at all — the gate, not just its effect', () => {
    // ⛔ THE MUTATION THAT SURVIVED UNTIL THIS CASE EXISTED. Ungating the migrator
    // (`const source = true`) changes NOTHING observable while the flip set is
    // empty, because the per-definition filter behind it discards every projected
    // instance anyway — same bindings, same series, same pixels. What it costs is
    // a registry walk and a blob walk on EVERY PAINT, on every chart, for every
    // user, and that is invisible to a binding count. So the gate is asserted on
    // what it actually guards: the call.
    draw({ engineEnabled: true, indicators: { rsi: { enabled: true } }, indicatorInstances: [RSI_INSTANCE] })
    expect(H.binderApis[0].bindings(), 'nothing was drawn — this case is vacuous').toHaveLength(1)
    expect(H.migrateCalls, 'the read-time migrator ran while nothing is flipped').toBe(0)
  })

  it('…and that holds for EVERY migrated definition, not just the one it was written for', () => {
    // The ungated migrator would move all four at once. A case pinned to `rsi`
    // would still be green with `bb`, `macd` and `vwap` silently re-homed.
    for (const defId of ENGINE_MIGRATED_DEF_IDS) {
      cleanup(); H.reset()
      const tf = tfFor(defId)
      draw({ engineEnabled: true, indicators: { [defId]: { enabled: true } } }, tf)
      expect(H.binderApis[0].bindings(), `${defId} reached the engine with no stored instance`)
        .toHaveLength(0)
    }
  })

  it('the margins the engine is handed come from the SAME OBJECT the legacy path used', () => {
    // ⛔ IDENTITY, NOT DEEP EQUALITY. Two different blobs can produce deep-equal
    // margins, so a `toEqual` here would pass for a projection that allocated a
    // fresh object on every paint — which is a real cost (`computePaneMargins`
    // runs per frame) and a real signal that the dark path is no longer dark.
    // The wrapper around the real `csForPaneMargins` is what makes the return
    // value observable at all.
    draw({ engineEnabled: true, indicators: { rsi: { enabled: true } }, indicatorInstances: [RSI_INSTANCE] })
    expect(H.csForPaneMarginsCalls.length,
      'csForPaneMargins was never called — the projection is not wired in').toBeGreaterThan(0)
    for (const call of H.csForPaneMarginsCalls) {
      expect(call.flipped.size, 'a non-empty flip set shipped').toBe(0)
      expect(call.out, 'the projection allocated a new blob while nothing is flipped').toBe(call.cs)
    }
    // …and the band the binder was actually handed is the legacy answer.
    const ctx = H.syncCalls.at(-1)
    expect(ctx.paneMargins.rsi).toEqual({ top: 0.85, bottom: 0 })
  })

  it('…including on a chart with NO instances at all, where it is also called', () => {
    // The projection sits on the paint path for every chart, not just engine
    // ones. If it allocated here it would allocate for every user on every frame.
    draw({ indicators: { rsi: { enabled: true } } })
    expect(H.csForPaneMarginsCalls.length, 'not called on a flag-off chart').toBeGreaterThan(0)
    for (const call of H.csForPaneMarginsCalls) expect(call.out).toBe(call.cs)
  })

  it('the toolbar\'s rows still write the LEGACY section, because none has a writer yet', () => {
    // `updateIndicator` routes to `instanceControls` for a FLIPPED id only. With
    // the set empty the legacy branch is the only reachable one — so the enable
    // checkbox writes `cs.indicators.rsi.enabled` exactly as it always has, and
    // no `indicatorInstances` key appears in a blob that had none.
    const persisted = []
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={{ indicators: { rsi: { enabled: true } } }}
        onSettingsPersist={(s) => persisted.push(s)} />,
    )
    act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'i' }) })
    expect(persisted.length, 'Ctrl+I persisted nothing — this case is vacuous').toBeGreaterThan(0)
    const last = persisted.at(-1)
    expect(last.indicators.rsi.enabled, 'the legacy toggle is no longer the switch').toBe(false)
    expect(last.indicatorInstances ?? [], 'a control wrote an instance while nothing is flipped').toEqual([])
    view.unmount()
  })
})
