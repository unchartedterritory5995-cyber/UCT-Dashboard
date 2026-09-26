/**
 * DAILY FIRST-PAINT ACCEPTANCE.
 *
 * Unlike the investigation probe (which injected bar arrays through `barsOverride`),
 * this drives the REAL selector path — IDB entry -> today-pack -> /api/bars-history ->
 * /api/bars — so it exercises the paint-authority gate, the shared reserve/seed list
 * and the stale-today repair as the product actually composes them.
 *
 * FAIL-CLOSED. Every case returns PASS / FAIL / INVALID. A case that cannot prove its
 * stimulus (a symbol switch happened) AND its observation (the target symbol's candle
 * data reached the series, and an effective visible range was read back) is INVALID —
 * never PASS. The rendered series is reconstructed by replaying setData AND update,
 * because the incremental path is how a stale wick gets corrected and an observer that
 * watches only setData is blind to exactly the defect it is meant to catch.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { pinWallClock, wallClockET } from '../testing/pinnedWallClock'

// A render error must surface as a NAMED failure, not as a silent "never painted".
const caught = { error: null }
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { dead: false } }
  static getDerivedStateFromError() { return { dead: true } }
  componentDidCatch(e) { caught.error = e }
  render() { return this.state.dead ? null : this.props.children }
}

const spy = vi.hoisted(() => ({ setVisibleLogicalRange: null, last: null }))
const seriesLog = vi.hoisted(() => ({ calls: [] }))
const world = vi.hoisted(() => ({
  sym: 'B0',
  idbEntry: null,        // { bars, lastT, savedAt } | null
  packBar: null,         // { o,h,l,c,v } | null
  packUsable: false,
  liveSnap: null,        // live-price store row | null
  netBars: null,         // /api/bars payload bars
  histBars: null,        // /api/bars-history payload bars
  netDelayMs: 0,
  netResolvedAt: 0,
  netCalls: 0,
  histCalls: 0,
  packTouches: 0,
}))

vi.mock('./chart/ChartVLineOverlay', () => ({ default: () => null }))

vi.mock('lightweight-charts', () => {
  let _sid = 0
  const mkSeries = () => {
    const id = ++_sid
    return {
      setData: (d) => { seriesLog.calls.push({ id, op: 'setData', data: d, t: Date.now() }) },
      update: (d) => { seriesLog.calls.push({ id, op: 'update', data: d, t: Date.now() }) },
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
  touchTodayPack: () => { world.packTouches += 1; return Promise.resolve(null) },
  ensureTodayPack: () => Promise.resolve(null),
  todayPackAgeMs: () => (world.packUsable ? 1000 : Infinity),
}))
// The real module is IndexedDB-backed; hand the component a controlled entry so each
// case states the exact cache age/tail it is testing — but keep every OTHER export
// real (mergeDelta, _closeMismatch, the freshness classifier). A hand-written stub
// silently drops whatever it forgets, and a missing export throws deep inside render
// where it reads as "the chart never painted" rather than as a broken harness.
vi.mock('../utils/barsIDB', async (importOriginal) => ({
  ...(await importOriginal()),
  idbGet: async () => world.idbEntry,
  idbPut: async () => {},
}))

// ── Session context — the wall clock is an INPUT, and it is PINNED.
//
// ⚰️ This block used to read "every expectation is derived from the PAINT FRONTIER,
// never from a hard-coded 'today', so the suite is correct in any session window".
// The first half is true and kept; the conclusion was false. The product's paint
// authority is window-dependent BY DESIGN: after the bell (weekday 16:00 ET →
// midnight, same ET day) a today-dated daily cache is DEFERRED to the network's
// sealed close (`isDailyTodayCloseProvisionalForPaint`, a663b0d67 — the no-flicker
// fix), so every "cache paints first" expectation below only holds inside RTH. This
// file was committed at 14:26 ET and green there; from 16:00 ET it was red every day.
//
// Measured 2026-09-24 on ONE tree: real clock 18:12 ET → NC-B, NC-C red · clock
// pinned to 14:26 ET → 18/18 · pinned to 18:12 ET on the author's own day → the
// same reds. So the window is now STATED — RTH on a plain Tuesday — and the
// after-bell window is covered by its own case below, with its own expectation.
// The pin SHIFTS the clock (it keeps advancing), so the polling harness is unchanged.
const PINNED_RTH_ISO = '2026-09-22T18:26:00Z'          // Tue 14:26 ET — inside RTH
const PINNED_AFTER_BELL_ISO = '2026-09-22T22:12:00Z'   // Tue 18:12 ET — same day, after the close
const clock = pinWallClock(PINNED_RTH_ISO)

const Mod = await import('./StockChart')
const StockChart = Mod.default
const MS = await import('../utils/marketSession')

// Every expectation is derived from the PAINT FRONTIER under the pin (2026-09-22),
// and the context case below says out loud which window the run is in.
const FRONTIER = MS.expectedDailyTailForPaintET()
const NOW_ET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
const MINS = NOW_ET.getHours() * 60 + NOW_ET.getMinutes()
const IS_RTH = NOW_ET.getDay() >= 1 && NOW_ET.getDay() <= 5 && MINS >= 570 && MINS < 960

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
function seriesEndingAt(isoEnd, n = 260) {
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
const FULL = seriesEndingAt(FRONTIER)                     // authoritative: reaches the frontier
const TODAY_BAR = FULL[FULL.length - 1]
const FRESH_TODAY = { o: TODAY_BAR.o, h: TODAY_BAR.h, l: TODAY_BAR.l, c: TODAY_BAR.c, v: TODAY_BAR.v }
// A today-dated bar whose wick is BEHIND the authoritative one — the stale-wick shape.
//
// ⛔ IT MUST STILL BE A VALID BAR. The first cut pulled the high BELOW the open and
// pushed the low ABOVE it, which is not a stale wick but a malformed one — and the
// chart's own value-sanity gate (_idbDailyLastInsane) correctly refused it, so the
// case was scoring the corrupt-bar path while claiming to test staleness. Range
// narrowed toward the body, ordering intact: exactly what an hours-old snapshot of a
// still-developing session looks like.
const STALE_TODAY_BAR = {
  ...TODAY_BAR,
  h: Math.max(TODAY_BAR.o, TODAY_BAR.c) + 0.1,   // high seen so far, short of the real one
  l: Math.min(TODAY_BAR.o, TODAY_BAR.c) - 0.2,   // low seen so far, short of the real one
  c: TODAY_BAR.c - 0.3,                          // price as of that snapshot
}

// Measured production round trip for /api/bars (investigation, 2026-09-22).
const NET_LATENCY_MS = 300

const PANE_PROPS = {
  tf: 'D', keepPresentOnSymbolChange: true, carryDragPlacement: true,
  rightPadBars: 6, dailyDefaultBars: 126, viewLockKey: 'uct.accept.viewLock',
  backgroundWarm: true,
}

// ── Rendered-state reducer: setData AND update, in order. ────────────────────
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
      // LWC semantics: update() at an EXISTING time replaces that point in place and
      // only a time past the last one appends. A reducer that appends whenever the
      // time differs from the tail invents bars — which is how a writer touching an
      // OLDER bar looked like series growth instead of the data defect it is.
      const pt = c.data
      const lastIdx = arr.length - 1
      if (lastIdx >= 0 && arr[lastIdx] && arr[lastIdx].time === pt.time) { arr[lastIdx] = pt; continue }
      const at = arr.findIndex((x) => x && x.time === pt.time)
      if (at >= 0) { arr[at] = pt; continue }
      if (lastIdx < 0 || pt.time > arr[lastIdx].time) arr.push(pt)
      // otherwise: a time before the series start — LWC would reject it; so do we.
    }
  }
  return arr
}
const frame = () => (spy.last ? { from: +Number(spy.last.from).toFixed(3), to: +Number(spy.last.to).toFixed(3) } : null)
const tick = async (ms = 40) => {
  await new Promise((r) => setTimeout(r, ms))
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

beforeEach(() => {
  cleanup()
  spy.setVisibleLogicalRange = vi.fn()
  spy.last = null
  seriesLog.calls = []
  Object.assign(world, {
    idbEntry: null, packBar: null, packUsable: false, liveSnap: null,
    netBars: FULL, histBars: null, netDelayMs: NET_LATENCY_MS, netResolvedAt: 0,
    netCalls: 0, histCalls: 0, packTouches: 0,
  })
  try { localStorage.clear() } catch { /* jsdom always has it */ }
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    if (u.includes('/api/bars-history/')) {
      world.histCalls += 1
      return { ok: true, json: async () => ({ ticker: world.sym, tf: 'D', sealed: true, bars: world.histBars || [] }) }
    }
    if (u.includes('/api/bars/')) {
      world.netCalls += 1
      // ⛔ A ZERO-LATENCY NETWORK MAKES THIS HARNESS NON-DISCRIMINATING. With an
      // instant /api/bars the authoritative set wins every race, every case paints
      // from the network, and a BROKEN paint-authority gate scores exactly like a
      // working one. The delay is the measured production round trip (300-500ms),
      // which is precisely the window the whole feature exists to fill.
      if (world.netDelayMs) await new Promise((r) => setTimeout(r, world.netDelayMs))
      world.netResolvedAt = Date.now()
      return { ok: true, json: async () => ({ ticker: world.sym, tf: 'D', bars: world.netBars || [] }) }
    }
    return { ok: true, json: async () => ({}) }
  }))
})
afterEach(() => { vi.unstubAllGlobals() })
afterAll(() => { clock.restore() })

