import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The real page with the real StockChart: a breadth COUNT (the A/D line) must reach the
// price axis as whole numbers. Only lightweight-charts is faked, and the fake keeps the one
// library rule that decided this bug: a price scale formats its ticks with the series on it
// that was added FIRST. In a browser the MA lines are added before the price line, so a
// format on the price line alone left the axis reading "825000.00" under a header reading
// "825,000". jsdom builds them in the other order; StockChart.priceFormatLate.test.jsx
// forces the browser's order.

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

// enough sessions for every default MA to draw
const AD_BARS = Array.from({ length: 260 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 9, 1) + i * 86400000).toISOString().slice(0, 10)
  const c = 810000 + Math.round(Math.sin(i / 9) * 9000)
  return { t: d, o: c, h: c, l: c, c, v: 0 }
})
// what the bot sends for a breadth chart: `?indicators=` carrying {chartType: 'line'}
const LINE_IND = btoa(JSON.stringify({ chartType: 'line' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

beforeEach(() => {
  cleanup()
  seriesLog = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    const body = String(url).startsWith('/api/r/breadth-bars/') ? { ticker: 'UCTAD', tf: 'D', bars: AD_BARS } : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }))
})

const { default: ChartRender } = await import('./ChartRender')

// What the axis prints: the format of the FIRST live series on the main pane's right scale.
const axisSource = () => seriesLog.find(s => !s.removed && s.paneIndex === 0 && (s.options().priceScaleId ?? 'right') === 'right')
const axisText = () => {
  const f = axisSource()?.options().priceFormat
  return f?.formatter ? f.formatter(825000) : '(default)'
}

describe('a breadth count draws a whole-number axis on the real page', () => {
  it('UCTAD', async () => {
    render(
      <MemoryRouter initialEntries={['/r/chart?sym=UCTAD&tf=D&token=tok&breadth=1&indicators=' + LINE_IND + '&bname=' + encodeURIComponent('Advance/Decline Line')]}>
        <ChartRender />
      </MemoryRouter>,
    )
    await vi.waitFor(() => expect(axisText()).toBe('825,000'), { timeout: 5000 })
    // and it stays that way once everything has settled
    await new Promise(r => setTimeout(r, 500))
    expect(axisText()).toBe('825,000')
  })
})
