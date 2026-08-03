// ─── THE MIGRATION GATE: WHAT A REAL STORED BLOB DOES AFTER THE FLIP ────────
//
// ⭐ THE ONE USERS ACTUALLY EXPERIENCE. Everything else in B3 measures the engine
// against the legacy renderer on settings a test wrote. This measures the
// SETTINGS THEY ALREADY HAVE: `chart_settings` is a JSON string in
// `user_preferences`, written months before the engine existed, and on flip day
// every one of them arrives with `indicators.rsi.enabled` and no instance
// anywhere. If Flip B is wrong for that shape it is wrong for everybody at once.
//
// Four realistic shapes, none of them invented for convenience:
//
//   1. THE JULY BLOB — a real capture from the owner's workspace (the same
//      literal `ChartsWorkspace.jsx` freezes as "UCT Default"), which carries
//      neither `engineEnabled` nor `indicatorInstances` because the engine did
//      not exist when it was taken.
//   2. A SHORT/LEGACY `overlays` ARRAY — three slots, from before the fourth was
//      added. `mergeChartSettings` merges overlays POSITIONALLY and pads from the
//      defaults, so a blob like this is not a hypothetical: it is what anyone who
//      saved settings before that slot landed still has.
//   3. A BLOB WITH TOMBSTONES — a user who deleted an indicator through a control
//      that already existed. "Off" has to survive the flip; the failure mode is
//      "I turned it off and it came back on refresh".
//   4. THE PRE-FLIP CROSSOVER — a stored instance under a NON-`legacy:` id (an
//      `?instances=` link, a grid cell's override) PLUS a still-true legacy
//      toggle. This one drew TWO RSI lines during development.
//
// ⚠️ EVERY CASE COMPARES THE POST-FLIP RENDER TO THE PRE-FLIP ONE BY
// RECONSTRUCTION, NOT BY MEMORY. "The same chart" means: the same number of
// series on the same scales, in the same bands. The band numbers come from
// `computePaneMargins(<the stored blob>)` — the pre-flip layout function, called
// on the pre-flip blob, unmodified — so a projection that quietly changed the
// layout fails here even though both sides went through the engine.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'

const H = vi.hoisted(() => ({
  addSeriesCalls: [],
  binderApis: [],
  syncCalls: [],
  reset() {
    H.addSeriesCalls.length = 0
    H.binderApis.length = 0
    H.syncCalls.length = 0
  },
}))

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor) => ({
    __ctor: ctor,
    setData: () => {}, update: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
    attachPrimitive: () => {}, detachPrimitive: () => {},
    priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    moveToPane: () => {}, getPane: () => ({ getHeight: () => 300 }),
  })
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
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
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

