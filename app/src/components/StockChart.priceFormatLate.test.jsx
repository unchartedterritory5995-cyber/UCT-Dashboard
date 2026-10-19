import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// ChartRender hands a breadth COUNT (the A/D line, new highs) a whole-number priceFormat, but
// only once its bars have landed, so the chart is first built WITHOUT one. The series-creation
// block applied priceFormat once, at creation, so the late one never reached the axis: the
// header read "810,197" over an axis reading "825000.00". These cases watch the format on the
// price series that is ON SCREEN.

let seriesLog
vi.mock('lightweight-charts', () => {
  const makeSeries = (kind) => {
    const s = {
      kind, formats: [],
      setData: () => {}, update: () => {},
      applyOptions: (o) => { if (o && 'priceFormat' in o) s.formats.push(o.priceFormat) },
      priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({}), removePriceLine: () => {},
      setMarkers: () => {}, attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    }
    seriesLog.push(s)
    return s
  }
  const chart = {
    addSeries: (type) => makeSeries(type?.__kind || 'other'),
    removeSeries: () => {}, applyOptions: () => {},
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
  { t: '2026-10-14', o: 811003, h: 811003, l: 811003, c: 811003, v: 0 },
  { t: '2026-10-15', o: 810500, h: 810500, l: 810500, c: 810500, v: 0 },
  { t: '2026-10-16', o: 810197, h: 810197, l: 810197, c: 810197, v: 0 },
]
const WHOLE = Object.freeze({ type: 'custom', formatter: (v) => String(Math.round(v)), minMove: 1 })
const LINE = { chartType: 'line' }

const onScreen = () => seriesLog.find(s => s.kind === 'line')
const lastFormat = () => { const s = onScreen(); return s ? s.formats[s.formats.length - 1] : undefined }

beforeEach(() => {
  cleanup()
  seriesLog = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

describe('a priceFormat reaches the price axis', () => {
  it('control: a format present from the first render is applied', async () => {
    render(<StockChart sym="UCTAD" tf="D" barsOverride={bars} priceFormat={WHOLE} settingsOverride={LINE} />)
    await vi.waitFor(() => expect(lastFormat()).toBe(WHOLE), { timeout: 4000 })
  })

  it('a format that arrives after the series exists is applied too', async () => {
    const { rerender } = render(<StockChart sym="UCTAD" tf="D" barsOverride={bars} settingsOverride={LINE} />)
    // the series really exists, built without a format
    await vi.waitFor(() => expect(onScreen()).toBeTruthy(), { timeout: 4000 })
    expect(lastFormat()).toBeUndefined()
    rerender(<StockChart sym="UCTAD" tf="D" barsOverride={bars} priceFormat={WHOLE} settingsOverride={LINE} />)
    await vi.waitFor(() => expect(lastFormat()).toBe(WHOLE), { timeout: 4000 })
  })
})
