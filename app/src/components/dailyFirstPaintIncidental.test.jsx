/**
 * Focused regression rails for the TWO correctness defects the daily first-paint
 * investigation uncovered. Both are independent of the paint-authority work and both
 * are easy to silently reintroduce, so each gets its own named case at the level the
 * member actually experiences it — the rendered candle series.
 *
 * CASE A — a live price must never be written onto a SEALED prior-session candle.
 *   `classifyLiveBar`'s daily REST floor said it was folding into "the current-session
 *   last bar" and never checked that `last` WAS the current session. With a body that
 *   ends at the last sealed session — now the normal cold daily path, since today is
 *   supplied by the current-session seed — it wrote today's O/H/L/C onto yesterday.
 *
 * CASE B — a same-length daily refetch must merge, not replace.
 *   A full daily refetch returns the most-recent N bars, so a cache holding N bars
 *   ending one session back was replaced by a SLID window: the oldest bar was dropped,
 *   every logical index fell by one, and the chart translated by a bar the instant the
 *   tail landed.
 *
 * ⛔ THE WALL CLOCK IS PINNED (RTH on a plain Tuesday). Every fixture is a today-dated
 *   daily cache expected to paint FIRST, and after the bell the product defers exactly
 *   that cache to the sealed close by design (`isDailyTodayCloseProvisionalForPaint`,
 *   a663b0d67) — so CASE B read as "the oldest cached bar was dropped" every day from
 *   16:00 ET, when in fact the cache was never painted at all. Measured 2026-09-24:
 *   real clock 18:12 ET → CASE B red · pinned 14:26 ET on the same tree → 5/5. See
 *   `dailyFirstPaintAcceptance.test.jsx` for the full measurement and the after-bell case.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'

const spy = vi.hoisted(() => ({ setVisibleLogicalRange: null, last: null }))
const seriesLog = vi.hoisted(() => ({ calls: [] }))
const world = vi.hoisted(() => ({
  sym: 'I0', idbEntry: null, packBar: null, packUsable: false, liveSnap: null,
  netBars: null, netDelayMs: 120,
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
    setVisibleLogicalRange: (r) => { spy.setVisibleLogicalRange?.(r); spy.last = r },
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
vi.mock('../hooks/livePriceStore', () => ({
  getSnapshot: () => (world.liveSnap ? { [world.sym]: world.liveSnap } : {}),
  subscribe: () => () => {},
}))
vi.mock('../lib/todayPackClient', () => ({
  getTodayBar: () => world.packBar,
  todayPackUsable: () => world.packUsable,
  touchTodayPack: () => Promise.resolve(null),
  ensureTodayPack: () => Promise.resolve(null),
  todayPackAgeMs: () => (world.packUsable ? 1000 : Infinity),
}))
vi.mock('../utils/barsIDB', async (importOriginal) => ({
  ...(await importOriginal()),
  idbGet: async () => world.idbEntry,
  idbPut: async () => {},
}))

// The wall clock is an INPUT (see the header): Tue 2026-09-22 14:26 ET, inside RTH.
const PINNED_RTH_ISO = '2026-09-22T18:26:00Z'
const clock = pinWallClock(PINNED_RTH_ISO)

const Mod = await import('./StockChart')
const StockChart = Mod.default
const MS = await import('../utils/marketSession')
const FRONTIER = MS.expectedDailyTailForPaintET()

function sessionsBack(k) {
  const d = new Date(`${FRONTIER}T12:00:00Z`)
  let left = k
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) left -= 1
  }
  return d.toISOString().slice(0, 10)
}
function seriesEndingAt(isoEnd, n = 120) {
  const out = []
  const d = new Date(`${isoEnd}T12:00:00Z`)
  while (out.length < n) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const i = n - out.length
      out.unshift({ t: d.toISOString().slice(0, 10), o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1e6 + i })
    }
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const PANE_PROPS = {
  tf: 'D', keepPresentOnSymbolChange: true, carryDragPlacement: true,
  rightPadBars: 6, dailyDefaultBars: 126, viewLockKey: 'uct.incidental.viewLock', backgroundWarm: true,
}

const caught = { error: null }
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { dead: false } }
  static getDerivedStateFromError() { return { dead: true } }
  componentDidCatch(e) { caught.error = e }
  render() { return this.state.dead ? null : this.props.children }
}
function candleSeriesId() {
  let id = null
  for (const c of seriesLog.calls) {
    if (c.op === 'setData' && Array.isArray(c.data) && c.data.some((x) => x && x.open !== undefined)) id = c.id
  }
  return id
}
/** Replay setData AND update, with LWC's own placement semantics. */
function rendered() {
  const id = candleSeriesId()
  if (id == null) return null
  let arr = null
  for (const c of seriesLog.calls) {
    if (c.id !== id) continue
    if (c.op === 'setData') { arr = Array.isArray(c.data) ? c.data.slice() : null; continue }
    if (c.op === 'update' && arr && c.data) {
      const pt = c.data
      const li = arr.length - 1
      if (li >= 0 && arr[li] && arr[li].time === pt.time) { arr[li] = pt; continue }
      const at = arr.findIndex((x) => x && x.time === pt.time)
      if (at >= 0) { arr[at] = pt; continue }
      if (li < 0 || pt.time > arr[li].time) arr.push(pt)
    }
  }
  return arr
}
const tick = async (ms = 40) => {
  await new Promise((r) => setTimeout(r, ms))
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

let n = 0
async function switchTo(setup, settleMs = 700) {
  world.sym = `I${++n}`
  Object.assign(world, { idbEntry: null, packBar: null, packUsable: false, liveSnap: null, netBars: null })
  setup()
  caught.error = null
  const PRIOR = seriesEndingAt(FRONTIER, 100)
  const { rerender, unmount } = render(<Boundary><StockChart sym="AA" barsOverride={PRIOR} {...PANE_PROPS} /></Boundary>)
  await waitFor(() => expect(spy.setVisibleLogicalRange).toHaveBeenCalled(), { timeout: 5000 })
  await tick()
  seriesLog.calls = []
  spy.setVisibleLogicalRange.mockClear()
  rerender(<Boundary><StockChart sym={world.sym} {...PANE_PROPS} /></Boundary>)

  let first = null; let firstFrame = null
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    await tick(20)
    const r = rendered()
    if (r && r.length) { first = r.slice(); firstFrame = spy.last ? { ...spy.last } : null; break }
  }
  await tick(settleMs)
  const final = rendered()
  const finalFrame = spy.last ? { ...spy.last } : null
  const ops = seriesLog.calls.filter((c) => c.id === candleSeriesId())
  unmount()
  expect(caught.error, `render threw: ${caught.error && caught.error.message}`).toBeNull()
  return { first, final, firstFrame, finalFrame, ops }
}
/** Distance of a given bar date from the right edge — invariant to left-side prepends. */
const padOf = (paint, frame, iso) => {
  if (!paint || !frame) return null
  const i = paint.findIndex((p) => p.time === iso)
  return i < 0 ? null : +(frame.to - i).toFixed(3)
}

