// ─── ⭐⭐ (Fred RS filled chart, coordinator ruling 2026-11-19, engine 84) — ARRAY OPERATIONS PER BAR COVERED ──
//
// `limits.js::ARRAY_OPERATIONS` was a whole-chart count (2,000,000) that an honest script crossed through chart LENGTH
// alone: Fred RS's run half makes 245 array operations a bar and stopped at bar 8,164 of the 11,520 a filled 5m
// extended-hours chart runs over. The ceiling is now `max(2,000,000, 500 × the bars the run covers)`
// (`arrayOperationsCeiling`), set once by the top-level `execute` (`Budget.coverBars`). These rails hold:
//   1. Fred RS's run half over 11,520 5m extended-hours bars is drawn, past the old 2,000,000;
//   2. a runaway (hundreds of thousands of element operations a bar) still stops BY NAME, within a few bars;
//   3. below the floor (a chart of at most 4,000 bars) a script stops on the same bar, with the same numbers and the
//      same sentence, as under the old fixed ceiling;
//   4. a run RESUMED from a checkpoint has a full run's ceiling (the bars it covers, not the bars it executes);
//   5. a stop names the ceiling that applied and the bars it was set for.
// A caller that NAMES the ceiling (a measurement, the acceptance rail's lowered ceilings) gets exactly that number.
// ⭐⭐ (e100, coordinator ruling 2026-11-26) THE RATE IS 2,500 A BAR (machine-learning-moving-average-backquant makes
// 788 a bar over JPM 1D's 14,546 bars), so the floor holds up to 800 bars; the rails below read that.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { DEFAULT_LIMITS, RuntimeLimitError, ARRAY_OPERATIONS_PER_BAR, arrayOperationsCeiling } from '../limits.js'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf } from '../runtimeColumns.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition.js'
import { OWN_DAILY_KEY } from '../../otherSymbols.js'

const REPO = path.resolve(process.cwd(), '..')
beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

// ── the VM alone, over a daily series of `n` bars (the acceptance rail's harness) ──
const daily = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 7) + i * 0.05
  return { t: 1500000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) * 10 }
})
const head = '//@version=6\nindicator("aopb", overlay = false)\n'
/** `k` array operations a bar: `array.includes` over a `k`-element array is charged per element. */
const perBar = (k) => `var a = array.new_float(${k}, -1.0)\nplot(array.includes(a, close) ? 1 : 0)\n`
function vmRun(src, n, limits) {
  const bars = daily(n)
  const built = buildRuntimeIr(head + src, { bars, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const p = lowerIrProgram(built.ir)
  const ctx = { bars: n, series: ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k]))),
    columns: p.columns, confirmed: true, barTimes: bars.map((b) => b.t), requestBars: {} }
  let last = -1
  try {
    const res = execute(p, ctx, limits, { onBar: (bar) => { last = bar } })
    return { counts: res.budget.counts, ceiling: res.budget.limits.ARRAY_OPERATIONS }
  } catch (err) {
    if (!(err instanceof RuntimeLimitError)) throw err
    return { err, stoppedOn: last + 1 }
  }
}
const doc = (source) => ({ id: 'u_aopb', compute: { kind: 'runtime', fn: 'runtime:u_aopb', rev: 1, source: head + source, outputs: { x: 0 } },
  inputs: [], meta: {} })
const dctx = (forming = false) => ({ tf: 'D', newestBarIsForming: forming, historyFromListing: true, symbol: { ticker: 'SPY', exchange: 'AMEX' } })

