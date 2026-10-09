import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, act } from '@testing-library/react'

// A made-up ticker answers 503 {"error":"warming"} on every ask (audit
// 2026-10-08, ZZQXV). The chart used to keep its loading skeleton forever once
// the retry loop stopped. It must give up after WARMING_GIVE_UP_MS and say so.

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
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

const warming503 = () => {
  const body = { ticker: 'ZZQXV', tf: 'D', bars: [], error: 'warming' }
  const res = {
    ok: false, status: 503,
    headers: { get: () => '3' },
    json: () => Promise.resolve(body),
  }
  res.clone = () => res
  return res
}

beforeEach(() => {
  cleanup()
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(
    String(url).includes('/api/bars/') ? warming503() : { ok: true, json: () => Promise.resolve({}) },
  )))
})
afterEach(() => { vi.useRealTimers() })

const mod = await import('./StockChart')
const StockChart = mod.default

describe('StockChart — a warming answer that never resolves', () => {
  it('gives up after WARMING_GIVE_UP_MS and shows an honest message', async () => {
    expect(mod.WARMING_GIVE_UP_MS).toBeGreaterThan(10000)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<StockChart sym="ZZQXV" tf="D" />)
    // Still loading well before the limit: no give-up note yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.queryByTestId('chart-warming-timed-out')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(mod.WARMING_GIVE_UP_MS + 1000) })
    const note = await screen.findByTestId('chart-warming-timed-out')
    expect(note.textContent).toMatch(/No price history found for ZZQXV/)
    expect(note.textContent).toMatch(/Retry/)
  }, 30000)
})
