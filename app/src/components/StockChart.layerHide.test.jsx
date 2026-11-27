// StockChart on a LAYER keep-alive board (2026-11-27, boardKeepAlive.js '2'; boardVisibility.js). The kept board stays
// mounted and laid out (no <Activity>): nothing is cleaned up at the hide or re-run at the show, so the chart's own work
// must PAUSE while its board's handle says hidden.
//   S1 (red first) a hide and a show: the same instance, autoSize untouched, the same subscriptions, no setData at show
//   S2 (red first) every adaptive frame loop under the chart is gated on the board (parked while hidden)
//   S3 (red first) a hidden layer board answers no key shortcut (the board in front may hold a chart of the same id)
//   S4 (red first) the chart's intervals read nothing from the chart while its board is hidden
//   S5 (red first) the chart's window.__uctChartDebug handle is gone while hidden and back at the show; a hide never
//      removes another chart's handle
//   S6 the <Activity> handle (no `layer`) is none of the above: its loops are ungated, its keys answer
//   S7 (red first) a hide and a show with nothing new re-render nothing under the chart (React Profiler)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'

const lw = vi.hoisted(() => ({ created: 0, removed: 0, setData: 0, autoSize: [], resize: [], last: null, subs: new Map(), reads: 0 }))
// every adaptive frame loop made under the chart, with the options it was made with
const loops = vi.hoisted(() => [])
vi.mock('./chart/adaptiveFrameLoop', async (orig) => {
  const m = await orig()
  return { ...m, createAdaptiveFrameLoop: (o) => { loops.push(o); return m.createAdaptiveFrameLoop(o) } }
})
// the chart's live subscriptions: every subscribe* adds the handler, its unsubscribe* removes it
const track = vi.hoisted(() => (obj) => {
  for (const k of Object.keys(obj)) {
    const m = /^(un)?subscribe(.+)$/.exec(k)
    if (!m) continue
    obj[k] = (fn) => { const s = lw.subs.get(m[2]) || new Set(); lw.subs.set(m[2], s); if (m[1]) s.delete(fn); else s.add(fn) }
  }
  return obj
})

vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => { lw.setData++ }, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    dataByIndex: () => { lw.reads++; return null }, getPane: () => { lw.reads++; return { getHeight: () => 300, paneIndex: () => 0 } },
    barsInLogicalRange: () => null, data: () => { lw.reads++; return [] }, seriesType: () => 'Candlestick',
  }
  // Same surface as the smoke harness, except timeScale() is a STABLE object whose
  // setVisibleLogicalRange forwards to the test spy (the smoke version is a no-op).
  const timeScale = track({
    applyOptions: () => {}, fitContent: () => {},
    setVisibleLogicalRange: (r) => {
      lw.last = r
    },
    getVisibleLogicalRange: () => { lw.reads++; return lw.last },
    setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
    resetTimeScale: () => {}, options: () => ({}), width: () => 600,
    // Extra surface the overlay children (ChartVLineOverlay et al.) touch — they only
    // mount once there are bars, so the smoke harness never needed these.
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
  })
  const chart = track({
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: (o) => { if (o && 'autoSize' in o) lw.autoSize.push(o.autoSize) }, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: (w, h, f) => { lw.resize.push([w, h, f]) }, remove: () => { lw.removed++ }, takeScreenshot: () => document.createElement('canvas'),
  })
  return {
    createChart: (container) => {
      lw.created++
      const el = document.createElement('div')   // the library's own element, inside the container
      container?.appendChild?.(el)
      chart.chartElement = () => el
      return chart
    },
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, createSeriesMarkers: () => ({ setMarkers: () => {} }),
    // Beyond the smoke harness: these are only reached once REAL bars flow through
    // the paint path (the smoke tests render with no bars, so they never touch them).
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
  }
})

// Realtime feeds open EventSource/WS — jsdom has neither. Neutralize them.
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
// A deep hook (useJ2ChartMarkers → useWatchlistAlerts) needs AuthProvider; stub it.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// jsdom has no IndexedDB; the bars cache layer would otherwise swallow the fetch.
vi.mock('../utils/barsIDB', () => ({
  idbGet: async () => null, idbPut: async () => {}, mergeDelta: (_a, b) => b,
}))

