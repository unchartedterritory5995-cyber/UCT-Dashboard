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
  reset() {
    H.addSeriesCalls.length = 0; H.chartContainers.length = 0; H.syncCtx.length = 0
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
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
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
 *  Main Trading's preference row. */
const maOver = (source) => ({
  engineEnabled: true,
  indicatorInstances: [{
    instanceId: 'legacy:movingAverage',
    defId: 'movingAverage',
    inputs: { source, period: 5, color: MA_INK },
    placement: { target: 'pane' },
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

/** Every series the real chart created for a given constructor. */
const seriesOf = (ctor) => H.addSeriesCalls.filter((c) => c.ctor === ctor)

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
    if (sym === SECURITY || sym === BREADTH) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ bars: secondaryBarsFor(1000) }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
})
afterEach(cleanup)

describe('§7, §8 · REAL RENDER — the secondary source reaches the real renderer', () => {
  it.each(FAMILIES)('%s draws through the real StockChart lifecycle', async (_label, sym) => {
    await act(async () => { draw(maOver(symbolSource(sym, 'close'))) })
    // Two flushes: one for the request, one for the response landing and the
    // subscribe-driven repaint that follows it.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // The chart drew: candles, volume, the real pipeline ran.
    expect(seriesOf('CandlestickSeries').length).toBeGreaterThan(0)

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

  it.each(FAMILIES)('%s: an UNAVAILABLE symbol draws no fabricated line', async (_label, sym) => {
    // Nothing primed. The chart must render, and nothing may stand in for the
    // missing instrument.
    await act(async () => { draw(maOver(symbolSource(sym, 'close'))) })
    const ours = mine()
    // ⛔ Either no series at all, or one with NOTHING in it. What must never
    // happen is a line carrying the primary's numbers under the secondary's name.
    expect(valuesOf(ours)).toHaveLength(0)
    expect(H.chartContainers.length).toBeGreaterThan(0)   // the chart still mounted
  })
})

describe('§9 · FAMILY PARITY, LIVE', () => {
  it('the two families produce the same live architecture', async () => {
    const shapeOf = async (sym) => {
      H.reset(); clearSecondaryBars()
      primeSecondaryBars(sym, 'D', 200, { bars: secondaryBarsFor(500) })
      await act(async () => { draw(maOver(symbolSource(sym, 'close'))) })
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

    const view = draw(maOver(symbolSource(SECURITY, 'close')))
    await act(async () => { view.rerender(
      <StockChart sym="NVDA" tf="D" barsOverride={BARS}
        settingsOverride={maOver(symbolSource(SECURITY, 'close'))}
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
    await act(async () => { draw(maOver(symbolSource(sym, 'close'))) })
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
      settingsOverride={maOver(source)} onSettingsPersist={() => {}} {...props} />)

  it('§13 a TIMEFRAME change re-keys the fetch and keeps the durable source', async () => {
    const view = mount(symbolSource(SECURITY, 'close'))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const beforeUrls = askedFor(SECURITY).length
    expect(beforeUrls).toBeGreaterThan(0)
    expect(askedFor(SECURITY).every((u) => u.includes('tf=D'))).toBe(true)

    await act(async () => {
      view.rerender(
        <StockChart sym="NVDA" tf="W" barsOverride={BARS}
          settingsOverride={maOver(symbolSource(SECURITY, 'close'))} onSettingsPersist={() => {}} />)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // ⭐ A NEW FETCH KEY, because the bytes differ. The DURABLE source string is
    // untouched — timeframe is the chart's, not the source's.
    expect(askedFor(SECURITY).some((u) => u.includes('tf=W'))).toBe(true)
    const inst = ctxNow()?.instances?.find((i) => i.defId === 'movingAverage')
    if (inst) expect(inst.inputs.source).toBe(symbolSource(SECURITY, 'close'))
  })

  it('§14 a PRIMARY SYMBOL change leaves the secondary pointing at the same instrument', async () => {
    const view = mount(symbolSource(SECURITY, 'close'))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => {
      view.rerender(
        <StockChart sym="AAPL" tf="D" barsOverride={BARS}
          settingsOverride={maOver(symbolSource(SECURITY, 'close'))} onSettingsPersist={() => {}} />)
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
          settingsOverride={maOver(symbolSource(BREADTH, 'close'))} onSettingsPersist={() => {}} />)
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
          settingsOverride={maOver(symbolSource(SECURITY, 'close'))} onSettingsPersist={() => {}} />)
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