/**
 * Run one symbol switch A -> BBB and score the first visible target frame.
 * `settleMs` is how long we watch for post-paint mutations.
 */
let _caseNo = 0
async function runCase(name, expectSource, settleMs = 700, opts = {}) {
  // ⛔ A UNIQUE TICKER PER CASE. SWR's cache is global and keyed by URL, so a shared
  // ticker made every case after the first resolve INSTANTLY from the previous
  // case's response — the network "latency" vanished and every case scored as a
  // cache paint, including the one with no cache at all. Same dead-observation trap
  // as the setData-only reducer, in a different costume.
  world.sym = `B${++_caseNo}`
  const PRIOR = seriesEndingAt(FRONTIER, 200)
  caught.error = null
  const { rerender, unmount } = render(<Boundary><StockChart sym="AAA" barsOverride={PRIOR} {...PANE_PROPS} /></Boundary>)
  await waitFor(() => expect(spy.setVisibleLogicalRange).toHaveBeenCalled(), { timeout: 5000 })
  await tick()

  // ── stimulus ──
  seriesLog.calls = []
  spy.setVisibleLogicalRange.mockClear()
  const t0 = Date.now()
  rerender(<Boundary><StockChart sym={world.sym} {...PANE_PROPS} /></Boundary>)

  // first target paint = the first commit that puts candle data on the series
  let firstPaint = null; let firstFrame = null; let firstAtMs = null
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    await tick(20)
    const r = renderedCandles()
    if (r && r.length) { firstPaint = r.slice(); firstFrame = frame(); firstAtMs = Date.now() - t0; break }
  }
  if (caught.error) {
    unmount()
    return { name, verdict: 'FAIL', why: `render threw: ${caught.error.message}`,
             stack: String(caught.error.stack || '').split(String.fromCharCode(10)).slice(0, 4).join(' | ') }
  }
  if (!firstPaint) { unmount(); return { name, verdict: 'INVALID', why: 'target symbol never painted candle data' } }
  if (!firstFrame) { unmount(); return { name, verdict: 'INVALID', why: 'no effective visible range observed' } }

  const marks = seriesLog.calls.length
  if (opts.cameraKick) spy.last = { from: spy.last.from + opts.cameraKick, to: spy.last.to + opts.cameraKick }
  await tick(settleMs)
  const finalPaint = renderedCandles()
  const postOps = seriesLog.calls.slice(marks).filter((c) => c.id === candleSeriesId()).map((c) => c.op)
  const finalFrame = frame()
  unmount()

  // WHICH source got the screen first. Inferred from the clock, not from the data,
  // so it stays true even when two sources agree on values.
  const paintedSource = (world.netResolvedAt && (t0 + firstAtMs) >= world.netResolvedAt) ? 'network' : 'cache'

  const lastT = (a) => (a && a.length ? a[a.length - 1].time : null)
  const fLast = firstPaint[firstPaint.length - 1]
  const lLast = finalPaint && finalPaint.length ? finalPaint[finalPaint.length - 1] : null
  const firstLastT = lastT(firstPaint)
  const finalLastT = lastT(finalPaint)

  // Right-edge insertions after first paint: dates that appear at/after the first
  // frame's last date and were NOT in the first frame. A LEFT-side prepend (deep
  // history) is explicitly not an insertion — it moves no right-edge geometry.
  const firstTimes = new Set(firstPaint.map((p) => p.time))
  const rightInsertions = (finalPaint || []).filter((p) => p.time >= firstLastT && !firstTimes.has(p.time)).length

  const flags = []
  if (expectSource && paintedSource !== expectSource) flags.push(`SOURCE_${paintedSource.toUpperCase()}_EXPECTED_${expectSource.toUpperCase()}`)
  if (firstLastT !== FRONTIER) flags.push('FRONTIER_MISSING_AT_FIRST_PAINT')
  if (fLast && fLast.open === undefined) flags.push('TODAY_IS_WHITESPACE_AT_FIRST_PAINT')
  if (rightInsertions > 0) flags.push('RIGHT_EDGE_INSERTION_AFTER_PAINT')
  // ⛔ MEASURE WHAT THE MEMBER SEES, NOT THE RAW `to`. Logical indices are relative to
  // the START of the series, so a LEFT-side prepend (deep history arriving) raises
  // every index — and `to` with it — while the picture on screen does not move at all.
  // Scoring raw `to` flagged two clean prepends as drift. The quantity that actually
  // describes the chart's position is the FRONTIER BAR's distance from the right edge:
  // constant means nothing moved, and it is invariant to prepends by construction.
  const padOf = (paint, f) => {
    if (!paint || !f) return null
    const idx = paint.findIndex((p) => p.time === FRONTIER)
    return idx < 0 ? null : +(f.to - idx).toFixed(3)
  }
  const firstPad = padOf(firstPaint, firstFrame)
  const finalPad = padOf(finalPaint, finalFrame)
  if (firstPad == null || finalPad == null) flags.push('FRONTIER_NOT_LOCATABLE_IN_FRAME')
  else if (Math.abs(finalPad - firstPad) > 0.01) flags.push('VISIBLE_RANGE_DRIFT')
  if (fLast && lLast && fLast.time === lLast.time && fLast.open !== undefined
      && (fLast.high !== lLast.high || fLast.low !== lLast.low || fLast.close !== lLast.close)) {
    flags.push('TODAY_OHLC_CORRECTED_AFTER_PAINT')
  }

  return {
    name,
    verdict: flags.length ? 'FAIL' : 'PASS',
    flags,
    latencyMs: firstAtMs,
    paintedSource,
    firstN: firstPaint.length,
    finalN: finalPaint ? finalPaint.length : 0,
    firstLastT,
    finalLastT,
    todayAtFirstPaint: fLast && fLast.open !== undefined
      ? `O${fLast.open} H${fLast.high} L${fLast.low} C${fLast.close}` : 'HOLE',
    todayFinal: lLast && lLast.open !== undefined
      ? `O${lLast.open} H${lLast.high} L${lLast.low} C${lLast.close}` : 'HOLE',
    rightInsertions,
    frameTo: `${firstFrame.to}->${finalFrame ? finalFrame.to : '?'}`,
    framePad: `${firstPad}->${finalPad}`,
    postOps: postOps.join(',') || '-',
    netCalls: world.netCalls,
  }
}

