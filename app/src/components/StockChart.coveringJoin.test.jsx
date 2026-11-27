// ⭐ THE DEPTH JOINS BEHIND THE VIEW: A COVERING COPY PAINTS NOW, THE LAKE'S JOIN MOVES NOTHING ON SCREEN (2026-11-26).
//
// The switch paints a held intraday copy at once when it covers the view (hooks/useSymbolHandoff `covers`, COVER_ROWS),
// and the lake's deep history joins it AFTER the first frame (network.lakeSeed: older rows only). The rule for that
// (coordinator ruling 2026-11-26): the deepening must not move the visible range or the price scale. Here the REAL
// StockChart (5-minute, regular hours) on the REAL library members run paints a key holding the server's newest rows
// (well over COVER_ROWS regular-session rows), then the lake's older rows join it (LAKE_HIT, the action lakeSeed
// dispatches), and:
//   1. the visible window is the same bars (its edges counted from the newest bar, and the visible times), and every
//      series' price scale shows the same range;
//   2. non-vacuous: the older rows really joined (the store and the candle series hold more rows after it).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'
import { installRecordingCanvas } from '../testing/stockChartLibraryTrace'
import { etUnix } from '../data/barStore/__fixtures__/seededSeries'

const S = vi.hoisted(() => ({ calls: [], n: 0, ids: new Map(), live: new Map(), chart: null, charts: [] }))
vi.mock('lightweight-charts', async () => (await import('../testing/stockChartLibraryTrace')).recordingLibrary(S))
vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('../utils/barsIDB', async (orig) => ({ ...(await orig()), idbGet: async () => null, idbPut: async () => {}, idbPutMonotonic: async () => {} }))
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// a Saturday: every session is closed, nothing forms
const clock = pinWallClock('2026-11-14T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

const LIST = ['RA', 'RB', 'RC', 'RD', 'RE', 'RF']
const TFS = ['5']
const _rows = new Map()
/** `sym`'s 5-minute rows, 04:00 to 20:00 ET (extended hours included), 20 sessions. */
function rowsOf(sym, tf) {
  const id = `${sym}|${tf}`
  if (_rows.has(id)) return _rows.get(id)
  const k = LIST.indexOf(sym) + 1
  const step = Number(tf)
  const dates = []
  for (let ms = Date.UTC(2026, 10, 13); dates.length < 20; ms -= 86_400_000) {
    const wd = new Date(ms).getUTCDay()
    if (wd !== 0 && wd !== 6) dates.push(new Date(ms).toISOString().slice(0, 10))
  }
  dates.reverse()
  const out = []
  let i = 0
  for (const d of dates) {
    for (let m = 240; m < 1200; m += step) {
      const c = 40 * k + Math.sin(i / 17) * 4 * k + i * 0.002
      out.push({ t: etUnix(d, m), o: c - 0.3, h: c + 0.9, l: c - 1.1, c, v: 1000 + ((i * 7919 * k) % 90000) })
      i++
    }
  }
  _rows.set(id, out)
  return out
}

async function run(ANSWER, join = 'lake') {
  S.calls = []
  S.n = 0
  S.ids = new Map()
  S.live = new Map()
  S.chart = null
  S.charts = []
  vi.stubGlobal('requestIdleCallback', (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 5))
  vi.stubGlobal('cancelIdleCallback', (h) => clearTimeout(h))
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
    const m = /\/api\/bars\/([A-Z]+)\?tf=(\d+)/.exec(u)
    if (m && LIST.includes(m[1]) && TFS.includes(m[2])) {
      return Promise.resolve(json({ ticker: m[1], tf: m[2], bars: rowsOf(m[1], m[2]).slice(-ANSWER), newest_bar_is_forming: false }))
    }
    return Promise.resolve(json({}))
  }))
  const M = await loadWithBarStore(true, async () => ({
    StockChart: (await import('./StockChart')).default,
    store: (await import('../data/barStore/index')).getBarStore(),
    chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
    ACTION: (await import('../data/barStore/types')).ACTION,
    COVER_ROWS: (await import('../data/barStore/coverRows')).COVER_ROWS,
    heldRows: (await import('../data/barStore/prefetch')).heldRows,
  }))
  installRecordingCanvas()
  const key = M.chartKeyFor({ sym: 'RB', resolvedTf: '5', showExtended: false, replayCutoff: null, hasOverride: false })
  M.store.registry.acquire(key)
  await act(async () => { await M.store.ensure(key, { priority: 'urgent' }) })
  const held = M.store.peek(key).bars.length
  const viewRows = M.heldRows('RB', '5', { showExtended: false })   // what the switch's `covers` reads
  const candleOf = (chart) => [...S.live.values()].find((x) => x.chart === chart && x.kind === 'candle')
  const candleRows = () => (S.charts.length ? candleOf(S.charts[S.charts.length - 1])?.s.data().length || 0 : 0)
  async function settle(pred) {
    const t0 = performance.now()
    while (!pred()) {
      if (performance.now() - t0 > 30_000) throw new Error('never drawn')
      await wait(20)
    }
    let n = S.calls.length
    let quiet = 0
    while (quiet < 3) {
      await wait(50)
      if (S.calls.length === n) quiet += 1
      else { n = S.calls.length; quiet = 0 }
      if (performance.now() - t0 > 40_000) throw new Error('never settled')
    }
  }
  const view = () => {
    const ch = S.charts[S.charts.length - 1]
    const ts = ch.timeScale()
    const rows = candleOf(ch).s.data()
    const r = ts.getVisibleLogicalRange()
    const newest = rows.length - 1
    const scales = [...S.live.values()].filter((x) => x.chart === ch).map(({ s, kind }) => {
      let sc = null
      try { sc = s.priceScale().getVisibleRange() } catch { sc = 'n/a' }
      return { kind, sc: sc && typeof sc === 'object' ? { from: +Number(sc.from).toFixed(6), to: +Number(sc.to).toFixed(6) } : sc }
    })
    const vr = ts.getVisibleRange()
    // every series' rows inside the visible window (the candles, volume and each average's values on screen)
    // (to 1e-6: an average over a longer history sums its floats in another order, ~1e-13 apart: no pixel, no digit)
    const r6 = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(6) : v]))
    const onScreen = [...S.live.values()].filter((x) => x.chart === ch).map(({ s, kind }) => ({ kind, rows: s.data().filter((d) => vr && d.time >= vr.from && d.time <= vr.to).map(r6) }))
    return {
      onScreen: JSON.stringify(onScreen),
      rows: rows.length,
      edge: r ? { from: +(r.from - newest).toFixed(3), to: +(r.to - newest).toFixed(3) } : null,
      times: JSON.stringify(ts.getVisibleRange()),
      scales: JSON.stringify(scales),
    }
  }
  render(<M.StockChart sym="RB" tf="5" backgroundWarm={false} forceExtendedHours={false} />)
  await settle(() => candleRows() > 0)
  const before = view()
  // the lake's whole depth joins behind the view (what network.lakeSeed dispatches)
  // (join 'scroll': the history deepening's window, the store's SCROLL_BACK: the older rows plus the bar at the seam)
  const older = rowsOf('RB', '5').filter((b) => b.t <= M.store.peek(key).bars[0].t)
  await act(async () => { M.store.registry.dispatch(key, join === 'scroll'
    ? { type: M.ACTION.SCROLL_BACK, key, gen: M.store.peek(key).gen, payload: { bars: older } }
    : { type: M.ACTION.LAKE_HIT, key, payload: { sym: 'RB', bars: rowsOf('RB', '5') } }) })
  const joined = M.store.peek(key).bars.length
  await settle(() => candleRows() !== before.rows)
  const after = view()
  cleanup()
  M.store.registry.release(key)
  vi.unstubAllGlobals()
  return { before, after, held, joined, cover: M.COVER_ROWS, viewRows }
}

