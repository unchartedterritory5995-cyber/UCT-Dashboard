// ⭐ THE DATE-ANCHORED WINDOW START ON THE REAL CHART: THE SAME PICTURE, FEWER LIBRARY REBUILDS (2026-11-24).
//
// The REAL StockChart on the REAL library members run (testing/stockChartLibraryTrace.js), on the default daily board,
// stepping through a list of names that show the same recent sessions with different history depths, the next name's
// bars already in memory. Run twice: with each load's window starting on the 250-row index step (`anchor: 'index'`,
// how it started before) and on the first session of a calendar month (`renderWindowStartFor`, chart/windowedChart.js).
// Per step:
//   1. what is drawn is identical: every canvas call of a full redraw (method and arguments to 1e-4 of a pixel, every
//      colour and font), the visible time range, every series' rows in view, every series' price-scale range;
//   2. the library holds a different number of bars on some steps (or the anchors would not differ);
//   3. FULL updates (every series re-set in the library's model, the time scale's points and tick marks redone):
//      a switch between two names deep enough for a window makes one on the index step and none on the date anchor.
// (chart/windowAnchor.test.js proves the same on the facade alone, and scrolls left through history.)
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'
import { loadChartLibraryBuilds } from '../testing/chartLibraryBuilds'
import { installRecordingCanvas, replayLibraryWork } from '../testing/stockChartLibraryTrace'

const S = vi.hoisted(() => ({ calls: [], n: 0, ids: new Map(), live: new Map(), chart: null, anchor: 'date' }))
vi.mock('lightweight-charts', async () => (await import('../testing/stockChartLibraryTrace')).recordingLibrary(S))
vi.mock('./chart/windowedChart', async (orig) => {
  const real = await orig()
  return { ...real, createWindowedChart: (chart, o) => real.createWindowedChart(chart, { ...(o || {}), anchor: S.anchor }) }
})
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

