// Desk-mention chart markers (spec 2026-08-11 §C) — a new CATEGORY in StockChart's
// existing marker system.
//
// Three things can break independently and only one of them is visible to a pure
// unit test, so all three are asserted here:
//   1. the MAPPING       — day-collapse, date passthrough, intraday refusal
//   2. the FETCH GATE    — an OFF toggle must issue NO request (the null SWR key)
//   3. the WIRES         — the built markers must actually reach createSeriesMarkers,
//                          and a click on one must actually navigate to the Desk.
// (2) and (3) are the severed-wire cases: buildDeskMentionMarkers can be perfect while
// nothing calls it, or while its output never joins `mergedMarkers`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

// Shared with the lightweight-charts mock: the marker arrays handed to the marker
// controller, and every click handler the chart's effects subscribe.
const lw = vi.hoisted(() => ({ markerSets: [], clickHandlers: [] }))

// ── Render harness: copied from StockChart.anchor.test.jsx (same mocks) so the
// component body actually executes in jsdom, with two additions — createSeriesMarkers
// /setMarkers RECORD their argument, and subscribeClick COLLECTS its handler.
vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
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
    subscribeClick: (h) => { lw.clickHandlers.push(h) },
    unsubscribeClick: (h) => { lw.clickHandlers = lw.clickHandlers.filter(x => x !== h) },
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {},
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    createSeriesMarkers: (_s, m) => {
      lw.markerSets.push(m)
      return { setMarkers: (next) => { lw.markerSets.push(next) } }
    },
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

// 200 consecutive daily bars ending 2026-02-20 (the anchor suite's fixture).
const BAR_DATES = Array.from({ length: 200 }, (_, i) =>
  new Date(Date.UTC(2026, 1, 20) - (199 - i) * 86400000).toISOString().slice(0, 10))
const FIXTURE_BARS = BAR_DATES.map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i }))
// Three mention days that exist as bars. Payload order is the endpoint's contract:
// newest-VIDEO-first by anchor_date, ascending `t` inside each video.
//   DAY_A — one video, discussed twice        → collapse keeps the earlier t (612)
//   DAY_B — one video, one mention at t=0     → the seek must survive as &t=0
//   DAY_C — TWO shows taped the same day, interleaved. This is the discriminating
//           case (Phase 2A review): `t` is a PER-VIDEO offset, so
//             • "first row of the day"  → ytC_new @ 900  (wrong t)
//             • "lowest t of the day"   → ytC_old @ 30   (wrong SESSION — the older one)
//           The rule picks the day's NEWEST video (first in payload order) and that
//           video's earliest mention → ytC_new @ 300.
const DAY_A = BAR_DATES[150]
const DAY_B = BAR_DATES[120]
const DAY_C = BAR_DATES[90]
// Intraday series (unix SECONDS, 5 RTH bars/weekday) — the custom-TF test resamples,
// and the resampler reads real clock times, so daily date strings cannot feed it.
const INTRADAY_BARS = (() => {
  const out = []
  for (let day = Date.UTC(2026, 0, 5); out.length < 200; day += 86400000) {
    const dow = new Date(day).getUTCDay()
    if (dow === 0 || dow === 6) continue
    for (const hour of [15, 16, 17, 18, 19]) {
      const i = out.length
      out.push({ t: (day + hour * 3600000) / 1000, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i })
    }
  }
  return out
})()

const MENTIONS = [
  { video_id: 9, youtube_id: 'ytA1', title: 'Session A', anchor_date: DAY_A, t: 612, note: 'first look' },
  { video_id: 9, youtube_id: 'ytA1', title: 'Session A', anchor_date: DAY_A, t: 1804, note: 'revisited late' },
  { video_id: 4, youtube_id: 'ytB2', title: 'Session B', anchor_date: DAY_B, t: 0, note: 'breakout call' },
  { video_id: 12, youtube_id: 'ytC_new', title: 'Evening Update', anchor_date: DAY_C, t: 900, note: 'late recap' },
  { video_id: 12, youtube_id: 'ytC_new', title: 'Evening Update', anchor_date: DAY_C, t: 300, note: 'opening take' },
  { video_id: 3, youtube_id: 'ytC_old', title: 'Morning Prep', anchor_date: DAY_C, t: 30, note: 'watchlist' },
]

// ⚠️ The bars response must MATCH the requested timeframe. `barsOverride` does not
// stop the chart fetching a base series, and a CUSTOM code (e.g. '240') resamples
// whatever comes back — feeding daily 'YYYY-MM-DD' bars into the intraday resampler
// throws `RangeError: Invalid time value` from a rAF, which surfaces as an unhandled
// error rather than a test failure. Serve unix-second bars whenever `tf` is numeric.
const barsOrPayload = (url) => {
  if (url.includes('/api/bars/')) {
    const tf = new URLSearchParams(url.split('?')[1] || '').get('tf') || 'D'
    return { ticker: 'AAPL', bars: /^\d+$/.test(tf) ? INTRADAY_BARS : FIXTURE_BARS }
  }
  if (url.includes('/mentions')) return { mentions: MENTIONS, as_of: '2026-02-20' }
  return {}
}