describe('a covering copy paints now; the lake join after it moves nothing on screen', () => {
  let r
  beforeAll(async () => {
    r = await run(1800)   // the server's newest raw rows (~9 sessions with extended hours: ~700 regular-session rows)
    console.log('[covering join]', JSON.stringify({ held: r.held, joined: r.joined, before: { ...r.before, onScreen: r.before.onScreen.length }, after: { ...r.after, onScreen: r.after.onScreen.length } }))
  }, 300_000)

  it('1. the same visible window (edges from the newest bar, times) and the same price scale on every series', () => {
    expect(r.before.rows).toBeGreaterThanOrEqual(r.cover)
    expect(r.viewRows).toBeGreaterThanOrEqual(r.cover)               // the switch reads it as covering
    expect(r.after.edge).toEqual(r.before.edge)
    expect(r.after.times).toBe(r.before.times)
    expect(r.after.scales).toBe(r.before.scales)
    if (r.after.onScreen !== r.before.onScreen) {
      const a = JSON.parse(r.before.onScreen); const b = JSON.parse(r.after.onScreen)
      const diffs = []
      a.forEach((sa, i) => { const sb = b[i]; sa.rows.forEach((ra, j) => { const rb = sb?.rows[j]; if (JSON.stringify(ra) !== JSON.stringify(rb) && diffs.length < 12) diffs.push({ series: i, kind: sa.kind, j, before: ra, after: rb }) }); if (sa.rows.length !== sb?.rows.length) diffs.push({ series: i, kind: sa.kind, lenBefore: sa.rows.length, lenAfter: sb?.rows.length }) })
      console.log('[on-screen diffs]', JSON.stringify(diffs))
    }
    expect(r.after.onScreen).toBe(r.before.onScreen)                // every value drawn on screen, every series
  })

  it('2. non-vacuous: the older rows joined, and the candle series holds more rows after it', () => {
    expect(r.joined).toBeGreaterThan(r.held)
    expect(r.after.rows).toBeGreaterThan(r.before.rows)
  })
})

