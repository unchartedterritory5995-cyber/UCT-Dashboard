import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'
import intraday5m from '../../../../pages/parityBars/intraday5m.json'
// THE legend read, shared with `legendFromDefinitions.test.jsx` — see the note
// where `settledLegend` is wrapped below.
import { legendTextOf, settledLegend as settledLegendWith, LEGEND_RENDERED, legendAlways } from './legendProbe'
// ⭐ PHASE D TASK 8 — the one place a registry count lives. See the loop-counter
// note far below for why this is NOT the tautology the literal was guarding
// against: `REGISTRY_SIZES` is a hand-written manifest's arithmetic, not the set
// the loop iterated.
import { REGISTRY_SIZES } from '../registrySizes'

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
  // ⭐ B5 TASK 10 — AN OPT-IN PANE MODEL, OFF BY DEFAULT.
  //
  // `chart.panes()` answered with ONE 300px pane, which is right for every case
  // in this file: under `paneMode() === 'bands'` there IS one pane. Flip C needs
  // a double that can hold several, and turning that on globally would restate
  // the geometry of 400+ cases that never asked for it. So it is a null slot a
  // case OPTS INTO — `H.paneModel = { stackPx: 300 }` — and `panes()` then
  // derives the stack from the pane indices `addSeries` / `moveToPane` were
  // actually given and sizes it by the stretch factors the binder actually
  // wrote, using lightweight-charts' own rule (proportional over
  // `stackPx - separators`).
  paneModel: null,
  // The OPTIONS `createChart` was handed. Recorded because two of Flip C's
  // component-level answers live nowhere else: the candles' own `scaleMargins`
  // (which must come from the LAYOUT under `'panes'`, or the price pane moves)
  // and `layout.panes.enableResize` (spec 6's draggable divider).
  chartOptionsCalls: [],
  // Every `series.priceScale().applyOptions`. The CANDLES' margins are
  // re-asserted on the render path under `'panes'` (the options effect runs
  // before the layout exists), and this is the only place that write is visible.
  scaleApplyCalls: [],
  binderCreated: [],
  binderApis: [],
  syncCalls: [],
  crosshairHandlers: [],
  // ⭐ B5 TASK 12 RETIRED `csForPaneMarginsCalls`, WITH THE MODULE IT WATCHED.
  // `engine/paneMarginsProjection.js` existed to keep a SECOND copy of the band
  // arithmetic (`chart/paneMargins.js`, which read `cs.indicators[id].enabled`)
  // honest once the instance list became the authority. There is one copy now —
  // `computePaneLayout` reads the instances and returns the band map as
  // `layout.bands` — so there is no projection to observe. What the recorder was
  // ultimately protecting (the binder is handed bands that follow the INSTANCE
  // LIST) is asserted directly off `syncCalls[].paneMargins` below.
  // How many times the READ-TIME MIGRATOR ran. Its gate is otherwise
  // unobservable: the per-definition filter behind it already discards every
  // projected instance while the flip set is empty, so removing the gate changes
  // NOTHING a pixel or a binding can see — it just walks the registry and the
  // blob on every paint, for every user, forever. A mutation deleting it survived
  // until this counter existed.
  migrateCalls: 0,
  // The element `createChart` was handed — i.e. `containerRef.current`, which is
  // where the `contextmenu` listener lives. Recorded so the right-click cases
  // below can dispatch a REAL event at it instead of reaching into the component
  // or querying for a CSS-module class name.
  chartContainers: [],
  reset() {
    H.chartContainers.length = 0
    H.addSeriesCalls.length = 0
    H.removedSeries.length = 0
    H.visibilityCalls.length = 0
    H.applyOptionsCalls.length = 0
    H.priceLineCalls.length = 0
    H.setDataCalls.length = 0
    H.moveToPaneCalls.length = 0
    H.paneModel = null
    H.chartOptionsCalls.length = 0
    H.scaleApplyCalls.length = 0
    H.binderCreated.length = 0
    H.binderApis.length = 0
    H.syncCalls.length = 0
    H.crosshairHandlers.length = 0
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

// ⛔ AND THERE IS NO `vi.mock('../paneMarginsProjection')` ANY MORE — B5 Task 12
// DELETED THE MODULE. It wrapped the real projection so its ARGUMENT and its
// RETURN were both visible, which was the only way to see that the blob handed to
// `computePaneMargins` had been rewritten from the instance list. `paneMargins.js`
// is retired into `computePaneLayout`, which reads the instances itself, so the
// projection has no subject and neither has its recorder.

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
      priceScale: () => ({ applyOptions: (o) => { H.scaleApplyCalls.push({ series: s, options: o }) }, width: () => 0 }),
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
    panes: () => {
      const m = H.paneModel
      if (!m) return [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }]
      const seen = [...H.addSeriesCalls.map(x => x.paneIndex || 0), ...H.moveToPaneCalls.map(x => x.paneIndex || 0)]
      const n = Math.max(1, ...seen.map(x => x + 1))
      if (!Array.isArray(m.stretch)) m.stretch = []
      for (let i = 0; i < n; i++) if (!Number.isFinite(m.stretch[i])) m.stretch[i] = 1
      m.stretch.length = n
      const sep = 1
      const available = m.stackPx - (n - 1) * sep
      const total = m.stretch.reduce((x, y) => x + y, 0) || 1
      const heights = m.stretch.map(v => Math.round((available * v) / total))
      // The remainder lands on pane 0, so the stack sums EXACTLY — the same
      // property `computePaneLayout` guarantees and the binder's check reads.
      heights[0] += available - heights.reduce((x, y) => x + y, 0)
      return heights.map((h, i) => ({
        paneIndex: () => i,
        getHeight: () => h,
        getStretchFactor: () => m.stretch[i],
        setStretchFactor: (v) => { m.stretch[i] = v },
        getSeries: () => [],
        getHTMLElement: () => document.createElement('div'),
      }))
    },
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: (el, options) => { H.chartContainers.push(el); H.chartOptionsCalls.push(options); return chart },
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

const { default: StockChart, ENGINE_OWNED } = await import('../../../StockChart')
const registry = await import('../nativeRegistry')
// The two settings ALLOW-LISTS a migrated instance has to survive — see the
// round-trip suite at the bottom of this file.
const { mergeChartSettings, mergeSettingsOverride } = await import('../../chartDefaults')
// The FLIP-B writer. Cases that used to move `cs.indicators.<id>.enabled` by hand
// have to go through it for a flipped id, because that field stopped being the
// switch — writing it by hand is now a test of a mirror, not of a control.
const { setIndicatorEnabled, isIndicatorEnabled } = await import('../instanceControls')
const { migrateLegacyToInstances, SHIPPED_STACK_ORDER } = await import('../instances')
// THE ONE LIST. Imported, never re-derived — a second copy of `catalogRows()`
// inside this file would be the sixteenth hand-written list wearing the name of
// the thing that ends them.
const { catalogRows, labelFor, oscillatorIds } = await import('../../indicatorCatalog')
// THE FOUR CHORDS, declared once (B4 Task 4). Imported so the dispatch cases
// below iterate the SHIPPED table rather than a fifth hand-written copy of it —
// a chord added to the table and not to a test would otherwise be untested.
const { INDICATOR_CHORDS } = await import('../../keyboardShortcuts')
const { __setPaneModeForTest } = await import('../paneLayout')
// The compute the crosshair's per-plot split rests on — see the equivalence proof
// next to the two-chip legend case.
const { computeMACD } = await import('../../indicators')
// The share link's DECODER — the recipient's half. Task 5 only widens what goes
// IN; decoding the real artifact is how "what goes in" is read back out.
const { urlToChartState } = await import('../../chartScreenshot')

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
  <StockChart sym="AAPL" tf={tf} barsOverride={barsFor(tf)} settingsOverride={legendAlways(settingsOverride)} />,
)

/**
 * What the engine currently holds — `[]` when no binder was ever CONSTRUCTED.
 *
 * ⭐ B5 TASK 4. `engineNeeded` used to be `engineOn || engineInstances.length > 0`,
 * so a fixture that set `engineEnabled: true` got a live binder holding nothing and
 * `H.binderApis[0].bindings()` was always safe to read. The flag is deleted and the
 * predicate is now honestly `engineInstances.length > 0`, so a chart with nothing
 * to draw constructs NO binder — which is the same "zero lightweight-charts calls"
 * property, stated from the thing that decides it.
 *
 * ⚠️ SO `[]` HERE IS THE STRONGER READING, NOT A SOFTENED ONE: "the binder refused
 * it" and "there is no binder at all" both mean nothing was drawn, and the second
 * additionally means nothing was constructed. Every call site that used to read
 * `.bindings()` directly asserted a LENGTH; those assertions are unchanged.
 */
const bound = () => (H.binderApis[0] ? H.binderApis[0].bindings() : [])

/**
 * ⛔ AND THERE IS DELIBERATELY NO `bands()` TWIN OF THE ABOVE.
 *
 * A "the band was RELEASED" claim reads `paneMargins.<id>` and expects `undefined`,
 * so a helper that answered `{}` when no sync happened would make every one of
 * those cases pass over an absent engine — the exact vacuity this file audits for.
 * Cases that assert a released band therefore keep ONE live engine instance on the
 * chart, which both keeps a sync happening and proves the margins object is real.
 * `BB_CONTROL` is that instance for the RSI cases.
 */
