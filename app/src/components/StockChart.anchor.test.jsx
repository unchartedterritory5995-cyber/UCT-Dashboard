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
// `swallowUntil` reproduces the LIVE first-load layout race in the harness: real
// lightweight-charts clamps/ignores a logical-range write issued while the autoSize
// container is still settling. Writes before the deadline are still RECORDED (so the
// call list shows the attempt) but do not take effect — `last`, which backs
// getVisibleLogicalRange, keeps reporting the un-anchored view. jsdom has no layout, so
// without this the race cannot be reproduced and every suite passes on a broken chart.
// `perturb`: simulate real lightweight-charts nudging the SETTLED range by a hair
// after a programmatic write (future-axis padding / rightBarStaysOnScroll / whitespace
// bars). Defaults to 0 (mock is exact). The view-lock drift regression sets it so that
// a design which RE-MEASURES the settled view on every switch visibly walks the frame,
// while an apply-only design stays put.
const spy = vi.hoisted(() => ({ setVisibleLogicalRange: null, last: null, swallowUntil: 0, perturb: 0 }))

// The marker's props are the only observable of the anchorMarker resolution. Without
// this capture, reverting anchorMarker to the raw (bars, anchorDate) pair — undoing the
// whole marker fix, intraday no-line defect included — reds nothing.
const overlay = vi.hoisted(() => ({ props: null }))
vi.mock('./chart/ChartVLineOverlay', () => ({
  default: (props) => { overlay.props = props; return null },
}))

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
    setVisibleLogicalRange: (r) => {
      spy.setVisibleLogicalRange?.(r)                       // the attempt is always recorded
      if (Date.now() < spy.swallowUntil) return             // …but clamped away by the layout race
      // effective range (what the user sees) — optionally nudged, like the real lib
      spy.last = spy.perturb ? { from: r.from + spy.perturb, to: r.to + spy.perturb } : r
    },
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

// ── Marker fixtures ──
// WEEKDAY_BARS has real Fri→Mon gaps, which is what makes the marker assertion
// DISCRIMINATING: for a SUNDAY anchor, "last bar at/before" = Friday while the overlay's
// own nearest-bar matching would pick MONDAY (1 day away vs 2). Consecutive-calendar-day
// bars cannot tell those two rules apart.
const WEEKDAY_BARS = (() => {
  const out = []
  for (let ms = Date.UTC(2025, 0, 1); out.length < 200; ms += 86400000) {
    const dow = new Date(ms).getUTCDay()
    if (dow === 0 || dow === 6) continue
    const i = out.length
    out.push({ t: new Date(ms).toISOString().slice(0, 10), o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i })
  }
  return out
})()
const FRI_IDX = WEEKDAY_BARS.findIndex((b, i) =>
  i > 100 && new Date(`${b.t}T00:00:00Z`).getUTCDay() === 5)
// The Sunday two days after that Friday — a session that has no bar of its own.
const SUNDAY_ANCHOR = new Date(Date.parse(`${WEEKDAY_BARS[FRI_IDX].t}T00:00:00Z`) + 2 * 86400000)
  .toISOString().slice(0, 10)

// Intraday: unix-SECOND timestamps, 5 RTH bars/day on weekdays. The overlay parses with
// Date.parse, which reads no bare epoch — so this is the series on which the un-projected
// wiring drew no line at all.
const INTRADAY_BARS = (() => {
  const out = []
  for (let day = Date.UTC(2025, 0, 1); out.length < 200; day += 86400000) {
    const dow = new Date(day).getUTCDay()
    if (dow === 0 || dow === 6) continue
    for (const hour of [15, 16, 17, 18, 19]) {
      const i = out.length
      out.push({ t: (day + hour * 3600000) / 1000, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i })
    }
  }
  return out
})()
const INTRADAY_ANCHOR = new Date(INTRADAY_BARS[120].t * 1000).toISOString().slice(0, 10)