// The REAL binder, wrapped. A faked one would make every count below vacuous.
vi.mock('../binder', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    createBinder: (deps) => {
      const real = actual.createBinder(deps)
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

const CANVAS_2D_NOOPS = [
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
  'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform',
  'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData',
]
HTMLCanvasElement.prototype.getContext = function getContext() {
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of CANVAS_2D_NOOPS) ctx[m] = () => {}
  return ctx
}

beforeEach(() => {
  cleanup()
  H.reset()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

const { default: StockChart, ENGINE_FLIPPED_DEF_IDS } = await import('../../../StockChart')
const { mergeChartSettings, CHART_DEFAULTS } = await import('../../chartDefaults')
const { computePaneMargins } = await import('../../paneMargins')
const { uctDefaultChartSettings } = await import('../../../../pages/charts/ChartsWorkspace')
const { setIndicatorEnabled } = await import('../instanceControls')
const engineRegistry = await import('../nativeRegistry')

const BARS = bars200.bars
const BB_COLOUR = 'rgba(156,39,176,0.85)'

/** Render from a STORED BLOB — a JSON string, exactly as `usePreferences` hands
 *  it back — through the real `mergeChartSettings`. That merge is the thing a
 *  test written against an object literal skips, and it is where `engineEnabled`
 *  is decided (`parsed.engineEnabled === true`). */
const drawStored = (json) => render(
  <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={mergeChartSettings(json)} />,
)
const onScale = (id) => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === id)
const bbLines = () => H.addSeriesCalls.filter(c => c.options && c.options.color === BB_COLOUR)
const bound = () => (H.binderApis[0] ? H.binderApis[0].bindings() : [])
const bands = () => H.syncCalls.at(-1).paneMargins

// ── 1. THE JULY BLOB ────────────────────────────────────────────────────────
//
// Trimmed from the same capture `ChartsWorkspace.jsx` freezes, with RSI and BB
// turned ON — which is the state the flip has to survive. Note what is NOT here:
// `engineEnabled`, `indicatorInstances`, `settingsVersion`.
const JULY_BLOB = {
  chartType: 'candles',
  candles: { upColor: '#1ae51a', downColor: '#c41f2d' },
  background: '#0f0f0f',
  overlays: [
    { enabled: true, type: 'EMA', period: 9, color: '#4ade80' },
    { enabled: true, type: 'EMA', period: 20, color: '#f472b6' },
    { enabled: true, type: 'SMA', period: 50, color: '#60a5fa' },
    { enabled: true, type: 'SMA', period: 200, color: '#fb923c' },
  ],
  volume: { visible: true, separatePane: false, hvcEnabled: true },
  indicators: {
    rsi: { enabled: true, period: 14, color: '#7b68ee' },
    macd: { enabled: false, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    bb: { enabled: true, period: 20, stdDev: 2, color: BB_COLOUR },
    vwap: { enabled: false, color: '#26C6DA' },
    stoch: { enabled: false, kPeriod: 14, dPeriod: 3 },
  },
  preset: 'custom',
}

describe('the blob shapes themselves — without these the cases below prove nothing', () => {
  it('the July blob really is missing both engine keys', () => {
    expect(Object.prototype.hasOwnProperty.call(JULY_BLOB, 'engineEnabled')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(JULY_BLOB, 'indicatorInstances')).toBe(false)
    // …and the merge answers OFF for it, which is the whole reason a flipped id
    // cannot be gated on that flag.
    expect(mergeChartSettings(JSON.stringify(JULY_BLOB)).engineEnabled).toBe(false)
  })

  it('…and `CHART_DEFAULTS.engineEnabled` cannot heal it — the trap, asserted', () => {
    // ⛔ THE FACT THAT DECIDED THIS TASK'S DESIGN. `mergeChartSettings` reads the
    // PARSED BLOB, not the default, so an absent key is a hard OFF and flipping
    // the default changes nothing for anyone who has ever saved settings. Site #22
    // documents this for two menu items; it is true in the global.
    const before = CHART_DEFAULTS.engineEnabled
    try {
      CHART_DEFAULTS.engineEnabled = true
      expect(mergeChartSettings(JSON.stringify(JULY_BLOB)).engineEnabled,
        'flipping the default healed a stored blob — the premise of this file is wrong').toBe(false)
    } finally {
      CHART_DEFAULTS.engineEnabled = before
    }
  })

  it('rsi and bb are the flipped pair — the subject of every case here', () => {
    expect([...ENGINE_FLIPPED_DEF_IDS].sort()).toEqual(['bb', 'rsi'])
  })
})

describe('⭐ a stored legacy blob produces the SAME chart after the flip', () => {
  it('the July blob still draws RSI and Bollinger Bands, exactly once each', () => {
    drawStored(JSON.stringify(JULY_BLOB))
    expect(onScale('rsi'), 'RSI vanished, or was drawn twice').toHaveLength(1)
    expect(bbLines(), 'the three Bollinger lines are not three').toHaveLength(3)
    expect(bound(), 'the ENGINE is what drew them').toHaveLength(4)
  })

  it('…in the bands the PRE-FLIP layout function reserves for that same blob', () => {
    // The layout half, and the one a series count cannot see. `computePaneMargins`
    // is called here on the STORED blob directly — the pre-flip input, the
    // unmodified pre-flip function — so any drift introduced by `csForPaneMargins`
    // shows up as an inequality rather than as a chart that looks a bit different.
    const cs = mergeChartSettings(JSON.stringify(JULY_BLOB))
    drawStored(JSON.stringify(JULY_BLOB))
    expect(bands(), 'the projection changed the layout for a legacy blob')
      .toEqual(computePaneMargins(cs, true, new Set()))
    expect(bands().rsi, 'RSI lost its band').toEqual({ top: 0.85, bottom: 0 })
  })

  it('…and the four MA overlays are still there, so nothing else moved either', () => {
    // A cheap whole-chart sanity check: if the flip had changed the render plan
    // rather than one indicator, the overlays would be the first casualty.
    drawStored(JSON.stringify(JULY_BLOB))
    const overlayColours = ['#4ade80', '#f472b6', '#60a5fa', '#fb923c']
    for (const c of overlayColours) {
      expect(H.addSeriesCalls.filter(a => a.options && a.options.color === c),
        `the ${c} moving average stopped drawing`).toHaveLength(1)
    }
  })
})

describe('⭐ a SHORT/LEGACY overlays array — positional merge and padding', () => {
  // `mergeChartSettings` merges overlays POSITIONALLY over the defaults and pads
  // the tail (`chartDefaults.js:359`). A blob saved before the fourth slot landed
  // is three long, so this is the shape that proves the flip did not disturb the
  // padding — and that a padded slot's `enabled: false` default does not become a
  // fifth series.
  const SHORT = {
    ...JULY_BLOB,
    overlays: [
      { enabled: true, type: 'EMA', period: 9, color: '#4ade80' },
      { enabled: false, type: 'EMA', period: 20, color: '#f472b6' },
      { enabled: true, type: 'SMA', period: 50, color: '#60a5fa' },
    ],
  }

  it('the merge pads to the default length and keeps the stored slots', () => {
    const cs = mergeChartSettings(JSON.stringify(SHORT))
    expect(cs.overlays.length, 'the padding rule changed').toBe(CHART_DEFAULTS.overlays.length)
    expect(cs.overlays.slice(0, 3).map(o => o.enabled)).toEqual([true, false, true])
  })

  it('…and RSI and BB still draw once each on top of it', () => {
    drawStored(JSON.stringify(SHORT))
    expect(onScale('rsi')).toHaveLength(1)
    expect(bbLines()).toHaveLength(3)
    const cs = mergeChartSettings(JSON.stringify(SHORT))
    expect(bands()).toEqual(computePaneMargins(cs, true, new Set()))
  })
})

describe('⭐ a blob with TOMBSTONES — "off" survives the flip', () => {
  const DELETED = {
    ...JULY_BLOB,
    // The legacy toggle still says ON. That is not a contrived combination: the
    // toggle is what the pre-B3 renderer read, so deleting an indicator through
    // an engine-aware control never had to clear it.
    indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }],
  }

  it('a tombstoned RSI stays off, and gives its band back', () => {
    drawStored(JSON.stringify(DELETED))
    expect(onScale('rsi'), 'I turned it off and it came back on refresh').toHaveLength(0)
    expect(bands().rsi, 'a band was reserved for a deleted indicator').toBeUndefined()
    // …and BB, which was NOT deleted, is untouched.
    expect(bbLines(), 'deleting RSI took Bollinger Bands with it').toHaveLength(3)
  })

  it('…and the tombstone survives the settings ALLOW-LIST round trip', () => {
    // `mergeChartSettings` is an explicit allow-list — a key absent from its
    // return is silently dropped on every read — so a tombstone that did not
    // survive it would resurrect the indicator on the next page load, not on the
    // next paint, which is far harder to notice.
    const once = mergeChartSettings(JSON.stringify(DELETED))
    const twice = mergeChartSettings(JSON.stringify(once))
    expect(twice.indicatorInstances).toEqual([{ instanceId: 'legacy:rsi', deleted: true }])
  })
})

describe('⭐ the PRE-FLIP CROSSOVER — a stored instance plus a still-true toggle', () => {
  // 🐛 THIS SHAPE DREW TWO RSI LINES DURING DEVELOPMENT. The read-time migrator
  // reserves ids PER INSTANCE ID, so a stored instance under any id other than
  // `legacy:rsi` did not stop the toggle projecting a second one. `?instances=`
  // links, grid-cell overrides and share links all produce it.
  const CROSSOVER = {
    ...JULY_BLOB,
    engineEnabled: true,
    indicatorInstances: [{
      instanceId: 'grid-cell-3:rsi', defId: 'rsi', defVersion: 1,
      inputs: { period: 21, color: '#7b68ee' }, placement: { target: 'pane' }, hidden: false,
    }],
  }

  it('draws ONE RSI, from the stored instance, not two', () => {
    drawStored(JSON.stringify(CROSSOVER))
    expect(onScale('rsi'), 'the toggle projected a SECOND RSI over the stored one').toHaveLength(1)
    const rsi = bound().filter(b => b.defId === 'rsi')
    expect(rsi).toHaveLength(1)
    expect(rsi[0].key, 'the projection won over the stored instance').toContain('grid-cell-3:rsi')
  })

  it('…and the checkbox agrees with the chart about it', () => {
    // The same rule from the control side. `isIndicatorEnabled` says a LIVE
    // instance of the definition wins; the migrator has to agree or the panel and
    // the canvas disagree about a line the user is looking at.
    drawStored(JSON.stringify(CROSSOVER))
    expect(onScale('rsi')).toHaveLength(1)
  })
})

describe('⭐ the blob the FROZEN TEMPLATE writes — "UCT Default" and "New Layout"', () => {
  // Enumeration site #22. The frozen July capture hand-lists all fifteen indicator
  // sections and carries neither engine key; `uctDefaultChartSettings()` stamps
  // them from `CHART_DEFAULTS` at write time. This re-verifies it against the REAL
  // flip rather than trusting the earlier fix.
  it('is a valid stored blob that renders, with its indicators off as captured', () => {
    const json = uctDefaultChartSettings()
    const parsed = JSON.parse(json)
    expect(parsed.indicators.rsi.enabled, 'the capture changed').toBe(false)
    expect(parsed.indicators.bb.enabled).toBe(false)
    drawStored(json)
    expect(onScale('rsi'), 'the template turned RSI on by itself').toHaveLength(0)
    expect(bbLines()).toHaveLength(0)
  })

  it('⭐ …and a user who then TICKS the box gets a line, not a reserved empty band', () => {
    // ⛔ THE SITE-#22 FAILURE MODE, DRIVEN END TO END. The fix stamps
    // `engineEnabled` from the default (still `false`), so this only holds because
    // a FLIPPED definition runs the engine regardless of the flag. Before that
    // decision this case produced a checked checkbox, a reserved band and no line
    // — which is exactly what site #22 predicted and what makes it a ship-blocker
    // rather than a tidy-up.
    const cs = mergeChartSettings(uctDefaultChartSettings())
    const next = setIndicatorEnabled(cs, 'rsi', true, engineRegistry)
    render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={next} />)
    expect(onScale('rsi'), 'the checkbox is ticked and there is no line on the chart').toHaveLength(1)
    expect(bands().rsi, 'a line with no band').toEqual({ top: 0.85, bottom: 0 })
  })
})
