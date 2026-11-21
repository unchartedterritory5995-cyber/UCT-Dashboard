// ─── ⭐⭐ (the e85 live capture, 2026-11-19) — ANOTHER SERIES' NEWEST BARS NOT ARRIVED YET: A WAIT, NOT A REFUSAL ───
//
// ⚰️ CAPTURED (patrick-54, engine 85, Fred RS "rs-rating-fred6724" on RDDT 5m in market hours, the runtime worker's own
// messages): most replies were REFUSED (extended hours 2 ok / 10 refused / 1 withheld / 3 pending; regular 6 / 11 / 2 / 3).
// Our SP:SPX 5m series ran 1-2 bars behind the chart's newest: at 4,653 rows the chart was refused, at 4,655 the same
// chart served, and `/api/bars/SPX?tf=5` a minute later had the bar and no gap. A withheld bar before the newest refused
// the whole chart, under the DEPTH sentence of the chart's first withheld bar ("this chart's history reaches X, and the
// `SPX` bars we hold begin at Y"), which was not the cause. And right after the chart grew a bar, before SPX had it, the
// drawings came back WITHHELD `runtime:history-start` ("a run did not finish its drawings").
// THE RULING (coordinator, 2026-11-19), held here:
//   * a gap strictly after the series' last held bar at the chart's live tail is PENDING (`waiting`), never refused;
//   * it runs again on the series' own update (the run's key moves), with no timer; the pane keeps its last served
//     picture and the strip names the wait;
//   * a lag past 2 of the chart's bar intervals (or on a chart whose newest bar is finished) is REFUSED by name,
//     `runtime:request-lag`, with a sentence that says the newest bars have not arrived;
//   * a hole inside the series' history keeps its rule (refused, no `knownFrom`), a depth gap its `knownFrom`, and no
//     refusal carries another class's sentence.
// ⭐⭐ (e91, coordinator ruling 2026-11-20 (2b), option A) — THE WAIT BECAME A CUT. ⚰️ CAPTURED (production e88 in session,
// Fred RS on RDDT 5m): /api/bars/SPX answered 0-2 bars behind, every reply WAITED, and a freshly opened pane stayed BLANK
// all session (a wait keeps a picture only where there is one). Now the run is CUT at the first bar past the series'
// newest held bar: the values are drawn up to it and the bars from it withheld by name (the strip's row); the DRAWINGS
// wait, named, until the series lands (never on the cut bar: TradingView draws a last-bar label on the TRUE last bar).
// A lag past the bound is cut the same way, named `runtime:request-lag`: never blank. The e85 rails below that asserted
// the whole-run wait now assert the cut; the whole-run wait is reproduced with the cut switched off.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from './nativeRegistry'
import { createBinder } from './binder'
import { addInstance } from './instanceControls'
import { mergeChartSettings } from '../chartDefaults'
import { createFakeChart } from './__tests__/fakeChart'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeColumnsFor, setRuntimeRunner,
  __newestTailWaitOffForTests,
} from './runtime/runtimeColumns'
import {
  runtimeRequestSupply, tailLagIntervals, REQUEST_GUARD, REQUEST_LAG_GUARD, TAIL_LAG_BOUND_INTERVALS,
  tailCutSentence, __tailCutOffForTests,
} from './runtime/requestSupply'
import { runtimeOvernightOf } from './runtime/overnightTail.js'
import { chartClockReport } from './astColumns'
import { buildRuntimeIr } from './ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from './runtime/lowerIr.js'
import { workerRunner, resetRuntimeAsync } from './runtime/runtimeAsync'
import { runtimeObjectsOf, RUNTIME_OBJECTS_KEY } from './runtime/runtimeObjects'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'
import { OWN_DAILY_KEY } from './otherSymbols'
import { clearSecondaryBars } from './secondaryBars'
import { runtimeErrorNoticeFor, resetRuntimeErrorNotices } from './runtimeErrorNotice'
import { objectRenderDropsFor, resetObjectRenderDrops } from './objectRenderNotice'
import { RUN_HALF_WHY_KEY } from './ast/objectLoss'

vi.setConfig({ testTimeout: 300000 })

// ── the L12 witness grid (runHalfFromKnownDepth.test.js): D1's regular bars BEFORE our index depth, D2 live at 13:50 ──
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const D1 = '2026-11-16'
const D2 = '2026-11-17'
const rthTimes = (day, step) => Array.from({ length: 390 / step }, (_, k) => ET(day, 9, 30) + k * step * 60)
const spxClose = (i) => Math.round((7300 + 10 * Math.sin(i / 7)) * 100) / 100
const SPX_5 = rthTimes(D2, 5).map((t, i) => ({ t, o: spxClose(i) - 1, h: spxClose(i) + 2, l: spxClose(i) - 2, c: spxClose(i), v: 1e6 }))
const utcMid = (day) => Date.parse(`${day}T00:00:00Z`) / 1000
const SPX_D = [{ t: utcMid('2026-11-13'), o: 1, h: 1, l: 1, c: 7561.67, v: 1 }, { t: utcMid(D1), o: 1, h: 1, l: 1, c: 7416.59, v: 1 },
  { t: utcMid(D2), o: 1, h: 1, l: 1, c: 7340.53, v: 1 }]
const PRE = Array.from({ length: 18 }, (_, k) => ET(D2, 8, 0) + k * 300)
const NOW = ET(D2, 13, 50)                                  // the chart's newest bar: forming, in the session
const LIVE_RTH = rthTimes(D2, 5).filter((t) => t <= NOW)
const bar = (t, i) => ({ t, o: 50 + i * 0.01, h: 50.5 + i * 0.01, l: 49.5 + i * 0.01, c: 50 + i * 0.01, v: 1000 })
const DEEP = [...rthTimes(D1, 5), ...PRE, ...LIVE_RTH].map(bar)    // reaches before our SPX: a depth gap
const SHALLOW = [...PRE, ...LIVE_RTH].map(bar)                     // starts where our SPX grid answers
const DEPTH_STARTS_AT = rthTimes(D1, 5).length
/** our SPX 5m rows through `hh:mm` ET of D2 (the newest that has ARRIVED) */
const spxThrough = (hh, mm, rows = SPX_5) => rows.filter((b) => b.t <= ET(D2, hh, mm))
const secondaryOf = (intraday) => new Map([['SPX', { bars: intraday, status: 'available', newestBarIsForming: true }],
  // the session is in progress: its daily row is forming, so it is no official close yet
  ['SPX@D', { bars: SPX_D, status: 'available', newestBarIsForming: true }]])
