// ─── ⭐⭐ THE OVERNIGHT TAIL IS CUT, NEVER WAITED FOR (coordinator ruling 2026-11-20, (ii) + (iii)) ────────────────
//
// ⚰️ MEASURED on production e87 (02:17Z, Fred RS on NYSE:RDDT, smoke@): the 30m chart's newest bar was 21:00 ET and the
// 5m chart's 21:15 ET. These were overnight bars built in the browser from live overnight trades (`/api/bars/RDDT?tf=5`
// has none: 0 of 202 days). Our SP:SPX supply ended at 19:30 / 19:55 ET. The run REFUSED the whole chart on 5m / 30m
// (`runtime:request-lag`) and waited on 1h, saying SPX's bars "have not arrived ... until they arrive", which they
// never do. THE RULE, held here:
//   * every chart bar past the series' last held bar is an overnight bar (outside 04:00-20:00 ET, or a closed day):
//     the run is CUT at the first of them (`cutAt`); everything before draws exactly as the same run over those bars
//     does, and the overnight bars are withheld BY NAME on the strip;
//   * ⛔ a bar INSIDE 04:00-20:00 that the series lacks is NEVER overnight: #2076's wait / lag rule keeps it, a mixed
//     tail included;
//   * the curtain (an off-listing run) cuts at the tail too, and never refuses the whole run.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as registry from './nativeRegistry'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeColumnsFor, setRuntimeRunner,
  __overnightCutOffForTests,
} from './runtime/runtimeColumns'
import { runtimeRequestSupply, REQUEST_GUARD, REQUEST_LAG_GUARD } from './runtime/requestSupply'
import {
  overnightBar, overnightTailFrom, overnightSentence, runtimeOvernightOf, REQUEST_OVERNIGHT_GUARD,
} from './runtime/overnightTail'
import { chartClockReport } from './astColumns'
import { buildRuntimeIr } from './ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from './runtime/lowerIr.js'
import { resetRuntimeAsync } from './runtime/runtimeAsync'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import { clearSecondaryBars } from './secondaryBars'
import { STRATEGY_WINDOW_HISTORY } from './runtime/strategyRecord'

vi.setConfig({ testTimeout: 300000 })
const LF = String.fromCharCode(10)

// November 2026 is EST (UTC-5)
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const DAY = '2026-11-19'                         // a Thursday, the measured evening
const utcMid = (day) => Date.parse(`${day}T00:00:00Z`) / 1000
const slots = (from, to, step) => { const out = []; for (let t = from; t <= to; t += step * 60) out.push(t); return out }
const px = (i) => Math.round((7300 + 10 * Math.sin(i / 7)) * 100) / 100
const spx = (times) => times.map((t, i) => ({ t, o: px(i) - 1, h: px(i) + 2, l: px(i) - 2, c: px(i), v: 1e6 }))
const bar = (t, i) => ({ t, o: 50 + i * 0.01, h: 50.5 + i * 0.01, l: 49.5 + i * 0.01, c: 50 + i * 0.01, v: 1000 })
const SPX_D = [{ t: utcMid('2026-11-17'), o: 1, h: 1, l: 1, c: 7416.59, v: 1 }, { t: utcMid('2026-11-18'), o: 1, h: 1, l: 1, c: 7340.53, v: 1 },
  { t: utcMid(DAY), o: 1, h: 1, l: 1, c: 7350.1, v: 1 }]

// ⭐ THE REAL GRID (`otherSymbols.atOrBeforeGridOf`): our SP:SPX intraday rows are the REGULAR session (an index), laid
// onto the chart's own 04:00-20:00 ET clock at its timeframe. The bar at or before each instant inside the session; from
// the close, the day's SETTLED daily close (no row until it is settled); before the open, the previous close. So with
// the day's close settled the series reaches 19:55 / 19:30 / 19:00 (what production served), and a chart bar from
// 20:00 has no row: the overnight tail. 60m instants are on the hour (the grid steps from 04:00).
const TF = {
  5: { step: 5, first: [9, 30], rthLast: [15, 55], gridEnd: [19, 55], nightFrom: [20, 0], newest: [21, 15] },
  30: { step: 30, first: [9, 30], rthLast: [15, 30], gridEnd: [19, 30], nightFrom: [20, 0], newest: [21, 0] },
  60: { step: 60, first: [10, 0], rthLast: [15, 30], gridEnd: [19, 0], nightFrom: [20, 0], newest: [21, 0] },
}
const chartOf = (tf, [hh, mm] = TF[tf].newest) => slots(ET(DAY, ...TF[tf].first), ET(DAY, hh, mm), TF[tf].step).map(bar)
/** our SPX at the chart's timeframe, its regular session from 09:30 through `[hh, mm]` (the session's last bar by default) */
const spxOf = (tf, [hh, mm] = TF[tf].rthLast, from = [9, 30]) => spx(slots(ET(DAY, ...from), ET(DAY, hh, mm), TF[tf].step))
/** `settled`: the day's daily row is the official close (evening), else the session is still in progress */
const secondaryOf = (intraday, { settled = true } = {}) => new Map([
  ['SPX', { bars: intraday, status: 'available', newestBarIsForming: !settled }],
  ['SPX@D', { bars: SPX_D, status: 'available', newestBarIsForming: !settled }]])
