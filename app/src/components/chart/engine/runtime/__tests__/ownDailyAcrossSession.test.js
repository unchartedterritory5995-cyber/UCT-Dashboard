// ─── ⭐⭐ ENGINE 85 TRAIN — #2009 x #2004: THE OWN DAILY ENTRY APPEARS AND DISAPPEARS INSIDE ONE SESSION ───────────
//
// #2009 makes the chart fetch its own daily rows (`OWN_DAILY_KEY`) for Fred RS on an intraday chart: the predicate
// (`runtimeReadsOwnDaily`) is asked with the chart's symbol binding, and a build that cannot answer says NEEDED. So on
// a live chart the entry now APPEARS in the supply of a run that was refused without it (and can disappear again, a
// store answer that changes). #2004 keeps ONE session across a run's supply (`runKey` without `requestSupplyKey`) and
// resumes it only when every requested value its checkpoint read agrees (`supplyAgreesTo`). These rails hold the two
// together, in ONE session, against a cold run (`incremental: false`) at every step:
//   * absent: refused by name ("not handed that symbol's daily bars"); present: served;
//   * absent again: refused again, never the previous session's columns;
//   * present again with the same rows (a tick): RESUMED, and what it draws is the cold run's, bit for bit;
//   * present with a daily row corrected BEFORE the checkpoint: NOT resumed, and drawn as the cold run draws it;
//   * the predicate that decides the fetch answers yes for this read with the binding, and NEEDED without one.
// ⛔ Proved able to fail: `supplyAgreesTo` made to answer yes on everything turns the corrected-row step RED.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf, runtimeReadsOwnDaily,
  __resumeAcrossSupplyOffForTests,
} from '../runtimeColumns.js'
import { OWN_DAILY_KEY } from '../../otherSymbols.js'

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })
afterEach(() => { __resumeAcrossSupplyOffForTests(false); resetRuntimeSessions(); resetRuntimeLedgers() })

// ── a regular-session 5m chart of RDDT, and RDDT's own daily rows ──
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const weekdays = (from, to) => { const out = []; for (let d = from; d <= to; d = isoPlus(d, 1)) if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) out.push(d); return out }
const SESS = weekdays('2026-11-02', '2026-11-12')
const CHART = SESS.flatMap((d, k) => Array.from({ length: 78 }, (_, j) => {
  const c = 90 + k + Math.sin(j / 9)
  return { t: ET(d, 9, 30) + j * 300, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 + j }
}))
const PREV = '2026-10-30'
const OWND = [PREV, ...SESS].map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 89 + k, v: 1 }))
const RDDT = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information',
  sector: 'Communication Services', securityType: 'Stock' })
const ctxOf = (own) => ({
  tf: '5', newestBarIsForming: true, historyFromListing: true, symbol: RDDT,
  secondary: new Map(own ? [[OWN_DAILY_KEY, { bars: own, status: 'available' }]] : []),
  exchangeOf: () => null,
})
const pine = (lines) => ['//@version=6', 'indicator("own daily", overlay = false)', ...lines].join('\n')
// the chart's OWN symbol at "D" above the chart (a request target `{own, above}`), carried bar to bar (`acc`), so a run
// resumed from a checkpoint built on other daily values cannot draw what a cold run draws
const OWN_SRC = pine([
  'd = request.security(syminfo.tickerid, "D", close)',
  'plot(d - d[1])',
  'var float acc = 0.0',
  'acc += nz(d) / 1000',
  'plot(acc)',
])
const DEF = { id: 'u_own_session', compute: { kind: 'runtime', fn: 'runtime:u_own_session', rev: 1, source: OWN_SRC,
  outputs: { x: 0, y: 1 } }, inputs: [], meta: {} }

