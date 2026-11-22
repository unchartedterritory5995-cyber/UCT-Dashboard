import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

// Multi Chart's time-range sync, on the REAL StockChart over a lightweight-charts double that keeps a visible range and,
// as the library does, fires the range subscribers from inside a write AND from inside a read of a range that changed.
// A chart is created lazily, after its bars land, so "sync on from the start" hands over its handler before there is a chart.

let lib
vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
  }
  const ts = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => lib.logical,
    scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
    resetTimeScale: () => {}, options: () => ({}), width: () => 600, coordinateToLogical: (x) => x / 10,
    getVisibleRange: () => lib.range,
    setVisibleRange: (r) => { lib.applied.push(r); lib.range = lib.snap ? lib.snap(r) : r; if (!lib.lateEcho) lib.fire() },
    subscribeVisibleTimeRangeChange: (h) => { lib.handlers.add(h) },
    unsubscribeVisibleTimeRangeChange: (h) => { lib.handlers.delete(h) },
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ts, subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, BaselineSeries: {}, createSeriesMarkers: () => ({ setMarkers: () => {}, detach: () => {} }),
  }
})

vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

const { default: StockChart } = await import('./StockChart')

const bars = Array.from({ length: 40 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
  return { t: d, o: 10, h: 11, l: 9, c: 10, v: 1000 }
})
const R1 = { from: '2026-01-05', to: '2026-01-20' }
const R2 = { from: '2026-01-10', to: '2026-01-30' }

const nextFrame = () => new Promise((r) => requestAnimationFrame(r))
beforeEach(() => {
  cleanup()
  lib = { handlers: new Set(), range: { from: '2026-01-01', to: '2026-02-09' }, logical: { from: 0, to: 39 }, applied: [], snap: null, lateEcho: false,
    fire() { for (const h of [...lib.handlers]) h(lib.range) } }
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars') ? { bars } : {}),
  })))
})

const readyChart = () => vi.waitFor(() => expect(lib.handlers.size).toBeGreaterThan(0), { timeout: 4000 })
// the sync bus, as GridChartCell hands it over: one listener
function bus() {
  const b = { cb: null, subscribe: (cb) => { b.cb = cb; return () => { b.cb = null } } }
  return b
}
async function mountFollower(extra = {}) {
  const b = bus()
  const onRange = vi.fn()
  const out = render(<StockChart sym="AAPL" tf="D" chartId="c" onTimeRangeChange={onRange} subscribeTimeRange={b.subscribe} {...extra} />)
  await readyChart()
  await vi.waitFor(() => expect(b.cb).toBeTypeOf('function'))
  return { b, onRange, out }
}

