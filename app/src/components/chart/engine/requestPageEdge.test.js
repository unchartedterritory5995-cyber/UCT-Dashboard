// ─── ⭐⭐ (e90, the e88 live capture, 2026-11-20) — ANOTHER SERIES' OLDER BARS STILL COMING: A WAIT, NOT A HOLE ─────────
//
// ⚰️ CAPTURED (Fred RS "rs-rating-fred6724" on NYSE:RDDT 30m / 5m, engine 88, the runtime worker's own replies; the same
// reply on e81, e85 and e86): while the chart's rows grew past the depth SP:SPX was asked at (600 -> 3,002 on 30m), the run
// was handed SPX's FIRST page: 600 rows, filling its ask, beginning MID-SESSION (`/api/bars/SPX?tf=30&bars=600` began
// 09-16 15:00 ET; `tf=5` began 11-10 11:30 ET). The intraday grid lays that session's pre-market rows from the previous
// close, so the opening bars the page cut off lay after the series' first row and the run REFUSED the chart as a hole:
// "`SPX` has no bar on <09:30 ET>, after its history began". The deeper page (`bars=5000`: 780 / 4,680 rows, from a
// session's open) drew them on the next reply.
// THE RULING (coordinator, 2026-11-20), held here:
//   * a bar withheld BEFORE the first row of a page that filled its ask, on a chart holding more rows than that ask (it
//     asks deeper on its next render), is PENDING, with the run's own loading sentence (never the named "newest bars"
//     wait), and the same bar is DRAWN once the deeper page lands;
//   * a true hole on a full supply, a hole inside a partial page, a page that holds the store's whole depth (fewer rows
//     than it asked) and a chart that asks no deeper all keep today's refusal: the guard can still fire.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as registry from './nativeRegistry'
import {
  resetRuntimeSessions, resetRuntimeLedgers, runtimeColumnsFor, setRuntimeRunner,
} from './runtime/runtimeColumns'
import { runtimeRequestSupply, pageEdgeOf, REQUEST_GUARD } from './runtime/requestSupply'
import { buildRuntimeIr } from './ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from './runtime/lowerIr.js'
import { workerRunner, resetRuntimeAsync } from './runtime/runtimeAsync'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'
import { SERIES_PAGE_FILLED } from './otherSymbols'
import {
  BARS_ASK_MAX, cachedBars, clearSecondaryBars, fetchSecondaryBars, primeSecondaryBars, refreshSecondaryTail,
} from './secondaryBars'
import { HELD_SPAN_MAX } from './useSecondarySources'
import { resetRuntimeErrorNotices } from './runtimeErrorNotice'

vi.setConfig({ testTimeout: 300000 })

// ── the L12 witness grid (tailLag.test.js's): two sessions, D2 live at 13:50 ──
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const D1 = '2026-11-16'
const D2 = '2026-11-17'
const rthTimes = (day, step) => Array.from({ length: 390 / step }, (_, k) => ET(day, 9, 30) + k * step * 60)
const spxClose = (i) => Math.round((7300 + 10 * Math.sin(i / 7)) * 100) / 100
const NOW = ET(D2, 13, 50)                                  // the chart's newest bar: forming, in the session
// our SPX 5m rows of both sessions through 13:50 of D2: the store's whole depth here (131 rows, from D1's open)
const SPX_ALL = [...rthTimes(D1, 5), ...rthTimes(D2, 5)].filter((t) => t <= NOW)
  .map((t, i) => ({ t, o: spxClose(i) - 1, h: spxClose(i) + 2, l: spxClose(i) - 2, c: spxClose(i), v: 1e6 }))
// ⚰️ the captured shape: the FIRST page, its rows counted from the newest, beginning mid-session (D1 11:30)
const PAGE_FROM = ET(D1, 11, 30)
const PAGE = SPX_ALL.filter((b) => b.t >= PAGE_FROM)
const utcMid = (day) => Date.parse(`${day}T00:00:00Z`) / 1000
const SPX_D = [{ t: utcMid('2026-11-13'), o: 1, h: 1, l: 1, c: 7561.67, v: 1 }, { t: utcMid(D1), o: 1, h: 1, l: 1, c: 7416.59, v: 1 },
  { t: utcMid(D2), o: 1, h: 1, l: 1, c: 7340.53, v: 1 }]
