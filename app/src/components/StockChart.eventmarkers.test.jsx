// Hardening sweep (2026-08-11, item 1): the sibling marker categories that sit
// beside desk mentions in `mergedMarkers` (news / chartEventMarkers / earningsEvents
// / splitEvents / dividendEvents) used a hand-written
// `!['1','5','15','30','60'].includes(resolvedTf)` "isDailyWeekly" guard. TF_MENU
// also offers custom intraday codes ('45'/'120'/'240'/…) that aren't in that literal,
// so the old guard mis-classified them as daily-like. For NEWS specifically that
// flips the marker's `time` from a numeric (ET-shifted) unix second to a
// 'YYYY-MM-DD' date STRING — which then sorts into `mergedMarkers` next to purely
// numeric intraday times, the mixed-type comparator this whole category exists to
// avoid (see buildDeskMentionMarkers' header comment in StockChart.jsx).
//
// This proves the fix at the one category with the simplest fetch/build path: on a
// real daily chart the news marker time stays a date string (unchanged, correct);
// on a CUSTOM intraday chart (240 = 4h, not in the 5-native-code literal) it is now
// a NUMBER, matching every other intraday marker's time domain.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const lw = vi.hoisted(() => ({ markerSets: [] }))

// ── Render harness: copied from StockChart.deskmarkers.test.jsx (same mocks). ──
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
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
vi.mock('../utils/barsIDB', () => ({
  idbGet: async () => null, idbPut: async () => {}, mergeDelta: (_a, b) => b,
}))

// 200 consecutive daily bars ending 2026-02-20 (same fixture idiom as the sibling suites).
const BAR_DATES = Array.from({ length: 200 }, (_, i) =>
  new Date(Date.UTC(2026, 1, 20) - (199 - i) * 86400000).toISOString().slice(0, 10))
const FIXTURE_BARS = BAR_DATES.map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i }))

// Intraday series (unix SECONDS, 5 RTH bars/weekday) — the 240 (4h) case resamples
// from this via the customSwrUrl base fetch, which `barsOverride` does NOT short-
// circuit (see StockChart.deskmarkers.test.jsx's WIRE4 comment for why).
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

// A single news item. `time_published` is unix seconds — the only field the
// newsMarkers builder reads for the marker's time.
const NEWS_TS = INTRADAY_BARS[50].t
const NEWS_ITEM = { time_published: NEWS_TS, headline: 'Test headline', source: 'Test Wire', url: 'https://example.com' }

const barsOrPayload = (url) => {
  if (url.includes('/api/bars/')) {
    const tf = new URLSearchParams(url.split('?')[1] || '').get('tf') || 'D'
    return { ticker: 'AAPL', bars: /^\d+$/.test(tf) ? INTRADAY_BARS : FIXTURE_BARS }
  }
  if (url.includes('/api/chart-news/')) return { news: [NEWS_ITEM] }
  return {}
}

let fetchSpy
beforeEach(() => {
  cleanup()
  lw.markerSets = []
  fetchSpy = vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(barsOrPayload(String(url))),
  }))
  vi.stubGlobal('fetch', fetchSpy)
})

const { default: StockChart } = await import('./StockChart')

const newsMarkersDrawn = () => {
  const last = lw.markerSets[lw.markerSets.length - 1] || []
  return last.filter(m => String(m?.id || '').startsWith('news-'))
}

describe('news markers use the real timeframe classification, not the 5-native-code literal', () => {
  it('on a real daily chart, the marker time is still the YYYY-MM-DD date string', async () => {
    render(<StockChart sym="NEWSD" tf="D" barsOverride={FIXTURE_BARS}
      settingsOverride={{ markers: { news: true } }} />)
    await waitFor(() => expect(newsMarkersDrawn()).toHaveLength(1), { timeout: 3000 })
    const [m] = newsMarkersDrawn()
    expect(typeof m.time).toBe('string')
    expect(m.time).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // ⛔ THE REGRESSION THIS TEST CATCHES: '240' is not in the hand-written
  // `['1','5','15','30','60']` literal, so the old `isDailyWeekly` guard called a
  // 4-hour chart "daily-like" and formatted the marker time as a date string —
  // mixed into mergedMarkers next to every other category's numeric intraday
  // times. Reverting the parseTf-based guard back to the literal turns `m.time`
  // back into a string here and reds this test.
  it('on a CUSTOM intraday chart (4h), the marker time is a NUMBER, not a date string', async () => {
    render(<StockChart sym="NEWS240" tf="240" barsOverride={INTRADAY_BARS}
      settingsOverride={{ markers: { news: true } }} />)
    await waitFor(() => expect(newsMarkersDrawn()).toHaveLength(1), { timeout: 3000 })
    const [m] = newsMarkersDrawn()
    expect(typeof m.time).toBe('number')
    // Within a few hours of the raw timestamp (allows for the ET-offset shift the
    // intraday branch adds) — proves it's the numeric branch, not merely coerced.
    expect(Math.abs(m.time - NEWS_TS)).toBeLessThan(6 * 3600)
  })

  it('a genuinely NATIVE intraday chart (15m) also uses the numeric branch (unchanged)', async () => {
    render(<StockChart sym="NEWS15" tf="15" barsOverride={INTRADAY_BARS}
      settingsOverride={{ markers: { news: true } }} />)
    await waitFor(() => expect(newsMarkersDrawn()).toHaveLength(1), { timeout: 3000 })
    const [m] = newsMarkersDrawn()
    expect(typeof m.time).toBe('number')
  })
})