const RESULTS = []
const report = (r) => { RESULTS.push(r); return r }

describe('DAILY first-paint acceptance', () => {
  it('session context is stated, not assumed — and the pin is load-bearing', () => {
    console.log(`[ACCEPT-CONTEXT] frontier=${FRONTIER} rth=${IS_RTH} etNow=${NOW_ET.toTimeString().slice(0, 8)} pinned=${wallClockET()}`)
    // ⛔ If the pin is ever removed this fails BY NAME here, instead of the matrix
    // going red only after 16:00 ET and reading as a product regression.
    expect(FRONTIER).toBe('2026-09-22')
    expect(IS_RTH).toBe(true)
  })

  it('D0 — IDB tail at the frontier, written just now', async () => {
    world.idbEntry = { bars: FULL, lastT: FRONTIER, savedAt: Date.now() }
    report(await runCase('D0 idb@frontier fresh', 'cache'))
  }, 30000)

  it('D1 — IDB tail one session behind, pack fresh', async () => {
    world.idbEntry = { bars: seriesEndingAt(sessionsBack(1)), lastT: sessionsBack(1), savedAt: Date.now() }
    world.packBar = FRESH_TODAY; world.packUsable = true
    report(await runCase('D1 idb-1 + pack', 'cache'))
  }, 30000)

  it('D2 — IDB tail two sessions behind (the reported shift shape)', async () => {
    world.idbEntry = { bars: seriesEndingAt(sessionsBack(2)), lastT: sessionsBack(2), savedAt: Date.now() }
    world.packBar = FRESH_TODAY; world.packUsable = true
    report(await runCase('D2 idb-2', 'network'))
  }, 30000)

  it('D5 — IDB tail five sessions behind', async () => {
    world.idbEntry = { bars: seriesEndingAt(sessionsBack(5)), lastT: sessionsBack(5), savedAt: Date.now() }
    world.packBar = FRESH_TODAY; world.packUsable = true
    report(await runCase('D5 idb-5', 'network'))
  }, 30000)

  it('D20 — IDB tail twenty sessions behind', async () => {
    world.idbEntry = { bars: seriesEndingAt(sessionsBack(20)), lastT: sessionsBack(20), savedAt: Date.now() }
    world.packBar = FRESH_TODAY; world.packUsable = true
    report(await runCase('D20 idb-20', 'network'))
  }, 30000)

  it('D250 — IDB tail ~250 sessions behind (the PLL class)', async () => {
    world.idbEntry = { bars: seriesEndingAt(sessionsBack(250)), lastT: sessionsBack(250), savedAt: Date.now() }
    world.packBar = FRESH_TODAY; world.packUsable = true
    report(await runCase('D250 idb-250', 'network'))
  }, 30000)

  it('NO-IDB — never opened in this browser', async () => {
    world.packBar = FRESH_TODAY; world.packUsable = true
    report(await runCase('NO-IDB cold', 'network'))
  }, 30000)

  it('PACK-EXPIRED — IDB one session behind and no local current-session source', async () => {
    world.idbEntry = { bars: seriesEndingAt(sessionsBack(1)), lastT: sessionsBack(1), savedAt: Date.now() }
    world.packUsable = false; world.packBar = null
    report(await runCase('PACK-EXPIRED idb-1', 'network'))
  }, 30000)

  it('STALE-TODAY — IDB reaches the frontier but was written hours ago, pack fresh', async () => {
    const stale = seriesEndingAt(FRONTIER).slice(0, -1).concat([STALE_TODAY_BAR])
    world.idbEntry = { bars: stale, lastT: FRONTIER, savedAt: Date.now() - 3 * 3600_000 }
    world.packBar = FRESH_TODAY; world.packUsable = true
    report(await runCase('STALE-TODAY + pack', 'cache'))
  }, 30000)

  it('STALE-TODAY, NO SEED — nothing local can make today current', async () => {
    const stale = seriesEndingAt(FRONTIER).slice(0, -1).concat([STALE_TODAY_BAR])
    world.idbEntry = { bars: stale, lastT: FRONTIER, savedAt: Date.now() - 3 * 3600_000 }
    world.packUsable = false; world.packBar = null
    report(await runCase('STALE-TODAY no seed', 'network'))
  }, 30000)

  it('LIVE-SEED — the live-price store is the freshest current-session door', async () => {
    world.idbEntry = { bars: seriesEndingAt(sessionsBack(1)), lastT: sessionsBack(1), savedAt: Date.now() }
    world.liveSnap = {
      price: TODAY_BAR.c, day_open: TODAY_BAR.o, day_high: TODAY_BAR.h, day_low: TODAY_BAR.l,
      ext_session: false, observed_at: Math.floor(Date.now() / 1000),
    }
    report(await runCase('LIVE-SEED idb-1', 'cache'))
  }, 30000)

  it('AFTER THE BELL — a fresh today-dated cache is DEFERRED to the sealed close (by design)', async () => {
    // ⭐ THE OTHER HALF OF THE WINDOW, as its own input. Same ET day at 18:12 ET: the
    // frontier is unchanged (today is the latest closed session), the cache is the D0
    // fixture, and the product must NOT paint it first — the network's sealed close
    // is the first frame, with no right-edge insertion, no drift and no OHLC
    // correction afterwards. This is `isDailyTodayCloseProvisionalForPaint` at the
    // level the member sees it; `marketSession.dailypaint.test.js` pins the predicate.
    // ⛔ Asserted, not merely reported: the D-rows above are printed only, and this
    // row is deterministic (a refused cache paints nothing, so the network can never
    // lose the race here).
    clock.retarget(PINNED_AFTER_BELL_ISO)
    try {
      expect(MS.expectedDailyTailForPaintET()).toBe(FRONTIER)   // same frontier — the fixtures still apply
      world.idbEntry = { bars: FULL, lastT: FRONTIER, savedAt: Date.now() }
      const r = report(await runCase('AFTER-BELL idb@today', 'network'))
      expect(r.verdict, `${r.name}: ${JSON.stringify(r.flags || r.why)}`).toBe('PASS')
    } finally {
      clock.retarget(PINNED_RTH_ISO)
    }
  }, 30000)

  // ── NEGATIVE CONTROLS ──────────────────────────────────────────────────────
  // A matrix where everything passes is worth nothing until it is shown to be able
  // to fail. Each control asserts its OWN flag, so a control going quiet reds the
  // suite instead of silently turning the matrix into decoration.
  const expectFlag = (r, flag) => {
    RESULTS.push(r)
    expect(r.verdict, `${r.name}: ${JSON.stringify(r.flags || r.why)}`).toBe('FAIL')
    expect(r.flags).toContain(flag)
  }

  it('NC-A missing today — nothing anywhere can supply the frontier', async () => {
    // No cache, no seed, and the server itself answers one session short. The time
    // domain still REACHES the frontier (the reserve holds its slot, so a later
    // arrival replaces rather than inserts) but the candle is a HOLE — which is the
    // honest description of "today exists and nobody has it yet", and the flag the
    // harness should raise. Asserting FRONTIER_MISSING here would have been asserting
    // the wrong defect: the frontier is present, its DATA is not.
    world.netBars = seriesEndingAt(sessionsBack(1))
    expectFlag(await runCase('NC-A missing today', null), 'TODAY_IS_WHITESPACE_AT_FIRST_PAINT')
  }, 30000)

  it('NC-B late right-edge insertion', async () => {
    // A fresh cache paints, then the server answers with a bar BEYOND the frontier —
    // exactly the "a session appears at the right edge after you are looking at it"
    // shape the whole change exists to forbid.
    world.idbEntry = { bars: FULL, lastT: FRONTIER, savedAt: Date.now() }
    const ahead = new Date(`${FRONTIER}T12:00:00Z`)
    do { ahead.setUTCDate(ahead.getUTCDate() + 1) } while ([0, 6].includes(ahead.getUTCDay()))
    const nextIso = ahead.toISOString().slice(0, 10)
    world.netBars = FULL.concat([{ ...TODAY_BAR, t: nextIso }])
    expectFlag(await runCase('NC-B late insertion', null), 'RIGHT_EDGE_INSERTION_AFTER_PAINT')
  }, 30000)

  it('NC-C stale wick corrected after paint', async () => {
    // Cache reaches the frontier and is recent, so it paints — but its today bar
    // disagrees with the server's, and NOTHING local can repair it (no seed).
    const stale = FULL.slice(0, -1).concat([STALE_TODAY_BAR])
    world.idbEntry = { bars: stale, lastT: FRONTIER, savedAt: Date.now() }
    world.packUsable = false; world.packBar = null; world.liveSnap = null
    expectFlag(await runCase('NC-C stale wick', 'cache'), 'TODAY_OHLC_CORRECTED_AFTER_PAINT')
  }, 30000)

  it('NC-D camera moved after first paint', async () => {
    world.idbEntry = { bars: FULL, lastT: FRONTIER, savedAt: Date.now() }
    expectFlag(await runCase('NC-D camera move', 'cache', 700, { cameraKick: 4 }), 'VISIBLE_RANGE_DRIFT')
  }, 30000)

  it('NC-E dead observation returns INVALID, never PASS', async () => {
    world.netBars = []          // nothing anywhere: no cache, no seed, no server bars
    const r = await runCase('NC-E dead observation', null)
    RESULTS.push(r)
    expect(r.verdict).toBe('INVALID')
  }, 30000)

  it('ACCEPTANCE SUMMARY', () => {
    const pad = (v, n) => String(v).padEnd(n)
    console.log('[ACCEPT-SUMMARY]\n' + RESULTS.map((r) => (
      (r.verdict === 'INVALID' || r.why)
        ? `${pad(r.verdict, 7)} | ${pad(r.name, 22)} | ${r.why}${r.stack ? String.fromCharCode(10) + '        ' + r.stack : ''}`
        : [
          pad(r.verdict, 7), pad(r.name, 22),
          pad((r.flags || []).join(',') || '-', 46),
          `n ${r.firstN}->${r.finalN}`,
          `lastT ${r.firstLastT}`,
          `today ${pad(r.todayAtFirstPaint, 30)}`,
          `final ${pad(r.todayFinal, 30)}`,
          `src ${pad(r.paintedSource, 7)}`,
          `ins ${r.rightInsertions}`,
          `pad ${pad(r.framePad, 17)}`,
          `to ${r.frameTo}`,
          `${r.latencyMs}ms`,
          `ops ${r.postOps}`,
        ].join(' | ')
    )).join('\n'))
    expect(RESULTS.length).toBe(17)
  })
})
