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

const lw = vi.hoisted(() => ({ markerSets: [], opts: [], priceLines: [] }))
const hooks = vi.hoisted(() => ({ meta: [], ipo: [], drawings: [] }))

vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: (o) => { lw.priceLines.push(o); return { ...o } }, removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
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
    removeSeries: () => {}, applyOptions: (o) => { lw.opts.push(o) }, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: (_el, o) => { lw.opts.push(o); return chart },
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
  lw.markerSets = []; lw.opts = []; lw.priceLines = []
  hooks.meta = []; hooks.ipo = []; hooks.drawings = []
  fetchSpy = vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars/') ? { ticker: 'X', bars: FIXTURE_BARS } : {}),
  }))
  vi.stubGlobal('fetch', fetchSpy)
})

const { default: StockChart, studyTickMarkFormatter } = await import('./StockChart')

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

  // A study chart shows none of the three feeds, so it must not have them asked for ahead for
  // the rows around it either (lib/symbolResourceWarm.js warms only what a mounted chart shows).
  it('holds none of the three feeds for the rows ahead, even with every feed toggled on', async () => {
    const { warmSymbolResources, __resetSymbolResourceWarm } = await import('../lib/symbolResourceWarm')
    __resetSymbolResourceWarm({ painted: true })
    const view = render(<StockChart sym="item-feeds" tf="D" barsOverride={FIXTURE_BARS} studyMode settingsOverride={ALL_FEEDS_ON} />)
    await waitFor(() => expect(hooks.meta.length).toBeGreaterThan(0))
    expect(warmSymbolResources(['NEXTROW'], 'D', { priority: true })).toBe(0)
    // CONTROL: the same settings on an ordinary chart hold all three
    view.unmount()
    render(<StockChart sym="FEEDSON" tf="D" barsOverride={FIXTURE_BARS} settingsOverride={ALL_FEEDS_ON} />)
    await waitFor(() => expect(warmSymbolResources(['NEXTROW'], 'D', { priority: true })).toBe(3), { timeout: 3000 })
  })

  it('CONTROL: the desk feed DOES fire for a non-study chart with the toggle on', async () => {
    render(<StockChart sym="FEEDON" tf="D" barsOverride={FIXTURE_BARS} settingsOverride={{ markers: { desk: true } }} />)
    await waitFor(() => expect(urls().some((u) => u.includes('/mentions'))).toBe(true), { timeout: 3000 })
  })

  // The Study screen check (2026-11-14): a finished replay's date axis read "Feb 4 Apr" (a short month lost its mark and a
  // day mark took its place), and the top and bottom price labels were cut in half at the pane's edges. Study charts only.
  it('a study chart names the month on a first-week day mark and prints only whole edge labels', async () => {
    render(<StockChart sym="item-axis" tf="D" barsOverride={FIXTURE_BARS} studyMode />)
    await waitFor(() => expect(lw.opts.some((o) => o?.timeScale?.tickMarkFormatter)).toBe(true))
    const withTime = lw.opts.filter((o) => o?.timeScale?.tickMarkFormatter)
    expect(withTime.every((o) => o.timeScale.tickMarkFormatter === studyTickMarkFormatter)).toBe(true)
    expect(withTime.some((o) => 'tickMarkMaxCharacterLength' in o.timeScale)).toBe(false)   // only when a host asks
    expect(lw.opts.filter((o) => o?.rightPriceScale).every((o) => o.rightPriceScale.entireTextOnly === true)).toBe(true)
  })

  it('a host that knows its labels are short sizes the label slot to them (tickLabelChars, the Study drill on a wide screen)', async () => {
    render(<StockChart sym="item-axis5" tf="D" barsOverride={FIXTURE_BARS} studyMode tickLabelChars={5} />)
    await waitFor(() => expect(lw.opts.some((o) => o?.timeScale?.tickMarkFormatter)).toBe(true))
    expect(lw.opts.filter((o) => o?.timeScale?.tickMarkFormatter).every((o) => o.timeScale.tickMarkMaxCharacterLength === 5)).toBe(true)
  })

  it('CONTROL: any other chart keeps the shared axis: bare day numbers, the library\'s label width, edge labels as before', async () => {
    render(<StockChart sym="CTRLAXIS" tf="D" barsOverride={FIXTURE_BARS} />)
    await waitFor(() => expect(lw.opts.some((o) => o?.timeScale?.tickMarkFormatter)).toBe(true))
    const withTime = lw.opts.filter((o) => o?.timeScale?.tickMarkFormatter)
    expect(withTime.some((o) => o.timeScale.tickMarkFormatter === studyTickMarkFormatter)).toBe(false)
    expect(withTime.some((o) => 'tickMarkMaxCharacterLength' in o.timeScale)).toBe(false)
    expect(lw.opts.some((o) => o?.rightPriceScale && 'entireTextOnly' in o.rightPriceScale)).toBe(false)
    expect(withTime[0].timeScale.tickMarkFormatter('2025-03-04', 2)).toBe('4')
  })

  it('the study formatter: a first-week day names its month, a later day stays a number, months and years as before', () => {
    expect(studyTickMarkFormatter('2025-03-04', 2)).toBe('Mar 4')
    expect(studyTickMarkFormatter({ year: 2025, month: 3, day: 3 }, 2)).toBe('Mar 3')
    expect(studyTickMarkFormatter('2025-03-18', 2)).toBe('18')
    expect(studyTickMarkFormatter('2025-03-03', 1)).toBe('Mar')
    expect(studyTickMarkFormatter('2025-01-02', 0)).toBe('2025')
  })

  // the 2026-11-16 screen check: an intraday drill's axis lost every time mark on a phone after the replay ("10:30 AM"
  // needs an eight-character slot); a half hour reads "10:30" in a five-character one, the hour and the day as before
  it('the study formatter on an intraday chart: a half hour drops its AM/PM, the hour and the day keep theirs', () => {
    const at = (iso) => Date.parse(`${iso}Z`) / 1000   // the chart's intraday time: the New York wall clock read as UTC
    expect(studyTickMarkFormatter(at('2026-09-15T10:30:00'), 3)).toBe('10:30')
    expect(studyTickMarkFormatter(at('2026-09-15T13:30:00'), 3)).toBe('1:30')
    expect(studyTickMarkFormatter(at('2026-09-15T10:00:00'), 3)).toBe('10 AM')
    expect(studyTickMarkFormatter(at('2026-09-15T12:00:00'), 3)).toBe('12 PM')
    expect(studyTickMarkFormatter(at('2026-09-15T09:30:00'), 2)).toBe('Sep 15')
    for (const t of ['09:30', '10:30', '12:30', '15:30']) expect(studyTickMarkFormatter(at(`2026-09-15T${t}:00`), 3).length).toBeLessThanOrEqual(5)
  })

  // The Study trade levels' axis tags (tradeMarks.tradeLevelLines) ask for dark chips with the level's ink, so they do not
  // read as the chart's own solid last-price tag; a line that asks for nothing keeps the library's colour-filled tag.
  it('a price line that asks for its own tag colours gets them; one that does not, does not', async () => {
    const lines = [
      { price: 120, color: '#df4646', title: 'STOP', lineVisible: false, axisLabelColor: '#3a1517', axisLabelTextColor: '#ff9b93' },
      { price: 130, color: '#2faf68', title: '' },
    ]
    render(<StockChart sym="item-levels" tf="D" barsOverride={FIXTURE_BARS} studyMode priceLines={lines} />)
    await waitFor(() => expect(lw.priceLines.some((p) => p.price === 120)).toBe(true))
    const stop = lw.priceLines.find((p) => p.price === 120)
    expect(stop).toMatchObject({ axisLabelColor: '#3a1517', axisLabelTextColor: '#ff9b93', lineVisible: false, title: 'STOP' })
    const plain = lw.priceLines.find((p) => p.price === 130)
    expect('axisLabelColor' in plain || 'axisLabelTextColor' in plain).toBe(false)
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