beforeEach(() => {
  cleanup()
  spy.setVisibleLogicalRange = vi.fn(); spy.last = null; seriesLog.calls = []
  try { localStorage.clear() } catch { /* jsdom */ }
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    if (u.includes('/api/bars-history/')) return { ok: true, json: async () => ({ ticker: world.sym, tf: 'D', sealed: true, bars: [] }) }
    if (u.includes('/api/bars/')) {
      if (world.netDelayMs) await new Promise((r) => setTimeout(r, world.netDelayMs))
      return { ok: true, json: async () => ({ ticker: world.sym, tf: 'D', bars: world.netBars || [] }) }
    }
    return { ok: true, json: async () => ({}) }
  }))
})
afterEach(() => { vi.unstubAllGlobals() })
afterAll(() => { clock.restore() })

describe('session window', () => {
  it('is pinned inside RTH on a plain Tuesday — the pin is load-bearing', () => {
    // ⛔ Without the pin every case below is a function of the hour the gate runs.
    expect(FRONTIER).toBe('2026-09-22')
    expect(MS.isDailyTodayCloseProvisionalForPaint(FRONTIER)).toBe(false)
  })
})

// ── CASE A ──────────────────────────────────────────────────────────────────
describe('CASE A — a live price never rewrites a sealed prior-session candle', () => {
  it("yesterday's bar is byte-identical before and after the live session is applied", async () => {
    const YDAY = sessionsBack(1)
    const body = seriesEndingAt(YDAY)                 // sealed body ENDS YESTERDAY
    const sealedYesterday = body[body.length - 1]
    // Today's live values, deliberately far from yesterday's, so an overwrite is loud.
    const todayVals = { o: sealedYesterday.c + 5, h: sealedYesterday.c + 9, l: sealedYesterday.c + 4, c: sealedYesterday.c + 7 }

    const { first, final, ops } = await switchTo(() => {
      world.idbEntry = { bars: body, lastT: YDAY, savedAt: Date.now() }
      world.netBars = body                             // server also has nothing past yesterday
      // ⛔ NO prev_close — AND THAT IS THE WHOLE CASE. The daily REST floor only
      // folds a live price into `last` when it CANNOT confirm a new session; with a
      // matching prev_close it confirms one and plants TODAY instead, so a fixture
      // that supplies one never reaches the defect and the rail passes on broken
      // code (verified: it did). Absent/unmatchable prev_close is the unconfirmable
      // shape, which is exactly when the old code wrote onto yesterday.
      world.liveSnap = {
        price: todayVals.c, day_open: todayVals.o, day_high: todayVals.h, day_low: todayVals.l,
        ext_session: false, observed_at: Math.floor(Date.now() / 1000),
      }
    })

    expect(first, 'nothing painted — stimulus or observation is dead').toBeTruthy()

    const yFirst = first.find((p) => p.time === YDAY)
    const yFinal = final.find((p) => p.time === YDAY)
    expect(yFirst, 'yesterday must be present in the first frame').toBeTruthy()
    expect(yFinal, 'yesterday must survive to the final frame').toBeTruthy()

    // The whole point: the SEALED bar's own values, untouched by the live session.
    for (const k of ['open', 'high', 'low', 'close']) {
      expect(yFinal[k], `yesterday.${k} was rewritten`).toBe(yFirst[k])
    }
    expect(yFinal.open).toBe(sealedYesterday.o)
    expect(yFinal.high).toBe(sealedYesterday.h)
    expect(yFinal.low).toBe(sealedYesterday.l)
    expect(yFinal.close).toBe(sealedYesterday.c)

    // …and no writer even ATTEMPTED it. Asserting the values alone would pass if a
    // writer wrote yesterday and a later repaint happened to restore it.
    const badWrites = ops.filter((c) => c.op === 'update' && c.data && c.data.time === YDAY
      && (c.data.close === todayVals.c || c.data.high === todayVals.h))
    expect(badWrites, "a writer targeted yesterday's sealed bar with today's values").toHaveLength(0)
  }, 30000)

  it("today's own values still reach today's slot (the guard is not a mute button)", async () => {
    const YDAY = sessionsBack(1)
    const body = seriesEndingAt(YDAY)
    const sealed = body[body.length - 1]
    const todayVals = { o: sealed.c + 5, h: sealed.c + 9, l: sealed.c + 4, c: sealed.c + 7 }

    const { first } = await switchTo(() => {
      world.idbEntry = { bars: body, lastT: YDAY, savedAt: Date.now() }
      world.netBars = body
      world.liveSnap = {
        price: todayVals.c, day_open: todayVals.o, day_high: todayVals.h, day_low: todayVals.l,
        prev_close: sealed.c, ext_session: false, observed_at: Math.floor(Date.now() / 1000),
      }
    })
    const todayPt = first.find((p) => p.time === FRONTIER)
    expect(todayPt, "today's slot must exist").toBeTruthy()
    expect(todayPt.close, "today's slot must carry today's price, not be a hole").toBe(todayVals.c)
  }, 30000)
})

