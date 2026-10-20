import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// ChartRender hands a breadth COUNT (the A/D line, new highs) a whole-number priceFormat, but
// only once its bars have landed, so the chart is first built WITHOUT one. And
// lightweight-charts formats a price scale's ticks with the series on it that was added
// FIRST, which on a real page is an MA line: the price series is rebuilt after the MAs when
// the chart type changes. These cases read the format the AXIS uses, not the price line's.

let seriesLog
vi.mock('lightweight-charts', () => {
  const makeSeries = (kind, opts, paneIndex) => {
    const o = { ...(opts || {}) }
    const s = {
      kind, paneIndex: paneIndex || 0, removed: false,
      setData: () => {}, update: () => {},
      applyOptions: (x) => { Object.assign(o, x || {}) },
      options: () => o,
      getPane: () => ({ getSeries: () => seriesLog.filter(t => !t.removed && t.paneIndex === s.paneIndex) }),
      priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({}), removePriceLine: () => {},
      setMarkers: () => {}, attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0,
      priceFormatter: () => ({ format: (v) => String(v) }), data: () => [],
    }
    seriesLog.push(s)
    return s
  }
  const chart = {
    addSeries: (type, opts, paneIndex) => makeSeries(type?.__kind || 'other', opts, paneIndex),
    removeSeries: (s) => { if (s) s.removed = true }, applyOptions: () => {},
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

// enough sessions for every default MA to draw
const bars = Array.from({ length: 260 }, (_, i) => {
  const t = new Date(Date.UTC(2025, 9, 1) + i * 86400000).toISOString().slice(0, 10)
  const c = 810000 + Math.round(Math.sin(i / 9) * 9000)
  return { t, o: c, h: c, l: c, c, v: 0 }
})
const WHOLE = Object.freeze({ type: 'custom', formatter: (v) => Math.round(v).toLocaleString('en-US'), minMove: 1 })
const CANDLES = { chartType: 'candles' }
const LINE = { chartType: 'line' }

const onMain = () => seriesLog.filter(s => !s.removed && s.paneIndex === 0 && (s.options().priceScaleId ?? 'right') === 'right')
// What the axis prints: the format of the FIRST live series on the main pane's right scale.
const axisText = () => { const f = onMain()[0]?.options().priceFormat; return f?.formatter ? f.formatter(825000) : '(default)' }
const priceLine = () => onMain().find(s => s.kind === 'line' && s.options().priceScaleId == null)

beforeEach(() => {
  cleanup()
  seriesLog = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

// Candles with their MAs first, then the switch to a line: the browser's order.
async function buildMasThenLine(extra) {
  const { rerender } = render(<StockChart sym="UCTAD" tf="D" barsOverride={bars} settingsOverride={CANDLES} />)
  await vi.waitFor(() => expect(onMain().filter(s => s.kind === 'line').length).toBeGreaterThan(0), { timeout: 4000 })
  rerender(<StockChart sym="UCTAD" tf="D" barsOverride={bars} settingsOverride={LINE} {...extra} />)
  await vi.waitFor(() => expect(priceLine()).toBeTruthy(), { timeout: 4000 })
  // the condition that hid it: the axis's format comes from a series added before the price line
  expect(onMain()[0]).not.toBe(priceLine())
  return rerender
}

describe('a priceFormat reaches the price axis', () => {
  it('control: a format present from the first render is applied', async () => {
    render(<StockChart sym="UCTAD" tf="D" barsOverride={bars} priceFormat={WHOLE} settingsOverride={LINE} />)
    await vi.waitFor(() => expect(axisText()).toBe('825,000'), { timeout: 4000 })
  })

  it('a format that arrives after the price line exists reaches the axis, not just the line', async () => {
    const rerender = await buildMasThenLine({})
    expect(axisText()).toBe('(default)')
    rerender(<StockChart sym="UCTAD" tf="D" barsOverride={bars} settingsOverride={LINE} priceFormat={WHOLE} />)
    await vi.waitFor(() => expect(axisText()).toBe('825,000'), { timeout: 4000 })
  })

  it('a price line rebuilt after its MAs carries the format to the axis', async () => {
    const { rerender } = render(<StockChart sym="UCTAD" tf="D" barsOverride={bars} settingsOverride={CANDLES} priceFormat={WHOLE} />)
    await vi.waitFor(() => expect(onMain().filter(s => s.kind === 'line').length).toBeGreaterThan(0), { timeout: 4000 })
    rerender(<StockChart sym="UCTAD" tf="D" barsOverride={bars} settingsOverride={LINE} priceFormat={WHOLE} />)
    await vi.waitFor(() => expect(priceLine()).toBeTruthy(), { timeout: 4000 })
    expect(onMain()[0]).not.toBe(priceLine())
    await vi.waitFor(() => expect(axisText()).toBe('825,000'), { timeout: 4000 })
  })
})
