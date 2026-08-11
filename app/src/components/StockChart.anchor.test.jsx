// anchorDate contract (spec 2026-08-11): lastAnchorIdx picks the last bar
// at/before the END of the anchor day, across daily (ISO-string t) and
// intraday (unix-seconds t) series. -1 = anchor precedes all bars.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

// Shared with the lightweight-charts mock below: the WIRE tests need to see the
// visible-range calls the framing branches make. A component test that only
// mounts is blind to `anchorDate` being disconnected from the framing code.
// `last` also feeds getVisibleLogicalRange — a mock that always answers null keeps
// the didPreserve / settling paths dead, and those are exactly the paths that can
// clobber the anchor on a symbol switch or TF flip.
const spy = vi.hoisted(() => ({ setVisibleLogicalRange: null, last: null }))

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
    setVisibleLogicalRange: (r) => { spy.last = r; spy.setVisibleLogicalRange?.(r) },
    getVisibleLogicalRange: () => spy.last,
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
const SECOND_IDX = 60
const SECOND_DAY = BAR_DATES[SECOND_IDX]
const LAST_IDX = BAR_DATES.length - 1
const FIXTURE_BARS = BAR_DATES.map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i }))
// A SHORTER second symbol: same leading dates (so ANCHOR_IDX is unchanged) but 40 fewer
// bars AFTER the anchor. This asymmetry is what makes the symbol-switch guard OBSERVABLE
// — with two equal-length histories, "preserve the previous ticker's bars-from-right"
// and "re-anchor" compute the SAME window, and the test passes without the guard.
const FIXTURE_SHORT = FIXTURE_BARS.slice(0, 160)

beforeEach(() => {
  cleanup()
  spy.setVisibleLogicalRange = vi.fn()
  spy.last = null
  // SWR data hooks fetch; serve real bars on the bars route, empty-ish elsewhere.
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(
      String(url).includes('/api/bars/') ? { ticker: 'AAPL', bars: FIXTURE_BARS } : {}),
  })))
})

// Import AFTER the mocks are registered.
const { default: StockChart, lastAnchorIdx } = await import('./StockChart')

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
    render(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS}
      anchorDate={ANCHOR_DAY} onExitReplay={() => {}} exitReplayLabel={LABEL} />)
    expect(screen.getByRole('button', { name: LABEL })).toBeTruthy()
  })

  it('clicking the pill calls onExitReplay', () => {
    const onExit = vi.fn()
    render(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS}
      anchorDate={ANCHOR_DAY} onExitReplay={onExit} exitReplayLabel={LABEL} />)
    fireEvent.click(screen.getByRole('button', { name: LABEL }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('no anchorDate (and no replay/startMarker) → no pill at all', () => {
    render(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS}
      onExitReplay={() => {}} exitReplayLabel={LABEL} />)
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull()
    expect(screen.queryByRole('button', { name: '⟲ Exit Replay Mode' })).toBeNull()
  })

  it('replayCutoff without exitReplayLabel keeps the original pill text', () => {
    render(<StockChart sym="AAPL" tf="D" replayCutoff="2026-02-11" onExitReplay={() => {}} />)
    expect(screen.getByRole('button', { name: '⟲ Exit Replay Mode' })).toBeTruthy()
  })

  // M6 / the INERT rule: an anchor naming no loaded bar must produce no pill (and no
  // marker, and no frame — see the framing suite). A chart already sitting at present
  // offering "Back to today" is a button that does nothing.
  it('anchor preceding every loaded bar → INERT: no pill', () => {
    render(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS}
      anchorDate="1999-01-04" onExitReplay={() => {}} exitReplayLabel={LABEL} />)
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull()
  })
})

