// app/src/components/StockChart.liveTicks.test.jsx
//
// ─── A LIVE PRICE TICK NEVER RE-RENDERS STOCKCHART (2026-11-20) ─────────────────────────────────────────
//
// `useRealtimePrices` handed the chart a fresh `prices` object at every publish of the shared price stream
// (about once a second, for ANY symbol any component in the tab streams) and at every 2 s REST poll. Each one
// re-ran the whole StockChart render. The state probe on the owner's layout (2026-11-20) put it at 19 renders per
// typed switch after the switch settled, 6-10 more in its first 1.5 s, and ~4 from the poll.
//
// Under BARSTORE (production) the chart now calls the hook in its QUIET mode (`hooks/useRealtimePrices.js`,
// `lib/liveQuote.js`): its render re-runs only when what the render shows of the feed changes (the badge, and the
// ext price where the include-mode session candle is built from it). This file pins, with the REAL hook and a
// controllable stream + poll:
//   · RTH: a tick of the chart's symbol, a tick of another symbol, and a REST poll render StockChart 0 times;
//     a feed state change (connected) still renders it (the subscription is live, not deaf);
//   · after hours: every ext-price tick moves the Pre/Post price tag on the chart with 0 StockChart renders.
// Mutation-proved (restored from a saved copy): the hook called in its ordinary mode again; the between-render
// tag placement removed.
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'

