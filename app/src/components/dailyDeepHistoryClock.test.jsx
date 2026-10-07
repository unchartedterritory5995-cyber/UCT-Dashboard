/**
 * DAILY DEEP HISTORY SURVIVES EVERY SESSION WINDOW.
 *
 * ⛔⛔ THE REGRESSION THIS PINS (2026-09-28). With split-fetch on, a standalone daily
 * chart asks /api/bars for the 600-bar tail and /api/bars-history for the deep sealed
 * set. Both arrived, both merged into IDB — and from the close until midnight ET the
 * render selector threw the deep set away and drew the 600-row tail: QQQ "began" in
 * May 2024 and Origin framed the 600th session back. `81b12873f` had gated the
 * post-server render arm on `_splitDeepPaintable` (= usable && !idbStaleDaily), and
 * `idbStaleDaily` is 'provisional-close' for EVERY today-dated tail after the bell.
 * It is the 2026-09-02 "stops at 2024" bug (9af52df43) re-entered through a new door.
 *
 * ⭐ WHY EVERY EARLIER RAIL MISSED IT: each one ran at ONE wall-clock instant inside
 * RTH. The failure exists only in the after-bell window, so the clock is a first-class
 * input here — five of them — and every case asserts, none merely reports.
 *
 * What each case proves, from the series the chart actually received:
 *   - the primary really was the 600-bar split tail and the deep leg really fired
 *     (otherwise the case is INVALID, not PASS — a harness that never exercised the
 *     split path would pass by drawing whatever /api/bars returned);
 *   - more than 600 bars were rendered, and bar 0 is the deep origin;
 *   - the right edge is the SERVER's: every one of the last 600 rendered bars carries
 *     the /api/bars values (they are offset by a cent from the cache/history copies),
 *     and nothing is drawn past the server's last bar;
 *   - Origin centres bar 0 of that deep series.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'

const spy = vi.hoisted(() => ({ last: null, calls: 0 }))
const seriesLog = vi.hoisted(() => ({ calls: [] }))
const world = vi.hoisted(() => ({
  sym: 'Q0', idbEntry: null, netBars: null, histBars: null,
  primaryUrls: [], histUrls: [], otherUrls: [],
}))

vi.mock('./chart/ChartVLineOverlay', () => ({ default: () => null }))
vi.mock('lightweight-charts', () => {
  let _sid = 0
  const mkSeries = () => {
    const id = ++_sid
    return {
      setData: (d) => { seriesLog.calls.push({ id, op: 'setData', data: d }) },
      update: (d) => { seriesLog.calls.push({ id, op: 'update', data: d }) },
      applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      dataByIndex: () => null, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
      barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
    }
  }
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {},
    setVisibleLogicalRange: (r) => { spy.last = r; spy.calls += 1 },
    getVisibleLogicalRange: () => spy.last,
    setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
    resetTimeScale: () => {}, options: () => ({}), width: () => 900,
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
  }
  const chart = {
    addSeries: () => mkSeries(), addCandlestickSeries: () => mkSeries(), addHistogramSeries: () => mkSeries(),
    addLineSeries: () => mkSeries(), addAreaSeries: () => mkSeries(), addBarSeries: () => mkSeries(),
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
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {},
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
  }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
vi.mock('../hooks/livePriceStore', () => ({ getSnapshot: () => ({}), subscribe: () => () => {} }))
vi.mock('../lib/todayPackClient', () => ({
  getTodayBar: () => null, todayPackUsable: () => false,
  touchTodayPack: () => Promise.resolve(null), ensureTodayPack: () => Promise.resolve(null),
  todayPackAgeMs: () => Infinity,
}))
// Real module for every pure export (mergeDelta, _closeMismatch, …); only the storage
// doors are controlled, and ONLY for the symbol + timeframe under test — the all-TF warm
// chain must not be handed a daily entry under a W/M key.
vi.mock('../utils/barsIDB', async (importOriginal) => ({
  ...(await importOriginal()),
  idbGet: async (s, tf) => (s === world.sym && tf === 'D' ? world.idbEntry : null),
  idbPut: async () => {},
}))

// ── Clocks. September is EDT (UTC-4). ────────────────────────────────────────
const CLOCKS = {
  'RTH 13:17 Tue': '2026-09-22T17:17:00Z',
  'POST 19:30 Tue': '2026-09-22T23:30:00Z',
  'NIGHT 23:30 Tue': '2026-09-23T03:30:00Z',
  'PRE 08:00 Wed': '2026-09-23T12:00:00Z',
  'SAT 12:00': '2026-09-26T16:00:00Z',
}
const clock = pinWallClock(CLOCKS['RTH 13:17 Tue'])
const Mod = await import('./StockChart')
const StockChart = Mod.default
const MS = await import('../utils/marketSession')

const PRIMARY_ROWS = 600
const DEEP_ROWS = 5200

function seriesEndingAt(isoEnd, n) {
  const out = []
  const d = new Date(`${isoEnd}T12:00:00Z`)
  while (out.length < n) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const i = n - out.length
      const px = 100 + (i % 997) / 10
      out.unshift({ t: d.toISOString().slice(0, 10), o: px, h: px + 1, l: px - 1, c: px + 0.5, v: 1e6 + i })
    }
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
// The server's copy of the recent window differs from the cached / sealed copy by one
// cent on the close — far inside every basis/sanity gate, and exactly enough to tell
// from the rendered value WHICH door a right-edge bar came from.
const SERVER_MARK = 0.01
const serverCopy = (b) => ({ ...b, c: +(b.c + SERVER_MARK).toFixed(4) })

function fixturesAt(shape) {
  const frontier = MS.expectedDailyTailForPaintET()
  const deep = shape ? shape(seriesEndingAt(frontier, DEEP_ROWS)) : seriesEndingAt(frontier, DEEP_ROWS)
  return {
    frontier,
    deep,
    sealed: deep.slice(0, -1),                          // /api/bars-history ends one session back
    primary: deep.slice(-PRIMARY_ROWS).map(serverCopy), // /api/bars — the fresh 600-bar tail
  }
}

// ── Observation ─────────────────────────────────────────────────────────────
function candleSeriesId() {
  let id = null
  for (const c of seriesLog.calls) {
    if (c.op === 'setData' && Array.isArray(c.data) && c.data.some((x) => x && x.open !== undefined)) id = c.id
  }
  return id
}
function renderedCandles() {
  const id = candleSeriesId()
  if (id == null) return null
  let arr = null
  for (const c of seriesLog.calls) {
    if (c.id !== id) continue
    if (c.op === 'setData') { arr = Array.isArray(c.data) ? c.data.slice() : null; continue }
    if (c.op === 'update' && arr && c.data) {
      const pt = c.data
      const at = arr.findIndex((x) => x && x.time === pt.time)
      if (at >= 0) { arr[at] = pt; continue }
      if (!arr.length || pt.time > arr[arr.length - 1].time) arr.push(pt)
    }
  }
  return arr ? arr.filter((p) => p && p.open !== undefined) : null   // whitespace is not a bar
}
const tick = async (ms = 40) => {
  await new Promise((r) => setTimeout(r, ms))
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

beforeEach(() => {
  cleanup()
  spy.last = null; spy.calls = 0
  seriesLog.calls = []
  Object.assign(world, { idbEntry: null, netBars: null, histBars: null, primaryUrls: [], histUrls: [], otherUrls: [] })
  try { localStorage.clear() } catch { /* jsdom */ }
  // Split-fetch + the first-paint edge leg ON explicitly — never left to the random bucket.
  localStorage.setItem('uct.barsHistory.enabled', '1')
  localStorage.setItem('uct.barsHistoryFP.enabled', '1')
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    const mine = u.includes(`/${world.sym}?`) && u.includes('tf=D')
    if (u.includes('/api/bars-history/') && mine) {
      world.histUrls.push(u)
      return { ok: true, json: async () => ({ ticker: world.sym, tf: 'D', sealed: true, bars: world.histBars,
                                              count: world.histBars.length, last_sealed: world.histBars.at(-1).t }) }
    }
    if (u.includes('/api/bars/') && mine) {
      world.primaryUrls.push(u)
      await new Promise((r) => setTimeout(r, 300))            // measured production round trip
      const n = Number(new URL(u, 'http://x').searchParams.get('bars')) || PRIMARY_ROWS
      return { ok: true, json: async () => ({ ticker: world.sym, tf: 'D', bars: world.netBars.slice(-n) }) }
    }
    world.otherUrls.push(u)
    return { ok: true, json: async () => ({ bars: [] }) }
  }))
})
afterEach(() => { vi.unstubAllGlobals() })
afterAll(() => { clock.restore() })

