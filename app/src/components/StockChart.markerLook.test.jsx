// `markerLook` (the Study drill chart, 2026-11-17; the owner: "the arrow and the text/font could look much better and be a
// lot more of a cool production"): the host's `markers` are drawn as HTML labels (ChartMarkOverlay) instead of the
// library's arrows. StockChart is shared by the whole app, so the prop is opt-in: without it the markers go to the
// library exactly as before and no label layer mounts. Harness: StockChart.studyMode.test.jsx's (the component body runs).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const lw = vi.hoisted(() => ({ markerSets: [] }))

vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 50 }),
    createPriceLine: (o) => ({ ...o }), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    dataByIndex: () => null, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
    barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
    subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
  }
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null,
    setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
    resetTimeScale: () => {}, options: () => ({}), width: () => 600,
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {},
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    createSeriesMarkers: (_s, m) => { lw.markerSets.push(m); return { setMarkers: (n) => { lw.markerSets.push(n) }, detach: () => {} } },
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
vi.mock('../utils/barsIDB', () => ({ idbGet: async () => null, idbPut: async () => {}, mergeDelta: (_a, b) => b }))

const BAR_DATES = Array.from({ length: 120 }, (_, i) =>
  new Date(Date.UTC(2026, 1, 20) - (119 - i) * 86400000).toISOString().slice(0, 10))
const FIXTURE_BARS = BAR_DATES.map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i }))
const MARKS = [
  { time: BAR_DATES[100], position: 'belowBar', shape: 'arrowUp', color: '#dcbb5e', text: 'BOUGHT', glyph: 'up' },
  { time: BAR_DATES[104], position: 'aboveBar', shape: 'square', color: '#ef5350', text: 'STOPPED', glyph: 'cross' },
]

beforeEach(() => {
  cleanup()
  lw.markerSets = []
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars/') ? { ticker: 'X', bars: FIXTURE_BARS } : {}),
  })))
})

const { default: StockChart } = await import('./StockChart')
const handed = () => lw.markerSets.flat().map((m) => m?.text)

describe('StockChart markerLook', () => {
  it('draws the host\'s markers as the label layer and hands none of them to the library', async () => {
    const { container } = render(<StockChart sym="item-marks" tf="D" barsOverride={FIXTURE_BARS} studyMode markers={MARKS} markerLook="wide" />)
    await waitFor(() => expect(container.querySelector('[data-testid="chart-marks"]')).toBeTruthy())
    expect([...container.querySelectorAll('[data-testid="chart-mark"]')].map((m) => m.dataset.text)).toEqual(['BOUGHT', 'STOPPED'])
    expect(container.querySelector('[data-testid="chart-marks"]').dataset.size).toBe('wide')
    await waitFor(() => expect(lw.markerSets.length).toBeGreaterThan(0))   // the library's (empty) list was still set
    expect(handed()).not.toContain('BOUGHT')
    expect(handed()).not.toContain('STOPPED')
  })

  it('a phone look mounts the phone-size layer', async () => {
    const { container } = render(<StockChart sym="item-marks-phone" tf="D" barsOverride={FIXTURE_BARS} studyMode markers={MARKS} markerLook="phone" />)
    await waitFor(() => expect(container.querySelector('[data-testid="chart-marks"]')).toBeTruthy())
    expect(container.querySelector('[data-testid="chart-marks"]').dataset.size).toBe('phone')
  })

  it('CONTROL: without markerLook the markers go to the library as before and no label layer mounts', async () => {
    const { container } = render(<StockChart sym="item-marks-ctrl" tf="D" barsOverride={FIXTURE_BARS} studyMode markers={MARKS} />)
    await waitFor(() => expect(handed()).toContain('BOUGHT'))
    expect(handed()).toContain('STOPPED')
    expect(container.querySelector('[data-testid="chart-marks"]')).toBeNull()
  })
})