describe('the array-operation ceiling scales with the bars a run covers', () => {
  it('the ceiling: the 2,000,000 floor up to 800 bars, 2,500 a bar above it', () => {
    expect(ARRAY_OPERATIONS_PER_BAR).toBe(2500)
    expect(arrayOperationsCeiling(DEFAULT_LIMITS.ARRAY_OPERATIONS, 799)).toBe(2000000)
    expect(arrayOperationsCeiling(DEFAULT_LIMITS.ARRAY_OPERATIONS, 800)).toBe(2000000)
    expect(arrayOperationsCeiling(DEFAULT_LIMITS.ARRAY_OPERATIONS, 11520)).toBe(28800000)
    expect(arrayOperationsCeiling(DEFAULT_LIMITS.ARRAY_OPERATIONS, 32768)).toBe(81920000)
  })

  it("1. Fred RS's run half over 11,520 5m extended-hours bars is drawn, past the old 2,000,000", () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1'); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
    const ro = memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_aopb' }).definition.compute.runtimeObjects
    const half = { id: 'u_aopb_half', compute: { kind: 'runtime', fn: 'runtime:u_aopb_half', source: ro.source, objects: true, outputs: ro.outputs },
      meta: { runtimeHistory: 'listing' } }
    // 60 regular trading sessions (no NYSE holiday among them), 04:00-19:55 ET, and SPX's regular session on each
    const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + (day < '2026-11-01' ? 4 : 5), mm) / 1000 }
    const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
    const sessions = []
    for (let d = '2026-11-13'; sessions.length < 60; d = isoPlus(d, -1)) {
      if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) && d !== '2026-09-07') sessions.unshift(d)
    }
    const chart = sessions.flatMap((d, k) => Array.from({ length: 192 }, (_, j) => {
      const c = 90 + k * 0.05 + Math.sin((k * 192 + j) / 9) + Math.cos(j / 23)
      return { t: ET(d, 4, 0) + j * 300, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 + j }
    }))
    const spx = sessions.flatMap((d, k) => Array.from({ length: 78 }, (_, j) => {
      const c = 7300 + k * 5 + Math.cos(j / 7) * 3
      return { t: ET(d, 9, 30) + j * 300, o: c, h: c + 1, l: c - 1, c, v: 1 }
    }))
    // the session BEFORE the chart's first (the day its first bars read): by the fixture's own session rule. (2026-11-19:
    // this row was `sessions[0] - 3 days`, a Tuesday before a Friday start, which only drew because the daily read then
    // carried an older row forward; a daily read now names the session it reads, `dailyReadNoCarry.test.js`)
    let prev = isoPlus(sessions[0], -1)
    while ([0, 6].includes(new Date(`${prev}T12:00:00Z`).getUTCDay()) || prev === '2026-09-07') prev = isoPlus(prev, -1)
    const spxd = [prev, ...sessions].map((d, k) => ({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: 7290 + k * 5, v: 1 }))
    const ownd = [prev, ...sessions].map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 89 + k * 0.1, v: 1 }))
    const seed = []
    for (let d = isoPlus(sessions[0], -20), k = 0; d <= '2026-11-16'; d = isoPlus(d, 1), k += 1) seed.push({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 })
    const ctx = { tf: '5', newestBarIsForming: false, historyFromListing: true,
      symbol: { ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information', sector: 'Communication Services', securityType: 'stock' },
      secondary: new Map([['SPX', { bars: spx, status: 'available' }], ['SPX@D', { bars: spxd, status: 'available' }],
        [OWN_DAILY_KEY, { bars: ownd, status: 'available' }], ['SEED_FRED6725_RS_RATING:RSRATING@D', { bars: seed, status: 'available' }]]),
      exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) }
    expect(chart.length).toBe(11520)
    let counts = null
    const cols = computeRuntimeColumns(half, chart, ctx, { now: () => 0, onBudget: (b) => { counts = { ...b.counts } } })
    expect(Object.keys(cols).length).toBeGreaterThan(0)
    expect(counts.ARRAY_OPERATIONS, 'past the old whole-chart ceiling').toBeGreaterThan(2000000)
    expect(counts.ARRAY_OPERATIONS).toBeLessThanOrEqual(arrayOperationsCeiling(2000000, 11520))
  })

  it('2. a runaway still stops by name, within a few bars, at any length', () => {
    // 10 x 50,000 element operations a bar
    const runaway = 'var a = array.new_float(50000, -1.0)\nfloat s = 0.0\nfor i = 0 to 9\n    s += array.includes(a, close) ? 1 : 0\nplot(s)\n'
    for (const n of [2000, 10000]) {
      const r = vmRun(runaway, n)
      expect(r.err, `${n} bars`).toBeInstanceOf(RuntimeLimitError)
      expect(r.err.limit).toBe('ARRAY_OPERATIONS')
      expect(r.err.ceiling).toBe(arrayOperationsCeiling(2000000, n))
      expect(r.stoppedOn, `${n} bars: stopped within a few bars`).toBeLessThanOrEqual(Math.ceil(r.err.ceiling / 500000))
    }
  })

  it('3. below the floor a script stops on the same bar, with the same numbers and sentence, as under the old fixed ceiling', () => {
    const src = perBar(3000)
    const now = vmRun(src, 799)
    const before = vmRun(src, 799, { ARRAY_OPERATIONS: 2000000 })   // named: exactly the old fixed ceiling
    expect(now.err).toBeInstanceOf(RuntimeLimitError)
    expect([now.err.limit, now.err.ceiling, now.err.reached, now.stoppedOn]).toEqual([before.err.limit, before.err.ceiling, before.err.reached, before.stoppedOn])
    expect(now.err.ceiling).toBe(2000000)
    expect(now.err.coveredBars, 'the floor names no bars').toBeUndefined()
    // and through the product: the same member sentence
    const bars = daily(799)
    let a = null
    let b = null
    try { computeRuntimeColumns(doc(src), bars, dctx(), { now: () => 0 }) } catch (e) { a = e.message }
    try { computeRuntimeColumns(doc(src), bars, dctx(), { now: () => 0, limits: { ARRAY_OPERATIONS: 2000000 } }) } catch (e) { b = e.message }
    expect(a).toMatch(/at most 2,000,000, it reached/)
    expect(a).toBe(b)
  })

  it('4. a run resumed from a checkpoint has a full run\'s ceiling: the bars it covers, not the bars it executes', () => {
    const src = perBar(450)    // 2.7 M over 6,000 bars: past the 2 M floor, under the 15 M ceiling
    const bars = daily(6000)
    const cold = computeRuntimeColumns(doc(src), bars, dctx(true), { now: () => 0 })
    expect(runtimeIncrementalOf(cold).resumedFrom).toBe(null)
    const tick = bars.map((b, i) => (i === bars.length - 1 ? { ...b, c: b.c + 0.5, h: b.h + 0.5 } : b))
    const warm = computeRuntimeColumns(doc(src), tick, dctx(true), { now: () => 0 })
    expect(runtimeIncrementalOf(warm).resumedFrom, 'resumed').toBe(bars.length - 2)
    resetRuntimeSessions()
    const full = computeRuntimeColumns(doc(src), tick, dctx(true), { now: () => 0 })
    for (const k of Object.keys(full)) expect(Array.from(warm[k])).toEqual(Array.from(full[k]))
  })

  it('5. a stop names the ceiling that applied and the bars it was set for', () => {
    let msg = null
    try { computeRuntimeColumns(doc(perBar(3000)), daily(8000), dctx(), { now: () => 0 }) } catch (e) { msg = e.message }
    expect(msg).toMatch(/array operations a script may make over the whole chart \(at most 20,000,000 for 8,000 bars, it reached 20,00\d,\d{3}\) on bar 6,66\d of 8,000/)
  })
})