// ── CASE B ──────────────────────────────────────────────────────────────────
describe('CASE B — a same-length daily refetch merges instead of dropping the oldest bar', () => {
  it('the oldest cached bar survives and the geometry does not translate', async () => {
    const YDAY = sessionsBack(1)
    const N = 120
    const cached = seriesEndingAt(YDAY, N)          // N bars ending one session back
    const slid = seriesEndingAt(FRONTIER, N)        // N bars — the CURRENT window, slid by one
    const oldestCached = cached[0].t
    expect(slid.length).toBe(cached.length)         // the shape under test: SAME length
    expect(slid[0].t > oldestCached).toBe(true)     // …and genuinely slid off the oldest

    const { first, final, firstFrame, finalFrame } = await switchTo(() => {
      world.idbEntry = { bars: cached, lastT: YDAY, savedAt: Date.now() }
      world.netBars = slid
      world.packBar = { o: 1000, h: 1001, l: 999, c: 1000.5, v: 1 }   // any today source
      world.packUsable = true
    })

    expect(first, 'nothing painted').toBeTruthy()
    // 1. The oldest bar was not thrown away by the same-length refetch.
    expect(final.some((p) => p.time === oldestCached),
      'the oldest cached bar was dropped by a same-length replace').toBe(true)
    // 2. N cached + the one new session = N+1; a replace would have left N.
    expect(final.length).toBe(N + 1)
    // 3. And the picture did not move: the frontier bar keeps its distance from the
    //    right edge. This is the assertion a one-index translation reds.
    const padFirst = padOf(first, firstFrame, FRONTIER)
    const padFinal = padOf(final, finalFrame, FRONTIER)
    expect(padFirst).not.toBeNull()
    expect(padFinal).not.toBeNull()
    expect(Math.abs(padFinal - padFirst)).toBeLessThan(0.01)
  }, 30000)

  it('a genuinely SHORTER server answer is still allowed to win (no blanket merge)', async () => {
    // The merge widening is justified by the suffix guard, not by "always keep IDB".
    // A server set that starts BEFORE the cached one is not a suffix and must replace,
    // otherwise a deliberate server-side truncation could never reach the chart.
    const deepOld = seriesEndingAt(FRONTIER, 60)
    const wider = seriesEndingAt(FRONTIER, 200)      // starts EARLIER than the cache
    const { final } = await switchTo(() => {
      world.idbEntry = { bars: deepOld, lastT: FRONTIER, savedAt: Date.now() }
      world.netBars = wider
    })
    expect(final.length).toBe(200)
    expect(final[0].time).toBe(wider[0].t)
  }, 30000)
})

