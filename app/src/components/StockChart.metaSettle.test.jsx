// ⭐ A METADATA ANSWER SETTLES ONLY THE BOARD ITS BARS ARE PAINTED ON (2026-11-24, next-row switch).
//
// The REAL StockChart on the REAL library members run (testing/stockChartLibraryTrace.js), during the session, stepping
// through a list on the 1-minute, 15-minute and 30-minute boards with the next name's bars already in memory. Each
// list step from a deeper name to a shallower one is where it went wrong: the metadata feed publishes in its layout
// effect, ahead of the switch's own `updateChart`, and `settleOnMetaLanded` re-asserted the INCOMING name's settling
// frame (its newest bar's index) on the chart that still held the OUTGOING board, where that index is hundreds of bars
// back. The render window reached left for it and re-set the whole outgoing board before the switch replaced it.
// `chart/metaSettleGuard.js` lets the settle run only when the chart's series hold exactly the bars it frames.
//
// Each step runs twice, on master's behaviour (the guard answering yes to everything, which is what the settle did) and
// with the guard, and the rails are:
//   1. with the guard, a switch hands the library only the incoming board: the candles are set once, by the switch's
//      own pass, and nothing the settle or a window extension does;
//   2. nothing frames the incoming bars on the outgoing board: no settle frame before the step's candles are set;
//   3. the FINAL state after every step is the same as master's: every series' rows as the library holds them, the
//      visible logical and time ranges, every series' price-scale range;
//   4. the counts per step, both ways (the table also goes to remote-out/meta-settle.json on the remote lane).
// What the settle exists for, an answer landing AFTER the switch's paint while the switch still settles, re-asserting
// the frame over a camera move that was not the member's, is dailyFirstPaintAcceptance.test.jsx's SETTLING case (and
// the NEGATIVE CONTROL of its range-button block): a guard that refused the painted board would turn those red. (A
// list switch with its bars in memory has released the settling by the time an answer lands after its paint: the
// count stopped changing on its own pass, so there is nothing left to re-assert in this file's world.)
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'
import { loadChartLibraryBuilds } from '../testing/chartLibraryBuilds'
import { libraryState, replayLibraryWork } from '../testing/stockChartLibraryTrace'