const BB_CONTROL = { bb: { enabled: true, period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' } }

/**
 * Pin a whole suite to `PANE_MODE === 'bands'` — THE GEOMETRY FLIP C REVERSES TO.
 *
 * ⭐ B5 TASK 12 FLIPPED THE CONSTANT, and that turned a large part of this file
 * into a set of claims written in a vocabulary the shipped mode no longer speaks.
 * A pane oscillator's band was a slice of pane 0 on a price scale NAMED AFTER THE
 * DEFINITION, so `addSeriesCalls.filter(o => o.priceScaleId === 'rsi')` was how
 * every suite below counted RSI's lines, `paneIndex === 0` was how it said "in the
 * band", and `{top: 0.85, bottom: 0}` was the band itself. Under `'panes'` the
 * oscillator owns a REAL pane and its numbers ride that pane's own right axis
 * (`placement.js`, sub-choice 2.2) — so every one of those locators answers about
 * a scale nothing is on any more.
 *
 * ⛔ AND THE FAILURE DIRECTION IS NOT UNIFORM, WHICH IS WHY THIS IS A PIN AND NOT
 * A LOCATOR EDIT. `expect(rsiSeries()).toHaveLength(1)` goes RED, and is a real
 * failure. `expect(rsiSeries()).toHaveLength(0)` — "a hidden instance draws
 * nothing", "the band it vacated has no orphan" — goes GREEN OVER AN EMPTY READ,
 * measuring nothing at all. Half the cases in a suite screaming while the other
 * half silently stops meaning anything is the exact shape this branch keeps
 * finding, and pinning the mode is what makes BOTH halves honest again: the claims
 * are true, they are still gates, and they describe the mode one edit of
 * `PANE_MODE` returns the app to.
 *
 * ⛔ THE SHIPPED MODE IS NOT LEFT UNCOVERED, and this pin is not where it would be
 * covered anyway: `__tests__/flipCGeometry.test.jsx` drives a REAL chart through
 * the cutover (a pane per oscillator in instance-list order, the pane heights to
 * the pixel, the §A6 candle-rectangle identity, #2049 reuse across a pane move,
 * the right-click resolver on real pane rectangles), and the two suites at the
 * BOTTOM of this file drive the component under `'panes'` for the two answers that
 * live nowhere else — the context menu and the chart's own options.
 */
const pinBandsMode = () => {
  beforeEach(() => { __setPaneModeForTest('bands') })
  afterEach(() => { __setPaneModeForTest(null) })
}

// ─── THE RIGHT-CLICK MENU, DRIVEN FOR REAL ──────────────────────────────────
//
// ⭐ THESE TWO DOORS HAD NO BEHAVIOURAL GATE UNTIL NOW. `flipB.test.jsx` gates
// them STRUCTURALLY — string matches against the shipped identifiers — and says
// so, because `buildRegionSections` is only reachable through a `contextmenu` on
// a canvas region "the jsdom double cannot produce". It can, with two pieces the
// double was one line away from already having:
//
//   1. the CONTAINER. `createChart` now records the element it is handed, which
//      is `containerRef.current` — the node the listener is attached to. No CSS
//      module class name to guess at, no reaching into the component.
//   2. a RECT. jsdom answers 0×0 for every `getBoundingClientRect`, which makes
//      `plotBottom` negative and every click land on the time axis. Stubbed on
//      the container for the duration of the dispatch, then removed.
//
// ⛔ AND NO COPY OF THE BAND MATH. The obvious harness computes the y of the
// band it wants from `computePaneMargins` — which is a second implementation of
// the geometry `openMenuAt` already does, i.e. exactly the twin this phase is
// retiring, in the file that is retiring them. Instead the helper SCANS y and
// takes the first click whose resolved region is the one asked for. It reads the
// region off the payload the component produced, so it cannot drift from the
// component, and it THROWS BY NAME when no y resolves — which is what a case
// that forgot to enable its indicator deserves, rather than a green pass over an
// empty menu.
const PLOT = { width: 800, height: 400 }

const renderChart = ({ settings = null, tf = 'D', ...props } = {}) => {
  const persisted = []
  const view = render(
    <StockChart sym="AAPL" tf={tf} barsOverride={barsFor(tf)}
      settingsOverride={legendAlways(settings)}
      onSettingsPersist={(s) => persisted.push(s)}
      {...props} />,
  )
  return {
    ...view,
    /** The blob the last menu click wrote. Throws rather than returning
     *  `undefined` when nothing was written — a menu item wired to nothing must
     *  fail the case, not read as "no change". */
    lastSettings: () => {
      expect(persisted.length,
        'no settings write reached onSettingsPersist — the menu item wrote nowhere').toBeGreaterThan(0)
      return persisted.at(-1)
    },
    /**
     * Drive the SHARE door for real and return the URL that reached the clipboard.
     *
     * ⚠️ THE SPY IS NOT OPTIONAL. `handleCopyShareUrl` swallows its own failure in
     * a bare `catch {}` (`StockChart.jsx`), and jsdom has no `navigator.clipboard`
     * — so without stubbing one, the whole door is a no-op and every assertion
     * below would be about a URL nobody ever produced. The call COUNT is asserted
     * too: "wrote something" and "wrote exactly once" are different claims, and
     * the popover fires this on a click.
     */
    copyShareUrl: async () => {
      const writeText = vi.fn(() => Promise.resolve())
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
      const open = view.container.querySelector('[aria-label="Share chart"]')
      expect(open, 'no share button on the toolbar — the door this case drives does not exist').toBeTruthy()
      await act(async () => { fireEvent.click(open) })
      const row = [...view.container.querySelectorAll('button')]
        .filter(b => /Copy Share URL/.test(b.textContent || ''))
      expect(row, 'the share popover has no "Copy Share URL" row').toHaveLength(1)
      await act(async () => { fireEvent.click(row[0]) })
      expect(writeText, 'nothing reached the clipboard — the share door copied NOTHING, and its ' +
        'bare `catch {}` means a build that copies nothing looks identical to one that works')
        .toHaveBeenCalledTimes(1)
      return writeText.mock.calls[0][0]
    },
  }
}

/**
 * Right-click the named REGION and return the sections the component built.
 *
 * @param want `{ region: 'price'|'volume'|'indicator'|'overlay'|'priceAxis', key? }`
 */
const openContextMenu = (view, want) => {
  const el = H.chartContainers.at(-1)
  expect(el, 'no chart container was recorded — the chart never mounted').toBeTruthy()
  const captured = []
  const onCtx = (e) => captured.push(e.detail)
  window.addEventListener('uct:chart-contextmenu', onCtx)
  const rect = { left: 0, top: 0, right: PLOT.width, bottom: PLOT.height, x: 0, y: 0, ...PLOT, toJSON: () => ({}) }
  el.getBoundingClientRect = () => rect
  try {
    for (let y = 1; y < PLOT.height; y += 1) {
      captured.length = 0
      fireEvent.contextMenu(el, { clientX: 120, clientY: y })
      const hit = captured[0]
      if (!hit) continue
      if (hit.region.type !== want.region) continue
      if (want.key && hit.region.key !== want.key) continue
      return hit.sections
    }
  } finally {
    delete el.getBoundingClientRect
    window.removeEventListener('uct:chart-contextmenu', onCtx)
  }
  throw new Error(
    `openContextMenu: no click in the plot resolved to ${JSON.stringify(want)}. ` +
    'An indicator region only exists while that indicator reserves a band — enable it ' +
    "in this case's settings, or the menu you are asserting on was never built.",
  )
}

/** A section by id, or a named failure. */
const sectionOf = (sections, id) => {
  const s = sections.find(x => x.id === id)
  expect(s, `no '${id}' section in the menu — the case is asserting on nothing`).toBeTruthy()
  return s
}
/** A submenu by item id, or a named failure. */
const submenuOf = (section, itemId) => {
  const item = section.items.find(i => i && i.id === itemId)
  expect(item, `no '${itemId}' item in the '${section.id}' section`).toBeTruthy()
  expect(item.submenu, `'${itemId}' is not a submenu`).toBeTruthy()
  return item.submenu
}

// ─── THE LEGEND READ — POLLED TO STABILITY, NEVER SLEPT ─────────────────────
//
// ⚠️ THE IMPLEMENTATION MOVED TO `legendProbe.js` AT B4 TASK 10, and the four
// measured lessons moved with it. Task 10 needed the same read in a second suite
// (`legendFromDefinitions.test.jsx`), and a second copy of a helper carrying
// four hard-won rules would have been exactly the twin this phase retires — in
// the middle of the task that retires the legend's own.
//
// What stays HERE is the part that cannot move: the four cases below, which
// drive that helper against a view whose text is still moving. Its stability
// rule is NOT falsifiable through the seventeen assertions that use it — on an
// unloaded box the legend settles inside the first dispatch — so those cases are
// the only place the rule is checked at all.
//
// The wrapper supplies THIS file's captured handler list, so every existing call
// site is unchanged.
const settledLegend = (view, param, ready = LEGEND_RENDERED) =>
  settledLegendWith(view, param, H.crosshairHandlers, ready)

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

// ⭐⭐ THIS BLOCK WAS "THE FLAG OFF IS THE WHOLE SAFETY STORY" UNTIL B5 TASK 4.
//
// The flag is deleted (`docs/decisions/2026-08-04-engine-enabled-deleted.md`), and
// the safety story it was supposed to tell is now told by the predicate that
// actually decides: `engineNeeded = engineInstances.length > 0`. That is not a
// weakening — it is the same property, measured from the thing that produces it
// rather than from a settings key that was `false` for every user alive and that
// no user action could change.
//
// ⚠️ AND IT IS A NO-OP IN PRODUCTION, BY CONSTRUCTION. `engineNeeded` used to read
// `engineOn || engineInstances.length > 0`; `engineOn` was false for every stored
// blob, so the disjunct was already dead everywhere except in fixtures that set
// the flag by hand. Those fixtures are what moved.
describe('StockChart × indicator engine — NOTHING TO DRAW is the whole safety story', () => {
  it('never constructs a binder and never calls sync with no instances', () => {
    draw(undefined)
    expect(H.binderCreated).toHaveLength(0)
    expect(H.syncCalls).toHaveLength(0)
  })

  it('stays dark even with instances stored in the blob — for a NON-MIGRATED definition', () => {
    // The realistic B3 crossover state: instances migrated into the settings, the
    // flag not yet flipped. Data present must not be enough to start rendering.
    //
    // ⚠️ THE SUBJECT HAS MOVED TWICE. It was `rsi` until Task 10 and `macd` until
    // Task 11; both are flipped now, and for a flipped id "the flag is off ⇒ draw
    // nothing" would mean "the indicator is deleted for every existing user".
    // What still stays dark is an instance of a definition the engine is not the
    // authority for at all — the filter that decides that is per definition, and
    // this is its closed state.
    //
    // ⚠️ AND IT MOVED A THIRD TIME (ATR at B5 Task 5), A FOURTH (`mfi` at Task
    // 7), A FIFTH (`adx`) — AND THEN THE SUBJECTS RAN OUT. Every one of those
    // moves went RED by name rather than letting the case quietly assert "a
    // flipped instance draws nothing", which would have been a false claim
    // passing for the wrong reason. B5 Task 8 took the last three (`adx`, `obv`,
    // `donchian`), so `ENGINE_OWNED` equals `listDefinitions()` and no
    // real id can serve here again.
    //
    // ⛔ SO IT MOVES DOWN A LEVEL RATHER THAN BEING DELETED. The claim is about
    // the FILTER's closed state, not about any indicator, and two subjects can
    // never expire: `volumeProfile`, the one indicator key with NO definition at
    // all (structurally carved out, not series-expressible, and spec §5 keeps it
    // that way), and a defId the registry has never heard of — the shape a stale
    // share link or a hand-edited blob produces. Neither may start the engine and
    // neither may throw.
    for (const instances of [
      [{ instanceId: 'legacy:volumeProfile', defId: 'volumeProfile', inputs: {}, hidden: false }],
      [{ instanceId: 'x:bogus', defId: '__notADefinition', inputs: {}, hidden: false }],
    ]) {
      cleanup(); H.reset()
      draw({ indicatorInstances: instances })
      expect(H.binderCreated, `${instances[0].defId} started the engine`).toHaveLength(0)
      expect(H.syncCalls, `${instances[0].defId} synced the engine`).toHaveLength(0)
    }
    // ⛔ AND THE CONTROL THAT THIS IS A CLOSED FILTER AND NOT A DEAD COMPONENT:
    // the same chart with a REAL flipped instance DOES construct a binder.
    cleanup(); H.reset()
    draw({ indicatorInstances: [RSI_INSTANCE] })
    expect(H.binderCreated, 'the engine never starts at all — the loop above is vacuous')
      .toHaveLength(1)
    // …and the real population really is exhausted, which is WHY these subjects
    // are structural. The day a definition ships un-migrated, this says so.
    expect(registry.listDefinitions().map(d => d.id).filter(id => !ENGINE_OWNED.has(id)),
      'an un-migrated definition exists again — drive this on the REAL one too').toEqual([])
  })

  it('⭐ …but a FLIPPED definition runs the engine anyway — it has no other renderer', () => {
    // The Flip-B exception. Every blob in production had `engineEnabled` absent,
    // so gating a flipped id on the flag would not have made the engine dark, it
    // would have deleted RSI for every user. That is the reasoning the flag's
    // deletion made unnecessary to state twice.
    draw({ indicatorInstances: [RSI_INSTANCE] })
    expect(H.binderCreated, 'a flipped instance did not start the engine').toHaveLength(1)
    expect(H.binderApis[0].bindings()).toHaveLength(1)
  })

  it('⛔ a leftover engineEnabled in a blob is INERT — it starts nothing', () => {
    // This case read *"treats a truthy-but-not-true flag as OFF"*, and it was
    // about `mergeChartSettings` reading `=== true` so a `"1"` from a URL param
    // could not light up a second render path. **`true` is in the list now**, and
    // that is the whole change: an old share link, a stale grid `settingsOverride`
    // or a blob that predates the deletion can still carry the key, and none of
    // them may start anything. `mergeSettingsOverride` writes primitives through
    // untouched, so `draw` is exactly the surface where a resurrected read would
    // show up first.
    for (const value of [true, '1', 1, 'true', {}]) {
      cleanup(); H.reset()
      draw({ engineEnabled: value })
      expect(H.binderCreated, `engineEnabled: ${JSON.stringify(value)}`).toHaveLength(0)
      expect(H.syncCalls, `engineEnabled: ${JSON.stringify(value)}`).toHaveLength(0)
    }
    // …and the control: the SAME surface with an instance does start one, so the
    // emptiness above is the key being inert and not `draw` being broken.
    cleanup(); H.reset()
    draw({ indicatorInstances: [RSI_INSTANCE] })
    expect(H.binderCreated, 'the control did not start the engine either — this case is vacuous')
      .toHaveLength(1)
  })
})

describe('StockChart × indicator engine — with something to draw', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  it('constructs exactly ONE binder and syncs it on every updateChart pass', () => {
    draw({ indicatorInstances: [RSI_INSTANCE] })
    // One binder for the life of the chart — not one per paint. A binder rebuilt
    // each pass would hold no previous bindings, so every series would be created
    // fresh and the pool would never pool.
    expect(H.binderCreated).toHaveLength(1)
    expect(H.syncCalls.length).toBeGreaterThan(0)
  })

  it('hands the binder a ctx that satisfies its stated requirements', () => {
    draw({ indicatorInstances: [RSI_INSTANCE] })
    // ⛔ NON-VACUITY FIRST. The loop below is a `for…of` over `H.syncCalls`, so an
    // empty array passes every clause in it. That is not hypothetical: this case
    // drove `{ engineEnabled: true }` with no instances until B5 Task 4, and the
    // moment `engineNeeded` stopped reading the flag it would have gone green over
    // zero syncs.
    expect(H.syncCalls.length, 'no sync happened — every clause below is vacuous')
      .toBeGreaterThan(0)
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

  it('makes ZERO series calls for an instance it does not own', () => {
    // The number of series the chart creates must be IDENTICAL to the render with
    // nothing engine-owned at all. Anything the engine adds while it has nothing
    // to draw is a pixel it had no right to paint.
    //
    // ⚠️ THE SUBJECT MOVED AT B5 TASK 4. This used to be "the flag on and no
    // instances" — the engine constructed a binder, synced it, and held nothing.
    // With the flag deleted that chart constructs no binder at all, so the claim
    // would have been about a binder that does not exist. The state that still
    // reaches a LIVE binder holding nothing is an instance of a definition the
    // engine is not the authority for.
    // ⚠️ SUBJECT MOVED AT B5 TASK 5 (ATR → `mfi`), AGAIN AT TASK 7 (`mfi` →
    // `adx`) — AND THEN RAN OUT AT TASK 8, which flipped the last three. It moves
    // DOWN A LEVEL rather than being deleted: the claim is that a LIVE binder
    // holding one thing adds exactly one thing, and the id it must ignore is now
    // `volumeProfile` — the one indicator key with no definition at all, carved
    // out structurally rather than by a set membership that keeps expiring.
    expect(registry.getDefinition('volumeProfile'),
      'volumeProfile gained a definition — this control needs re-reading').toBeNull()
    draw(undefined)
    const darkSeries = H.addSeriesCalls.length
    cleanup(); H.reset()

    draw({ indicatorInstances: [
      { instanceId: 'legacy:volumeProfile', defId: 'volumeProfile', inputs: {}, hidden: false },
      RSI_INSTANCE,
    ] })
    expect(H.syncCalls.length, 'no sync — the comparison below is not about the engine')
      .toBeGreaterThan(0)
    // RSI's one series, and NOTHING for the volumeProfile instance.
    expect(H.addSeriesCalls).toHaveLength(darkSeries + 1)
    expect(H.binderApis[0].bindings()).toHaveLength(1)
  })

  it('draws an engine instance — one more series than the same chart dark', () => {
    draw(undefined)
    const noInstances = H.addSeriesCalls.length
    cleanup(); H.reset()

    // ⚠️ `indicators.rsi.enabled` IS THE CROSSOVER STATE, not decoration. Under
    // Flip A the legacy toggle is still the switch (`StockChart.jsx`, the
    // `legacyEnabled` projection): it reserves the band `computePaneMargins`
    // hands the engine, and an instance whose toggle is off is treated as hidden
    // so Ctrl+I and the toolbar checkbox keep working. Every case in this file
    // that draws an engine instance therefore states the toggle.
    draw({ indicators: { rsi: { enabled: true } }, indicatorInstances: [RSI_INSTANCE] })
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
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  const RSI_ON = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
  const rsiSeries = () => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi')

  it('draws exactly one RSI series with the engine OFF (the shipped behaviour)', () => {
    draw(RSI_ON)
    expect(rsiSeries()).toHaveLength(1)
  })

  it('STILL draws exactly one when the engine owns it — and it is the ENGINE\'s', () => {
    draw({ ...RSI_ON, indicatorInstances: [RSI_INSTANCE] })

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

    draw({ ...both, indicatorInstances: [RSI_INSTANCE] })
    expect(rsiSeries()).toHaveLength(1)
    expect(H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'macd').length).toBe(legacyMacd)
  })

  it('a HIDDEN instance draws NOTHING — it does not hand the legacy block back', () => {
    // Ownership is authority, not paint: the engine skips a hidden instance, and
    // if hiding also released authority the user would hide RSI and watch the
    // legacy copy appear in its place.
    draw({ ...RSI_ON, indicatorInstances: [{ ...RSI_INSTANCE, hidden: true }] })
    expect(rsiSeries()).toHaveLength(0)
  })

  it('an instance the VALIDATOR drops never erases the indicator from the chart', () => {
    // `bogus` is not a declared RSI input, so `normalizeInstances` drops the whole
    // record. THE CLAIM IS UNCHANGED — a record nobody is going to draw must not
    // be what decides the indicator disappears — but at Flip B the thing that
    // saves it is the read-time migrator rather than the legacy block: the toggle
    // still says RSI is on, so a projected `legacy:rsi` draws it exactly once.
    draw({
      ...RSI_ON,
      indicatorInstances: [{ ...RSI_INSTANCE, inputs: { ...RSI_INSTANCE.inputs, bogus: 1 } }],
    })
    expect(rsiSeries(), 'RSI vanished, or was drawn twice').toHaveLength(1)
    const bound = H.binderApis[0].bindings()
    expect(bound).toHaveLength(1)
    expect(bound[0].key, 'the DROPPED instance is what drew it').toContain('legacy:rsi')
  })

  it('…and with the toggle OFF too, it draws nothing rather than a broken series', () => {
    // The other side of the same rule, and the one a projection cannot rescue:
    // nothing says this RSI should exist, so nothing draws it — but the failure
    // must be "absent", never "a series bound from an unvalidated record".
    draw({
      indicators: { rsi: { enabled: false } },
      indicatorInstances: [{ ...RSI_INSTANCE, inputs: { ...RSI_INSTANCE.inputs, bogus: 1 } }],
    })
    expect(bound(), 'the binder must have refused it').toHaveLength(0)
    expect(rsiSeries()).toHaveLength(0)
  })

  it('an instance of an UNKNOWN definition owns nothing, and drags nothing down with it', () => {
    // The binder cannot render it. Under Flip A the legacy block kept drawing;
    // after Flip B the projection does, and either way the observable rule is
    // that an unknown definition is INERT — one RSI on the chart, not zero.
    draw({ ...RSI_ON, indicatorInstances: [{ ...RSI_INSTANCE, defId: 'not-an-indicator' }] })
    expect(rsiSeries()).toHaveLength(1)
    expect(H.binderApis[0].bindings().map(b => b.key).join(','))
      .not.toContain('not-an-indicator')
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
// FAILED if B3 forgot one. `ENGINE_OWNED` pairs the two, and this is
// the test that makes forgetting fail.
//
// ⚠️ ITS MECHANISM CHANGED UNDER IT AT TASK 11, AND THE CLAIM DID NOT — audited
// deliberately rather than left reading as history. All four migrated
// definitions are FLIPPED, so there is no legacy block on either side of the
// comparison any more: the first draw is the engine through the read-time
// PROJECTION (a flipped id runs the engine whatever the flag says) and the
// second is the engine through a STORED instance. The counts must still match,
// and a projection that did not stand down for a stored instance is the same
// double-draw wearing new clothes — the §6.1 defect, which is what mutation M10
// kills here. The rail keeps its name, its loop and its non-vacuity gate; only
// the sentence describing which two renderers it is separating has moved.

describe('a migrated definition is drawn ONCE — never by the engine and legacy both', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  const instanceOf = (defId) => ({ instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false })

  /**
   * ⛔ THE SERVER LANE IS EXCLUDED FROM THE LEGACY-TOGGLE RAILS, BY NAME.
   *
   * Every case in this block measures *"the legacy block and the engine do not
   * BOTH draw"*, which presupposes a legacy block. `rsLine` (Phase C Task 13)
   * never had one, and its columns are FETCHED — in jsdom, with no lane
   * response, `computeFor` returns `{}` and the binder correctly binds nothing.
   * Asserting `> 0` there would demand a network round trip from a render test.
   *
   * ⛔ DERIVED FROM `compute.kind`, NOT HAND-LISTED, and then CHECKED: the
   * exclusion must be exactly the server lane and never empty, so a native
   * quietly re-declared `server` to dodge a failing rail is itself a failure.
   */
  const SERVER_LANE = registry.listDefinitions()
    .filter(d => d.compute.kind === 'server').map(d => d.id)
  const NATIVE_OWNED = [...ENGINE_OWNED].filter(id => !SERVER_LANE.includes(id))

  it('the server lane is excluded from these rails, and it is exactly rsLine', () => {
    expect(SERVER_LANE).toEqual(['rsLine'])
    expect(NATIVE_OWNED.length).toBe(ENGINE_OWNED.size - 1)
  })

  it('names at least one definition — otherwise every case below is vacuous', () => {
    expect(ENGINE_OWNED.size).toBeGreaterThan(0)
  })

  it.each(NATIVE_OWNED)(
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

      draw({ ...legacyOn, indicatorInstances: [instanceOf(defId)] }, tf)
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
    for (const defId of ENGINE_OWNED) {
      const tfs = registry.getDefinition(defId)?.meta?.timeframes
      if (Array.isArray(tfs) && tfs.length) expect(tfs, defId).toContain(tfFor(defId))
      else expect(tfFor(defId), defId).toBe('D')
    }
    // …and at least one of them is genuinely gated, or `tfFor` is dead code
    // dressed as a rule. VWAP is that one from Task 8 onward.
    const gated = [...ENGINE_OWNED].filter(id => registry.getDefinition(id)?.meta?.timeframes)
    expect(gated, 'no migrated definition declares meta.timeframes — tfFor is inert').not.toHaveLength(0)
  })

  it('an indicator the engine is NOT the authority for is refused rather than double-drawn', () => {
    // ⚠️ THE POPULATION THIS CASE WAS WRITTEN OVER IS GONE (B5 Task 8): every
    // definition is migrated, so `notMigrated[0]` was `undefined` and the loop
    // asserted about nothing. The claim survives on the one indicator key that
    // is refused STRUCTURALLY rather than by a set that keeps shrinking —
    // `volumeProfile`, which has no definition, is not series-expressible (a
    // horizontal histogram on its own canvas) and is carved out by name.
    const defId = 'volumeProfile'
    expect(registry.getDefinition(defId), 'volumeProfile gained a definition').toBeNull()
    expect(registry.CARVED_OUT_INDICATOR_KEYS.has(defId)).toBe(true)

    const legacyOn = { indicators: { [defId]: { enabled: true } } }
    draw(legacyOn)
    const legacyOnly = H.addSeriesCalls.length
    cleanup(); H.reset()

    draw({ ...legacyOn, indicatorInstances: [instanceOf(defId)] })
    // The binder never sees it, so it cannot draw a second copy …
    expect(bound()).toHaveLength(0)
    // … and its own rendering is untouched, so the indicator is still on the chart.
    expect(H.addSeriesCalls.length).toBe(legacyOnly)
    // ⛔ AND THE CONTROL THAT `instanceOf` REALLY DOES PRODUCE SOMETHING THE
    // ENGINE WOULD OTHERWISE BIND: the same helper on a migrated id binds.
    cleanup(); H.reset()
    draw({ indicators: { rsi: { enabled: true } }, indicatorInstances: [instanceOf('rsi')] })
    expect(bound().length, 'instanceOf produces an instance nothing ever binds — vacuous')
      .toBeGreaterThan(0)
  })
})

// ─── I-3: series creation ORDER, which LWC turns into z-order ───────────────

describe('an engine series is inserted where its legacy twin would have been', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

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

  it('and BEFORE the whole rest of the chart, not just the first block', () => {
    // 🔴 THE PREMISE THIS CASE WAS BUILT ON EXPIRED AT B5 TASK 8, AND IT WAS
    // GREEN WHILE FALSE FIRST. It used `['macd', 'obv']` as "other LEGACY
    // indicator blocks" — `macd` was flipped at B3 Task 11 and `obv` at Task 8,
    // so BOTH landmarks are now drawn by the ENGINE, at the same call site as the
    // RSI it is being compared to. It kept passing because the engine binds in
    // INSTANCE-LIST order and the explicit `RSI_INSTANCE` leads that list — i.e.
    // for a reason that has nothing to do with the claim.
    //
    // ⛔ THE CLAIM THAT SURVIVES, AND IT IS STRONGER THAN THE ONE IT REPLACES:
    // the engine's series are a CONTIGUOUS SUFFIX of everything the chart draws.
    // Contiguous, because the engine draws its whole set at ONE call site and
    // registry order is therefore the only thing controlling z-order WITHIN it —
    // a call site that split in two would let a hand-written series land in the
    // middle of the indicator stack. A SUFFIX, because with no legacy indicator
    // block left the engine is the last thing to draw, so every candle, every
    // volume bar and every MA overlay is underneath every indicator, which is the
    // shipped picture. A new hand-written series added after the sync call fails
    // this by name; the old form could not have seen one.
    draw({
      indicatorInstances: [RSI_INSTANCE],
      indicators: { rsi: { enabled: true }, bb: { enabled: true } },
    })
    const engineSeries = new Set(bound().map(b => b.series))
    expect(engineSeries.size, 'the engine bound nothing — this case is vacuous').toBe(4)
    const engineIdxs = H.addSeriesCalls
      .map((c, i) => (engineSeries.has(c.series) ? i : -1)).filter(i => i >= 0)
    expect(engineIdxs, 'the engine bound a series the chart never created').toHaveLength(4)
    expect(engineIdxs.at(-1) - engineIdxs[0], 'the engine\'s series are no longer contiguous — '
      + 'something hand-written is being drawn in the middle of the indicator stack')
      .toBe(engineIdxs.length - 1)
    expect(engineIdxs.at(-1), 'a series is created AFTER the engine\'s block — it will paint '
      + 'OVER every indicator, which is the z-order inversion this rail exists for')
      .toBe(H.addSeriesCalls.length - 1)
    // …and the prefix really is non-empty, so "suffix" is not "the whole list".
    expect(engineIdxs[0], 'the engine drew first — there is no candle or volume series before it')
      .toBeGreaterThan(0)
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
    // It is BENIGN FOR THIS FIXTURE, verified against the installed
    // lightweight-charts 5.2.0: `chart.addSeries` also appends, so a mid-session
    // engine create and a mid-session legacy create land in the same place, and —
    // the reason this test passes — NEITHER OF THE TWO INSTANCES BELOW crosses
    // panes. `rsi` is a pane indicator and `bb` is a price overlay; neither moves
    // once bound.
    //
    // 🔴 THE PARAGRAPH THAT USED TO STAND HERE SAID *"the two migrated definitions
    // never cross panes"* AND NAMED THE DAY IT WOULD EXPIRE AS
    // *"`vwap`/`sar`/`ichimoku`/`donchian`"*. **B5 Task 5 falsified both halves
    // without this test going red**, which is precisely the rot shape it exists to
    // catch, in itself. `stoch` and `atr` are migrated now and BOTH are eligible
    // for the volume-pane overlay path (`ensureIndTarget`'s `volSeparatePane &&
    // volOverlaySet.has(key)` branch), so a relocation is REACHABLE today — and
    // MEASURED: *"the VOLUME-OVERLAY path, mid-session — and the FIRST relocation
    // on this branch"* drives `volumeOverlayIndicators` off mid-session and
    // asserts `H.moveToPaneCalls` is NON-empty and no series was recreated.
    //
    // So the claim this case makes has NARROWED, honestly, and is stated as such:
    // **this fixture** relocates nothing, which is what keeps the two z-order
    // rails above readable. It goes RED the day one of THESE instances moves —
    // and when it does: do not delete it. Write the ordering assertion it is
    // standing in for, over `H.moveToPaneCalls`.
    //
    // ⚠️ B5 TASK 7 GREW THE SET OF DEFINITIONS THAT *CAN* RELOCATE, and this note
    // is the honest bookkeeping rather than a change of claim: `mfi`, `cci` and
    // `williamsR` are pane oscillators too, so five migrated definitions are now
    // eligible for the volume-overlay branch where Task 5 left two. The fixture
    // below still holds `rsi` (pane, never listed) and `bb` (price overlay,
    // ineligible), so it still relocates nothing — but the reason it does is a
    // property of THIS FIXTURE and not of the flip set, and the gap between
    // those two is exactly what the paragraph above says went unnoticed once.
    draw({
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
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  const engineSeriesOf = () => H.addSeriesCalls
    .filter(c => c.options && c.options.priceScaleId === 'rsi')
    .map(c => c.series)

  it('hides and re-shows an engine-bound series with the toggle', () => {
    draw({ indicators: { rsi: { enabled: true } }, indicatorInstances: [RSI_INSTANCE] })
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
    const settings = { indicators: { rsi: { enabled: true } }, indicatorInstances: [RSI_INSTANCE] }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings)} />)
    expect(H.syncCalls.at(-1).indicatorsHidden).toBe(false)

    act(() => { fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' }) })

    // Force another `updateChart` pass the way a data poll would: new bars.
    const before = H.syncCalls.length
    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS.slice(0, BARS.length - 1)} settingsOverride={legendAlways(settings)} />,
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
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

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
    const view = draw({ ...RSI_ON, indicatorInstances: [RSI_INSTANCE] })
    // The legacy ref is null here by construction — the block stood down.
    expect(H.binderApis[0].bindings(), 'the engine bound nothing — vacuous').toHaveLength(1)
    expect(await hoverLatest(view)).toContain('RSI(14) 54.3')
  })

  it('and it follows the INSTANCE period, not the settings blob', async () => {
    const view = draw({
      ...RSI_ON,
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
      indicatorInstances: [{ ...RSI_INSTANCE, inputs: { period: 14, color: '#ff0000' } }],
    })
    expect(await hoverLatest(view)).toContain('RSI(14) 54.3')
    expect(rsiChipColor(view)).toBe('rgb(255, 0, 0)')
  })

  it('a HIDDEN instance binds nothing, and its chip prints the LABEL with no value', async () => {
    // 🔴 THE SECOND HALF WAS `not.toContain('RSI(')` AND IT IS INVERTED
    // (chart-UX-walls Task 3). It was the twin of the assertion in
    // `legendFromDefinitions.test.jsx`, and it said the same wrong thing: a
    // hidden instance had no chip, so there was no surface an un-hide could be
    // reached from and Hide was a one-way door out of the settings modal. Spec
    // §6 state 7 calls Hidden a CHIP STATE. `readout.legendChips` walks the
    // INSTANCE list now, so a hidden instance keeps a dimmed, value-less chip.
    //
    // ⚠️ WHAT EACH HALF PROVES (review M-4 corrected a report claim here). The
    // FIRST assertion is unchanged and is the gate on `legend.hide`-adjacent
    // behaviour: a hidden instance binds NOTHING — the renderer's contract did
    // not move, only the readout's. The SECOND now proves BOTH directions at
    // once, which the old absence could not: the chip is there (the un-hide
    // surface exists) AND it carries no number (nothing stepped in with a value
    // for a line that is not drawn — a legacy block doing so would print
    // `RSI(14) 54.3`). `legend.hide` itself is still gated in `readout.test.js`
    // (`emits NO chip for a price overlay`), on the pure function, where a
    // mutation actually reaches it.
    const view = draw({
      ...RSI_ON, indicatorInstances: [{ ...RSI_INSTANCE, hidden: true }],
    })
    expect(H.binderApis[0].bindings(), 'a hidden instance must bind nothing').toHaveLength(0)
    const text = await hoverLatest(view)
    expect(text, 'the hidden instance lost its chip — Hide is a one-way door again')
      .toContain('RSI(14)')
    expect(text, 'a hidden chip printed a value for a line that is not drawn')
      .not.toMatch(/RSI\(14\)\s*-?\d/)
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
    const view = draw({ ...RSI_ON, indicatorInstances: [RSI_INSTANCE] })
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
    const engineView = draw({ ...RSI_ON, indicatorInstances: [RSI_INSTANCE] })
    expect(H.binderApis[0].bindings(), 'the engine bound nothing — vacuous').toHaveLength(1)
    expect(await hoverDevelopingBar(engineView)).toContain(legacyChip[0])
  })

  it('⭐ a NON-migrated definition emits no chip at all — and that is not a loss', async () => {
    // 🔴 THIS CONTROL RAN OUT OF SUBJECTS AT B5 TASK 6, AND IT MOVED DOWN A LEVEL
    // RATHER THAN BEING DELETED — exactly as B3 Task 8 did for `engineInert`.
    //
    // It read *"leaves a NON-migrated indicator chip exactly as the legacy block
    // wrote it"* and its subject moved twice: MACD until B3 Task 6, ATR until B5
    // Task 5, SAR until now. The claim needed a definition the engine does NOT
    // draw whose chip still came from `cs.indicators.<id>` through the LEGACY
    // lane. Task 6 flipped `sar` and `ichimoku`, retiring the last three
    // registrations, so the legacy lane has no producer and there is no such
    // definition left — not because coverage was lost, but because the six
    // chip-bearing definitions are exactly the six that are migrated.
    //
    // ⛔ SO THE CLAIM IS RESTATED AT THE FLIP-SET FILTER, WHERE IT IS STILL
    // FALSIFIABLE: every definition that DECLARES a `legend` block is migrated,
    // and every definition that is not migrated declares NONE. Break either half
    // and a user loses a chip the day their indicator is drawn by the surviving
    // hand-written block — which is what the deleted registrar used to prevent.
    // ⭐ AND AT B5 TASK 8 THE SECOND HALF BECAME A TOTALITY CLAIM — see below.
    const declaresChip = (d) => (d.plots || []).some(
      p => p.style !== 'hlines' && p.legend && p.legend.hide !== true)
    const chipBearing = registry.listDefinitions().filter(declaresChip).map(d => d.id)
    const unmigrated = registry.listDefinitions()
      .filter(d => !ENGINE_OWNED.has(d.id)).map(d => d.id)
    // ⭐ SEVEN AT PHASE C TASK 13. `rsLine` takes its OWN PANE, and a pane whose
    // crosshair prints nothing is a value you cannot read — see the trade recorded
    // in `readout.test.js`. It is `ENGINE_OWNED` like every other definition, so
    // the loop below covers it unchanged.
    // ⭐⭐ AND SEVENTEEN AT TASK 2 (`43efeff6`) — the same reading applied to the
    // other TEN. `bb`, `vwap`, `mfi`, `cci`, `williamsR`, `adx`, `obv`,
    // `donchian`, `avwap` and `atrBands` declared no chip at all, which is a line
    // a user cannot put a name to. The literal is WIDENED and stays an equality:
    // a chip-bearing definition that stops being one still fails here.
    expect(chipBearing.sort(), 'the set of chip-bearing definitions moved')
      .toEqual(['adx', 'atr', 'atrBands', 'avwap', 'bb', 'cci', 'donchian', 'ichimoku',
        'macd', 'mfi', 'obv', 'rsLine', 'rsi', 'sar', 'stoch', 'vwap', 'williamsR'])
    // ⛔ …AND THAT SET IS NOW TOTAL, WHICH IS THE CLAIM TASK 2 ACTUALLY MAKES.
    // Derived, so a definition landing WITHOUT a chip fails by construction
    // rather than by somebody remembering to widen the literal above.
    expect(chipBearing.sort(), 'a definition binds plots and declares NO chip — that is a '
      + 'line the user cannot put a name to, on any surface, hovering or not')
      .toEqual(registry.listDefinitions().map(d => d.id).sort())
    for (const id of chipBearing) {
      expect(ENGINE_OWNED.has(id),
        `${id} declares a chip and is NOT migrated — with the legacy chip lane deleted, ` +
        'nothing produces that chip and the legend loses it silently').toBe(true)
    }
    // ⭐⭐ AND THE OTHER DIRECTION MOVED DOWN A LEVEL AT B5 TASK 8, EXACTLY AS THE
    // NOTE THAT STOOD HERE SAID IT WOULD HAVE TO. It read *"over a NON-EMPTY set
    // (THREE definitions are still un-migrated at Task 7 — `adx`, `obv`,
    // `donchian`)"* and asserted that each of them declares no `legend` block.
    // Task 8 migrated all three, so that loop iterates zero times.
    //
    // What replaces it is the TOTALITY the loop was standing in for: the flip set
    // COVERS every chip-bearing definition because it covers every definition
    // there is. Stated as an equality rather than as a subset, so a chip-bearing
    // definition arriving un-migrated — the thing whose chip would have no
    // producer — fails it by name in either direction.
    expect(unmigrated, 'an un-migrated definition exists again — restore the per-id loop, '
      + 'because a chip-bearing one among them loses its chip silently').toEqual([])
    expect([...ENGINE_OWNED].sort(),
      'the migrated set is no longer TOTAL, so "every chip-bearing definition is migrated" '
      + 'has stopped being implied and needs its own loop again')
      .toEqual(registry.listDefinitions().map(d => d.id).sort())
    // …and the coverage claim is not the trivial one that both sides are empty.
    // 🔴 THIS ASSERTED A *PROPER* SUBSET (`chipBearing.length <
    // ENGINE_OWNED.size`), which is a fact about the DEFECT rather than about the
    // coverage: the strictness came from ten definitions having no chip. Task 2
    // (`43efeff6`) closed that gap, so the two sets are now the SAME set — which
    // is a stronger statement than the subset was, and is asserted as one.
    // Non-vacuity is carried by the `> 0`, which is what the `<` was standing in
    // for and is the half that can still fail.
    expect(chipBearing.length).toBeGreaterThan(0)
    expect(chipBearing.length,
      'a definition is engine-owned and declares no chip — the two sets separated again')
      .toBe(ENGINE_OWNED.size)

    // …and the behavioural half, on a real chart. ⚠️ ITS SUBJECT HAS MOVED FOUR
    // TIMES — `mfi` at Task 5, `obv` at Task 7, `obv` again at Task 8 — and Task
    // 2 (`43efeff6`) took the whole CATEGORY: every definition that binds a data
    // plot now declares a chip, so there is no chip-less DEFINITION left to hover.
    //
    // ⛔ SO IT MOVES DOWN A LEVEL AGAIN, EXACTLY AS B5 TASK 6 DID WHEN IT RAN OUT
    // OF SUBJECTS, AND THE CLAIM IS UNCHANGED: a plot that declares no `legend`
    // block contributes NO chip. `adx` carries both halves in ONE instance — its
    // `adx` line declares a chip and its two DIRECTIONAL lines deliberately
    // declare none, because three numbers for one indicator is the readout
    // regression the band edges are hidden for. That makes the absence
    // non-vacuous by construction: an engine that had simply stopped emitting
    // fails the presence assertion on the line above the two absences.
    expect(ENGINE_OWNED.has('adx'), 'adx is not engine-drawn — this half is about '
      + 'the ENGINE lane emitting no chip for a PLOT that declares none').toBe(true)
    const view = draw({
      ...RSI_ON,
      indicatorInstances: [RSI_INSTANCE, {
        instanceId: 'legacy:adx', defId: 'adx',
        inputs: { period: 14, adxColor: '#e5e7eb', plusDIColor: '#22c55e', minusDIColor: '#ef4444' },
        placement: { target: 'pane' }, hidden: false,
      }],
      indicators: {
        ...RSI_ON.indicators,
        adx: { enabled: true, period: 14, adxColor: '#e5e7eb', plusDIColor: '#22c55e', minusDIColor: '#ef4444' },
      },
    })
    const adxBound = H.binderApis[0].bindings().filter(b => b.defId === 'adx')
    expect(adxBound, 'no ADX lines at all — vacuous').toHaveLength(3)
    const adxPlot = (key) => adxBound.find(b => b.plotKey === key)
    const text = await hover(view, [
      [adxPlot('adx').series, { value: 27.5 }],
      [adxPlot('plusDI').series, { value: 33.25 }],
      [adxPlot('minusDI').series, { value: 12.75 }],
    ])
    expect(text, 'the engine lane is not drawing — the RSI control chip is missing')
      .toContain('RSI(14)')
    expect(text, 'the ADX line lost the chip Task 2 gave it — the two absences below '
      + 'would then hold for the wrong reason').toContain('ADX(14) 27.5')
    for (const [key, printed] of [['plusDI', '33.2'], ['minusDI', '12.7']]) {
      expect(adxPlot(key), `${key} is not bound — its absence is vacuous`).toBeTruthy()
      expect(text, `${key} declares no legend block and produced a chip anyway`)
        .not.toContain(printed)
    }
  })

  it('⭐ BOTH MACD chips survive the deletion of macdLineRef AND macdSignalRef', async () => {
    // ⛔ THE READOUT REGRESSION NO PIXEL GATE CAN SEE, AND MACD IS THE ONE
    // DEFINITION THAT CAN LOSE TWO CHIPS AT ONCE. `processCrosshair` read
    // `macdLineRef.current` and `macdSignalRef.current` for two SEPARATE slots
    // (`macd` and `macdSig` in `LEGACY_SLOTS`). Task 11 deleted both refs, so a
    // bridge that missed either one takes that chip silently out of the legend —
    // and a headless capture has no cursor, so no legend is drawn on either side
    // and the parity diff is 0 whichever way it behaves.
    //
    // ⚠️ THE TWO VALUES ARE DIFFERENT, AND THAT IS THE ASSERTION. Task 2's fix
    // round split the rescue so `signal`'s value comes from `engSlots.macdSig`
    // rather than being decided by whether `macd` had one; a mutation that
    // re-coupled them would still print two chips, both carrying the LINE's
    // number, and equal values would pass that. `0.12345` → `MACD 0.1235` and
    // `0.09876` → `SIG 0.0988` cannot both come from one source.
    //
    // ⚠️ AND THE BRIEF'S VERSION OF THIS CASE IS NOT REACHABLE. It asked for
    // "engine-`macd` + legacy-`signal` must still print SIG". There is no legacy
    // MACD lane after this flip — the engine draws all three plots or none — so
    // the state it names cannot be constructed at all. What IS reachable, and is
    // what the re-coupling breaks, is two engine plots carrying two values.
    expect(ENGINE_OWNED.has('macd')).toBe(true)
    const view = draw({
      ...RSI_ON,
      indicators: { ...RSI_ON.indicators, macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
    })
    const macd = H.binderApis[0].bindings().filter(b => b.defId === 'macd')
    expect(macd, 'the engine bound no MACD — vacuous').toHaveLength(3)
    const line = macd.find(b => b.plotKey === 'macd')
    const signal = macd.find(b => b.plotKey === 'signal')
    const text = await hover(view, [
      [line.series, { value: 0.12345 }],
      [signal.series, { value: 0.09876 }],
    ])
    expect(text, 'the MACD chip vanished with macdLineRef').toContain('MACD 0.1235')
    expect(text, 'the SIG chip vanished with macdSignalRef').toContain('SIG 0.0988')
  })

  it('⭐ the two MACD columns are non-empty TOGETHER — what the per-plot split rests on', () => {
    // ⛔ THE EQUIVALENT-MUTANT PROOF, MADE FALSIFIABLE.
    //
    // Task 2's review (M-6) split the crosshair rescue so `signal`'s value comes
    // from its OWN slot instead of being decided by `macd`'s. A mutation that
    // re-couples them (`engSlots.macd ? engSlots.macdSig.value : null`) SURVIVES
    // the whole suite, and it survives for a reason worth pinning rather than
    // apologising for: the state that separates the two forms — the macd column
    // carrying a value while the signal column carries NONE — cannot be produced.
    //
    // TWO facts make that true, and this case owns the first:
    //   1. `computeMACD` returns both columns EMPTY below ~35 bars and both
    //      NON-EMPTY above it. There is no bar count in between. MEASURED here
    //      over 20..60 bars and four signal periods, not asserted.
    //   2. `engineChips` falls back to the binding's `lastValue`, so a chip is
    //      emitted whenever its column has ANY finite value — which bar the
    //      cursor is on cannot separate them either.
    //
    // If (1) ever stops holding, the re-coupling becomes a REAL defect (a
    // TypeError on hover, not a wrong number) and this case is what says so.
    const mk = (n) => Array.from({ length: n }, (_, i) => (
      { t: 1700000000 + i * 86400, o: 1, h: 2, l: 0.5, c: 10 + Math.sin(i) }))
    const finite = (a) => a.filter(p => Number.isFinite(p.value)).length
    const separated = []
    let sawBoth = 0
    for (let n = 20; n <= 60; n++) {
      const r = computeMACD(mk(n), 12, 26, 9)
      const fm = finite(r.macd)
      const fs = finite(r.signal)
      if (fm > 0 && fs === 0) separated.push(n)
      if (fm > 0 && fs > 0) sawBoth += 1
    }
    expect(separated,
      'computeMACD can now produce a MACD line with no signal at all — the crosshair '
      + 'per-plot split is REACHABLE, and a mutation re-coupling it is a live defect that '
      + 'throws on hover. Add a legend case for that state.').toEqual([])
    expect(sawBoth, 'the loop never reached a bar count that computes anything — vacuous')
      .toBeGreaterThan(0)
    // …and the same holds when the signal period is stretched, which is the only
    // input that could plausibly outrun the line.
    for (const sp of [2, 5, 20, 50]) {
      const r = computeMACD(mk(200), 12, 26, sp)
      expect(finite(r.macd), `signalPeriod ${sp}: no MACD line`).toBeGreaterThan(0)
      expect(finite(r.signal), `signalPeriod ${sp}: a MACD line with NO signal`).toBeGreaterThan(0)
    }
  })
})

// ─── the rest of what pixels cannot see ─────────────────────────────────────
//
// The pixel gate proves ONE picture, captured with no cursor, no keyboard and no
// settings write. Everything a user does to a migrated indicator afterwards is
// outside it. These are the paths that name RSI.

describe('Alt+Shift+I still reaches an engine-drawn RSI in the CROSSOVER state', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  // The existing hide-all suite draws the engine with `cs.indicators.rsi` absent.
  // Flip A's real state is the crossover: the legacy toggle stays ON (it is what
  // `computePaneMargins` reads to reserve the band) while the engine owns the
  // drawing. That is the configuration the toggle has to work in.
  const RSI_ON = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }

  it('hides and re-shows the engine series while the legacy toggle is on', () => {
    draw({ ...RSI_ON, indicatorInstances: [RSI_INSTANCE] })
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
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  const RSI_ON = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
  const rsiSeries = () => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi')
  const settings = (over) => ({ ...RSI_ON, indicatorInstances: [RSI_INSTANCE], ...over })

  it('a COLOUR change re-styles the SAME series — never destroys and recreates it', () => {
    // lightweight-charts#2049 is open: a mass removeSeries is a 2-4s main-thread
    // block. The pool exists so a restyle is an applyOptions, and the only way to
    // see that from here is that no SECOND series was ever created.
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings())} />)
    expect(rsiSeries()).toHaveLength(1)
    const before = rsiSeries()[0].series

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings({
        indicatorInstances: [{ ...RSI_INSTANCE, inputs: { period: 14, color: '#ff0000' } }],
      }))} />,
    )
    expect(rsiSeries(), 'the engine created a second RSI line instead of restyling').toHaveLength(1)
    expect(H.binderApis[0].bindings()[0].series, 'the binding changed series').toBe(before)
  })

  it('a PERIOD change keeps one series and re-binds it', () => {
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings())} />)
    const before = rsiSeries()[0].series

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings({
        indicatorInstances: [{ ...RSI_INSTANCE, inputs: { period: 7, color: '#7b68ee' } }],
      }))} />,
    )
    expect(rsiSeries()).toHaveLength(1)
    expect(H.binderApis[0].bindings()[0].series).toBe(before)
  })

  it('the CONTROL turns it OFF and back ON, and never leaves TWO RSI lines', () => {
    // ⭐ FLIP-B SEMANTICS, AND THE SUBSTANTIVE CHANGE FROM WHAT THIS CASE USED TO
    // ASSERT. It moved `cs.indicators.rsi.enabled` by hand, because under Flip A
    // that field was the switch. It is now the MIRROR: with a stored instance
    // present, writing it by hand changes nothing a user sees, and a case that
    // still did so would be measuring the wrong field with a green tick.
    //
    // So it goes through `setIndicatorEnabled`, which is what every control
    // surface calls — Ctrl+I, the checkbox, both right-click items. What must
    // hold in every combination is unchanged: the user never ends up looking at
    // two RSI lines or at an orphan.
    const base = settings()
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(base)} />)
    expect(rsiSeries()).toHaveLength(1)
    const first = rsiSeries()[0].series

    const off = setIndicatorEnabled(base, 'rsi', false, registry)
    expect(off.indicators.rsi.enabled, 'the mirror was not written').toBe(false)
    // `rsiSeries()` counts addSeries CALLS and never shrinks, so "the line went
    // away" has to be read off the REMOVAL and off what the binder still holds.
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(H.binderApis[0].bindings(), 'turned off: the engine still holds a series').toHaveLength(0)
    expect(H.removedSeries, 'the engine\'s RSI line is still on the chart').toContain(first)
    expect(rsiSeries(), 'and nothing drew a replacement').toHaveLength(1)

    const backOn = setIndicatorEnabled(off, 'rsi', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(backOn)} />)
    expect(H.binderApis[0].bindings(), 'turned back on: the engine draws it again').toHaveLength(1)
    expect(rsiSeries(), 'turned back on: exactly one more, and nothing else drew its own').toHaveLength(2)
  })

  it('⭐ a bare legacy-toggle write can no longer switch a STORED instance off', () => {
    // The corollary, asserted rather than left implicit — it is the whole meaning
    // of "instances are the authority", and it is the behaviour change most
    // likely to surprise a reader of the case above. An un-migrated surface that
    // writes `cs.indicators.rsi.enabled = false` (the screener, an old tab) can
    // no longer delete a stored instance; it can only ever fail to project one.
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings())} />)
    expect(H.binderApis[0].bindings()).toHaveLength(1)
    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways(settings({ indicators: { rsi: { enabled: false } } }))} />,
    )
    expect(H.binderApis[0].bindings(),
      'the mirror overrode the instance — the authority is the wrong way round').toHaveLength(1)
  })

  it('⭐ a STORED instance arriving MID-SESSION takes over from the PROJECTED one', () => {
    // ⛔ THE MID-SESSION CROSSOVER, RESHAPED BY FLIP B — the most-repeated defect
    // class on this branch, and the seam moved.
    //
    // Under Flip A the crossover was legacy-block → engine, and the `else if` that
    // removed the legacy series was the thing that could go unreachable. There is
    // no legacy block now, so the equivalent seam is PROJECTED → STORED: the chart
    // is up drawing RSI from an instance the read-time migrator invented out of
    // `indicators.rsi.enabled`, and then a real one arrives — a settings sync from
    // another widget, a grid cell's `settingsOverride`, a share link.
    //
    // The failure it guards is the same one: two RSI lines on one scale, one of
    // them dead, and a picture that still looks plausible.
    const projectedOnly = { ...RSI_ON, indicatorInstances: [] }
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(projectedOnly)} />,
    )
    const projected = H.binderApis[0].bindings()
    expect(projected, 'the migrator drew nothing — this case is vacuous').toHaveLength(1)
    expect(projected[0].key, 'the projection did not build `legacy:rsi`').toContain('legacy:rsi')
    expect(rsiSeries(), 'more than one RSI before the crossover even started').toHaveLength(1)
    const firstSeries = projected[0].series

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...projectedOnly, indicatorInstances: [RSI_INSTANCE] })} />,
    )

    const bound = H.binderApis[0].bindings()
    expect(bound, 'the stored instance did not take over — or BOTH are drawn').toHaveLength(1)
    expect(bound[0].key, 'the projection is still the one drawing').toContain('engine-test:rsi')
    // ⚠️ #2049: the pool RE-USES the series rather than destroying and recreating
    // it. Same series object, new binding key.
    expect(bound[0].series, 'the series was destroyed and recreated across the crossover')
      .toBe(firstSeries)
    expect(H.removedSeries, 'a series was removed on a hand-over the pool should absorb')
      .not.toContain(firstSeries)
  })

  it('…and the reverse — the STORED instance leaving hands it back to the projection', () => {
    // The same seam from the other side, with the legacy toggle still on. If the
    // projection did not take back over, removing an instance would delete an
    // indicator the settings still say is enabled.
    const withStored = { ...RSI_ON, indicatorInstances: [RSI_INSTANCE] }
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(withStored)} />,
    )
    const before = H.binderApis[0].bindings()
    expect(before).toHaveLength(1)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...withStored, indicatorInstances: [] })} />,
    )
    const after = H.binderApis[0].bindings()
    expect(after, 'the RSI vanished when the stored instance was removed').toHaveLength(1)
    expect(after[0].key, 'nothing projected it back').toContain('legacy:rsi')
    expect(after[0].series, 'the pool destroyed and recreated it').toBe(before[0].series)
  })

  it('⭐ RSI ARRIVING and DEPARTING mid-session: nothing → a line and a band → nothing', () => {
    // The direction no Flip-A case could express, and the one a user actually
    // performs: the indicator is OFF, they turn it on, they turn it off again.
    // Both halves are asserted on the BAND as well as on the series, because a
    // band left reserved for a departed indicator is a permanently short price
    // pane and a band never reserved is the RSI-over-volume defect.
    // ⚠️ `bandNow` REFUSES TO ANSWER WITHOUT A SYNC, and that is load-bearing at
    // B5 Task 4: with the flag deleted a chart holding nothing constructs no
    // binder, so a lenient read would answer `undefined` for "no band reserved"
    // AND for "no engine ran" — the first and last phases below would then pass
    // over an absent engine. BB_CONTROL keeps one live engine instance on the
    // chart for the whole sequence; it is a PRICE overlay, so it reserves no band
    // of its own and RSI's stays exactly `{top: 0.85, bottom: 0}`.
    const bandNow = () => {
      const ctx = H.syncCalls.at(-1)
      expect(ctx, 'no sync happened — the band assertion below would be vacuous').toBeTruthy()
      return ctx.paneMargins.rsi
    }
    const off = {
      indicators: { ...BB_CONTROL, rsi: { enabled: false, period: 14, color: '#7b68ee' } },
      indicatorInstances: [],
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    // BB declares THREE plots (upper / middle / lower), so the control is three
    // bindings and RSI's are found by key rather than by count.
    expect(bound(), 'the control instance did not draw — every phase below is vacuous')
      .toHaveLength(3)
    expect(bandNow(), 'a band was reserved for an RSI nobody asked for').toBeUndefined()

    const on = setIndicatorEnabled(off, 'rsi', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(on)} />)
    const withRsi = bound().filter(b => b.key.includes('rsi'))
    expect(withRsi, 'arriving mid-session drew nothing').toHaveLength(1)
    expect(bandNow(), 'arriving mid-session reserved no band').toEqual({ top: 0.85, bottom: 0 })

    const offAgain = setIndicatorEnabled(on, 'rsi', false, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(offAgain)} />)
    expect(bound().filter(b => b.key.includes('rsi')),
      'departing mid-session left the line behind').toHaveLength(0)
    expect(H.removedSeries).toContain(withRsi[0].series)
    expect(bandNow(), 'departing mid-session left its band reserved').toBeUndefined()
  })
})

