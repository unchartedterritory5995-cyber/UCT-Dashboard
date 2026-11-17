// Custom header stats (owner 11-16), MOUNTED: the real ChartPane around the real StockChart (lightweight-charts and the
// live feeds stubbed). A stored custom stat (SMA 5 of Close) is computed by StockChart over the bars it draws from and
// printed in the header's info row by ChartPane. Synthetic bars only.
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('lightweight-charts', async (importOriginal) => {
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
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, getVisibleRange: () => null,
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
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
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, BaselineSeries: {}, createSeriesMarkers: () => ({ setMarkers: () => {}, detach: () => {} }),
  }
})
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
vi.mock('../../../hooks/usePreferences', async (importOriginal) => ({ ...(await importOriginal()), default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))

const { default: ChartPane } = await import('./ChartPane')

// synthetic daily bars: close = 10 + i, so SMA 5 of Close on the newest bar is the mean of the last five closes
const N = 40
const bars = Array.from({ length: N }, (_, i) => ({ t: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), o: 10 + i, h: 11 + i, l: 9 + i, c: 10 + i, v: 1000 }))
const sma5 = (10 + N - 1) - 2   // mean of the last five closes

beforeEach(() => {
  cleanup()
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).includes('/api/bars') ? { bars } : {}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('a custom stat in the mounted chart header', () => {
  it('prints the SMA 5 the chart computes, under its chart name', async () => {
    const stored = {
      header: {
        fields: ['cx:c1'],
        customStats: [{ id: 'c1', defId: 'movingAverage', plotKey: 'ma', inputs: { maType: 'sma', period: 5 }, name: 'SMA 5' }],
      },
    }
    const { container } = render(<ChartPane sym="AAPL" tf="D" onTfChange={() => {}} stored={stored} onStore={() => {}} />)
    await vi.waitFor(() => {
      const el = container.querySelector('[data-meta-key="cx:c1"]')
      expect(el && el.textContent).toBe(sma5.toFixed(2))
    }, { timeout: 8000 })
    const label = container.querySelector('[data-meta-key="cx:c1"]').previousSibling
    expect(label.textContent).toBe('SMA 5')
  })
})
