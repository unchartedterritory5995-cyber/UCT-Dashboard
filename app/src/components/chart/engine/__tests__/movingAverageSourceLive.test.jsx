import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'

// ─── PHASE 9 · THE AVERAGE DRAWS ITS OWN SOURCE ─────────────────────────────────
//
// ⭐⭐ THE QUESTION IS NOT "CAN THE BINDER RETURN A COLUMN". Phase 1 answered
// that. This file asks whether a canonical symbol source survives the REAL
// StockChart: its React lifecycle, its instance normalisation, its paint
// callback, its placement machinery, and a real `addSeries` call into a real
// pane.
//
// ⚠️ WHAT IS MOCKED, AND WHY THAT IS STILL A REAL PROOF. Only
// `lightweight-charts` — jsdom has no canvas, so there is no alternative — and
// the mock RECORDS every `addSeries(ctor, options, paneIndex)` rather than
// swallowing it, which is what lets these cases assert the real constructor, the
// real pane index and the real scale. Everything UCT owns is genuine: the real
// StockChart, the real `normalizeInstances`, the real binder, the real registry,
// the real placement, the real `sourceRef` parser and the real secondary-bars
// supplier. The renderer is a recorder, not a stand-in for our own logic.
//
// ⛔ AND EVERY RENDER CASE RUNS TWICE — once for an ordinary security and once
// for a breadth pseudo-symbol. That is the Alerts lesson: two defects there
// survived a green suite because every fixture used one variant.

const H = vi.hoisted(() => ({
  addSeriesCalls: [],
  chartContainers: [],
  syncCtx: [],
  binderApis: [],
  reset() {
    H.addSeriesCalls.length = 0; H.chartContainers.length = 0
    H.syncCtx.length = 0; H.binderApis.length = 0
  },
}))

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor, options) => {
    const s = {
      __ctor: ctor,
      __options: { ...(options || {}) },
      __data: [],
      __pane: null,
      setData: (d) => { s.__data = d || [] },
      update: (p) => { if (p) s.__data = [...s.__data.slice(0, -1), p] },
      applyOptions: (o) => { Object.assign(s.__options, o || {}) },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => s.__options,
      moveToPane: (i) => { s.__pane = i }, getPane: () => ({ getHeight: () => 300 }),
      dataByIndex: () => null,
    }
    return s
  }
  const timeScaleBase = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null, getVisibleRange: () => null, setVisibleRange: () => {},
    scrollToPosition: () => {}, scrollPosition: () => 0, timeToCoordinate: () => 0,
    coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
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
      const s = makeSeries(ctor, options)
      s.__pane = paneIndex ?? 0
      H.addSeriesCalls.push({ ctor, options, paneIndex, series: s })
      return s
    },
    addCustomSeries: (_i, options, paneIndex) => {
      const s = makeSeries('custom', options)
      H.addSeriesCalls.push({ ctor: 'custom', options, paneIndex, series: s })
      return s
    },
    removeSeries: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    // ⚠️ SEVERAL PANES, because an own-pane definition needs somewhere to go and
    // `resolvePlacement` fails closed when the layout has no pane for a key.
    panes: () => [0, 1, 2, 3].map(() => ({
      getHeight: () => 300, setHeight: () => {},
      getHTMLElement: () => document.createElement('div'),
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    })),
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: (el) => { H.chartContainers.push(el); return chart },
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries', AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
    BarSeries: 'BarSeries',
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

// ⚠️ THE SAME AMBIENT MOCKS `legendFromDefinitions` USES, and for the same
// reasons: the realtime hooks would open sockets, `useAuth` throws outside a
// provider, and jsdom has no 2D context. None of them stands in for anything
// this file is testing.
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
  const ctx = {
    canvas: null, measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    getImageData: () => ({ data: [] }),
  }
  for (const m of CANVAS_2D_NOOPS) ctx[m] = () => {}
  return ctx
}

// ⭐⭐ THE BINDER, WRAPPED NOT REPLACED. `sync` still runs for real — this only
// records the context `StockChart` hands it, which is the one place the whole
// integration chain can be observed in a single object: the instances the chart
// built, the bars it resolved, and the secondary map the hook supplied.
vi.mock('../binder', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createBinder: (args) => {
      const real = actual.createBinder(args)
      H.binderApis.push(real)
      return {
        ...real,
        sync: (ctx) => { H.syncCtx.push(ctx); return real.sync(ctx) },
      }
    },
  }
})