const ctx5 = (secondary, over = {}) => ({ tf: '5', newestBarIsForming: true, historyFromListing: false,
  symbol: { ticker: 'AGL', exchange: 'NYSE', securityType: 'stock' }, secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over })
const pine = (lines) => ['//@version=5', 'indicator("tl", overlay = false)', ...lines].join('\n')
const SRC = pine(['plot(request.security("SP:SPX", timeframe.period, close))'])
const requestsOf = (src, rows) => {
  const built = buildRuntimeIr(src, { bars: rows, inputs: {}, tf: '5', basePeriod: '5', symbol: { ticker: 'AGL', exchange: 'NYSE' } })
  expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
  return lowerIrProgram(built.ir).requests
}
const supplyOf = (rows, intraday, over = {}) => runtimeRequestSupply(requestsOf(SRC, rows), rows, ctx5(secondaryOf(intraday), over))

// what each class's sentence says, and so what no other class's may say
const SAYS = Object.freeze({
  depth: /this chart's history reaches \d+, and the `SPX` bars we hold begin at \d+/,
  hole: /`SPX` has no bar on \d+, after its history began/,
  lag: /`SPX`'s newest bars have not arrived/,
})

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterEach(() => {
  __newestTailWaitOffForTests(false)
  __tailCutOffForTests(false)
  setRuntimeRunner(null); resetRuntimeAsync(); setRunHalfObjectEvidence([]); setRuntimeKillList([])
  resetRuntimeSessions(); resetRuntimeLedgers(); clearSecondaryBars(); resetRuntimeErrorNotices(); resetObjectRenderDrops()
  vi.unstubAllEnvs(); vi.unstubAllGlobals()
})

/** the chart's first bar past SPX's newest held bar (`hh:mm` ET of D2): where the run is cut */
const cutOf = (rows, hh, mm) => rows.findIndex((b) => b.t > ET(D2, hh, mm))
/** a supply's answer is a TAIL CUT at `at`: within the bound (pending) or past it (the lag's name) */
const expectTailCut = (sup, at, pending) => {
  expect(sup.pending).toBe(false)
  expect(sup.refusal.cutAt).toBe(at)
  expect(sup.refusal.series).toEqual(['SPX'])
  expect(sup.refusal.tailWait).toBe(true)
  expect(sup.refusal.tailPending).toBe(pending)
  expect(sup.refusal.knownFrom).toBeUndefined()
  expect(sup.refusal.guard).toBe(pending ? REQUEST_GUARD : REQUEST_LAG_GUARD)
}

