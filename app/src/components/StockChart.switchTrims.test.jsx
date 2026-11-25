// ⭐ THE NEXT-ROW KEY-TASK TRIMS ON THE REAL CHART: THE SAME FINAL FRAME (2026-11-25).
//
// The REAL StockChart on the REAL library members run (testing/stockChartLibraryTrace.js), on the default daily board,
// stepping through a list the way a member does: before each switch the next name is warmed (the server has answered it,
// its saved copy is in the memory cache), then the chart switches to it. Run with each trim on, and with it off (the
// code before it), and per step compare what the library holds and shows (every series' rows, price ranges, visible
// ranges: `libraryState`) and every canvas call of a full redraw (`drawingOf`). Each step waits until the step's name is
// drawn, then until nothing more reaches the library (no fixed sleeps).
//   (2) a saved copy that provably changes nothing is not decoded in the switch's task (persist.hydrateMem,
//       reducer.localCopyAddsNothing): the same final frame on every step, and the trim really ran (the switches'
//       subscribes dispatched the copy EMPTY with it on, the whole copy with it off).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'
import { installRecordingCanvas, libraryState } from '../testing/stockChartLibraryTrace'

const S = vi.hoisted(() => ({ calls: [], n: 0, ids: new Map(), live: new Map(), chart: null, memNoop: true }))
vi.mock('lightweight-charts', async () => (await import('../testing/stockChartLibraryTrace')).recordingLibrary(S))
// (2) off = the code before it: the predicate never clears a copy, so every copy is decoded and dispatched whole
vi.mock('../data/barStore/reducer', async (orig) => {
  const real = await orig()
  return { ...real, localCopyAddsNothing: (s, raw) => (S.memNoop ? real.localCopyAddsNothing(s, raw) : false) }
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
const BARS = { AAA: dailyRows(8003, 1), BBB: dailyRows(6512, 2), CCC: dailyRows(7104, 3), DDD: dailyRows(1200, 4) }
const STEPS = ['BBB', 'CCC', 'AAA', 'DDD', 'BBB']

/** Until the candles show `sym`'s newest close, then until nothing more reaches the library for 3 slices of 50 ms. */
async function settle(sym) {
  const last = BARS[sym][BARS[sym].length - 1].c
  const t0 = performance.now()
  const drawn = () => [...S.live.values()].some(({ s, kind }) => {
    if (kind !== 'candle') return false
    const d = s.data()
    return d.length > 0 && d[d.length - 1].close === last
  })
  while (!drawn()) {
    if (performance.now() - t0 > 20_000) throw new Error(`${sym} was never drawn`)
    await wait(20)
  }
  let n = S.calls.length
  let quiet = 0
  while (quiet < 3) {
    await wait(50)
    if (S.calls.length === n) quiet += 1
    else { n = S.calls.length; quiet = 0 }
    if (performance.now() - t0 > 30_000) throw new Error(`${sym} never settled`)
  }
}

async function run(mode) {
  Object.assign(S, mode)
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
    mem: await import('../utils/barsMemCache'),
  }))
  const rec = installRecordingCanvas()
  // every mem hit the store dispatches, and how many rows it carried
  const memHits = []
  const dispatch = M.store.registry.dispatch
  M.store.registry.dispatch = (key, action, extra) => {
    if (action && action.type === 'mem-hit') memHits.push({ key, rows: action.payload?.bars?.length ?? 0, label: S.label })
    return dispatch(key, action, extra)
  }
  const held = []
  const hold = async (sym) => {
    const key = M.chartKeyFor({ sym, resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
    M.mem.memPutMonotonic(sym, 'D', BARS[sym], { savedAt: Date.now() - 60_000 })   // its saved copy, in the memory cache
    M.store.registry.acquire(key)
    held.push(key)
    await act(async () => { await M.store.ensure(key, { priority: 'urgent' }) })
  }
  const steps = []
  const shot = (sym) => steps.push({ sym, state: libraryState(S), drawing: rec.drawingOf(S.chart) })
  const chartOf = (sym) => <M.StockChart sym={sym} tf="D" backgroundWarm={false} />
  await hold('AAA')
  S.label = 'AAA'
  const view = render(chartOf('AAA'))
  await settle('AAA')
  shot('AAA')
  for (const sym of STEPS) {
    await hold(sym)
    S.label = sym
    view.rerender(chartOf(sym))
    await settle(sym)
    shot(sym)
  }
  cleanup()
  for (const key of held) M.store.registry.release(key)
  vi.unstubAllGlobals()
  return { steps, memHits }
}

describe('the next-row key-task trims on the real chart: the same final frame', () => {
  let off
  let on
  beforeAll(async () => {
    off = await run({ memNoop: false })
    on = await run({ memNoop: true })
  }, 300_000)

  it('(2) every step: the same library state and the same drawing, with the saved copy decoded or not', () => {
    expect(on.steps.map((s) => s.sym)).toEqual(['AAA', ...STEPS])
    expect(off.steps.map((s) => s.sym)).toEqual(['AAA', ...STEPS])
    on.steps.forEach((a, i) => {
      const b = off.steps[i]
      expect(a.drawing.length, a.sym).toBeGreaterThan(500)          // a real drawing (non-vacuity)
      expect(a.state, a.sym).toBe(b.state)
      const diff = a.drawing.findIndex((x, k) => x !== b.drawing[k])
      if (diff >= 0 || a.drawing.length !== b.drawing.length) throw new Error(`${a.sym}: the drawings differ at call ${diff}: ${a.drawing[diff]} vs ${b.drawing[diff]}`)
    })
  })

  it('(2) ...and the trim really ran: each switch\'s subscribe dispatched its saved copy EMPTY with it on, WHOLE with it off', () => {
    const atSwitch = (r) => r.memHits.filter((h) => STEPS.includes(h.label) && h.key.includes(`${h.label}_`))
    const onHits = atSwitch(on)
    const offHits = atSwitch(off)
    // eslint-disable-next-line no-console
    console.log('[switch trims (2)] mem hits at the switches, on:', JSON.stringify(onHits), 'off:', JSON.stringify(offHits))
    expect(onHits.length).toBeGreaterThanOrEqual(STEPS.length)
    expect(onHits.every((h) => h.rows === 0)).toBe(true)
    expect(offHits.length).toBe(onHits.length)
    expect(offHits.every((h) => h.rows > 0)).toBe(true)
  })
})