const PRE = Array.from({ length: 18 }, (_, k) => ET(D2, 8, 0) + k * 300)
const LIVE_RTH = rthTimes(D2, 5).filter((t) => t <= NOW)
const bar = (t, i) => ({ t, o: 50 + i * 0.01, h: 50.5 + i * 0.01, l: 49.5 + i * 0.01, c: 50 + i * 0.01, v: 1000 })
// the chart: D1's whole regular session, D2's pre-market and its session so far (149 rows: more than the page's 107)
const CHART = [...rthTimes(D1, 5), ...PRE, ...LIVE_RTH].map(bar)
// a chart that trades in every OTHER slot of D1 (92 rows): it reaches the page's edge holding FEWER rows than the page
const SPARSE = [...rthTimes(D1, 5).filter((_, k) => k % 2 === 0), ...LIVE_RTH].map(bar)
const OPEN_D1 = ET(D1, 9, 30)
/** `rows` without `day`'s first four regular bars (09:30-09:45): that session's opening bars missing, a hole */
const withoutOpen = (rows, day) => rows.filter((b) => b.t < ET(day, 9, 30) || b.t > ET(day, 9, 45))

const secondaryOf = (intraday, askedBars) => new Map([
  ['SPX', { bars: intraday, status: 'available', newestBarIsForming: true,
    ...(askedBars === undefined ? {} : { askedBars }) }],
  ['SPX@D', { bars: SPX_D, status: 'available', newestBarIsForming: true }]])
const ctx5 = (secondary, over = {}) => ({ tf: '5', newestBarIsForming: true, historyFromListing: false,
  symbol: { ticker: 'AGL', exchange: 'NYSE', securityType: 'stock' }, secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over })
const pine = (lines) => ['//@version=5', 'indicator("pe", overlay = false)', ...lines].join('\n')
const SRC = pine(['plot(request.security("SP:SPX", timeframe.period, close))'])
const requestsOf = (src, rows) => {
  const built = buildRuntimeIr(src, { bars: rows, inputs: {}, tf: '5', basePeriod: '5', symbol: { ticker: 'AGL', exchange: 'NYSE' } })
  expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
  return lowerIrProgram(built.ir).requests
}
const supplyOf = (rows, intraday, askedBars, over = {}) =>
  runtimeRequestSupply(requestsOf(SRC, rows), rows, ctx5(secondaryOf(intraday, askedBars), over))

const HOLE = /`SPX` has no bar on (\d+), after its history began/
const LOADING = 'this script reads another symbol whose bars are still loading; it is drawn once they arrive'
const holeAt = (sup) => Number((sup.refusal && sup.refusal.message.match(HOLE) || [])[1])

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterEach(() => {
  setRuntimeRunner(null); resetRuntimeAsync(); setRunHalfObjectEvidence([]); setRuntimeKillList([])
  resetRuntimeSessions(); resetRuntimeLedgers(); clearSecondaryBars(); resetRuntimeErrorNotices()
  vi.unstubAllEnvs(); vi.unstubAllGlobals()
})

describe('the fixture is the captured shape', () => {
  it('the page fills its ask, begins mid-session, and the chart holds more rows than it', () => {
    expect(PAGE[0].t).toBe(PAGE_FROM)
    expect(PAGE.length).toBe(107)
    expect(CHART.length).toBeGreaterThan(PAGE.length)
    expect(CHART[0].t).toBe(OPEN_D1)
    expect(SPARSE.length).toBeLessThanOrEqual(PAGE.length)
    expect(SPARSE[0].t).toBe(OPEN_D1)
  })
})

