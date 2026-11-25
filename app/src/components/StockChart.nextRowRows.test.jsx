// ⭐ THE NEXT ROW, PREPARED, IS STILL THERE AT THE PRESS: A TWO-CHART BOARD ON THE REAL CHART (2026-11-25).
//
// The REAL StockChart twice (15-minute and 5-minute, regular hours only, rows that carry extended hours, so a row is
// two arrays: its rows and its regular-session rows) on the REAL library members run (testing/stockChartLibraryTrace.js),
// stepping down a list the way a member does: the rows around the selection are warmed (answered by the server), the
// list publishes them (neighborFrames.publishScanNeighbors), the charts prepare them in idle time (useNeighborFrames),
// then both charts switch to the next row. Run with derived arrays filed under their row (`linkDerivedSource`, the fix,
// with the shown and next rows held: `holdRow`) and without (the code before: every array its own entry of the
// SOURCES_KEPT bound, nothing held). Per step, for each chart:
//   1. the same final frame: what the library holds and shows (every series' rows and price range, the visible ranges)
//      and every canvas call of a full redraw;
//   2. non-vacuous: with the fix every switch of both charts took prepared values (`switchPrepared`); without it some
//      switches computed everything again (`switchUnprepared`): the next row of the chart prepared first was gone.
// Each step waits until both charts draw the step's name, then until nothing more reaches the library (no fixed sleeps).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'
import { installRecordingCanvas } from '../testing/stockChartLibraryTrace'
import { etUnix } from '../data/barStore/__fixtures__/seededSeries'

