import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

// Owner 2026-11-11: the top-right chart status pill ("● LIVE" / UPDATING / DELAYED /
// NO DATA / RECONNECTING / STALE) and the "↻ Bar corrected" flash are removed from
// every StockChart surface (/charts, grid cells, mini charts all mount StockChart).
// The currentness state must stay readable as DATA ATTRIBUTES on the wrapper —
// tools/intraday_currentness_harness.py, the Agent and other tests read them.
// Harness mocks copied from StockChart.smoke.test.jsx.

// lightweight-charts touches <canvas>; stub the whole surface it uses.
vi.mock('lightweight-charts', async (importOriginal) => {
  // Real constants/series definitions; only the canvas-touching factory is stubbed.
  const real = await importOriginal()
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600,
    }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    ...real,
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, BaselineSeries: {}, createSeriesMarkers: () => ({ setMarkers: () => {} }),
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

beforeEach(() => {
  cleanup()
  // SWR data hooks fetch; make every fetch resolve to an empty-ish payload.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

// Import AFTER the mocks are registered.
const { default: StockChart } = await import('./StockChart')


const PILL_TEXT = /●\s*LIVE|UPDATING|DELAYED|NO DATA|RECONNECTING|STALE|Bar corrected/

describe('StockChart — no live status pill', () => {
  it('renders no status pill on an intraday live chart, but keeps the data attributes', () => {
    for (const tf of ['1', '5', '15', '30', '60']) {
      const { container } = render(<StockChart sym="AAPL" tf={tf} liveUpdates />)
      expect(container.querySelector('[data-testid="chart-live-state"]')).toBeNull()
      expect(container.textContent).not.toMatch(PILL_TEXT)
      // The wrapper still exposes the badge state for tests/harnesses/the Agent.
      const wrapper = container.querySelector('[data-live-badge]')
      expect(wrapper).not.toBeNull()
      expect(wrapper.getAttribute('data-live-badge')).toBeTruthy()
      cleanup()
    }
  })

  it('a minute-close correction no longer flashes a "Bar corrected" pill', async () => {
    const rc = await import('../lib/realtimeCandle')
    const { container } = render(<StockChart sym="AAPL" tf="1" liveUpdates />)
    act(() => { rc.applyCorrection('AAPL', '1', { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 }) })
    expect(container.textContent).not.toMatch(/Bar corrected/)
  })
})