let _n = 0
/** Mount one daily chart at the pinned clock and score it once the server has answered. */
async function runCase({ seedIdb = false, clickOrigin = false, shape = null } = {}) {
  world.sym = `Q${++_n}`
  const fx = fixturesAt(shape)
  // The server's /api/bars is the fresh copy for ANY depth it is asked for.
  world.netBars = fx.deep.slice(0, -PRIMARY_ROWS).concat(fx.primary)
  world.histBars = fx.sealed
  if (seedIdb) {
    // A DEEP cache whose today bar is the stale-valued copy — the right edge must still
    // be the server's once the server answers.
    const stale = fx.deep.slice(0, -1).concat([{ ...fx.deep.at(-1), c: fx.deep.at(-1).c - 0.05 }])
    world.idbEntry = { bars: stale, lastT: fx.frontier, savedAt: Date.now() }
  }
  const { unmount } = render(
    <StockChart sym={world.sym} tf="D" backgroundWarm showRangeSelector dailyDefaultBars={126}
                viewLockKey={`uct.deepclock.${world.sym}`} />,
  )
  // Settle: the primary (300 ms), the deep leg (dwell-gated) and the merge commit.
  const deadline = Date.now() + 5000
  let r = null
  while (Date.now() < deadline) {
    await tick(50)
    r = renderedCandles()
    if (world.primaryUrls.length && world.histUrls.length && r && r.length > PRIMARY_ROWS) break
  }
  await tick(400)
  r = renderedCandles()
  let origin = null
  if (clickOrigin) {
    const btn = screen.queryAllByText('Origin')[0]
    if (btn) {
      spy.last = { from: r.length - 126, to: r.length + 6 }  // a present-day frame to move FROM
      fireEvent.click(btn)
      await tick(900)
      origin = { clicked: true, frame: spy.last, bar0: renderedCandles()?.[0]?.time }
    } else origin = { clicked: false }
  }
  const out = {
    fx, rendered: renderedCandles(), origin,
    primaryUrls: world.primaryUrls.slice(), histUrls: world.histUrls.slice(),
  }
  unmount()
  return out
}