describe('the supply: older bars still coming are a WAIT; every other gap keeps its rule', () => {
  it('⚰️ THE CAPTURED CASE: the first page filled its ask, the chart is deeper -> PENDING, unnamed (was: a hole at 09:30)', () => {
    const sup = supplyOf(CHART, PAGE, PAGE.length)
    expect(sup.refusal).toBeNull()
    expect(sup.pending).toBe(true)
    expect(sup.supply).toBeNull()
    expect(sup.waiting, 'the bind\'s loading wait, never the named "newest bars" one').toBeNull()
  })
  it('⚰️ REPRODUCED: the same page naming no ask (as every entry did before e90) is refused as a hole at the session\'s open', () => {
    const sup = supplyOf(CHART, PAGE)
    expect(sup.pending).toBe(false)
    expect(sup.refusal.guard).toBe(REQUEST_GUARD)
    expect(holeAt(sup)).toBe(OPEN_D1)
    expect(sup.refusal.knownFrom).toBeUndefined()
  })
  it('the deeper page lands -> the bar that waited is SUPPLIED, with SPX\'s own 09:30 bar', () => {
    const sup = supplyOf(CHART, SPX_ALL, 5000)
    expect(sup.refusal).toBeNull()
    expect(sup.pending).toBe(false)
    const s = sup.supply[0]
    expect(s.runBars[s.index[0]].t).toBe(OPEN_D1)
    expect(s.runBars[s.index[0]].c).toBe(SPX_ALL[0].c)
  })
  // ⚠️ THE HOLE THIS GRID HOLDS is a session missing its OPENING bars (tailLag.test.js's): a bar missing mid-session is
  // read at-or-before (the slot carries the bar before it, TradingView's witnessed reading), never withheld. ⚰️ This
  // rail's first draft dropped one mid-session bar, and both controls read no hole: the fixture's, not the product's.
  it('a bar missing mid-session is read at-or-before, never a hole (the grid\'s own reading)', () => {
    const sup = supplyOf(CHART, SPX_ALL.filter((b) => b.t !== ET(D1, 13, 0)), 5000)
    expect(sup.refusal).toBeNull()
    expect(sup.pending).toBe(false)
  })
  it('⛔ CONTROL: a true hole on a FULL supply (the store\'s whole depth) is still refused, with its sentence and no knownFrom', () => {
    const sup = supplyOf(CHART, withoutOpen(SPX_ALL, D2), 5000)
    expect(sup.pending).toBe(false)
    expect(sup.refusal.guard).toBe(REQUEST_GUARD)
    expect(holeAt(sup)).toBe(ET(D2, 9, 30))
    expect(sup.refusal.knownFrom).toBeUndefined()
  })
  it('⛔ CONTROL: a hole INSIDE a partial page is refused: a deeper page never fills it, and a wait never hides it', () => {
    const page = withoutOpen(PAGE, D2)
    const sup = supplyOf(CHART, page, page.length)
    expect(sup.pending).toBe(false)
    expect(holeAt(sup)).toBe(ET(D2, 9, 30))
  })
  it('⛔ CONTROL: a page that holds FEWER rows than it asked is the store\'s whole depth: today\'s rule (refused)', () => {
    // asked between the page's rows and the chart's, so only the fill test (not the chart's depth) can say "no deeper"
    const asked = PAGE.length + 13
    expect(CHART.length).toBeGreaterThan(asked)
    const sup = supplyOf(CHART, PAGE, asked)
    expect(sup.pending).toBe(false)
    expect(holeAt(sup)).toBe(OPEN_D1)
  })
  it('⛔ CONTROL: a chart that holds no more rows than the ask asks no deeper: today\'s rule, never a wait that cannot end', () => {
    const sup = supplyOf(SPARSE, PAGE, PAGE.length)
    expect(sup.pending).toBe(false)
    expect(holeAt(sup)).toBe(OPEN_D1)
  })
})

