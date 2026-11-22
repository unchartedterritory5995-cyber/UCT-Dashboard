// app/src/components/StockChart.metaRenders.test.jsx
//
// ─── A METADATA ANSWER NEVER RE-RENDERS STOCKCHART (metadata islands, 2026-11-20) ──────────────────────
//
// After a symbol switch the chart asks a handful of small per-symbol reads: the name / sector / exchange
// (`/api/ticker-meta`), the listing date (`/api/ticker-ipo`), the event markers (`/api/chart/markers`), the
// news markers when they are on, the watermark logo, and the pane's next-earnings date. Each was StockChart
// state or a hook inside it, so each answer re-ran the whole StockChart render and `updateChart`. Measured here
// on master before the change: 2 renders for ticker-meta, 2 for ticker-ipo, 1 for the logo, 2 for the markers.
//
// Now `ChartMetaFeed` owns the reads and the chart redraws what shows them without rendering
// (`chart/chartMetaStore.js`). This file pins, on the production path (the bar store on, the REAL StockChart,
// lightweight-charts stubbed), that:
//   · every answer lands with ZERO StockChart renders, and the switch costs exactly as many renders whether the
//     answers land or never do;
//   · each answer still reaches the drawing (the watermark's company line, the E and IPO badges, the news
//     marker, the logo, the next-earnings chip): a chart that stopped rendering AND stopped drawing would pass
//     a render count alone;
//   · the fixed point: right after the answers land, a full StockChart render draws nothing different;
//   · the one exception stays an exception: a listing date that moves the engine's listing statement renders.
// Mutation-proved (restored from saved copies): the body subscribed to the store again; the redraw not called;
// the logo back as state; the hint a plain prop through StableStockChart again.
import React, { Profiler } from 'react'
import { describe, it, expect, vi, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'

const S = vi.hoisted(() => ({
  scRenders: 0, hold: false, held: [], urls: [],
  draw: { wm: null, badges: {}, nextEarn: undefined, markers: null, logo: undefined },
}))
// ⭐ THE RENDER COUNTER: StockChart's body calls this hook once per render, and nothing else calls it
// (grep `useLegacyDailyTickE`); the metadata feed and the readout islands do not.
vi.mock('./chart/legacyLiveWriters', async (orig) => {
  const m = await orig()
  return { ...m, useLegacyDailyTickE: (...a) => { S.scRenders++; return m.useLegacyDailyTickE(...a) } }
})
// ⭐ WHAT THE CHART DRAWS from the metadata, read off the real primitives' own setters
vi.mock('./chart/watermarkPrimitive', async (orig) => {
  const m = await orig()
  return {
    ...m,
    createWatermarkPrimitive: (...a) => {
      const c = m.createWatermarkPrimitive(...a)
      const set = c.setOptions
      c.setOptions = (patch) => {
        if (patch && patch.lines) S.draw.wm = patch.lines.map((l) => l.text).join(' | ')
        if (patch && 'logoImg' in patch) S.draw.logo = patch.logoImg ? patch.logoImg._src : null
        return set(patch)
      }
      return c
    },
  }
})
vi.mock('./chart/earningsBadgePrimitive', async (orig) => {
  const m = await orig()
  return {
    ...m,
    createEarningsBadgePrimitive: (init = {}) => {
      const c = m.createEarningsBadgePrimitive(init)
      const glyph = init.glyph || 'E'
      const set = c.setPoints
      c.setPoints = (pts) => { S.draw.badges[glyph] = (pts || []).map((p) => String(p.time)); return set(pts) }
      return c
    },
  }
})
vi.mock('./chart/nextEarningsMark', async (orig) => {
  const m = await orig()
  return {
    ...m,
    createNextEarningsPrimitive: () => {
      const c = m.createNextEarningsPrimitive()
      const set = c.set
      c.set = (next) => { S.draw.nextEarn = next ? JSON.stringify(next) : null; return set(next) }
      return c
    },
  }
})
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
  const createSeriesMarkers = (_series, initial) => {
    S.draw.markers = (initial || []).map((m) => m.id || m.text)
    return { setMarkers: (m) => { S.draw.markers = (m || []).map((x) => x.id || x.text) } }
  }
  return { ...real, createChart: () => chart, createSeriesMarkers }
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

// a Saturday: the newest daily bar is settled and nothing forms
const clock = pinWallClock('2026-11-14T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

const rowsFor = (k) => {
  const out = []
  const d = new Date(Date.UTC(2021, 0, 4))
  let i = 0
  while (d.toISOString().slice(0, 10) <= '2026-11-13') {
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const c = 40 * k + Math.sin(i / 11) * 6 * k + i * 0.01
      out.push({ t: iso, o: c - 0.5, h: c + 1.5, l: c - 1.7, c, v: 1e6 + ((i * 7919 * k) % 500000) })
      i++
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
// ⛔ A FRESH SYMBOL PER RUN: SWR is not re-evaluated by `vi.resetModules` (a node_modules dependency), so a read a
// previous run left out (never answered) would be JOINED by the next run's reader under the same key, not asked.
const BARS = { AAA: rowsFor(1), BBB: rowsFor(2), CCC: rowsFor(2), DDD: rowsFor(2), EEE: rowsFor(2), FFF: rowsFor(2), GGG: rowsFor(2) }
const FIRST_BAR = BARS.BBB[0].t   // 2021-01-04
// The owner's layout (2026-11-20): four moving averages and volume, the default IPO marker, earnings on, news on,
// the watermark's company / sector / industry / theme lines and its logo.
const settings = (extra = {}) => ({
  indicatorInstances: [10, 21, 50, 200].map((p) => ({ instanceId: `ma${p}`, defId: 'movingAverage', inputs: { source: 'close', period: p }, hidden: false })),
  markers: { earnings: true, splits: false, dividends: false, ipo: true, news: true },
  watermark: { visible: true, lines: { ticker: true, company: true, sector: true, industry: true, theme: true, logo: true } },
  ...extra,
})
const NEWS_TS = Date.parse('2026-10-14T15:00:00Z') / 1000
// ⭐ The listing date sits 2 calendar days after the first loaded bar: the IPO badge's ≤5-day match DRAWS it, and the
// engine's listing statement (exact date equality, `servedFromListingOf`) is unmoved, so this answer is drawing only.
const answerFor = (u, { ipoDate = '2021-01-06' } = {}) => {
  const m = /\/api\/ticker-meta\/([A-Z]+)/.exec(u)
  if (m) return { name: `${m[1]} Holdings Corp`, sector: 'Technology', industry: 'Semiconductors', theme: 'AI', exchange: 'NASDAQ', security_type: 'Stock' }
  if (/\/api\/ticker-ipo\//.test(u)) return { list_date: ipoDate, first_trade_final: true }
  if (/\/api\/chart\/markers\//.test(u)) return { earnings: [{ date: '2026-10-20', beat: true }], splits: [], dividends: [] }
  if (/\/api\/chart-news\//.test(u)) return { news: [{ time_published: NEWS_TS, url: 'https://example.com/n', title: 'n' }] }
  return null
}
const ok = (body) => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
const META_URL = /\/api\/(ticker-meta|ticker-ipo|chart\/markers|chart-news)\/|^IMG /
const noop = () => {}

function stubNetwork(opts) {
  // ⛔ a cold symbol every run: ticker-meta and ticker-ipo persist their answers to localStorage (fallbackData)
  try { localStorage.clear() } catch { /* jsdom has it */ }
  vi.stubGlobal('requestIdleCallback', (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 5))
  vi.stubGlobal('cancelIdleCallback', (h) => clearTimeout(h))
  // the watermark logo is an <img>: it "loads" when the test releases it, like any other answer
  class FakeImage {
    constructor() { this.naturalWidth = 0; this.onload = null; this.onerror = null }
    set src(v) {
      this._src = v
      const go = () => { this.naturalWidth = 64; this.onload && this.onload() }
      if (S.hold) S.held.push({ url: `IMG ${v}`, go }); else setTimeout(go, 0)
    }
    get src() { return this._src }
  }
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    S.urls.push(u)
    const m = /\/api\/bars\/([A-Z]+)/.exec(u)
    if (m && BARS[m[1]]) return ok({ ticker: m[1], tf: 'D', bars: BARS[m[1]], newest_bar_is_forming: false })
    const body = answerFor(u, opts) ?? {}
    if (S.hold && META_URL.test(u)) return new Promise((res) => { S.held.push({ url: u, go: () => res(ok(body)) }) })
    return ok(body)
  }))
}

async function loadChart() {
  return loadWithBarStore(true, async () => ({
    StockChart: (await import('./StockChart')).default,
    StableStockChart: (await import('./chart/pane/StableStockChart')).default,
    store: (await import('../data/barStore/index')).getBarStore(),
    chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
  }))
}

const drawnNow = () => JSON.stringify({ wm: S.draw.wm, badges: S.draw.badges, markers: S.draw.markers, logo: S.draw.logo, ne: S.draw.nextEarn })

/**
 * Mount AAA, hold BBB in the store, switch to BBB with every metadata answer held, then (`land`) release them one
 * at a time, or (not `land`) wait the same time with them still out. Counts StockChart renders throughout.
 */
async function switchAndLand({ land, ipoDate, to = 'BBB' } = { land: true }) {
  S.hold = false
  S.held.length = 0
  S.urls.length = 0
  S.draw = { wm: null, badges: {}, nextEarn: undefined, markers: null, logo: undefined }
  stubNetwork({ ipoDate })
  const M = await loadChart()
  const key = M.chartKeyFor({ sym: to, resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
  const SETTINGS = settings()
  const el = (sym, extra = {}) => (
    <Profiler id="chart" onRender={noop}>
      <M.StockChart sym={sym} tf="D" backgroundWarm={false} settingsOverride={SETTINGS} onSettingsPersist={noop} alwaysShowLegend {...extra} />
    </Profiler>
  )
  const view = render(el('AAA'))
  await wait(1500)
  M.store.registry.acquire(key)
  await act(async () => { await M.store.ensure(key, { priority: 'urgent' }) })
  await wait(300)
  S.hold = true
  const sc0 = S.scRenders
  await act(async () => { view.rerender(el(to)) })
  await wait(500)
  const afterSwitch = S.scRenders - sc0
  const heldUrls = S.held.map((h) => h.url)
  const perAnswer = []
  S.hold = false
  if (land) {
    while (S.held.length) {
      const h = S.held.shift()
      const r0 = S.scRenders
      await act(async () => { h.go(); await new Promise((r) => setTimeout(r, 30)) })
      await wait(250)
      perAnswer.push([h.url, S.scRenders - r0])
    }
  } else {
    for (let i = 0; i < heldUrls.length; i++) await wait(280)
  }
  await wait(400)
  const total = S.scRenders - sc0
  const drawn = drawnNow()
  // ⭐ THE FIXED POINT: a full paint now (StockChart renders AND `updateChart` re-runs: the watermark's opacity is
  // one of its inputs and draws none of the metadata) changes nothing the metadata redraw drew
  const scF = S.scRenders
  view.rerender(el(to, { watermarkOpacity: 0.5 }))
  await wait(50)
  const forced = S.scRenders - scF
  const drawnAfterFull = drawnNow()
  cleanup()
  M.store.registry.release(key)
  S.held.length = 0
  return { afterSwitch, heldUrls, perAnswer, total, drawn, drawnAfterFull, forced }
}

describe('a metadata answer landing after a switch never renders StockChart', () => {
  it('each answer lands with ZERO StockChart renders, and is drawn', async () => {
    const r = await switchAndLand({ land: true })
    // NON-VACUITY: every metadata read was actually out when the switch committed
    for (const part of ['/api/ticker-meta/BBB', '/api/ticker-ipo/BBB', '/api/chart/markers/BBB', '/api/chart-news/BBB', 'IMG /api/ticker-logo/BBB']) {
      expect(r.heldUrls.some((u) => u.includes(part)), `${part} was held (urls: ${JSON.stringify(r.heldUrls)})`).toBe(true)
    }
    expect(r.perAnswer.length).toBe(r.heldUrls.length)
    for (const [url, n] of r.perAnswer) expect(n, `StockChart renders when ${url} landed`).toBe(0)
    // ...and each one reached the chart
    const d = JSON.parse(r.drawn)
    expect(d.wm, 'the watermark prints the landed company line').toContain('BBB Holdings Corp')
    expect(d.wm).toContain('Semiconductors')
    expect(d.badges.E, 'the earnings badge sits on the landed report day').toEqual(['2026-10-20'])
    expect(d.badges.IPO, 'the IPO badge sits on the first bar').toEqual([FIRST_BAR])
    expect(d.markers, 'the landed news marker is on the series').toContain(`news-${NEWS_TS}`)
    expect(d.logo, 'the landed logo is on the watermark').toBe('/api/ticker-logo/BBB')
  }, 60000)

  it('the switch renders StockChart exactly as many times whether the answers land or never land', async () => {
    const never = await switchAndLand({ land: false, to: 'CCC' })
    const landed = await switchAndLand({ land: true, to: 'DDD' })
    expect(never.heldUrls.length, 'NON-VACUITY: the same reads were out in both runs').toBe(landed.heldUrls.length)
    expect(landed.total, `renders with the answers landing (${JSON.stringify(landed.perAnswer)}) vs never`).toBe(never.total)
    // CONTROL: the run that never lands drew none of the answers
    const d = JSON.parse(never.drawn)
    expect(d.wm || '').not.toContain('CCC Holdings Corp')
    expect(d.badges.IPO || []).toEqual([])
  }, 90000)

  it('⭐ the fixed point: right after the answers land, a full paint draws nothing different', async () => {
    const r = await switchAndLand({ land: true, to: 'EEE' })
    expect(r.forced, 'the forced render ran').toBeGreaterThan(0)
    expect(r.drawnAfterFull).toBe(r.drawn)
  }, 60000)

  it('the one exception: a listing date that moves the ENGINE\'s listing statement still renders', async () => {
    // the listing date IS the first loaded bar: `historyFromListing` turns true, which the engine computes on
    const r = await switchAndLand({ land: true, ipoDate: FIRST_BAR, to: 'FFF' })
    const ipo = r.perAnswer.find(([u]) => u.includes('/api/ticker-ipo/'))
    expect(ipo, 'NON-VACUITY: the listing answer was held').toBeTruthy()
    expect(ipo[1], 'a render for the engine').toBeGreaterThan(0)
    // every other answer stays render-free
    for (const [url, n] of r.perAnswer) if (!url.includes('/api/ticker-ipo/')) expect(n, url).toBe(0)
  }, 60000)
})

describe('the pane\'s next-earnings date (StableStockChart) rides a channel', () => {
  it('a hint-only change renders StockChart ZERO times and moves the next-earnings chip', async () => {
    S.hold = false
    S.draw = { wm: null, badges: {}, nextEarn: undefined, markers: null, logo: undefined }
    stubNetwork({})
    const M = await loadChart()
    const SETTINGS = settings({ nextEarningsMarker: true, markers: { earnings: false, ipo: false } })
    const el = (hint) => (
      <M.StableStockChart sym="GGG" tf="D" backgroundWarm={false} settingsOverride={SETTINGS} onSettingsPersist={noop} alwaysShowLegend nextEarningsHint={hint} />
    )
    const view = render(el(null))
    await wait(1500)
    const chipBefore = S.draw.nextEarn
    const sc0 = S.scRenders
    await act(async () => { view.rerender(el('2026-12-03')) })
    await wait(300)
    expect(S.scRenders - sc0, 'StockChart renders for a hint-only change').toBe(0)
    expect(S.draw.nextEarn, 'the chip moved to the hint').not.toBe(chipBefore)
    expect(S.draw.nextEarn).toBeTruthy()
    // CONTROL: a value prop still renders StockChart (the memo is not swallowing everything)
    const sc1 = S.scRenders
    await act(async () => { view.rerender(<M.StableStockChart sym="GGG" tf="D" backgroundWarm={false} settingsOverride={SETTINGS} onSettingsPersist={noop} alwaysShowLegend={false} nextEarningsHint="2026-12-03" />) })
    expect(S.scRenders - sc1).toBeGreaterThan(0)
    cleanup()
  }, 60000)
})