const S = vi.hoisted(() => ({ calls: [], n: 0, ids: new Map(), live: new Map(), chart: null, master: false, states: [] }))
vi.mock('lightweight-charts', async () => (await import('../testing/stockChartLibraryTrace')).recordingLibrary(S))
// master's behaviour: the settle ran on whatever board the chart held
vi.mock('./chart/metaSettleGuard', async (orig) => {
  const real = await orig()
  return { ...real, settleBoardReady: (painted, bars) => (S.master ? true : real.settleBoardReady(painted, bars)) }
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

// Tuesday 2026-11-17, 11:00:30 ET: the session is open, the 11:00 buckets are forming
const clock = pinWallClock('2026-11-17T16:00:30Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

/** `n` RTH buckets of `step` minutes (unix s), the newest the one forming now (11:00 ET = 16:00Z). */
function rthRows(n, step, k) {
  const out = []
  for (let t = Date.UTC(2026, 10, 17, 16, 0) / 1000; out.length < n; t -= step * 60) {
    const d = new Date(t * 1000)
    const m = d.getUTCHours() * 60 + d.getUTCMinutes()
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && m >= 14 * 60 + 30 && m < 21 * 60) out.push(t)
  }
  return out.reverse().map((t, i) => {
    const c = 40 * k + Math.sin(i / 11) * 6 * k + i * 0.001
    return { t, o: c - 0.5, h: c + 1.5, l: c - 1.7, c, v: 1e5 + ((i * 7919 * k) % 50000) }
  })
}
const BARS = {
  'AAA|30': rthRows(5200, 30, 1), 'BBB|30': rthRows(3900, 30, 2), 'CCC|30': rthRows(4500, 30, 3),
  'AAA|1': rthRows(3000, 1, 1), 'BBB|1': rthRows(2000, 1, 2),
  'AAA|15': rthRows(2600, 15, 1), 'BBB|15': rthRows(1800, 15, 2),
}
const STEPS = [
  ['AAA 30m -> AAA 1m (a timeframe change)', 'AAA', '1'],
  ['AAA 1m -> BBB 1m (3,000 -> 2,000 bars)', 'BBB', '1'],
  ['BBB 1m -> AAA 15m (a timeframe change)', 'AAA', '15'],
  ['AAA 15m -> BBB 15m (2,600 -> 1,800 bars)', 'BBB', '15'],
  ['BBB 15m -> AAA 30m (a timeframe change)', 'AAA', '30'],
  ['AAA 30m -> BBB 30m (5,200 -> 3,900 bars)', 'BBB', '30'],
  ['BBB 30m -> CCC 30m (3,900 -> 4,500 bars: the incoming name is deeper)', 'CCC', '30'],
]
const LIST_SWITCHES = [STEPS[1][0], STEPS[3][0], STEPS[5][0]]
const DEEPER = STEPS[6][0]

/** Mount AAA 30m, take every step; per step the final library state. `master`: the settle as it was. */
async function run(master) {
  S.master = master
  S.calls = []
  S.n = 0
  S.ids = new Map()
  S.live = new Map()
  S.chart = null
  const states = {}
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
    const m = /\/api\/bars\/([A-Z]+)\?tf=([A-Z0-9]+)/.exec(u)
    if (m && BARS[`${m[1]}|${m[2]}`]) {
      return Promise.resolve(json({ ticker: m[1], tf: m[2], bars: BARS[`${m[1]}|${m[2]}`], newest_bar_is_forming: true }))
    }
    return Promise.resolve(json({}))
  }))
  const M = await loadWithBarStore(true, async () => ({
    StockChart: (await import('./StockChart')).default,
    store: (await import('../data/barStore/index')).getBarStore(),
    chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
  }))
  const held = []
  const hold = async (sym, tf) => {
    const key = M.chartKeyFor({ sym, resolvedTf: tf, showExtended: false, replayCutoff: null, hasOverride: false })
    M.store.registry.acquire(key)
    held.push(key)
    await act(async () => { await M.store.ensure(key, { priority: 'urgent' }) })
  }
  const chartOf = (sym, tf) => <M.StockChart sym={sym} tf={tf} backgroundWarm={false} />
  S.calls.push({ m: 'mark', label: 'load AAA 30m' })
  const view = render(chartOf('AAA', '30'))
  await wait(1500)
  states['load AAA 30m'] = libraryState(S)
  for (const [label, sym, tf] of STEPS) {
    await hold(sym, tf)
    await wait(200)
    S.calls.push({ m: 'mark', label })
    view.rerender(chartOf(sym, tf))
    await wait(1000)
    states[label] = libraryState(S)
  }
  S.calls.push({ m: 'mark', label: 'unmount' })
  cleanup()
  for (const key of held) M.store.registry.release(key)
  vi.unstubAllGlobals()
  return { calls: S.calls.slice(), states }
}

const stepCalls = (calls, label) => {
  const i = calls.findIndex((c) => c.m === 'mark' && c.label === label)
  const j = calls.findIndex((c, k) => k > i && c.m === 'mark')
  return calls.slice(i + 1, j < 0 ? undefined : j)
}