// ─── THE RESERVED BAND, AFTER THE AUTHORITY FLIPPED ────────────────────────
//
// ⭐ THIS SUITE WAS TASK 10's TRIPWIRE, AND IT FIRED. Under Flip A
// `computePaneMargins` reserved RSI's band from `cs.indicators.rsi.enabled`
// (`paneMargins.js:47`), so with the toggle off the layout reserved NOTHING and
// `resolvePlacement` fell through to `{top:0.82, bottom:0}` (`placement.js:103`),
// which overlaps volume's `{top:0.85, bottom:0}` — an RSI drawn ON TOP OF the
// volume bars, one keystroke away from four different controls.
//
// Flip B moved the authority the other way — a projection rewrote that field from
// the INSTANCE list — and B5 Task 12 removed the indirection entirely:
// `computePaneLayout` reads the instances and IS the band arithmetic, so the band
// follows the instance and the toggle-OFF-with-an-instance state stopped existing.
// Three cases below went red on the flip — which is what the tripwire was for —
// and are rewritten to the new rule rather than relaxed:
//
//   · "the toggle OFF: no band is reserved" → an INSTANCE reserves the band and
//     the engine draws into it, whatever the toggle says;
//   · "…because the band it WOULD get sits on top of the volume bars" → the
//     fallback is now STRUCTURALLY unreachable for a flipped id, which IS the
//     fix, so the case asserts unreachability. The overlap arithmetic is kept
//     against a hand-built ctx, so the two numbers that made it dangerous still
//     fail if either moves.
//   · Ctrl+I → writes a TOMBSTONE and the mirror, not the mirror alone.
//
// Nothing here re-derives the geometry: every case reads the band out of the ctx
// the binder was actually handed. That is what let the suite outlive
// `paneMargins.js` itself — the object simply became `computePaneLayout(...).bands`
// and the key, the value and the assertion are unchanged.
describe('the reserved band — the instance reserves it, and the engine lands in it', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  const RSI_ON = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
  const rsiSeries = () => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi')
  const settings = (over) => ({ ...RSI_ON, indicatorInstances: [RSI_INSTANCE], ...over })

  /** Two `scaleMargins`, as fractions from the TOP and from the BOTTOM of the
   *  pane: band A spans [top, 1-bottom]. They overlap when each starts before
   *  the other ends. */
  const overlaps = (a, b) => a.top < (1 - b.bottom) && b.top < (1 - a.bottom)

  /** What placement resolves for THIS instance, through the ctx the binder was
   *  actually handed — not a reconstruction of it. */
  const placementFor = (instance, ctx = undefined) => {
    const c = ctx || H.syncCalls.at(-1)
    expect(c, 'the binder was never synced — this test is vacuous').toBeTruthy()
    return c.resolvePlacement(instance, registry.getDefinition('rsi'), c)
  }

  it('the toggle ON: the engine lands in the band the LAYOUT reserved, clear of volume', () => {
    draw(settings())
    const ctx = H.syncCalls.at(-1)
    expect(H.binderApis[0].bindings(), 'the engine bound nothing — vacuous').toHaveLength(1)
    expect(ctx.paneMargins.volume, 'no volume band — the overlap check would be vacuous').toBeTruthy()

    // The band itself, pinned. Counts alone let the projection change the
    // deferred semantic with 956 tests green (review I-1).
    expect(ctx.paneMargins.rsi).toEqual({ top: 0.85, bottom: 0 })
    const band = placementFor(RSI_INSTANCE).scaleOptions.scaleMargins
    expect(band).toEqual({ top: 0.85, bottom: 0 })
    expect(overlaps(band, ctx.paneMargins.volume),
      "the engine's RSI band overlaps the volume band").toBe(false)
  })

  it('⭐ the toggle OFF but an INSTANCE present: the BAND is reserved and the line is drawn', () => {
    // ⛔ THE TRIPWIRE'S OTHER SIDE. This case asserted `toBeUndefined()` and
    // `toHaveLength(0)` under Flip A; the SAME blob now reserves the band and
    // draws into it, because the instance is the authority and the toggle is a
    // mirror. Both numbers are pinned, not just presence: an instance that
    // reserved SOME band would pass a truthiness check and still re-lay-out the
    // whole chart.
    draw(settings({ indicators: { rsi: { enabled: false } } }))
    const ctx = H.syncCalls.at(-1)
    expect(ctx.paneMargins.rsi,
      'the instance did not reserve a band — the projection is not wired').toEqual({ top: 0.85, bottom: 0 })
    expect(H.binderApis[0].bindings(), 'a reserved band with nothing in it').toHaveLength(1)
    expect(rsiSeries()).toHaveLength(1)
    expect(overlaps(placementFor(RSI_INSTANCE).scaleOptions.scaleMargins, ctx.paneMargins.volume))
      .toBe(false)
  })

  it('a TOMBSTONE releases the band, and nothing is drawn into it', () => {
    // The direction Flip A could not express: the toggle says ON, the instance
    // list says the indicator was deleted, and the LAYOUT agrees with the
    // instance list. The price pane gets the height back, which is what a user
    // actually sees.
    //
    // ⚠️ THROUGH `setIndicatorEnabled`, NOT A HAND-WRITTEN TOMBSTONE. A tombstone
    // on `engine-test:rsi` alone does NOT turn RSI off — the legacy toggle is
    // still true and there is no `legacy:rsi` tombstone to block its projection,
    // so the migrator puts it straight back. That is correct (it is the same rule
    // `isIndicatorEnabled` applies) and it is precisely why "off" tombstones EVERY
    // live instance AND reserves `legacy:<id>`. Writing the tombstone by hand here
    // would have tested a shape no control can produce.
    //
    // ⚠️ BB_CONTROL IS ON THE CHART AND IT IS LOAD-BEARING (B5 Task 4). With the
    // flag deleted, a chart whose only indicator has been tombstoned holds NO
    // instances and constructs no binder — so `H.syncCalls` would be empty and
    // "no rsi band" would read as `undefined` because no engine ran, not because
    // the band was released. BB is a PRICE overlay: it keeps a live binder and a
    // real `paneMargins` object without reserving a band of its own.
    const off = setIndicatorEnabled(settings({ indicators: { ...RSI_ON.indicators, ...BB_CONTROL } }),
      'rsi', false, registry)
    expect(off.indicatorInstances.filter(i => i.deleted).length,
      'the writer produced no tombstone — this case is vacuous').toBeGreaterThan(0)
    draw(off)
    const ctx = H.syncCalls.at(-1)
    expect(ctx, 'no sync happened — the released-band assertion would be vacuous').toBeTruthy()
    expect(ctx.paneMargins.volume, 'the margins object is empty — so is the claim below').toBeTruthy()
    expect(ctx.paneMargins.rsi, 'a band was reserved for a deleted indicator').toBeUndefined()
    expect(bound().filter(b => b.key.includes('rsi'))).toHaveLength(0)
    expect(rsiSeries()).toHaveLength(0)
  })

  it('…and the {top:0.82} fallback that used to overlap volume is now UNREACHABLE', () => {
    // The mechanism is kept as arithmetic, because the numbers are what made it
    // dangerous — but it is asserted against a HAND-BUILT ctx with the band
    // removed, since no blob can produce that state for a flipped id any more.
    // The unreachability is the first assertion; the arithmetic is the second,
    // and it still fails if either literal moves.
    draw(settings({ indicators: { rsi: { enabled: false } } }))
    const ctx = H.syncCalls.at(-1)
    expect(ctx.paneMargins.rsi,
      'a blob reached the fallback — a flipped id no longer guarantees its band').toBeTruthy()

    const noBand = { ...ctx, paneMargins: { ...ctx.paneMargins, rsi: undefined } }
    const would = placementFor(RSI_INSTANCE, noBand).scaleOptions.scaleMargins
    expect(would, 'the fallback moved — re-check it against volume').toEqual({ top: 0.82, bottom: 0 })
    expect(ctx.paneMargins.volume, 'no volume band — vacuous').toBeTruthy()
    expect(overlaps(would, ctx.paneMargins.volume),
      'the fallback no longer overlaps volume — this case has stopped meaning anything').toBe(true)
  })

  it('Ctrl+I hides an engine-drawn RSI — the keystroke, and what the keystroke writes', () => {
    // `keyboardShortcuts.INDICATOR_CHORDS` → StockChart's `toggle:` handler. (The
    // line number that used to be here — `keyboardShortcuts.js:99` — named the
    // hand-written row B4 Task 4 generated away; a comment holding a line number
    // is a control that rots on the next edit above it.) ⭐ AT FLIP B IT
    // WRITES THE INSTANCE, not just the toggle: the old assertion "the keystroke
    // must not rewrite the instance list" was Flip A's, and keeping it would have
    // meant Ctrl+I clearing a mirror while the chart kept drawing. The MIRROR is
    // still written — that is what keeps the alert evaluator and the alert
    // popover alive — so both halves are asserted.
    //
    // ⚠️ BB_CONTROL rides along for the RE-RENDER at the bottom, same reason as
    // the tombstone case: after Ctrl+I the chart holds no RSI instance, and since
    // B5 Task 4 that means no binder and no sync — so `paneMargins.rsi` would read
    // `undefined` because nothing ran. BB is a price overlay and reserves no band.
    const persisted = []
    const withControl = settings({ indicators: { ...RSI_ON.indicators, ...BB_CONTROL } })
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways(withControl)} onSettingsPersist={(s) => persisted.push(s)} />,
    )
    expect(rsiSeries(), 'nothing drawn to hide — vacuous').toHaveLength(1)

    act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'i' }) })

    expect(persisted.length, 'Ctrl+I persisted nothing — the shortcut is not wired').toBeGreaterThan(0)
    const next = persisted.at(-1)
    expect(next.indicators.rsi.enabled, 'the MIRROR was not written').toBe(false)
    expect(next.indicatorInstances, 'the keystroke did not tombstone the instance')
      .toContainEqual({ instanceId: 'engine-test:rsi', deleted: true })

    view.unmount(); cleanup(); H.reset()
    render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(next)} />)
    expect(rsiSeries(), "Ctrl+I left the engine's RSI on the chart").toHaveLength(0)
    expect(bound().filter(b => b.key.includes('rsi'))).toHaveLength(0)
    const after = H.syncCalls.at(-1)
    expect(after, 'no sync after Ctrl+I — the band assertion would be vacuous').toBeTruthy()
    expect(after.paneMargins.volume, 'the margins object is empty — so is the claim below').toBeTruthy()
    expect(after.paneMargins.rsi, 'Ctrl+I left the band reserved').toBeUndefined()
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
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  it('draws three BB lines with the engine OFF (the shipped behaviour)', () => {
    draw(BB_ON)
    expect(purple()).toHaveLength(3)
  })

  it('STILL draws exactly three when the engine owns it — and they are the ENGINE\'s', () => {
    draw({ ...BB_ON, indicatorInstances: [BB_INSTANCE] })
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
    draw({ ...BB_ON, indicatorInstances: [BB_INSTANCE] })
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
    draw({ ...BB_ON, indicatorInstances: [BB_INSTANCE], volume: { show: true } })
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

  it('and BB is drawn in REGISTRY order relative to every OVERLAPPING engine series', () => {
    // 🔴 THE PREMISE THIS CASE WAS BUILT ON EXPIRED AT B5 TASK 8, AND — LIKE ITS
    // SIBLING IN THE I-3 BLOCK — IT WAS GREEN WHILE FALSE FIRST. It read *"still
    // draws BEFORE every un-migrated legacy indicator block"* and used `macd` and
    // `obv` as those blocks; `macd` was flipped at B3 Task 11 and `obv` at B5
    // Task 8, so both are engine-drawn, at the SAME call site as the BB it is
    // compared against.
    //
    // ⭐⭐ AND B5 TASK 9 TRIED TO MOVE IT AND THE PIXEL GATE REFUSED, WHICH IS WHY
    // IT IS STRENGTHENED RATHER THAN RE-TYPED. The fold was written to seed in
    // SHIPPED STACK ORDER, which would have put `obv` — a PANE — before `bb`;
    // `engine_three_bands_stacked` then reported a manifest GEOMETRY diff at 0
    // changed pixels (`series[2]/[3].scaleId` swapped), because the instance list
    // is the binder's `addSeries` order. The seed stayed registry order, and the
    // claim below is the one that was always underneath it.
    //
    // ⛔ WHAT THE CASE IS PROTECTING IS Z-ORDER, AND Z-ORDER ONLY EXISTS BETWEEN
    // SERIES THAT CAN OVERLAP. LWC z-stacks by insertion, and two series can only
    // paint the same pixel if they are on the SAME price scale — the five price
    // overlays all sit on `right`; every pane definition has its own scale in its
    // own band. So the claim is: the PRICE OVERLAYS keep registry order relative
    // to each other, which is legacy render order for the five of them. Where a
    // pane id lands among them is not a z-order fact and this stops asserting it.
    const BLOB_ORDER = { obv: { enabled: true }, bb: { enabled: true }, macd: { enabled: true },
      sar: { enabled: true }, donchian: { enabled: true } }
    draw({ indicators: BLOB_ORDER })
    const order = bound().map(b => b.defId).filter((id, i, a) => id !== a[i - 1])
    const PRICE = ['bb', 'vwap', 'sar', 'ichimoku', 'donchian']
    const drawnPrice = order.filter(id => PRICE.includes(id))
    expect(drawnPrice.length, 'no price overlay was drawn — this case is vacuous')
      .toBeGreaterThan(1)
    expect(drawnPrice, 'the price overlays are no longer in registry order — LWC z-stacks by '
      + 'insertion and all five share the `right` scale, so this inverts which translucent '
      + 'line wins the pixel wherever two of them cross')
      .toEqual(PRICE.filter(id => drawnPrice.includes(id)))
    // ⛔ AND THE OVERLAP PREMISE ITSELF, MEASURED rather than asserted in prose:
    // every price overlay really is on ONE shared scale, and the pane ids really
    // are not — which is what makes "where obv lands" a non-claim.
    const scaleOf = (id) => bound().filter(b => b.defId === id).map(b => b.scaleId)
    expect(new Set(drawnPrice.flatMap(scaleOf)).size,
      'the price overlays stopped sharing one scale, so registry order stopped being z-order')
      .toBe(1)
    expect(scaleOf('obv').every(sc => !scaleOf('bb').includes(sc)),
      'obv shares a scale with bb — then its position IS a z-order fact and this case is wrong')
      .toBe(true)
    // …and the seed order really is SHIPPED STACK order, which is what makes the
    // price-overlay sequence above a z-order claim rather than an accident.
    //
    // ⭐ B5 TASK 13 MOVED THIS LINE AND NOT THE ONE ABOVE IT, AND THAT IS THE
    // WHOLE POINT OF THE CASE. The seed is `SHIPPED_STACK_ORDER` now — Task 9's
    // change, applied once Flip C gave every pane definition a pane of its own —
    // so `obv` and `macd` move ahead of `bb` here. The PRICE OVERLAYS do not move
    // relative to each other, because they are the tail of that array in registry
    // order, and they are the only series left sharing a scale. This case is the
    // unit-level twin of `engine_price_overlay_zorder` in the pixel gate.
    const stackOrder = [...SHIPPED_STACK_ORDER].filter(id => order.includes(id))
    expect(order, 'the seeded order is no longer the shipped stack order — re-run the pixel '
      + 'gate, a reorder here moves manifest GEOMETRY').toEqual(stackOrder)
    // ⛔ AND THE TWO ORDERS REALLY DO DISAGREE ON THIS FIXTURE, or the line above
    // would pass for a fold that had silently reverted.
    const registryOrder = registry.listDefinitions().map(d => d.id).filter(id => order.includes(id))
    expect(stackOrder, 'this fixture cannot tell the stack order from registry order — '
      + 'pick another').not.toEqual(registryOrder)
    // ⚠️ THE BLOB'S KEY ORDER IS DELIBERATELY NOT THE ANSWER'S. A migrator that
    // echoed `Object.keys(cs.indicators)` would draw obv, bb, macd, sar, donchian.
    expect(Object.keys(BLOB_ORDER), 'the fixture blob is already in the ANSWER order, so '
      + 'this control cannot tell a derivation from a key echo').not.toEqual(order)
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
    const migratedPrice = PRICE_ORDER.filter(id => ENGINE_OWNED.has(id))
    expect(migratedPrice.length,
      'no price overlay has migrated — this rail is vacuous until one has').toBeGreaterThan(0)
    const lastMigrated = PRICE_ORDER.indexOf(migratedPrice.at(-1))
    for (let i = 0; i <= lastMigrated; i++) {
      expect(ENGINE_OWNED.has(PRICE_ORDER[i]),
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
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  const settings = (over) => ({ ...BB_ON, indicatorInstances: [BB_INSTANCE], ...over })

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
    // ⚠️ BB's shortcut is Ctrl+**B** (`INDICATOR_CHORDS` → StockChart's
    // `toggle:bb`); Ctrl+I is RSI's. ⭐ AT FLIP B IT WRITES THE INSTANCE: the old
    // assertion "the keystroke must not rewrite the instance list" was Flip A's,
    // and keeping it would mean Ctrl+B cleared a mirror while three purple lines
    // stayed on the price scale. The mirror is still written.
    const persisted = []
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways(settings())} onSettingsPersist={(s) => persisted.push(s)} />,
    )
    expect(purple(), 'nothing drawn to hide — vacuous').toHaveLength(3)

    act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'b' }) })

    expect(persisted.length, 'Ctrl+B persisted nothing — the shortcut is not wired').toBeGreaterThan(0)
    const next = persisted.at(-1)
    expect(next.indicators.bb.enabled, 'the MIRROR was not written').toBe(false)
    expect(next.indicatorInstances, 'the keystroke did not tombstone the instance')
      .toContainEqual({ instanceId: 'legacy:bb', deleted: true })

    view.unmount(); cleanup(); H.reset()
    render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(next)} />)
    expect(purple(), "Ctrl+B left the engine's bands on the chart").toHaveLength(0)
    expect(H.binderApis[0] ? H.binderApis[0].bindings() : []).toHaveLength(0)
  })

  it('the CONTROL turns BB off and back on, and never leaves SIX purple lines', () => {
    // ⭐ FLIP-B SEMANTICS. `cs.indicators.bb.enabled` is the MIRROR now, so this
    // goes through `setIndicatorEnabled` — the writer every control surface calls.
    // What must hold in every combination is unchanged: the user never ends up
    // looking at six purple lines or at three orphans.
    const base = settings()
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(base)} />)
    expect(purple()).toHaveLength(3)
    const first = H.binderApis[0].bindings().map(b => b.series)

    // `purple()` counts addSeries CALLS and never shrinks, so "the bands went
    // away" has to be read off the REMOVAL and off what the binder still holds.
    const off = setIndicatorEnabled(base, 'bb', false, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(H.binderApis[0].bindings(), 'turned off: the engine still holds series').toHaveLength(0)
    for (const ser of first) expect(H.removedSeries, 'a band is still on the chart').toContain(ser)
    expect(purple(), 'and nothing drew a replacement').toHaveLength(3)

    const backOn = setIndicatorEnabled(off, 'bb', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(backOn)} />)
    expect(H.binderApis[0].bindings(), 'turned back on: the engine draws them again').toHaveLength(3)
    expect(purple(), 'turned back on: three more, and nothing else added its own').toHaveLength(6)
  })

  it('⭐ BB ARRIVING and DEPARTING mid-session, with the price pane unchanged either way', () => {
    // The user-performed direction, on the PRICE overlay rather than the banded
    // oscillator. BB reserves no band of its own (it lives on the candles' scale),
    // so what has to hold is that the candles' own framing is untouched — which is
    // the `autoscaleInfoProvider` seam, asserted here at the component level.
    const off = { indicators: { bb: { enabled: false, period: 20, stdDev: 2, color: BB_COLOUR } }, indicatorInstances: [] }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(H.binderApis[0] ? H.binderApis[0].bindings() : []).toHaveLength(0)
    expect(purple(), 'something drew BB while it was off').toHaveLength(0)

    const on = setIndicatorEnabled(off, 'bb', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(on)} />)
    const bound = H.binderApis[0].bindings()
    expect(bound, 'arriving mid-session drew no bands').toHaveLength(3)
    // …on the CANDLES' scale, and excluded from its autoscale. Read off the
    // `addSeries` calls, which is where the option set the renderer received
    // actually is — a binding record carries the series and its key, not options.
    const created = purple()
    expect(created, 'the bands were not created here — vacuous').toHaveLength(3)
    for (const c of created) {
      expect(c.options.priceScaleId, 'a band landed off the candles scale').toBe('right')
      expect(c.options.autoscaleInfoProvider(),
        'a band would stretch the candles autoscale').toBe(null)
    }

    const offAgain = setIndicatorEnabled(on, 'bb', false, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(offAgain)} />)
    expect(H.binderApis[0].bindings(), 'departing mid-session left bands behind').toHaveLength(0)
    for (const b of bound) expect(H.removedSeries).toContain(b.series)
  })

  it('a STORED instance arriving MID-SESSION replaces the PROJECTED one, re-binding not recreating', () => {
    // ⛔ THE MID-SESSION CROSSOVER, RESHAPED BY FLIP B. Under Flip A this was
    // legacy-block → engine and the failure was three orphaned legacy lines
    // (mutation M8, which survived everything else). There is no legacy block now,
    // so the seam is PROJECTED → STORED: the chart is up drawing BB from an
    // instance the migrator invented out of `indicators.bb.enabled`, and then a
    // real one with different inputs arrives — a settings sync, a grid cell's
    // override, a share link.
    const projectedOnly = { ...BB_ON, indicatorInstances: [] }
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(projectedOnly)} />,
    )
    const projected = H.binderApis[0].bindings()
    expect(projected, 'the migrator drew nothing — this case is vacuous').toHaveLength(3)
    expect(purple(), 'more than three purple lines before the crossover started').toHaveLength(3)
    const before = projected.map(b => b.series)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({
          ...projectedOnly,
          indicatorInstances: [{ ...BB_INSTANCE, inputs: { ...BB_INSTANCE.inputs, period: 34 } }],
        })} />,
    )

    const after = H.binderApis[0].bindings()
    expect(after, 'the stored instance did not take over — or BOTH are drawn').toHaveLength(3)
    expect(purple(), 'a fourth purple line appeared').toHaveLength(3)
    // ⚠️ #2049: re-bound, never destroyed and recreated.
    expect(after.map(b => b.series).sort(), 'the pool destroyed and recreated the bands')
      .toEqual(before.sort())
    for (const ser of before) expect(H.removedSeries).not.toContain(ser)
  })

  it('and the reverse — the STORED instance leaving hands the bands back to the projection', () => {
    // The same seam from the other side, with the toggle still on. If the
    // projection did not take back over, removing an instance would delete an
    // indicator the settings still say is on.
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings())} />,
    )
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(before).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...settings(), indicatorInstances: [] })} />,
    )
    const after = H.binderApis[0].bindings()
    expect(after, 'the bands vanished when the stored instance was removed').toHaveLength(3)
    expect(after.map(b => b.series).sort(), 'the pool destroyed and recreated them')
      .toEqual(before.sort())
    expect(purple(), 'a second set of three was drawn').toHaveLength(3)
  })

  it('a COLOUR change re-styles the SAME three series — never destroys and recreates', () => {
    // lightweight-charts#2049: a mass removeSeries is a 2-4s main-thread block,
    // and a price overlay is three series rather than one, so the pool matters
    // three times as much here.
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings())} />)
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(before).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings({
        indicatorInstances: [{ ...BB_INSTANCE, inputs: { period: 20, stdDev: 2, color: '#00ff00' } }],
      }))} />,
    )
    expect(H.binderApis[0].bindings().map(b => b.series),
      'the engine created new series instead of restyling').toEqual(before)
    expect(H.removedSeries.filter(s => before.includes(s)),
      'a band was destroyed and recreated — that is the #2049 path').toHaveLength(0)
  })

  it('a PERIOD or STD-DEV change keeps the same three series and re-binds them', () => {
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings())} />)
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(before).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings({
        indicatorInstances: [{ ...BB_INSTANCE, inputs: { period: 10, stdDev: 3, color: BB_COLOUR } }],
      }))} />,
    )
    expect(H.binderApis[0].bindings().map(b => b.series)).toEqual(before)
    expect(purple(), 'a fourth purple line appeared').toHaveLength(3)
  })
})

describe('an engine-drawn Bollinger adds EXACTLY ONE chip to the crosshair legend', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  // 🔴 THIS DESCRIBE READ *"adds NOTHING to the crosshair legend"*, and the note
  // under it read *"BB declares `legend: { hide: true }` on all three plots
  // because the SHIPPED legend has no Bollinger chip"*. Both were accurate about
  // the shipped chart and both were the DEFECT: three purple lines on the price
  // scale that a user could not put a name to, at any time, hovering or not.
  // Task 2 (`43efeff6`) gave the BASIS a chip and left the two EDGES hidden.
  //
  // ⛔ THE PARITY EQUALITY IS UNTOUCHED, AND THAT IS THE POINT OF THIS BLOCK.
  // What migrating BB from the toggle-projected path to a stored instance may
  // change is still NOTHING — `expect(engine).toBe(legacy)` below is the same
  // character-for-character comparison it always was. What changed is the
  // SECOND claim this case made ("…and that legend contains no BB chip"), which
  // is now false. It is replaced by the exact chip text rather than by a
  // tolerance: an assertion that passed when the chip was MISSING would be
  // indistinguishable from deleting the case.
  //
  // ⚠️ THE PIXEL GATE CANNOT SEE ANY OF THIS — a headless capture has no cursor,
  // and `ChartRender.jsx:527` hides the legend container outright on the only
  // route it photographs. A zero from it is not evidence about a chip.
  const hoverText = (view) =>
    // Every purple line carries a value at the hovered bar — the state in which a
    // chip WOULD be emitted if anything asked for one. All THREE are fed, which
    // is what makes the occurrence count below able to catch an edge chip.
    settledLegend(view, crosshairAt(BARS, purple().map(c => [c.series, { value: 123.456 }])))

  /** How many times `needle` occurs in `hay` — the edges-stayed-hidden probe. */
  const occurrences = (hay, needle) => hay.split(needle).length - 1

  it('the ENGINE legend is character-for-character the LEGACY legend', async () => {
    const legacyView = draw(BB_ON)
    const legacyText = await hoverText(legacyView)
    expect(legacyText, 'the legend printed nothing — vacuous').toMatch(/O\s*1/)
    // ⭐ THE DECLARED DIFFERENCE, NAMED. Not "contains BB somewhere": the whole
    // chip, label and precision together, so a lost chip, a renamed one, a
    // dropped `legendParams` (`BB 123.46`) or a precision change all fail here.
    expect(legacyText, 'the Bollinger chip is gone from the legend')
      .toContain('BB(20, 2) 123.46')
    // …and ONLY the basis. Three series were hovered with the same value, so a
    // `legend` block on `upper` or `lower` makes this three and fails — the
    // three-purple-chips regression the old `not.toContain` was holding down.
    expect(occurrences(legacyText, '123.4'),
      'a band EDGE grew a chip — three numbers for one indicator').toBe(1)

    cleanup(); H.reset()
    const engineView = draw({ ...BB_ON, indicatorInstances: [BB_INSTANCE] })
    expect(H.binderApis[0].bindings(), 'the engine bound nothing — vacuous').toHaveLength(3)
    expect(await hoverText(engineView)).toBe(legacyText)
  })

  it('and an RSI chip alongside it is untouched — BB\'s chip must not crowd it out', () => {
    // The other direction of the same mistake. It used to read *"hiding BB must
    // not hide everything"*: a bridge that dropped every chip would satisfy the
    // case above and break the one indicator that HAS one. Task 2 makes the twin
    // sharper rather than retiring it — BB now emits too, so this is the case
    // that two indicators on one chart each print their OWN chip, and exactly one
    // each.
    const view = draw({
      ...BB_ON, indicators: { ...BB_ON.indicators, rsi: { enabled: true, period: 14, color: '#7b68ee' } },
      indicatorInstances: [BB_INSTANCE, RSI_INSTANCE],
    })
    expect(H.binderApis[0].bindings(), 'BB (3) + RSI (1) — vacuous otherwise').toHaveLength(4)
    return (async () => {
      const rsi = H.addSeriesCalls.find(c => c.options && c.options.priceScaleId === 'rsi')
      expect(rsi, 'no rsi-scale series').toBeTruthy()
      const text = await settledLegend(view, crosshairAt(BARS, [
        [rsi.series, { value: 54.321 }],
        ...purple().map(c => [c.series, { value: 123.456 }]),
      ]))
      expect(text, 'the RSI chip disappeared when BB gained one').toContain('RSI(14) 54.3')
      expect(text, 'the Bollinger chip disappeared when RSI was drawn beside it')
        .toContain('BB(20, 2) 123.46')
      expect(occurrences(text, '123.4'), 'a band EDGE grew a chip').toBe(1)
      expect(occurrences(text, '54.3'), 'RSI printed twice').toBe(1)
    })()
  })

  it('and the BASIS declares the chip while both EDGES stay hidden — the reason the above holds', () => {
    // ⚠️ THE RENDERED CASES ABOVE CANNOT SEE THE DECLARATION, AND A MUTATION
    // PROVED IT. `emitChips` skips a plot when `!plot.legend` OR when
    // `plot.legend.hide` is true (`readout.js`), so the `hide` flag is the INTENT
    // ("deliberately no chip") as distinct from the omission ("nobody declared one
    // yet"), and until this case existed it could be deleted with the whole suite
    // green.
    //
    // 🔴 IT USED TO ASSERT `hide === true` ON ALL THREE. Task 2 (`43efeff6`) gave
    // the BASIS a real chip; the two EDGES keep the flag, and keeping it is a
    // decision rather than an oversight — three numbers for one indicator is the
    // readout regression MACD's histogram is hidden for. Stated per PLOT KEY and
    // as a whole-object `toEqual`, so it fails in every direction that matters:
    // the basis losing its chip, an edge gaining one, a precision change, or a
    // `legend.label` appearing where `shortName` already IS the stem.
    const def = registry.getDefinition('bb')
    expect(def.plots.map(p => p.key), 'upper / middle / lower').toEqual(['upper', 'middle', 'lower'])
    const byKey = Object.fromEntries(def.plots.map(p => [p.key, p]))
    expect(byKey.middle.legend, 'the Bollinger BASIS lost the chip Task 2 gave it')
      .toEqual({ decimals: 2 })
    expect(byKey.upper.legend, 'the UPPER band grew a chip the readout must not print')
      .toEqual({ hide: true })
    expect(byKey.lower.legend, 'the LOWER band grew a chip the readout must not print')
      .toEqual({ hide: true })
    // …and the brackets, which are what make two Bollingers on one chart tellable
    // apart. A `legend.label` here would short-circuit these and leave them inert.
    expect(def.meta.legendParams, 'the chip stopped naming its period and stdDev')
      .toEqual(['period', 'stdDev'])
  })
})