describe('the supply: a live-tail lag is a CUT (e91 (2b)), and each refusal names its own cause', () => {
  it('⚰️ THE CAPTURED CASE: a chart deeper than our SPX, SPX two bars behind the newest -> CUT at the first bar past it, pending (e85: a whole-run wait)', () => {
    const sup = supplyOf(DEEP, spxThrough(13, 40))
    expectTailCut(sup, cutOf(DEEP, 13, 40), true)
    expect(sup.refusal.message).toBe(tailCutSentence(['SPX']))
    for (const re of Object.values(SAYS)) expect(sup.refusal.message).not.toMatch(re)
  })
  it('⚰️ REPRODUCED, the cut switched off: the same lag is a whole-run WAIT (what left a freshly opened pane blank)', () => {
    __tailCutOffForTests(true)
    const sup = supplyOf(DEEP, spxThrough(13, 40))
    expect(sup.refusal).toBeNull()
    expect(sup.pending).toBe(true)
    expect(sup.supply).toBeNull()
    expect(sup.waiting.series).toEqual(['SPX'])
    expect(sup.waiting.sentence).toMatch(/`SPX`, whose newest bars have not arrived yet/)
  })
  it('the same lag on a chart with no depth gap: CUT, pending', () => {
    expectTailCut(supplyOf(SHALLOW, spxThrough(13, 40)), cutOf(SHALLOW, 13, 40), true)
  })
  it('⛔ CONTROL: SPX caught up, the depth gap alone -> refused with the DEPTH sentence and its knownFrom (unchanged)', () => {
    const sup = supplyOf(DEEP, spxThrough(13, 50))
    expect(sup.pending).toBe(false)
    expect(sup.refusal.guard).toBe(REQUEST_GUARD)
    expect(sup.refusal.knownFrom).toBe(DEPTH_STARTS_AT)
    expect(sup.refusal.message).toMatch(SAYS.depth)
  })
  it(`a lag past ${TAIL_LAG_BOUND_INTERVALS} bar intervals -> CUT by name, \`runtime:request-lag\`, never the depth sentence`, () => {
    for (const rows of [DEEP, SHALLOW]) {
      const sup = supplyOf(rows, spxThrough(13, 35))
      expectTailCut(sup, cutOf(rows, 13, 35), false)
      expect(sup.pending).toBe(false)
      expect(sup.refusal.guard).toBe(REQUEST_LAG_GUARD)
      expect(sup.refusal.knownFrom).toBeUndefined()
      expect(sup.refusal.message).toMatch(SAYS.lag)
      expect(sup.refusal.message).not.toMatch(SAYS.depth)
      expect(sup.refusal.message).not.toMatch(SAYS.hole)
    }
  })
  it('a lag on a chart whose newest bar is FINISHED is no wait: cut by name, `runtime:request-lag`', () => {
    const sup = supplyOf(SHALLOW, spxThrough(13, 40), { newestBarIsForming: false })
    expectTailCut(sup, cutOf(SHALLOW, 13, 40), false)
    expect(sup.refusal.guard).toBe(REQUEST_LAG_GUARD)
    expect(sup.refusal.message).toMatch(/before this chart's finished newest bar/)
  })
  it('⛔ a HOLE inside the series (a session missing its opening bars) still refuses, with ITS sentence and no knownFrom, a tail lag or not', () => {
    for (const intraday of [spxThrough(13, 40, SPX_5.slice(10)), spxThrough(13, 50, SPX_5.slice(10))]) {
      const sup = supplyOf(DEEP, intraday)
      expect(sup.pending).toBe(false)
      expect(sup.refusal.guard).toBe(REQUEST_GUARD)
      expect(sup.refusal.knownFrom).toBeUndefined()
      expect(sup.refusal.message).toMatch(SAYS.hole)
      expect(sup.refusal.message).not.toMatch(SAYS.depth)
      expect(sup.refusal.message).not.toMatch(SAYS.lag)
    }
  })
  it('the newest bar alone on the tail: supplied, that bar withheld, and recorded as a tail within the wait', () => {
    const sup = supplyOf(SHALLOW, spxThrough(13, 45))
    expect(sup.refusal).toBeNull()
    expect(sup.pending).toBe(false)
    expect(sup.newestWithheld).toBe(true)
    expect(sup.newestTail).toEqual([{ site: 0, series: 'SPX', within: true, message: null }])
  })
  it('⛔ the grid\'s NEXT-session pre-market rows (the previous close) are not "arrived" bars: the lag is measured at the chart\'s newest', () => {
    // SPX's daily row for D2 settled: the grid then holds D2's close AND the next session's pre-market rows
    const settled = new Map([['SPX', { bars: spxThrough(13, 40), status: 'available' }],
      ['SPX@D', { bars: SPX_D, status: 'available', newestBarIsForming: false }]])
    const sup = runtimeRequestSupply(requestsOf(SRC, SHALLOW), SHALLOW, ctx5(settled))
    expectTailCut(sup, cutOf(SHALLOW, 13, 40), true)
  })
  it('tailLagIntervals: the chart\'s own clock on an intraday chart, its bars on a daily one', () => {
    const rows = [{ t: 1000 }, { t: 1300 }, { t: 1600 }]
    expect(tailLagIntervals(rows, 1000, '5')).toBe(2)
    expect(tailLagIntervals([{ t: 1000 }, { t: 2200 }], 1000, '5')).toBe(4)   // a chart with no bar in three slots
    expect(tailLagIntervals([{ t: '2026-11-13' }, { t: '2026-11-16' }, { t: '2026-11-17' }], '2026-11-13', 'D')).toBe(2)
  })
})

describe('⛔⛔ ATTRIBUTION: every refusal class says its own cause and no other class\'s', () => {
  const cases = [
    { name: 'depth', rows: DEEP, intraday: spxThrough(13, 50), guard: REQUEST_GUARD, says: 'depth' },
    { name: 'hole', rows: SHALLOW, intraday: spxThrough(13, 50, SPX_5.slice(10)), guard: REQUEST_GUARD, says: 'hole' },
    { name: 'hole + depth', rows: DEEP, intraday: spxThrough(13, 50, SPX_5.slice(10)), guard: REQUEST_GUARD, says: 'hole' },
    { name: 'hole + tail', rows: DEEP, intraday: spxThrough(13, 40, SPX_5.slice(10)), guard: REQUEST_GUARD, says: 'hole' },
    { name: 'lag', rows: SHALLOW, intraday: spxThrough(13, 35), guard: REQUEST_LAG_GUARD, says: 'lag' },
    { name: 'lag + depth', rows: DEEP, intraday: spxThrough(13, 35), guard: REQUEST_LAG_GUARD, says: 'lag' },
    { name: 'lag, finished chart', rows: SHALLOW, intraday: spxThrough(13, 40), over: { newestBarIsForming: false },
      guard: REQUEST_LAG_GUARD, says: 'lag' },
  ]
  for (const c of cases) {
    it(`${c.name}: ${c.guard}, the ${c.says} sentence alone`, () => {
      const sup = supplyOf(c.rows, c.intraday, c.over || {})
      expect(sup.refusal, 'refused').not.toBeNull()
      expect(sup.refusal.guard).toBe(c.guard)
      for (const [cls, re] of Object.entries(SAYS)) {
        if (cls === c.says) expect(sup.refusal.message).toMatch(re)
        else expect(sup.refusal.message, `${c.name} must not say the ${cls} sentence`).not.toMatch(re)
      }
      expect(Number.isInteger(sup.refusal.knownFrom), 'only a depth gap alone carries knownFrom').toBe(c.says === 'depth')
    })
  }
  it('and a pending CUT says none of them', () => {
    const sup = supplyOf(DEEP, spxThrough(13, 40))
    expect(sup.refusal.tailPending).toBe(true)
    for (const re of Object.values(SAYS)) expect(sup.refusal.message).not.toMatch(re)
  })
})

// ── the lane: a script that DRAWS a label reading SPX on the newest bar (its newest-bar withholding takes every drawing) ──
const DRAW = pine(['s = request.security("SP:SPX", timeframe.period, close)', 'plot(s)', 'if barstate.islast',
  '    label.new(bar_index, s, str.tostring(s))'])
const runDef = (source) => ({ id: 'u_tl-run', compute: { kind: 'runtime', fn: 'runtime:u_tl-run', rev: 1, source, objects: true, outputs: { x: 0 } },
  inputs: [], meta: { runtimeHistory: 'listing' } })

describe('the lane: the newest bar alone on the tail, in a run that draws (the e85 reply after a new bar)', () => {
  const run = (intraday, over = {}) => computeRuntimeColumns(runDef(DRAW), SHALLOW, ctx5(secondaryOf(intraday), over), { now: () => 0 })
  it('⚰️ REPRODUCED, the wait switched off: the drawings come back WITHHELD `runtime:history-start` ("a run did not finish its drawings")', () => {
    __newestTailWaitOffForTests(true)
    const cols = run(spxThrough(13, 45))
    const obj = cols[RUNTIME_OBJECTS_KEY]
    expect(obj.status).toBe('WITHHELD')
    expect(obj.guard).toBe('runtime:history-start')
    expect(obj.reason).toMatch(/a run did not finish its drawings/)
  })
  it('the drawings WAIT for SPX (pending, named), and the plots are drawn with that bar withheld, as before', () => {
    const cols = run(spxThrough(13, 45))
    const obj = cols[RUNTIME_OBJECTS_KEY]
    expect(obj.status).toBe('WITHHELD')
    expect(obj.pending).toBe(true)
    expect(obj.waitingFor).toBe('SPX')
    expect(obj.guard).toBe(REQUEST_GUARD)
    const n = SHALLOW.length
    expect(Number.isNaN(cols.x[n - 1]), 'the newest bar is withheld').toBe(true)
    expect(cols.x[n - 2]).toBe(spxThrough(13, 45).at(-1).c)
  })
  it('⛔ CONTROL: SPX caught up, the drawings are drawn (the label on the newest bar)', () => {
    const obj = runtimeObjectsOf(run(spxThrough(13, 50)))
    expect(obj.status).toBe('ok')
    expect(obj.live.filter((o) => o.family === 'label' && o.createdBar === SHALLOW.length - 1).length).toBe(1)
  })
  it('a finished chart\'s newest bar on the tail: the drawings are withheld BY NAME (`runtime:request-lag`), never history-start', () => {
    const obj = run(spxThrough(13, 45), { newestBarIsForming: false })[RUNTIME_OBJECTS_KEY]
    expect(obj.status).toBe('WITHHELD')
    expect(obj.pending).toBeUndefined()
    expect(obj.guard).toBe(REQUEST_LAG_GUARD)
    expect(obj.reason).toMatch(SAYS.lag)
  })
  it('⚰️ REPRODUCED, the cut switched off: the whole run waits on a two-bar lag (a pending throw: no values at all)', () => {
    __tailCutOffForTests(true)
    let err = null
    try { run(spxThrough(13, 40)) } catch (e) { err = e }
    expect(err).not.toBeNull()
    expect(err.pending).toBe(true)
    expect(err.waitingFor).toBe('SPX')
    expect(err.guard).toBe(REQUEST_GUARD)
    expect(String(err.message)).not.toMatch(SAYS.depth)
  })
})

// ── ⭐⭐ (e91, coordinator ruling (2b), option A) THE CUT IN THE LANE ─────────────────────────────────────────────────
const plainDef = { ...runDef(SRC), id: 'u_tl-plain', compute: { ...runDef(SRC).compute, fn: 'runtime:u_tl-plain', objects: undefined } }
const runOf = (def, rows, intraday, over = {}) => computeRuntimeColumns(def, rows, ctx5(secondaryOf(intraday), over), { now: () => 0 })
const lastDrawn = (col) => { let k = -1; for (let i = 0; i < col.length; i += 1) if (Number.isFinite(col[i])) k = i; return k }

describe('(e91 (2b)) THE CUT: the values are drawn up to SPX\'s newest held bar, the bars past it named, the drawings wait', () => {
  it('⭐ two bars behind, a plain script: drawn THROUGH 13:40, the two newer bars withheld, the strip names them (never blank)', () => {
    const at = cutOf(SHALLOW, 13, 40)
    const cols = runOf(plainDef, SHALLOW, spxThrough(13, 40))
    expect(cols.x.length).toBe(SHALLOW.length)
    expect(cols.x[at - 1]).toBe(spxThrough(13, 40).at(-1).c)
    expect(lastDrawn(cols.x)).toBe(at - 1)
    for (let i = at; i < SHALLOW.length; i += 1) expect(Number.isNaN(cols.x[i]), `bar ${i} withheld`).toBe(true)
    const rec = runtimeOvernightOf(cols)
    expect(rec).toMatchObject({ from: at, bars: SHALLOW.length - at, tail: true })
    expect(rec.rows).toEqual([{ code: REQUEST_GUARD, reason: tailCutSentence(['SPX']) }])
    const strip = chartClockReport(cols)
    expect(strip.withheld.map((r) => r.reason)).toContain(tailCutSentence(['SPX']))
    for (const re of Object.values(SAYS)) expect(rec.rows[0].reason).not.toMatch(re)
  })
  it('a chart deeper than our SPX too: drawn from where SPX begins (`knownFrom`) up to the cut, withheld on both sides', () => {
    const at = cutOf(DEEP, 13, 40)
    const cols = runOf(plainDef, DEEP, spxThrough(13, 40))
    for (let i = 0; i < DEPTH_STARTS_AT; i += 1) expect(Number.isNaN(cols.x[i]), `depth bar ${i}`).toBe(true)
    expect(Number.isFinite(cols.x[at - 1])).toBe(true)
    expect(lastDrawn(cols.x)).toBe(at - 1)
    expect(runtimeOvernightOf(cols)).toMatchObject({ from: at, tail: true })
  })
  it('⛔ past the bound: CUT the same way, named `runtime:request-lag` with the lag\'s sentence; drawn, never a stop', () => {
    const at = cutOf(SHALLOW, 13, 35)
    const cols = runOf(plainDef, SHALLOW, spxThrough(13, 35))
    expect(lastDrawn(cols.x)).toBe(at - 1)
    const rec = runtimeOvernightOf(cols)
    expect(rec.rows[0].code).toBe(REQUEST_LAG_GUARD)
    expect(rec.rows[0].reason).toMatch(SAYS.lag)
    expect(rec.rows[0].reason).not.toMatch(SAYS.depth)
  })
  it('⭐ a script that draws: values drawn up to the cut, the drawings WITHHELD and WAITING, named SPX; none on the cut bar', () => {
    const at = cutOf(SHALLOW, 13, 40)
    const cols = runOf(runDef(DRAW), SHALLOW, spxThrough(13, 40))
    expect(lastDrawn(cols.x)).toBe(at - 1)
    const obj = cols[RUNTIME_OBJECTS_KEY]
    expect(obj.status).toBe('WITHHELD')
    expect(obj.pending).toBe(true)
    expect(obj.waitingFor).toBe('SPX')
    expect(obj.guard).toBe(REQUEST_GUARD)
    expect(obj.reason).toBe(tailCutSentence(['SPX']))
    expect(obj.live).toEqual([])
  })
  it('⭐ …and SPX lands: the label stands on the TRUE last bar (never the cut bar), the cut gone', () => {
    const cols = runOf(runDef(DRAW), SHALLOW, spxThrough(13, 50))
    const obj = runtimeObjectsOf(cols)
    expect(obj.status).toBe('ok')
    const labels = obj.live.filter((o) => o.family === 'label')
    expect(labels.map((o) => o.createdBar)).toEqual([SHALLOW.length - 1])
    expect(runtimeOvernightOf(cols)).toBeNull()
    expect(cols.x[SHALLOW.length - 1]).toBe(spxThrough(13, 50).at(-1).c)
  })
  it('⛔ past the bound, a script that draws: the drawings withheld BY NAME (`runtime:request-lag`), not waiting', () => {
    const obj = runOf(runDef(DRAW), SHALLOW, spxThrough(13, 35))[RUNTIME_OBJECTS_KEY]
    expect(obj.status).toBe('WITHHELD')
    expect(obj.pending).toBeUndefined()
    expect(obj.guard).toBe(REQUEST_LAG_GUARD)
    expect(obj.reason).toMatch(SAYS.lag)
  })
  it('⭐ the newest bar alone on the tail is cut too: drawn up to it, the drawings waiting (e85\'s answer, now never the whole run)', () => {
    const n = SHALLOW.length
    const cols = runOf(runDef(DRAW), SHALLOW, spxThrough(13, 45))
    expect(lastDrawn(cols.x)).toBe(n - 2)
    expect(runtimeOvernightOf(cols)).toMatchObject({ from: n - 1, bars: 1, tail: true })
    expect(cols[RUNTIME_OBJECTS_KEY]).toMatchObject({ status: 'WITHHELD', pending: true, waitingFor: 'SPX', guard: REQUEST_GUARD })
  })
  it('⛔ CONTROL: SPX caught up, nothing is cut', () => {
    const cols = runOf(plainDef, SHALLOW, spxThrough(13, 50))
    expect(lastDrawn(cols.x)).toBe(SHALLOW.length - 1)
    expect(runtimeOvernightOf(cols)).toBeNull()
  })
})

// ── THE PRODUCT PATH: Fred RS's run half, the REAL runtime worker module (structured clones), a REAL binder ──────────
const RS = fs.readFileSync(path.join(path.resolve(process.cwd(), '..'), 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const HELD = 'SEED_FRED6725_RS_RATING:RSRATING@D'
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const SESS = []
for (let d = '2026-11-02'; d <= '2026-11-13'; d = isoPlus(d, 1)) if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) SESS.push(d)
const LAST = SESS[SESS.length - 1]
// the chart: extended hours 04:00-20:00, the last session LIVE up to `hh:mm` ET (its newest bar forming)
const rsChartThrough = (hh, mm, base = 90) => SESS.flatMap((d, k) => Array.from({ length: 192 }, (_, j) => {
  const t = ET(d, 4, 0) + j * 300
  const c = base + k + Math.sin(j / 9)
  return { t, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 }
})).filter((b) => b.t <= ET(LAST, hh, mm))
// our store holds SPX's 5m bars from the FIFTH session on (the chart reaches deeper: a depth gap, as on production)
const SPX5_ALL = SESS.slice(4).flatMap((d, k) => Array.from({ length: 78 }, (_, j) => {
  const c = 7300 + (k + 4) * 5 + Math.cos(j / 7) * 3
  return { t: ET(d, 9, 30) + j * 300, o: c, h: c + 1, l: c - 1, c, v: 1 }
}))
const spx5Through = (hh, mm, rows = SPX5_ALL) => rows.filter((b) => b.t <= ET(LAST, hh, mm))
const PREV = '2026-10-30'
const SPXD = [PREV, ...SESS].map((d, k) => ({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: 7290 + k * 5, v: 1 }))
const OWND = [PREV, ...SESS].map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 89 + k, v: 1 }))
const SEED_REAL = []
for (let d = '2026-10-13', k = 0; d <= '2026-11-16'; d = isoPlus(d, 1), k += 1) SEED_REAL.push({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 })
const RDDT = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information', sector: 'Communication Services', securityType: 'stock' })
const AGL = Object.freeze({ ticker: 'AGL', exchange: 'NYSE', industry: 'Medical Care Facilities', sector: 'Healthcare', securityType: 'stock' })
/** the chart's other-symbol cache as its hook hands it: each SPX update is a NEW entry object (`secondaryBars` store) */
const rsSecondary = (spx5) => new Map([['SPX', { bars: spx5, status: 'available', newestBarIsForming: true }],
  ['SPX@D', { bars: SPXD, status: 'available', newestBarIsForming: true }],
  [OWN_DAILY_KEY, { bars: OWND, status: 'available', newestBarIsForming: true }],
  [HELD, { bars: SEED_REAL, status: 'available' }]])