describe('StockChart time-range sync', () => {
  it('sync already on at mount: the handler given before the chart exists is subscribed once it does', async () => {
    const { onRange } = await mountFollower()
    onRange.mockClear()
    act(() => { lib.range = R1; lib.fire() })
    expect(onRange).toHaveBeenCalledTimes(1)
    expect(onRange.mock.calls[0][0]).toEqual({ ...R1, barsTo: R1.to })
  })
  it('a view running past the newest bar says where its bars stop, and is still sent whole', async () => {
    const { onRange } = await mountFollower()
    onRange.mockClear()
    const past = { from: '2026-01-20', to: '2026-11-04' }
    act(() => { lib.range = past; lib.fire() })
    expect(onRange.mock.calls[0][0]).toEqual({ ...past, barsTo: bars[bars.length - 1].t })
  })
  it('a view whose bars fit is followed however far its right edge runs on the empty axis', async () => {
    const { b } = await mountFollower()
    const past = { from: '2026-01-20', to: '2026-11-04' }
    lib.applied.length = 0
    act(() => b.cb({ ...past, barsTo: bars[bars.length - 1].t }))
    expect(lib.applied).toEqual([past])
  })
  it('sync turned on later subscribes straight away, and off unsubscribes', async () => {
    const onRange = vi.fn()
    const { rerender } = render(<StockChart sym="AAPL" tf="D" chartId="c" />)
    await vi.waitFor(() => expect(lib.handlers.size).toBeGreaterThan(0), { timeout: 4000 })   // the chart's own overlay subscribes too
    await new Promise((r) => setTimeout(r, 300))
    const own = lib.handlers.size
    rerender(<StockChart sym="AAPL" tf="D" chartId="c" onTimeRangeChange={onRange} />)
    await vi.waitFor(() => expect(lib.handlers.size).toBe(own + 1))
    rerender(<StockChart sym="AAPL" tf="D" chartId="c" />)
    await vi.waitFor(() => expect(lib.handlers.size).toBe(own))
  })
  it('a load is not the member: a range change before any move says memberMoved false', async () => {
    const { onRange } = await mountFollower()
    onRange.mockClear()
    act(() => { lib.range = R1; lib.fire() })
    expect(onRange.mock.calls[0][1]).toEqual({ memberMoved: false })
  })
  it('a date jump is the member', async () => {
    let nav = null
    const { onRange } = await mountFollower({ onDateNavApi: (a) => { nav = a } })
    await vi.waitFor(() => expect(nav).toBeTruthy())
    onRange.mockClear()
    act(() => { nav.goToDate(Date.UTC(2026, 0, 20)) })
    act(() => { lib.range = R1; lib.fire() })
    expect(onRange.mock.calls.at(-1)[1]).toEqual({ memberMoved: true })
  })
  it('a view scrolled off the end of its history is not sent', async () => {
    let nav = null
    const { onRange } = await mountFollower({ onDateNavApi: (a) => { nav = a } })
    await vi.waitFor(() => expect(nav).toBeTruthy())
    act(() => { nav.goToDate(Date.UTC(2026, 0, 20)) })
    onRange.mockClear()
    act(() => { lib.logical = { from: -120, to: 5 }; lib.range = { from: '2026-01-01', to: '2026-01-06' }; lib.fire() })
    expect(onRange.mock.calls.at(-1)[1]).toEqual({ memberMoved: false })
  })
  it('follows a daily range: a date range lands on the chart', async () => {
    const { b } = await mountFollower()
    act(() => b.cb(R1))
    expect(lib.applied).toEqual([R1])
  })
  it('no echo: the write fires the subscribers, and nothing goes back on the bus', async () => {
    const { b, onRange } = await mountFollower()
    onRange.mockClear()
    act(() => b.cb(R1))
    expect(onRange).not.toHaveBeenCalled()
  })
  it('no echo: the same range landing after the one-frame latch is still swallowed, snapped to this chart\'s bars or not', async () => {
    const { b, onRange } = await mountFollower()
    lib.lateEcho = true
    lib.snap = (r) => ({ ...r, from: '2026-01-06' })
    onRange.mockClear()
    act(() => b.cb(R1))
    await nextFrame(); await nextFrame()
    act(() => lib.fire())
    expect(onRange).not.toHaveBeenCalled()
  })
  it('the member then moving this chart is sent, even back onto the range it had followed', async () => {
    const { b, onRange } = await mountFollower()
    act(() => b.cb(R1))
    await nextFrame(); await nextFrame()
    onRange.mockClear()
    act(() => { lib.range = R2; lib.fire() })
    act(() => { lib.range = R1; lib.fire() })
    expect(onRange.mock.calls.map(c => c[0])).toEqual([{ ...R2, barsTo: R2.to }, { ...R1, barsTo: R1.to }])
  })
  it('compares with what the chart shows now: a range applied before lands again after the member moved away', async () => {
    const { b } = await mountFollower()
    act(() => b.cb(R1))
    await nextFrame(); await nextFrame()
    act(() => { lib.range = R2; lib.fire() })
    await nextFrame()
    act(() => b.cb(R1))
    expect(lib.applied).toEqual([R1, R1])
  })
  it('a range it already shows is not written again', async () => {
    const { b } = await mountFollower()
    lib.range = R1
    act(() => b.cb({ ...R1 }))
    expect(lib.applied).toEqual([])
  })
  it('a range past its history leaves the chart where it is', async () => {
    const { b } = await mountFollower()
    act(() => b.cb({ from: '2024-01-01', to: '2024-06-01' }))
    expect(lib.applied).toEqual([])
  })
  it('a followed view is held: the pinned-right net reads it as moved', async () => {
    const { b, onRange } = await mountFollower()
    act(() => b.cb(R1))
    await nextFrame(); await nextFrame()
    onRange.mockClear()
    act(() => { lib.range = R2; lib.fire() })
    expect(onRange.mock.calls[0][1]).toEqual({ memberMoved: true })
  })
  it('stops following on unmount', async () => {
    const { b, out } = await mountFollower()
    out.unmount()
    expect(b.cb).toBe(null)
  })
})
