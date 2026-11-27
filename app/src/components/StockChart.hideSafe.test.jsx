// StockChart keeps its chart through a board HIDE (2026-11-27, board keep-alive Stage 1, behind the workspace's flag:
// no provider, no change). The keep-alive hides the previous board with React's <Activity mode="hidden">, which runs
// every effect cleanup; StockChart's unmount cleanup removed the chart, so a return re-created it (creation, series,
// setData, framing: about 40 of a mount's 50 ms per chart on the owner's board). The workspace hands each kept board ONE
// visibility object (BoardVisibilityContext) and sets its state before the commit that hides, shows or disposes it.
//   H1 (red first) a hide keeps the chart (no remove), turns autoSize off; the show keeps the same instance (no second
//      createChart) and turns autoSize back on
//   H2 a true unmount (state 'visible' or 'disposed') still removes the chart
//   H3 the show calls no setData when no new data arrived while hidden
//   H4 a device-pixel-ratio change while hidden forces one resize at show; an unchanged ratio forces none
//   H5 without a provider (the flag off) a hide destroys the chart exactly as before
//   H6 (red first) the chart's window.__uctChartDebug handle is gone while hidden and back at show; a hide never removes
//      a handle another chart (same widget id, the board in front) registered meanwhile
//   H7 (red first) a subtree UNMOUNTED while its handle says 'hidden' (the workspace leaving, grid mode) still
//      destroys the chart: only a chart whose element is still in the document is kept
//   H8 (red first, review of #2880) a board deleted AFTER an <Activity> hide runs no cleanup again: the handle's
//      dispose() removes the kept chart, exactly once
//   H9 a shown chart is not torn down by its handle later (the show took the teardown back)
//   H10 a hide then a show leaves the chart's subscriptions and the window's listeners exactly as a fresh mount
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { Activity } from 'react'

const lw = vi.hoisted(() => ({ created: 0, removed: 0, setData: 0, autoSize: [], resize: [], last: null, subs: new Map() }))
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
    dataByIndex: () => null, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
    barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
  }
  // Same surface as the smoke harness, except timeScale() is a STABLE object whose
  // setVisibleLogicalRange forwards to the test spy (the smoke version is a no-op).
  const timeScale = track({
    applyOptions: () => {}, fitContent: () => {},
    setVisibleLogicalRange: (r) => {
      lw.last = r
    },
    getVisibleLogicalRange: () => lw.last,
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
  Object.assign(lw, { created: 0, removed: 0, setData: 0, autoSize: [], resize: [], last: null, subs: new Map() })
  try { localStorage.clear() } catch { /* jsdom always has it */ }
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars/') ? { ticker: 'AAPL', bars: FIXTURE_BARS } : {}),
  })))
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
})

const { default: StockChart } = await import('./StockChart')
const { BoardVisibilityContext, createBoardVisibility } = await import('./chart/boardVisibility')

function Host({ vis, mode }) {
  const chart = <StockChart sym="AAPL" tf="D" chartId="hide-safe" barsOverride={FIXTURE_BARS} />
  const body = <Activity mode={mode}>{chart}</Activity>
  return vis === undefined ? body : <BoardVisibilityContext.Provider value={vis}>{body}</BoardVisibilityContext.Provider>
}
async function mounted(vis) {
  const view = render(<Host vis={vis} mode="visible" />)
  await waitFor(() => expect(lw.created).toBe(1))
  return view
}
const hide = (view, vis) => act(() => { if (vis) vis.state = 'hidden'; view.rerender(<Host vis={vis} mode="hidden" />) })
const show = (view, vis) => act(() => { if (vis) vis.state = 'visible'; view.rerender(<Host vis={vis} mode="visible" />) })