describe('C-2 — RSI off and BB on in ONE settings write, from the component', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

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
  //
  // ⚠️ THE TWO STATES HAD TO BECOME EXPLICIT AT FLIP B. This used to leave BOTH
  // legacy toggles on and move only the instance list, because under Flip A the
  // toggle was the switch and the legacy block drew whatever the engine did not.
  // After the flip the toggle PROJECTS an instance, so "rsi on, bb on, one RSI
  // instance" is four bindings, not one, and the re-purpose this case exists to
  // observe never happens. State A is RSI alone; state B is BB alone; the write
  // between them is still ONE settings write.
  const IND = (rsiOn, bbOn) => ({
    rsi: { enabled: rsiOn, period: 14, color: '#7b68ee' },
    bb: { enabled: bbOn, period: 20, stdDev: 2, color: BB_COLOUR },
  })
  const rsiOnly = { indicators: IND(true, false), indicatorInstances: [RSI_INSTANCE] }
  const bbOnly = { indicators: IND(false, true), indicatorInstances: [BB_INSTANCE] }

  it("the re-purposed series is moved to the CANDLES' scale and excluded from it", () => {
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(rsiOnly)} />,
    )
    const drawnRsi = H.binderApis[0].bindings().map(b => b.series)
    expect(drawnRsi, 'the engine drew no RSI — nothing to re-purpose').toHaveLength(1)
    const [freed] = drawnRsi
    H.applyOptionsCalls.length = 0

    // ONE write: the RSI instance leaves and the BB instance arrives together.
    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(bbOnly)} />,
    )

    const bound = H.binderApis[0].bindings()
    expect(bound, "the engine did not bind BB's three bands").toHaveLength(3)
    expect(bound.every(b => b.defId === 'bb')).toBe(true)
    // The pool did its job — RSI's series IS one of BB's three bands now. If this
    // ever stops holding, everything below is about a freshly-CREATED series
    // (which always gets a full option set through `addSeries`) and proves
    // nothing about a re-purpose, which is the whole subject of C-2.
    expect(bound.map(b => b.series),
      "RSI's series was destroyed rather than re-purposed — this case is vacuous")
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
      expect(c.options.color, "and it is wearing BB's colour").toBe(BB_COLOUR)
    }
  })

  it('and the RSI band it vacated is gone — no orphan on the rsi scale', () => {
    // The other half of the same write. If the band survived the write, the user
    // would be looking at a permanently short price pane with nothing under it.
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(rsiOnly)} />,
    )
    expect(H.binderApis[0].bindings()).toHaveLength(1)
    expect(H.syncCalls.at(-1).paneMargins.rsi, 'no band to vacate — vacuous').toEqual({ top: 0.85, bottom: 0 })

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(bbOnly)} />,
    )
    expect(H.binderApis[0].bindings().every(b => b.defId === 'bb')).toBe(true)
    expect(H.binderApis[0].bindings()).toHaveLength(3)
    expect(H.syncCalls.at(-1).paneMargins.rsi,
      'the RSI band survived the write that removed the RSI').toBeUndefined()
  })
})

describe('a BB instance survives BOTH settings allow-lists', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  // `mergeChartSettings` is an explicit allow-list — a key absent from its return
  // is silently DROPPED on every read — and `mergeSettingsOverride` is the second
  // one, applied by every grid cell and by the parity route. An instance that
  // does not survive both is an indicator that vanishes on the next
  // read-merge-write, and nothing in the picture says so.
  it('mergeChartSettings keeps the instance and the flag through a JSON round-trip', () => {
    // ⚠️ THE TITLE SAYS "the flag" AND IT USED TO ASSERT `merged.engineEnabled`
    // — B5 Task 4 deleted that key, so the allow-list DESTROYS it and the
    // instance is the only engine state left to survive a round-trip. The
    // absence is asserted, not dropped: a resurrected key here would be an
    // undeclared value riding in every stored blob again.
    const stored = JSON.stringify({ ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE] })
    const merged = mergeChartSettings(stored)
    expect(merged.indicatorInstances).toEqual([BB_INSTANCE])
    expect('engineEnabled' in merged).toBe(false)
    // ⭐⭐ B5 TASK 9 MOVED THIS DOWN A LEVEL, AND THE CONTROL IT REPLACES IS THE
    // ONE THIS TASK DESTROYS. It asserted `merged.indicators.bb.enabled === true`
    // — the legacy MIRROR — as the thing that had to survive the allow-list.
    // `mergeChartSettings` now folds the fourteen legacy sections into
    // `indicatorInstances` and DESTROYS the mirror, so that assertion had no
    // subject left. What still has to survive is the INSTANCE, and what now has
    // to be DESTROYED is the mirror: the allow-list is asserted by what it
    // removes, which is the only spelling a renamed line cannot satisfy.
    expect(merged.indicators.bb, 'the legacy mirror survived the fold').toBeUndefined()
    expect(Object.keys(merged.indicators)).toEqual(['volumeProfile'])
  })

  it('mergeSettingsOverride patches ONE input without deleting the instance', () => {
    const base = mergeChartSettings(JSON.stringify({
      ...BB_ON, indicatorInstances: [BB_INSTANCE, RSI_INSTANCE],
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
      ...BB_ON, indicatorInstances: [BB_INSTANCE],
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
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  it('draws three series on the macd scale with the engine OFF (the shipped behaviour)', () => {
    draw(MACD_ON)
    expect(onMacdScale()).toHaveLength(3)
    expect(onMacdScale().map(c => c.ctor)).toEqual(['LineSeries', 'LineSeries', 'HistogramSeries'])
  })

  it('STILL draws exactly three when the engine owns it — and they are the ENGINE\'s', () => {
    draw({ ...MACD_ON, indicatorInstances: [MACD_INSTANCE] })
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
    draw({ ...MACD_ON, indicatorInstances: [MACD_INSTANCE] })
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
    draw({ ...MACD_ON, indicatorInstances: [MACD_INSTANCE] })
    const guides = H.priceLineCalls.filter(c => c.options && c.options.price === 0)
    expect(guides, 'the engine drew the wrong number of zero guides').toHaveLength(1)
    // LineStyle 3 = LargeDashed. An OMITTED `createPriceLine` option takes LWC's
    // own default (Dashed, 2) — the 379-px class of finding from RSI's midline.
    expect(guides[0].options).toEqual(legacySpec)
    expect(guides[0].options.lineStyle).toBe(3)
    // …and it hangs off the FIRST data series, so a removeSeries takes it along.
    expect(guides[0].series).toBe(onMacdScale()[0].series)
  })

  it('an EXPLICIT instance list is the whole of what the engine draws — ownership is per definition', () => {
    // 🔴 GREEN WHILE FALSE UNTIL B5 TASK 5, THEN RE-POINTED TWICE, AND NOW MOVED
    // DOWN A LEVEL. The pair was `['stoch', 'obv']`; after Stochastic was flipped
    // the `stoch` half went on passing for the WRONG REASON (a series still
    // appears on the `stoch` scale, but the ENGINE draws it), so Task 5 added the
    // un-flipped assertion below and Task 7 moved the pair to `['adx', 'obv']` —
    // the last two un-flipped PANE oscillators there were. **B5 Task 8 flipped
    // both**, so there is no un-flipped subject left and the old form could only
    // fail.
    //
    // ⛔ WHAT IT WAS PROTECTING SURVIVES, AND IT IS THE `hasData` GATE RATHER THAN
    // A POPULATION: an EXPLICIT `indicatorInstances` list is authoritative, so a
    // legacy MIRROR that is `enabled: true` for a definition with no instance in
    // that list must NOT resurrect it. That is the compatibility rule every
    // stored blob depends on (`migrateLegacyToInstances` reserves ids it already
    // sees and projects only the rest), and it is failable in both directions.
    draw({
      ...MACD_ON, indicatorInstances: [MACD_INSTANCE],
      indicators: { ...MACD_ON.indicators, adx: { enabled: true }, obv: { enabled: true } },
    })
    // The two mirror-only ids ARE projected — that is the shipped compatibility
    // path — so they draw, and they draw through the ENGINE now, on their own
    // named scales exactly where their deleted blocks put them.
    for (const scale of ['adx', 'obv']) {
      expect(H.addSeriesCalls.some(c => (c.options || {}).priceScaleId === scale),
        `${scale} stopped drawing`).toBe(true)
    }
    expect(new Set(bound().map(b => b.defId)), 'a mirror-only id was not projected — every '
      + 'existing user\'s blob is mirror-only, so this is the compatibility path itself')
      .toEqual(new Set(['macd', 'adx', 'obv']))
    // …and the other direction: a TOMBSTONE in the explicit list beats the mirror,
    // so "the instance list is authoritative" is not just "everything draws".
    cleanup(); H.reset()
    draw({
      ...MACD_ON,
      indicatorInstances: [MACD_INSTANCE, { instanceId: 'legacy:adx', defId: 'adx', deleted: true }],
      indicators: { ...MACD_ON.indicators, adx: { enabled: true }, obv: { enabled: true } },
    })
    expect(new Set(bound().map(b => b.defId)), 'a tombstoned id came back from the mirror')
      .toEqual(new Set(['macd', 'obv']))
    expect(H.addSeriesCalls.some(c => (c.options || {}).priceScaleId === 'adx'),
      'a tombstoned indicator still drew').toBe(false)
  })
})

describe('MACD\'s histogram — the per-bar sign colours, against a LEGACY control', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

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

    draw({ ...MACD_ON, indicatorInstances: [MACD_INSTANCE] })
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
    draw({ ...MACD_ON, indicatorInstances: [MACD_INSTANCE] })
    expect(lines()).toEqual(legacyLines)
    // …and no point on a LINE carries a colour: `colorMode: 'sign'` is declared on
    // the histogram plot only, and leaking it onto the lines would repaint them
    // green and red bar by bar.
    for (const col of lines()) for (const p of col) expect(p).not.toHaveProperty('color')
  })
})

describe('what pixels cannot see, for MACD', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  const settings = (over) => ({ ...MACD_ON, indicatorInstances: [MACD_INSTANCE], ...over })

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
    // ⚠️ MACD's shortcut is Ctrl+**O** (`INDICATOR_CHORDS` → `matchShortcut`'s
    // generated Ctrl map → StockChart's `toggle:` dispatch). Ctrl+I is RSI's,
    // Ctrl+B is BB's. The three line numbers that used to be here all named code
    // B4 Task 4 generated away — two of them in a `matchShortcut` branch that no
    // longer has per-indicator lines at all.
    const persisted = []
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways(settings())} onSettingsPersist={(s) => persisted.push(s)} />,
    )
    expect(onMacdScale(), 'nothing drawn to hide — vacuous').toHaveLength(3)

    act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'o' }) })

    expect(persisted.length, 'Ctrl+O persisted nothing — the shortcut is not wired').toBeGreaterThan(0)
    const next = persisted.at(-1)
    // ⭐ FLIP B MOVED THE AUTHORITY, SO THE KEYSTROKE HAD TO MOVE WITH IT. This
    // case used to assert the instance list was NOT rewritten — correct while the
    // legacy toggle was the switch. After the flip the instance is the switch, so
    // a keystroke that only cleared the mirror would tick a box the chart
    // disagrees with, and the next paint would draw MACD straight back from the
    // still-live instance. `setIndicatorEnabled` writes the TOMBSTONE and the
    // mirror together, and both halves are asserted because either alone is a
    // half-working control.
    expect(next.indicators.macd.enabled, 'Ctrl+O did not clear the mirror').toBe(false)
    expect(next.indicatorInstances, 'Ctrl+O left the instance live — the chart still draws it')
      .toContainEqual({ instanceId: 'legacy:macd', deleted: true })

    view.unmount(); cleanup(); H.reset()
    render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(next)} />)
    expect(onMacdScale(), 'Ctrl+O left the engine\'s MACD on the chart').toHaveLength(0)
    // `bound()`, not `H.binderApis[0].bindings()`: since B5 Task 4 a chart holding
    // nothing constructs no binder at all, which is the same claim and stronger.
    expect(bound()).toHaveLength(0)
  })

  it('toggling MACD OFF and back ON never leaves SIX series in the band', () => {
    // ⭐ THE SWITCH IS THE INSTANCE NOW (Flip B). This case used to move
    // `cs.indicators.macd.enabled` BY HAND, which was Flip A's switch — after the
    // flip that field is a mirror, so a case still writing it directly measures a
    // mirror with a green tick. It goes through `setIndicatorEnabled`, the one
    // writer every control door shares, so what is asserted is what a user's
    // keystroke actually does.
    const on = { ...MACD_ON, indicatorInstances: [MACD_INSTANCE] }
    const off = setIndicatorEnabled(on, 'macd', false, registry)
    expect(off.indicatorInstances, 'the writer did not tombstone the instance')
      .toContainEqual({ instanceId: 'legacy:macd', deleted: true })

    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(on)} />)
    expect(onMacdScale()).toHaveLength(3)
    const first = H.binderApis[0].bindings().map(b => b.series)

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(H.binderApis[0].bindings(), 'off: the engine still holds series').toHaveLength(0)
    for (const s of first) expect(H.removedSeries, 'a MACD plot is still on the chart').toContain(s)
    expect(onMacdScale(), 'and nothing drew a replacement').toHaveLength(3)
    expect(H.syncCalls.at(-1).paneMargins.macd, 'off: the band is still reserved').toBeUndefined()

    const backOn = setIndicatorEnabled(off, 'macd', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(backOn)} />)
    expect(H.binderApis[0].bindings(), 'toggled back on: the engine draws them again').toHaveLength(3)
    expect(onMacdScale(), 'toggled back on: three more, and nothing else added any').toHaveLength(6)
    expect(H.syncCalls.at(-1).paneMargins.macd, 'back on: no band').toBeTruthy()
  })

  it('⭐ a STORED instance arriving MID-SESSION replaces the PROJECTED one, not adds to it', () => {
    // ⛔ THE SINGLE MOST-REPEATED DEFECT ON THIS BRANCH, IN THE ONLY SHAPE FLIP B
    // LEAVES. It used to be legacy-block-vs-engine: the chart is up, the legacy
    // block has drawn three series, and an instance appears. That block is gone.
    //
    // The crossover that replaces it is REAL and is the §6.1 defect in motion: a
    // blob with a legacy toggle draws through a PROJECTED `legacy:macd`, and then
    // a stored instance under another id arrives (an `?instances=` navigation, a
    // grid cell's settingsOverride, a share link applied to a live chart). The
    // projection must stand down — `migrateLegacyToInstances` reserves ids PER
    // INSTANCE ID, so nothing in it stops a second MACD, and the read-time guard
    // is what does. Get it wrong and the user has SIX series in one band, three
    // of them stale, plus a second zero guide invisible under the first.
    const projected = { ...MACD_ON, indicatorInstances: [] }
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(projected)} />,
    )
    const first = H.binderApis[0].bindings()
    expect(first, 'the projection drew nothing — nothing to hand over').toHaveLength(3)
    for (const b of first) expect(b.key).toContain('legacy:macd')
    const projectedSeries = first.map(b => b.series)
    expect(H.priceLineCalls.filter(c => c.options && c.options.price === 0),
      'the projected MACD drew no zero guide').toHaveLength(1)

    const stored = {
      instanceId: 'grid-cell-3:macd', defId: 'macd',
      inputs: { fastPeriod: 5, slowPeriod: 35, signalPeriod: 4, macdColor: '#00ff00', signalColor: '#FF9800' },
      placement: { target: 'pane' }, hidden: false,
    }
    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...projected, indicatorInstances: [stored] })} />,
    )

    const after = H.binderApis[0].bindings()
    expect(after, 'six series in one band — the projection did not stand down').toHaveLength(3)
    for (const b of after) expect(b.key, 'the projection won over the stored instance')
      .toContain('grid-cell-3:macd')
    // ⭐ AND THE SERIES WERE RE-USED, NOT DESTROYED (#2049). Both instances want
    // the same three pool keys, so the pool must re-purpose rather than remove
    // three and create three.
    expect(after.map(b => b.series).sort(), 'the pool destroyed and recreated the band')
      .toEqual(projectedSeries.sort())
    expect(H.removedSeries.filter(s => projectedSeries.includes(s))).toHaveLength(0)
    // …and the new instance's colour really did reach the line, so "re-used" is
    // not "ignored the new inputs".
    expect(onMacdScale().some(c => c.options.color === '#00ff00')
      || H.applyOptionsCalls.some(c => c.options && c.options.color === '#00ff00'),
    'the stored instance\'s colour never reached the series').toBe(true)
  })

  it('and the reverse — the stored instance LEAVING hands MACD back to the projection', () => {
    // The departure direction. The legacy toggle is still true, so removing the
    // stored instance must not delete the indicator: the migrator projects
    // `legacy:macd` again on the very next paint, and there must still be exactly
    // three series.
    const stored = {
      instanceId: 'grid-cell-3:macd', defId: 'macd',
      inputs: { fastPeriod: 5, slowPeriod: 35, signalPeriod: 4 },
      placement: { target: 'pane' }, hidden: false,
    }
    const withStored = { ...MACD_ON, indicatorInstances: [stored] }
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(withStored)} />,
    )
    const before = H.binderApis[0].bindings()
    expect(before).toHaveLength(3)
    for (const b of before) expect(b.key).toContain('grid-cell-3:macd')

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...withStored, indicatorInstances: [] })} />,
    )
    const after = H.binderApis[0].bindings()
    expect(after, 'MACD vanished when the stored instance was removed').toHaveLength(3)
    for (const b of after) expect(b.key, 'the projection did not take back over')
      .toContain('legacy:macd')
    // …including the histogram, which is the plot a "lines only" stand-back-up
    // would silently drop.
    expect(after.map(b => b.plotKey).sort()).toEqual(['histogram', 'macd', 'signal'])
    expect(H.removedSeries.filter(s => before.map(b => b.series).includes(s)),
      'the band was destroyed and rebuilt instead of re-purposed').toHaveLength(0)
  })

  it('a COLOUR change re-styles the SAME three series — never destroys and recreates', () => {
    // lightweight-charts#2049: a mass removeSeries is a 2-4s main-thread block.
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings())} />)
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(before).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings({
        indicatorInstances: [{ ...MACD_INSTANCE, inputs: { ...MACD_INSTANCE.inputs, macdColor: '#00ff00' } }],
      }))} />,
    )
    expect(H.binderApis[0].bindings().map(b => b.series),
      'the engine created new series instead of restyling').toEqual(before)
    expect(H.removedSeries.filter(s => before.includes(s)),
      'a MACD plot was destroyed and recreated — that is the #2049 path').toHaveLength(0)
  })

  it('a PERIOD change keeps the same three series and re-binds them', () => {
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings())} />)
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(before).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings({
        indicatorInstances: [{
          ...MACD_INSTANCE,
          inputs: { ...MACD_INSTANCE.inputs, fastPeriod: 5, slowPeriod: 35, signalPeriod: 4 },
        }],
      }))} />,
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
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

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
    const engineView = draw({ ...MACD_ON, indicatorInstances: [MACD_INSTANCE] })
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
      const v = draw({ ...MACD_ON, indicatorInstances: [MACD_INSTANCE] })
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
      ...MACD_ON,
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
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  it('mergeChartSettings keeps the instance and the flag through a JSON round-trip', () => {
    // ⚠️ THE TITLE SAYS "the flag" AND IT USED TO ASSERT `merged.engineEnabled`
    // — B5 Task 4 deleted that key, so the allow-list DESTROYS it and the
    // instance is the only engine state left to survive a round-trip. The
    // absence is asserted, not dropped: a resurrected key here would be an
    // undeclared value riding in every stored blob again.
    const stored = JSON.stringify({ ...MACD_ON, engineEnabled: true, indicatorInstances: [MACD_INSTANCE] })
    const merged = mergeChartSettings(stored)
    expect(merged.indicatorInstances).toEqual([MACD_INSTANCE])
    expect('engineEnabled' in merged).toBe(false)
    // ⭐⭐ B5 TASK 9 MOVED THIS DOWN A LEVEL, AND THE CONTROL IT REPLACES IS THE
    // ONE THIS TASK DESTROYS. It asserted `merged.indicators.macd.enabled === true`
    // — the legacy MIRROR — as the thing that had to survive the allow-list.
    // `mergeChartSettings` now folds the fourteen legacy sections into
    // `indicatorInstances` and DESTROYS the mirror, so that assertion had no
    // subject left. What still has to survive is the INSTANCE, and what now has
    // to be DESTROYED is the mirror: the allow-list is asserted by what it
    // removes, which is the only spelling a renamed line cannot satisfy.
    expect(merged.indicators.macd, 'the legacy mirror survived the fold').toBeUndefined()
    expect(Object.keys(merged.indicators)).toEqual(['volumeProfile'])
  })

  it('mergeSettingsOverride patches ONE input without deleting the instance', () => {
    const base = mergeChartSettings(JSON.stringify({
      ...MACD_ON, indicatorInstances: [MACD_INSTANCE, RSI_INSTANCE],
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
      ...MACD_ON, indicatorInstances: [MACD_INSTANCE],
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
  <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(settingsOverride)} />,
)

describe('VWAP Flip A — the legacy block stands down on an intraday chart', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  it('draws one cyan line with the engine OFF (the shipped behaviour)', () => {
    drawIntraday(VWAP_ON)
    expect(vwapLines()).toHaveLength(1)
    expect(vwapLines()[0].options.lineWidth).toBe(1)
    expect(vwapLines()[0].options.lineStyle).toBe(0)
  })

  it('STILL draws exactly one when the engine owns it — and it is the ENGINE\'s', () => {
    drawIntraday({ ...VWAP_ON, indicatorInstances: [VWAP_INSTANCE] })
    const bound = H.binderApis[0].bindings()
    expect(bound, 'the engine bound no VWAP').toHaveLength(1)
    expect(vwapLines(), 'a second cyan line — the legacy block has no guard').toHaveLength(1)
    expect(vwapLines()[0].series).toBe(bound[0].series)
  })

  it('the ENGINE\'s line names the candles\' scale, where legacy named none', () => {
    // The one option that is not a restatement of an LWC default. Legacy omitted
    // `priceScaleId` and let LWC resolve the single visible scale; the engine
    // states it, which is byte-identical on a create and is the FIX on a
    // re-purpose (a series moved from a named scale to an unnamed one keeps the
    // old scale).
    //
    // ⚠️ THE LEGACY HALF OF THIS CASE IS GONE, AND ONLY THE PIXEL GATE STILL
    // CARRIES IT. Task 11 deleted the block that omitted the option, so there is
    // no build in this tree that draws a VWAP without naming a scale. That the
    // two spellings render identically was MEASURED, not assumed —
    // `engine_vwap_vs_legacy` is 0 changed px across two named builds — and that
    // is now the only place the comparison exists.
    drawIntraday({ ...VWAP_ON, indicatorInstances: [VWAP_INSTANCE] })
    expect(vwapLines(), 'nothing drawn — vacuous').toHaveLength(1)
    expect(vwapLines()[0].options.priceScaleId).toBe('right')
    // …and it is the CANDLES' scale, not a named band of its own, which is what
    // makes VWAP a price overlay rather than an oscillator.
    const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
    expect(candle.options.priceScaleId ?? 'right').toBe('right')
  })

  it('neither lane draws on a DAILY chart, and neither lane OWNS it', () => {
    // The timeframe gate, from the component. `VWAP_TFS` empties `indicatorData.vwap`
    // and `eligibility` drops the instance — two reads of one list. A double-draw
    // here would mean they had diverged.
    draw({ ...VWAP_ON, indicatorInstances: [VWAP_INSTANCE] }, 'D')
    expect(bound(), 'the engine drew a session VWAP on daily bars').toHaveLength(0)
    expect(vwapLines(), 'the legacy block drew a session VWAP on daily bars').toHaveLength(0)
  })

  it('leaves every OTHER indicator alone — ownership is per definition', () => {
    // ⚠️ RSI IS NO LONGER A "LEGACY" CONTROL HERE — it is flipped, so the engine
    // draws it too and the binding count is 1 + 1. The claim is unchanged and the
    // assertion is now per DEFINITION rather than a bare total, which is stronger:
    // a total would have been satisfied by two VWAPs and no RSI.
    drawIntraday({
      indicators: { vwap: VWAP_CFG, rsi: { enabled: true } },
      indicatorInstances: [VWAP_INSTANCE],
    })
    const byDef = H.binderApis[0].bindings().map(b => b.defId)
    expect(byDef.filter(d => d === 'vwap'), 'VWAP stopped drawing').toHaveLength(1)
    expect(byDef.filter(d => d === 'rsi'), 'RSI stopped drawing when VWAP migrated').toHaveLength(1)
    expect(H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi'),
      'two RSI lines on one scale').toHaveLength(1)
  })
})

describe('what pixels cannot see, for VWAP', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  const settings = (over) => ({ ...VWAP_ON, indicatorInstances: [VWAP_INSTANCE], ...over })

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
    // is MACD's, Ctrl+B is BB's. It is ALSO the one chord `matchShortcut` can
    // never deliver — Alt is rejected on its first line so browser Alt shortcuts
    // keep working — so `StockChart`'s own `e.altKey` block is the live handler.
    //
    // 🟡 THE OLD REASON WENT FALSE AT B4 TASK 4, AND THE CLAIM DID NOT. This
    // comment used to end "two declarations, one of them dead": `SHORTCUTS`
    // declared `Alt+U -> toggle:vwap` for a `toggle:` switch that had no
    // `case 'vwap'` to receive it. There is one declaration now
    // (`INDICATOR_CHORDS`), the Alt block READS it for the key, and both entry
    // paths meet at one `toggleIndicatorById`. Asserting the KEY and the WRITE
    // together is still what makes it discoverable if either moves — which is why
    // the case survives the premise that motivated it.
    const persisted = []
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS}
        settingsOverride={legendAlways(settings())} onSettingsPersist={(s) => persisted.push(s)} />,
    )
    expect(bound(), 'nothing drawn to hide — vacuous').toHaveLength(1)

    act(() => { fireEvent.keyDown(document, { altKey: true, code: 'KeyU' }) })

    expect(persisted.length, 'Alt+U persisted nothing — the shortcut is not wired').toBeGreaterThan(0)
    const next = persisted.at(-1)
    // ⭐ THE FIFTH DOOR, ROUTED AT FLIP B. This handler wrote
    // `indicators.vwap.enabled` directly, which was right while that field was
    // the switch. VWAP is flipped now, so the instance is — and a keystroke that
    // only cleared the mirror would leave the line on the chart with the checkbox
    // unticked. `setIndicatorEnabled` writes both.
    expect(next.indicators.vwap.enabled, 'Alt+U did not clear the mirror').toBe(false)
    expect(next.indicatorInstances, 'Alt+U left the instance live — the chart still draws it')
      .toContainEqual({ instanceId: 'legacy:vwap', deleted: true })

    view.unmount(); cleanup(); H.reset()
    render(<StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(next)} />)
    expect(bound(), 'Alt+U left the engine\'s VWAP on the chart').toHaveLength(0)
    expect(vwapLines(), 'Alt+U left a legacy VWAP behind instead').toHaveLength(0)
  })

  it('toggling VWAP OFF and back ON never leaves TWO cyan lines', () => {
    // ⭐ THE SWITCH IS THE INSTANCE NOW (Flip B), so this goes through
    // `setIndicatorEnabled` rather than moving `cs.indicators.vwap.enabled` by
    // hand. A case that keeps writing that field after the flip is measuring a
    // mirror with a green tick.
    const on = settings()
    const off = setIndicatorEnabled(on, 'vwap', false, registry)
    expect(off.indicatorInstances, 'the writer did not tombstone the instance')
      .toContainEqual({ instanceId: 'legacy:vwap', deleted: true })

    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(on)} />,
    )
    expect(H.binderApis[0].bindings()).toHaveLength(1)
    const first = H.binderApis[0].bindings().map(b => b.series)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(off)} />,
    )
    expect(H.binderApis[0].bindings(), 'off: the engine still holds a series').toHaveLength(0)
    for (const s of first) expect(H.removedSeries, 'a VWAP line is still on the chart').toContain(s)
    expect(liveVwapLines(), 'and nothing drew a replacement').toHaveLength(0)

    const backOn = setIndicatorEnabled(off, 'vwap', true, registry)
    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(backOn)} />,
    )
    expect(H.binderApis[0].bindings(), 'toggled back on: the engine draws it again').toHaveLength(1)
    expect(liveVwapLines(), 'toggled back on: TWO cyan lines').toHaveLength(1)
  })

  it('⭐ a STORED instance arriving MID-SESSION replaces the PROJECTED one, not adds to it', () => {
    // ⛔ THE SINGLE MOST-REPEATED DEFECT ON THIS BRANCH, IN THE ONLY SHAPE FLIP B
    // LEAVES — see MACD's twin for the full account. The legacy-block-vs-engine
    // crossover is gone with the block; the reachable one is projection-vs-stored,
    // and for a PRICE overlay a duplicate is two cyan lines on the candles' own
    // scale, which reads as a slightly bolder line and nothing else.
    const projected = { ...VWAP_ON, indicatorInstances: [] }
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(projected)} />,
    )
    const first = H.binderApis[0].bindings()
    expect(first, 'the projection drew nothing — nothing to hand over').toHaveLength(1)
    expect(first[0].key).toContain('legacy:vwap')
    const projectedSeries = first[0].series

    const stored = {
      instanceId: 'grid-cell-3:vwap', defId: 'vwap',
      inputs: { color: '#00ff00', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
      placement: { target: 'price' }, hidden: false,
    }
    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS}
        settingsOverride={legendAlways({ ...projected, indicatorInstances: [stored] })} />,
    )

    const after = H.binderApis[0].bindings()
    expect(after, 'two cyan lines — the projection did not stand down').toHaveLength(1)
    expect(after[0].key, 'the projection won over the stored instance').toContain('grid-cell-3:vwap')
    expect(after[0].series, 'the pool destroyed and recreated the line (#2049)').toBe(projectedSeries)
    expect(H.removedSeries).not.toContain(projectedSeries)
    expect(liveVwapLines('#00ff00').length
      || H.applyOptionsCalls.filter(c => c.options && c.options.color === '#00ff00').length,
    'the stored instance\'s colour never reached the series').toBeGreaterThan(0)
  })

  it('and the reverse — the stored instance LEAVING hands VWAP back to the projection', () => {
    const stored = {
      instanceId: 'grid-cell-3:vwap', defId: 'vwap',
      inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
      placement: { target: 'price' }, hidden: false,
    }
    const withStored = { ...VWAP_ON, indicatorInstances: [stored] }
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(withStored)} />,
    )
    const before = H.binderApis[0].bindings()
    expect(before).toHaveLength(1)
    expect(before[0].key).toContain('grid-cell-3:vwap')

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS}
        settingsOverride={legendAlways({ ...withStored, indicatorInstances: [] })} />,
    )
    const after = H.binderApis[0].bindings()
    expect(after, 'VWAP vanished when the stored instance was removed').toHaveLength(1)
    expect(after[0].key, 'the projection did not take back over').toContain('legacy:vwap')
    expect(liveVwapLines(), 'and exactly one line is on the chart').toHaveLength(1)
  })

  it('a TIMEFRAME change to daily removes the engine\'s line, and back restores it', () => {
    // The gate's own mid-session crossover, and the one no other definition has.
    // A user switching 5m -> D -> 5m must not accumulate lines, and must not lose
    // the indicator when they come back.
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(settings())} />,
    )
    const first = H.binderApis[0].bindings().map(b => b.series)
    expect(first).toHaveLength(1)

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings())} />)
    expect(H.binderApis[0].bindings(), 'the engine kept a session VWAP on daily bars').toHaveLength(0)
    for (const s of first) expect(H.removedSeries, 'the engine\'s line survived the tf change').toContain(s)
    expect(liveVwapLines(), 'the legacy block picked it up on daily bars').toHaveLength(0)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(settings())} />,
    )
    expect(H.binderApis[0].bindings(), 'VWAP never came back on the intraday chart').toHaveLength(1)
    expect(liveVwapLines(), 'and legacy drew a second one alongside it').toHaveLength(1)
  })

  it('a COLOUR change re-styles the SAME series — never destroys and recreates', () => {
    // lightweight-charts#2049.
    const view = render(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(settings())} />,
    )
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(before).toHaveLength(1)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(settings({
        indicatorInstances: [{ ...VWAP_INSTANCE, inputs: { ...VWAP_INSTANCE.inputs, color: '#00ff00' } }],
      }))} />,
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
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(settings())} />,
    )
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(vwapLines('#26C6DA'), 'the full-strength colour is not the base string').toHaveLength(1)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(settings({
        indicatorInstances: [{ ...VWAP_INSTANCE, inputs: { ...VWAP_INSTANCE.inputs, opacity: 40 } }],
      }))} />,
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
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(settings())} />,
    )
    const before = H.binderApis[0].bindings().map(b => b.series)
    expect(vwapLines()[0].options.lineStyle, 'solid is not 0 — the map moved').toBe(0)

    view.rerender(
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(settings({
        indicatorInstances: [{ ...VWAP_INSTANCE, inputs: { ...VWAP_INSTANCE.inputs, lineStyle: 'dashed' } }],
      }))} />,
    )
    const styled = H.applyOptionsCalls.filter(c => c.series === before[0] && c.options && 'lineStyle' in c.options)
    expect(styled.length, 'the series was never re-styled at all').toBeGreaterThan(0)
    expect(styled.at(-1).options.lineStyle, 'the user\'s dashed VWAP renders solid').toBe(2)
  })
})