// SWR dedupes across tests by cache key; a fresh provider per render is the cheap
// alternative to clearing its global cache, and `sym` is varied where it matters.
let fetchSpy
beforeEach(() => {
  cleanup()
  lw.markerSets = []
  lw.clickHandlers = []
  fetchSpy = vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(barsOrPayload(String(url))),
  }))
  vi.stubGlobal('fetch', fetchSpy)
})

// Import AFTER the mocks are registered.
const { default: StockChart, buildDeskMentionMarkers, deskMentionHref, DESK_MARKER_COLOR } =
  await import('./StockChart')

const mentionUrls = () =>
  fetchSpy.mock.calls.map(c => String(c[0])).filter(u => u.includes('/mentions'))
const deskMarkersDrawn = () => {
  const last = lw.markerSets[lw.markerSets.length - 1] || []
  return last.filter(m => String(m?.id || '').startsWith('desk-'))
}

/* ── 1. Mapping ───────────────────────────────────────────────────────────── */

describe('buildDeskMentionMarkers', () => {
  it('collapses a multi-mention DAY to one marker, keeping that video\'s earliest', () => {
    const out = buildDeskMentionMarkers(MENTIONS, 'D')
    expect(out).toHaveLength(3)                       // 6 mentions, 3 distinct days
    expect(out.map(m => m.time)).toEqual([DAY_A, DAY_B, DAY_C])   // payload day order kept
    expect(out[0]._deskMention.t).toBe(612)
    expect(out[0]._deskMention.note).toBe('first look')
  })

  // The Phase 2A review case. See the DAY_C fixture comment for what each wrong rule
  // would return — both are reachable one edit away from the implemented one.
  it('two SHOWS on one day → the NEWEST video, at that video\'s earliest t', () => {
    const c = buildDeskMentionMarkers(MENTIONS, 'D').find(m => m.time === DAY_C)
    expect(c._deskMention.youtube_id).toBe('ytC_new')   // NOT ytC_old (lowest t of the day)
    expect(c._deskMention.t).toBe(300)                  // NOT 900 (first row of the day)
  })

  it('a mention with no usable t loses to a seekable one from the same video', () => {
    const rows = [
      { video_id: 1, youtube_id: 'yt', anchor_date: '2026-02-02', t: null },
      { video_id: 1, youtube_id: 'yt', anchor_date: '2026-02-02', t: 45 },
    ]
    expect(buildDeskMentionMarkers(rows, 'D')[0]._deskMention.t).toBe(45)
  })

  // Two id-less rows both stringify to 'null'. Without the null bail they compare
  // EQUAL, so the second show's lower t silently overwrites the day's newest session.
  it('rows with no video_id never claim to be the same session', () => {
    const rows = [
      { youtube_id: 'ytNewest', anchor_date: '2026-02-02', t: 500 },
      { youtube_id: 'ytOlder', anchor_date: '2026-02-02', t: 10 },
    ]
    const [only] = buildDeskMentionMarkers(rows, 'D')
    expect(only._deskMention.youtube_id).toBe('ytNewest')   // the day's first row holds
    expect(only._deskMention.t).toBe(500)
  })

  it('maps anchor_date straight to marker time and carries the category style', () => {
    const [a] = buildDeskMentionMarkers(MENTIONS, 'D')
    expect(a.time).toBe(DAY_A)                        // the DATE, not a re-derived one
    expect(a.position).toBe('belowBar')
    expect(a.shape).toBe('circle')
    expect(a.color).toBe(DESK_MARKER_COLOR)
    expect(a.text).toBe('◆')                          // the spec's gold diamond
    // The id is the click handler's GATE (hoveredObjectId startsWith 'desk-'), not a
    // cosmetic key — assert the prefix the gate reads, not just the whole string.
    expect(a.id).toBe(`desk-${DAY_A}`)
    expect(a.id.startsWith('desk-')).toBe(true)
  })

  it('refuses every intraday timeframe, and serves the daily-and-up ones', () => {
    // ⚠️ NOT just the 5 NATIVE intraday codes. TF_MENU also offers 45m/2h/4h, and the
    // hand-written `!['1','5','15','30','60']` predicate the sibling categories use
    // lets those through as if they were daily — which mixes date STRINGS into a
    // numeric-time marker array. These are the codes that catch that.
    for (const tf of ['1', '2', '5', '15', '30', '45', '60', '120', '240']) {
      expect(buildDeskMentionMarkers(MENTIONS, tf)).toEqual([])
    }
    for (const tf of ['D', '2D', '3D', 'W', '2W', 'M', '3M']) {
      expect(buildDeskMentionMarkers(MENTIONS, tf).length).toBe(3)
    }
  })

  it('an unreadable timeframe code draws nothing (refusing is the safe answer)', () => {
    expect(buildDeskMentionMarkers(MENTIONS, 'wat')).toEqual([])
    expect(buildDeskMentionMarkers(MENTIONS, undefined)).toEqual([])
  })

  it('is null-safe: undefined/null/non-array/empty and dateless rows all yield []', () => {
    expect(buildDeskMentionMarkers(undefined, 'D')).toEqual([])
    expect(buildDeskMentionMarkers(null, 'D')).toEqual([])
    expect(buildDeskMentionMarkers({ mentions: [] }, 'D')).toEqual([])
    expect(buildDeskMentionMarkers([], 'D')).toEqual([])
    expect(buildDeskMentionMarkers([{ youtube_id: 'x' }, { anchor_date: null }], 'D')).toEqual([])
  })
})