const ctxOf = (tf, secondary, over = {}) => ({ tf: String(tf), newestBarIsForming: true, historyFromListing: false,
  symbol: { ticker: 'AGL', exchange: 'NYSE', securityType: 'stock' }, secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over })
const SRC = ['//@version=5', 'indicator("night", overlay = false)', 'plot(request.security("SP:SPX", timeframe.period, close))'].join('\n')
const requestsOf = (tf, rows) => {
  const built = buildRuntimeIr(SRC, { bars: rows, inputs: {}, tf: String(tf), basePeriod: String(tf), symbol: { ticker: 'AGL', exchange: 'NYSE' } })
  expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
  return lowerIrProgram(built.ir).requests
}
const supplyOf = (tf, rows, intraday, over = {}, sec = {}) =>
  runtimeRequestSupply(requestsOf(tf, rows), rows, ctxOf(tf, secondaryOf(intraday, sec), over))
// the IN-SESSION live case of #2076 (its own rails' shape): a 5m chart at 13:50, the session in progress
const midday = () => chartOf(5, [13, 50])
const indexAt = (rows, t) => rows.findIndex((r) => r.t === t)
const LAG = /`SPX`'s newest bars have not arrived/
const WAIT = /whose newest bars have not arrived yet/

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterEach(() => {
  __overnightCutOffForTests(false)
  setRuntimeRunner(null); resetRuntimeAsync(); setRuntimeKillList([])
  resetRuntimeSessions(); resetRuntimeLedgers(); clearSecondaryBars()
  vi.unstubAllEnvs(); vi.unstubAllGlobals()
})

describe('what an overnight bar is (`sessionAt` "closed": outside 04:00-20:00 ET, or a closed day)', () => {
  it('20:00 and after, and before 04:00, are overnight; 04:00 through 19:59 are not', () => {
    expect(overnightBar(ET(DAY, 20, 0))).toBe(true)
    expect(overnightBar(ET(DAY, 21, 15))).toBe(true)
    expect(overnightBar(ET('2026-11-20', 3, 55))).toBe(true)
    for (const [h, m] of [[4, 0], [9, 30], [15, 55], [16, 0], [19, 55]]) expect(overnightBar(ET(DAY, h, m)), `${h}:${m}`).toBe(false)
  })
  it('a closed day is overnight all day (a Saturday, Thanksgiving 2026-11-26)', () => {
    expect(overnightBar(ET('2026-11-21', 12, 0))).toBe(true)
    expect(overnightBar(ET('2026-11-26', 12, 0))).toBe(true)
  })
  it('⛔ an unreadable time is never overnight (the wait / lag rule keeps it)', () => {
    expect(overnightBar('2026-11-19')).toBe(false)
    expect(overnightBar(NaN)).toBe(false)
  })
  it('the tail is cut only when EVERY bar past the last held one is overnight', () => {
    const rows = chartOf(5)
    expect(overnightTailFrom(rows, ET(DAY, 19, 55))).toBe(indexAt(rows, ET(DAY, 20, 0)))
    expect(overnightTailFrom(rows, ET(DAY, 19, 45))).toBe(0)        // 19:50 and 19:55 are inside the session
    expect(overnightTailFrom(rows, ET(DAY, 21, 15))).toBe(0)        // no tail
    expect(overnightTailFrom(rows.slice(-3), 0)).toBe(0)            // a chart that is all tail is never cut to nothing
  })
})