describe('an engine-drawn VWAP prints ONE chip, and the flip does not change it', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  // 🔴 THIS DESCRIBE READ *"adds NOTHING to the crosshair legend"* and the note
  // under it read *"`plots[0].legend.hide` is the declaration; this is what it
  // has to MEAN"*. Task 2 (`43efeff6`) replaced that declaration with
  // `{ decimals: 2 }`: a dollar line on the candles' own scale had no label at
  // any time, and "read it off the price scale" is not a reason a line should be
  // unnameable.
  //
  // ⛔ THE PARITY EQUALITY IS UNCHANGED — `expect(engine).toBe(legacy)` is still
  // a character-for-character comparison of the two entry points, and it is
  // still the reason this block exists. Only the accompanying ABSENCE claim is
  // inverted, into the exact chip text plus an occurrence count, so the case
  // cannot pass with the chip missing.
  // The LEGACY read remains the control: what the two lanes print has to agree,
  // or a chip present on one side would be indistinguishable from "the readout
  // is broken for price overlays".
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
      <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS} settingsOverride={legendAlways(over)} alwaysShowLegend />,
    )
    const vwap = vwapLines()[0]
    return settledLegend(view, crosshairAt(INTRADAY_BARS, vwap ? [[vwap.series, { value: 101.5 }]] : []))
  }

  it('LEGACY prints the VWAP chip, and the ENGINE prints the same legend', async () => {
    const legacy = await legendOf(VWAP_ON)
    // Non-vacuity FIRST: the legend has to have rendered, or every claim below
    // is a statement about an empty string.
    expect(legacy, 'the legend rendered nothing — the comparison below is vacuous').toMatch(/O\s*1/)
    const engine = await legendOf({ ...VWAP_ON, indicatorInstances: [VWAP_INSTANCE] })
    expect(engine, 'the ENGINE legend rendered nothing').toMatch(/O\s*1/)
    // ⭐ THE DECLARED DIFFERENCE, NAMED — label and precision together. `VWAP`
    // alone would pass with `VWAP 101.5` or `VWAP(4)`; this will not.
    expect(legacy, 'the VWAP chip is gone from the legend').toContain('VWAP 101.50')
    // ⛔ THE EQUALITY, UNTOUCHED. This is the whole flip-parity claim and it is
    // still an equality over the WHOLE legend, not "equal except the chip".
    expect(engine, 'the ENGINE legend is not character-for-character the legacy one').toBe(legacy)
    // …and the value never appears WITHOUT its label — the sharper half of the
    // old claim, kept. One occurrence of `101.5` and one of `101.50` means the
    // only place the number is printed is inside the chip above.
    const count = (hay, needle) => hay.split(needle).length - 1
    expect(count(engine, '101.5'), 'VWAP\'s value is printed somewhere without a label').toBe(1)
    expect(count(engine, '101.50'), 'the chip is printed twice').toBe(1)
  })

  it('and the definition DECLARES that chip — the reason the above holds', () => {
    // 🔴 IT ASSERTED `legend.hide === true`. Task 2 inverted the declaration; the
    // case is inverted with it, and asserted WHOLE so a return to `{ hide: true }`
    // or a precision change both fail.
    const def = registry.getDefinition('vwap')
    expect(def.plots).toHaveLength(1)
    expect(def.plots[0].legend, 'VWAP\'s chip declaration moved').toEqual({ decimals: 2 })
    // No brackets: VWAP's four inputs are colour, opacity, line style and line
    // width, and not one of them changes WHAT IS MEASURED.
    expect(def.meta.legendParams, 'a cosmetic input reached the chip').toBeUndefined()
  })
})

describe('vwapOverride — the enable signal that is not a toggle', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  // The Model Book intraday popup passes `vwapOverride={{color}}`, which FORCES
  // the indicator on regardless of `indicators.vwap.enabled` and forces its
  // colour. No other migrated definition has an enable signal outside its own
  // settings key, and getting it wrong is silent: the popup simply loses its VWAP.
  const withOverride = (settingsOverride, override) => render(
    <StockChart sym="AAPL" tf={VWAP_TF} barsOverride={INTRADAY_BARS}
      settingsOverride={legendAlways(settingsOverride)} vwapOverride={override} />,
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
      indicatorInstances: [],
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
      indicatorInstances: [],
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
      indicatorInstances: [VWAP_INSTANCE],
    }, { color: '#ffffff' })
    const handed = H.syncCalls.at(-1).instances.filter(i => i.defId === 'vwap')
    expect(handed, 'the instance was dropped entirely').toHaveLength(1)
    expect(handed[0].hidden, 'the override did not count as an enable signal').toBe(false)
    expect(H.binderApis[0].bindings(), 'the engine drew nothing under the override').toHaveLength(1)
    expect(vwapLines('#ffffff'), 'the forced white line is missing').toHaveLength(1)
  })

  it('an EXISTING instance is recoloured, not duplicated', () => {
    withOverride({
      ...VWAP_ON, indicatorInstances: [VWAP_INSTANCE],
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
        settingsOverride={legendAlways({ indicatorInstances: [] })} vwapOverride={{ color: '#ffffff' }} />,
    )
    expect(bound()).toHaveLength(0)
    expect(vwapLines('#ffffff')).toHaveLength(0)
  })
})