// a Saturday: the newest daily bars are settled and nothing forms
const clock = pinWallClock('2026-11-14T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

const DAY = 86_400_000
function dailyRows(n, k) {
  const out = []
  for (let ms = Date.UTC(2026, 10, 13); out.length < n; ms -= DAY) {
    const wd = new Date(ms).getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(new Date(ms).toISOString().slice(0, 10))
  }
  return out.reverse().map((t, i) => {
    const c = 40 * k + Math.sin(i / 11) * 6 * k + i * 0.001
    return { t, o: c - 0.5, h: c + 1.5, l: c - 1.7, c, v: 1e6 + ((i * 7919 * k) % 500000) }
  })
}
const BARS = { AAA: dailyRows(8003, 1), BBB: dailyRows(6512, 2), CCC: dailyRows(7104, 3), DDD: dailyRows(1200, 4), EEE: dailyRows(6512, 5) }
const STEPS = ['BBB', 'CCC', 'DDD', 'AAA', 'EEE', 'BBB']

async function run(anchor) {
  S.anchor = anchor
  S.calls = []
  S.n = 0
  S.ids = new Map()
  S.live = new Map()
  S.chart = null
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
    const m = /\/api\/bars\/([A-Z]+)\?tf=D/.exec(u)
    if (m && BARS[m[1]]) return Promise.resolve(json({ ticker: m[1], tf: 'D', bars: BARS[m[1]], newest_bar_is_forming: false }))
    return Promise.resolve(json({}))
  }))
  const M = await loadWithBarStore(true, async () => ({
    StockChart: (await import('./StockChart')).default,
    store: (await import('../data/barStore/index')).getBarStore(),
    chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
  }))
  const rec = installRecordingCanvas()   // after the library's own stub: every paint from here on can be recorded
  const held = []
  const hold = async (sym) => {
    const key = M.chartKeyFor({ sym, resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
    M.store.registry.acquire(key)
    held.push(key)
    await act(async () => { await M.store.ensure(key, { priority: 'urgent' }) })
  }
  const pics = []
  const picture = (sym) => {
    const ts = S.chart.timeScale()
    const times = ts.getVisibleRange()
    const inView = (rows) => rows.filter((r) => times && r.time >= times.from && r.time <= times.to)
    const series = [...S.live.values()].map(({ s, kind }) => {
      const v = s.priceScale().getVisibleRange()
      return { kind, rows: JSON.stringify(inView(s.data())), scale: v ? [rec.r4(v.from), rec.r4(v.to)] : null }
    })
    const candles = [...S.live.values()].find((x) => x.kind === 'candle')
    pics.push({ sym, times, series, drawing: rec.drawingOf(S.chart), held: candles ? candles.s.data().length : 0 })
  }
  const chartOf = (sym) => <M.StockChart sym={sym} tf="D" backgroundWarm={false} />
  S.calls.push({ m: 'mark', label: 'AAA' })
  const view = render(chartOf('AAA'))
  await wait(1500)
  picture('AAA')
  for (const sym of STEPS) {
    await hold(sym)
    await wait(200)
    S.calls.push({ m: 'mark', label: sym })
    view.rerender(chartOf(sym))
    await wait(1000)
    picture(sym)
  }
  S.calls.push({ m: 'mark', label: 'unmount' })
  cleanup()
  for (const key of held) M.store.registry.release(key)
  vi.unstubAllGlobals()
  return { calls: S.calls.slice(), pics }
}

describe('the date-anchored window start on the real chart: the same picture, fewer library rebuilds', () => {
  let byIndex
  let byDate
  let work
  beforeAll(async () => {
    byIndex = await run('index')
    byDate = await run('date')
    const { patched } = await loadChartLibraryBuilds()
    work = { index: replayLibraryWork(patched, byIndex.calls), date: replayLibraryWork(patched, byDate.calls) }
    // eslint-disable-next-line no-console
    console.log('[window anchor, real chart]\n' + byIndex.pics.map((p, i) => `${p.sym}: held ${p.held} / ${byDate.pics[i].held}, FULL ${work.index[i].full} / ${work.date[i].full}, drawing calls ${p.drawing.length}`).join('\n'))
  }, 240_000)

  it('1. every step draws the same picture (canvas calls, visible times, rows in view, price scales)', () => {
    expect(byDate.pics.map((p) => p.sym)).toEqual(byIndex.pics.map((p) => p.sym))
    byIndex.pics.forEach((a, i) => {
      const b = byDate.pics[i]
      expect(a.drawing.length, a.sym).toBeGreaterThan(500)             // a real drawing (non-vacuity)
      expect(a.series.some((s) => s.kind === 'candle' && s.rows.length > 1000), a.sym).toBe(true)
      expect(b.times, a.sym).toEqual(a.times)
      expect(b.series, a.sym).toEqual(a.series)
      const diff = a.drawing.findIndex((x, k) => x !== b.drawing[k])
      if (diff >= 0 || a.drawing.length !== b.drawing.length) throw new Error(`${a.sym}: the drawings differ at call ${diff}: ${a.drawing[diff]} vs ${b.drawing[diff]}`)
    })
  })

  it('2. while the library holds a different number of bars on some steps', () => {
    expect(byIndex.pics.some((p, i) => p.held !== byDate.pics[i].held)).toBe(true)
  })

  it('3. FULL updates per step, index step -> date anchor (pinned)', () => {
    const got = work.index.filter((s) => s.label !== 'unmount').map((s, i) => `${s.label} ${s.full} -> ${work.date[i].full}`)
    expect(got).toEqual([
      'AAA 1 -> 1',    // the first load (the future-axis line is not set yet)
      'BBB 2 -> 1',    // the future-axis line's first set, then the window's first date moved (index step only)
      'CCC 1 -> 0',
      'DDD 1 -> 1',    // 1,200 bars: no window, both
      'AAA 1 -> 1',    // back to a window, both
      'EEE 1 -> 0',
      'BBB 0 -> 0',    // the same depth as EEE
    ])
  })
})