beforeEach(() => {
  cleanup()
  spy.setVisibleLogicalRange = vi.fn()
  spy.last = null
  spy.swallowUntil = 0
  spy.perturb = 0
  try { localStorage.clear() } catch { /* jsdom always has it */ }
  overlay.props = null
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

  // The RELEASE half of the RULE, asserted at the only moment it is observable: an
  // auto-frame path running while the latch is SET. Without this the `!userViewMovedRef`
  // term in anchorOwnsFrame() is a gate that cannot fail — the pan test above re-arms it
  // one line later, so deleting the term reds nothing.
  // Vehicle: a phased data commit (bar COUNT changes, anchorDate/sym/tf all held), which
  // is the IDB→network→backfill path. FIXTURE_SHORT drops 40 bars AFTER the anchor, so
  // the relative-preserve result (~idx 88) and the anchor frame (~idx 128) diverge —
  // with equal-length fixtures the two rules compute the same window and prove nothing.
  it('after a pan, a phased data commit does NOT re-anchor (the latch holds)', async () => {
    const { container, rerender } = render(
      <StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    await waitFor(() => expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(true), { timeout: 3000 })
    fireEvent.wheel(container.querySelector('[class*="chart"]'))
    spy.setVisibleLogicalRange.mockClear()   // spy.last (the pre-update range) is kept
    rerender(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_SHORT} anchorDate={ANCHOR_DAY} />)
    await waitFor(() => expect(lastRange()).toBeTruthy(), { timeout: 3000 })
    expect(endsAt(lastRange(), ANCHOR_IDX)).toBe(false)
    // Positively the preserve result: the user's window stayed left of the anchor.
    expect(lastRange().to).toBeLessThan(ANCHOR_IDX)
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

// LIVE-ONLY REGRESSION (2026-08-11, found in the browser with all 23 suites green).
// The anchor frame was applied exactly once, during the first-load layout race, and real
// lightweight-charts threw that write away — the popup opened at TODAY with the gold
// marker correctly drawn at the anchor. These tests assert on the EFFECTIVE range
// (spy.last / getVisibleLogicalRange), never on the call list: the losing write is in the
// call list, which is precisely why the old assertions could not see this.
describe('anchorDate → survives the first-load layout race', () => {
  // The un-anchored view the chart falls back to while the container settles.
  const PRESENT_DEFAULT = { from: LAST_IDX - 65, to: LAST_IDX + 5 }

  it('converges on the anchor frame even when early writes are clamped away', async () => {
    spy.last = { ...PRESENT_DEFAULT }
    spy.swallowUntil = Date.now() + 250     // ~the real settle window
    render(<StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    // Every render-driven attempt lands inside the swallow window, so only a re-assert
    // scheduled to fire AFTER it can make the anchor stick.
    await waitFor(() => expect(spy.last.to > ANCHOR_IDX && spy.last.to < ANCHOR_IDX + 30).toBe(true),
      { timeout: 3000 })
    expect(spy.last.from).toBeLessThan(ANCHOR_IDX)
  })

  it('but a pan during that window ends the re-assertion (the latch still wins)', async () => {
    spy.last = { ...PRESENT_DEFAULT }
    spy.swallowUntil = Date.now() + 250
    const { container } = render(
      <StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS} anchorDate={ANCHOR_DAY} />)
    fireEvent.wheel(container.querySelector('[class*="chart"]'))   // latch before the burst lands
    // Outlast the whole burst (its tail is 1200ms), then confirm nothing re-anchored.
    await new Promise(r => setTimeout(r, 1400))
    expect(spy.last).toEqual(PRESENT_DEFAULT)
  })
})

// The marker must designate the SAME bar the frame ends at. These assert against the
// props ChartVLineOverlay is actually handed — the only place that resolution is
// observable, and the reason the overlay is mocked at the top of this file.
describe('anchorDate → marker wiring', () => {
  it('daily: the overlay gets the ANCHOR BAR, not the raw anchorDate', async () => {
    render(<StockChart sym="AAPL" tf="D" barsOverride={WEEKDAY_BARS} anchorDate={SUNDAY_ANCHOR} />)
    await waitFor(() => expect(overlay.props).toBeTruthy(), { timeout: 3000 })
    // Sunday has no bar. The frame ends on the FRIDAY, so the line must too — the
    // overlay's own nearest-bar rule would have chosen the following Monday.
    expect(overlay.props.date).toBe(WEEKDAY_BARS[FRI_IDX].t)
    expect(overlay.props.date).not.toBe(SUNDAY_ANCHOR)
    expect(overlay.props.date).not.toBe(WEEKDAY_BARS[FRI_IDX + 1].t)
    // …and in the DRAWN series' index space, since the overlay feeds the index it
    // finds straight to logicalToCoordinate.
    expect(overlay.props.bars.findIndex(b => b.t === overlay.props.date)).toBe(FRI_IDX)
  })

  it('intraday: the overlay gets a date it can actually hit (epochs are projected)', async () => {
    render(<StockChart sym="AAPL" tf="60" barsOverride={INTRADAY_BARS} anchorDate={INTRADAY_ANCHOR} />)
    await waitFor(() => expect(overlay.props).toBeTruthy(), { timeout: 3000 })
    const { bars, date } = overlay.props
    // A bare epoch is unparseable to the overlay → it drew NO line. Both the date and
    // every bar it searches must be Date.parse-able…
    expect(Number.isFinite(Date.parse(date))).toBe(true)
    expect(bars.every(b => Number.isFinite(Date.parse(b.t)))).toBe(true)
    // …and the date must be an EXACT, unique hit, so "nearest" cannot drift off the
    // frame's bar. (Index-space-agnostic: survives whatever session filtering applies.)
    expect(bars.filter(b => b.t === date)).toHaveLength(1)
  })

  it('anchor preceding every loaded bar → INERT: the overlay never mounts', async () => {
    render(<StockChart sym="AAPL" tf="D" barsOverride={WEEKDAY_BARS} anchorDate="1999-01-04" />)
    await waitFor(() => expect(spy.setVisibleLogicalRange).toHaveBeenCalled(), { timeout: 3000 })
    expect(overlay.props).toBeNull()
  })
})

// ── VIEW-LOCK DRIFT REGRESSION (2026-08-17) ────────────────────────────────
// The bug: on the Charts workspace, panning the chart and then flipping through
// tickers sent the view "back in time" a couple months PER SWITCH — a runaway
// leftward drift. Root cause: the view lock was RE-MEASURED off the freshly
// re-framed (settled) view on every symbol switch and re-stored. measure(apply(x))
// is not exactly x — real lightweight-charts nudges the settled range (future-axis
// pad, rightBarStaysOnScroll, whitespace bars) — so re-storing that nudged value
// each switch compounded without bound.
//
// The fix: the lock is written ONLY by an explicit user drag/zoom; a symbol switch
// only APPLIES it. `spy.perturb` models the real-lib nudge, so the OLD re-measuring
// design walks the stored anchorFrac every switch and this test reds; the apply-only
// design leaves the stored lock byte-stable no matter how many tickers you flip.
describe('view lock — no drift across ticker switches (apply-only)', () => {
  const LOCK_KEY = 'test.viewlock'
  const lastRange = () => {
    const calls = spy.setVisibleLogicalRange.mock.calls
    return calls.length ? calls[calls.length - 1][0] : null
  }
  const anchorFracOf = (r) => (r && (r.to - r.from) > 0) ? (LAST_IDX - r.from) / (r.to - r.from) : null

  it('a pan is captured once, then N ticker switches never move the stored lock', async () => {
    const { container, rerender } = render(
      <StockChart sym="AAPL" tf="D" barsOverride={FIXTURE_BARS}
        carryDragPlacement keepPresentOnSymbolChange viewLockKey={LOCK_KEY} />)
    await waitFor(() => expect(spy.setVisibleLogicalRange).toHaveBeenCalled(), { timeout: 3000 })

    // Simulate a real leftward pan: the newest bar sits well left of the right edge.
    // Then fire a genuine pointer drag so _captureUserLock records THIS view as the lock.
    spy.last = { from: 40, to: 240 } // newest idx 199 → anchorFrac (199-40)/200 = 0.795
    const el = container.querySelector('[class*="chart"]')
    expect(el).toBeTruthy()
    fireEvent.pointerDown(el, { clientX: 300, clientY: 200 })
    fireEvent.pointerMove(el, { clientX: 120, clientY: 200 }) // >4px → a deliberate move
    fireEvent.pointerUp(el, { clientX: 120, clientY: 200 })

    await waitFor(() => expect(localStorage.getItem(LOCK_KEY)).toBeTruthy(), { timeout: 3000 })
    const stored0 = JSON.parse(localStorage.getItem(LOCK_KEY))
    expect(stored0.anchorFrac).toBeGreaterThan(0.02) // a real, non-default lock was taken
    const frac0 = stored0.anchorFrac

    // From here on the real lib nudges every settled range by half a bar.
    spy.perturb = 0.5

    // Flip through several tickers. The stored lock must be byte-identical each time —
    // the OLD re-measuring code re-writes (and drifts) anchorFrac on every one of these.
    const syms = ['MSFT', 'GOOG', 'NVDA', 'TSLA', 'AMD']
    for (const s of syms) {
      spy.setVisibleLogicalRange.mockClear()
      rerender(<StockChart sym={s} tf="D" barsOverride={FIXTURE_BARS}
        carryDragPlacement keepPresentOnSymbolChange viewLockKey={LOCK_KEY} />)
      await waitFor(() => expect(spy.setVisibleLogicalRange).toHaveBeenCalled(), { timeout: 3000 })
      const stored = JSON.parse(localStorage.getItem(LOCK_KEY))
      // The stored horizontal lock never moves — this is the anti-drift invariant.
      expect(stored.anchorFrac).toBe(frac0)
      // And the applied frame lands at that same fraction (± the single-nudge epsilon,
      // NOT an accumulating one): the newest bar stays where the user put it.
      expect(Math.abs(anchorFracOf(lastRange()) - frac0)).toBeLessThan(0.02)
    }
  })
})