describe('a VWAP instance survives BOTH settings allow-lists', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  it('mergeChartSettings keeps the instance and the flag through a JSON round-trip', () => {
    // ⚠️ THE TITLE SAYS "the flag" AND IT USED TO ASSERT `merged.engineEnabled`
    // — B5 Task 4 deleted that key, so the allow-list DESTROYS it and the
    // instance is the only engine state left to survive a round-trip. The
    // absence is asserted, not dropped: a resurrected key here would be an
    // undeclared value riding in every stored blob again.
    const merged = mergeChartSettings(JSON.stringify({
      ...VWAP_ON, engineEnabled: true, indicatorInstances: [VWAP_INSTANCE],
    }))
    expect(merged.indicatorInstances).toEqual([VWAP_INSTANCE])
    expect('engineEnabled' in merged).toBe(false)
    // ⭐⭐ B5 TASK 9 MOVED THIS DOWN A LEVEL, AND THE CONTROL IT REPLACES IS THE
    // ONE THIS TASK DESTROYS. It asserted `merged.indicators.vwap.enabled === true`
    // — the legacy MIRROR — as the thing that had to survive the allow-list.
    // `mergeChartSettings` now folds the fourteen legacy sections into
    // `indicatorInstances` and DESTROYS the mirror, so that assertion had no
    // subject left. What still has to survive is the INSTANCE, and what now has
    // to be DESTROYED is the mirror: the allow-list is asserted by what it
    // removes, which is the only spelling a renamed line cannot satisfy.
    expect(merged.indicators.vwap, 'the legacy mirror survived the fold').toBeUndefined()
    expect(Object.keys(merged.indicators)).toEqual(['volumeProfile'])
    // …and the three style keys a narrower allow-list used to drop are on the
    // INSTANCE now, which is where the chart reads them from.
    expect(merged.indicatorInstances[0].inputs)
      .toMatchObject({ opacity: 100, lineStyle: 'solid', lineWidth: 1 })
  })

  it('mergeSettingsOverride patches ONE input without deleting the instance', () => {
    const base = mergeChartSettings(JSON.stringify({
      ...VWAP_ON, indicatorInstances: [VWAP_INSTANCE, RSI_INSTANCE],
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
      ...VWAP_ON, indicatorInstances: [VWAP_INSTANCE],
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

// ─── THE FLIP-B MACHINERY, NOW THAT IT IS LIVE (B3 Task 10) ────────────────
//
// ⭐ THIS SUITE USED TO ASSERT INERTNESS, AND EVERY ONE OF ITS CASES WAS A
// CONTROL WHOSE PREMISE TASK 10 FALSIFIED. Task 9 landed
// `paneMarginsProjection`, `instanceControls` and the gated read-time migrator
// with `ENGINE_OWNED` EMPTY, and proved each way "nothing changed"
// could have been false. `rsi` and `bb` are flipped now, so:
//
//   · "the set is empty"                     → it is exactly {bb, rsi}, still ⊆ migrated
//   · "a legacy toggle alone draws LEGACY"   → it draws the ENGINE's, via the migrator
//   · "the migrator is never RUN"            → it runs, and is the compatibility path
//   · "…for EVERY migrated definition"       → only for the UN-flipped ones
//   · "csForPaneMargins returns `cs` by IDENTITY" → the projection is DELETED; the
//     property that replaced it is that the binder is handed the LAYOUT's own band
//     map and the bands follow the instance list (see the case below, and the
//     paragraph after this one)
//   · "the toolbar still writes the LEGACY section" → it writes the instance AND
//     the mirror
//
// Rewriting them rather than deleting them is the point: each one still names a
// way the machinery could be wrong, in the direction it can now be wrong in.
//
// ⛔⭐⭐ B5 TASK 9 STATED A GAP HERE, AND B5 TASK 12 CLOSED IT BY DELETING BOTH
// SIDES OF IT. The paragraph that stood here described `csPanes`: `computePaneMargins`
// had nine call sites reading `cs.indicators[id].enabled` — a field Task 9 stopped
// mirroring — so every one of them was handed a blob with the instance list
// PROJECTED BACK ONTO IT, and nothing in this tree could kill `csPanes -> cs`. It
// recorded two failed attempts to gate the wiring, and the second is the one worth
// keeping:
//
//   · THE PIXEL GATE COULD NOT SEE IT, STRUCTURALLY. A probe build with the
//     projection removed at all nine sites reported **0 changed pixels** on
//     `rsi_only`, `bb_rsi_macd`, `adx_only` and `engine_three_bands_stacked`,
//     because every parity case injects its settings through `?indicators=`, which
//     `ChartRender` applies with `mergeSettingsOverride` — NOT an allow-list — so
//     the legacy sections survive on that route and do not on a real user's.
//
//   · A COMPONENT PROBE WAS WRITTEN HERE AND DELETED. It recorded every
//     `priceScale().applyOptions` and asserted the candle scale reserved RSI's
//     band. It passed — and it ALSO passed with `_mainMargins` handed a literally
//     EMPTY blob (`{indicators: {}}`), which proves the `{top:0.7,bottom:0.15}`
//     write it was reading did not come from `_mainMargins` at all. A control that
//     survives its own mutation is worse than no control.
//
// ⭐ THE GAP IS GONE BECAUSE THE SECOND COPY IS. `computePaneLayout` reads the
// INSTANCES and returns the band map as `layout.bands`; `_mainMargins` takes the
// LAYOUT and no blob at all; `paneMargins.js` and `paneMarginsProjection.js` are
// deleted. There is no projection to bypass and no wiring left to get wrong — the
// only thing that can still be wrong is whether the binder is handed THAT object,
// which is now an identity comparison one case below can make.

describe('the Flip-B machinery, live (Task 10)', () => {
  it('ENGINE_OWNED is exactly the fourteen migrated ids, and EQUALS the migrated set', () => {
    // Flipped-but-not-migrated means the legacy block was deleted and nothing
    // replaced it — an indicator that renders nothing at all.
    // ⭐ `stoch` and `atr` joined at B5 Task 5, `sar` and `ichimoku` at Task 6,
    // `mfi`, `cci` and `williamsR` at Task 7, and `adx`, `obv` and `donchian` at
    // Task 8 — each group in one commit with its migration. ⚠️ THE TITLE NO
    // LONGER SPELLS THE SET OUT: eight ids fitted in a test name and fourteen do
    // not, and a title that lists a stale eight while the body asserts fourteen
    // is the control-rot shape this branch keeps finding. It names the COUNT, and
    // the count is now `listDefinitions().length` — every series-expressible
    // definition there is.
    // ⭐ SIXTEEN AT PHASE C TASK 14: `avwap` and `atrBands` are the first
    // definitions that were never a legacy block, so the set grew without a flip.
    // ⭐ SEVENTEEN AT PHASE C TASK 13: `rsLine` is the first `compute.kind:
    // 'server'` definition, so the set grew again with no flip and no block.
    expect([...ENGINE_OWNED].sort()).toEqual(
      ['adx', 'atr', 'atrBands', 'avwap', 'bb', 'cci', 'donchian', 'ichimoku', 'macd',
        'mfi', 'obv', 'rsLine', 'rsi', 'sar', 'stoch', 'vwap', 'williamsR'])
    for (const id of ENGINE_OWNED) expect(ENGINE_OWNED.has(id), id).toBe(true)
  })

  it('a legacy toggle alone draws the ENGINE\'s series — the read-time migrator', () => {
    // ⭐ THE COMPATIBILITY CASE, AND THE ONE EVERY EXISTING USER IS IN. A blob
    // with `indicators.rsi.enabled` and no instance anywhere still renders: the
    // migrator projects it, the engine draws it, and there is exactly one line.
    //
    // ⭐ BANDS, PINNED (B5 Task 12) — and only this case in the suite, because only
    // this one counts lines by the DEFINITION-NAMED price scale. See `pinBandsMode`
    // for why that locator stopped answering under `'panes'`; the sibling cases
    // read the binder's own holdings and the band map, both of which the layout
    // produces in either mode.
    __setPaneModeForTest('bands')
    try {
      draw({ indicators: { rsi: { enabled: true } } })
      expect(H.binderApis[0].bindings(), 'the migrator did not project the toggle').toHaveLength(1)
      expect(H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi'),
        'two RSI lines — the deleted block came back').toHaveLength(1)
    } finally { __setPaneModeForTest(null) }
  })

  it('…and the read-time migrator RUNS — the gate is open, not just its effect', () => {
    // The mirror of Task 9's case, which asserted this was 0. A gate only ever
    // asserted in ONE state can be welded shut and stay green, so both states are
    // pinned: this file asserts > 0 with ids flipped, and the un-flipped
    // definitions below assert the per-DEFINITION filter still holds them back.
    draw({ indicators: { rsi: { enabled: true } } })
    expect(H.migrateCalls, 'the read-time migrator never ran').toBeGreaterThan(0)
  })

  it('…and a legacy toggle alone reaches EVERY flipped definition, on its own timeframe', () => {
    // ⚠️ THIS CASE WAS INVERTED BY TASK 11, AND THE INVERSION IS THE POINT. It
    // read "…and it holds back every UN-FLIPPED migrated definition", looping the
    // migrated ids that were NOT flipped and asserting the engine got nothing —
    // the per-definition gate that stopped the first flip moving all four pilots.
    // There is no un-flipped migrated id left, so that loop would iterate zero
    // times and pass for free. Its companion non-vacuity case (which asserted an
    // un-flipped id EXISTS) has moved to `flipB.test.jsx`, where it now asserts
    // the opposite — that the sets are EQUAL — because that equality is what
    // Task 11's three deletions rest on.
    //
    // The loop itself is kept, pointed the other way: every flipped definition,
    // from a legacy toggle alone, on the timeframe it lives on. It is the same
    // structural claim (the migrator is per definition, not per set) asserted in
    // the direction that is now reachable, and it grows with the set.
    // ⛔ NATIVES ONLY — see the SERVER_LANE note in the drawn-once block. A
    // fetched column cannot arrive inside a synchronous render test, and a rail
    // that demanded one would be measuring jsdom's network, not the migrator.
    const serverLane = registry.listDefinitions()
      .filter(d => d.compute.kind === 'server').map(d => d.id)
    expect(serverLane, 'the server-lane exclusion selects nothing — it is inert')
      .toEqual(['rsLine'])
    let seen = 0
    for (const defId of [...ENGINE_OWNED].filter(id => !serverLane.includes(id))) {
      cleanup(); H.reset()
      draw({ indicators: { [defId]: { enabled: true } } }, tfFor(defId))
      const bound = H.binderApis[0].bindings().filter(b => b.defId === defId)
      expect(bound.length, `${defId} drew nothing from a legacy toggle — with no legacy `
        + 'block left, that is the indicator deleted for every existing user').toBeGreaterThan(0)
      seen += 1
    }
    // ⚠️ A LITERAL, NOT `ENGINE_OWNED.size`. Comparing the loop's own
    // counter to the set it iterated is a tautology that survives the set being
    // emptied; the number is what makes "the flipped set is empty" a failure.
    // It moves once per B5 migration task — 4 → 6 at Task 5, 6 → 8 at Task 6,
    // 8 → 11 at Task 7, 11 → 14 at Task 8 — where it stops, because fourteen is
    // every series-expressible definition there is.
    // ⭐ 14 → 16 at Phase C Task 14, and NOT because a fifteenth block was migrated:
    // `avwap` and `atrBands` are the first definitions that never had one.
    // ⭐ STILL 16 AT PHASE C TASK 13, AND THAT IS THE POINT: the registry grew to
    // seventeen and this number did NOT, because the seventeenth is on the server
    // lane and has no legacy toggle to be reached from.
    //
    // ⭐ PHASE D TASK 8 — THE LITERAL BECOMES `REGISTRY_SIZES.native`, AND THE
    // WARNING ABOVE STILL HOLDS. The objection was to `ENGINE_OWNED.size`: that
    // IS the set the loop iterated, so comparing the counter to it is a tautology
    // that survives the set being emptied. `REGISTRY_SIZES.native` is not that —
    // it is the length of a HAND-WRITTEN manifest in `registrySizes.js` that the
    // registry has to prove it matches, one file over. So "the set went empty"
    // still fails, "a native slipped into the exclusion" still fails, and the
    // number now also SAYS WHY it is sixteen: this loop draws from a legacy
    // toggle, and the native lane is exactly the set of definitions that have
    // one. A third-lane definition would break it, correctly — somebody has to
    // decide what a legacy toggle means for a user's own formula.
    expect(seen, 'the flipped set is empty — this loop proves nothing').toBe(REGISTRY_SIZES.native)
  })

  it('the binder is handed the LAYOUT\'S OWN band map, and the bands follow the INSTANCE LIST', () => {
    // ⭐ RE-POINTED AT B5 TASK 12, BECAUSE ITS SUBJECT RETIRED. This case read
    // "csForPaneMargins changes ONE FIELD and carries the rest of the blob
    // through" — the projection that rewrote `cs.indicators[id].enabled` from the
    // instance list so that `computePaneMargins`, which read that field, kept
    // reserving the right bands after Task 9 deleted the mirror. Both the
    // projection and `computePaneMargins` are gone: `computePaneLayout` reads the
    // INSTANCES directly and returns the band map as `layout.bands`.
    //
    // ⛔ SO THE CLAIM THAT DIED IS "the projection rewrites exactly one field",
    // and the one that survives it is what the projection existed to guarantee —
    // the bands the binder resolves placement against follow the instance list,
    // and they are the LAYOUT'S OWN map rather than a second computation that
    // could disagree with the panes the same layout builds. That identity is the
    // structural version of the whole retirement: two copies cannot drift if
    // there is one object.
    draw({ indicators: { rsi: { enabled: true } }, indicatorInstances: [RSI_INSTANCE] })
    const ctx = H.syncCalls.at(-1)
    expect(ctx, 'no sync happened — every assertion below would be vacuous').toBeTruthy()
    expect(ctx.paneMargins, 'the binder was handed a band map the layout does not own — '
      + 'a second copy of the geometry is exactly what Task 12 retired').toBe(ctx.paneLayout.bands)
    // The band itself, pinned — presence alone would survive a re-quantised stack.
    expect(ctx.paneMargins.rsi, 'the live instance reserved no band').toEqual({ top: 0.85, bottom: 0 })

    // …and the SAME chart minus that instance reserves nothing for it. BB_CONTROL
    // keeps a live binder (and therefore a real margins object) without reserving
    // a band of its own — see the note on `bound()`.
    cleanup(); H.reset()
    draw({ indicators: { ...BB_CONTROL } })
    const bare = H.syncCalls.at(-1)
    expect(bare, 'the control chart never synced — the claim below would be vacuous').toBeTruthy()
    expect(bare.paneMargins.volume, 'the margins object is empty — so is the claim below').toBeTruthy()
    expect(bare.paneMargins.rsi,
      'a band was reserved for an indicator no instance names').toBeUndefined()
  })

  it('…and a legacy toggle ALONE reserves it — through the migrator, on a chart with no instances', () => {
    // ⭐ RE-POINTED AT TASK 12 TOO. It read "…and it is called on a flag-off chart
    // too" — `it` being the projection, which sat on the paint path of EVERY
    // chart. That reader is gone with the module. What is still true, and is the
    // half that matters to an existing user, is that a blob holding nothing but
    // the legacy toggle both DRAWS the engine's RSI and reserves its band: the
    // read-time migrator projects the instance, and the layout reads the projected
    // list, so the two halves cannot disagree.
    draw({ indicators: { rsi: { enabled: true } } })
    expect(H.binderApis[0].bindings(), 'a legacy-toggle-only chart drew no RSI at all').toHaveLength(1)
    expect(H.syncCalls.at(-1).paneMargins.rsi,
      'the migrated instance reserved no band — the line would land on the volume bars')
      .toEqual({ top: 0.85, bottom: 0 })
  })

  it('the keyboard writes the INSTANCE and the MIRROR, in one blob', () => {
    // Task 9's version asserted the opposite — that no `indicatorInstances` key
    // appeared — because nothing had a writer yet. Both halves matter: the
    // instance is what the chart reads, and the mirror is what the alert
    // evaluator, the alert popover, the screener and the `?indicators=` route
    // read, none of which knows instances exist.
    const persisted = []
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ indicators: { rsi: { enabled: true } } })}
        onSettingsPersist={(s) => persisted.push(s)} />,
    )
    act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'i' }) })
    expect(persisted.length, 'Ctrl+I persisted nothing — this case is vacuous').toBeGreaterThan(0)
    const last = persisted.at(-1)
    expect(last.indicators.rsi.enabled, 'the mirror was not written').toBe(false)
    expect(last.indicatorInstances, 'no instance was written — the chart would still draw it')
      .toContainEqual({ instanceId: 'legacy:rsi', deleted: true })
    view.unmount()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ─── TASK 3: THE TWO RIGHT-CLICK DOORS, DERIVED (B4) ──────────────────────
//
// `IND_OPTS` and `OSC_OPTS` were hand-written pair lists inside
// `buildRegionSections`, and the region title read a third table that lived in
// `chartRegion.js` — a pure-geometry module whose whole point is not knowing
// what an indicator is. All three now read `indicatorCatalog.js`.
//
// ⭐ THE MEASURED COST OF THE HAND-WRITTEN LIST IS 8 → 15. `sar`, `ichimoku`,
// `mfi`, `cci`, `williamsR` and `donchian` each had a settings section, a
// toolbar row AND a definition; `volumeProfile` has a section and a row and is
// the CARVED-OUT one (no definition — it draws to a sibling canvas). All seven
// had no way into the menu a user actually right-clicks. That is not a refactor
// artefact; it is the defect, and `volumeProfile` is exactly the row a
// definitions-only list drops (B3 Task 11's refusal).
describe('B4 Task 3 — the right-click doors read the catalog', () => {
  it('the Indicators submenu offers every settings section, not a hand-picked eight', () => {
    const view = renderChart({ settings: mergeChartSettings(null) })
    const items = submenuOf(sectionOf(openContextMenu(view, { region: 'price' }), 'region'), 'indicators')
    // ⭐ SEVENTEEN (16 definitions + the carved-out volumeProfile), not eight —
    // asserted as a NUMBER as well as a list, because `toEqual` against a derived
    // list would still pass if BOTH sides collapsed. It was fifteen until Phase C
    // Task 14 added `avwap` and `atrBands`, and this line moving IS the proof that
    // a new definition reaches the right-click menu with no edit to the menu.
    // ⭐ EIGHTEEN AT PHASE C TASK 13 — `rsLine` reaches the right-click menu with
    // no edit to the menu, on the SERVER lane, which is the same proof one lane
    // further out.
    expect(items).toHaveLength(18)
    expect(items).toHaveLength(catalogRows().length)
    expect(items.map(i => i.id)).toEqual(catalogRows().map(r => 'ind-' + r.id))
    expect(items.map(i => i.label)).toEqual(catalogRows().map(r => r.shortName))
    // …and the A7 diff, spelled out where a reviewer sees it.
    expect(items.find(i => i.id === 'ind-bb').label).toBe('BB')
    expect(items.find(i => i.id === 'ind-stoch').label).toBe('Stoch')
    // …and the row a definitions-only list would have dropped (B3 Task 11's refusal).
    expect(items.find(i => i.id === 'ind-volumeProfile')).toBeTruthy()
  })

  it('⭐ …and its entries READ and WRITE through the one reader and the one writer', () => {
    // ⛔ THE PREMISE `flipB.test.jsx` GATED STRUCTURALLY, NOW DRIVEN. That file
    // said this door "is only reachable through a real contextmenu on a canvas
    // region the jsdom double cannot produce". It is reachable; its three source
    // rails stay as a backstop and this is the behaviour they stood for.
    // ⚠️ THE UN-FLIPPED HALF IS A MOVING SUBJECT. It was `stoch` until B5 Task 5
    // flipped Stochastic, at which point the `false` expectation below went RED —
    // which is the whole reason the pair is spelled with its answer beside it
    // rather than derived from `ENGINE_OWNED` (a derived expectation
    // agrees with the code by construction and can never catch this).
    // ⚠️ AND IT MOVED AGAIN AT B5 TASK 7 (`mfi` → `adx`) — AND THEN RAN OUT AT
    // TASK 8, which flipped the last three. The pair was FLIPPED vs UN-FLIPPED
    // and the un-flipped side has no member; it moves DOWN A LEVEL to the pair
    // that is still real and still asymmetric: a definition the engine owns
    // (`rsi`), and the CARVED-OUT key it does not (`volumeProfile`, which has no
    // definition at all, so `setIndicatorEnabled` can only move its mirror).
    // Both must toggle off through the menu; only the first may write an instance.
    expect(registry.getDefinition('volumeProfile'),
      'volumeProfile gained a definition — this pair needs re-reading').toBeNull()
    for (const [id, flipped] of [['rsi', true], ['volumeProfile', false]]) {
      cleanup(); H.reset()
      const view = renderChart({ settings: mergeChartSettings({ indicators: { [id]: { enabled: true } } }) })
      const items = submenuOf(sectionOf(openContextMenu(view, { region: 'price' }), 'region'), 'indicators')
      const entry = items.find(i => i.id === 'ind-' + id)
      expect(entry.checked, `${id} is ON and the menu says otherwise`).toBe(true)
      act(() => { entry.onSelect() })
      const next = view.lastSettings()
      expect(isIndicatorEnabled(next, id, ENGINE_OWNED), id).toBe(false)
      expect(next.indicators[id].enabled, `${id} mirror`).toBe(false)
      // …and a FLIPPED id really did move the instance, which is the half a
      // mirror-only write would have passed.
      expect((next.indicatorInstances || []).some(i => i.instanceId === `legacy:${id}` && i.deleted),
        `${id} instance`).toBe(flipped)
    }
  })

  it('the volume-overlay submenu offers exactly the pane oscillators that are ON', () => {
    const cs = mergeChartSettings({
      volume: { visible: true },
      indicators: { rsi: { enabled: true }, bb: { enabled: true } },
    })
    const view = renderChart({ settings: cs })
    const sub = submenuOf(sectionOf(openContextMenu(view, { region: 'volume' }), 'region'), 'voloverlay')
    // bb is ON and is a PRICE overlay: it shares the candles' scale and cannot be
    // moved into the volume pane. Deriving from `placement.target` is what keeps
    // that true without a second list saying so.
    expect(sub.map(i => i.id)).toEqual(['vo-rsi'])
    expect(oscillatorIds(), 'bb is not an oscillator, so it can never appear above')
      .not.toContain('bb')
  })

  it('right-click Hide names the indicator the way every other menu does', () => {
    // ⭐ B5 TASK 12 — `H.paneModel`, NOT A MODE PIN. This case is about the DOOR,
    // not the geometry, so it runs in the SHIPPED mode: under `'panes'` an
    // indicator region is a real lightweight-charts pane rectangle read off the
    // renderer, and the double answers `panes()` with one 300 px pane unless a case
    // opts into the model Task 10 built for exactly this. Without it `openContextMenu`
    // scans the whole plot, resolves no indicator region and throws by name.
    H.paneModel = { stackPx: PLOT.height - 40 }   // minus the double's time axis
    const view = renderChart({
      settings: mergeChartSettings({ indicators: { williamsR: { enabled: true } } }),
    })
    const sec = sectionOf(openContextMenu(view, { region: 'indicator', key: 'williamsR' }), 'region')
    // A7: 'Williams %R' -> '%R'. One label, four surfaces, one source.
    expect(sec.title).toBe('%R')
    expect(sec.items[0].label).toBe('Hide %R')
    expect(labelFor('williamsR'), 'the label is the catalog\'s, not a coincidence').toBe('%R')
  })

  it('and Hide routes at the ONE writer, for a flipped id and an un-flipped one alike', () => {
    // ⚠️ BOTH ids, deliberately. A flipped id's writer moves the mirror anyway,
    // so a loop that only ran `rsi` would pass for the wrong reason — B3 measured
    // that a predicate no row consults cannot be caught lying about that row.
    for (const id of ['rsi', 'stoch']) {
      cleanup(); H.reset()
      // ⭐ B5 TASK 12 — INSIDE the loop, because `H.reset()` clears it. Same reason
      // as the case above: under the shipped `'panes'` mode an indicator region is
      // a real pane rectangle, so the double needs a pane model to have one.
      H.paneModel = { stackPx: PLOT.height - 40 }
      const cs = mergeChartSettings({ indicators: { [id]: { enabled: true } } })
      const view = renderChart({ settings: cs })
      const sec = sectionOf(openContextMenu(view, { region: 'indicator', key: id }), 'region')
      expect(sec.items[0].id, id).toBe('i-hide')
      act(() => { sec.items[0].onSelect() })
      const next = view.lastSettings()
      expect(isIndicatorEnabled(next, id, ENGINE_OWNED), id).toBe(false)
      // The MIRROR is what an un-flipped id's legacy block reads. Both, always.
      expect(next.indicators[id].enabled, `${id} mirror`).toBe(false)
      // ⛔ AND THE INSTANCE, WHICH IS THE HALF A RAW `setCs` PASSES. With no
      // stored instance, `isIndicatorEnabled` falls back to the mirror — so a
      // `setCs('indicators.rsi.enabled', false)` reads "off" on both assertions
      // above and still leaves a FLIPPED id's projection drawing on the next
      // paint. The tombstone is what actually turns it off, and it is only
      // expected for a flipped id: an un-flipped one has a legacy block to read
      // the mirror, so writing an instance for it would be the opposite defect.
      expect((next.indicatorInstances || []).some(i => i.instanceId === `legacy:${id}` && i.deleted),
        `${id} tombstone`).toBe(ENGINE_OWNED.has(id))
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ─── TASK 4: FOUR CHORDS, ONE TABLE, ONE DISPATCH (B4) ────────────────────
//
// `Ctrl+I` rsi · `Ctrl+O` macd · `Ctrl+B` bb · `Alt+U` vwap — four keys that
// lived in FOUR regions across TWO files: the `SHORTCUTS` help sheet and
// `matchShortcut`'s Ctrl branch declared them, and StockChart's `toggle:` switch
// and its `e.altKey` block consumed them. `matchShortcut` REJECTS Alt, so
// `toggle:vwap` never reached the switch and the Alt block was Alt+U's only
// handler — which is how the fourth chord went uncounted three times running.
//
// `INDICATOR_CHORDS` declares all four; the help sheet and the Ctrl map are
// generated from it; and ONE `toggleIndicatorById` consumes it on both paths.
describe('B4 Task 4 — one dispatch serves every indicator chord', () => {
  /** The KeyboardEvent init a chord's real modifier produces. The Ctrl path is
   *  matched on `event.key` by `matchShortcut`; the Alt path is matched on
   *  `event.code` by StockChart (layout independence — Mac emits special
   *  characters with Alt held). Both are supplied so neither path is being fed a
   *  shape the browser would not send. */
  const chordEvent = (c) => {
    const key = c.code.slice(3).toLowerCase()
    return c.modifier === 'alt'
      ? { altKey: true, code: c.code, key }
      : { ctrlKey: true, code: c.code, key }
  }

  const paint = (settings, tf) => {
    cleanup(); H.reset()
    render(<StockChart sym="AAPL" tf={tf} barsOverride={barsFor(tf)} settingsOverride={legendAlways(settings)} />)
    return H.binderApis[0] ? H.binderApis[0].bindings() : []
  }

  it('one dispatch serves every indicator chord, Ctrl and Alt alike', () => {
    for (const c of INDICATOR_CHORDS) {
      cleanup(); H.reset()
      const tf = tfFor(c.defId)
      const off = mergeChartSettings({ indicators: { [c.defId]: { enabled: false } } })
      expect(isIndicatorEnabled(off, c.defId, ENGINE_OWNED), `${c.keys} did not start OFF`)
        .toBe(false)
      const view = renderChart({ settings: off, tf })

      act(() => { fireEvent.keyDown(document, chordEvent(c)) })

      const next = view.lastSettings()
      expect(isIndicatorEnabled(next, c.defId, ENGINE_OWNED), c.keys).toBe(true)
      expect(next.indicators[c.defId].enabled, `${c.keys} mirror`).toBe(true)
      // ⛔ THE HALF A RAW BLOB WRITE PASSES. With no stored instance,
      // `isIndicatorEnabled` falls back to the mirror — so `{...cs, indicators:
      // {...}}` answers "on" on BOTH assertions above while the engine, which is
      // the authority for all four of these definitions, still holds nothing.
      expect((next.indicatorInstances || []).some(i => i && i.defId === c.defId && !i.deleted),
        `${c.keys} wrote no instance — the chart draws from the INSTANCE for all four`).toBe(true)

      // #2049: repaint from what the keystroke wrote and compare against a chart
      // born with the indicator on. One copy, never two.
      view.unmount()
      const after = paint(next, tf).filter(b => b.defId === c.defId).length
      const control = paint(setIndicatorEnabled(off, c.defId, true, registry), tf)
        .filter(b => b.defId === c.defId).length
      expect(control, `${c.keys} control drew nothing — the comparison is vacuous`).toBeGreaterThan(0)
      expect(after, `${c.keys} series count`).toBe(control)
    }
  })

  it('a chord for a definition with no legacy block still toggles the instance', () => {
    // ⭐ `vwap` is FLIPPED — its hand-written render block is DELETED, so there is
    // no `cs.indicators.vwap.enabled` reader left. The write has to reach the
    // INSTANCE or Alt+U does nothing at all, which is the defect B3 Task 11 found
    // in the shipped Alt block. Driven from a BARE default blob (no `indicators`
    // key supplied) so nothing in the fixture pre-seeds the answer.
    const chord = INDICATOR_CHORDS.find(c => c.defId === 'vwap')
    expect(chord, 'no ALT chord in the table — this case is asserting on nothing').toBeTruthy()
    expect(chord.modifier, 'vwap stopped being the Alt chord').toBe('alt')
    const view = renderChart({ settings: mergeChartSettings(null), tf: tfFor('vwap') })

    act(() => { fireEvent.keyDown(document, chordEvent(chord)) })

    const next = view.lastSettings()
    expect((next.indicatorInstances || []).some(i => i && i.defId === 'vwap' && !i.deleted),
      'Alt+U wrote no VWAP instance — the keystroke ticked a box over a chart that disagrees').toBe(true)
    expect(next.indicators.vwap.enabled, 'Alt+U did not write the mirror').toBe(true)
  })

  it('Alt+I still inverts the price scale, because the Alt lookup is scoped by MODIFIER', () => {
    // ⛔ RSI's chord CODE IS ALSO `KeyI`. An Alt lookup matching on `code` alone
    // (`INDICATOR_CHORDS.find(c => c.code === e.code)`) answers for RSI here,
    // toggles it, returns — and the invert branch below it is never reached. The
    // `modifier === 'alt'` clause is the only thing standing between the two.
    const view = renderChart({ settings: mergeChartSettings(null) })

    act(() => { fireEvent.keyDown(document, { altKey: true, code: 'KeyI' }) })

    const next = view.lastSettings()
    expect(next.invertScale, 'Alt+I stopped inverting the price scale').toBe(true)
    expect(isIndicatorEnabled(next, 'rsi', ENGINE_OWNED), 'Alt+I toggled RSI').toBe(false)
    expect((next.indicatorInstances || []).filter(i => i && i.defId === 'rsi'),
      'Alt+I wrote an RSI instance').toEqual([])
  })

  it('the pre-switch chord lookup does not swallow the toggles that are NOT indicators', () => {
    // `Ctrl+M` toggles the four MA overlay slots and `Ctrl+V` the volume pane.
    // Neither is a definition, so both stay `switch` cases — a lookup that
    // answered for them would route them at `setIndicatorEnabled`, which refuses
    // an unknown id and returns `cs` UNCHANGED, so the keystroke would do nothing
    // and `lastSettings()` would throw rather than read as a pass.
    const base = mergeChartSettings(null)
    const view = renderChart({ settings: base })
    // Direction-agnostic: the shipped defaults already enable some MA slots, so
    // `Ctrl+M`'s "if any are on, turn them all off" is a turn-OFF here. What must
    // hold is that the keystroke MOVED the overlays, not which way it moved them.
    const anyOn = (s) => s.overlays.some(o => o && o.enabled)
    expect(base.overlays.length, 'no MA overlay slots — vacuous').toBeGreaterThan(0)

    act(() => { fireEvent.keyDown(document, { ctrlKey: true, code: 'KeyM', key: 'm' }) })
    const afterMa = view.lastSettings()
    expect(anyOn(afterMa), 'Ctrl+M did not move the MA overlays').toBe(!anyOn(base))

    act(() => { fireEvent.keyDown(document, { ctrlKey: true, code: 'KeyV', key: 'v' }) })
    const afterVol = view.lastSettings()
    expect(afterVol.volume.visible, 'Ctrl+V did not toggle the volume pane')
      .toBe(!afterMa.volume.visible)
  })
})

// ─── B4 TASK 5 — THE SHARE LINK CARRIES EVERY DEFINITION ────────────────────
//
// ⛔ THE DEFECT THIS REPLACES, RECORDED BY B3's TASK 2 REVIEW. `handleCopyShareUrl`
// hand-listed exactly `rsi`, `macd`, `bb`, `vwap` — the four B3 pilots — so "Copy
// chart link" SILENTLY DROPPED every other indicator. A recipient of a link
// shared from a chart with Stochastic and ATR on got a chart with neither, and
// nothing anywhere said so.
//
// ⚠️ THE PIXEL GATE CANNOT SEE ANY OF THIS. The parity route never builds a share
// URL, mounts no toolbar and clicks nothing; its 0 is a regression check on
// StockChart's `useCallback` graph and evidence of NOTHING about this door.
describe('B4 Task 5 — the share link is derived, not a hand-list of the pilots', () => {
  /** The decoded `state` blob a recipient's chart would apply. */
  const sharedState = (url) => urlToChartState(new URL(url).searchParams.get('state'))

  it('the share link carries every indicator that is on, not the four pilots', async () => {
    const cs = mergeChartSettings({
      indicators: { rsi: { enabled: true }, stoch: { enabled: true }, atr: { enabled: true } },
    })
    const view = renderChart({ settings: cs })
    const state = sharedState(await view.copyShareUrl())

    // ⭐ THE DEFECT: `stoch` and `atr` were simply ABSENT from the encoded blob, so
    // the recipient's chart drew neither and nothing said so.
    expect(Object.keys(state.indicators).sort(),
      'the encoded indicator set is not the catalog — a section the link cannot carry is a ' +
      'section the recipient silently loses').toEqual(catalogRows().map(r => r.id).sort())
    expect(state.indicators.stoch.enabled, 'Stochastic did not survive the link').toBe(true)
    expect(state.indicators.atr.enabled, 'ATR did not survive the link').toBe(true)
    // …and the derivation did not turn everything on: an OFF section still reads off.
    expect(state.indicators.macd.enabled).toBe(false)
    // ⛔ NON-VACUITY, AND IT IS THE WHOLE POINT OF `catalogRows()` OVER THE
    // DEFINITIONS. `volumeProfile` is a carved-out CANVAS overlay with no engine
    // definition; a list built from `listDefinitions()` alone drops it, which is
    // the exact regression B3 Task 11 refused.
    expect(state.indicators.volumeProfile, 'the carved-out canvas overlay fell out of the link')
      .toBeTruthy()
    expect(Object.keys(state.indicators).length).toBeGreaterThan(4)
  })

  it('and it answers through the ONE reader, so a tombstoned flipped id reads off', async () => {
    // The legacy mirror still says `enabled: true` after a hand-corruption; only
    // `isIndicatorEnabled` knows the INSTANCE wins for a flipped id. Reading the
    // raw flag here would put a deleted RSI back on the recipient's chart.
    const off = setIndicatorEnabled(
      mergeChartSettings({ indicators: { rsi: { enabled: true } } }), 'rsi', false, registry)
    expect(off.indicators.rsi.enabled, 'control: the mirror moved with the instance').toBe(false)
    // ⚠️ A TOMBSTONE IS `{instanceId, deleted:true}` AND CARRIES NO `defId`
    // (`chartDefaults.instanceTombstone`), so it is found by its instance id.
    expect(off.indicatorInstances.some(i => i && i.instanceId === 'legacy:rsi' && i.deleted === true),
      'control: no tombstone was written — this case has nothing to disagree with').toBe(true)

    // …a blob where the mirror DISAGREES with the tombstone. For a FLIPPED id the
    // instance is the authority, and this is the only shape that can tell the two
    // readers apart.
    const corrupt = { ...off, indicators: { ...off.indicators, rsi: { ...off.indicators.rsi, enabled: true } } }
    expect(isIndicatorEnabled(corrupt, 'rsi', ENGINE_OWNED),
      'the reader itself disagrees with this case — the fixture is wrong, not the code').toBe(false)

    const view = renderChart({ settings: corrupt })
    const state = sharedState(await view.copyShareUrl())
    expect(state.indicators.rsi.enabled,
      'the link read the raw mirror — a deleted RSI comes back on the recipient\'s chart').toBe(false)
  })

  it('carries the instances verbatim, so a shared engine chart stays one', async () => {
    const cs = setIndicatorEnabled(mergeChartSettings(null), 'bb', true, registry)
    expect(cs.indicatorInstances.length, 'no instance to carry — vacuous').toBeGreaterThan(0)
    const view = renderChart({ settings: cs })
    const state = sharedState(await view.copyShareUrl())
    expect(state.indicatorInstances, 'the sender\'s instances did not reach the link')
      .toEqual(cs.indicatorInstances)
    // ⭐ AND IT CARRIES NO FLAG (B5 Task 4). This asserted
    // `state.engineEnabled === (cs.engineEnabled === true)`; the key is deleted, so
    // emitting it would put an undeclared value in every shared URL that
    // `mergeChartSettings` destroys on arrival anyway.
    expect('engineEnabled' in state, 'the share link still carries the deleted flag').toBe(false)
    // …and the four keys this task did NOT touch are still there.
    expect(state.sym).toBe('AAPL')
    expect(state.tf).toBe('D')
    expect(state.comparisonSymbols).toEqual(cs.comparisonSymbols || [])
    expect(state.markers).toEqual(cs.markers || {})
  })
})

// ─── B4 TASK 12 — THE EIGHTH DOOR, AND THE TWO WAYS INTO IT ─────────────────
//
// ⭐ THE LIBRARY HAS THREE ENTRY POINTS (spec §6) AND ONLY ONE OF THEM WAS
// GATED. Task 7 shipped the dialog and its labelled toolbar button, and
// `ChartToolbar.indicatorLibrary.test.jsx` covers that button and the imperative
// handle in both directions. The other two — `Alt+Shift+A` and the right-click
// **Add indicator…** row — live in `StockChart`, and neither had a test: the
// chord was wired by hand after Task 7 handed it back, and the menu row was
// flagged NOT DONE. This block is both of them.
//
// ⛔ NEITHER IS A CONTROL DOOR, AND THAT IS THE CLAIM. They call
// `toolbarRef.current.openIndicatorLibrary()` — the same imperative handle the
// toolbar's own button drives — so the census in `controlDoorCensus.test.js`
// still finds `setIndicatorEnabled` at exactly four call sites. A row that
// opened the dialog by writing `cs.indicators.<id>` itself would be door eight,
// and the census is what says so.
//
// ⛔ ORDER IS THE CONTRACT ON BOTH. Ask the library FIRST; fall through to the
// settings surface ONLY on a non-`true` answer. `openIndicatorLibrary` returns
// `false` on a read-only mount (it checks the same `chartSettings &&
// onUpdateSettings` pair the button does) and `toolbarRef.current` is null when
// no toolbar mounted at all — the two ways the door can be absent. Swapping the
// order opens a settings panel on top of a chart that has a library.
//
// ⚠️ THE PIXEL GATE CANNOT SEE ONE LINE OF THIS. The parity route presses no
// key, mounts no toolbar and has no cursor, so a total regression of both entry
// points reports 0 changed pixels.
describe('B4 Task 12 — Alt+Shift+A and right-click both reach the ONE library', () => {
  /** The dialog's own search box — `Sheet` portals into `document.body`, so this
   *  is queried on the document rather than on the render container. */
  const libraryOpen = () => !!document.body.querySelector('[aria-label="Search indicators"]')

  /** Press the chord and hand back the EVENT, so `defaultPrevented` is readable.
   *  `fireEvent` collapses that into a boolean return nobody reads by accident. */
  const pressAddIndicator = () => {
    const ev = new KeyboardEvent('keydown', {
      altKey: true, shiftKey: true, code: 'KeyA', key: 'A', bubbles: true, cancelable: true,
    })
    act(() => { document.dispatchEvent(ev) })
    return ev
  }

  it('the chord opens the LIBRARY, and does not also open the settings panel', () => {
    const onOpenSettings = vi.fn()
    renderChart({ settings: mergeChartSettings(null), onOpenSettings })
    expect(libraryOpen(), 'the library was already open — this case cannot fail').toBe(false)

    const ev = pressAddIndicator()

    expect(libraryOpen(), 'Alt+Shift+A did not open the indicator library').toBe(true)
    // ⭐ THE ORDER, ASSERTED. `onOpenSettings` is what this chord used to call —
    // unconditionally — so a build that kept the old branch, or that ran BOTH,
    // passes the line above and fails here.
    expect(onOpenSettings,
      'the settings panel opened too — the fall-through fired on a mount that HAS a library')
      .not.toHaveBeenCalled()
    expect(ev.defaultPrevented, 'a handled chord must be consumed').toBe(true)
  })

  it('⛔ on a READ-ONLY mount it falls through to the settings surface — once', () => {
    // No drawing tools ⇒ no `ChartToolbar` ⇒ no library. This is the mount shape
    // Model Book and the multi-chart grid cells use.
    const onOpenSettings = vi.fn()
    renderChart({ settings: mergeChartSettings(null), showDrawingTools: false, onOpenSettings })

    const ev = pressAddIndicator()

    expect(libraryOpen(), 'a chart with no toolbar sprouted an add-dialog').toBe(false)
    expect(onOpenSettings, 'the chord did nothing at all on a read-only mount')
      .toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('⛔ and when NEITHER door exists the chord is not swallowed', () => {
    // ⚠️ THE FAILURE MODE THIS GUARDS IS INVISIBLE FROM THE CHART. A
    // `preventDefault()` with nothing behind it turns `Alt+Shift+A` into a silent
    // no-op — the browser never sees the key, and neither does any other
    // listener. The positive control is the first case above, where the same
    // press reports `defaultPrevented: true`.
    renderChart({ settings: mergeChartSettings(null), showDrawingTools: false })

    const ev = pressAddIndicator()

    expect(libraryOpen()).toBe(false)
    expect(ev.defaultPrevented,
      'the chord was consumed by a branch that then did nothing — a silent no-op is worse ' +
      'than an unhandled key, because nothing downstream can pick it up').toBe(false)
  })

  it('the right-click menu offers "Add indicator…", and it opens the same library', () => {
    const view = renderChart({ settings: mergeChartSettings(null) })
    const sec = sectionOf(openContextMenu(view, { region: 'price' }), 'region')
    const add = sec.items.find(i => i && i.id === 'ind-add')
    expect(add, 'spec §6\'s third entry point is missing from the right-click menu').toBeTruthy()
    // It sits WITH the indicator controls, not adrift at the end of the section.
    const ids = sec.items.filter(Boolean).map(i => i.id)
    expect(ids.indexOf('ind-add'), 'the add row is not beside the Indicators submenu')
      .toBe(ids.indexOf('indicators') + 1)

    expect(libraryOpen()).toBe(false)
    act(() => { add.onSelect() })
    expect(libraryOpen(), 'the menu row is wired to nothing').toBe(true)
    // ⛔ AND IT WROTE NOTHING ITSELF. This row is a USE of the launcher, not a
    // control door: opening a browse surface must not mark the preset custom or
    // persist a settings blob. `lastSettings()` throws when nothing was written,
    // which is the assertion.
    expect(() => view.lastSettings(),
      'opening the library persisted a settings write — this row is a door after all')
      .toThrow()
  })

  it('⛔ a READ-ONLY mount is offered no "Add indicator…" row at all', () => {
    // Presence IS the gate, exactly as it is for `settingsLink`'s three rows: a
    // menu row whose target does not exist is a row that does nothing, which is
    // the defect class this phase retires rather than a smaller version of it.
    const view = renderChart({ settings: mergeChartSettings(null), showDrawingTools: false })
    const sec = sectionOf(openContextMenu(view, { region: 'price' }), 'region')
    expect(sec.items.filter(Boolean).map(i => i.id),
      'a chart with no toolbar offers a row onto a library it does not have')
      .not.toContain('ind-add')
    // …and the same menu on that mount still carries the Indicators submenu, so
    // the absence above is the gate and not a menu that failed to build.
    expect(sec.items.filter(Boolean).map(i => i.id), 'control: the Indicators submenu is still here')
      .toContain('indicators')
  })

  it('⛔ and if the door disappears between building the menu and clicking it, it still lands', () => {
    // The one state the presence gate cannot cover: the menu was built while the
    // toolbar existed and the toolbar is gone by the time the row is clicked.
    // `toolbarRef.current` is null, `openIndicatorLibrary` is unreachable, and the
    // fall-through is the only thing between the user and nothing at all.
    const onOpenSettings = vi.fn()
    const view = renderChart({ settings: mergeChartSettings(null), onOpenSettings })
    const sec = sectionOf(openContextMenu(view, { region: 'price' }), 'region')
    const add = sec.items.find(i => i && i.id === 'ind-add')

    view.unmount()
    act(() => { add.onSelect() })

    expect(libraryOpen()).toBe(false)
    expect(onOpenSettings, 'the row became a silent no-op the moment its door went away')
      .toHaveBeenCalledTimes(1)
  })

  it('an add made through the menu\'s library moves the INSTANCE and the MIRROR', () => {
    // End to end through the row B4 Task 3 added: it opens the dialog, the dialog
    // writes through `setIndicatorEnabled`, and the toolbar's own
    // `onUpdateSettings` persists it.
    //
    // ⚠️ THE SUBJECT MOVED AT B5 TASK 5 (`atr` → `mfi`), AGAIN AT TASK 7 (`mfi` →
    // `adx`), AND RAN OUT AT TASK 8. It was always chosen for being UN-FLIPPED,
    // because the mirror was what an un-flipped definition's legacy block read
    // and an instance-only write would have left it undrawn. There is no
    // un-flipped definition left, and the note that stood here said what to do:
    // re-point the MIRROR half at **what the mirror is FOR** rather than keep it
    // alive on a flipped id.
    //
    // ⛔ AND WHAT IT IS FOR IS THE ROUND TRIP. `indicators.<id>` is the shape a
    // chart is SHARED and RESTORED in — `handleCopyShareUrl` writes exactly that
    // map, a preset stamps a whole blob over `indicatorInstances`, and
    // `migrateLegacyToInstances` PROJECTS the instance list back out of it on
    // read. So an add that moved only the instance is correct until the blob
    // makes one trip without its instances, and then the indicator is gone. That
    // is driven here, on a FLIPPED subject, which is now the only kind there is.
    const ADDED = 'donchian'
    expect(ENGINE_OWNED.has(ADDED), `${ADDED} is not engine-drawn`).toBe(true)
    const view = renderChart({ settings: mergeChartSettings(null) })
    const sec = sectionOf(openContextMenu(view, { region: 'price' }), 'region')
    act(() => { sec.items.find(i => i && i.id === 'ind-add').onSelect() })

    const row = document.body.querySelector(`[data-def-id="${ADDED}"]`)
    expect(row, `the library opened without a ${ADDED} row — this case asserts on nothing`).toBeTruthy()
    act(() => { fireEvent.click(row) })

    const next = view.lastSettings()
    expect(next.indicators[ADDED].enabled, 'the MIRROR did not move').toBe(true)
    expect((next.indicatorInstances || []).some(i => i && i.defId === ADDED && !i.deleted),
      'no instance was created — the engine lane sees nothing').toBe(true)
    expect(isIndicatorEnabled(next, ADDED, ENGINE_OWNED)).toBe(true)
    // ⭐ AND THE MIRROR SURVIVES THE TRIP — the half that makes writing it matter
    // now that no legacy block reads it. Drop `indicatorInstances`, which is what
    // a share link and a preset both do, and the read-time migrator must rebuild
    // the instance from the mirror alone.
    expect(migrateLegacyToInstances({ ...next, indicatorInstances: [] }, registry)
      .some(i => i && i.defId === ADDED && !i.deleted),
    'the mirror did not survive a blob round trip — a share link would drop this indicator')
      .toBe(true)
  })
})

// ─── B5 TASK 5: STOCHASTIC AND ATR, AT THE COMPONENT ────────────────────────
//
// ⛔ EVERYTHING IN HERE IS INVISIBLE TO THE PIXEL GATE, WHICH IS WHY IT IS HERE.
// The 24 parity cases each render ONE static page and photograph it. Not one of
// them performs a settings change, so a mid-session ARRIVAL or DEPARTURE — the
// single most-repeated defect class on this branch, and one that survived a full
// green suite twice — is measured nowhere else.
//
// The `stochAtrFlipParity.test.js` transcription suite proves the engine makes
// the same renderer CALLS the deleted blocks made. It drives `binder.sync`
// directly, so it cannot see the component: which instances StockChart hands the
// binder, which band `computePaneMargins` reserved for them, what the declutter
// toggle reaches, or what a settings write leaves behind. That is this file's
// half, and these cases are its Task-5 rows.
describe('B5 Task 5 — stoch and atr are engine-drawn, at the component', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  const STOCH_ON = { stoch: { enabled: true, kPeriod: 14, dPeriod: 3, kColor: '#FF6B6B', dColor: '#4ECDC4' } }
  const ATR_ON = { atr: { enabled: true, period: 14, color: '#FFA726' } }
  const STOCH_INSTANCE = {
    instanceId: 'engine-test:stoch', defId: 'stoch', defVersion: 1,
    inputs: { kPeriod: 21, dPeriod: 5, kColor: '#FF6B6B', dColor: '#4ECDC4' },
    placement: { target: 'pane' }, hidden: false,
  }
  const ATR_INSTANCE = {
    instanceId: 'engine-test:atr', defId: 'atr', defVersion: 1,
    inputs: { period: 21, color: '#FFA726' },
    placement: { target: 'pane' }, hidden: false,
  }
  /** Every series created on a named band scale, whether or not it survived. */
  const onScale = (id) => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === id)
  const boundFor = (id) => bound().filter(b => b.defId === id)
  /** The band the LAST sync was handed for `id`, or a NAMED failure when no sync
   *  happened — `undefined` must never be able to mean "no engine ran". */
  const bandNow = (id) => {
    const ctx = H.syncCalls.at(-1)
    expect(ctx, 'no sync happened — the band assertion would be vacuous').toBeTruthy()
    return ctx.paneMargins[id]
  }

  it('both are flipped, and neither draws a second copy from a legacy block', () => {
    // The non-vacuity gate for the whole block, in both directions: flipped (so
    // the engine is the authority) AND drawn exactly once (so the deletion of the
    // hand-written block really happened rather than being guarded).
    for (const id of ['stoch', 'atr']) {
      expect(ENGINE_OWNED.has(id), id + ' is not flipped').toBe(true)
      expect(ENGINE_OWNED.has(id), id + ' is not migrated').toBe(true)
    }
    draw({ indicators: { ...STOCH_ON, ...ATR_ON } })
    expect(boundFor('stoch'), 'the engine did not draw %K and %D').toHaveLength(2)
    expect(boundFor('atr'), 'the engine did not draw ATR').toHaveLength(1)
    expect(onScale('stoch'), 'two Stochastics — the legacy block is still drawing').toHaveLength(2)
    expect(onScale('atr'), 'two ATRs — the legacy block is still drawing').toHaveLength(1)
  })

  it('⭐ STOCH ARRIVING and DEPARTING mid-session: nothing → two lines and a band → nothing', () => {
    // ⛔ THE DIRECTION A USER ACTUALLY PERFORMS, and the one no parity case can
    // photograph. Asserted on the BAND as well as the series: a band left
    // reserved for a departed indicator is a permanently short price pane, and a
    // band never reserved is the "oscillator drawn on top of the volume bars"
    // defect (`placement.js`'s {top:0.82} fallback).
    const off = {
      indicators: { ...BB_CONTROL, stoch: { ...STOCH_ON.stoch, enabled: false } },
      indicatorInstances: [],
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(bound(), 'the control instance did not draw — every phase below is vacuous').toHaveLength(3)
    expect(bandNow('stoch'), 'a band was reserved for a Stochastic nobody asked for').toBeUndefined()
    expect(onScale('stoch'), 'something drew Stochastic while it was off').toHaveLength(0)

    const on = setIndicatorEnabled(off, 'stoch', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(on)} />)
    const arrived = boundFor('stoch')
    expect(arrived, 'arriving mid-session drew neither %K nor %D').toHaveLength(2)
    expect(arrived.map(b => b.plotKey), 'arriving drew one line, not two').toEqual(['k', 'd'])
    expect(bandNow('stoch'), 'arriving mid-session reserved no band').toEqual({ top: 0.85, bottom: 0 })
    expect(onScale('stoch'), 'a third line appeared on the stoch scale').toHaveLength(2)

    const offAgain = setIndicatorEnabled(on, 'stoch', false, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(offAgain)} />)
    expect(boundFor('stoch'), 'departing mid-session left a line behind').toHaveLength(0)
    for (const b of arrived) {
      expect(H.removedSeries, 'a departed Stochastic line is still on the chart').toContain(b.series)
    }
    expect(bandNow('stoch'), 'departing mid-session left its band reserved').toBeUndefined()
  })

  it('⭐ ATR ARRIVING and DEPARTING mid-session, into its OWN shorter band', () => {
    // Same seam, and the band is the measured asymmetry: ATR declares
    // `pane.height` 0.13 where every 0-100 oscillator declares 0.15, so
    // `computePaneMargins` gives it `{top: 0.87}`. A case that assumed symmetry
    // with `stoch` would assert the wrong rectangle and pass on a wrong one.
    const off = {
      indicators: { ...BB_CONTROL, atr: { ...ATR_ON.atr, enabled: false } },
      indicatorInstances: [],
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(bound()).toHaveLength(3)
    expect(bandNow('atr')).toBeUndefined()

    const on = setIndicatorEnabled(off, 'atr', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(on)} />)
    const arrived = boundFor('atr')
    expect(arrived, 'arriving mid-session drew nothing').toHaveLength(1)
    expect(bandNow('atr'), 'ATR did not get its own 0.13-high band').toEqual({ top: 0.87, bottom: 0 })
    expect(bandNow('atr'), 'ATR was handed a Stochastic-shaped band').not.toEqual({ top: 0.85, bottom: 0 })

    const offAgain = setIndicatorEnabled(on, 'atr', false, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(offAgain)} />)
    expect(boundFor('atr'), 'departing mid-session left the line behind').toHaveLength(0)
    expect(H.removedSeries).toContain(arrived[0].series)
    expect(bandNow('atr'), 'departing mid-session left its band reserved').toBeUndefined()
  })

  it('⭐ a STORED stoch instance arriving MID-SESSION replaces the PROJECTED one', () => {
    // The other mid-session seam — PROJECTED → STORED — with a MULTI-PLOT
    // definition, which is where B3's version of this bug hid: a hand-over that
    // absorbed one plot and recreated the other reads as a plausible chart.
    const projectedOnly = { indicators: { ...STOCH_ON }, indicatorInstances: [] }
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(projectedOnly)} />)
    const projected = boundFor('stoch')
    expect(projected, 'the migrator drew nothing — this case is vacuous').toHaveLength(2)
    expect(projected[0].key, 'the projection did not build `legacy:stoch`').toContain('legacy:stoch')
    const before = projected.map(b => b.series)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...projectedOnly, indicatorInstances: [STOCH_INSTANCE] })} />)

    const after = boundFor('stoch')
    expect(after, 'the stored instance did not take over — or BOTH are drawn').toHaveLength(2)
    for (const b of after) expect(b.key, 'the projection is still drawing').toContain('engine-test:stoch')
    expect(onScale('stoch'), 'a third or fourth line appeared on the stoch scale').toHaveLength(2)
    // ⚠️ #2049: both series RE-USED across the hand-over, never destroyed.
    expect(after.map(b => b.series).sort(), 'the pool destroyed and recreated a line')
      .toEqual([...before].sort())
    for (const s of before) expect(H.removedSeries).not.toContain(s)
  })

  it('…and the reverse — the stored stoch instance leaving hands it back to the projection', () => {
    const withStored = { indicators: { ...STOCH_ON }, indicatorInstances: [STOCH_INSTANCE] }
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(withStored)} />)
    const before = boundFor('stoch')
    expect(before).toHaveLength(2)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...withStored, indicatorInstances: [] })} />)
    const after = boundFor('stoch')
    expect(after, 'Stochastic vanished when the stored instance was removed').toHaveLength(2)
    for (const b of after) expect(b.key, 'nothing projected it back').toContain('legacy:stoch')
    expect(after.map(b => b.series).sort(), 'the pool destroyed and recreated a line')
      .toEqual(before.map(b => b.series).sort())
  })

  it('⭐ the same crossover for ATR, both directions', () => {
    const projectedOnly = { indicators: { ...ATR_ON }, indicatorInstances: [] }
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(projectedOnly)} />)
    const projected = boundFor('atr')
    expect(projected, 'the migrator drew nothing — this case is vacuous').toHaveLength(1)
    expect(projected[0].key).toContain('legacy:atr')
    const first = projected[0].series

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...projectedOnly, indicatorInstances: [ATR_INSTANCE] })} />)
    const stored = boundFor('atr')
    expect(stored, 'the stored instance did not take over — or BOTH are drawn').toHaveLength(1)
    expect(stored[0].key).toContain('engine-test:atr')
    expect(stored[0].series, 'the series was destroyed and recreated across the crossover').toBe(first)
    expect(onScale('atr'), 'a second ATR line appeared').toHaveLength(1)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...projectedOnly, indicatorInstances: [] })} />)
    const back = boundFor('atr')
    expect(back, 'ATR vanished when the stored instance was removed').toHaveLength(1)
    expect(back[0].key, 'nothing projected it back').toContain('legacy:atr')
    expect(back[0].series).toBe(first)
    expect(H.removedSeries, 'the hand-over removed a series the pool should have absorbed')
      .not.toContain(first)
  })

  it('⭐ #2049: a colour change AND a period change RESTYLE the same series', () => {
    // The open LWC issue this branch is built around: mass `removeSeries` is a
    // 2-4 s main-thread block. A period change is the harder half — it changes
    // the NUMBERS, so a naive implementation recreates.
    const base = { indicators: { ...STOCH_ON, ...ATR_ON }, indicatorInstances: [STOCH_INSTANCE, ATR_INSTANCE] }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(base)} />)
    const before = bound().map(b => b.series)
    expect(before, 'nothing was drawn — this case is vacuous').toHaveLength(3)
    const createdBefore = H.addSeriesCalls.length

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways({
      ...base,
      indicatorInstances: [
        { ...STOCH_INSTANCE, inputs: { ...STOCH_INSTANCE.inputs, kColor: '#00ff00' } },
        { ...ATR_INSTANCE, inputs: { period: 34, color: '#0000ff' } },
      ],
    })} />)

    expect(bound().map(b => b.series).sort(), 'a restyle destroyed and recreated a series')
      .toEqual([...before].sort())
    expect(H.addSeriesCalls.length, 'a restyle created a new series').toBe(createdBefore)
    expect(H.removedSeries.filter(s => before.includes(s)),
      'a restyle removed a series — this is exactly #2049').toHaveLength(0)
  })

  it('the declutter toggle reaches both, through the binding map and through the BINDER', () => {
    // Two halves, and the second is the one a `visible:false` alone cannot hold:
    // `updateChart` re-asserts the COMPLETE option set roughly once a second in
    // extended hours, so the toggle's state has to reach `binder.sync` or the
    // next paint silently re-shows what the user just hid.
    const settings = { indicators: { ...STOCH_ON, ...ATR_ON } }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings)} />)
    const series = bound().map(b => b.series)
    expect(series, 'nothing was bound — this case is vacuous').toHaveLength(3)
    expect(H.syncCalls.at(-1).indicatorsHidden).toBe(false)

    act(() => { fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' }) })
    for (const s of series) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === false).length,
        'a flipped indicator was missed by the declutter toggle').toBeGreaterThan(0)
    }

    const before = H.syncCalls.length
    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS.slice(0, BARS.length - 1)}
        settingsOverride={legendAlways(settings)} />)
    expect(H.syncCalls.length, 'no further sync — the assertion below would be vacuous')
      .toBeGreaterThan(before)
    expect(H.syncCalls.at(-1).indicatorsHidden, 'the next paint would re-show them').toBe(true)

    act(() => { fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' }) })
    for (const s of series) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === true).length)
        .toBeGreaterThan(0)
    }
  })

  it('a settings round-trip survives BOTH allow-lists, and the chart follows', () => {
    // ⛔ TWO ALLOW-LISTS, AND A KEY MISSING FROM EITHER IS SILENTLY DROPPED ON
    // EVERY READ. `mergeChartSettings` is the per-key one (a section key it does
    // not name never reaches the chart); `mergeSettingsOverride` is the second,
    // which a grid cell's per-cell override goes through.
    const merged = mergeChartSettings(JSON.stringify({
      indicators: { ...STOCH_ON, ...ATR_ON },
      indicatorInstances: [STOCH_INSTANCE, ATR_INSTANCE],
    }))
    expect(merged.indicatorInstances).toEqual([STOCH_INSTANCE, ATR_INSTANCE])
    // ⭐ B5 TASK 9: the per-key list is ONE line now, so what the definitions
    // declare lives on the INSTANCE and the legacy sections are DESTROYED.
    expect(Object.keys(merged.indicators)).toEqual(['volumeProfile'])
    expect(merged.indicatorInstances.find(i => i.defId === 'stoch').inputs)
      .toEqual(STOCH_INSTANCE.inputs)
    expect(merged.indicatorInstances.find(i => i.defId === 'atr').inputs)
      .toEqual(ATR_INSTANCE.inputs)

    const out = mergeSettingsOverride(merged, {
      indicatorInstances: [{ instanceId: 'engine-test:stoch', inputs: { kPeriod: 34 } }],
    })
    expect(out.indicatorInstances, 'the generic array path replaced the list').toHaveLength(2)
    expect(out.indicatorInstances.find(i => i.instanceId === 'engine-test:stoch').inputs)
      .toEqual({ ...STOCH_INSTANCE.inputs, kPeriod: 34 })
    expect(out.indicatorInstances.find(i => i.instanceId === 'engine-test:atr')).toEqual(ATR_INSTANCE)

    // …and the round-tripped blob draws it, once, with the patched period. The
    // period is read off the DATA, because it appears in no option object — a
    // longer %K period pushes the first finite bar further right.
    draw(out)
    const stochBound = boundFor('stoch')
    expect(stochBound, 'the round-tripped blob drew the wrong number of lines').toHaveLength(2)
    expect(onScale('stoch'), 'a second copy was drawn').toHaveLength(2)
    const kData = H.setDataCalls.filter(c => c.series === stochBound[0].series).at(-1)
    expect(kData, 'no data reached %K — the period assertion below is vacuous').toBeTruthy()
    expect(kData.data.findIndex(p => Number.isFinite(p.value)),
      'the patched kPeriod never reached the compute').toBe(33)
  })


  it('⭐ the VOLUME-OVERLAY path, mid-session — and the FIRST relocation on this branch', () => {
    // ⛔ THE PLACEMENT PATH NO B3 PILOT COULD EXERCISE. `ensureIndTarget` sends a
    // pane oscillator listed in `cs.volumeOverlayIndicators` to the VOLUME pane's
    // LEFT axis instead of its own band. Three of the four pilots are price
    // overlays and RSI's cases never set that list, so `resolvePlacement`'s
    // `volSeparatePane && volOverlaySet.has(key)` branch had never been driven
    // through the component at all. `stoch` and `atr` are both eligible.
    //
    // ⚠️ AND IT IS ALSO THE FIRST TIME A POOLED SERIES CAN CROSS PANES, which the
    // `⏳ EXPIRES when a pooled series first CROSSES PANES` rail above is about.
    // That rail asserts its OWN fixture relocates nothing and still does; what
    // changes here is that a relocation is now REACHABLE, so it is measured
    // rather than left to be discovered.
    const overlaid = {
      volume: { visible: true },
      volumeOverlayIndicators: ['stoch'],
      indicators: { stoch: { enabled: true, kPeriod: 14, dPeriod: 3, kColor: '#FF6B6B', dColor: '#4ECDC4' } },
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(overlaid)} />)
    const onLeft = H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'left')
    expect(onLeft, 'the overlay path drew neither %K nor %D on the volume pane\'s left axis')
      .toHaveLength(2)
    for (const c of onLeft) expect(c.paneIndex, 'an overlaid line landed off the volume pane').toBe(1)
    const before = bound().map(b => b.series)
    expect(before).toHaveLength(2)

    // Move it back to its own band, mid-session — the toggle a user flips in the
    // volume-overlay strip.
    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...overlaid, volumeOverlayIndicators: [] })} />)
    const after = bound()
    expect(after, 'the oscillator vanished when it left the volume pane').toHaveLength(2)
    // ⚠️ #2049, AND THE DIFFERENCE FROM LEGACY, STATED: the hand-written block
    // DESTROYED and recreated a series whose target scale changed
    // (`ensureIndTarget`'s `removeSeries` loop). The engine RELOCATES it instead.
    // That is the escape the whole pooling design exists for, and it is the
    // behaviour a static parity capture can never photograph.
    expect(after.map(b => b.series).sort(), 'the pool destroyed and recreated the lines')
      .toEqual([...before].sort())
    for (const s of before) expect(H.removedSeries).not.toContain(s)
    expect(H.moveToPaneCalls.length,
      'nothing relocated — either the overlay toggle did not reach placement, or the '
      + 'binder recreated instead of moving').toBeGreaterThan(0)
    expect(after.map(b => b.scaleId), 'the lines did not go back to their own named scale')
      .toEqual(['stoch', 'stoch'])
  })

  it('neither definition has a keyboard chord, and that is UNCHANGED by the flip', () => {
    // ⚠️ STATED RATHER THAN ASSUMED. The runbook's control-door checklist names
    // "the Ctrl family / Alt+U" as a door every migration has to route, and for
    // these two there is NOTHING to route: `INDICATOR_CHORDS` binds rsi, macd, bb
    // and vwap only. An indicator without a chord simply has no chord — but the
    // claim has to be a test, because the failure it guards against is a chord
    // added later that writes `cs.indicators.<id>` RAW and moves a number nothing
    // renders.
    expect(INDICATOR_CHORDS.map(c => c.defId).sort(), 'a chord was added or removed')
      .toEqual(['bb', 'macd', 'rsi', 'vwap'])
    for (const id of ['stoch', 'atr']) {
      expect(INDICATOR_CHORDS.some(c => c.defId === id), id + ' gained a chord').toBe(false)
    }
  })
})

