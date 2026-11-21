// app/src/components/StockChart.rangeUnsubscribe.test.jsx
//
// ⛔⛔ THE PER-SWITCH LEAK (2026-11-20): every symbol switch must leave the chart's time scale holding the SAME number
// of visible-range handlers it held before. Three StockChart effects kept the void return of the library's
// `subscribeVisibleLogicalRangeChange` as their "unsubscribe", so each switch left one more live handler, each one
// holding the outgoing symbol's whole render (measured on production: ~20 MB per D + 60m switch, 2.3 GB after 100).
//
// The REAL StockChart on the production path (the bar store), lightweight-charts' time scale replaced by one that
// counts live range handlers; a chart walks seven symbols and the count must not move from the first switch on
// (one effect arms after the first paint), while the effects really did re-subscribe on every switch (non-vacuity).
//   · D: the viewport-first backfill (`fetchDepth` below the full target) and the volume-profile overlay;
//   · 60m with the intraday deep history on: the native scroll-back.
// Mutation-proved: each of the three old cleanups restored alone turns its case red.
import { describe, it, expect, vi, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'

const R = vi.hoisted(() => ({ live: new Set(), subscribed: 0 }))
vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const make = () => ({
    setData: () => {}, update: () => {}, data: () => [],
    applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    getPane: () => ({ paneIndex: () => 0, getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [] }),
    priceFormatter: () => ({ format: (x) => String(x) }), moveToPane: () => {}, seriesOrder: () => 0, setSeriesOrder: () => {},
    dataByIndex: () => null, barsInLogicalRange: () => null,
    subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
  })
  // ⭐ ONE time scale per chart, counting the visible-range handlers it holds
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
    setVisibleRange: () => {}, scrollToPosition: () => {},
    subscribeVisibleLogicalRangeChange: (h) => { R.live.add(h); R.subscribed++ },
    unsubscribeVisibleLogicalRangeChange: (h) => { R.live.delete(h) },
    timeToCoordinate: () => 0, coordinateToTime: () => null,
    resetTimeScale: () => {}, options: () => ({}), width: () => 600, logicalToCoordinate: () => 0,
    subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
  }
  const chart = {
    addSeries: () => make(), addCandlestickSeries: () => make(), addHistogramSeries: () => make(),
    addLineSeries: () => make(), addAreaSeries: () => make(), addBarSeries: () => make(),
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
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
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// a Saturday: the newest bars are settled and nothing forms
const clock = pinWallClock('2026-11-14T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

const SYMS = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG']
const dailyFor = (k) => {
  const out = []
  const d = new Date(Date.UTC(2024, 0, 2))
  let i = 0
  while (d.toISOString().slice(0, 10) <= '2026-11-13') {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const c = 20 * k + Math.sin(i / 9) * 3 + i * 0.01
      out.push({ t: d.toISOString().slice(0, 10), o: c - 0.4, h: c + 1, l: c - 1.2, c, v: 1e6 + i })
      i++
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
// the regular session's hourly bars (09:30 ET = 14:30 UTC in November) of the last 40 weekdays
const hourlyFor = (k) => {
  const out = []
  const d = new Date(Date.UTC(2026, 8, 18))
  let i = 0
  while (d.toISOString().slice(0, 10) <= '2026-11-13') {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      for (let h = 0; h < 7; h++) {
        const t = Math.floor(d.getTime() / 1000) + (14 * 3600 + 30 * 60) + h * 3600
        const c = 20 * k + Math.sin(i / 7) * 2
        out.push({ t, o: c - 0.2, h: c + 0.5, l: c - 0.6, c, v: 1e5 + i })
        i++
      }
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

async function walk({ tf, settings, ls = {} }) {
  vi.stubGlobal('requestIdleCallback', (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 5))
  vi.stubGlobal('cancelIdleCallback', (h) => clearTimeout(h))
  for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v)
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const m = /\/api\/bars\/([A-Z]+)\?/.exec(u)
    const k = m ? SYMS.indexOf(m[1]) + 1 : 0
    if (!k) return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => ({}) })
    const want = /[?&]tf=([^&]+)/.exec(u)?.[1] || 'D'
    const body = { ticker: m[1], tf: want, bars: want === 'D' ? dailyFor(k) : hourlyFor(k), newest_bar_is_forming: false }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
  }))
  const M = await loadWithBarStore(true, async () => ({ StockChart: (await import('./StockChart')).default }))
  R.live.clear()
  R.subscribed = 0
  const el = (sym) => <M.StockChart sym={sym} tf={tf} backgroundWarm={false} settingsOverride={settings} onSettingsPersist={() => {}} />
  const view = render(el(SYMS[0]))
  await wait(900)
  const after = [R.live.size]
  const subs0 = R.subscribed
  for (const s of SYMS.slice(1)) {
    view.rerender(el(s))
    await wait(500)
    after.push(R.live.size)
  }
  const resubscribed = R.subscribed - subs0
  cleanup()
  for (const k of Object.keys(ls)) localStorage.removeItem(k)
  vi.unstubAllGlobals()
  return { after, resubscribed }
}

const SWITCHES = SYMS.length - 1
describe('a symbol switch leaves the time scale holding the same visible-range handlers', () => {
  it('D (the viewport-first backfill, the volume-profile overlay): flat across six switches', async () => {
    const { after, resubscribed } = await walk({ tf: 'D', settings: {} })
    expect(after[0], 'the chart subscribed at all').toBeGreaterThan(0)
    expect(resubscribed, 'the effects re-subscribed on the switches (non-vacuity)').toBeGreaterThanOrEqual(SWITCHES)
    expect(after.slice(1), `live range handlers after the first paint, then each switch: ${after.join(' ')}`).toEqual(after.slice(1).map(() => after[1]))
  }, 60000)

  it('D with the volume profile drawn: flat', async () => {
    const { after, resubscribed } = await walk({ tf: 'D', settings: { indicators: { volumeProfile: { enabled: true, bins: 24 } } } })
    expect(resubscribed).toBeGreaterThanOrEqual(SWITCHES)
    expect(after.slice(1), `live range handlers after the first paint, then each switch: ${after.join(' ')}`).toEqual(after.slice(1).map(() => after[1]))
  }, 60000)

  it('60m with the intraday deep history on (the native scroll-back): flat', async () => {
    const { after, resubscribed } = await walk({ tf: '60', settings: {}, ls: { 'uct.intradayDeepBackfill.enabled': '1' } })
    expect(after[0]).toBeGreaterThan(0)
    expect(resubscribed).toBeGreaterThanOrEqual(SWITCHES)
    expect(after.slice(1), `live range handlers after the first paint, then each switch: ${after.join(' ')}`).toEqual(after.slice(1).map(() => after[1]))
  }, 60000)
})