const StockChart = (await import('../../../StockChart')).default
const { symbolSource } = await import('../sourceRef')
const { clearSecondaryBars } = await import('../secondaryBars')

const BARS = bars200.bars

const SECURITY = 'QQQ'
const BREADTH = 'UCTA50'
const FAMILIES = [['ordinary security', SECURITY], ['breadth pseudo-symbol', BREADTH]]

/** Secondary bars on the primary's timeline, offset so a fallback to the
 *  primary's own numbers would be unmistakable. */
const secondaryBarsFor = (offset) => BARS.map((b) => ({ ...b, c: b.c + offset, v: b.v }))

/** A settings blob carrying ONE moving average over `source`.
 *
 *  ⛔ `settingsOverride` IS THE SAFE CHART CONTEXT. StockChart documents it as a
 *  partial blob merged for THIS instance only, where "overridden keys are
 *  restored from the un-overridden base before any settings write persists, so an
 *  override can never leak into the global blob". Paired with `onSettingsPersist`
 *  — which routes every in-chart write to a local sink — nothing here can reach
 *  Main Trading's preference row.
 *
 *  ⛔⛔ AND IT CARRIES NO `placement`, WHICH PHASE 1.6 LEARNED THE HARD WAY.
 *  An earlier fixture wrote `placement: { target: 'pane' }` from memory and the
 *  series silently never appeared. `paneLayout.paneTargetIds()` builds the
 *  pane-eligible set from each DEFINITION's declared `placement.target === 'pane'`
 *  and never consults an instance override; `movingAverage` declares
 *  `{ target: 'price' }`, so the layout allocates it no pane, `resolvePlacement`
 *  fails closed, and the binder gets no placement. Letting the definition choose
 *  is both correct and the only shape that draws. */
/**
 * A DIRECT SERIES over a canonical symbol — the P2.1 subject of this file.
 *
 * ⚠️ IT WAS A MOVING AVERAGE ON THE ORIGINATING BRANCH (`MA(sym:QQQ:close)`),
 * and the fixture is re-pointed rather than the cases rewritten, because not one
 * of them is about an average: they are about the SECONDARY-SOURCE LIFECYCLE —
 * discovery, the request, the cache, the re-key on a timeframe change, the
 * repaint when bars land, and the teardown. Every one of those claims holds for
 * any definition whose input is a symbol, and `dataSeries` is the one this
 * branch ships. `movingAverage` is a separate definition and is not ported here.
 */

const persisted = []
const draw = (settings, extra = {}) => render(
  <StockChart
    sym="NVDA" tf="D"
    barsOverride={BARS}
    settingsOverride={settings}
    onSettingsPersist={(next) => persisted.push(next)}
    {...extra}
  />,
)

/** ⚠️ THE SERIES THIS TEST OWNS, FOUND BY ITS COLOUR. A chart draws plenty of
 *  its own lines — the volume moving average alone carries values in the
 *  millions — so "some line has a big number on it" is not an assertion about
 *  anything. `MA_INK` is set on the instance below and nothing else uses it. */
const MA_INK = '#4ECDC4'
const mine = () => H.addSeriesCalls.find((c) => c.options && c.options.color === MA_INK) || null

/** Finite values a created series actually received. */
const valuesOf = (call) => (call?.series?.__data || [])
  .map((p) => p.value).filter(Number.isFinite)

beforeEach(() => {
  cleanup()
  H.reset()
  persisted.length = 0
  clearSecondaryBars()
  // ⭐⭐ THE NETWORK ANSWERS, which is what makes this an integration proof
  // rather than a priming exercise: the chart discovers the symbol, builds the
  // URL itself, asks for it, and the supplier caches what comes back. Nothing
  // here tells the chart which bar count to request — that is its own decision.
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const hit = /\/api\/bars\/([^?]+)\?/.exec(u)
    const sym = hit ? decodeURIComponent(hit[1]) : null
    if (sym === SECURITY || sym === BREADTH || sym === 'SPY') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ bars: secondaryBarsFor(1000) }) })
    }
    if (sym === '^IXIC') {
      // What the route really answers for a cash index: empty, WITH a reason.
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        bars: [], sealed: false, note: 'index history not served by /api/bars-history' }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
})
afterEach(cleanup)


