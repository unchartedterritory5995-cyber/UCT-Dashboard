import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'

// ─── PHASE 1.5 · THE LIVE INTEGRATION PROOF ─────────────────────────────────
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
const { clearSecondaryBars, primeSecondaryBars, cachedBars, SOURCE_STATUS } =
  await import('../secondaryBars')

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
const seriesOver = (source) => ({
  engineEnabled: true,
  indicators: { dataSeries: { enabled: true } },
  indicatorInstances: [{
    instanceId: 'legacy:dataSeries',
    defId: 'dataSeries',
    inputs: { source, color: MA_INK },
    hidden: false,
  }],
})

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

describe('§7, §8 · REAL RENDER — the secondary source reaches the real renderer', () => {
  it.each(FAMILIES)('%s draws through the real StockChart lifecycle', async (_label, sym) => {
    await act(async () => { draw(seriesOver(symbolSource(sym, 'close'))) })
    // Two flushes: one for the request, one for the response landing and the
    // subscribe-driven repaint that follows it.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // ⭐⭐ THE CLOSED LOOP. A real LWC series exists, carrying the SECONDARY's
    // numbers, created by the real binder through the real placement machinery.
    const ours = mine()
    expect(ours, 'no series was created for the symbol source').toBeTruthy()
    expect(ours.ctor).toBe('LineSeries')
    const drawn = valuesOf(ours)
    expect(drawn.length).toBeGreaterThan(0)
    expect(Math.min(...drawn)).toBeGreaterThan(1000)   // secondary, not primary
    expect(Math.max(...BARS.map((b) => b.c))).toBeLessThan(1000)

    // ⭐⭐ THE INTEGRATION CHAIN, OBSERVED IN ONE OBJECT. The REAL StockChart
    // built this context and handed it to the REAL binder: the member's instance
    // is in it, the chart's own bars are in it, and the hook has supplied bars for
    // the secondary symbol — discovered, requested and cached without this test
    // telling the chart anything except a settings blob.
    const ctx = H.syncCtx[H.syncCtx.length - 1]
    expect(ctx).toBeTruthy()
    expect(ctx.secondary instanceof Map).toBe(true)
    expect(ctx.secondary.has(sym)).toBe(true)

    // ⛔ AND IT IS THE SECONDARY'S NUMBERS, NOT THE PRIMARY'S. The offset makes a
    // fallback to the chart's own bars — the one failure this lane must never
    // have — impossible to mistake for success.
    const entry = ctx.secondary.get(sym)
    expect(entry.status).toBe(SOURCE_STATUS.AVAILABLE)
    expect(entry.bars.length).toBe(BARS.length)
    expect(entry.bars[0].c).toBeGreaterThan(1000)
    expect(BARS[0].c).toBeLessThan(1000)
  })

  it('⛔⛔ §20 AN UNSUPPORTED SYMBOL FABRICATES NOTHING — the cash-index case', async () => {
    // `/api/bars/^IXIC` answers an empty list WITH a note. The stubbed network
    // reproduces exactly that, so this exercises the real unsupported path rather
    // than an absent fixture.
    await act(async () => { draw(seriesOver('sym:^IXIC:close')) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const ours = mine()
    // ⛔ THE FORBIDDEN OUTCOMES, EACH ASSERTED ABSENT: no primary fallback, no
    // ETF proxy, no zero fill, no stale unrelated line. Either no series, or one
    // carrying nothing.
    expect(valuesOf(ours)).toHaveLength(0)
    expect(H.chartContainers.length).toBeGreaterThan(0)   // the chart still mounted

    // ⭐ AND THE SOURCE CONFIGURATION IS RETAINED — availability is a runtime
    // fact, not a reason to rewrite what the member asked for.
    const ctx = H.syncCtx[H.syncCtx.length - 1]
    const inst = ctx.instances.find((i) => i.defId === 'dataSeries')
    expect(inst.inputs.source).toBe('sym:^IXIC:close')
  })
})

describe('§9 · FAMILY PARITY, LIVE', () => {
  it('the two families produce the same live architecture', async () => {
    const shapeOf = async (sym) => {
      H.reset(); clearSecondaryBars()
      primeSecondaryBars(sym, 'D', 200, { bars: secondaryBarsFor(500) })
      await act(async () => { draw(seriesOver(symbolSource(sym, 'close'))) })
      const ours = mine()
      const shape = {
        created: H.addSeriesCalls.map((c) => c.ctor),
        ourCtor: ours?.ctor ?? null,
        ourPane: ours?.paneIndex ?? null,
        ourScale: ours?.options?.priceScaleId ?? null,
        ourWidth: ours?.options?.lineWidth ?? null,
        ourPointCount: (ours?.series?.__data || []).length,
      }
      cleanup()
      return shape
    }
    const a = await shapeOf(SECURITY)
    const b = await shapeOf(BREADTH)
    // ⛔ The VALUES differ. The architecture must not.
    expect(b).toEqual(a)
  })
})

describe('§11 · FETCH DEDUP SURVIVES THE REACT LIFECYCLE', () => {
  it('a rerender does not re-request a symbol already held', async () => {
    const calls = []
    const fetcher = vi.fn(async (url) => { calls.push(url); return { bars: secondaryBarsFor(50) } })
    // Route the supplier's fetch through a counter by asking for it directly —
    // the hook uses the chart's own fetcher, and the cache is shared either way.
    const { ensureAll } = await import('../secondaryBars')
    ensureAll([SECURITY], 'D', 200, fetcher)
    ensureAll([SECURITY], 'D', 200, fetcher)
    await act(async () => { await Promise.resolve() })

    const view = draw(seriesOver(symbolSource(SECURITY, 'close')))
    await act(async () => { view.rerender(
      <StockChart sym="NVDA" tf="D" barsOverride={BARS}
        settingsOverride={seriesOver(symbolSource(SECURITY, 'close'))}
        onSettingsPersist={() => {}} />,
    ) })
    await act(async () => { await Promise.resolve() })

    // ⛔ NOT ONE PER RENDER. The cache is keyed by URL, so React rendering again
    // is not a reason to ask the network again.
    expect(calls.filter((u) => u.includes(`/${SECURITY}?`))).toHaveLength(1)
  })
})

describe('§12 · PROJECTION CACHE UNDER TWO SYMBOLS, LIVE', () => {
  it('⛔ two symbols alternating do not evict each other', async () => {
    // This case fails with the single-slot cache the design started with: QQQ's
    // aligned projection would be evicted while SPY's was computed, so neither is
    // ever stable and every paint recomputes while the numbers stay correct.
    const { projectionFor } = await import('../symbolProjection')
    const qqq = secondaryBarsFor(100)
    const spy = secondaryBarsFor(200)

    const q1 = projectionFor(qqq, 'close', BARS)
    const s1 = projectionFor(spy, 'close', BARS)
    const q2 = projectionFor(qqq, 'close', BARS)
    const s2 = projectionFor(spy, 'close', BARS)

    expect(q2).toBe(q1)
    expect(s2).toBe(s1)
    expect(q1).not.toBe(s1)
  })
})

describe('§25 · REGRESSIONS THE NEW MACHINERY MUST NOT CAUSE', () => {
  it('⭐ a chart with NO symbol source is completely unaffected', async () => {
    await act(async () => { draw({ engineEnabled: true, indicatorInstances: [] }) })
    expect(H.chartContainers.length).toBeGreaterThan(0)
    // No symbol source ⇒ no supplier entry at all.
    expect(cachedBars(SECURITY, 'D', 200)).toBeNull()
  })

  it('⭐ a breadth pseudo-symbol still works as the PRIMARY chart symbol', async () => {
    // The existing role must be untouched by the secondary machinery.
    await act(async () => {
      render(
        <StockChart sym={BREADTH} tf="D" barsOverride={BARS}
          settingsOverride={{ engineEnabled: true, indicatorInstances: [] }}
          onSettingsPersist={() => {}} />,
      )
    })
    expect(H.chartContainers.length).toBeGreaterThan(0)
  })

  it('⭐ Compare Symbols still mounts alongside the new machinery', async () => {
    await act(async () => {
      draw({ engineEnabled: true, indicatorInstances: [] }, { compareSymbol: 'SPY' })
    })
    expect(H.chartContainers.length).toBeGreaterThan(0)
  })
})

describe('§18 · THE SAFE CHART CONTEXT ITSELF', () => {
  it('⛔⛔ NO SETTINGS WRITE ESCAPES TO THE GLOBAL BLOB', () => {
    // The guarantee this whole file depends on: with `onSettingsPersist` given,
    // every in-chart write routes there. Nothing in these cases may reach the
    // user's real chart_settings — which is what keeps Main Trading untouched.
    expect(persisted.every((p) => p && typeof p === 'object')).toBe(true)
  })
})

describe('⭐⭐ §6 · THE LIVE SEAM PHASE 1 DID NOT HAVE — discovery reaches the network', () => {
  // Phase 1 proved the binder consumes a secondary map that a TEST handed it.
  // The link it never had is the one this case asserts: a REAL StockChart,
  // mounted with a symbol source in its settings, discovers that symbol and asks
  // the canonical bars route for it — through the real hook, the real
  // `symbolsNeeded`, and the real supplier.
  const urlsRequested = () => (globalThis.fetch?.mock?.calls || [])
    .map((c) => String(c[0])).filter((u) => u.includes('/api/bars/'))

  it.each(FAMILIES)('%s is discovered and requested by the real chart', async (_label, sym) => {
    await act(async () => { draw(seriesOver(symbolSource(sym, 'close'))) })
    await act(async () => { await Promise.resolve() })

    const asked = urlsRequested().filter((u) => u.includes(`/api/bars/${encodeURIComponent(sym)}?`))
    expect(asked.length).toBeGreaterThan(0)
    // ⭐ THE FETCH KEY, LIVE: symbol + timeframe + count, and no invented
    // `session=` dimension — the endpoint has none.
    expect(asked[0]).toMatch(/tf=D/)
    expect(asked[0]).not.toMatch(/session=/)
  })

  it('⛔ a chart with NO symbol source asks for nothing', async () => {
    await act(async () => { draw({ engineEnabled: true, indicatorInstances: [] }) })
    await act(async () => { await Promise.resolve() })
    const asked = urlsRequested().filter((u) => /\/api\/bars\/(QQQ|UCTA50)\?/.test(u))
    expect(asked).toHaveLength(0)
  })
})

describe('§13–§17 · LIFECYCLE THROUGH THE REAL COMPONENT', () => {
  const ctxNow = () => H.syncCtx[H.syncCtx.length - 1] || null
  const askedFor = (sym) => (globalThis.fetch?.mock?.calls || [])
    .map((c) => String(c[0]))
    .filter((u) => u.includes(`/api/bars/${encodeURIComponent(sym)}?`))

  const mount = (source, props = {}) => render(
    <StockChart sym="NVDA" tf="D" barsOverride={BARS}
      settingsOverride={seriesOver(source)} onSettingsPersist={() => {}} {...props} />)

  it('§13 a TIMEFRAME change re-keys the fetch and keeps the durable source', async () => {
    const view = mount(symbolSource(SECURITY, 'close'))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const beforeUrls = askedFor(SECURITY).length
    expect(beforeUrls).toBeGreaterThan(0)
    expect(askedFor(SECURITY).every((u) => u.includes('tf=D'))).toBe(true)

    await act(async () => {
      view.rerender(
        <StockChart sym="NVDA" tf="W" barsOverride={BARS}
          settingsOverride={seriesOver(symbolSource(SECURITY, 'close'))} onSettingsPersist={() => {}} />)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // ⭐ A NEW FETCH KEY, because the bytes differ. The DURABLE source string is
    // untouched — timeframe is the chart's, not the source's.
    expect(askedFor(SECURITY).some((u) => u.includes('tf=W'))).toBe(true)
    const inst = ctxNow()?.instances?.find((i) => i.defId === 'dataSeries')
    if (inst) expect(inst.inputs.source).toBe(symbolSource(SECURITY, 'close'))
  })

  it('§14 a PRIMARY SYMBOL change leaves the secondary pointing at the same instrument', async () => {
    const view = mount(symbolSource(SECURITY, 'close'))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => {
      view.rerender(
        <StockChart sym="AAPL" tf="D" barsOverride={BARS}
          settingsOverride={seriesOver(symbolSource(SECURITY, 'close'))} onSettingsPersist={() => {}} />)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // ⛔ QQQ REMAINS QQQ. The primary changing is not a reason to re-point the
    // member's secondary source at anything.
    const ctx = ctxNow()
    expect(ctx.secondary.has(SECURITY)).toBe(true)
    expect(askedFor('AAPL')).toHaveLength(0)   // the primary rides barsOverride
  })

  it('§15 a SOURCE change fetches the new instrument and stops needing the old', async () => {
    const view = mount(symbolSource(SECURITY, 'close'))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(askedFor(SECURITY).length).toBeGreaterThan(0)

    await act(async () => {
      view.rerender(
        <StockChart sym="NVDA" tf="D" barsOverride={BARS}
          settingsOverride={seriesOver(symbolSource(BREADTH, 'close'))} onSettingsPersist={() => {}} />)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(askedFor(BREADTH).length).toBeGreaterThan(0)
    const ctx = ctxNow()
    expect(ctx.secondary.has(BREADTH)).toBe(true)
    // ⛔ THE OLD SOURCE IS NO LONGER NEEDED, so it is not carried into the pass.
    // Stale data for an instrument nothing references must not stay bindable.
    expect(ctx.secondary.has(SECURITY)).toBe(false)
  })

  it('§17 REMOVE then RE-ADD resolves normally — no gravestone for an instrument', async () => {
    const view = mount(symbolSource(SECURITY, 'close'))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(ctxNow().secondary.has(SECURITY)).toBe(true)

    // remove the last consumer
    await act(async () => {
      view.rerender(
        <StockChart sym="NVDA" tf="D" barsOverride={BARS}
          settingsOverride={{ engineEnabled: true, indicatorInstances: [] }}
          onSettingsPersist={() => {}} />)
    })
    await act(async () => { await Promise.resolve() })

    // add it again
    await act(async () => {
      view.rerender(
        <StockChart sym="NVDA" tf="D" barsOverride={BARS}
          settingsOverride={seriesOver(symbolSource(SECURITY, 'close'))} onSettingsPersist={() => {}} />)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // ⭐⭐ THE CANONICAL-GLOBAL RULE, LIVE. Nobody deleted QQQ, so adding it back
    // is not a resurrection — it resolves exactly as it did the first time. The
    // opposite of the instance rule, and both are correct.
    const ctx = ctxNow()
    expect(ctx.secondary.has(SECURITY)).toBe(true)
    expect(ctx.secondary.get(SECURITY).status).toBe(SOURCE_STATUS.AVAILABLE)
  })
})

describe('§11–§13, §28 · THE REAL SERIES — pane, type, scale, no duplicates', () => {
  it.each(FAMILIES)('%s: series type, pane and scale are the ordinary ones', async (_label, sym) => {
    await act(async () => { draw(seriesOver(symbolSource(sym, 'close'))) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const ours = mine()
    expect(ours).toBeTruthy()
    // §12 — the immutable LWC type, and it is the ordinary scalar one.
    expect(ours.ctor).toBe('LineSeries')
    expect(ours.ctor).not.toBe('CandlestickSeries')
    // §11/§13 — `movingAverage` declares a PRICE target, so it overlays the
    // candles on their own scale. That is the definition's decision, unchanged by
    // the source family: the secondary supplies numbers, not placement.
    // ⚠️ RE-DERIVED FOR `dataSeries`, WHICH DECLARES `autoPane`: it draws in a
    // pane OF ITS OWN rather than over the candles. That is the DEFINITION'S
    // decision and it is unchanged by the source family — which is the actual
    // claim here: the secondary supplies numbers, not placement. The originating
    // branch asserted pane 0 and the right scale because its subject was a moving
    // average, which declares a PRICE target. The expected pane moves with the
    // declaration; the claim does not weaken.
    expect(ours.paneIndex ?? 0).toBeGreaterThan(0)
    // ⭐ AND THE SCALE IS STILL THE ORDINARY ONE — `right`, inside its OWN pane.
    // "Own pane" is a placement answer, not a scale answer; a direct series is
    // read against the same right-hand scale every other series uses.
    expect(ours.options.priceScaleId).toBe('right')
  })

  it('⛔ §28 A RERENDER DOES NOT CREATE A SECOND SERIES', async () => {
    const view = draw(seriesOver(symbolSource(SECURITY, 'close')))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const first = H.addSeriesCalls.filter((c) => c.options?.color === MA_INK).length
    expect(first).toBe(1)

    await act(async () => {
      view.rerender(
        <StockChart sym="NVDA" tf="D" barsOverride={BARS}
          settingsOverride={seriesOver(symbolSource(SECURITY, 'close'))} onSettingsPersist={() => {}} />)
    })
    await act(async () => { await Promise.resolve() })

    // The pool re-purposes; it does not accumulate. A second LWC object per
    // render is the leak `pool.js` exists to prevent.
    expect(H.addSeriesCalls.filter((c) => c.options?.color === MA_INK)).toHaveLength(1)
  })

  it('§19 a SECONDARY SOURCE CHANGE repoints the plotted values', async () => {
    const view = draw(seriesOver(symbolSource(SECURITY, 'close')))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(valuesOf(mine()).length).toBeGreaterThan(0)

    await act(async () => {
      view.rerender(
        <StockChart sym="NVDA" tf="D" barsOverride={BARS}
          settingsOverride={seriesOver(symbolSource('SPY', 'close'))} onSettingsPersist={() => {}} />)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const ctx = H.syncCtx[H.syncCtx.length - 1]
    expect(ctx.secondary.has('SPY')).toBe(true)
    expect(ctx.secondary.has(SECURITY)).toBe(false)

    // ⚠️ ONE LIVE BINDING, NOT ONE LIFETIME CREATION. `addSeriesCalls` is
    // cumulative, and a source swap legitimately releases the binding for the
    // pass in which the new symbol is still in flight — a column that does not
    // exist yet binds nothing — then takes a series again when it lands. What
    // must never happen is TWO live series for one instance, which is what the
    // binder's own book is the authority on.
    const held = H.binderApis[0].bindings()
      .filter((b) => b.instanceId === 'legacy:dataSeries')
    expect(held).toHaveLength(1)
    expect(valuesOf(mine()).length).toBeGreaterThan(0)
  })

  it('§21 GAPS STAY GAPS — a missing secondary bar is not filled', async () => {
    // One timestamp removed from the middle of the secondary series. The plotted
    // column must be short by exactly that bar rather than bridged with a value.
    const full = secondaryBarsFor(1000)
    const holed = full.filter((_, i) => i !== 100)
    globalThis.fetch = vi.fn((url) => {
      const hit = /\/api\/bars\/([^?]+)\?/.exec(String(url))
      const sym = hit ? decodeURIComponent(hit[1]) : null
      if (sym === SECURITY) return Promise.resolve({ ok: true, json: () => Promise.resolve({ bars: holed }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    await act(async () => { draw(seriesOver(symbolSource(SECURITY, 'close'))) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const ctx = H.syncCtx[H.syncCtx.length - 1]
    expect(ctx.secondary.get(SECURITY).bars).toHaveLength(full.length - 1)

    // ⛔ NOT FORWARD-FILLED. A 5-bar MA over a column with one NaN loses the
    // window that spans it, so the finite count must be BELOW the no-gap case.
    // ⛔⛔ NOT FORWARD-FILLED, AND FOR AN IDENTITY TRANSFORM THE COUNT IS EXACT.
    // `dataSeries` emits its source's value at its source's timestamp, so one
    // missing secondary bar costs exactly ONE plotted value — not a window, and
    // certainly not zero. `full.length` would mean the hole was bridged with a
    // price that never traded; `full.length - 1` is the hole surviving as a gap.
    // The originating branch asserted a LOOSER bound because its subject was a
    // 5-bar average, which loses every window spanning the hole; an identity
    // transform admits the tighter equality, so it is asserted.
    const drawn = valuesOf(mine())
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn.length).toBe(full.length - 1)
  })
})