describe('StockChart keeps its chart through a board hide', () => {
  it('H1 (red first) a hide keeps the chart and the show keeps the same instance', async () => {
    const vis = createBoardVisibility()
    const view = await mounted(vis)
    await hide(view, vis)
    expect(lw.removed, 'the chart was removed on a hide').toBe(0)
    expect(lw.autoSize.at(-1), 'autoSize left on while hidden').toBe(false)
    await show(view, vis)
    expect(lw.created, 'a second chart was created at show').toBe(1)
    expect(lw.removed).toBe(0)
    expect(lw.autoSize.at(-1), 'autoSize not back on at show').toBe(true)
    view.unmount()
  })

  it('H2 a true unmount still removes the chart', async () => {
    const vis = createBoardVisibility()
    const view = await mounted(vis)
    await hide(view, vis)
    await show(view, vis)
    act(() => { vis.state = 'disposed'; view.unmount() })
    expect(lw.removed).toBe(1)
    const vis2 = createBoardVisibility()
    lw.created = 0
    const view2 = await mounted(vis2)
    view2.unmount()
    expect(lw.removed, 'a visible board unmounted kept its chart').toBe(2)
  })

  it('H3 the show calls no setData when no new data arrived', async () => {
    const vis = createBoardVisibility()
    const view = await mounted(vis)
    await waitFor(() => expect(lw.setData).toBeGreaterThan(0))
    await hide(view, vis)
    const before = lw.setData
    await show(view, vis)
    expect(lw.setData - before, 'setData calls at a show with nothing new').toBe(0)
    view.unmount()
  })

  it('H4 a device-pixel-ratio change while hidden forces one resize at show; none otherwise', async () => {
    const vis = createBoardVisibility()
    const view = await mounted(vis)
    await hide(view, vis)
    await show(view, vis)
    expect(lw.resize.length, 'a forced resize with the ratio unchanged').toBe(0)
    await hide(view, vis)
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 })
    await show(view, vis)
    expect(lw.resize.length, 'no resize after the ratio changed while hidden').toBe(1)
    expect(lw.resize[0][2]).toBe(true)
    view.unmount()
  })

  it('H5 without a provider a hide destroys the chart as before', async () => {
    const view = await mounted(undefined)
    await hide(view, undefined)
    expect(lw.removed).toBe(1)
    view.unmount()
  })

  it('H6 (red first) the debug handle is gone while hidden, back at show, and the handle of another chart is never removed', async () => {
    const vis = createBoardVisibility()
    const view = await mounted(vis)
    const own = window.__uctChartDebug?.['hide-safe']
    expect(own, 'NON-VACUITY: the chart registered its handle').toBeTruthy()
    await hide(view, vis)
    expect(window.__uctChartDebug['hide-safe'], 'a hidden chart left its handle registered').toBeUndefined()
    await show(view, vis)
    expect(window.__uctChartDebug['hide-safe']).toBe(own)
    const other = { other: true }
    window.__uctChartDebug['hide-safe'] = other           // the board in front registered the same id
    await hide(view, vis)
    expect(window.__uctChartDebug['hide-safe'], 'a hide removed the handle of another chart').toBe(other)
    act(() => { vis.state = 'disposed'; view.unmount() })
    expect(window.__uctChartDebug['hide-safe'], 'an unmount removed the handle of another chart').toBe(other)
    delete window.__uctChartDebug['hide-safe']
  })

  it('H7 (red first) an unmount while the handle says hidden still destroys the chart', async () => {
    const vis = createBoardVisibility()
    const view = await mounted(vis)
    act(() => { vis.state = 'hidden'; view.unmount() })
    expect(lw.removed, 'a chart unmounted under a hidden handle was kept (a leak)').toBe(1)
  })

  it('H8 (red first) a board deleted after its hide: dispose() removes the kept chart, exactly once', async () => {
    const vis = createBoardVisibility()
    const view = await mounted(vis)
    await hide(view, vis)
    expect(lw.removed).toBe(0)
    act(() => { vis.dispose(); view.unmount() })
    expect(lw.removed, 'the kept chart outlived its disposed board (a leak)').toBe(1)
  })

  it('H9 a shown chart is not torn down by its handle later', async () => {
    const vis = createBoardVisibility()
    const view = await mounted(vis)
    await hide(view, vis)
    await show(view, vis)
    act(() => { vis.dispose() })
    expect(lw.removed, 'a stale teardown removed the chart on screen').toBe(0)
    view.unmount()
    expect(lw.removed).toBe(1)
  })

  it('H10 a hide then a show leaves the subscriptions and listeners of a fresh mount', async () => {
    const live = new Map()
    const add = window.addEventListener.bind(window)
    const rem = window.removeEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((t, f, o) => { const s = live.get(t) || new Set(); live.set(t, s); s.add(f); return add(t, f, o) })
    vi.spyOn(window, 'removeEventListener').mockImplementation((t, f, o) => { live.get(t)?.delete(f); return rem(t, f, o) })
    const counts = () => JSON.stringify({
      subs: [...lw.subs].map(([k, s]) => [k, s.size]).sort(),
      win: [...live].map(([k, s]) => [k, s.size]).filter(([, n]) => n).sort(),
    })
    const vis = createBoardVisibility()
    const view = await mounted(vis)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    const fresh = counts()
    await hide(view, vis)
    await show(view, vis)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(counts(), 'a hide and a show changed what the chart is subscribed to').toBe(fresh)
    view.unmount()
    vi.restoreAllMocks()
  })
})