// ─── PHASE 9 · THE BUG THIS FILE EXISTS FOR ─────────────────────────────────
//
// 🐛 A MEMBER SET `MA(QQQ)`, SENT IT TO QQQ's PANE, AND READ AAPL's AVERAGE.
// Measured in the browser on the merged master, through the real Chart Settings
// control. Not a rounding error and not a stale legend — a DIFFERENT INSTRUMENT
// under the label of the one they picked.
//
// ⭐⭐ AND THE ARITHMETIC WAS NEVER WRONG, WHICH IS WHY GREEN UNIT RAILS SAW
// NOTHING. `movingAverage`'s compute reads `ctx.source` and returns an EMPTY
// column when it is absent — it cannot fall back to the chart's bars even if it
// wanted to. The instance was thrown away one layer above it: `validateInstance`
// checked `placement.target` against `PLACEMENT_TARGETS` (`price`/`pane`/
// `volume`) and rejected `@inst:dataSeries:1`, the pane-by-owner form that
// `setInstanceDisplayTarget` had just written and `resolveDisplayTarget` already
// resolved. `normalizeInstances` dropped it, and then the SECOND half fired:
// with no live `movingAverage` instance left, StockChart's `liveStoredDefIds`
// no longer outranked the legacy toggle, so `migrateLegacyToInstances` projected
// `legacy:movingAverage` — inputs `{}`, source defaulting to `close` — into the
// gap. The chart drew a real, correct average OF THE WRONG SERIES.
//
// ⛔⛔ SO THE RAIL HAS TO BE INTEGRATED, AND THAT IS THE LESSON RATHER THAN A
// PREFERENCE. Every seam in that chain was individually correct: the writer, the
// resolver, the compute, the projection rule. The defect lived only in their
// COMPOSITION, and a test of any one of them passes while a member reads the
// wrong number. These cases mount the real StockChart and read what a real
// `addSeries` was handed.

/** ONE moving average over `source`, placed by `target`.
 *
 *  ⛔ `indicators.movingAverage.enabled: true` IS LOAD-BEARING, NOT DECORATION.
 *  It is the legacy toggle, and without it the projection that produced the
 *  wrong line cannot fire — the fixture would rail a silent series instead of
 *  the substituted one, which is the weaker of the two failures and not the one
 *  that shipped. */
const maOver = (source, target) => ({
  engineEnabled: true,
  indicators: { movingAverage: { enabled: true } },
  indicatorInstances: [{
    instanceId: 'inst:movingAverage:1',
    defId: 'movingAverage',
    inputs: { source, period: 5, maType: 'sma', color: MA_INK },
    ...(target ? { placement: { target } } : {}),
    hidden: false,
  }],
})

/** The QQQ series a `@inst:` placement names, plus the average that follows it.
 *  Two instances, because the pane-by-owner form is only expressible when there
 *  IS an owner — which is exactly the shape the member had on screen. */
const maFollowingSeries = (source, target = 'price') => ({
  engineEnabled: true,
  indicators: { movingAverage: { enabled: true } },
  indicatorInstances: [
    {
      instanceId: 'inst:dataSeries:1',
      defId: 'dataSeries',
      inputs: { source: symbolSource(SECURITY, 'close'), color: '#4f9cf9' },
      hidden: false,
    },
    {
      instanceId: 'inst:movingAverage:1',
      defId: 'movingAverage',
      inputs: { source, period: 5, maType: 'sma', color: MA_INK },
      // ⛔ EXPLICIT, AND 'price' BY DEFAULT HERE ON PURPOSE. A derived average
      // DEFAULTS into its source's pane (`resolveDisplayTarget`), and a pane
      // named by its owner does not render in this branch — `paneLayout` keys
      // panes by DEFINITION id and allocates none for a price-declared
      // definition, a limitation this file's neighbour records at its fixture.
      // These cases are about the SOURCE, so they pin the placement to one that
      // draws and leave the placement question to the case that owns it.
      placement: { target },
      hidden: false,
    },
  ],
})