// ─── B5 TASK 7: MFI, CCI AND WILLIAMS %R, AT THE COMPONENT ──────────────────
//
// Three single-line pane oscillators, migrated and flipped together. The unit
// suite (`mfiCciWilliamsFlipParity.test.js`) drives `binder.sync` directly, so
// it proves the engine makes the same renderer CALLS the deleted blocks made and
// nothing about the component: which instances StockChart hands the binder,
// which band `computePaneMargins` reserved, what the declutter toggle reaches,
// what a settings write leaves behind, and what happens when a user turns one of
// them ON or OFF while the chart is already up. That last one — MID-SESSION
// ARRIVAL AND DEPARTURE — is the most-repeated defect class on this branch and
// has survived a full green suite twice, so it is measured here in BOTH
// directions and on BOTH crossovers (enabled↔disabled, projected↔stored).
//
// ⭐ AND THE PAIRING IS THE POINT AGAIN: these three differ from each other only
// in their GUIDES and their SCALES, so the component-level cases below are
// deliberately written to assert those two things and not the series count.
describe('B5 Task 7 — mfi, cci and williamsR are engine-drawn, at the component', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  const MFI_ON = { mfi: { enabled: true, period: 14, color: '#c084fc' } }
  const CCI_ON = { cci: { enabled: true, period: 20, color: '#fbbf24' } }
  const WR_ON = { williamsR: { enabled: true, period: 14, color: '#60a5fa' } }
  const MFI_INSTANCE = {
    instanceId: 'engine-test:mfi', defId: 'mfi', defVersion: 1,
    inputs: { period: 21, color: '#c084fc' }, placement: { target: 'pane' }, hidden: false,
  }
  const CCI_INSTANCE = {
    instanceId: 'engine-test:cci', defId: 'cci', defVersion: 1,
    inputs: { period: 40, color: '#fbbf24' }, placement: { target: 'pane' }, hidden: false,
  }
  const WR_INSTANCE = {
    instanceId: 'engine-test:williamsR', defId: 'williamsR', defVersion: 1,
    inputs: { period: 28, color: '#60a5fa' }, placement: { target: 'pane' }, hidden: false,
  }
  const RSI_ON = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
  /** Drive one crosshair move over the newest bar and return the rendered chips. */
  const hover = (view, extraSeriesData) => settledLegend(view, crosshairAt(BARS, extraSeriesData))
  const onScale = (id) => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === id)
  const boundFor = (id) => bound().filter(b => b.defId === id)
  const bandNow = (id) => {
    const ctx = H.syncCalls.at(-1)
    expect(ctx, 'no sync happened — the band assertion would be vacuous').toBeTruthy()
    return ctx.paneMargins[id]
  }
  /** Every `createPriceLine` spec drawn on the series `bindings` hold. */
  const guidesOn = (bindings) => {
    const owned = new Set(bindings.map(b => b.series))
    return H.priceLineCalls.filter(c => owned.has(c.series)).map(c => c.options)
  }

  it('all three are flipped, and none draws a second copy from a legacy block', () => {
    // The non-vacuity gate for the whole block, in both directions: flipped (so
    // the engine is the authority) AND drawn exactly once (so the deletion of the
    // hand-written blocks really happened rather than being guarded).
    for (const id of ['mfi', 'cci', 'williamsR']) {
      expect(ENGINE_OWNED.has(id), id + ' is not flipped').toBe(true)
      expect(ENGINE_OWNED.has(id), id + ' is not migrated').toBe(true)
    }
    draw({ indicators: { ...MFI_ON, ...CCI_ON, ...WR_ON } })
    for (const id of ['mfi', 'cci', 'williamsR']) {
      expect(boundFor(id), 'the engine did not draw ' + id).toHaveLength(1)
      expect(onScale(id), 'two ' + id + ' lines — the legacy block is still drawing').toHaveLength(1)
    }
  })

  it('⭐ SEVEN GUIDES IN THREE SHAPES, at the component, on the right three series', () => {
    // ⛔ THE HALF A SERIES COUNT CANNOT SEE. All three definitions bind ONE line
    // each, so "three series drawn" is satisfied by a migration that dropped
    // every guide — and a guide is a `createPriceLine`, not a series, so it
    // appears in NO binding, NO manifest and NO series assertion.
    draw({ indicators: { ...MFI_ON, ...CCI_ON, ...WR_ON } })
    const byId = Object.fromEntries(
      ['mfi', 'cci', 'williamsR'].map(id => [id, guidesOn(boundFor(id))]))
    expect(byId.mfi.map(g => g.price), 'MFI lost its 80/20 pair').toEqual([80, 20])
    expect(byId.cci.map(g => g.price), 'CCI lost a guide').toEqual([100, -100, 0])
    expect(byId.williamsR.map(g => g.price), 'Williams %R lost its -20/-80 pair').toEqual([-20, -80])
    // ⛔ AND THE TWO STYLES, WHICH IS THE ONE PLACE A DROPPED OPTION IS SILENT.
    // An omitted `createPriceLine` option takes LWC's OWN DEFAULT, and that
    // default IS Dashed (2) — so a `zero` plot that lost its `largeDashed` looks
    // exactly like the ±100 bands and every "three guides" count still passes.
    expect(byId.cci.map(g => g.lineStyle), 'the zero line lost its LargeDashed').toEqual([2, 2, 3])
    expect(byId.mfi.map(g => g.lineStyle)).toEqual([2, 2])
    expect(byId.williamsR.map(g => g.lineStyle)).toEqual([2, 2])
    // …and every guide states every key, including the axis label it must NOT draw.
    for (const g of [...byId.mfi, ...byId.cci, ...byId.williamsR]) {
      expect(g.axisLabelVisible, 'a guide put a label on the axis').toBe(false)
      expect(g.lineWidth).toBe(1)
      expect('title' in g, 'a guide gained a title the shipped call never passed').toBe(false)
    }
  })

  it('⭐ MFI ARRIVING and DEPARTING mid-session: nothing → a line, two guides and a band → nothing', () => {
    // ⛔ THE DIRECTION A USER ACTUALLY PERFORMS, and the one no parity case can
    // photograph. Asserted on the BAND and the GUIDES as well as the series: a
    // band left reserved for a departed indicator is a permanently short price
    // pane, a band never reserved is the "oscillator drawn on top of the volume
    // bars" defect (`placement.js`'s {top:0.82} fallback), and an orphaned guide
    // is a horizontal line at 80 across a pane that no longer holds an MFI.
    const off = {
      indicators: { ...BB_CONTROL, mfi: { ...MFI_ON.mfi, enabled: false } },
      indicatorInstances: [],
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(bound(), 'the control instance did not draw — every phase below is vacuous').toHaveLength(3)
    expect(bandNow('mfi'), 'a band was reserved for an MFI nobody asked for').toBeUndefined()
    expect(onScale('mfi'), 'something drew MFI while it was off').toHaveLength(0)

    const on = setIndicatorEnabled(off, 'mfi', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(on)} />)
    const arrived = boundFor('mfi')
    expect(arrived, 'arriving mid-session drew nothing').toHaveLength(1)
    expect(bandNow('mfi'), 'arriving mid-session reserved no band').toEqual({ top: 0.85, bottom: 0 })
    expect(guidesOn(arrived).map(g => g.price), 'arriving mid-session drew no guides').toEqual([80, 20])
    expect(onScale('mfi'), 'a second line appeared on the mfi scale').toHaveLength(1)

    const offAgain = setIndicatorEnabled(on, 'mfi', false, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(offAgain)} />)
    expect(boundFor('mfi'), 'departing mid-session left the line behind').toHaveLength(0)
    expect(H.removedSeries, 'a departed MFI line is still on the chart').toContain(arrived[0].series)
    expect(bandNow('mfi'), 'departing mid-session left its band reserved').toBeUndefined()
  })

  it('⭐ CCI ARRIVING and DEPARTING mid-session, with THREE guides and an AUTOSCALED band', () => {
    // The same seam on the only unbounded one of the three: `autoPane`, so the
    // scale options are `{autoScale: true}` with no `minimum`/`maximum` — and a
    // band that inherited a departed neighbour's frozen range is exactly the
    // pooled-scale hazard `placement.js`'s TRAP #2 exists for.
    const off = {
      indicators: { ...BB_CONTROL, cci: { ...CCI_ON.cci, enabled: false } },
      indicatorInstances: [],
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(bound()).toHaveLength(3)
    expect(bandNow('cci')).toBeUndefined()

    const on = setIndicatorEnabled(off, 'cci', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(on)} />)
    const arrived = boundFor('cci')
    expect(arrived, 'arriving mid-session drew nothing').toHaveLength(1)
    expect(bandNow('cci'), 'CCI did not get its band').toEqual({ top: 0.85, bottom: 0 })
    expect(guidesOn(arrived).map(g => g.price), 'arriving mid-session lost a guide')
      .toEqual([100, -100, 0])
    expect(guidesOn(arrived).map(g => g.lineStyle)).toEqual([2, 2, 3])

    const offAgain = setIndicatorEnabled(on, 'cci', false, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(offAgain)} />)
    expect(boundFor('cci'), 'departing mid-session left the line behind').toHaveLength(0)
    expect(H.removedSeries).toContain(arrived[0].series)
    expect(bandNow('cci'), 'departing mid-session left its band reserved').toBeUndefined()
  })

  it('⭐ WILLIAMS %R ARRIVING and DEPARTING mid-session, on the NEGATIVE scale', () => {
    // ⚠️ THE ONE THIS TASK'S BRIEF SINGLED OUT. `fixedPane(-100, 0)` means the
    // pinned branch in `resolvePlacement` is reached only because it tests
    // `Number.isFinite(max)` and not `max` — a truthiness guard sends a `max` of
    // ZERO down the autoscale branch — and both guides are NEGATIVE numbers,
    // which is the other place a sign error is silent (the line itself never
    // leaves [-100, 0], so it goes on rendering perfectly).
    const off = {
      indicators: { ...BB_CONTROL, williamsR: { ...WR_ON.williamsR, enabled: false } },
      indicatorInstances: [],
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(bound()).toHaveLength(3)
    expect(bandNow('williamsR')).toBeUndefined()

    const on = setIndicatorEnabled(off, 'williamsR', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(on)} />)
    const arrived = boundFor('williamsR')
    expect(arrived, 'arriving mid-session drew nothing').toHaveLength(1)
    expect(arrived[0].plotKey, 'the snake_case plot key was harmonised — this binds nothing')
      .toBe('williams_r')
    expect(bandNow('williamsR'), 'Williams %R did not get its band').toEqual({ top: 0.85, bottom: 0 })
    expect(guidesOn(arrived).map(g => g.price), 'the guides lost their sign').toEqual([-20, -80])
    // …and the data really is on the negative side, so the range is the column's
    // and not a decoration.
    const wrData = H.setDataCalls.filter(c => c.series === arrived[0].series).at(-1)
    expect(wrData, 'no data reached Williams %R').toBeTruthy()
    const finite = wrData.data.map(p => p.value).filter(Number.isFinite)
    expect(finite.length).toBeGreaterThan(100)
    expect(Math.max(...finite)).toBeLessThanOrEqual(0)
    expect(Math.min(...finite)).toBeGreaterThanOrEqual(-100)

    const offAgain = setIndicatorEnabled(on, 'williamsR', false, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(offAgain)} />)
    expect(boundFor('williamsR'), 'departing mid-session left the line behind').toHaveLength(0)
    expect(H.removedSeries).toContain(arrived[0].series)
    expect(bandNow('williamsR'), 'departing mid-session left its band reserved').toBeUndefined()
  })

  it('⭐ a STORED instance arriving MID-SESSION replaces the PROJECTED one — all three', () => {
    // The OTHER mid-session seam, PROJECTED → STORED, driven for each of the
    // three. A hand-over that ADDS instead of replacing is a double-drawn
    // indicator, which reads as a slightly bolder line and nothing else.
    for (const [id, instance] of [['mfi', MFI_INSTANCE], ['cci', CCI_INSTANCE], ['williamsR', WR_INSTANCE]]) {
      cleanup(); H.reset()
      const on = { ...MFI_ON, ...CCI_ON, ...WR_ON }
      const projectedOnly = { indicators: { [id]: on[id] }, indicatorInstances: [] }
      const view = render(
        <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(projectedOnly)} />)
      const projected = boundFor(id)
      expect(projected, id + ': the migrator drew nothing — this case is vacuous').toHaveLength(1)
      expect(projected[0].key, id + ': the projection did not build `legacy:' + id + '`')
        .toContain('legacy:' + id)
      const first = projected[0].series

      view.rerender(
        <StockChart sym="AAPL" tf="D" barsOverride={BARS}
          settingsOverride={legendAlways({ ...projectedOnly, indicatorInstances: [instance] })} />)
      const stored = boundFor(id)
      expect(stored, id + ': the stored instance did not take over — or BOTH are drawn').toHaveLength(1)
      expect(stored[0].key).toContain('engine-test:' + id)
      // ⚠️ #2049: the series is RE-USED across the hand-over, never destroyed.
      expect(stored[0].series, id + ': the series was destroyed and recreated').toBe(first)
      expect(onScale(id), id + ': a second line appeared').toHaveLength(1)

      // …and the reverse: the stored instance leaving hands it back to the
      // projection, on the SAME series.
      view.rerender(
        <StockChart sym="AAPL" tf="D" barsOverride={BARS}
          settingsOverride={legendAlways({ ...projectedOnly, indicatorInstances: [] })} />)
      const back = boundFor(id)
      expect(back, id + ': it vanished when the stored instance was removed').toHaveLength(1)
      expect(back[0].key, id + ': nothing projected it back').toContain('legacy:' + id)
      expect(back[0].series).toBe(first)
      expect(H.removedSeries, id + ': the hand-over removed a series the pool should have absorbed')
        .not.toContain(first)
      view.unmount()
    }
  })

  it('⭐ #2049: a colour change AND a period change RESTYLE the same three series', () => {
    // The open LWC issue this branch is built around: mass `removeSeries` is a
    // 2-4 s main-thread block. A period change is the harder half — it changes
    // the NUMBERS, so a naive implementation recreates. And the guides must NOT
    // churn either: their levels are literals, so the guide signature does not
    // move and LWC (which has no "update a price line") is asked for nothing.
    const base = {
      indicators: { ...MFI_ON, ...CCI_ON, ...WR_ON },
      indicatorInstances: [MFI_INSTANCE, CCI_INSTANCE, WR_INSTANCE],
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(base)} />)
    const before = bound().map(b => b.series)
    expect(before, 'nothing was drawn — this case is vacuous').toHaveLength(3)
    const createdBefore = H.addSeriesCalls.length
    const guidesBefore = H.priceLineCalls.length
    expect(guidesBefore, 'no guides at all — the churn assertion below is vacuous').toBe(7)

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways({
      ...base,
      indicatorInstances: [
        { ...MFI_INSTANCE, inputs: { period: 34, color: '#00ff00' } },
        { ...CCI_INSTANCE, inputs: { period: 55, color: '#0000ff' } },
        { ...WR_INSTANCE, inputs: { period: 34, color: '#ff00ff' } },
      ],
    })} />)

    expect(bound().map(b => b.series).sort(), 'a restyle destroyed and recreated a series')
      .toEqual([...before].sort())
    expect(H.addSeriesCalls.length, 'a restyle created a new series').toBe(createdBefore)
    expect(H.removedSeries.filter(s => before.includes(s)),
      'a restyle removed a series — this is exactly #2049').toHaveLength(0)
    expect(H.priceLineCalls.length, 'a restyle re-created the guides').toBe(guidesBefore)
  })

  it('the declutter toggle reaches all three, through the binding map and through the BINDER', () => {
    // Two halves, and the second is the one a `visible:false` alone cannot hold:
    // `updateChart` re-asserts the COMPLETE option set roughly once a second in
    // extended hours, so the toggle's state has to reach `binder.sync` or the
    // next paint silently re-shows what the user just hid. ⚠️ AND THIS IS THE
    // FIRST PAINT AFTER THE HIDE-ALL ARRAY LOST THESE THREE REFS — the array is
    // a hand-written list with no build-time check, and the whole reason these
    // definitions can leave it is that the engine's bindings are ITERATED.
    const settings = { indicators: { ...MFI_ON, ...CCI_ON, ...WR_ON } }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings)} />)
    const series = bound().map(b => b.series)
    expect(series, 'nothing was bound — this case is vacuous').toHaveLength(3)
    expect(H.syncCalls.at(-1).indicatorsHidden).toBe(false)

    act(() => { fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' }) })
    for (const s of series) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === false).length,
        'a flipped indicator was missed by the declutter toggle').toBeGreaterThan(0)
    }

    const before = H.syncCalls.length
    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS.slice(0, BARS.length - 1)}
        settingsOverride={legendAlways(settings)} />)
    expect(H.syncCalls.length, 'no further sync — the assertion below would be vacuous')
      .toBeGreaterThan(before)
    expect(H.syncCalls.at(-1).indicatorsHidden, 'the next paint would re-show them').toBe(true)

    act(() => { fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' }) })
    for (const s of series) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === true).length)
        .toBeGreaterThan(0)
    }
  })

  it('a settings round-trip survives BOTH allow-lists, and the chart follows', () => {
    // ⛔ TWO ALLOW-LISTS, AND A KEY MISSING FROM EITHER IS SILENTLY DROPPED ON
    // EVERY READ. `mergeChartSettings` is the per-key one (a section key it does
    // not name never reaches the chart); `mergeSettingsOverride` is the second,
    // which a grid cell's per-cell override goes through.
    const merged = mergeChartSettings(JSON.stringify({
      indicators: { ...MFI_ON, ...CCI_ON, ...WR_ON },
      indicatorInstances: [MFI_INSTANCE, CCI_INSTANCE, WR_INSTANCE],
    }))
    expect(merged.indicatorInstances).toEqual([MFI_INSTANCE, CCI_INSTANCE, WR_INSTANCE])
    // ⭐ B5 TASK 9: the per-key list is ONE line, so the mirror is DESTROYED and
    // the declared inputs live on the instance. Both directions asserted.
    expect(Object.keys(merged.indicators)).toEqual(['volumeProfile'])
    expect(merged.indicatorInstances.find(i => i.defId === 'mfi').inputs)
      .toEqual(MFI_INSTANCE.inputs)
    expect(merged.indicatorInstances.find(i => i.defId === 'cci').inputs)
      .toEqual(CCI_INSTANCE.inputs)
    expect(merged.indicatorInstances.find(i => i.defId === 'williamsR').inputs)
      .toEqual(WR_INSTANCE.inputs)

    const out = mergeSettingsOverride(merged, {
      indicatorInstances: [{ instanceId: 'engine-test:williamsR', inputs: { period: 34 } }],
    })
    expect(out.indicatorInstances, 'the generic array path replaced the list').toHaveLength(3)
    expect(out.indicatorInstances.find(i => i.instanceId === 'engine-test:williamsR').inputs)
      .toEqual({ ...WR_INSTANCE.inputs, period: 34 })
    expect(out.indicatorInstances.find(i => i.instanceId === 'engine-test:mfi')).toEqual(MFI_INSTANCE)

    // …and the round-tripped blob draws it, once, with the patched period. The
    // period is read off the DATA, because it appears in no option object — a
    // longer Williams %R period pushes the first finite bar further right.
    draw(out)
    const wr = boundFor('williamsR')
    expect(wr, 'the round-tripped blob drew the wrong number of lines').toHaveLength(1)
    expect(onScale('williamsR'), 'a second copy was drawn').toHaveLength(1)
    const wrData = H.setDataCalls.filter(c => c.series === wr[0].series).at(-1)
    expect(wrData, 'no data reached Williams %R — the period assertion below is vacuous').toBeTruthy()
    expect(wrData.data.findIndex(p => Number.isFinite(p.value)),
      'the patched period never reached the compute').toBe(33)
  })

  it('the VOLUME-OVERLAY path, mid-session, for a definition with GUIDES', () => {
    // ⚠️ WHAT TASK 6 COULD NOT DRIVE. `sar` and `ichimoku` are PRICE overlays,
    // which the volume-overlay toggle cannot move; all three of Task 7's are pane
    // oscillators, so this branch is live again — and it is the first time it
    // runs for a definition that draws GUIDES, because `stoch`'s two are the only
    // other ones and `atr` has none. The guides ride the series onto the shared
    // left axis, where the band's 0-100 range must NOT follow.
    const overlaid = {
      volume: { visible: true },
      volumeOverlayIndicators: ['mfi'],
      indicators: { ...MFI_ON },
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(overlaid)} />)
    const onLeft = H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'left')
    expect(onLeft, 'the overlay path drew nothing on the volume pane\'s left axis').toHaveLength(1)
    expect(onLeft[0].paneIndex, 'an overlaid line landed off the volume pane').toBe(1)
    const before = bound().map(b => b.series)
    expect(before).toHaveLength(1)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...overlaid, volumeOverlayIndicators: [] })} />)
    const after = bound()
    expect(after, 'the oscillator vanished when it left the volume pane').toHaveLength(1)
    // ⚠️ #2049, AND THE DIFFERENCE FROM LEGACY: the hand-written block DESTROYED
    // and recreated a series whose target scale changed; the engine RELOCATES it.
    expect(after.map(b => b.series), 'the pool destroyed and recreated the line').toEqual(before)
    for (const s of before) expect(H.removedSeries).not.toContain(s)
    expect(H.moveToPaneCalls.length, 'nothing relocated').toBeGreaterThan(0)
    expect(after[0].scaleId, 'the line did not go back to its own named scale').toBe('mfi')
  })

  it('each of the three adds EXACTLY ONE chip, and the RSI control is untouched', async () => {
    // 🔴 THIS READ *"none of the three adds a legend chip, and the nine are still
    // the nine"*, and its note read *"THE ABSENCE IS THE ASSERTION, AND IT IS
    // TRANSCRIBED RATHER THAN IMPROVED."* Transcribing the shipped behaviour was
    // right for a FLIP task; Task 2 (`43efeff6`) is the task that changes it,
    // because a user who switched MFI on got a line with no label at any time.
    //
    // ⛔ THE HAZARD THE OLD NOTE NAMED SURVIVES VERBATIM, and it is why this is
    // an equality on plot KEYS rather than "declares at least one": *"the engine
    // lane emits a chip for any plot that declares one, so a `legend: {}` added
    // in passing would put THREE new chips in the legend"*. Each of these three
    // declares its chip on the OSCILLATOR LINE and on nothing else — a `legend`
    // block landing on a `bands`/`zero` guide fails the loop below by name.
    const CHIP_ON = { mfi: ['mfi'], cci: ['cci'], williamsR: ['williams_r'] }
    for (const [id, keys] of Object.entries(CHIP_ON)) {
      expect(registry.getDefinition(id).plots.filter(p => p.legend).map(p => p.key), id)
        .toEqual(keys)
    }
    const view = draw({ indicators: { ...RSI_ON.indicators, ...MFI_ON, ...CCI_ON, ...WR_ON } })
    const drawn = ['mfi', 'cci', 'williamsR'].map(id => boundFor(id)[0])
    expect(drawn.every(Boolean), 'one of the three never drew — this case is vacuous').toBe(true)
    const text = await hover(view, [
      [boundFor('rsi')[0].series, { value: 54.3 }],
      ...drawn.map(b => [b.series, { value: 42.5 }]),
    ])
    expect(text, 'the engine lane stopped drawing — the control chip is missing').toContain('RSI(14)')
    // ⭐ THE DECLARED DIFFERENCE, NAMED — label, brackets and precision together,
    // so a dropped `legendParams` (`MFI 42.5`) or a precision change fails.
    for (const chip of ['MFI(14) 42.5', 'CCI(20) 42.5', '%R(14) 42.5']) {
      expect(text, chip + ' is missing from the legend').toContain(chip)
    }
    // …and ONE each: three lines were hovered with the SAME value, so a chip on
    // a guide, or a definition emitting twice, makes this more than three.
    expect(text.split('42.5').length - 1,
      'more than one chip per oscillator — a guide or a sibling plot grew one').toBe(3)
  })

  it('none of the three has a keyboard chord, and that is UNCHANGED by the flip', () => {
    // ⚠️ STATED RATHER THAN ASSUMED, as for stoch/atr at Task 5. The failure it
    // guards against is a chord added later that writes `cs.indicators.<id>` RAW
    // and moves a number nothing renders.
    expect(INDICATOR_CHORDS.map(c => c.defId).sort(), 'a chord was added or removed')
      .toEqual(['bb', 'macd', 'rsi', 'vwap'])
    for (const id of ['mfi', 'cci', 'williamsR']) {
      expect(INDICATOR_CHORDS.some(c => c.defId === id), id + ' gained a chord').toBe(false)
    }
  })
})