const BAR_DATES = Array.from({ length: 200 }, (_, i) =>
  new Date(Date.UTC(2026, 1, 20) - (199 - i) * 86400000).toISOString().slice(0, 10))
const FIXTURE_BARS = BAR_DATES.map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i }))

beforeEach(() => {
  cleanup()
  Object.assign(lw, { created: 0, removed: 0, setData: 0, autoSize: [], resize: [], last: null, subs: new Map(), reads: 0 })
  loops.length = 0
  try { localStorage.clear() } catch { /* jsdom always has it */ }
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars/') ? { ticker: 'AAPL', bars: FIXTURE_BARS } : {}),
  })))
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
})

const { default: StockChart } = await import('./StockChart')
const { Profiler } = await import('react')
const { BoardVisibilityContext, createBoardVisibility } = await import('./chart/boardVisibility')

// the chart's setInterval callbacks, captured (they never fire by themselves here: S4 runs them by hand)
const intervals = []
function Host({ vis, extra }) {
  const chart = <StockChart sym="AAPL" tf="D" chartId="layer-hide" barsOverride={FIXTURE_BARS} {...extra} />
  return vis === undefined ? chart : <BoardVisibilityContext.Provider value={vis}>{chart}</BoardVisibilityContext.Provider>
}
async function mounted(vis, extra = {}) {
  const view = render(<Host vis={vis} extra={extra} />)
  await waitFor(() => expect(lw.created).toBe(1))
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  return view
}
const setTo = (vis, state) => act(() => { vis.set(state) })
const subsOf = () => JSON.stringify([...lw.subs].map(([k, s]) => [k, s.size]).sort())
const press = (key) => act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })

describe('StockChart on a layer keep-alive board', () => {
  it('S1 (red first) a hide and a show keep the instance and its subscriptions', async () => {
    const vis = createBoardVisibility({ layer: true })
    const view = await mounted(vis)
    await waitFor(() => expect(lw.setData).toBeGreaterThan(0))
    const subs = subsOf()
    const autoSize = lw.autoSize.length
    await setTo(vis, 'hidden')
    expect(lw.removed, 'a layer hide removed the chart').toBe(0)
    expect(subsOf(), 'a layer hide changed the chart subscriptions').toBe(subs)
    const setData = lw.setData
    await setTo(vis, 'visible')
    expect(lw.created, 'a second chart was created at the show').toBe(1)
    expect(lw.autoSize.length, 'a layer hide or show touched autoSize').toBe(autoSize)
    expect(lw.setData - setData, 'setData at a show with nothing new').toBe(0)
    expect(subsOf()).toBe(subs)
    view.unmount()
    expect(lw.removed).toBe(1)
  })

  it('S2 (red first) every frame loop under the chart is gated on its board', async () => {
    const vis = createBoardVisibility({ layer: true })
    // the range selector turns on the chrome-placement loop as well (review: a mutant ungating it survived without it)
    const view = await mounted(vis, { showRangeSelector: true })
    expect(loops.length, 'NON-VACUITY: the chart runs its chrome loop and another').toBeGreaterThan(1)
    const ungated = loops.filter((o) => !o.gate).length
    expect(ungated, `${ungated} of ${loops.length} frame loops are not gated on the board`).toBe(0)
    await setTo(vis, 'hidden')
    expect(loops.every((o) => o.gate.paused()), 'a gate does not read the board hidden').toBe(true)
    await setTo(vis, 'visible')
    expect(loops.some((o) => o.gate.paused())).toBe(false)
    view.unmount()
  })

  it('S3 (red first) a hidden layer board answers no key shortcut', async () => {
    const vis = createBoardVisibility({ layer: true })
    const view = await mounted(vis)
    await waitFor(() => expect(lw.last).not.toBeNull())
    const before = JSON.stringify(lw.last)
    await press('+')
    const zoomed = JSON.stringify(lw.last)
    expect(zoomed, 'NON-VACUITY: + zooms the chart on a shown board').not.toBe(before)
    await setTo(vis, 'hidden')
    await press('+')
    await press('-')
    expect(JSON.stringify(lw.last), 'a key zoomed the chart of a hidden board').toBe(zoomed)
    view.unmount()
  })

  it('S4 (red first) the chart intervals read nothing while its board is hidden', async () => {
    const real = globalThis.setInterval.bind(globalThis)
    intervals.length = 0
    vi.spyOn(globalThis, 'setInterval').mockImplementation((fn) => { intervals.push(fn); return real(() => {}, 1e9) })
    const vis = createBoardVisibility({ layer: true })
    const view = await mounted(vis)
    const runAll = () => act(() => { for (const fn of [...intervals]) { try { fn() } catch { /* a callback's own failure */ } } })
    expect(intervals.length, 'NON-VACUITY: the chart runs intervals').toBeGreaterThan(0)
    lw.reads = 0
    await runAll()
    expect(lw.reads, 'NON-VACUITY: on a shown board the intervals read the chart').toBeGreaterThan(0)
    await setTo(vis, 'hidden')
    lw.reads = 0
    await runAll()
    expect(lw.reads, 'an interval read the chart of a hidden board').toBe(0)
    view.unmount()
    vi.restoreAllMocks()
  })

  it('S5 (red first) the debug handle is gone while hidden and back at the show', async () => {
    const vis = createBoardVisibility({ layer: true })
    const view = await mounted(vis)
    const own = window.__uctChartDebug?.['layer-hide']
    expect(own, 'NON-VACUITY: the chart registers its handle').toBeTruthy()
    await setTo(vis, 'hidden')
    expect(window.__uctChartDebug['layer-hide'], 'a hidden board kept its debug handle').toBeUndefined()
    await setTo(vis, 'visible')
    expect(window.__uctChartDebug['layer-hide']).toBe(own)
    const other = { other: true }
    window.__uctChartDebug['layer-hide'] = other
    await setTo(vis, 'hidden')
    expect(window.__uctChartDebug['layer-hide'], 'a hide removed the handle of another chart').toBe(other)
    act(() => { vis.dispose(); view.unmount() })
    expect(window.__uctChartDebug['layer-hide'], 'an unmount while hidden replaced another chart handle').toBe(other)
    delete window.__uctChartDebug['layer-hide']
  })

  // ⭐ (2026-11-27, the double-buffered next row: chart/useDoubleBuffer.js) a shadow pane's chart is CREATED hidden
  it('S8 (red first) a chart created on a hidden layer takes no debug handle; its first show takes it', async () => {
    window.__uctChartDebug = window.__uctChartDebug || {}
    const front = { front: true }
    window.__uctChartDebug['layer-hide'] = front
    const vis = createBoardVisibility({ layer: true })
    vis.state = 'hidden'
    const view = await mounted(vis)
    expect(window.__uctChartDebug['layer-hide'], 'a chart created hidden took the handle of the chart in front').toBe(front)
    delete window.__uctChartDebug['layer-hide']
    await setTo(vis, 'visible')
    expect(window.__uctChartDebug['layer-hide'], 'the first show did not take the handle').toBeTruthy()
    expect(window.__uctChartDebug['layer-hide']).not.toBe(front)
    await setTo(vis, 'hidden')
    expect(window.__uctChartDebug['layer-hide'], 'the hide after it kept the handle').toBeUndefined()
    view.unmount()
  })

  it("S9 (red first) a pass on a hidden layer is no group member's paint; on a shown one it is", async () => {
    const { PaintMemberContext, onChartPaint } = await import('./chart/paintLog')
    const seen = []
    onChartPaint((member, sym, bars, mode) => { seen.push({ member, sym, mode }) })
    const member = { m: 1 }
    const vis = createBoardVisibility({ layer: true })
    vis.state = 'hidden'
    const view = render(
      <PaintMemberContext.Provider value={member}>
        <Host vis={vis} />
      </PaintMemberContext.Provider>,
    )
    await waitFor(() => expect(lw.setData).toBeGreaterThan(0))
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(seen.filter((x) => x.member === member), 'a hidden pass was handed to the switch instrument').toEqual([])
    view.unmount()
    seen.length = 0
    const vis2 = createBoardVisibility({ layer: true })
    const view2 = render(
      <PaintMemberContext.Provider value={member}>
        <Host vis={vis2} />
      </PaintMemberContext.Provider>,
    )
    await waitFor(() => expect(seen.some((x) => x.member === member)).toBe(true))
    view2.unmount()
    onChartPaint(null)
  })

  it('S10 (review of #2922, F3) each pass reports what it committed: the symbol, timeframe, session and the bars handed in', async () => {
    const { LayerPaintContext } = await import('./chart/layerPaint')
    const seen = []
    const vis = createBoardVisibility({ layer: true })
    vis.state = 'hidden'
    const view = render(
      <LayerPaintContext.Provider value={(r) => { seen.push(r) }}>
        <Host vis={vis} />
      </LayerPaintContext.Provider>,
    )
    await waitFor(() => expect(lw.setData).toBeGreaterThan(0))
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    const last = seen[seen.length - 1]
    expect(last.sym).toBe('AAPL')
    expect(last.tf).toBe('D')
    expect(typeof last.ext).toBe('boolean')
    expect(last.bars, 'the report names the very bars array the pass committed').toBe(FIXTURE_BARS)
    expect(last.cutoff).toBe(null)
    view.unmount()
  })

  it('S11 (owner, 2026-11-27) the mode a hidden chart is prepared in: its cutoff reported, its rows and replay lock read, a replay lock restored', async () => {
    const { LayerPaintContext } = await import('./chart/layerPaint')
    const seen = []
    let api = null
    const cutoff = '2026-02-10'
    const view = render(
      <LayerPaintContext.Provider value={(r) => { seen.push(r) }}>
        <Host extra={{ replayCutoff: cutoff, onDateNavApi: (a) => { api = a } }} />
      </LayerPaintContext.Provider>,
    )
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    expect(seen[seen.length - 1].cutoff).toBe(cutoff)
    await waitFor(() => expect(api?.getDateMeta?.()).toBeTruthy())
    const m = api.getDateMeta()
    expect(m.rows).toBeGreaterThan(0)
    expect(m.replayLock).toBe(null)
    act(() => { api.restoreView({ fromRight: 40, toRight: 0, activeRange: null, locked: false, lock: null, replayLock: { barsFromRight: 1, width: 40 } }) })
    expect(api.getDateMeta().replayLock).toEqual({ barsFromRight: 1, width: 40 })
    act(() => { api.restoreView({ fromRight: 40, toRight: 0, activeRange: null, locked: false, lock: null, replayLock: null }) })
    expect(api.getDateMeta().replayLock).toBe(null)
    view.unmount()
  })

  it('S7 (red first) a hide and a show with nothing new re-render nothing under the chart', async () => {
    const vis = createBoardVisibility({ layer: true })
    let commits = 0
    const view = render(
      <Profiler id="chart" onRender={() => { commits++ }}><Host vis={vis} /></Profiler>,
    )
    await waitFor(() => expect(lw.created).toBe(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 300)) })
    const before = commits
    await setTo(vis, 'hidden')
    await setTo(vis, 'visible')
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expect(commits - before, 'a hide and a show re-rendered the chart').toBe(0)
    view.unmount()
  })

  it('S6 the <Activity> handle is none of the above', async () => {
    const vis = createBoardVisibility()
    const view = await mounted(vis)
    expect(loops.some((o) => o.gate)).toBe(false)
    await waitFor(() => expect(lw.last).not.toBeNull())
    vis.state = 'hidden'   // the <Activity> mode writes the state; without an <Activity> nothing is hidden here
    const before = JSON.stringify(lw.last)
    await press('+')
    expect(JSON.stringify(lw.last), 'an <Activity> handle paused the keys').not.toBe(before)
    vis.state = 'visible'
    view.unmount()
  })
})
