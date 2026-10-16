import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { render, cleanup } from '@testing-library/react'

// The price lines a consumer passes (the Focus pane's pivot line, the Journal's entry/stop) are
// drawn on the PRICE series. A chart-type change that swaps the series type (candles -> bars)
// removes that series, and its price lines go with it. The rebuild was guarded only on the
// identity of the merged price-line array, which a type change does not move, so the new series
// came up with no lines at all. These cases watch the lines on the series that is ON SCREEN.

let seriesLog
let removedSeries
vi.mock('lightweight-charts', () => {
  const makeSeries = (kind) => {
    const lines = new Set()
    const s = {
      kind, lines,
      setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: (opts) => { const pl = { opts }; lines.add(pl); return pl },
      removePriceLine: (pl) => { lines.delete(pl) },
      setMarkers: () => {}, attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    }
    seriesLog.push(s)
    return s
  }
  const chart = {
    addSeries: (type) => makeSeries(type?.__kind || 'other'),
    addCandlestickSeries: () => makeSeries('candle'), addHistogramSeries: () => makeSeries('hist'),
    addLineSeries: () => makeSeries('line'), addAreaSeries: () => makeSeries('area'), addBarSeries: () => makeSeries('bar'),
    removeSeries: (s) => { removedSeries.push(s) }, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600,
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: { __kind: 'candle' }, HistogramSeries: { __kind: 'hist' }, LineSeries: { __kind: 'line' },
    AreaSeries: { __kind: 'area' }, BarSeries: { __kind: 'bar' }, BaselineSeries: { __kind: 'baseline' },
    createSeriesMarkers: () => ({ setMarkers: () => {}, detach: () => {} }),
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
  { t: '2026-08-03', o: 10, h: 11, l: 9, c: 10, v: 1000 },
  { t: '2026-08-04', o: 10.2, h: 11.5, l: 10, c: 11, v: 1000 },
  { t: '2026-08-05', o: 11.1, h: 12.5, l: 11, c: 12, v: 1000 },
]

// ONE array identity for the whole test, exactly as the Focus pane's memo hands it over.
const PIVOT_LINES = [{ price: 11.5, title: 'Flat base pivot', color: '#dcbb5e' }]

const livePivotTitles = (s) => [...s.lines].map(pl => pl.opts.title)
// The price series currently on screen: the newest one of the given kind not yet removed.
const liveOf = (kind) => [...seriesLog].reverse().find(s => s.kind === kind && !removedSeries.includes(s))

beforeEach(() => {
  cleanup()
  seriesLog = []
  removedSeries = []
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars') ? { bars } : {}),
  })))
})

describe('price lines survive a price-series swap', () => {
  it('control: the candle series carries the pivot line', async () => {
    render(<StockChart sym="AAPL" tf="D" priceLines={PIVOT_LINES} settingsOverride={{ chartType: 'candles' }} />)
    await vi.waitFor(() => expect(livePivotTitles(liveOf('candle') || { lines: new Set() })).toContain('Flat base pivot'), { timeout: 4000 })
  })

  it('a chart-type change to bars redraws the pivot line on the NEW series', async () => {
    const { rerender } = render(<StockChart sym="AAPL" tf="D" priceLines={PIVOT_LINES} settingsOverride={{ chartType: 'candles' }} />)
    await vi.waitFor(() => expect(livePivotTitles(liveOf('candle') || { lines: new Set() })).toContain('Flat base pivot'), { timeout: 4000 })
    rerender(<StockChart sym="AAPL" tf="D" priceLines={PIVOT_LINES} settingsOverride={{ chartType: 'bars' }} />)
    // the swap really happened: a bar series is on screen and the candle series was removed
    await vi.waitFor(() => expect(liveOf('bar')).toBeTruthy(), { timeout: 4000 })
    await vi.waitFor(() => expect(livePivotTitles(liveOf('bar'))).toContain('Flat base pivot'), { timeout: 4000 })
  })

  // The unmount cleanup does NOT reset lastPriceLinesRef, and this case was written to show whether
  // that drops the lines. It does not: it passes with or without the swap fix above, because the
  // simulated remount runs before the first paint ever sets the ref. So no teardown change was
  // made; this stays as the rail that would catch it if that ordering ever changed.
  it('a destroy-then-recreate of the chart (StrictMode remount) still draws the lines', async () => {
    render(<StrictMode><StockChart sym="AAPL" tf="D" priceLines={PIVOT_LINES} settingsOverride={{ chartType: 'candles' }} /></StrictMode>)
    await vi.waitFor(() => expect(livePivotTitles(liveOf('candle') || { lines: new Set() })).toContain('Flat base pivot'), { timeout: 4000 })
  })
})
