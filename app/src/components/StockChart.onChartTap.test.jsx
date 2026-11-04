import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// `onChartTap` (Study workbench, 2026-11-03): a lesson that asks the member to tap a candle on a PHONE got nothing
// from the hover-based crosshair read, because a touch never moves a crosshair. The prop subscribes to the
// library's click, which lightweight-charts raises for a mouse click AND a touch tap, and hands back the bar's
// time, the cursor's price (coordinateToPrice on the candle series) and the pixel point. This test drives the
// captured click handler the way the library would and pins the payload shape, the price conversion, and the
// unsubscribe on unmount — the parts a product drill (TapDrill) will depend on when it adopts the prop.

let clickHandlers
let unsubscribed
vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: (y) => 100 + y, options: () => ({}),
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, coordinateToLogical: (x) => x / 10,
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: (h) => { clickHandlers.push(h) }, unsubscribeClick: (h) => { unsubscribed.push(h); clickHandlers = clickHandlers.filter((x) => x !== h) },
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, BaselineSeries: {}, createSeriesMarkers: () => ({ setMarkers: () => {} }),
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

const bars = [
  { t: '2026-08-01', o: 10, h: 11, l: 9, c: 10, v: 1000 },
  { t: '2026-08-02', o: 10.2, h: 11.5, l: 10, c: 11, v: 1000 },
  { t: '2026-08-03', o: 11.1, h: 12.5, l: 11, c: 12, v: 1000 },
]

beforeEach(() => {
  cleanup()
  clickHandlers = []
  unsubscribed = []
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars') ? { bars } : {}),
  })))
})

// Every click subscriber the chart has registered, driven as the library would drive them.
const fireClick = (param) => { for (const h of [...clickHandlers]) h(param) }

describe('StockChart onChartTap', () => {
  it('subscribes one extra click handler only when the prop is given', async () => {
    const { unmount } = render(<StockChart sym="AAPL" tf="D" />)
    await vi.waitFor(() => expect(clickHandlers.length).toBeGreaterThanOrEqual(0))
    await new Promise((r) => setTimeout(r, 50))
    const without = clickHandlers.length
    unmount(); clickHandlers = []
    render(<StockChart sym="AAPL" tf="D" onChartTap={() => {}} />)
    await vi.waitFor(() => expect(clickHandlers.length).toBe(without + 1), { timeout: 4000 })
  })

  it('hands back the tapped bar time, the price at the cursor (coordinateToPrice) and the point', async () => {
    const onChartTap = vi.fn()
    render(<StockChart sym="AAPL" tf="D" onChartTap={onChartTap} />)
    await vi.waitFor(() => expect(clickHandlers.length).toBeGreaterThan(0), { timeout: 4000 })
    fireClick({ time: '2026-08-02', point: { x: 40, y: 20 } })
    expect(onChartTap).toHaveBeenCalledTimes(1)
    expect(onChartTap).toHaveBeenCalledWith({ time: '2026-08-02', price: 120, point: { x: 40, y: 20 }, logical: 4 })
  })

  it('a tap off the bars (no time) still reports the point with a null time; no point gives a null price', async () => {
    const onChartTap = vi.fn()
    render(<StockChart sym="AAPL" tf="D" onChartTap={onChartTap} />)
    await vi.waitFor(() => expect(clickHandlers.length).toBeGreaterThan(0), { timeout: 4000 })
    fireClick({ point: { x: 5, y: 7 } })
    fireClick({ time: '2026-08-01' })
    // off the bars: no time, but the logical index under the cursor still names a position
    expect(onChartTap).toHaveBeenNthCalledWith(1, { time: null, price: 107, point: { x: 5, y: 7 }, logical: 0.5 })
    expect(onChartTap).toHaveBeenNthCalledWith(2, { time: '2026-08-01', price: null, point: null, logical: null })
  })

  it('a changed callback is picked up, the old handler is unsubscribed, and unmount unsubscribes the last one', async () => {
    const first = vi.fn(), second = vi.fn()
    const { rerender, unmount } = render(<StockChart sym="AAPL" tf="D" onChartTap={first} />)
    await vi.waitFor(() => expect(clickHandlers.length).toBeGreaterThan(0), { timeout: 4000 })
    const firstHandlers = clickHandlers.slice()
    rerender(<StockChart sym="AAPL" tf="D" onChartTap={second} />)
    await new Promise((r) => setTimeout(r, 50))
    fireClick({ time: '2026-08-03', point: { x: 1, y: 1 } })
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    // the handler subscribed for `first` is gone (unsubscribed on the prop change), not leaked beside the new one
    expect(firstHandlers.some((h) => unsubscribed.includes(h))).toBe(true)
    const live = clickHandlers.slice()
    unmount()
    expect(live.some((h) => unsubscribed.includes(h))).toBe(true)
    expect(clickHandlers.length).toBe(0)
  })
})