const SELF = { postMessage: (m) => SELF.out.push(m), out: [] }
/** the REAL worker module, its messages held until `flush()` (a run in the worker), every message structured-cloned */
async function heldWorkers() {
  vi.stubGlobal('self', SELF)
  await import('./runtime/runtimeWorker.js')
  const w = { queue: [], posted: 0, replies: [] }
  w.factory = () => ({
    postMessage(msg) { w.posted += 1; w.queue.push(structuredClone(msg)) },
    flush() {
      const q = w.queue
      w.queue = []
      for (const msg of q) {
        SELF.out.length = 0
        SELF.onmessage({ data: msg })
        const reply = structuredClone(SELF.out[0])
        w.replies.push(reply)
        this.onmessage({ data: reply })
      }
    },
    terminate() {},
  })
  return w
}

/** Fred RS installed from the library, a real binder over a recording chart, and the held worker. */
async function fredOnAChart() {
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
    { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
    { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
  const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_tl-fred' }).definition))
  const { installed, errors } = registry.installUserDefinitions([stored])
  expect(installed.length, errors.join(' | ')).toBe(1)
  const def = installed[0]
  const w = await heldWorkers()
  let worker = null
  setRuntimeRunner(workerRunner(() => { worker = w.factory(); return worker }))
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const id = instances[0].instanceId
  // the drawing layer, recorded: what it was last set to (`run:` the run's drawings, `host:` the host program's)
  const log = []
  const layer = {
    set: (state, sig, meta) => { log.push(state ? `${meta && meta.lane === 'runtime' ? 'run' : 'host'}:${sig}` : 'EMPTY') },
    clear: () => log.push('CLEAR'),
  }
  const sync = (bars, secondary, symbol = RDDT) => binder.sync({
    enabled: true, cs, instances, registry, bars, tf: '5', sym: symbol.ticker, symbol, newestBarIsForming: true,
    historyFromListing: false, secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null),
    adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
    createObjectLayer: () => layer,
  })
  /** one paint, the run in the worker answering, and the paint its landing asks for */
  const settle = (bars, secondary, symbol) => { sync(bars, secondary, symbol); if (worker) worker.flush(); sync(bars, secondary, symbol) }
  const reply = () => w.replies[w.replies.length - 1]
  /** the newest bar time any plotted series was last set to with a finite value (-1: none), and how many points */
  const drawn = () => {
    const last = new Map()
    for (const c of fake.callsOf('setData')) last.set(c.id, c.args[0])
    let newest = -1
    let points = 0
    for (const data of last.values()) {
      for (const p of data || []) {
        if (p && (Number.isFinite(p.value) || Number.isFinite(p.close))) { points += 1; if (p.time > newest) newest = p.time }
      }
    }
    return { newest, points }
  }
  return {
    def, id, log, sync, settle, reply, w, drawn,
    flush: () => worker && worker.flush(),
    notice: () => runtimeErrorNoticeFor(id),
    servedByRun: () => !!(objectRenderDropsFor(id) && objectRenderDropsFor(id).servedByRun === true),
    why: () => ((objectRenderDropsFor(id) || {}).why || {})[RUN_HALF_WHY_KEY] || null,
    done: () => { registry.uninstallUserDefinition(def.id) },
  }
}
const WAITING = /^waiting for `SPX`'s newest bar, which has not arrived yet; this script's drawings are drawn when it does$/

describe('the product path: Fred RS on a live 5m chart whose SPX lags its newest bars', () => {
  it('⭐⭐ (e91 (2b)) THE CAPTURED CASE, a FRESH pane, SPX two bars behind: the RS values DRAWN up to SPX\'s newest, the drawings waiting, named; SPX lands and all of it serves', async () => {
    const f = await fredOnAChart()
    try {
      const chart = rsChartThrough(13, 50)
      f.settle(chart, rsSecondary(spx5Through(13, 40)))
      const r = f.reply()
      expect(r.ok, JSON.stringify(r).slice(0, 600)).toBe(true)
      expect(r.objects).toMatchObject({ status: 'WITHHELD', pending: true, waitingFor: 'SPX', guard: REQUEST_GUARD })
      const d = f.drawn()
      expect(d.points, 'the pane is NOT blank: the RS values are drawn').toBeGreaterThan(100)
      expect(d.newest, 'drawn up to SPX\'s newest held bar, never past it').toBe(ET(LAST, 13, 40))
      expect(f.log.filter((x) => x.startsWith('run:')), 'no drawing on the cut bar').toEqual([])
      expect(f.notice()).toMatch(WAITING)
      f.settle(chart, rsSecondary(spx5Through(13, 50)))
      expect(f.reply().objects.status).toBe('ok')
      expect(f.servedByRun()).toBe(true)
      expect(f.drawn().newest).toBe(ET(LAST, 13, 50))
      expect(f.notice()).toBeNull()
    } finally { f.done() }
  })
  it('⭐⭐ (e91 (2b)) a FRESH pane one bar ahead of SPX: the same (e85 waited the whole run, MEASURED below: blank)', async () => {
    const f = await fredOnAChart()
    try {
      f.settle(rsChartThrough(13, 50), rsSecondary(spx5Through(13, 45)))
      expect(f.reply().ok).toBe(true)
      expect(f.reply().objects).toMatchObject({ status: 'WITHHELD', pending: true, waitingFor: 'SPX' })
      expect(f.drawn().newest).toBe(ET(LAST, 13, 45))
      expect(f.notice()).toMatch(WAITING)
    } finally { f.done() }
  })
  it('⚰️ REPRODUCED, the cut switched off: a FRESH pane, SPX two bars behind, the run half never answers (a whole-run wait)', async () => {
    __tailCutOffForTests(true)
    const f = await fredOnAChart()
    try {
      f.settle(rsChartThrough(13, 50), rsSecondary(spx5Through(13, 40)))
      const r = f.reply()
      expect(r.ok).toBe(false)
      expect(r.error.pending).toBe(true)
      expect(f.log.filter((x) => x.startsWith('run:'))).toEqual([])
    } finally { f.done() }
  })
  it('⭐ two bars behind a SERVED pane: the values drawn up to SPX\'s newest, the served drawings KEPT, the strip names SPX; SPX\'s update runs it ONCE and it serves', async () => {
    const f = await fredOnAChart()
    try {
      // served, SPX caught up
      f.settle(rsChartThrough(13, 40), rsSecondary(spx5Through(13, 40)))
      expect(f.servedByRun(), 'the run half serves').toBe(true)
      const served = f.log[f.log.length - 1]
      expect(served).toMatch(/^run:/)
      expect(f.notice()).toBeNull()
      // the chart grows two bars; our SPX has not
      const chart = rsChartThrough(13, 50)
      const lagging = rsSecondary(spx5Through(13, 40))
      f.sync(chart, lagging)
      expect(f.log[f.log.length - 1], 'in the worker: the served picture stays (never emptied)').toBe(served)
      f.flush()
      f.sync(chart, lagging)
      const r = f.reply()
      expect(r.ok).toBe(true)
      expect(r.objects).toMatchObject({ status: 'WITHHELD', pending: true, waitingFor: 'SPX', guard: REQUEST_GUARD })
      for (const re of Object.values(SAYS)) expect(r.objects.reason).not.toMatch(re)
      expect(f.drawn().newest).toBe(ET(LAST, 13, 40))
      expect(f.log[f.log.length - 1], 'waiting: the served picture stays').toBe(served)
      expect(f.log.slice(f.log.lastIndexOf(served))).not.toContain('EMPTY')
      expect(f.notice()).toMatch(WAITING)
      expect(f.notice()).not.toMatch(/\b(runtime|pine|run-half|pane):[a-z-]+/)
      // ⛔ NO POLLING: painting again (and time passing) asks the worker nothing while SPX is unchanged
      const posted = f.w.posted
      for (let k = 0; k < 3; k += 1) f.sync(chart, lagging)
      await new Promise((res) => setTimeout(res, 50))
      f.sync(chart, lagging)
      expect(f.w.posted, 'the wait re-runs only on the series\' update').toBe(posted)
      expect(f.notice()).toMatch(WAITING)
      // SPX's newest bars land (the store's update: a new entry): ONE run, served, the status gone
      const caughtUp = rsSecondary(spx5Through(13, 50))
      f.sync(chart, caughtUp)
      expect(f.w.posted).toBe(posted + 1)
      expect(f.log[f.log.length - 1], 'in the worker after the update: still the served picture').toBe(served)
      f.flush()
      f.sync(chart, caughtUp)
      expect(f.reply().ok).toBe(true)
      expect(f.servedByRun()).toBe(true)
      expect(f.log[f.log.length - 1]).toMatch(/^run:/)
      expect(f.log[f.log.length - 1]).not.toBe(served)
      expect(f.notice()).toBeNull()
    } finally { f.done() }
  })

  it('⛔ a lag that persists past two bar intervals: the values CUT and drawn, the drawings withheld by name (`runtime:request-lag`), the drawing note says why, never the depth sentence', async () => {
    const f = await fredOnAChart()
    try {
      f.settle(rsChartThrough(13, 40), rsSecondary(spx5Through(13, 40)))
      expect(f.servedByRun()).toBe(true)
      f.settle(rsChartThrough(13, 55), rsSecondary(spx5Through(13, 40)))
      const r = f.reply()
      expect(r.ok).toBe(true)
      expect(r.objects.pending).toBeUndefined()
      expect(r.objects.guard).toBe(REQUEST_LAG_GUARD)
      expect(r.objects.reason).toMatch(SAYS.lag)
      expect(r.objects.reason).not.toMatch(SAYS.depth)
      expect(r.objects.reason).not.toMatch(SAYS.hole)
      expect(f.drawn().newest).toBe(ET(LAST, 13, 40))
      expect(f.servedByRun()).toBe(false)
      expect(f.why()).toMatch(/the newest bars of another symbol the script reads haven't arrived on this chart/)
      expect(f.notice()).toBeNull()
    } finally { f.done() }
  })

  it('⚰️ (C) REPRODUCED: the chart grows ONE bar before SPX has it -> the worker\'s reply was WITHHELD `runtime:history-start`', async () => {
    __newestTailWaitOffForTests(true)
    const f = await fredOnAChart()
    try {
      f.settle(rsChartThrough(13, 45), rsSecondary(spx5Through(13, 45)))
      expect(f.servedByRun()).toBe(true)
      f.settle(rsChartThrough(13, 50), rsSecondary(spx5Through(13, 45)))
      const r = f.reply()
      expect(r.ok).toBe(true)
      expect(r.objects.status).toBe('WITHHELD')
      expect(r.objects.guard).toBe('runtime:history-start')
      expect(r.objects.reason).toMatch(/a run did not finish its drawings/)
      // and SPX arriving serves it: the same tail lag, one bar deep
      f.settle(rsChartThrough(13, 50), rsSecondary(spx5Through(13, 50)))
      expect(f.reply().objects.status).toBe('ok')
      expect(f.servedByRun()).toBe(true)
    } finally { f.done() }
  })

  it('⭐ (C) FIXED: one bar ahead of SPX waits (picture kept, SPX named), then SPX arrives and it serves', async () => {
    const f = await fredOnAChart()
    try {
      f.settle(rsChartThrough(13, 45), rsSecondary(spx5Through(13, 45)))
      expect(f.servedByRun()).toBe(true)
      const served = f.log[f.log.length - 1]
      f.settle(rsChartThrough(13, 50), rsSecondary(spx5Through(13, 45)))
      const r = f.reply()
      // a wait, named: the drawings' (where the plain run draws, `runtimeObjectsWithheld`, as the lane rail above shows)
      // or the whole run's. MEASURED for Fred RS: the whole run's (`ok: false`, `pending`, `waitingFor: 'SPX'`): its
      // plain program, built without its drawings, does not stand on its own, so the drawing run's wait is the answer
      const wait = r.ok ? r.objects : r.error
      expect(wait && wait.pending, JSON.stringify(r).slice(0, 600)).toBe(true)
      expect(wait.waitingFor).toBe('SPX')
      expect(wait.guard).toBe(REQUEST_GUARD)
      expect(wait.guard).not.toBe('runtime:history-start')
      expect(f.log[f.log.length - 1]).toBe(served)
      expect(f.notice()).toMatch(WAITING)
      f.settle(rsChartThrough(13, 50), rsSecondary(spx5Through(13, 50)))
      expect(f.reply().objects.status).toBe('ok')
      expect(f.servedByRun()).toBe(true)
      expect(f.notice()).toBeNull()
    } finally { f.done() }
  })

  it('⛔ the kept picture is THIS pane\'s only: another symbol\'s run in the worker never shows RDDT\'s drawings', async () => {
    const f = await fredOnAChart()
    try {
      f.settle(rsChartThrough(13, 40), rsSecondary(spx5Through(13, 40)))
      expect(f.servedByRun()).toBe(true)
      f.sync(rsChartThrough(13, 50, 40), rsSecondary(spx5Through(13, 40)), AGL)
      expect(f.log[f.log.length - 1], 'a new pane draws nothing until its own run lands').toBe('EMPTY')
    } finally { f.done() }
  })

  it('⛔ a hole inside SPX\'s history (a session missing its opening bars) still refuses, a tail lag or not: no wait', async () => {
    const f = await fredOnAChart()
    try {
      const holed = SPX5_ALL.filter((b) => !(b.t >= ET(LAST, 9, 30) && b.t < ET(LAST, 10, 0)))
      f.settle(rsChartThrough(13, 50), rsSecondary(spx5Through(13, 40, holed)))
      const r = f.reply()
      expect(r.ok).toBe(false)
      expect(r.error.pending).toBeUndefined()
      expect(r.error.guard).toBe(REQUEST_GUARD)
      expect(r.error.message).toMatch(SAYS.hole)
      expect(r.error.message).not.toMatch(SAYS.depth)
      expect(f.notice()).toBeNull()
    } finally { f.done() }
  })
})

// ─── ⭐ (engine 87 train, #2076 x #2044) THE COMPUTING NOTE IS SAID ONLY WHERE THIS PANE HAS NO PICTURE ───────────────
// #2044 says "the background worker is still computing this script's drawings ... drawn when that finishes" only where the
// pane has NO picture of the instance yet. #2076 makes a pending run half KEEP its pane's served picture. ⚰️ On the merged
// tree the note asked only the signature-keyed picture record, which SPX's own update moves: a run in the worker over a
// KEPT picture said "still computing" while the drawings were drawn. Both now read ONE condition (`keepsServedPicture`).
const COMPUTING = registry.RUNTIME_DRAWINGS_COMPUTING_SENTENCE
describe('(engine 87 train) #2076 x #2044: "still computing" is never said over a kept picture, and still said where there is none', () => {
  it('a live bar that SPX keeps up with (SPX\'s update moves the run\'s key): in the worker, the picture KEPT and the strip SILENT', async () => {
    const f = await fredOnAChart()
    try {
      f.settle(rsChartThrough(13, 40), rsSecondary(spx5Through(13, 40)))
      expect(f.servedByRun()).toBe(true)
      const served = f.log[f.log.length - 1]
      expect(served).toMatch(/^run:/)
      expect(f.notice()).toBeNull()
      // the chart's next bar and SPX's land together: a run in the worker
      const chart = rsChartThrough(13, 45)
      const spx = rsSecondary(spx5Through(13, 45))
      f.sync(chart, spx)
      expect(f.w.queue.length, 'a run is in the worker').toBe(1)
      expect(f.log[f.log.length - 1], 'in the worker: the served picture stays').toBe(served)
      expect(f.notice(), 'a kept picture is a picture: no "still computing"').toBeNull()
      f.flush()
      f.sync(chart, spx)
      expect(f.servedByRun()).toBe(true)
      expect(f.log[f.log.length - 1]).not.toBe(served)
      expect(f.notice()).toBeNull()
      // and after a WAIT: SPX's update lands, the run is in the worker over the kept picture: the wait is gone, no "computing"
      const served2 = f.log[f.log.length - 1]
      const chart2 = rsChartThrough(13, 55)
      f.settle(chart2, rsSecondary(spx5Through(13, 45)))
      expect(f.notice()).toMatch(WAITING)
      const caughtUp = rsSecondary(spx5Through(13, 55))
      f.sync(chart2, caughtUp)
      expect(f.w.queue.length, 'SPX\'s update: a run is in the worker').toBe(1)
      expect(f.log[f.log.length - 1]).toBe(served2)
      expect(f.notice()).toBeNull()
      f.flush()
      f.sync(chart2, caughtUp)
      expect(f.servedByRun()).toBe(true)
      expect(f.notice()).toBeNull()
    } finally { f.done() }
  })

  it('⛔ CONTROL, a first load: no picture yet, so the strip says the run is computing (#2044, unchanged)', async () => {
    const f = await fredOnAChart()
    try {
      const chart = rsChartThrough(13, 40)
      const spx = rsSecondary(spx5Through(13, 40))
      f.sync(chart, spx)
      expect(f.w.queue.length, 'a run is in the worker').toBe(1)
      expect(f.log.filter((x) => x.startsWith('run:'))).toEqual([])
      expect(f.notice()).toBe(COMPUTING)
      f.flush()
      f.sync(chart, spx)
      expect(f.servedByRun()).toBe(true)
      expect(f.notice()).toBeNull()
    } finally { f.done() }
  })

  it('⛔ CONTROL, a symbol switch: RDDT\'s picture is not this pane\'s, so the new pane says it is computing (#2044, unchanged)', async () => {
    const f = await fredOnAChart()
    try {
      f.settle(rsChartThrough(13, 40), rsSecondary(spx5Through(13, 40)))
      expect(f.servedByRun()).toBe(true)
      expect(f.notice()).toBeNull()
      f.sync(rsChartThrough(13, 40, 40), rsSecondary(spx5Through(13, 40)), AGL)
      expect(f.w.queue.length, 'AGL\'s run is in the worker').toBe(1)
      expect(f.log[f.log.length - 1]).toBe('EMPTY')
      expect(f.notice()).toBe(COMPUTING)
    } finally { f.done() }
  })
})

describe('a RUNTIME document is CUT too (e91 (2b)): drawn up to the lag, the newer bars named on the strip; never a stop', () => {
  const def = { ...runDef(SRC), id: 'u_tl-rt', compute: { ...runDef(SRC).compute, fn: 'runtime:u_tl-rt', objects: false } }
  it('two bars behind: the values drawn up to SPX\'s newest, no stop and no whole-run wait; the strip names the newer bars', () => {
    const cols = registry.computeFor(def, SHALLOW, {}, ctx5(secondaryOf(spxThrough(13, 40))))
    expect(registry.runtimeRunStopOf(def, cols)).toBeNull()
    expect(registry.runtimeRunWaitingOf(def, cols)).toBeNull()
    expect(lastDrawn(cols.x)).toBe(cutOf(SHALLOW, 13, 40) - 1)
    expect(chartClockReport(cols).withheld.map((r) => r.reason)).toContain(tailCutSentence(['SPX']))
  })
  it('⚰️ REPRODUCED, the cut switched off: no columns, the whole run waits (`runtimeRunWaitingOf`)', () => {
    __tailCutOffForTests(true)
    // its own document (the registry keeps the answer of the cut run above by document)
    const off = { ...def, id: 'u_tl-rt-off', compute: { ...def.compute, fn: 'runtime:u_tl-rt-off' } }
    const cols = registry.computeFor(off, SHALLOW, {}, ctx5(secondaryOf(spxThrough(13, 40))))
    const wait = registry.runtimeRunWaitingOf(off, cols)
    expect(wait).toMatchObject({ waitingFor: 'SPX', what: 'values' })
    expect(wait.sentence).toBe("waiting for `SPX`'s newest bar, which has not arrived yet; this script is drawn bar by bar when it does")
  })
  it('⛔ past the bound: cut by name too (the lag\'s code and sentence on the strip), never a stop', () => {
    const cols = registry.computeFor(def, SHALLOW, {}, ctx5(secondaryOf(spxThrough(13, 35))))
    expect(registry.runtimeRunWaitingOf(def, cols)).toBeNull()
    expect(registry.runtimeRunStopOf(def, cols)).toBeNull()
    expect(lastDrawn(cols.x)).toBe(cutOf(SHALLOW, 13, 35) - 1)
    const row = chartClockReport(cols).withheld.find((r) => r.code === REQUEST_LAG_GUARD)
    expect(row.reason).toMatch(SAYS.lag)
  })
  it('two series named: the newest bars of both', () => {
    expect(registry.runtimeDrawingsWaitingSentence('SPX,QQQ')).toBe('waiting for the newest bars of `SPX` and `QQQ`, which have '
      + "not arrived yet; this script's drawings are drawn when they do")
  })
})