/** The contract, asserted. Returns a one-line summary for the matrix print. */
function assertDeep(label, res) {
  const { fx, rendered, primaryUrls, histUrls } = res
  // VALIDITY — the split path was really exercised, or the case proves nothing.
  expect(primaryUrls.length, `${label}: no /api/bars request`).toBeGreaterThan(0)
  expect(primaryUrls.every((u) => u.includes(`bars=${PRIMARY_ROWS}`)),
    `${label}: primary was not the ${PRIMARY_ROWS}-bar split tail: ${primaryUrls}`).toBe(true)
  expect(histUrls.length, `${label}: the deep /api/bars-history leg never fired`).toBeGreaterThan(0)
  expect(rendered, `${label}: nothing rendered`).toBeTruthy()

  // DEPTH — more than the tail, reaching the deep origin.
  expect(rendered.length, `${label}: rendered ${rendered.length} bars`).toBeGreaterThan(PRIMARY_ROWS)
  expect(rendered[0].time, `${label}: oldest rendered bar`).toBe(fx.deep[0].t)

  // RIGHT EDGE — the server's, bar for bar, and nothing beyond it.
  const tail = rendered.slice(-PRIMARY_ROWS)
  expect(tail.map((p) => p.time)).toEqual(fx.primary.map((b) => b.t))
  const wrongDoor = tail.filter((p, i) => Math.abs(p.close - fx.primary[i].c) > 1e-9)
  expect(wrongDoor.length, `${label}: ${wrongDoor.length} right-edge bars not from /api/bars `
    + `(first ${wrongDoor[0] && wrongDoor[0].time})`).toBe(0)
  expect(rendered.at(-1).time, `${label}: right edge`).toBe(fx.frontier)
  return `n=${rendered.length} ${rendered[0].time}..${rendered.at(-1).time} primary=${primaryUrls.length}x hist=${histUrls.length}x`
}