/** The instances the REAL StockChart handed the REAL binder on the last paint. */
const boundInstances = () => {
  const ctx = H.syncCtx[H.syncCtx.length - 1]
  return (ctx && Array.isArray(ctx.instances) ? ctx.instances : [])
}

const settle = async (settings) => {
  await act(async () => { draw(settings) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

/** A plain 5-period simple average of the last finite closes, computed here so
 *  the expectation is arithmetic this file owns rather than a number copied out
 *  of a previous run. */
const sma5 = (values) => {
  const w = values.slice(-5)
  return w.reduce((a, b) => a + b, 0) / w.length
}

describe('§P9 · the configured source drives the RENDERED average', () => {
  it('a bar-field source averages THIS chart — MA(close)', async () => {
    await settle(maOver('close'))
    const drawn = valuesOf(mine())
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn[drawn.length - 1]).toBeCloseTo(sma5(BARS.map((b) => b.c)), 6)
  })

  it('⛔ a DIFFERENT bar field is a DIFFERENT line — MA(hlc3) is not MA(close)', async () => {
    await settle(maOver('close'))
    const closeMA = valuesOf(mine()).slice(-1)[0]
    cleanup(); H.reset()
    await settle(maOver('hlc3'))
    const hlc3MA = valuesOf(mine()).slice(-1)[0]

    // ⚠️ THE ASSERTION THE BROWSER MADE FIRST. Two averages that agree TO THE
    // CENT across two different bar fields is not a coincidence, it is a series
    // that never recomputed — which is precisely how the shipped bug read.
    expect(Number.isFinite(closeMA) && Number.isFinite(hlc3MA)).toBe(true)
    expect(hlc3MA).not.toBeCloseTo(closeMA, 6)
    expect(hlc3MA).toBeCloseTo(sma5(BARS.map((b) => (b.h + b.l + b.c) / 3)), 6)
  })

  it.each(FAMILIES)('%s — a SYMBOL source averages THAT symbol, not this chart', async (_l, sym) => {
    await settle(maOver(symbolSource(sym, 'close')))
    const drawn = valuesOf(mine())
    expect(drawn.length).toBeGreaterThan(0)
    // The supplier offsets the secondary by +1000, so a fallback to the chart's
    // own bars cannot be mistaken for success in either direction.
    expect(Math.min(...drawn)).toBeGreaterThan(1000)
    expect(Math.max(...BARS.map((b) => b.c))).toBeLessThan(1000)
    expect(drawn[drawn.length - 1]).toBeCloseTo(sma5(BARS.map((b) => b.c + 1000)), 6)
  })

  it('an INSTANCE-OUTPUT source averages that instance, and stays a distinct identity', async () => {
    await settle(maFollowingSeries('@inst:dataSeries:1::value'))
    const drawn = valuesOf(mine())
    expect(drawn.length).toBeGreaterThan(0)
    // dataSeries:1 IS QQQ (+1000), so its average is the secondary's average —
    // reached through the instance grammar rather than the symbol grammar.
    expect(drawn[drawn.length - 1]).toBeCloseTo(sma5(BARS.map((b) => b.c + 1000)), 6)

    // ⛔ AND THE TWO FAMILIES REMAIN SEPARATE IDENTITIES. The average names an
    // INSTANCE; the series it names holds a SYMBOL. Collapsing them into one
    // label-shaped relationship is the thing `sourceRef`'s grammar exists to
    // refuse, so the stored strings must still differ.
    const ma = boundInstances().find((i) => i.defId === 'movingAverage')
    const series = boundInstances().find((i) => i.defId === 'dataSeries')
    expect(ma.inputs.source).toBe('@inst:dataSeries:1::value')
    expect(series.inputs.source).toBe(symbolSource(SECURITY, 'close'))
  })
})

describe('§P9 · the pane-by-owner placement no longer eats the instance', () => {
  it('🐛 THE SHIPPED BUG: an @inst placement keeps the member instance', async () => {
    await settle(maFollowingSeries(symbolSource(SECURITY, 'close'), '@inst:dataSeries:1'))
    const ids = boundInstances().map((i) => i.instanceId)

    // ⭐ The member's instance survived the read path…
    expect(ids).toContain('inst:movingAverage:1')
    // …and the legacy toggle did NOT get to substitute its own average for it.
    expect(ids).not.toContain('legacy:movingAverage')
    expect(boundInstances().filter((i) => i.defId === 'movingAverage')).toHaveLength(1)

    // ⛔⛔ AND THE SURVIVOR IS THE ONE THE MEMBER CONFIGURED. `legacy:movingAverage`
    // carries `inputs: {}` — an empty input bag whose source defaults to `close`
    // — so this is the assertion that separates "an MA is on the chart" from "the
    // MA the member asked for is on the chart". They looked identical in the
    // legend and differed by 400 points.
    const ma = boundInstances().find((i) => i.defId === 'movingAverage')
    expect(ma.inputs.source).toBe(symbolSource(SECURITY, 'close'))
    expect(ma.placement.target).toBe('@inst:dataSeries:1')
  })

  it('an @inst placement is ACCEPTED by validation, an unknown target still is not', async () => {
    const { validateInstance } = await import('../instances')
    const base = { instanceId: 'x', defId: 'movingAverage', inputs: {}, hidden: false }

    expect(validateInstance({ ...base, placement: { target: '@inst:dataSeries:1' } }).ok).toBe(true)
    // ⛔ THE GRAMMAR, NOT THE REFERENT — an owner that does not exist is a
    // PRESERVED orphan reported "Pane unavailable", never a dropped instance.
    expect(validateInstance({ ...base, placement: { target: '@inst:gone:9' } }).ok).toBe(true)

    // …and the vocabulary did not simply fall open.
    expect(validateInstance({ ...base, placement: { target: 'orbit' } }).ok).toBe(false)
    expect(validateInstance({ ...base, placement: { target: '@' } }).ok).toBe(false)
  })

  it('an unavailable explicit source draws NOTHING — it never falls back to this chart', async () => {
    // `^IXIC` is served empty WITH a note; the average of a source that has no
    // values is a gap, and a gap must not become "the chart's own close".
    await settle(maOver('sym:^IXIC:close'))
    const ours = mine()
    const drawn = ours ? valuesOf(ours) : []
    const chartMA = sma5(BARS.map((b) => b.c))
    expect(drawn.some((v) => Math.abs(v - chartMA) < 1e-6)).toBe(false)
    expect(drawn.length).toBe(0)
  })

  it('a HIDDEN source still computes — visibility is ink, not existence', async () => {
    const s = maFollowingSeries('@inst:dataSeries:1::value')
    s.indicatorInstances[0].hidden = true          // QQQ drawn nowhere…
    await settle(s)
    const drawn = valuesOf(mine())
    // …and its average is still a real line over the secondary's numbers.
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn[drawn.length - 1]).toBeCloseTo(sma5(BARS.map((b) => b.c + 1000)), 6)
  })

  it('a LIVE source change recomputes the SAME instance — the memo is not stale', async () => {
    // ⭐⭐ ONE MOUNT, RE-RENDERED — AND THAT IS THE WHOLE POINT. Unmounting and
    // drawing again builds a fresh binder with an empty `computeMemo`, so it
    // would pass with the source left out of the memo key entirely. A member
    // does not remount the chart; they change a dropdown on a live one, which is
    // this.
    const chart = (settings) => (
      <StockChart
        sym="NVDA" tf="D"
        barsOverride={BARS}
        settingsOverride={settings}
        onSettingsPersist={(next) => persisted.push(next)}
      />
    )
    let view
    await act(async () => { view = render(chart(maOver('close'))) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const first = valuesOf(mine()).slice(-1)[0]
    expect(first).toBeCloseTo(sma5(BARS.map((b) => b.c)), 6)

    // The same instanceId, a different source — what the Chart Settings control
    // writes when a member picks another symbol.
    await act(async () => { view.rerender(chart(maOver(symbolSource(SECURITY, 'close')))) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const latest = [...H.addSeriesCalls].reverse()
      .find((c) => c.options && c.options.color === MA_INK)
    const second = valuesOf(latest).slice(-1)[0]
    expect(second).toBeCloseTo(sma5(BARS.map((b) => b.c + 1000)), 6)
    expect(second).not.toBeCloseTo(first, 6)
  })
})