function run(rows, ctx, extra = {}) {
  try {
    const cols = computeRuntimeColumns(DEF, rows, ctx, { now: () => 0, ...extra })
    return { cols, inc: runtimeIncrementalOf(cols) }
  } catch (e) { return { refused: `${e.guard}: ${e.message}` } }
}
const cold = (rows, ctx) => run(rows, ctx, { incremental: false })
const expectSameDrawn = (a, b, at) => {
  expect(a.refused, at).toBe(b.refused)
  if (b.refused) return
  expect(Object.keys(a.cols), at).toEqual(Object.keys(b.cols))
  for (const k of Object.keys(b.cols)) {
    expect(a.cols[k].length, `${at} ${k}`).toBe(b.cols[k].length)
    for (let i = 0; i < b.cols[k].length; i += 1) if (!Object.is(a.cols[k][i], b.cols[k][i])) expect.fail(`${at}: ${k}[${i}] ${a.cols[k][i]} vs ${b.cols[k][i]}`)
  }
}
// a tick: the newest (forming) bar's close moves
const tick = (bars, dc) => bars.map((b, k) => (k === bars.length - 1 ? { ...b, c: b.c + dc, h: Math.max(b.h, b.c + dc) } : b))
// a daily row corrected: row `j`'s close moves
const corrected = (rows, j, dc) => rows.map((r, k) => (k === j ? { ...r, c: r.c + dc } : r))

describe('#2009 x #2004: the own daily entry appears and disappears inside one session', () => {
  it('the predicate that decides the fetch answers yes for this read with the binding, and NEEDED without one', () => {
    expect(runtimeReadsOwnDaily(OWN_SRC, '5', RDDT)).toBe(true)
    expect(runtimeReadsOwnDaily(OWN_SRC, '5')).toBe(true)
    // a build refused for want of a binding field (it branches on `syminfo.industry`) answers NEEDED
    const BRANCH = pine(['x = 1.0', "if (syminfo.industry == 'Software')", '    x := 2.0',
      'd = request.security(syminfo.tickerid, "D", close)', 'plot(d * x)'])
    expect(runtimeReadsOwnDaily(BRANCH, '5', { ticker: 'RDDT', exchange: 'NYSE' })).toBe(true)
    expect(runtimeReadsOwnDaily(BRANCH, '5', RDDT)).toBe(true)
    // CONTROL: a daily chart never asks (`isIntradayTf`), and a script that reads no own row says no
    expect(runtimeReadsOwnDaily(OWN_SRC, 'D', RDDT)).toBe(false)
    expect(runtimeReadsOwnDaily(pine(['plot(close)']), '5', RDDT)).toBe(false)
  })

  for (const resumeOn of [true, false]) {
    it(`${resumeOn ? 'resume across a supply ON' : 'CONTROL: resume across a supply OFF'}: absent, present, absent, present (a tick), corrected: each step is the cold run's`, () => {
      __resumeAcrossSupplyOffForTests(!resumeOn)
      // 1. absent: refused by name
      const a0 = run(CHART, ctxOf(null))
      expect(a0.refused).toMatch(/runtime:request: .*not handed that symbol's daily bars/)
      expectSameDrawn(a0, cold(CHART, ctxOf(null)), 'absent')
      // 2. present: served
      const p1 = run(CHART, ctxOf(OWND))
      expect(p1.refused, 'served once the entry is handed').toBeUndefined()
      expectSameDrawn(p1, cold(CHART, ctxOf(OWND)), 'present')
      expect(p1.cols.y.some(Number.isFinite), 'it draws').toBe(true)
      // 3. absent again: refused again, never the previous run's columns
      const a2 = run(tick(CHART, 0.05), ctxOf(null))
      expect(a2.refused).toMatch(/not handed that symbol's daily bars/)
      // 4. present again, the same rows, a tick: resumed (door open) and drawn as a cold run draws it
      const t3rows = tick(CHART, 0.1)
      const p3 = run(t3rows, ctxOf(OWND))
      expectSameDrawn(p3, cold(t3rows, ctxOf(OWND)), 'present again (a tick)')
      if (resumeOn) expect(p3.inc.resumedFrom, `resumed (${p3.inc.why})`).toBe(CHART.length - 2)
      else expect(p3.inc.resumedFrom, 'the door shut: a full run').toBe(null)
      // 5. a daily row corrected BEFORE the checkpoint: not resumed, drawn as a cold run draws it
      const own5 = corrected(OWND, 2, 7)
      const t5rows = tick(CHART, 0.2)
      const p5 = run(t5rows, ctxOf(own5))
      expectSameDrawn(p5, cold(t5rows, ctxOf(own5)), 'a daily row corrected before the checkpoint')
      expect(p5.inc.resumedFrom, `not resumed (${p5.inc.why})`).toBe(null)
    })
  }
})