describe('the supply: an all-overnight tail is a CUT, named, never a wait and never a lag', () => {
  for (const tf of [5, 30, 60]) {
    it(`⚰️ THE MEASURED EVENING, ${tf}m at ${TF[tf].newest.join(':')} ET: cut at ${TF[tf].nightFrom.join(':')}, the overnight sentence alone`, () => {
      const rows = chartOf(tf)
      const sup = supplyOf(tf, rows, spxOf(tf))
      expect(sup.pending).toBe(false)
      expect(sup.refusal && sup.refusal.guard).toBe(REQUEST_OVERNIGHT_GUARD)
      expect(sup.refusal.cutAt).toBe(indexAt(rows, ET(DAY, ...TF[tf].nightFrom)))
      expect(rows[sup.refusal.cutAt - 1].t, 'the cut is right after the grid\'s last instant').toBe(ET(DAY, ...TF[tf].gridEnd))
      expect(sup.refusal.series).toEqual(['SPX'])
      expect(sup.refusal.message).toBe(overnightSentence(['SPX']))
      expect(sup.refusal.message).toMatch(/overnight trading, which `SPX` doesn't have and TradingView's chart doesn't show/)
      expect(sup.refusal.message).not.toMatch(LAG)
      expect(sup.refusal.message).not.toMatch(/until they arrive|drawn when they arrive/)
    })
  }
  // ⭐ (e91, ruling (2b)) an in-session lag is now a TAIL cut (`tailLag.test.js`): its own code and sentence, never overnight
  it('⛔ CONTROL: an IN-SESSION lag within the wait is a pending TAIL cut, never overnight', () => {
    const sup = supplyOf(5, midday(), spxOf(5, [13, 40]), {}, { settled: false })
    expect(sup.refusal.guard).toBe(REQUEST_GUARD)
    expect(sup.refusal.tailWait).toBe(true)
    expect(sup.refusal.tailPending).toBe(true)
    expect(sup.refusal.message).toMatch(WAIT)
    expect(sup.refusal.message).not.toMatch(/overnight/)
  })
  it('⛔ CONTROL: an in-session lag past the wait is a LAG tail cut, never overnight', () => {
    const sup = supplyOf(5, midday(), spxOf(5, [13, 35]), {}, { settled: false })
    expect(sup.refusal && sup.refusal.guard).toBe(REQUEST_LAG_GUARD)
    expect(sup.refusal.tailWait).toBe(true)
    expect(sup.refusal.tailPending).toBe(false)
  })
  it('⛔⛔ A MIXED TAIL is NEVER overnight: the day\'s close not settled yet, so 16:00-19:55 (inside the session) lack rows too -> the lag rule', () => {
    const sup = supplyOf(5, chartOf(5), spxOf(5), {}, { settled: false })
    expect(sup.refusal && sup.refusal.guard).toBe(REQUEST_LAG_GUARD)
    expect(sup.refusal.tailWait).toBe(true)
    expect(sup.refusal.message).toMatch(LAG)
    expect(sup.refusal.message).not.toMatch(/overnight/)
  })
  it('⛔ a HOLE before the tail keeps its own refusal on the cut run (the cut never hides it)', () => {
    const rows = chartOf(5)
    // the session's opening bars missing (09:30-10:15): no row there, after the series began (its pre-market rows)
    const holed = spxOf(5, TF[5].rthLast, [10, 20])
    const first = supplyOf(5, rows, holed)
    const cutAt = first.refusal && first.refusal.cutAt
    const second = supplyOf(5, rows.slice(0, Number.isInteger(cutAt) ? cutAt : rows.length), holed, { newestBarIsForming: false })
    const said = [first, second].map((s) => s.refusal && s.refusal.guard)
    expect(said).toContain(REQUEST_GUARD)
    expect([first, second].find((s) => s.refusal && s.refusal.guard === REQUEST_GUARD).refusal.message)
      .toMatch(/has no bar on \d+, after its history began/)
  })
})

const DEF = (over = {}) => ({ id: 'night', meta: { ...over }, compute: { kind: 'runtime', fn: 'runtime:night', outputs: { a: 0 }, source: SRC } })
const run = (def, rows, ctx) => { try { return { cols: computeRuntimeColumns(def, rows, ctx) } } catch (err) { return { err } } }

describe('the run: cut at the overnight tail, everything before drawn exactly as the same run over those bars', () => {
  for (const tf of [5, 30, 60]) {
    it(`${tf}m at ${TF[tf].newest.join(':')} ET: drawn to SPX's last bar, the overnight bars withheld by name, never refused`, () => {
      const rows = chartOf(tf)
      const cut = indexAt(rows, ET(DAY, ...TF[tf].nightFrom))
      const full = run(DEF(), rows, ctxOf(tf, secondaryOf(spxOf(tf))))
      expect(full.err, full.err && full.err.message).toBeUndefined()
      const prefix = run(DEF(), rows.slice(0, cut), ctxOf(tf, secondaryOf(spxOf(tf)), { newestBarIsForming: false }))
      expect(prefix.err, prefix.err && prefix.err.message).toBeUndefined()
      const a = Array.from(full.cols.a)
      const p = Array.from(prefix.cols.a)
      expect(a).toHaveLength(rows.length)
      for (let i = 0; i < cut; i += 1) expect(Object.is(a[i], p[i]) || a[i] === p[i], `bar ${i}`).toBe(true)
      expect(a.slice(0, cut).filter(Number.isFinite).length).toBeGreaterThan(cut / 2)   // CONTROL: it draws
      for (let i = cut; i < rows.length; i += 1) expect(Number.isNaN(a[i]), `overnight bar ${i}`).toBe(true)
      const rec = runtimeOvernightOf(full.cols)
      expect(rec).toMatchObject({ from: cut, bars: rows.length - cut, series: ['SPX'] })
      // the member's strip says it (`chartClockReport`, which the binder publishes)
      const strip = (chartClockReport(full.cols) || {}).withheld || []
      expect(strip).toContainEqual({ code: REQUEST_OVERNIGHT_GUARD, reason: overnightSentence(['SPX']), plots: [] })
    })
  }
  it('⛔ MUTANT CONTROL: with the cut off, the same evening refuses the whole chart (what members saw)', () => {
    __overnightCutOffForTests(true)
    const r = run(DEF(), chartOf(5), ctxOf(5, secondaryOf(spxOf(5))))
    expect(r.err && r.err.guard).toBe(REQUEST_OVERNIGHT_GUARD)
  })
  // ⭐⭐ (e91) A STRATEGY'S WINDOW: the cut its window run finds is in the WINDOW's indices. ⚰️ `computeStrategyWindow`
  // moved only `err.bar` into the chart's, so #2135's cut (e89) landed `shift` bars early on a strategy over a window
  it("⛔ a strategy run over a window (`historyWindowBars`) is cut at the CHART's first overnight bar, not the window's index", () => {
    // the broker emulator is on (a strategy document whose program holds no broker is refused, `pine:strategy-call`)
    vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
    const rows = chartOf(5)
    const cut = indexAt(rows, ET(DAY, ...TF[5].nightFrom))
    const shift = 30
    const src = ['//@version=5', 'strategy("night-s", overlay = false)', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
      'plot(request.security("SP:SPX", timeframe.period, close))'].join(LF)
    const def = { id: 'night-s', meta: { runtimeHistory: STRATEGY_WINDOW_HISTORY },
      compute: { kind: 'runtime', fn: 'runtime:night-s', outputs: { a: 0 }, source: src } }
    const r = run(def, rows, ctxOf(5, secondaryOf(spxOf(5)), { historyWindowBars: rows.length - shift }))
    expect(r.err, r.err && r.err.message).toBeUndefined()
    expect(runtimeOvernightOf(r.cols)).toMatchObject({ from: cut, bars: rows.length - cut })
    const a = Array.from(r.cols.a)
    expect(Number.isFinite(a[cut - 1]), 'drawn up to the cut').toBe(true)
    for (let i = cut; i < rows.length; i += 1) expect(Number.isNaN(a[i]), `overnight bar ${i}`).toBe(true)
  })
  it('⛔ an in-session lag is a TAIL cut (e91 (2b)), never an overnight one: its own code, not `request-overnight`', () => {
    const r = run(DEF(), midday(), ctxOf(5, secondaryOf(spxOf(5, [13, 40]), { settled: false })))
    expect(r.err).toBeUndefined()
    const rec = runtimeOvernightOf(r.cols)
    expect(rec.tail).toBe(true)
    expect(rec.rows[0].code).toBe(REQUEST_GUARD)
    expect(rec.rows[0].code).not.toBe(REQUEST_OVERNIGHT_GUARD)
    expect(rec.rows[0].reason).toMatch(WAIT)
  })
  it('the curtain (an off-listing run) cuts at the tail too and never refuses the whole run', () => {
    const rows = chartOf(5)
    const cut = indexAt(rows, ET(DAY, 20, 0))
    const r = run(DEF({ runtimeHistory: 'listing' }), rows, ctxOf(5, secondaryOf(spxOf(5))))
    expect(r.err, r.err && `${r.err.guard}: ${r.err.message}`).toBeUndefined()
    const a = Array.from(r.cols.a)
    expect(a).toHaveLength(rows.length)
    expect(a.slice(0, cut).some(Number.isFinite)).toBe(true)
    for (let i = cut; i < rows.length; i += 1) expect(Number.isNaN(a[i])).toBe(true)
    expect(runtimeOvernightOf(r.cols)).toMatchObject({ from: cut })
  })
})