describe('B5 Task 8 — adx, obv and donchian are engine-drawn, at the component', () => {
  // ⭐ B5 TASK 12 — BANDS, PINNED. See `pinBandsMode`.
  pinBandsMode()

  const ADX_ON = { adx: { enabled: true, period: 14, adxColor: '#e5e7eb', plusDIColor: '#22c55e', minusDIColor: '#ef4444' } }
  const OBV_ON = { obv: { enabled: true, color: '#9ca3af' } }
  const DON_ON = { donchian: { enabled: true, period: 20, color: 'rgba(96,165,250,0.5)' } }
  const ADX_INSTANCE = {
    instanceId: 'engine-test:adx', defId: 'adx', defVersion: 1,
    inputs: { period: 21, adxColor: '#e5e7eb', plusDIColor: '#22c55e', minusDIColor: '#ef4444' },
    placement: { target: 'pane' }, hidden: false,
  }
  const OBV_INSTANCE = {
    instanceId: 'engine-test:obv', defId: 'obv', defVersion: 1,
    inputs: { color: '#9ca3af' }, placement: { target: 'pane' }, hidden: false,
  }
  const DON_INSTANCE = {
    instanceId: 'engine-test:donchian', defId: 'donchian', defVersion: 1,
    inputs: { period: 55, color: 'rgba(96,165,250,0.5)' },
    placement: { target: 'price' }, hidden: false,
  }
  const RSI_ON_HERE = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
  const hover = (view, extraSeriesData) => settledLegend(view, crosshairAt(BARS, extraSeriesData))
  const onScale = (id) => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === id)
  const boundFor = (id) => bound().filter(b => b.defId === id)
  const bandNow = (id) => {
    const ctx = H.syncCalls.at(-1)
    expect(ctx, 'no sync happened — the band assertion would be vacuous').toBeTruthy()
    return ctx.paneMargins[id]
  }
  const guidesOn = (bindings) => {
    const owned = new Set(bindings.map(b => b.series))
    return H.priceLineCalls.filter(c => owned.has(c.series)).map(c => c.options)
  }

  it('all three are flipped, and none draws a second copy from a legacy block', () => {
    // The non-vacuity gate for the whole block, in both directions: flipped (so
    // the engine is the authority) AND drawn exactly once (so the deletion of the
    // hand-written blocks really happened rather than being guarded).
    for (const id of ['adx', 'obv', 'donchian']) {
      expect(ENGINE_OWNED.has(id), id + ' is not flipped').toBe(true)
      expect(ENGINE_OWNED.has(id), id + ' is not migrated').toBe(true)
    }
    draw({ indicators: { ...ADX_ON, ...OBV_ON, ...DON_ON } })
    expect(boundFor('adx'), 'the engine did not draw all three ADX lines').toHaveLength(3)
    expect(boundFor('obv'), 'the engine did not draw OBV').toHaveLength(1)
    expect(boundFor('donchian'), 'the engine did not draw all three Donchian lines').toHaveLength(3)
    // ⛔ THE DOUBLE-DRAW RAIL. Four series on the `adx` scale would mean the
    // legacy block is still drawing beside the engine — invisible in a pixel diff
    // (two identical lines on top of each other) and obvious here.
    expect(onScale('adx'), 'a fourth line on the adx scale — the legacy block survived').toHaveLength(3)
    expect(onScale('obv'), 'two OBV lines').toHaveLength(1)
    const donLines = H.addSeriesCalls.filter(
      c => c.options && c.options.color === DON_ON.donchian.color)
    expect(donLines, 'the Donchian channel is drawn twice').toHaveLength(3)
  })

  it('⭐ DONCHIAN\'S MIDDLE LINE IS LargeDashed, at the component', () => {
    // ⛔ THE ONE THING IN THIS TASK NO SERIES COUNT AND NO SCALE ASSERTION CAN
    // SEE. The shipped block built its three with `style: 0, 3, 0`; the
    // definition declared NO `lineStyle` on the `middle`, and
    // `pool.seriesOptionsForPlot` resolves an absent plot style to SOLID — so
    // the engine would have drawn the mid-line solid and every "three Donchian
    // lines" count above would still pass.
    draw({ indicators: { ...DON_ON } })
    const donLines = H.addSeriesCalls.filter(
      c => c.options && c.options.color === DON_ON.donchian.color)
    expect(donLines, 'no Donchian lines — this case is vacuous').toHaveLength(3)
    expect(donLines.map(c => c.options.lineStyle),
      'Donchian\'s mid-line lost its LargeDashed (3) — solid|solid|solid is what an omitted '
      + '`lineStyle` produces, and it is the same picture as its two edges').toEqual([0, 3, 0])
    // …and BB is the CONTROL, because it is the same band shape with the opposite
    // styling: dashed edges around a solid middle. A mix-up between the two
    // definitions would swap these two arrays and nothing else would notice.
    cleanup(); H.reset()
    draw({ indicators: { ...BB_CONTROL } })
    const bbLines = H.addSeriesCalls.filter(c => c.options && c.options.color === BB_CONTROL.bb.color)
    expect(bbLines.map(c => c.options.lineStyle), 'BB is the opposite shape').toEqual([2, 0, 2])
  })

  it('⭐ ADX\'s ONE guide sits on the ADX LINE, not on +DI or -DI', () => {
    // A guide is a `createPriceLine`, present in no binding and no manifest, so
    // no series assertion can see it move. Drawn on +DI it would be at the same
    // price, in the same colour, on the same scale — identical until the two
    // series are hidden independently, which is what the declutter toggle does.
    draw({ indicators: { ...ADX_ON } })
    const lines = boundFor('adx')
    expect(lines.map(b => b.plotKey)).toEqual(['adx', 'plusDI', 'minusDI'])
    expect(guidesOn([lines[0]]).map(g => g.price), 'the ADX line lost its guide').toEqual([25])
    expect(guidesOn([lines[1], lines[2]]), 'a guide landed on a directional line').toEqual([])
    const g = guidesOn([lines[0]])[0]
    expect(g.lineStyle, 'the guide changed dash').toBe(2)
    expect(g.lineWidth).toBe(1)
    expect(g.color).toBe('rgba(229,231,235,0.3)')
    expect(g.axisLabelVisible, 'the guide put a label on the axis').toBe(false)
    expect('title' in g, 'the guide gained a title the shipped call never passed').toBe(false)
    // …and the other two definitions draw NO guides at all, which is the half a
    // "one guide exists" count cannot state.
    expect(guidesOn(boundFor('obv'))).toEqual([])
    expect(guidesOn(boundFor('donchian'))).toEqual([])
  })

  it('⭐ ADX ARRIVING and DEPARTING mid-session: nothing → three lines, a guide and a band → nothing', () => {
    // ⛔ THE DIRECTION A USER ACTUALLY PERFORMS, and the one no parity case can
    // photograph. A band left reserved for a departed indicator is a permanently
    // short price pane; a band never reserved is the "oscillator drawn on top of
    // the volume bars" defect; an orphaned guide is a horizontal line at 25
    // across a pane that no longer holds an ADX.
    const off = {
      indicators: { ...BB_CONTROL, adx: { ...ADX_ON.adx, enabled: false } },
      indicatorInstances: [],
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(bound(), 'the control instance did not draw — every phase below is vacuous').toHaveLength(3)
    expect(bandNow('adx'), 'a band was reserved for an ADX nobody asked for').toBeUndefined()
    expect(onScale('adx'), 'something drew ADX while it was off').toHaveLength(0)

    const on = setIndicatorEnabled(off, 'adx', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(on)} />)
    const arrived = boundFor('adx')
    expect(arrived, 'arriving mid-session drew the wrong number of lines').toHaveLength(3)
    expect(bandNow('adx'), 'arriving mid-session reserved no band').toEqual({ top: 0.85, bottom: 0 })
    expect(guidesOn(arrived).map(g => g.price), 'arriving mid-session drew no guide').toEqual([25])
    expect(onScale('adx'), 'a fourth line appeared on the adx scale').toHaveLength(3)

    const offAgain = setIndicatorEnabled(on, 'adx', false, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(offAgain)} />)
    expect(boundFor('adx'), 'departing mid-session left a line behind').toHaveLength(0)
    for (const b of arrived) {
      expect(H.removedSeries, 'a departed ADX line is still on the chart').toContain(b.series)
    }
    expect(bandNow('adx'), 'departing mid-session left its band reserved').toBeUndefined()
  })

  it('⭐ OBV ARRIVING and DEPARTING mid-session — the AUTOSCALED band on 1e8 values', () => {
    // The autoscale seam on a REAL scale. `obv` declares no range at all, so the
    // scale options are `{autoScale: true}` with no `minimum`/`maximum` — and a
    // band that inherited a departed neighbour's frozen 0-100 would frame a
    // hundred-million-scale column inside a hundred points.
    const off = {
      indicators: { ...BB_CONTROL, obv: { ...OBV_ON.obv, enabled: false } },
      indicatorInstances: [],
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(bound()).toHaveLength(3)
    expect(bandNow('obv')).toBeUndefined()

    const on = setIndicatorEnabled(off, 'obv', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(on)} />)
    const arrived = boundFor('obv')
    expect(arrived, 'arriving mid-session drew nothing').toHaveLength(1)
    // ⭐ `paneMargins.PANES` gives obv `baseH: 0.13`, NOT the 0.15 every
    // oscillator before it in this phase had — so a band copied from mfi's case
    // would be wrong by two hundredths of the chart.
    expect(bandNow('obv'), 'arriving mid-session reserved the wrong band')
      .toEqual({ top: 0.87, bottom: 0 })
    expect(guidesOn(arrived), 'OBV drew a guide it has never had').toEqual([])
    // …and the DATA really is 1e8-scale, so the seam is not theoretical.
    const data = H.setDataCalls.filter(c => c.series === arrived[0].series).at(-1)
    expect(data, 'no data reached OBV').toBeTruthy()
    expect(Math.max(...data.data.map(p => Math.abs(p.value || 0)))).toBeGreaterThan(1e7)
    // ⭐ AND ITS ZERO SEED SURVIVES — bar 0 is `0`, not whitespace. A preserved
    // quirk, transcribed rather than corrected.
    expect(data.data[0], 'OBV\'s zero seed became whitespace')
      .toEqual({ time: data.data[0].time, value: 0 })

    const offAgain = setIndicatorEnabled(on, 'obv', false, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(offAgain)} />)
    expect(boundFor('obv'), 'departing mid-session left the line behind').toHaveLength(0)
    expect(H.removedSeries).toContain(arrived[0].series)
    expect(bandNow('obv'), 'departing mid-session left its band reserved').toBeUndefined()
  })

  it('⭐ DONCHIAN ARRIVING and DEPARTING mid-session — a PRICE OVERLAY reserves NO band', () => {
    // ⛔ THE ASYMMETRY THAT MAKES THIS ONE DIFFERENT FROM THE OTHER TWO, and the
    // one a copy-paste of them would get wrong: a price overlay shares the
    // CANDLES' pane and scale, so it must reserve NO band at all. A band reserved
    // for it would shorten the price pane for an indicator that draws inside it.
    const off = {
      indicators: { ...BB_CONTROL, donchian: { ...DON_ON.donchian, enabled: false } },
      indicatorInstances: [],
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(off)} />)
    expect(bound()).toHaveLength(3)
    const mainBefore = bandNow('main')

    const on = setIndicatorEnabled(off, 'donchian', true, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(on)} />)
    const arrived = boundFor('donchian')
    expect(arrived, 'arriving mid-session drew the wrong number of lines').toHaveLength(3)
    expect(bandNow('donchian'), 'a price overlay reserved a band').toBeUndefined()
    expect(bandNow('main'), 'the price pane moved for a price overlay').toEqual(mainBefore)
    for (const b of arrived) {
      expect(b.scaleId, 'a Donchian line landed off the candles\' scale').toBe('right')
    }
    // …and it is autoscale-EXCLUDED, which is the seam B3 Task 1 priced at 38,491
    // changed pixels: Donchian's edges are the window's extremes by construction,
    // so a line allowed to drive the main scale reframes every candle.
    const created = H.addSeriesCalls.filter(c => c.options && c.options.color === DON_ON.donchian.color)
    expect(created).toHaveLength(3)
    for (const c of created) {
      expect(typeof c.options.autoscaleInfoProvider).toBe('function')
      expect(c.options.autoscaleInfoProvider(),
        'a Donchian line is driving the candles\' autoscale').toBe(null)
    }

    const offAgain = setIndicatorEnabled(on, 'donchian', false, registry)
    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(offAgain)} />)
    expect(boundFor('donchian'), 'departing mid-session left a line behind').toHaveLength(0)
    for (const b of arrived) expect(H.removedSeries).toContain(b.series)
  })

  it('⭐ PROJECTED ↔ STORED, both directions, all three — the SAME series throughout', () => {
    // The second crossover, and the one every existing user is on: a blob with
    // only the legacy mirror is PROJECTED into instances at read time, and a
    // stored instance for the same definition must take over WITHOUT the pool
    // destroying and recreating the series (#2049), and without the projection
    // going on drawing a second copy beside it.
    for (const [id, instance, count] of [
      ['adx', ADX_INSTANCE, 3], ['obv', OBV_INSTANCE, 1], ['donchian', DON_INSTANCE, 3],
    ]) {
      cleanup(); H.reset()
      const projectedOnly = { indicators: { ...ADX_ON, ...OBV_ON, ...DON_ON } }
      const view = render(
        <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(projectedOnly)} />)
      const before = boundFor(id)
      expect(before, id + ': the projection drew the wrong number of lines').toHaveLength(count)
      expect(before[0].key, id + ': it was not the PROJECTED instance').toContain('legacy:' + id)
      const first = before.map(b => b.series)

      view.rerender(
        <StockChart sym="AAPL" tf="D" barsOverride={BARS}
          settingsOverride={legendAlways({ ...projectedOnly, indicatorInstances: [instance] })} />)
      const stored = boundFor(id)
      expect(stored, id + ': the stored instance drew the wrong number of lines').toHaveLength(count)
      expect(stored[0].key, id + ': the projection is still drawing beside the stored instance')
        .toContain(instance.instanceId)
      expect(stored.map(b => b.series), id + ': the hand-over recreated the series').toEqual(first)

      view.rerender(
        <StockChart sym="AAPL" tf="D" barsOverride={BARS}
          settingsOverride={legendAlways({ ...projectedOnly, indicatorInstances: [] })} />)
      const back = boundFor(id)
      expect(back, id + ': it vanished when the stored instance was removed').toHaveLength(count)
      expect(back[0].key, id + ': nothing projected it back').toContain('legacy:' + id)
      expect(back.map(b => b.series), id + ': the hand-over back recreated the series').toEqual(first)
      for (const s of first) {
        expect(H.removedSeries,
          id + ': the hand-over removed a series the pool should have absorbed').not.toContain(s)
      }
      view.unmount()
    }
  })

  it('⭐ #2049: a period change RESTYLES the same seven series, and the guide is not churned', () => {
    // The open LWC issue this branch is built around: mass `removeSeries` is a
    // 2-4 s main-thread block. A period change is the harder half — it changes
    // the NUMBERS, so a naive implementation recreates. ⚠️ OBV IS THE ODD ONE:
    // it declares no period at all, so its half of this case is a COLOUR, which
    // is written down here rather than left as an unexplained asymmetry.
    const base = {
      indicators: { ...ADX_ON, ...OBV_ON, ...DON_ON },
      indicatorInstances: [ADX_INSTANCE, OBV_INSTANCE, DON_INSTANCE],
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(base)} />)
    const before = bound().map(b => b.series)
    expect(before, 'nothing was drawn — this case is vacuous').toHaveLength(7)
    const createdBefore = H.addSeriesCalls.length
    const guidesBefore = H.priceLineCalls.length
    expect(guidesBefore, 'no guides at all — the churn assertion below is vacuous').toBe(1)

    view.rerender(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways({
      ...base,
      indicatorInstances: [
        { ...ADX_INSTANCE, inputs: { ...ADX_INSTANCE.inputs, period: 34, adxColor: '#00ff00' } },
        { ...OBV_INSTANCE, inputs: { color: '#0000ff' } },
        { ...DON_INSTANCE, inputs: { period: 89, color: '#ff00ff' } },
      ],
    })} />)

    expect(bound().map(b => b.series).sort(), 'a restyle destroyed and recreated a series')
      .toEqual([...before].sort())
    expect(H.addSeriesCalls.length, 'a restyle created a new series').toBe(createdBefore)
    expect(H.removedSeries.filter(s => before.includes(s)),
      'a restyle removed a series — this is exactly #2049').toHaveLength(0)
    // ⚠️ THE GUIDE DID NOT MOVE — 25 is a literal, not an input — so the guide
    // signature is unchanged and LWC (which has no "update a price line") is
    // asked for nothing.
    expect(H.priceLineCalls.length, 'a restyle re-created the guide').toBe(guidesBefore)
    // …and the NUMBERS really moved with the period, which is what tells a live
    // compute from a replay: a period appears in NO option object.
    const adxLine = boundFor('adx')[0]
    const adxData = H.setDataCalls.filter(c => c.series === adxLine.series).at(-1)
    expect(adxData.data.findIndex(p => Number.isFinite(p.value)),
      'ADX\'s period never reached the compute').toBe(67)
  })

  it('⛔ the declutter toggle reaches all seven — AND still hides the VOLUME series', () => {
    // ⭐ THIS IS THE FIRST PAINT AFTER THE HIDE-ALL REF ARRAY WAS **DELETED**
    // (not shortened — it had no indicator entries left). Two halves:
    //
    //   1. every engine series is reached, through the binding map AND through
    //      `binder.sync` — the second is what stops the ~1 Hz extended-hours
    //      re-assert from silently re-showing what the user just hid;
    //   2. THE VOLUME SERIES IS STILL HIDDEN. Volume was the FIRST entry in that
    //      array and it is not an indicator — no definition, no instance, no
    //      binding — so a `.forEach(set)` deletion takes it with it, and no pixel
    //      case can see that (the parity page presses no keys).
    const settings = {
      volume: { visible: true },
      indicators: { ...ADX_ON, ...OBV_ON, ...DON_ON },
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(settings)} />)
    const series = bound().map(b => b.series)
    expect(series, 'nothing was bound — this case is vacuous').toHaveLength(7)
    const volume = H.addSeriesCalls.find(
      c => c.options && c.options.priceFormat && c.options.priceFormat.type === 'custom')
    expect(volume, 'no volume series — half of this case is vacuous').toBeTruthy()
    expect(H.syncCalls.at(-1).indicatorsHidden).toBe(false)

    act(() => { fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' }) })
    for (const s of series) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === false).length,
        'a flipped indicator was missed by the declutter toggle').toBeGreaterThan(0)
    }
    expect(H.visibilityCalls.filter(v => v.series === volume.series && v.visible === false).length,
      'the VOLUME series was not hidden — it went with the deleted ref array').toBeGreaterThan(0)

    const before = H.syncCalls.length
    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS.slice(0, BARS.length - 1)}
        settingsOverride={legendAlways(settings)} />)
    expect(H.syncCalls.length, 'no further sync — the assertion below would be vacuous')
      .toBeGreaterThan(before)
    expect(H.syncCalls.at(-1).indicatorsHidden, 'the next paint would re-show them').toBe(true)

    act(() => { fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' }) })
    for (const s of [...series, volume.series]) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === true).length)
        .toBeGreaterThan(0)
    }
  })

  it('a settings round-trip survives BOTH allow-lists, and the chart follows', () => {
    // ⛔ TWO ALLOW-LISTS, AND A KEY MISSING FROM EITHER IS SILENTLY DROPPED ON
    // EVERY READ. `mergeChartSettings` is the per-key one; `mergeSettingsOverride`
    // is the second, which a grid cell's per-cell override goes through.
    const merged = mergeChartSettings(JSON.stringify({
      indicators: { ...ADX_ON, ...OBV_ON, ...DON_ON },
      indicatorInstances: [ADX_INSTANCE, OBV_INSTANCE, DON_INSTANCE],
    }))
    expect(merged.indicatorInstances).toEqual([ADX_INSTANCE, OBV_INSTANCE, DON_INSTANCE])
    // ⭐ ADX CARRIES THREE COLOURS — the widest row the allow-list used to have,
    // and the one where a dropped key is a line that renders in LWC's default
    // blue rather than not at all. B5 Task 9 moved that row onto the INSTANCE
    // and DESTROYED the section, so the claim is asserted on both sides.
    expect(Object.keys(merged.indicators)).toEqual(['volumeProfile'])
    const _byDef = Object.fromEntries(merged.indicatorInstances.map(i => [i.defId, i]))
    expect(_byDef.adx.inputs).toMatchObject(ADX_INSTANCE.inputs)
    expect(_byDef.obv.inputs).toMatchObject(OBV_INSTANCE.inputs)
    expect(_byDef.donchian.inputs).toMatchObject(DON_INSTANCE.inputs)

    const out = mergeSettingsOverride(merged, {
      indicatorInstances: [{ instanceId: 'engine-test:donchian', inputs: { period: 89 } }],
    })
    expect(out.indicatorInstances, 'the generic array path replaced the list').toHaveLength(3)
    expect(out.indicatorInstances.find(i => i.instanceId === 'engine-test:donchian').inputs)
      .toEqual({ ...DON_INSTANCE.inputs, period: 89 })
    expect(out.indicatorInstances.find(i => i.instanceId === 'engine-test:adx')).toEqual(ADX_INSTANCE)

    // …and the round-tripped blob draws it, once, with the patched period. The
    // period is read off the DATA, because it appears in no option object — a
    // longer Donchian period pushes the first finite bar further right.
    draw(out)
    const don = boundFor('donchian')
    expect(don, 'the round-tripped blob drew the wrong number of lines').toHaveLength(3)
    const donData = H.setDataCalls.filter(c => c.series === don[0].series).at(-1)
    expect(donData, 'no data reached Donchian — the period assertion below is vacuous').toBeTruthy()
    expect(donData.data.findIndex(p => Number.isFinite(p.value)),
      'the patched period never reached the compute').toBe(88)
  })

  it('the VOLUME-OVERLAY path, mid-session, for a THREE-SERIES definition', () => {
    // ⚠️ WHAT NO EARLIER TASK COULD DRIVE: every definition migrated before this
    // one binds ONE or TWO series, so "the instance relocated" and "a series
    // relocated" were the same sentence. ADX binds THREE on ONE scale, so a
    // relocation that moved the primary and left the two directional lines behind
    // would put +DI and -DI on a scale their own line has left.
    const overlaid = {
      volume: { visible: true },
      volumeOverlayIndicators: ['adx'],
      indicators: { ...ADX_ON },
    }
    const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(overlaid)} />)
    const onLeft = H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'left')
    expect(onLeft, 'the overlay path drew the wrong number of lines on the left axis').toHaveLength(3)
    for (const c of onLeft) expect(c.paneIndex, 'an overlaid line landed off the volume pane').toBe(1)
    const before = bound().map(b => b.series)
    expect(before).toHaveLength(3)

    view.rerender(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={legendAlways({ ...overlaid, volumeOverlayIndicators: [] })} />)
    const after = bound()
    expect(after, 'a line vanished when the oscillator left the volume pane').toHaveLength(3)
    // ⚠️ #2049, AND THE DIFFERENCE FROM LEGACY: the hand-written block DESTROYED
    // and recreated a series whose target scale changed (`ensureIndTarget`, now
    // deleted); the engine RELOCATES it.
    expect(after.map(b => b.series), 'the pool destroyed and recreated a line').toEqual(before)
    for (const s of before) expect(H.removedSeries).not.toContain(s)
    expect(H.moveToPaneCalls.length, 'nothing relocated').toBeGreaterThan(0)
    for (const b of after) {
      expect(b.scaleId, 'a line did not go back to its own named scale').toBe('adx')
    }
    // …and the guide came back with them, on the primary line and nowhere else.
    expect(guidesOn([after[0]]).map(g => g.price)).toEqual([25])
  })

  it('each of the three adds EXACTLY ONE chip — on the line a value is read off', async () => {
    // 🔴 THIS READ *"none of the three adds a legend chip, and the nine are still
    // the nine"*, transcribing the shipped behaviour for a FLIP task. Task 2
    // (`43efeff6`) is the task that changes it: ADX, OBV and Donchian drew SEVEN
    // lines between them and a user could name none of them.
    //
    // ⛔ AND THE HAZARD THE OLD NOTE NAMED IS EXACTLY WHAT THIS STILL GUARDS —
    // *"a `legend: {}` added in passing would put SEVEN new chips in the
    // legend"*. Seven series are hovered with the SAME value below and the
    // occurrence count is THREE, so the directional lines and the channel edges
    // staying chip-less is asserted, not assumed: the ADX line is the one a
    // trader reads a number off, and the Donchian BASIS is Donchian's.
    const CHIP_ON = { adx: ['adx'], obv: ['obv'], donchian: ['middle'] }
    for (const [id, keys] of Object.entries(CHIP_ON)) {
      expect(registry.getDefinition(id).plots.filter(p => p.legend).map(p => p.key), id)
        .toEqual(keys)
    }
    const view = draw({
      indicators: { ...RSI_ON_HERE.indicators, ...ADX_ON, ...OBV_ON, ...DON_ON },
    })
    const drawn = ['adx', 'obv', 'donchian'].flatMap(id => boundFor(id))
    expect(drawn, 'one of the three never drew — this case is vacuous').toHaveLength(7)
    const text = await hover(view, [
      [boundFor('rsi')[0].series, { value: 54.3 }],
      ...drawn.map(b => [b.series, { value: 42.5 }]),
    ])
    expect(text, 'the engine lane stopped drawing — the control chip is missing').toContain('RSI(14)')
    // ⭐ THE DECLARED DIFFERENCE, NAMED. `OBV 43` is 42.5 at ZERO decimals — the
    // controller's ruling, because OBV is a cumulative share count — and `DC` is
    // the one `legend.label` among the ten, because `shortName` is 'Donchian'.
    for (const chip of ['ADX(14) 42.5', 'OBV 43', 'DC 42.50']) {
      expect(text, chip + ' is missing from the legend').toContain(chip)
    }
    // …and the four lines that must stay chip-less really are: seven series were
    // hovered, three chips came back.
    for (const label of ['+DI', '-DI', 'Upper', 'Mid', 'Lower']) {
      expect(text, label + ' gained a chip — a second number for one indicator')
        .not.toContain(label)
    }
    // ⛔ TWO, NOT THREE, AND THE ARITHMETIC IS THE ASSERTION: `ADX(14) 42.5` and
    // `DC 42.50` both contain `42.5`, and `OBV 43` does not — 42.5 at ZERO
    // decimals is `43`. A chip on `plusDI`, `minusDI` or a channel edge is a
    // third occurrence and fails here even if its LABEL is something this file
    // never thought to list above.
    expect(text.split('42.5').length - 1,
      'a directional line or a channel edge grew a chip').toBe(2)
  })

  it('none of the three has a keyboard chord, and that is UNCHANGED by the flip', () => {
    // ⚠️ STATED RATHER THAN ASSUMED. The failure it guards against is a chord
    // added later that writes `cs.indicators.<id>` RAW and moves a number nothing
    // renders.
    expect(INDICATOR_CHORDS.map(c => c.defId).sort(), 'a chord was added or removed')
      .toEqual(['bb', 'macd', 'rsi', 'vwap'])
    for (const id of ['adx', 'obv', 'donchian']) {
      expect(INDICATOR_CHORDS.some(c => c.defId === id), id + ' gained a chord').toBe(false)
    }
  })

  it('⭐⭐ DONCHIAN IS INSERTED LAST AMONG THE FIVE PRICE OVERLAYS, on a real chart', () => {
    // ⛔ THE REASON THIS TASK COULD NOT BE REORDERED WITH TASK 6. LWC z-stacks by
    // INSERTION, and the engine draws its whole set contiguously at ONE call
    // site — so the order the five overlays reach `addSeries` is the order they
    // paint over each other, and it has to be the shipped one:
    // `bb, vwap, sar, ichimoku, donchian`. `migrateLegacyToInstances` walks the
    // REGISTRY, which is what makes that true for a blob written in any order.
    //
    // ⚠️ THE FIXTURE'S KEY ORDER IS DELIBERATELY THE REVERSE, so a migrator that
    // echoed `Object.keys(cs.indicators)` would look nothing like this.
    const BLOB = {
      indicators: {
        donchian: { enabled: true }, ichimoku: { enabled: true }, sar: { enabled: true },
        vwap: { enabled: true }, bb: { enabled: true },
      },
    }
    draw(BLOB, '5')
    const order = bound().map(b => b.defId).filter((id, i, a) => id !== a[i - 1])
    expect(order, 'the five price overlays are no longer inserted in registry order — every '
      + 'one of them shares the candles\' pane and scale, so this changes which line wins the '
      + 'pixel wherever two of them cross')
      .toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian'])
    expect(Object.keys(BLOB.indicators), 'the fixture blob is already in registry order, so this '
      + 'control cannot tell a registry walk from a key echo').not.toEqual(order)
    // …and every one of the five really is on the candles' scale, which is what
    // makes their relative order matter at all.
    for (const b of bound()) {
      expect(b.scaleId, b.defId + ' left the candles\' scale').toBe('right')
    }
  })
})


// ─── B5 TASK 10 · the right-click menu SURVIVES Flip C ───────────────────────
//
// The control audit's instruction was *"verify, do not assume"*. The harness
// above scans y and reads the region off the component's OWN payload rather than
// re-deriving the geometry, which is the property that should let it survive the
// cutover — but "should" is what this phase does not accept.
//
// So the double gains an OPT-IN pane model (`H.paneModel`) that builds its stack
// from the pane indices `addSeries` / `moveToPane` were actually given and sizes
// it by the stretch factors the binder actually wrote, and the same helper is run
// against it under `paneMode() === 'panes'`. Nothing in the helper changes.
describe('the context-menu harness under PANE_MODE panes', () => {
  it('still resolves an indicator region — from REAL pane rectangles this time', () => {
    __setPaneModeForTest('panes')
    try {
      H.paneModel = { stackPx: PLOT.height - 40 }   // minus the double's time axis
      const view = renderChart({
        settings: mergeChartSettings({ indicators: { rsi: { enabled: true } } }),
      })
      // The chart really did grow a second pane — otherwise the region below
      // could only have come from a band, and the case would prove nothing.
      expect(H.addSeriesCalls.some(c => (c.paneIndex || 0) > 0)
        || H.moveToPaneCalls.some(c => c.paneIndex > 0), 'no series ever reached a pane above 0').toBe(true)

      const sec = sectionOf(openContextMenu(view, { region: 'indicator', key: 'rsi' }), 'region')
      expect(sec.title).toBe(labelFor('rsi'))
      expect(sec.items[0].label).toBe(`Hide ${labelFor('rsi')}`)
    } finally {
      __setPaneModeForTest(null)
      H.paneModel = null
    }
  })

  it('and the price area is still the price area', () => {
    __setPaneModeForTest('panes')
    try {
      H.paneModel = { stackPx: PLOT.height - 40 }
      const view = renderChart({
        settings: mergeChartSettings({ indicators: { rsi: { enabled: true } } }),
      })
      const sec = sectionOf(openContextMenu(view, { region: 'price' }), 'region')
      expect(sec).toBeTruthy()
    } finally {
      __setPaneModeForTest(null)
      H.paneModel = null
    }
  })
})


// ─── B5 TASK 10 · what the CHART is told, under both modes ───────────────────
describe('the chart options StockChart builds under PANE_MODE panes', () => {
  // ⛔ VOLUME OFF, DELIBERATELY. The volume BAND is the one thing that lives in
  // pane 0 in both modes, so leaving it on would make the two rectangles differ
  // for a second reason and the comparison would stop being about the panes.
  const SETTINGS = () => mergeChartSettings({
    volume: { visible: false },
    indicators: { rsi: { enabled: true }, macd: { enabled: true } },
  })
  const opts = () => {
    expect(H.chartOptionsCalls.length, 'createChart was never called').toBeGreaterThan(0)
    return H.chartOptionsCalls[0]
  }

  it('the candles keep the LAYOUT\'S rectangle, not the bands one', async () => {
    const { computePaneLayout, paneStackHeightPx, SEPARATOR_PX } = await import('../paneLayout')

    /**
     * The last `scaleMargins` the CANDLES' OWN scale was actually written.
     *
     * ⛔ NOT `opts()`. The chart-options effect runs BEFORE the render path on the
     * first paint, so `paneLayoutRef` is still null there and `createChart` is
     * handed `NO_STACK_MAIN_MARGINS`. The render path re-asserts the rectangle on
     * the candles' own scale in the SAME pass that builds the layout — measured,
     * and the reason that write exists at all: a parity case photographs the FIRST
     * frame and nothing else.
     */
    const candleMargins = () => {
      const candleSeries = (H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries') || {}).series
      expect(candleSeries, 'no candle series was created').toBeTruthy()
      const writes = H.scaleApplyCalls.filter(
        c => c.series === candleSeries && c.options && c.options.scaleMargins)
      expect(writes.length, 'the candles were never re-asserted a scaleMargins').toBeGreaterThan(0)
      return writes[writes.length - 1].options.scaleMargins
    }

    // ⭐ B5 TASK 12 — THE ORACLE IS ONE LAYOUT, READ TWICE. It used to be
    // `computePaneMargins(csForPaneMarginsFromSettings(cs, …), false).main` for
    // the bands half and `computePaneLayout(csPanes, instances, …)` for the panes
    // half — two functions, two settings projections. Both retired: the layout
    // carries the band map AND the pane decomposition, off the same quantised
    // stack, and takes no `cs` at all.
    const instances = migrateLegacyToInstances(SETTINGS(), registry, ENGINE_OWNED)
    const layout = computePaneLayout(instances, {
      chartHeight: 300, hasVolumeBand: false, separatorPx: SEPARATOR_PX, firstPaneIndex: 1,
    })

    // ⭐ BANDS FIRST, AND EXPLICITLY PINNED — Task 12 flipped the constant, so this
    // is the mode the flip REVERSES to rather than the one that ships. It is the
    // control the panes answer is measured against, and it still has to be right:
    // reversal is one edit.
    __setPaneModeForTest('bands')
    let bandsMargins
    try {
      renderChart({ settings: SETTINGS() })
      bandsMargins = candleMargins()
      expect(bandsMargins, 'in bands mode pane 0 IS the plot area, so the candle rectangle is '
        + "the band map's own `main`").toEqual(layout.bands.main)
    } finally { __setPaneModeForTest(null) }

    cleanup(); H.reset()
    __setPaneModeForTest('panes')
    try {
      H.paneModel = { stackPx: 300 }
      renderChart({ settings: SETTINGS() })
      const panesMargins = candleMargins()
      // ⛔ AND IT IS A DIFFERENT FRACTION, BY CONSTRUCTION: pane 0 is shorter by
      // the oscillator stack, so the SAME ABSOLUTE PIXELS are a different
      // fraction of it. Reading `layout.bands.main` here would put the candles
      // back where a full-height pane 0 would have them.
      expect(panesMargins).not.toEqual(bandsMargins)
      expect(panesMargins).toEqual(layout.pane0.mainMargins)
      expect(paneStackHeightPx({ panes: () => [{ getHeight: () => 300 }] })).toBe(300)
    } finally { __setPaneModeForTest(null); H.paneModel = null }
  })

  it('declares the divider draggable — spec 6, and not merely the library default', () => {
    __setPaneModeForTest('panes')
    try {
      H.paneModel = { stackPx: 300 }
      renderChart({ settings: SETTINGS() })
      expect(opts().layout.panes.enableResize).toBe(true)
    } finally { __setPaneModeForTest(null); H.paneModel = null }
  })

  it('…and a FROZEN exhibit is still a static picture', () => {
    __setPaneModeForTest('panes')
    try {
      H.paneModel = { stackPx: 300 }
      renderChart({ settings: SETTINGS(), frozen: true })
      expect(opts().layout.panes.enableResize).toBe(false)
    } finally { __setPaneModeForTest(null); H.paneModel = null }
  })
})