const S = vi.hoisted(() => ({
  scRenders: 0,
  streamSubs: new Set(), restSubs: new Set(),
  snap: { prices: {}, staleSymbols: new Set(), connected: true },
  rest: {},
  lines: [],
}))
// ⭐ THE RENDER COUNTER: StockChart calls this hook once per render of its body, and nothing else calls it.
vi.mock('./chart/legacyLiveWriters', async (orig) => {
  const m = await orig()
  return { ...m, useLegacyDailyTickE: (...a) => { S.scRenders++; return m.useLegacyDailyTickE(...a) } }
})
// ⭐ THE TWO FEEDS, controllable: the shared stream (priceStreamManager) and the 2 s REST poll (livePriceStore)
vi.mock('../lib/priceStreamManager', () => ({
  subscribe: (_t, cb) => { S.streamSubs.add(cb); return () => S.streamSubs.delete(cb) },
  getSnapshot: () => S.snap,
  getLastResume: () => 0, reconnectNow: () => {}, isConnected: () => true, _resetForTests: () => {},
  MAX_SSE_TICKERS: 50, REBUILD_DEBOUNCE_MS: 400,
}))
vi.mock('../hooks/livePriceStore', () => ({
  registerTickers: () => () => {},
  subscribe: (cb) => { S.restSubs.add(cb); return () => S.restSubs.delete(cb) },
  getSnapshot: () => S.rest,
  pollNow: () => {}, setUnauthorizedHandler: () => {}, __resetForTest: () => {},
}))
vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const make = () => ({
    setData: () => {}, update: () => {}, data: () => [],
    applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    createPriceLine: (o) => {
      const line = { opts: { ...o }, applyOptions(p) { Object.assign(this.opts, p) }, options() { return this.opts } }
      S.lines.push(line)
      return line
    },
    removePriceLine: (l) => { S.lines = S.lines.filter((x) => x !== l) },
    setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    getPane: () => ({ paneIndex: () => 0, getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [] }),
    priceFormatter: () => ({ format: (x) => String(x) }), moveToPane: () => {}, seriesOrder: () => 0, setSeriesOrder: () => {},
    dataByIndex: () => null, barsInLogicalRange: () => null,
    subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
  })
  const chart = {
    addSeries: () => make(), addCandlestickSeries: make, addHistogramSeries: make, addLineSeries: make, addAreaSeries: make, addBarSeries: make,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, logicalToCoordinate: () => 0,
      subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [], setHeight: () => {}, setStretchFactor: () => {}, getStretchFactor: () => 1, paneIndex: () => 0 }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
    chartElement: () => document.createElement('div'),
  }
  return { ...real, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
vi.mock('../utils/barsIDB', async (orig) => ({ ...(await orig()), idbGet: async () => null, idbPut: async () => {}, idbPutMonotonic: async () => {} }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
const rowsThrough = (lastIso) => {
  const out = []
  const d = new Date(Date.UTC(2024, 0, 2))
  let i = 0
  while (d.toISOString().slice(0, 10) <= lastIso) {
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const c = 40 + Math.sin(i / 11) * 6 + i * 0.01
      out.push({ t: iso, o: c - 0.5, h: c + 1.5, l: c - 1.7, c, v: 1e6 + ((i * 7919) % 500000) })
      i++
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const noop = () => {}

/** One stream publish: `sym` trades at `price` (only that entry changes, as the real manager does). */
const streamTick = (sym, price) => act(() => {
  S.snap = { ...S.snap, prices: { ...S.snap.prices, [sym]: { price, updated_at: Math.floor(Date.now() / 1000) } } }
  for (const f of [...S.streamSubs]) f()
})
/** One REST poll landing. */
const restPoll = (entries) => act(() => {
  S.rest = { ...S.rest, ...entries }
  for (const f of [...S.restSubs]) f()
})
const feedState = (patch) => act(() => {
  S.snap = { ...S.snap, ...patch }
  for (const f of [...S.streamSubs]) f()
})

async function mountChart({ clockIso, lastBar, sessionView = null }) {
  S.snap = { prices: {}, staleSymbols: new Set(), connected: true }
  S.rest = {}
  S.lines = []
  S.streamSubs.clear()
  S.restSubs.clear()
  const clock = pinWallClock(clockIso)
  vi.stubGlobal('requestIdleCallback', (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 5))
  vi.stubGlobal('cancelIdleCallback', (h) => clearTimeout(h))
  const BARS = rowsThrough(lastBar)
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const ok = (body) => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
    if (/\/api\/bars\/AAA/.test(u)) return ok({ ticker: 'AAA', tf: 'D', bars: BARS, newest_bar_is_forming: false })
    return ok({})
  }))
  const M = await loadWithBarStore(true, async () => ({ StockChart: (await import('./StockChart')).default }))
  expect(M.__barStore, 'the production bar path').toBe(true)
  const view = render(<M.StockChart sym="AAA" tf="D" backgroundWarm={false} onSettingsPersist={noop} sessionView={sessionView} alwaysShowLegend />)
  await wait(1200)
  return { view, clock, lastClose: BARS[BARS.length - 1].c }
}

afterEach(() => { cleanup() })

describe('a live price tick never renders StockChart (BARSTORE, the hook\'s quiet mode)', () => {
  it('RTH: ticks of its symbol, of another symbol, and REST polls: 0 renders; a feed state change still renders', async () => {
    // a Wednesday, 12:00 ET: the regular session
    const { clock } = await mountChart({ clockIso: '2026-11-18T17:00:00Z', lastBar: '2026-11-17' })
    try {
      expect(S.streamSubs.size, 'NON-VACUITY: the chart is subscribed to the stream').toBeGreaterThan(0)
      expect(S.restSubs.size, 'NON-VACUITY: ...and to the REST poll').toBeGreaterThan(0)
      await restPoll({ AAA: { price: 41, prev_close: 40, day_open: 40.5, day_high: 41.5, day_low: 40.2, volume: 1000, ext_session: null } })
      // ⚠️ The session's FIRST tick opens today's candle in the bar store (its tick fallback, `data/barStore/liveFeed.js`:
      // the bars stream is off here): a new bar in the store's snapshot, which renders as any new bar does. That is
      // the candle, not the quote, so it is taken before the count. Every later tick only moves that candle (the
      // store's developing-bar channel, no render).
      await streamTick('AAA', 40.9)
      await wait(50)
      const r0 = S.scRenders
      const per = []
      for (let i = 0; i < 10; i++) {
        let a = S.scRenders
        await streamTick('AAA', 41 + i * 0.05)
        per.push(['AAA', S.scRenders - a]); a = S.scRenders
        await streamTick('ZZZ', 99 + i)
        per.push(['ZZZ', S.scRenders - a])
      }
      for (let i = 0; i < 5; i++) await restPoll({ AAA: { price: 41.5 + i * 0.01, prev_close: 40, day_open: 40.5, day_high: 42, day_low: 40.2, volume: 2000 + i, ext_session: null } })
      await wait(50)
      expect(S.scRenders - r0, `StockChart renders over 20 stream ticks and 5 REST polls (per tick: ${JSON.stringify(per)})`).toBe(0)
      // CONTROL: what the render shows of the feed (the connected badge) still renders it
      const r1 = S.scRenders
      await feedState({ connected: false })
      await wait(20)
      expect(S.scRenders - r1, 'a feed state change renders').toBeGreaterThan(0)
    } finally { clock.restore() }
  }, 60000)

  it('after hours: every ext-price tick moves the Pre/Post tag on the chart, with 0 renders', async () => {
    // a Wednesday, 17:30 ET: post-market; the workspace's regular-hours view of a daily chart shows the Pre/Post tag
    const { clock, lastClose } = await mountChart({ clockIso: '2026-11-18T22:30:00Z', lastBar: '2026-11-18', sessionView: 'regular' })
    try {
      await restPoll({ AAA: { price: lastClose, prev_close: lastClose - 1, day_open: lastClose, ext_session: 'post', market_session: 'post', volume: 1000 } })
      await wait(50)
      const r0 = S.scRenders
      const prices = [77.11, 77.42, 76.98, 77.65, 77.3]
      for (const px of prices) {
        await streamTick('AAA', px)
        const shown = S.lines.map((l) => l.opts.price)
        expect(shown, `the Pre/Post tag at ${px} (lines: ${JSON.stringify(shown)})`).toContain(px)
      }
      expect(S.scRenders - r0, 'StockChart renders over 5 ext-price ticks').toBe(0)
      // CONTROL: the locked regular-session close tag is there too (the tag set is the session one, not a stray line)
      expect(S.lines.map((l) => l.opts.price)).toContain(lastClose)
    } finally { clock.restore() }
  }, 60000)
})
