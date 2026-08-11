// anchorDate contract (spec 2026-08-11): lastAnchorIdx picks the last bar
// at/before the END of the anchor day, across daily (ISO-string t) and
// intraday (unix-seconds t) series. -1 = anchor precedes all bars.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { lastAnchorIdx } from './StockChart'

// Shared with the lightweight-charts mock below: the WIRE test needs to see the
// visible-range calls the framing branches make. A component test that only
// mounts is blind to `anchorDate` being disconnected from the framing code.
const spy = vi.hoisted(() => ({ setVisibleLogicalRange: null }))

// ── Render harness: copied from StockChart.smoke.test.jsx (same mocks) so the
// component body actually executes in jsdom. lightweight-charts touches <canvas>.
vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    dataByIndex: () => null, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
    barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
  }
  // Same surface as the smoke harness, except timeScale() is a STABLE object whose
  // setVisibleLogicalRange forwards to the test spy (the smoke version is a no-op).
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {},
    setVisibleLogicalRange: (r) => { spy.setVisibleLogicalRange?.(r) },
    getVisibleLogicalRange: () => null,
    setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
    resetTimeScale: () => {}, options: () => ({}), width: () => 600,
    // Extra surface the overlay children (ChartVLineOverlay et al.) touch — they only
    // mount once there are bars, so the smoke harness never needed these.
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
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, createSeriesMarkers: () => ({ setMarkers: () => {} }),
    // Beyond the smoke harness: these are only reached once REAL bars flow through
    // the paint path (the smoke tests render with no bars, so they never touch them).
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
  }
})

// Realtime feeds open EventSource/WS — jsdom has neither. Neutralize them.
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
// A deep hook (useJ2ChartMarkers → useWatchlistAlerts) needs AuthProvider; stub it.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// jsdom has no IndexedDB; the bars cache layer would otherwise swallow the fetch.
vi.mock('../utils/barsIDB', () => ({
  idbGet: async () => null, idbPut: async () => {}, mergeDelta: (_a, b) => b,
}))

// 200 consecutive daily bars ending 2026-02-20; BAR_DATES[120] is the anchor day.
const BAR_DATES = Array.from({ length: 200 }, (_, i) =>
  new Date(Date.UTC(2026, 1, 20) - (199 - i) * 86400000).toISOString().slice(0, 10))
const ANCHOR_IDX = 120
const ANCHOR_DAY = BAR_DATES[ANCHOR_IDX]
const FIXTURE_BARS = BAR_DATES.map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i }))

beforeEach(() => {
  cleanup()
  spy.setVisibleLogicalRange = vi.fn()
  // SWR data hooks fetch; serve real bars on the bars route, empty-ish elsewhere.
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(
      String(url).includes('/api/bars/') ? { ticker: 'AAPL', bars: FIXTURE_BARS } : {}),
  })))
})

// Import AFTER the mocks are registered.
const { default: StockChart } = await import('./StockChart')

const D = (t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 })

describe('lastAnchorIdx', () => {
  it('daily: picks the anchor-day bar when present', () => {
    const bars = [D('2026-02-09'), D('2026-02-10'), D('2026-02-11'), D('2026-02-12')]
    expect(lastAnchorIdx(bars, '2026-02-11')).toBe(2)
  })
  it('daily: weekend anchor falls back to the prior session', () => {
    const bars = [D('2026-02-06'), D('2026-02-09')] // Fri, Mon
    expect(lastAnchorIdx(bars, '2026-02-08')).toBe(0) // Sunday → Friday
  })
  it('intraday: unix-second bars on the anchor day are included through day end', () => {
    // 2026-02-11 14:30 & 20:00 UTC, then 2026-02-12 14:30 UTC
    const bars = [D(1770820200), D(1770840000), D(1770906600)]
    expect(lastAnchorIdx(bars, '2026-02-11')).toBe(1)
  })
  it('anchor before all bars → -1; empty/absent → -1', () => {
    expect(lastAnchorIdx([D('2026-02-09')], '2026-01-01')).toBe(-1)
    expect(lastAnchorIdx([], '2026-02-09')).toBe(-1)
    expect(lastAnchorIdx(null, '2026-02-09')).toBe(-1)
  })
  it('anchor after all bars → last index (anchored at present is a no-op frame)', () => {
    const bars = [D('2026-02-09'), D('2026-02-10')]
    expect(lastAnchorIdx(bars, '2026-03-01')).toBe(1)
  })
})

describe('anchored chart — "Back to today" pill', () => {
  const LABEL = '⟲ Back to today'

  it('renders the exitReplayLabel pill when anchorDate + onExitReplay are set', () => {
    render(<StockChart sym="AAPL" tf="D" anchorDate="2026-02-11" onExitReplay={() => {}} exitReplayLabel={LABEL} />)
    expect(screen.getByRole('button', { name: LABEL })).toBeTruthy()
  })

  it('clicking the pill calls onExitReplay', () => {
    const onExit = vi.fn()
    render(<StockChart sym="AAPL" tf="D" anchorDate="2026-02-11" onExitReplay={onExit} exitReplayLabel={LABEL} />)
    fireEvent.click(screen.getByRole('button', { name: LABEL }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('no anchorDate (and no replay/startMarker) → no pill at all', () => {
    render(<StockChart sym="AAPL" tf="D" onExitReplay={() => {}} exitReplayLabel={LABEL} />)
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull()
    expect(screen.queryByRole('button', { name: '⟲ Exit Replay Mode' })).toBeNull()
  })

  it('replayCutoff without exitReplayLabel keeps the original pill text', () => {
    render(<StockChart sym="AAPL" tf="D" replayCutoff="2026-02-11" onExitReplay={() => {}} />)
    expect(screen.getByRole('button', { name: '⟲ Exit Replay Mode' })).toBeTruthy()
  })
})

// The WIRE. lastAnchorIdx can be perfect and the pill can render while `anchorDate`
// reaches no framing code at all — the failure mode component tests are blind to
// (8 features "built, tested, green, connected to nothing", 2026-08). This asserts
// the framed window actually ENDS at the anchor bar, with the later bars off-screen
// right rather than the newest bar pinned at the right edge.
describe('anchorDate → framing wire', () => {
  const rangesFramed = () => spy.setVisibleLogicalRange.mock.calls.map(c => c[0])

  it('frames the default window ENDING at the anchor bar, not at the newest bar', async () => {
    render(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    await waitFor(() => {
      // Some applied range must put its right edge just past the anchor bar (the
      // anchor sits at LAST_CANDLE_POS, so `to` overshoots it by a fraction of the
      // window) and its left edge well before it — i.e. the anchor day is the last
      // visible session, with ~80 later bars loaded off-screen to the right.
      const hit = rangesFramed().some(r =>
        r && r.to > ANCHOR_IDX && r.to < ANCHOR_IDX + 30 && r.from < ANCHOR_IDX)
      expect(hit).toBe(true)
    }, { timeout: 3000 })
  })

  it('without anchorDate the same data frames the NEWEST bar at the right edge', async () => {
    render(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} />)
    await waitFor(() => {
      const hit = rangesFramed().some(r => r && r.to > FIXTURE_BARS.length - 1)
      expect(hit).toBe(true)
    }, { timeout: 3000 })
    // …and never lands the right edge on the anchor bar.
    expect(rangesFramed().some(r => r && r.to > ANCHOR_IDX && r.to < ANCHOR_IDX + 30)).toBe(false)
  })
})