describe('a metadata answer settles only the board its bars are painted on', () => {
  let master
  let fixed
  let counts
  beforeAll(async () => {
    master = await run(true)
    fixed = await run(false)
    const { patched } = await loadChartLibraryBuilds()
    counts = { master: replayLibraryWork(patched, master.calls), fixed: replayLibraryWork(patched, fixed.calls) }
    const table = counts.fixed.map((f, i) => ({
      step: f.label,
      master: { setData: counts.master[i].calls, full: counts.master[i].full, sorts: counts.master[i].sorts, log: counts.master[i].log },
      fixed: { setData: f.calls, full: f.full, sorts: f.sorts, log: f.log },
    }))
    // eslint-disable-next-line no-console
    console.log('[meta settle]\n' + table.map((r) => `${r.step}: master ${r.master.setData}/${r.master.full} fixed ${r.fixed.setData}/${r.fixed.full}`).join('\n'))
    if (process.env.GITHUB_WORKFLOW === 'remote tests') {
      const dir = path.resolve(process.cwd(), '..', 'remote-out')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'meta-settle.json'), JSON.stringify({ table }, null, 1))
    }
  }, 240_000)

  it('CONTROL: on master\'s behaviour each list switch first re-sets the OUTGOING board from the settle', () => {
    for (const label of LIST_SWITCHES) {
      const first = stepCalls(master.calls, label).find((c) => c.m === 'setData' && c.from != null)
      expect(first.from, label).toContain('settleOnMetaLanded')
    }
  })

  it('1. with the guard, a list switch hands the library only the incoming board, set once by the switch', () => {
    for (const label of LIST_SWITCHES) {
      const candles = stepCalls(fixed.calls, label).filter((c) => c.m === 'setData' && c.from != null)
      expect(candles.length, label).toBe(1)
      expect(candles[0].from, label).not.toMatch(/settleOnMetaLanded|extendTo/)
      const step = counts.fixed.find((s) => s.label === label)
      expect(step.calls, label).toBe(6)
    }
  })

  // the switch's own candles: set by its pass, not by a settle or a window extension
  const switchCandles = (calls) => calls.findIndex((c) => c.m === 'setData' && c.from != null && !/settleOnMetaLanded|extendTo/.test(c.from))
  it('2. nothing frames the incoming bars on the outgoing board (CONTROL: master did, on every one of these steps)', () => {
    for (const label of [...LIST_SWITCHES, DEEPER]) {
      const before = (r) => stepCalls(r.calls, label).slice(0, switchCandles(stepCalls(r.calls, label)))
        .filter((c) => c.m === 'frame' || c.m === 'setData').map((c) => `${c.m} ${c.from}`)
      expect(before(master).some((x) => /settleOnMetaLanded/.test(x)), `${label} (master)`).toBe(true)
      expect(before(fixed), label).toEqual([])
    }
  })

  it('3. the final state after every step is master\'s: rows held, visible ranges, price-scale ranges', () => {
    expect(Object.keys(fixed.states)).toEqual(Object.keys(master.states))
    // CONTROL: the state tells pictures apart (every step's differs from every other step's)
    expect(new Set(Object.values(master.states)).size).toBe(Object.keys(master.states).length)
    for (const k of Object.keys(master.states)) {
      expect(fixed.states[k].length, k).toBeGreaterThan(1000)
      if (fixed.states[k] !== master.states[k]) throw new Error(`the state after "${k}" differs from master's`)
    }
  })

  it('4. the counts per step (pinned): setData calls and FULL updates, master -> with the guard', () => {
    const got = Object.fromEntries(counts.fixed.filter((s) => s.label !== 'unmount')
      .map((f, i) => [f.label, `${counts.master[i].calls}/${counts.master[i].full} -> ${f.calls}/${f.full}`]))
    expect(got).toEqual({
      'load AAA 30m': '6/1 -> 6/1',
      [STEPS[0][0]]: '7/3 -> 7/3',
      // the two 1m windows hold the same 750 minutes (both index steps leave 750 rows): no FULL update at all
      [STEPS[1][0]]: '13/2 -> 6/0',
      [STEPS[2][0]]: '7/3 -> 7/3',
      [STEPS[3][0]]: '13/2 -> 6/1',
      [STEPS[4][0]]: '7/3 -> 7/3',
      [STEPS[5][0]]: '13/2 -> 6/1',
      [STEPS[6][0]]: '6/1 -> 6/1',
    })
  })
})
