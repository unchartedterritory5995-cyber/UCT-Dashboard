// BEHAVIOURAL rail for the time-axis reserve (TickerPopup.chipsClearAxis.test.js is the
// structural one). A host stylesheet declares `--time-axis-min-height` on StockChart's wrapper;
// once the chart is READY, StockChart hands it to the time scale's own `minimumHeight`. Unset,
// nothing non-zero is ever applied, so every other surface keeps its natural axis.
//
// The reserve is declared here the way a host does it -- a stylesheet rule on the wrapper's
// class -- and read back through jsdom's getComputedStyle, so the rail runs the real effect.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const log = vi.hoisted(() => ({ chartOptions: [] }))

vi.mock('lightweight-charts', () => {
  const makeSeries = () => ({
    setData: () => {}, update: () => {}, applyOptions: () => {}, options: () => ({}),
    getPane: () => ({ getSeries: () => [] }), priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
    attachPrimitive: () => {}, detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0,
    priceFormatter: () => ({ format: (v) => String(v) }), data: () => [],
  })
  const chart = {
    addSeries: () => makeSeries(), removeSeries: () => {},
    applyOptions: (o) => { log.chartOptions.push(o) },
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
    chartElement: () => document.createElement('div'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, BaselineSeries: {},
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

const bars = Array.from({ length: 60 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 }
})

const minimumHeights = () => log.chartOptions
  .map((o) => o?.timeScale?.minimumHeight)
  .filter((v) => v !== undefined)

let sheet
function declareReserve(css) {
  sheet = document.createElement('style')
  sheet.textContent = css
  document.head.appendChild(sheet)
}

beforeEach(() => {
  cleanup()
  log.chartOptions = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})
afterEach(() => { sheet?.remove(); sheet = null })

describe('StockChart hands --time-axis-min-height to the time scale', () => {
  it('PREMISE: jsdom resolves the host rule on the wrapper (so the cases below can mean something)', () => {
    declareReserve('.reserve-host { --time-axis-min-height: 80px; }')
    const el = document.createElement('div')
    el.className = 'reserve-host'
    document.body.appendChild(el)
    expect(getComputedStyle(el).getPropertyValue('--time-axis-min-height').trim()).toBe('80px')
    el.remove()
  })

  it('with the reserve declared, minimumHeight 80 is applied once the chart is ready', async () => {
    declareReserve('.reserve-host { --time-axis-min-height: 80px; }')
    render(<StockChart sym="QQQ" tf="D" barsOverride={bars} className="reserve-host" />)
    await vi.waitFor(() => expect(minimumHeights()).toContain(80), { timeout: 5000 })
  })

  it('the chart is built AFTER the first commit (bars arrive late): the reserve still lands', async () => {
    // The normal case on a real page: no bars at mount, so there is no chart when the effect
    // first runs. Only an effect that waits for the chart to be ready can apply the reserve.
    declareReserve('.reserve-host { --time-axis-min-height: 80px; }')
    let built = false
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (String(url).includes('/api/bars/')) {
        return new Promise((r) => setTimeout(() => { built = true; r({ ok: true, json: () => Promise.resolve({ bars }) }) }, 150))
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }))
    render(<StockChart sym="LATE" tf="D" className="reserve-host" />)
    await vi.waitFor(() => expect(built).toBe(true), { timeout: 5000 })
    await vi.waitFor(() => expect(minimumHeights()).toContain(80), { timeout: 5000 })
  })

  it('without it, no non-zero minimumHeight is ever applied (every other surface is untouched)', async () => {
    render(<StockChart sym="QQQ" tf="D" barsOverride={bars} className="no-reserve" />)
    // wait for the chart to be built and settled, then read everything it was told
    await vi.waitFor(() => expect(log.chartOptions.length).toBeGreaterThan(0), { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 300))
    expect(minimumHeights().filter((v) => v !== 0)).toEqual([])
  })
})