describe('deskMentionHref', () => {
  it('builds the VideosSection deep link with the seek', () => {
    expect(deskMentionHref({ youtube_id: 'ytA1', t: 612 })).toBe('/desk?section=videos&v=ytA1&t=612')
  })
  it('keeps t=0 (the start of the session) and rounds a fractional seek', () => {
    expect(deskMentionHref({ youtube_id: 'ytB2', t: 0 })).toBe('/desk?section=videos&v=ytB2&t=0')
    expect(deskMentionHref({ youtube_id: 'ytB2', t: 91.6 })).toBe('/desk?section=videos&v=ytB2&t=92')
  })
  it('omits a missing/garbage t rather than handing the player NaN', () => {
    expect(deskMentionHref({ youtube_id: 'ytB2' })).toBe('/desk?section=videos&v=ytB2')
    expect(deskMentionHref({ youtube_id: 'ytB2', t: null })).toBe('/desk?section=videos&v=ytB2')
    expect(deskMentionHref({ youtube_id: 'ytB2', t: 'later' })).toBe('/desk?section=videos&v=ytB2')
  })
  it('no youtube_id → no link (a marker click on it must be inert)', () => {
    expect(deskMentionHref({ t: 10 })).toBeNull()
    expect(deskMentionHref(null)).toBeNull()
    expect(deskMentionHref(undefined)).toBeNull()
  })
})

/* ── 2. The fetch gate ────────────────────────────────────────────────────── */

describe('the mentions fetch is gated by cs.markers.desk', () => {
  it('toggle OFF (the default) → the endpoint is NEVER requested', async () => {
    render(<StockChart sym="GATEOFF" tf="D" barsOverride={FIXTURE_BARS} />)
    await waitFor(() => expect(lw.markerSets.length).toBeGreaterThan(0), { timeout: 3000 })
    await new Promise(r => setTimeout(r, 60))
    expect(mentionUrls()).toEqual([])
    expect(deskMarkersDrawn()).toEqual([])
  })

  it('toggle ON → exactly the spec\'s URL, for this symbol', async () => {
    render(<StockChart sym="GATEON" tf="D" barsOverride={FIXTURE_BARS}
      settingsOverride={{ markers: { desk: true } }} />)
    await waitFor(() => expect(mentionUrls().length).toBeGreaterThan(0), { timeout: 3000 })
    expect(mentionUrls()[0]).toBe('/api/education/tickers/GATEON/mentions')
  })
})

/* ── 3. The wires ─────────────────────────────────────────────────────────── */