// (review of #2871, MEDIUM) COVER_ROWS RAW rows of a key both sessions share are ~40% regular-session rows: on a
// regular-hours view that copy does NOT cover (the averages' lookback is short on the left of the screen), the lake's
// join then changes values on screen. So the switch must not read it as covering: `covers` counts the view's rows.
describe('control: COVER_ROWS raw rows with extended hours do not cover a regular-hours view', () => {
  let r
  beforeAll(async () => { r = await run(600) }, 300_000)

  it('the switch does not read it as covering (heldRows counts the regular-session rows of the view)', () => {
    expect(r.held).toBeGreaterThanOrEqual(r.cover)                     // raw rows: enough by the old count
    expect(r.viewRows).toBeLessThan(r.cover)                          // the view's rows: not enough
  })

  it('...and rightly: painted alone, the later lake join changes what is on screen', () => {
    expect(r.after.onScreen).not.toBe(r.before.onScreen)
  })
})

// (2026-11-27, coordinator ruling: the background deepening lands in idle time) WHEN it lands changes nothing on screen
// only if the deepening itself changes nothing on screen: the history window (SCROLL_BACK) joined behind a covering view.
describe('the history deepening (SCROLL_BACK) behind a covering view moves nothing on screen', () => {
  let r
  beforeAll(async () => { r = await run(1800, 'scroll') }, 300_000)

  it('the same visible window, the same price scale on every series, every on-screen value', () => {
    expect(r.viewRows).toBeGreaterThanOrEqual(r.cover)
    expect(r.after.edge).toEqual(r.before.edge)
    expect(r.after.times).toBe(r.before.times)
    expect(r.after.scales).toBe(r.before.scales)
    expect(r.after.onScreen).toBe(r.before.onScreen)
  })

  it('non-vacuous: the window joined (the store holds older rows, the series more rows)', () => {
    expect(r.joined).toBeGreaterThan(r.held)
    expect(r.after.rows).toBeGreaterThan(r.before.rows)
  })
})
