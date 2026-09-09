/**
 * A REFUSED lightweight-charts `update()` must not take /charts down.
 *
 * 2026-09-09, in production: live breadth went dark, so the UCTA* daily serve
 * stopped appending its developing candle and the refetch's tail moved BACKWARDS
 * (2026-09-09 → 2026-09-08) while the plotted series still held the newer bar.
 * The post-setData live re-top then called `update()` at the older time; LWC
 * refuses a backwards write by THROWING ("Cannot update oldest data, last
 * time=[object Object], new time=[object Object]" — the `[object Object]` is the
 * tell that these are BusinessDay times, i.e. the string dates breadth bars
 * carry). That effect had no catch, the throw unwound into React's commit, and
 * /charts was a black ErrorBoundary screen in a reload-proof loop: the layout
 * re-mounted the same widget every time.
 *
 * A refusal is not corruption — the series keeps the newer bar and the next poll
 * re-tops it correctly. So the bar for this suite is deliberately blunt: with a
 * series whose `update()` ALWAYS throws, StockChart must still mount and still
 * accept a live tick. Any writer that lets that throw escape fails here.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const SYM = 'UCTA5'

// Every `update()` refused, exactly as LWC refuses a backwards write.
const refusals = { count: 0 }

vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {},
    update: () => {
      refusals.count += 1
      throw new Error('Cannot update oldest data, last time=[object Object], new time=[object Object]')
    },
    applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    dataByIndex: () => null, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
    barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
  }
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null, setVisibleRange: () => {}, scrollToPosition: () => {},
    subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
    timeToCoordinate: () => 0, coordinateToTime: () => null, resetTimeScale: () => {},
    options: () => ({}), width: () => 600,
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {},
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
  }
})

// A live price for THIS symbol is what arms the post-setData re-top (Writer D).
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({
    prices: {
      [SYM]: {
        price: 43.4, updated_at: Math.floor(Date.now() / 1000),
        day_open: 60.9, day_high: 60.9, day_low: 43.4, prev_close: 60.9,
        volume: 0, ext_session: false,
      },
    },
    staleSymbols: new Set(), isStreaming: true, status: 'live',
  }),
}))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
vi.mock('../utils/barsIDB', () => ({
  idbGet: async () => null, idbPut: async () => {}, mergeDelta: (_a, b) => b,
  idbDelete: async () => {}, idbDeleteIntraday: async () => {}, idbCountKeys: async () => 0,
  idbImportPack: async () => {}, idbApplyDelta: async () => {},
  _findRecentBarByT: () => null, _closeMismatch: () => false,
}))

// Daily bars in the BREADTH shape: string dates (LWC reads these as BusinessDay,
// which is why the production error printed `[object Object]`) and no volume.
// The tail is deliberately a couple of sessions old — the same "the server's tail
// went backwards" state the outage produced.
const FIXTURE_BARS = (() => {
  const out = []
  const d = new Date(Date.UTC(2026, 0, 5))
  for (let i = 0; i < 260; i++) {
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) {
      out.push({ t: d.toISOString().slice(0, 10), o: 55, h: 62, l: 43, c: 60.9, v: 0 })
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
})()

beforeEach(() => {
  cleanup()
  refusals.count = 0
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(
      String(url).includes('/api/bars/') ? { ticker: SYM, bars: FIXTURE_BARS } : {}),
  })))
})

const { default: StockChart } = await import('./StockChart')

/** The production failure was an ErrorBoundary trip, so assert against one. A
 *  throw from a passive effect is invisible to `expect(render).not.toThrow()` —
 *  the mount has already returned by the time the bars land and the re-top runs.
 *  This is the boundary /charts actually wraps the pane in. */
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? null : this.props.children }
}

async function mountAndSettle(ui) {
  const seen = []
  const boundary = React.createRef()
  render(<Boundary ref={boundary}>{ui}</Boundary>)
  // Wait until the paint path has actually attempted a write — otherwise a green
  // test only proves the bars never arrived.
  await waitFor(() => expect(refusals.count).toBeGreaterThan(0), { timeout: 4000 })
  return { boundary, seen }
}

describe('a refused series update never reaches the error boundary', () => {
  it('survives a daily chart whose every update() throws "Cannot update oldest data"', async () => {
    const { boundary } = await mountAndSettle(<StockChart sym={SYM} tf="D" />)
    expect(boundary.current.state.error).toBeNull()
  })

  it('survives the same on the line chart type (the non-OHLC re-top branch)', async () => {
    const { boundary } = await mountAndSettle(
      <StockChart sym={SYM} tf="D" settingsOverride={{ chartType: 'line' }} />)
    expect(boundary.current.state.error).toBeNull()
  })

  it('survives the same on a weekly chart (breadth widgets sit on D/W/M)', async () => {
    const { boundary } = await mountAndSettle(<StockChart sym={SYM} tf="W" />)
    expect(boundary.current.state.error).toBeNull()
  })
})