const MATRIX = []
describe('DAILY deep history — every session window', () => {
  for (const [name, iso] of Object.entries(CLOCKS)) {
    describe(name, () => {
      beforeEach(() => { clock.retarget(iso) })

      it('cold browser: deep origin on the left, server on the right', async () => {
        const res = await runCase()
        MATRIX.push(`${name.padEnd(16)} cold      ${res.rendered ? `n=${res.rendered.length} first=${res.rendered[0]?.time}` : 'none'}`)
        assertDeep(`${name} cold`, res)
      }, 30000)

      it('deep cache with a stale today bar: server still owns the right edge', async () => {
        const res = await runCase({ seedIdb: true })
        MATRIX.push(`${name.padEnd(16)} deep-idb  ${res.rendered ? `n=${res.rendered.length} first=${res.rendered[0]?.time} lastC=${res.rendered.at(-1)?.close}` : 'none'}`)
        assertDeep(`${name} deep-idb`, res)
      }, 30000)

      it('Origin centres bar 0 of the deep series', async () => {
        const res = await runCase({ clickOrigin: true })
        MATRIX.push(`${name.padEnd(16)} origin    bar0=${res.origin?.bar0} frame=${JSON.stringify(res.origin?.frame)}`)
        assertDeep(`${name} origin`, res)
        expect(res.origin?.clicked, 'the Origin pill was not rendered').toBe(true)
        expect(res.origin.bar0).toBe(res.fx.deep[0].t)
        // centerFirstBar puts logical bar 0 in the middle of the frame.
        expect(res.origin.frame.from).toBeLessThan(0)
        expect(res.origin.frame.to).toBeGreaterThan(0)
      }, 30000)
    })
  }

  // ⛔ VALUE SERIES (2026-10-07). The last-bar sanity gate is a STOCK-PRICE rule
  // (positive, open within 50% of close). Breadth series break it on ordinary days —
  // NASDAQ:NETHL / MCO close below zero, a %-above-MA can double in a session — and
  // the splice used to inherit it, so those charts "began" at the 600-bar window.
  const VALUE_SHAPES = {
    'negative-valued (net highs-lows)': (bars) => bars.map((b) => ({ ...b, o: b.o - 200, h: b.h - 200, l: b.l - 200, c: b.c - 200 })),
    'last bar swings >50% (% above MA)': (bars) => bars.map((b, i) => (i === bars.length - 1
      ? { ...b, o: 10, h: 26, l: 10, c: 25 } : b)),
  }
  for (const [name, iso] of [['RTH 13:17 Tue', CLOCKS['RTH 13:17 Tue']], ['POST 19:30 Tue', CLOCKS['POST 19:30 Tue']]]) {
    for (const [shapeName, shape] of Object.entries(VALUE_SHAPES)) {
      it(`${name} · ${shapeName} with a deep cache: deep history still drawn`, async () => {
        clock.retarget(iso)
        const res = await runCase({ seedIdb: true, shape })
        assertDeep(`${name} ${shapeName}`, res)
      }, 30000)
    }
  }

  it('MATRIX', () => {
    console.log('[DEEP-CLOCK-MATRIX]\n' + MATRIX.join('\n'))
    expect(MATRIX.length).toBe(Object.keys(CLOCKS).length * 3)
  })
})
