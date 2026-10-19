// Study drills (spec 2026-10-17 §13.2 T1) — `studyMode` locks the chart to an
// ITEM, never a ticker. Three sym-keyed side effects used to fire for the item
// id: `useTickerMeta` and `useTickerIpo` (a provider lookup per item per
// member, server-side), and `useChartDrawings` (a localStorage entry under the
// item id). The desk/news/earnings marker feeds and the "Loading AAPL…" copy
// printed the id too. This asserts, at the mounted component, that every one
// of them is off — the harness is StockChart.deskmarkers.test.jsx's, so the
// component body really executes in jsdom.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, waitFor, screen } from '@testing-library/react'

const lw = vi.hoisted(() => ({ markerSets: [] }))
const hooks = vi.hoisted(() => ({ meta: [], ipo: [], drawings: [] }))

vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: (o) => ({ ...o }), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    dataByIndex: () => null, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
    barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
  }
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null,
    setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
    resetTimeScale: () => {}, options: () => ({}), width: () => 600,
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {},
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    createSeriesMarkers: (_s, m) => { lw.markerSets.push(m); return { setMarkers: (n) => { lw.markerSets.push(n) } } },
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
vi.mock('../utils/barsIDB', () => ({ idbGet: async () => null, idbPut: async () => {}, mergeDelta: (_a, b) => b }))

// The three hooks under test record the symbol they were handed, per render.
vi.mock('../hooks/useTickerMeta', () => ({ default: (sym) => { hooks.meta.push(sym); return null } }))
vi.mock('../hooks/useTickerIpo', () => ({ default: (sym) => { hooks.ipo.push(sym); return null } }))
vi.mock('./chart/useChartDrawings', () => ({
  default: (sym) => {
    hooks.drawings.push(sym)
    const noop = () => {}
    return { drawings: [], addDrawing: noop, removeDrawing: noop, updateDrawing: noop, clearAll: noop,
      undo: noop, redo: noop, snapshotHistory: noop, canUndo: false, canRedo: false, reorderDrawing: noop }
  },
}))

const BAR_DATES = Array.from({ length: 120 }, (_, i) =>
  new Date(Date.UTC(2026, 1, 20) - (119 - i) * 86400000).toISOString().slice(0, 10))
const FIXTURE_BARS = BAR_DATES.map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i }))

let fetchSpy
beforeEach(() => {
  cleanup()
  lw.markerSets = []
  hooks.meta = []; hooks.ipo = []; hooks.drawings = []
  fetchSpy = vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars/') ? { ticker: 'X', bars: FIXTURE_BARS } : {}),
  }))
  vi.stubGlobal('fetch', fetchSpy)
})

const { default: StockChart } = await import('./StockChart')

// Every marker/news/desk category ON — the study caller is expected to pass a
// settingsOverride with them off, but T1 says the chart must not depend on that.
const ALL_FEEDS_ON = { markers: { earnings: true, splits: true, dividends: true, news: true, desk: true } }
const urls = () => fetchSpy.mock.calls.map((c) => String(c[0]))
const distinct = (arr) => [...new Set(arr)]

describe('StockChart studyMode (T1)', () => {
  it('hands NULL to useTickerMeta, useTickerIpo and useChartDrawings — never the item id', async () => {
    render(<StockChart sym="item-abc123" tf="D" barsOverride={FIXTURE_BARS} studyMode settingsOverride={ALL_FEEDS_ON} />)
    await waitFor(() => expect(hooks.meta.length).toBeGreaterThan(0))
    expect(distinct(hooks.meta)).toEqual([null])
    expect(distinct(hooks.ipo)).toEqual([null])
    expect(distinct(hooks.drawings)).toEqual([null])
  })

  it('CONTROL: without studyMode the same mount hands the symbol to all three', async () => {
    render(<StockChart sym="CTRL" tf="D" barsOverride={FIXTURE_BARS} />)
    await waitFor(() => expect(hooks.meta.length).toBeGreaterThan(0))
    expect(distinct(hooks.meta)).toEqual(['CTRL'])
    expect(distinct(hooks.ipo)).toEqual(['CTRL'])
    expect(distinct(hooks.drawings)).toEqual(['CTRL'])
  })

  it('issues no markers / news / desk-mention request for the item, even with every feed toggled on', async () => {
    render(<StockChart sym="item-feeds" tf="D" barsOverride={FIXTURE_BARS} studyMode settingsOverride={ALL_FEEDS_ON} />)
    await waitFor(() => expect(hooks.meta.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 80))
    const side = urls().filter((u) => /\/api\/chart\/markers\/|\/api\/chart-news\/|\/mentions/.test(u))
    expect(side).toEqual([])
  })

  it('CONTROL: the desk feed DOES fire for a non-study chart with the toggle on', async () => {
    render(<StockChart sym="FEEDON" tf="D" barsOverride={FIXTURE_BARS} settingsOverride={{ markers: { desk: true } }} />)
    await waitFor(() => expect(urls().some((u) => u.includes('/mentions'))).toBe(true), { timeout: 3000 })
  })

  it('prints nothing symbol-like while loading: no "Loading <id>…" / "Failed to load chart for <id>"', async () => {
    // No bars at all → the chart stays on its skeleton; the label must not name the item.
    fetchSpy.mockImplementation(() => new Promise(() => {}))
    const { container } = render(<StockChart sym="item-secret" tf="D" studyMode />)
    await waitFor(() => expect(hooks.meta.length).toBeGreaterThan(0))
    expect(container.textContent).not.toContain('item-secret')
    expect(screen.queryByText(/Loading item-secret/)).toBeNull()
  })
})