// The WIRE. lastAnchorIdx can be perfect and the pill can render while `anchorDate`
// reaches no framing code at all — the failure mode component tests are blind to
// (8 features "built, tested, green, connected to nothing", 2026-08). This asserts
// the framed window actually ENDS at the anchor bar, with the later bars off-screen
// right rather than the newest bar pinned at the right edge.
describe('anchorDate → framing wire', () => {
  // ⚠️ Always assert the LAST applied range, never `.some(...)`. The failure this
  // suite exists to catch is a guard RE-FRAMING the chart back to present one commit
  // after the anchor branch got it right — and `.some()` is blind to exactly that:
  // the anchor's own (later clobbered) call is still in the list. Last call == what
  // the user is looking at.
  const lastRange = () => {
    const calls = spy.setVisibleLogicalRange.mock.calls
    return calls.length ? calls[calls.length - 1][0] : null
  }
  // The anchor bar sits at LAST_CANDLE_POS, so `to` overshoots its index by a fraction
  // of the window; `from` is a default-zoom width behind it.
  const endsAt = (r, idx) => !!r && r.to > idx && r.to < idx + 30 && r.from < idx
  const endsAtPresent = (r) => !!r && r.to > LAST_IDX
  // Stronger than lastRange() for the "anchor wins" cases: under the RULE nothing may
  // auto-frame anywhere else while the anchor owns the view, so a clobber-then-restore
  // WITHIN one commit is still a violation (and is invisible to a last-call assertion).
  const everyRangeEndsAt = (idx) => {
    const calls = spy.setVisibleLogicalRange.mock.calls
    return calls.length > 0 && calls.every(c => endsAt(c[0], idx))
  }

  it('frames the default window ENDING at the anchor bar, not at the newest bar', async () => {
    render(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    // The anchor day is the last VISIBLE session, with ~80 later bars loaded off-screen
    // to the right (never sliced — that is the "reveal" half of anchored+reveal).
    await waitFor(() => expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(true), { timeout: 3000 })
  })

  it('without anchorDate the same data frames the NEWEST bar at the right edge', async () => {
    render(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} />)
    await waitFor(() => expect(endsAtPresent(lastRange())).toBe(true), { timeout: 3000 })
    expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(false)
  })

  it('anchor preceding every loaded bar → INERT: frames present, not the anchor', async () => {
    render(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate="1999-01-04" />)
    await waitFor(() => expect(endsAtPresent(lastRange())).toBe(true), { timeout: 3000 })
  })

  // ── THE RULE: the anchor wins everywhere the chart would otherwise auto-frame,
  // and every anchorDate transition re-frames a chart that is already mounted. ──

  it('anchorDate → null ("Back to today") re-frames to the present-day default', async () => {
    const { rerender } = render(
      <StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    await waitFor(() => expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(true), { timeout: 3000 })
    rerender(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={null} />)
    await waitFor(() => expect(endsAtPresent(lastRange())).toBe(true), { timeout: 3000 })
  })

  it('null → anchorDate on a mounted chart re-frames to the anchor', async () => {
    const { rerender } = render(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} />)
    await waitFor(() => expect(endsAtPresent(lastRange())).toBe(true), { timeout: 3000 })
    rerender(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    await waitFor(() => expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(true), { timeout: 3000 })
  })

  it('dateA → dateB re-frames to the NEW anchor', async () => {
    const { rerender } = render(
      <StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    await waitFor(() => expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(true), { timeout: 3000 })
    rerender(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={SECOND_DAY} />)
    await waitFor(() => expect(endsAt(lastRange(), SECOND_IDX)).toBe(true), { timeout: 3000 })
  })

  // The release half of the contract, and the only behaviour the anchorDate-transition
  // effect uniquely owns: after a pan the anchor stops re-asserting itself, but choosing
  // a DIFFERENT moment is a fresh intent that re-takes the view (the same re-arm a
  // symbol/timeframe switch performs).
  it('a user pan releases the anchor, but a NEW anchorDate re-takes the view', async () => {
    const { container, rerender } = render(
      <StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    await waitFor(() => expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(true), { timeout: 3000 })
    const el = container.querySelector('[class*="chart"]')
    expect(el).toBeTruthy()
    fireEvent.wheel(el)          // latches userViewMovedRef — anchor re-assertion stops
    spy.setVisibleLogicalRange.mockClear()
    rerender(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={SECOND_DAY} />)
    await waitFor(() => expect(endsAt(lastRange(), SECOND_IDX)).toBe(true), { timeout: 3000 })
  })

  // Load-bearing for the Desk follow-along pane, which walks `sym` under one constant
  // anchorDate. The symbol switch takes the didPreserve path, which would otherwise
  // inherit the previous ticker's relative position instead of re-anchoring.
  it('symbol switch under a constant anchorDate re-anchors on the new ticker', async () => {
    const { rerender } = render(
      <StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    await waitFor(() => expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(true), { timeout: 3000 })
    spy.setVisibleLogicalRange.mockClear()   // only judge frames applied AFTER the switch
    // FIXTURE_SHORT deliberately has a different post-anchor length (see its comment).
    rerender(<StockChart sym="MSFT" tf="D" barsOverride={FIXTURE_SHORT} anchorDate={ANCHOR_DAY} />)
    await waitFor(() => expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(true), { timeout: 3000 })
    // Not merely restored at the end — never framed anywhere else in between.
    expect(everyRangeEndsAt(ANCHOR_IDX)).toBe(true)
  })

  // A TF flip arms pendingTfReframeRef, whose settling guard re-asserts NEWEST-at-right
  // on every commit — the clobber that made the anchored chart flicker back to present.
  it('timeframe flip keeps the anchor (the settling guard must not pull it to present)', async () => {
    const { rerender } = render(
      <StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    await waitFor(() => expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(true), { timeout: 3000 })
    spy.setVisibleLogicalRange.mockClear()
    rerender(<StockChart sym="AAPL" tf="W" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    await waitFor(() => expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(true), { timeout: 3000 })
    expect(everyRangeEndsAt(ANCHOR_IDX)).toBe(true)
  })
})