describe('pageEdgeOf: a deeper page is coming only where the chart asks deeper', () => {
  const pageOf = (asked) => {
    const s = []
    Object.defineProperty(s, SERIES_PAGE_FILLED, { value: { from: 1234, asked }, enumerable: false })
    return s
  }
  it('a chart deeper than the ask: the page\'s first row', () => {
    expect(pageEdgeOf(pageOf(600), 601)).toBe(1234)
  })
  it('a chart no deeper than the ask: none', () => {
    expect(pageEdgeOf(pageOf(600), 600)).toBeNull()
  })
  it(`⛔ an ask at /api/bars's ceiling (${BARS_ASK_MAX}) has no deeper page, however deep the chart`, () => {
    expect(pageEdgeOf(pageOf(BARS_ASK_MAX), BARS_ASK_MAX + 1)).toBeNull()
    expect(HELD_SPAN_MAX, 'the held-span ladder tops out at the same ceiling').toBe(BARS_ASK_MAX)
  })
  it('a series with no page fact (the store\'s whole depth, or no ask named): none', () => {
    expect(pageEdgeOf([], 10 ** 6)).toBeNull()
    expect(pageEdgeOf(null, 10 ** 6)).toBeNull()
  })
})

describe('the depth an entry asked: recorded by the cache, carried by the worker', () => {
  const answer = (rows) => async () => ({ bars: rows.map((b) => ({ ...b })) })
  it('a fetched window and a primed one record their ask; a tail merge keeps the held entry\'s', async () => {
    await fetchSecondaryBars('SPX', '5', 600, answer(PAGE))
    expect(cachedBars('SPX', '5', 600).askedBars).toBe(600)
    primeSecondaryBars('QQQ', '5', 2000, { bars: PAGE.slice(0, 5) })
    expect(cachedBars('QQQ', '5', 2000).askedBars).toBe(2000)
    const tail = PAGE.slice(-10).map((b, k) => (k === 9 ? { ...b, c: b.c + 1 } : b))
    expect(refreshSecondaryTail('SPX', '5', 600, answer(tail))).toBe(true)
    await vi.waitFor(() => expect(cachedBars('SPX', '5', 600).bars.at(-1).c).toBe(PAGE.at(-1).c + 1))
    expect(cachedBars('SPX', '5', 600).askedBars).toBe(600)
  })

  const SELF = { postMessage: (m) => SELF.out.push(m), out: [] }
  const def = { id: 'u_pe-rt', compute: { kind: 'runtime', fn: 'runtime:u_pe-rt', rev: 1, source: SRC, objects: false,
    outputs: { x: 0 } }, inputs: [], meta: { runtimeHistory: 'listing' } }
  it('⭐ THE REAL WORKER: the ask crosses with the entry, and the run there WAITS with the loading sentence', async () => {
    vi.stubGlobal('self', SELF)
    await import('./runtime/runtimeWorker.js')
    const queue = []
    let worker = null
    setRuntimeRunner(workerRunner(() => {
      worker = {
        postMessage(msg) { queue.push(structuredClone(msg)) },
        terminate() {},
      }
      return worker
    }))
    const ctx = ctx5(secondaryOf(PAGE, PAGE.length))
    registry.computeFor(def, CHART, {}, ctx)
    expect(queue.length, 'a run is in the worker').toBe(1)
    const handed = new Map(queue[0].ctx.secondaryEntries)
    expect(handed.get('SPX').askedBars, 'the ask crossed the worker').toBe(PAGE.length)
    SELF.out.length = 0
    SELF.onmessage({ data: queue[0] })
    const reply = structuredClone(SELF.out[0])
    worker.onmessage({ data: reply })
    const cols = registry.computeFor(def, CHART, {}, ctx)
    const stop = registry.runtimeRunStopOf(def, cols)
    expect(stop && stop.sentence).toContain(LOADING)
    expect(stop.sentence).not.toMatch(HOLE)
    expect(registry.runtimeRunWaitingOf(def, cols), 'unnamed: the strip\'s named wait speaks of newest bars').toBeNull()
  })
  it('in the thread too: the captured case says the loading sentence, and the deeper page draws the open', () => {
    const waiting = registry.computeFor(def, CHART, {}, ctx5(secondaryOf(PAGE, PAGE.length)))
    expect(registry.runtimeRunStopOf(def, waiting).sentence).toContain(LOADING)
    const drawn = registry.computeFor(def, CHART, {}, ctx5(secondaryOf(SPX_ALL, 5000)))
    expect(registry.runtimeRunStopOf(def, drawn)).toBeNull()
    expect(drawn.x[CHART.length - 1]).toBe(SPX_ALL.at(-1).c)
  })
})