describe('desk markers reach the chart', () => {
  // THE MERGE WIRE. Mutation-checked: dropping `...deskMarkers` from the mergedMarkers
  // spread reds this and nothing else in the file.
  it('the built markers are handed to the marker controller', async () => {
    render(<StockChart sym="WIRE1" tf="D" barsOverride={FIXTURE_BARS}
      settingsOverride={{ markers: { desk: true } }} />)
    await waitFor(() => expect(deskMarkersDrawn()).toHaveLength(3), { timeout: 3000 })
    const drawn = deskMarkersDrawn()
    expect(drawn.map(m => m.time).sort()).toEqual([DAY_A, DAY_B, DAY_C].sort())
    expect(drawn.every(m => m.color === DESK_MARKER_COLOR && m.position === 'belowBar')).toBe(true)
  })

  // Turning the category back off must CLEAR the dots. This is what makes the memo's
  // missing `deskEnabled` ternary safe: a null SWR key drops the data, and the markers
  // go with it.
  it('toggling the category off after it loaded clears the markers', async () => {
    const { rerender } = render(<StockChart sym="WIRE3" tf="D" barsOverride={FIXTURE_BARS}
      settingsOverride={{ markers: { desk: true } }} />)
    await waitFor(() => expect(deskMarkersDrawn()).toHaveLength(3), { timeout: 3000 })
    rerender(<StockChart sym="WIRE3" tf="D" barsOverride={FIXTURE_BARS}
      settingsOverride={{ markers: { desk: false } }} />)
    await waitFor(() => expect(deskMarkersDrawn()).toEqual([]), { timeout: 3000 })
  })

  it('an intraday chart draws none of them even with the toggle on', async () => {
    render(<StockChart sym="WIRE2" tf="15" barsOverride={FIXTURE_BARS}
      settingsOverride={{ markers: { desk: true } }} />)
    await waitFor(() => expect(lw.markerSets.length).toBeGreaterThan(0), { timeout: 3000 })
    await new Promise(r => setTimeout(r, 60))
    expect(deskMarkersDrawn()).toEqual([])
  })

  // A CUSTOM intraday code, mounted. '240' is not in the sibling categories' native
  // literal, so the old predicate called it daily and let date strings into a
  // numeric-time markers array. Asserted on the real chart, not just the builder.
  it('a custom intraday code (4h) draws none of them either', async () => {
    render(<StockChart sym="WIRE4" tf="240" barsOverride={INTRADAY_BARS}
      settingsOverride={{ markers: { desk: true } }} />)
    await waitFor(() => expect(lw.markerSets.length).toBeGreaterThan(0), { timeout: 3000 })
    await new Promise(r => setTimeout(r, 60))
    expect(deskMarkersDrawn()).toEqual([])
  })

  // THE CLICK WIRE. LWC has no marker-click event, so the handler is one of several
  // the chart subscribes; fire them all and assert the navigation the desk one owns.
  // A click on the MARKER carries hoveredObjectId (LWC reports the object under the
  // cursor); a click elsewhere in the same bar column carries the same `param.time`
  // and no id — which is exactly the difference these two tests turn on.
  const clickMarker = (day) => {
    for (const h of [...lw.clickHandlers]) h({ time: day, point: { x: 10, y: 10 }, hoveredObjectId: `desk-${day}` })
  }
  const clickBareBar = (day) => {
    for (const h of [...lw.clickHandlers]) h({ time: day, point: { x: 10, y: 10 } })
  }

  it('clicking a desk marker navigates to that day\'s Desk session + seek', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<StockChart sym="CLICK1" tf="D" barsOverride={FIXTURE_BARS}
      settingsOverride={{ markers: { desk: true } }} />)
    await waitFor(() => expect(deskMarkersDrawn()).toHaveLength(3), { timeout: 3000 })

    clickMarker(DAY_A)
    expect(open).toHaveBeenCalledWith('/desk?section=videos&v=ytA1&t=612', '_self')

    // The OTHER days resolve to their OWN video — a handler that always opened the
    // first mention would pass the assertion above.
    open.mockClear()
    clickMarker(DAY_B)
    expect(open).toHaveBeenCalledWith('/desk?section=videos&v=ytB2&t=0', '_self')

    // …and the two-show day opens the NEWEST session of that day, seeked to where it
    // first discussed the symbol.
    open.mockClear()
    clickMarker(DAY_C)
    expect(open).toHaveBeenCalledWith('/desk?section=videos&v=ytC_new&t=300', '_self')
    open.mockRestore()
  })

  // ⛔⭐ THE REGRESSION THIS CATEGORY IS MOST LIKELY TO SHIP. `param.time` is the whole
  // bar COLUMN, so without the hoveredObjectId gate an ordinary candle click on a
  // mention day replaces the entire app with /desk. Same time, same bar, no marker.
  it('clicking the CANDLE on a mention day — not the marker — navigates nowhere', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<StockChart sym="CLICK3" tf="D" barsOverride={FIXTURE_BARS}
      settingsOverride={{ markers: { desk: true } }} />)
    await waitFor(() => expect(deskMarkersDrawn()).toHaveLength(3), { timeout: 3000 })
    clickBareBar(DAY_A)
    expect(open).not.toHaveBeenCalled()
    // …and a hovered object that belongs to some OTHER primitive is not ours either.
    for (const h of [...lw.clickHandlers]) h({ time: DAY_A, point: { x: 10, y: 10 }, hoveredObjectId: 'earnings-badge-1' })
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('a click on a bar with no mention navigates nowhere', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<StockChart sym="CLICK2" tf="D" barsOverride={FIXTURE_BARS}
      settingsOverride={{ markers: { desk: true } }} />)
    await waitFor(() => expect(deskMarkersDrawn()).toHaveLength(3), { timeout: 3000 })
    clickMarker(BAR_DATES[7])
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })
})
