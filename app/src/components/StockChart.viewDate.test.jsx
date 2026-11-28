// StockChart in the /charts date box's mode (owner, 2026-11-27): the member went to a date (Go to date, a year, the step
// buttons) and every next symbol opens framed at the SAME date and span instead of snapping to the present.
//   V1 daily: 1/3/2006 at the right edge (+0.5 bar) with the member's span; the next symbol opens there too
//   V2 15m: the right edge is the last 15m bar of that day, the span in 15m bars
//   V3 a symbol with no bar at the date: its EARLIEST bars, with a note naming both dates (never the present, never blank)
//   V4 the date cleared: the present again
//   V5 a range button / Reset view hand the date back (onAnchorRelease); the pass reports its anchor; getDateMeta reads
//      the anchor and the frame it gives (the double buffer's proof)
//   V6 (the cold-ticker measurement, 2026-11-28) an anchor read off the chart's OWN view after the member zoomed it
//      (anchorFromView) keeps the member's view: no snap to the day's last bar; the same new anchor without the flag frames
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react'

const lw = vi.hoisted(() => ({ created: 0, removed: 0, setData: 0, autoSize: [], resize: [], last: null, subs: new Map(), reads: 0 }))
// every adaptive frame loop made under the chart, with the options it was made with
const loops = vi.hoisted(() => [])
vi.mock('./chart/adaptiveFrameLoop', async (orig) => {
  const m = await orig()
  return { ...m, createAdaptiveFrameLoop: (o) => { loops.push(o); return m.createAdaptiveFrameLoop(o) } }
})
// the chart's live subscriptions: every subscribe* adds the handler, its unsubscribe* removes it
const track = vi.hoisted(() => (obj) => {
  for (const k of Object.keys(obj)) {
    const m = /^(un)?subscribe(.+)$/.exec(k)
    if (!m) continue
    obj[k] = (fn) => { const s = lw.subs.get(m[2]) || new Set(); lw.subs.set(m[2], s); if (m[1]) s.delete(fn); else s.add(fn) }
  }
  return obj
})

vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => { lw.setData++ }, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    dataByIndex: () => { lw.reads++; return null }, getPane: () => { lw.reads++; return { getHeight: () => 300, paneIndex: () => 0 } },
    barsInLogicalRange: () => null, data: () => { lw.reads++; return [] }, seriesType: () => 'Candlestick',
  }
  // Same surface as the smoke harness, except timeScale() is a STABLE object whose
  // setVisibleLogicalRange forwards to the test spy (the smoke version is a no-op).
  const timeScale = track({
    applyOptions: () => {}, fitContent: () => {},
    setVisibleLogicalRange: (r) => {
      lw.last = r
    },
    getVisibleLogicalRange: () => { lw.reads++; return lw.last },
    setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
    resetTimeScale: () => {}, options: () => ({}), width: () => 600,
    // Extra surface the overlay children (ChartVLineOverlay et al.) touch — they only
    // mount once there are bars, so the smoke harness never needed these.
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
  })
  const chart = track({
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: (o) => { if (o && 'autoSize' in o) lw.autoSize.push(o.autoSize) }, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: (w, h, f) => { lw.resize.push([w, h, f]) }, remove: () => { lw.removed++ }, takeScreenshot: () => document.createElement('canvas'),
  })
  return {
    createChart: (container) => {
      lw.created++
      const el = document.createElement('div')   // the library's own element, inside the container
      container?.appendChild?.(el)
      chart.chartElement = () => el
      return chart
    },
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

// ── fixtures: weekday daily bars (YYYY-MM-DD) and a few sessions of 15m bars (epoch seconds, 9:30-16:00 ET) ──
const weekdays = (fromIso, toIso) => {
  const out = []
  for (let ms = Date.parse(`${fromIso}T00:00:00Z`); ms <= Date.parse(`${toIso}T00:00:00Z`); ms += 86400000) {
    const d = new Date(ms).getUTCDay()
    if (d !== 0 && d !== 6) out.push(new Date(ms).toISOString().slice(0, 10))
  }
  return out
}
const dailyOf = (fromIso, toIso) => weekdays(fromIso, toIso).map((t, i) => ({ t, o: 10 + (i % 50), h: 11 + (i % 50), l: 9 + (i % 50), c: 10.5 + (i % 50), v: 1000 + i }))
const quarterHoursOf = (fromIso, toIso) => {
  const out = []
  for (const day of weekdays(fromIso, toIso)) {
    const open = Date.parse(`${day}T14:30:00Z`) / 1000
    for (let k = 0; k < 26; k++) out.push({ t: open + k * 900, o: 50, h: 51, l: 49, c: 50.5, v: 100 })
  }
  return out
}
const AAA = dailyOf('2005-01-03', '2007-12-31')
const BBB = dailyOf('2004-06-01', '2008-06-30')
const LATE = dailyOf('2010-01-04', '2012-12-31')   // listed after the date: no bar at 2006
const Q15 = quarterHoursOf('2005-12-27', '2006-01-10')
const idxOn = (bars, iso) => { let k = -1; const end = Date.parse(`${iso}T23:59:59Z`); bars.forEach((b, i) => { const ms = typeof b.t === 'number' ? b.t * 1000 : Date.parse(`${b.t}T00:00:00Z`); if (ms <= end) k = i }); return k }

beforeEach(() => {
  cleanup()
  Object.assign(lw, { created: 0, removed: 0, setData: 0, autoSize: [], resize: [], last: null, subs: new Map(), reads: 0 })
  loops.length = 0
  try { localStorage.clear() } catch { /* jsdom always has it */ }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
})

const { default: StockChart } = await import('./StockChart')
const { LayerPaintContext } = await import('./chart/layerPaint')

// the /charts workspace's chart: the date box's anchor (anchorDate + anchorWidth), no marker line, present kept on a switch
const Chart = ({ sym, tf = 'D', bars, date = '2006-01-03', width = 120, onRelease, onApi, fromView }) => (
  <StockChart sym={sym} tf={tf} chartId="view-date" barsOverride={bars} keepPresentOnSymbolChange
    anchorDate={date} anchorWidth={date ? width : null} hideAnchorMarker onAnchorRelease={onRelease} onDateNavApi={onApi}
    anchorFromView={fromView} />
)
const framedAt = async (bars, iso, width) => {
  const to = idxOn(bars, iso) + 0.5
  await waitFor(() => {
    expect(lw.last).toBeTruthy()
    expect(lw.last.to).toBeCloseTo(to, 6)
    expect(lw.last.from).toBeCloseTo(to - width, 6)
  })
}

describe('StockChart: the date the member went to (the date box anchor, owner 2026-11-27)', () => {
  it('V1 frames 1/3/2006 at the right edge with the member\'s span (daily), and every next symbol opens there too', async () => {
    const view = render(<Chart sym="AAA" bars={AAA} />)
    await framedAt(AAA, '2006-01-03', 120)
    view.rerender(<Chart sym="BBB" bars={BBB} />)        // the next symbol: the same date, the same span, never the present
    await framedAt(BBB, '2006-01-03', 120)
    expect(document.querySelector('[data-view-date-note]')).toBe(null)
    view.unmount()
  })
  it('V2 on 15m: the right edge is the last 15m bar of 1/3/2006, with the span in 15m bars', async () => {
    const view = render(<Chart sym="AAA" tf="15" bars={Q15} width={78} />)
    await framedAt(Q15, '2006-01-03', 78)
    view.unmount()
  })
  it('V3 a symbol with no bar at that date shows its EARLIEST bars with a note, never the present or a blank', async () => {
    const view = render(<Chart sym="AAA" bars={AAA} />)
    await framedAt(AAA, '2006-01-03', 120)
    view.rerender(<Chart sym="LATE" bars={LATE} />)
    await waitFor(() => {
      expect(lw.last.from).toBeCloseTo(-0.5, 6)
      expect(lw.last.to).toBeCloseTo(119.5, 6)
    })
    const note = await waitFor(() => { const n = document.querySelector('[data-view-date-note]'); expect(n).toBeTruthy(); return n })
    expect(note.textContent).toMatch(/1\/3\/2006/)
    expect(note.textContent).toMatch(/1\/4\/2010/)
    view.unmount()
  })
  it('V4 cleared (no date): the next frame is the present again', async () => {
    const view = render(<Chart sym="AAA" bars={AAA} />)
    await framedAt(AAA, '2006-01-03', 120)
    view.rerender(<Chart sym="AAA" bars={AAA} date={null} />)
    await waitFor(() => { expect(lw.last.to).toBeGreaterThan(AAA.length - 1) })
    view.unmount()
  })
  it('V5 a range button or Reset view hands the date back (onAnchorRelease); the chart reports its anchor and the frame it gives', async () => {
    const onRelease = vi.fn()
    let api = null
    const seen = []
    const view = render(
      <LayerPaintContext.Provider value={(r) => { seen.push(r) }}>
        <Chart sym="AAA" bars={AAA} onRelease={onRelease} onApi={(a) => { api = a }} />
      </LayerPaintContext.Provider>,
    )
    await framedAt(AAA, '2006-01-03', 120)
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    expect(seen[seen.length - 1].anchor).toBe('2006-01-03|120')
    const m = api.getDateMeta()
    const lastIdx = AAA.length - 1
    const to = idxOn(AAA, '2006-01-03') + 0.5
    expect(m.anchor).toEqual({ date: '2006-01-03', width: 120 })
    expect(m.anchorFrame.toRight).toBeCloseTo(lastIdx - to, 6)
    expect(m.anchorFrame.fromRight).toBeCloseTo(lastIdx - to + 120, 6)
    act(() => { api.applyRange(12) })
    expect(onRelease).toHaveBeenCalledTimes(1)
    act(() => { api.resetView() })
    expect(onRelease).toHaveBeenCalledTimes(2)
    view.unmount()
  })
  it("V6 an anchor read off the chart's own view after the member zoomed it keeps that view; without the flag it frames", async () => {
    const zoomOut = async (view) => {
      await framedAt(AAA, '2006-01-03', 120)
      const plot = document.querySelector('[data-guide="chart.plot"]')
      expect(plot).toBeTruthy()
      fireEvent.wheel(plot)                                  // the member's zoom (StockChart: userViewMovedRef)
      lw.last = { from: 200, to: 420 }                       // where the member's zoom left the view
      return view
    }
    const a = await zoomOut(render(<Chart sym="AAA" bars={AAA} />))
    a.rerender(<Chart sym="AAA" bars={AAA} date="2006-02-15" width={220} fromView />)
    await new Promise((r) => { setTimeout(r, 800) })         // the anchor's re-assert burst has run
    expect(lw.last).toEqual({ from: 200, to: 420 })          // kept: the member's own view
    a.unmount()
    const b = await zoomOut(render(<Chart sym="AAA" bars={AAA} />))
    b.rerender(<Chart sym="AAA" bars={AAA} date="2006-02-15" width={220} />)   // a jump of the date box: framed there
    await framedAt(AAA, '2006-02-15', 220)
    b.unmount()
  })
})