const S = vi.hoisted(() => ({ calls: [], n: 0, ids: new Map(), live: new Map(), chart: null, charts: [], rows: true }))
vi.mock('lightweight-charts', async () => (await import('../testing/stockChartLibraryTrace')).recordingLibrary(S))
// without the fix: a derived array is never filed under its row (each array is its own entry, as before), and no row
// is held against the bound (neighborFrames.holdRow, which came with the derived-bars budget: holding the next row
// alone would keep the switch prepared)
vi.mock('./chart/neighborFrames', async (orig) => {
  const real = await orig()
  return {
    ...real,
    linkDerivedSource: (child, parent) => (S.rows ? real.linkDerivedSource(child, parent) : undefined),
    holdRow: (owner, slot, src) => (S.rows ? real.holdRow(owner, slot, src) : undefined),
  }
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

// a Saturday: every session is closed, nothing forms
const clock = pinWallClock('2026-11-14T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

const LIST = ['RA', 'RB', 'RC', 'RD', 'RE', 'RF']
const TFS = ['15', '5']
const _rows = new Map()
/** `sym`'s `tf`-minute rows, 04:00 to 20:00 ET (extended hours included): 30 sessions of 15m, 10 of 5m. */
function rowsOf(sym, tf) {
  const id = `${sym}|${tf}`
  if (_rows.has(id)) return _rows.get(id)
  const k = LIST.indexOf(sym) + 1
  const step = Number(tf)
  const days = tf === '15' ? 30 : 10
  const dates = []
  for (let ms = Date.UTC(2026, 10, 13); dates.length < days; ms -= 86_400_000) {
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
/** The newest regular-session close (what a regular-session chart draws last). */
const lastRthClose = (sym, tf) => {
  const rows = rowsOf(sym, tf)
  const lastDay = etUnix('2026-11-13', 570)
  const rth = rows.filter((r) => r.t >= lastDay && r.t < etUnix('2026-11-13', 960))
  return rth[rth.length - 1].c
}

async function run(rows) {
  S.rows = rows
  S.calls = []
  S.n = 0
  S.ids = new Map()
  S.live = new Map()
  S.chart = null
  S.charts = []
  // a browser with a real idle signal (jsdom has none; without one nothing is prepared: neighborFrames.idleSupported)
  vi.stubGlobal('requestIdleCallback', (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 5))
  vi.stubGlobal('cancelIdleCallback', (h) => clearTimeout(h))
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
    const m = /\/api\/bars\/([A-Z]+)\?tf=(\d+)/.exec(u)
    if (m && LIST.includes(m[1]) && TFS.includes(m[2])) {
      return Promise.resolve(json({ ticker: m[1], tf: m[2], bars: rowsOf(m[1], m[2]), newest_bar_is_forming: false }))
    }
    return Promise.resolve(json({}))
  }))
  const M = await loadWithBarStore(true, async () => ({
    StockChart: (await import('./StockChart')).default,
    nf: await import('./chart/neighborFrames'),
    store: (await import('../data/barStore/index')).getBarStore(),
    chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
  }))
  M.nf.__setNeighborFramesForTests(true)
  M.nf.__resetNeighborFramesStatsForTests()
  M.nf.__resetDerivedForTests()
  const rec = installRecordingCanvas()
  const held = new Set()
  const hold = async (sym) => {
    for (const tf of TFS) {
      const key = M.chartKeyFor({ sym, resolvedTf: tf, showExtended: false, replayCutoff: null, hasOverride: false })
      if (held.has(key)) continue
      M.store.registry.acquire(key)
      held.add(key)
      await act(async () => { await M.store.ensure(key, { priority: 'urgent' }) })
    }
  }
  const candleOf = (chart) => [...S.live.values()].find((x) => x.chart === chart && x.kind === 'candle')
  async function settle(sym) {
    const t0 = performance.now()
    const drawn = () => S.charts.length >= 2 && S.charts.slice(-2).every((ch, j) => {
      const c = candleOf(ch)
      const d = c ? c.s.data() : []
      return d.length > 0 && d[d.length - 1].close === lastRthClose(sym, TFS[j])
    })
    while (!drawn()) {
      if (performance.now() - t0 > 30_000) throw new Error(`${sym} was never drawn on both charts`)
      await wait(20)
    }
    let n = S.calls.length
    let quiet = 0
    while (quiet < 3) {
      await wait(50)
      if (S.calls.length === n) quiet += 1
      else { n = S.calls.length; quiet = 0 }
      if (performance.now() - t0 > 40_000) throw new Error(`${sym} never settled`)
    }
  }
  async function prepared(before) {
    const t0 = performance.now()
    // both charts prepared the three rows around the selection, and the idle queue is empty
    while (M.nf.neighborFramesStats().barsPrepared - before < 6 || M.nf.__idleQueueLength() > 0) {
      if (performance.now() - t0 > 30_000) throw new Error('the rows around the selection were never prepared')
      await wait(20)
    }
    await wait(30)
  }
  const shot = (sym) => ({
    sym,
    charts: S.charts.slice(-2).map((ch) => {
      const ts = ch.timeScale()
      const series = [...S.live.entries()].filter(([, x]) => x.chart === ch).map(([id, { s, kind }]) => {
        let scale = null
        try { scale = s.priceScale().getVisibleRange() } catch { scale = 'n/a' }
        return { id, kind, rows: s.data(), scale }
      })
      return { state: JSON.stringify({ range: ts.getVisibleLogicalRange(), times: ts.getVisibleRange(), series }), drawing: rec.drawingOf(ch) }
    }),
  })
  const board = (sym) => (
    <div>
      <M.StockChart sym={sym} tf="15" backgroundWarm={false} forceExtendedHours={false} />
      <M.StockChart sym={sym} tf="5" backgroundWarm={false} forceExtendedHours={false} />
    </div>
  )
  const steps = []
  let at = 1
  await hold(LIST[at])
  const view = render(board(LIST[at]))
  await settle(LIST[at])
  steps.push(shot(LIST[at]))
  for (; at < 4; at++) {
    for (const s of [LIST[at + 1], LIST[at - 1], LIST[at + 2]]) await hold(s)
    const before = M.nf.neighborFramesStats().barsPrepared
    M.nf.publishScanNeighbors(LIST[at], [LIST[at + 1], LIST[at + 2]], [LIST[at - 1]])
    await prepared(before)
    view.rerender(board(LIST[at + 1]))
    await settle(LIST[at + 1])
    steps.push(shot(LIST[at + 1]))
  }
  const stats = JSON.parse(JSON.stringify(M.nf.neighborFramesStats()))
  cleanup()
  for (const key of held) M.store.registry.release(key)
  M.nf.__setNeighborFramesForTests(null)
  vi.unstubAllGlobals()
  return { steps, stats, charts: S.charts.length }
}

describe('the next row, prepared, is still there at the press (two charts, rows filed as rows)', () => {
  let before
  let after
  beforeAll(async () => {
    before = await run(false)
    after = await run(true)
    // eslint-disable-next-line no-console
    console.log('[next row prepared] switches before:', JSON.stringify(before.stats.switches), 'after:', JSON.stringify(after.stats.switches))
  }, 300_000)

  it('1. every step, both charts: the same library state and the same drawing', () => {
    expect(after.charts).toBe(2)
    expect(after.steps.map((s) => s.sym)).toEqual(['RB', 'RC', 'RD', 'RE'])
    expect(before.steps.map((s) => s.sym)).toEqual(['RB', 'RC', 'RD', 'RE'])
    after.steps.forEach((a, i) => {
      a.charts.forEach((ca, j) => {
        const cb = before.steps[i].charts[j]
        const label = `${a.sym} ${TFS[j]}m`
        expect(ca.drawing.length, label).toBeGreaterThan(300)
        expect(ca.state, label).toBe(cb.state)
        const diff = ca.drawing.findIndex((x, k) => x !== cb.drawing[k])
        if (diff >= 0 || ca.drawing.length !== cb.drawing.length) throw new Error(`${label}: the drawings differ at call ${diff}: ${ca.drawing[diff]} vs ${cb.drawing[diff]}`)
      })
    })
  })

  it('2. every press, both charts, took what was prepared; before, presses computed everything again', () => {
    // the switch log (`SYM:tf:P|U:h<hits>:m<misses>:<ms>`): the first two entries are the mount (RB), then the presses
    const presses = (r) => r.stats.switches.filter((e) => !e.startsWith('RB:'))
    expect(presses(after)).toHaveLength(6)
    expect(presses(after).every((e) => /^R[CDE]:(15|5):P:/.test(e)), JSON.stringify(after.stats.switches)).toBe(true)
    expect(presses(before)).toHaveLength(6)
    expect(presses(before).some((e) => /:U:/.test(e)), JSON.stringify(before.stats.switches)).toBe(true)
  })
})
