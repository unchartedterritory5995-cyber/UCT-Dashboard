// StockChart — an ECONOMIC primary (`ECON:USCPI`) never touches a stock-only path,
// and a stock chart never touches an economic one.
//
// ⛔ Econ: only /api/econ/* is requested — no /api/bars, /api/bars-history,
// /api/ticker-meta, /api/ticker-logo, markers, news, desk, patterns, darkpool,
// comparisons; no IndexedDB read; realtime hooks are handed no symbol.
// ⭐ Control: AAPL requests /api/bars and never /api/econ.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { cpiPayload, CATALOG } from './chart/economic/__fixtures__/econCatalog'

const seriesCalls = []
vi.mock('lightweight-charts', () => {
  const mk = () => ({
    setData: (d) => { seriesCalls.push(d) }, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    getPane: () => ({ paneIndex: () => 0 }), data: () => [], dataByIndex: () => null,
  })
  const chart = {
    addSeries: () => mk(), addCandlestickSeries: () => mk(), addHistogramSeries: () => mk(),
    addLineSeries: () => mk(), addAreaSeries: () => mk(), addBarSeries: () => mk(),
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600,
    }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div'), setStretchFactor: () => {}, paneIndex: () => 0 }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, BaselineSeries: {},
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

const realtime = { prices: [], bars: [] }
vi.mock('../hooks/useRealtimePrices', () => ({ default: (syms) => { realtime.prices.push(syms); return { prices: {}, status: 'idle' } } }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: (o) => { realtime.bars.push(o && o.symbol); return {} } }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
const idb = { gets: [] }
vi.mock('../utils/barsIDB', async (orig) => {
  const m = await orig()
  return { ...m, idbGet: (...a) => { idb.gets.push(a[0]); return Promise.resolve(null) } }
})

let calls = []
beforeEach(async () => {
  cleanup()
  calls = []
  realtime.prices.length = 0
  realtime.bars.length = 0
  idb.gets.length = 0
  const { _resetEconomicForTests } = await import('./chart/engine/economicSeries')
  _resetEconomicForTests()
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    calls.push(u)
    if (u.startsWith('/api/econ/catalog')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CATALOG) })
    if (u.startsWith('/api/econ/series/USCPI')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cpiPayload()) })
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  }))
})

const { default: StockChart } = await import('./StockChart')
const STOCK_ONLY = [/^\/api\/bars/, /^\/api\/ticker-meta/, /^\/api\/ticker-logo/, /^\/api\/chart\/markers/, /^\/api\/chart-news/,
  /^\/api\/education\/tickers/, /^\/api\/patterns/, /^\/api\/darkpool/, /^\/api\/research/, /^\/api\/theme-index/]

describe('StockChart × economic primary', () => {
  it('ECON:USCPI loads from /api/econ only — no stock-only request, no IDB, no realtime symbol', async () => {
    render(<StockChart sym="ECON:USCPI" tf="D" settingsOverride={{ markers: { earnings: true, news: true, desk: true }, darkPool: { enabled: true } }} />)
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/econ/series/USCPI'))).toBe(true))
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    const bad = calls.filter((u) => STOCK_ONLY.some((re) => re.test(u)))
    expect(bad).toEqual([])
    expect(idb.gets).toEqual([])
    expect(realtime.prices.every((s) => !s || s.length === 0)).toBe(true)
    expect(realtime.bars.every((s) => s == null)).toBe(true)
  })

  it('an intraday request on an economic primary is served as D (no intraday econ primary)', async () => {
    expect(() => render(<StockChart sym="ECON:USCPI" tf="5" />)).not.toThrow()
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/econ/series/USCPI'))).toBe(true))
    expect(calls.filter((u) => /^\/api\/bars/.test(u))).toEqual([])
  })

  it('W and M mount without throwing and still never reach /api/bars', async () => {
    for (const tf of ['W', 'M']) expect(() => render(<StockChart sym="ECON:USCPI" tf={tf} />)).not.toThrow()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(calls.filter((u) => /^\/api\/bars/.test(u))).toEqual([])
  })

  it('control: a stock chart requests /api/bars and never /api/econ', async () => {
    render(<StockChart sym="AAPL" tf="D" />)
    await waitFor(() => expect(calls.some((u) => /^\/api\/bars/.test(u))).toBe(true), { timeout: 3000 })
    expect(calls.some((u) => u.startsWith('/api/econ'))).toBe(false)
  })
})