// ── REPAIR SCOPE ────────────────────────────────────────────────────────────
// The stale-today repair rewrites today's slot from the freshest LOCAL source. It
// runs on every evaluation of the candle memo, including AFTER /api/bars lands — so
// the question this case exists to answer is whether a local seed can ever pull an
// already-authoritative close BACKWARDS.
describe('stale-today repair does not override a fresher authoritative bar', () => {
  it('a local seed never drags the painted close away from the served one', async () => {
    const authoritative = seriesEndingAt(FRONTIER, 120)
    const served = authoritative[authoritative.length - 1]
    // A pack that is behind the server: same session, older price and a narrower range.
    const laggingPack = {
      o: served.o, h: served.h - 0.5, l: served.l + 0.5, c: served.c - 0.4, v: served.v,
    }
    const { final } = await switchTo(() => {
      world.idbEntry = { bars: authoritative, lastT: FRONTIER, savedAt: Date.now() }
      world.netBars = authoritative
      world.packBar = laggingPack
      world.packUsable = true
    })
    const today = final[final.length - 1]
    expect(today.time).toBe(FRONTIER)
    // High/low are monotone, so a lagging observation can never narrow them.
    expect(today.high).toBeGreaterThanOrEqual(served.h)
    expect(today.low).toBeLessThanOrEqual(served.l)
    // The close is the one field a lagging seed COULD walk backwards.
    expect(today.close, 'a lagging local seed overrode the served close').toBe(served.c)
  }, 30000)
})
