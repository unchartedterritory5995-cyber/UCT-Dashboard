import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// Render smoke test for the whole StockChart component. Its value is catching
// render-phase crashes that the build can't (a TDZ from a hook/memo referencing a
// const declared later, a bad destructure) and that the unit suites miss because
// they mock StockChart away. This exact class shipped 2026-07-17 (earningsEvents
// read filteredBars ~1400 lines before its declaration → ReferenceError → the
// /charts error boundary). We stub the canvas lib + realtime feeds so the body
// actually executes in jsdom.

// lightweight-charts touches <canvas>; stub the whole surface it uses.
vi.mock('lightweight-charts', () => {
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
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, createSeriesMarkers: () => ({ setMarkers: () => {} }),
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

describe('StockChart render smoke', () => {
  it('mounts without throwing (guards render-phase crashes like the earnings TDZ)', () => {
    expect(() => render(<StockChart sym="AAPL" tf="D" />)).not.toThrow()
  })

  it('mounts with earnings markers enabled (the exact regressed path)', () => {
    // settingsOverride flips markers.earnings on → exercises the earningsEvents memo.
    expect(() => render(
      <StockChart sym="AAPL" tf="D" settingsOverride={{ markers: { earnings: true } }} />
    )).not.toThrow()
  })

  it('mounts on a CUSTOM timeframe (base-fetch + resample path)', () => {
    for (const tf of ['45', '120', '3D', '3M']) {
      expect(() => render(<StockChart sym="AAPL" tf={tf} />)).not.toThrow()
    }
  })
})
