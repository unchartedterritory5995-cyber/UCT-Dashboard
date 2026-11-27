// ─── ⭐⭐ (e100, coordinator ruling 2026-11-26) — EVERY WHOLE-RUN COUNT SCALES WITH THE BARS A RUN COVERS ──────────
//
// TradingView limits a script by TIME ("The execution time for any loop on any single bar is limited to 500
// milliseconds", and a per-plan time for the whole run) and drawings by COUNT; it counts no instruction, call, loop
// pass, drawing operation or window cell (https://www.tradingview.com/pine-script-docs/writing/limitations/). Our
// whole-chart counts were crossed by honest scripts through chart LENGTH alone (deep daily census, every count lifted,
// SPY 1D 8,509 / JPM 1D 14,546 bars):
//   delta-rsi-oscillator-strategy  CONSTANT 1,201 calls, 1,163 loop passes, 44,471 instructions a bar
//   kernel-channel-backquant       CONSTANT 403 loop passes, 304 calls a bar
//   trendline-pivots-quantvue      drawing calls GROWING with the chart: 366 / 1,564 / 2,608 a bar
//   machine-learning-moving-avg    5,500 window cells, 669-788 array operations a bar
// So each of those ceilings is `max(floor, rate x bars)` (`limits.js::PER_BAR_LIMITS`). These rails hold:
//   1. the table: every rate, every floor unchanged, and what does NOT scale;
//   2. delta-rsi over SPY 1D completes with the shipped limits (calls, loops AND instructions past their floors);
//   3. kernel-channel over JPM 1D (14,546 bars) completes (loop passes past 5,000,000);
//   4. trendline-pivots over SPY 1D completes (drawing calls past 2,000,000);
//   5. a runaway of each count still stops BY NAME, at the scaled ceiling, naming the bars it was set for;
//   6. below the floor the stop is the old one: same bar, same numbers, no "for N bars";
//   7. a caller that NAMES a ceiling gets exactly that number.
// Member wall clock is not these counts' job: the worker's budget (`runtimePaneBudgetFor`) and the server's bound it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { DEFAULT_LIMITS, RuntimeLimitError, PER_BAR_LIMITS, scaledCeiling } from '../limits.js'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeLimitSentence } from '../runtimeColumns.js'
import * as registry from '../../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from '../../__tests__/vendorHarness/ourSide'

const REPO = path.resolve(process.cwd(), '..')
beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })
afterEach(() => vi.unstubAllEnvs())

const daily = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 7) + i * 0.05
  return { t: 1500000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) * 10 }
})
const head = '//@version=6\nindicator("pbl", overlay = false)\n'
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
    return { counts: res.budget.counts, limits: res.budget.limits }
  } catch (err) {
    if (!(err instanceof RuntimeLimitError)) throw err
    return { err, stoppedOn: last + 1 }
  }
}

// ── the corpus scripts, through the member door, over the committed deep daily captures ──
const SPY = 'tests/fixtures/vendor/harness/machine-learning-moving-average-backquant-spy-1d-2026-11-17.json'
const JPM = 'tests/fixtures/vendor/harness/black-scholes-option-pricing-model-w-greeks-loxx-jpm-1d-2026-11-15.json'
function deepRun(script, capture) {
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const door = enterMemberDoor(fs.readFileSync(path.join(REPO, 'corpus/committed', script), 'utf8'))
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  expect(door.built && door.built.lane, `${script} is served on the runtime lane`).toBe('runtime')
  const rows = JSON.parse(fs.readFileSync(path.join(REPO, capture), 'utf8')).bars.rows
  let counts = null
  let limits = null
  let err = null
  let out = null
  try {
    out = computeRuntimeColumns(door.def, rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })),
      { tf: 'D', newestBarIsForming: false, historyFromListing: true },
      // WALL_TIME named (it does not scale; naming it opts only it out): the VM's 5,000 ms backstop is a time, and a
      // runner's speed is not what these rails hold. A member's clock is the worker's budget, at most 12,000 ms.
      { budgetMs: 600000, limits: { WALL_TIME: 600000 }, onBudget: (b) => { counts = { ...b.counts }; limits = b.limits } })
  } catch (e) { err = e }
  return { bars: rows.length, out, counts, limits, err }
}

describe('every whole-run count scales with the bars a run covers', () => {
  it('1. the table: each rate, each floor unchanged, and what does not scale', () => {
    expect({ ...PER_BAR_LIMITS }).toEqual({ ARRAY_OPERATIONS: 2500, TOTAL_INSTRUCTIONS: 100000, LOOP_ITERATIONS: 2500,
      CALL_COUNT: 2500, OBJECT_OPERATIONS: 5000, WINDOW_CELLS: 25000 })
    const floors = { ARRAY_OPERATIONS: 2000000, TOTAL_INSTRUCTIONS: 200000000, LOOP_ITERATIONS: 5000000,
      CALL_COUNT: 5000000, OBJECT_OPERATIONS: 2000000, WINDOW_CELLS: 100000000 }
    for (const [k, floor] of Object.entries(floors)) {
      expect(DEFAULT_LIMITS[k], `${k} floor`).toBe(floor)
      const until = floor / PER_BAR_LIMITS[k]
      expect(scaledCeiling(k, floor, until), `${k} at ${until} bars is its floor`).toBe(floor)
      expect(scaledCeiling(k, floor, 32768), `${k} at the HISTORY ceiling`).toBe(PER_BAR_LIMITS[k] * 32768)
    }
    // a peak, and the one cumulative count measured nowhere near its fixed ceiling (16 a bar at most), do not scale
    for (const k of ['CARRIED_STEPS', 'INSTRUCTIONS_PER_BAR', 'WHILE_ITERATIONS', 'CALL_DEPTH', 'LIVE_OBJECTS', 'ARRAY_ELEMENTS', 'MEMORY']) {
      expect(scaledCeiling(k, DEFAULT_LIMITS[k], 32768), k).toBe(DEFAULT_LIMITS[k])
    }
  })

  it('2. delta-rsi over SPY 1D (8,509 bars) completes: calls, loop passes and instructions all past their floors', () => {
    const r = deepRun('delta-rsi-oscillator-strategy__z4Yj46FVTX.pine', SPY)
    expect(r.err, r.err && r.err.message).toBe(null)
    expect(r.bars).toBe(8509)
    expect(Object.keys(r.out).length).toBeGreaterThan(0)
    expect(r.counts.CALL_COUNT).toBeGreaterThan(DEFAULT_LIMITS.CALL_COUNT)
    expect(r.counts.LOOP_ITERATIONS).toBeGreaterThan(DEFAULT_LIMITS.LOOP_ITERATIONS)
    expect(r.counts.TOTAL_INSTRUCTIONS, 'past what 30,000 a bar allowed').toBeGreaterThan(30000 * 8509)
    for (const k of ['CALL_COUNT', 'LOOP_ITERATIONS', 'TOTAL_INSTRUCTIONS']) expect(r.counts[k]).toBeLessThanOrEqual(r.limits[k])
  }, 120000)

  it('3. kernel-channel over JPM 1D (14,546 bars) completes: loop passes past 5,000,000', () => {
    const r = deepRun('kernel-channel-backquant__d8c4b7f75c.pine', JPM)
    expect(r.err, r.err && r.err.message).toBe(null)
    expect(r.bars).toBe(14546)
    expect(r.counts.LOOP_ITERATIONS).toBeGreaterThan(DEFAULT_LIMITS.LOOP_ITERATIONS)
    expect(r.counts.LOOP_ITERATIONS).toBeLessThanOrEqual(r.limits.LOOP_ITERATIONS)
  }, 120000)

  it('4. trendline-pivots over SPY 1D (8,509 bars) completes: drawing calls past 2,000,000', () => {
    const r = deepRun('trendline-pivots-quantvue__3dc9be8b73.pine', SPY)
    expect(r.err, r.err && r.err.message).toBe(null)
    expect(r.counts.OBJECT_OPERATIONS).toBeGreaterThan(DEFAULT_LIMITS.OBJECT_OPERATIONS)
    expect(r.counts.OBJECT_OPERATIONS).toBeLessThanOrEqual(r.limits.OBJECT_OPERATIONS)
  }, 120000)

  // a runaway of each count: more than its rate on EVERY bar, and under every other rate
  const RUNAWAY = {
    // 3,000 passes a bar (~63,000 instructions: under 100,000)
    LOOP_ITERATIONS: ['float s = 0.0\nfor i = 0 to 2999\n    s += i\nplot(s)\n', 8000],
    // 3,000 calls a bar over 1,500 passes
    CALL_COUNT: ['f(x) => x + 1\nfloat s = 0.0\nfor i = 0 to 1499\n    s := f(f(s))\nplot(s)\n', 8000],
    // 6,000 drawing calls a bar over 1,000 passes
    OBJECT_OPERATIONS: ['var l = line.new(bar_index, close, bar_index, close)\nfor i = 0 to 999\n'
      + '    line.set_x1(l, bar_index)\n    line.set_y1(l, close)\n    line.set_x2(l, bar_index)\n'
      + '    line.set_y2(l, close)\n    line.set_width(l, 1)\n    line.set_color(l, color.red)\nplot(close)\n', 1000],
    // seven 4,000-cell windows: ~28,000 cells a bar
    WINDOW_CELLS: ['var x = 0.0\nx := close\nplot(ta.sma(x, 4000) + ta.sma(x, 4001) + ta.sma(x, 4002) + ta.sma(x, 4003)'
      + ' + ta.sma(x, 4004) + ta.sma(x, 4005) + ta.sma(x, 4006))\n', 8000],
  }
  for (const [limit, [src, n]] of Object.entries(RUNAWAY)) {
    it(`5. ⛔ a ${limit} runaway still stops BY NAME at the scaled ceiling, naming its ${n} bars`, () => {
      const r = vmRun(src, n)
      expect(r.err, `${limit}: stopped`).toBeInstanceOf(RuntimeLimitError)
      expect(r.err.limit).toBe(limit)
      expect(r.err.ceiling).toBe(scaledCeiling(limit, DEFAULT_LIMITS[limit], n))
      expect(r.err.ceiling).toBe(PER_BAR_LIMITS[limit] * n)
      expect(r.err.coveredBars).toBe(n)
      expect(r.stoppedOn, 'stopped before the last bar').toBeLessThan(n)
      expect(runtimeLimitSentence(r.err, r.stoppedOn, n)).toMatch(new RegExp(`for ${n.toLocaleString('en-US')} bars`))
    }, 120000)
  }

  it('6. below the floor the stop is the old one: same bar, same numbers, no "for N bars"', () => {
    const src = RUNAWAY.LOOP_ITERATIONS[0]   // 3,000 a bar: 6,000,000 over 1,999 bars, past the 5,000,000 floor
    const scaled = vmRun(src, 1999)
    const fixed = vmRun(src, 1999, { LOOP_ITERATIONS: 5000000 })
    expect(scaled.err.limit).toBe('LOOP_ITERATIONS')
    expect(scaled.err.ceiling).toBe(5000000)
    expect(scaled.err.coveredBars).toBeUndefined()
    expect([scaled.stoppedOn, scaled.err.reached]).toEqual([fixed.stoppedOn, fixed.err.reached])
  }, 120000)

  it('7. a caller that NAMES a ceiling gets exactly that number (it does not scale)', () => {
    const r = vmRun(RUNAWAY.CALL_COUNT[0], 8000, { CALL_COUNT: 5000000 })
    expect(r.err.limit).toBe('CALL_COUNT')
    expect(r.err.ceiling).toBe(5000000)
    expect(r.err.coveredBars).toBeUndefined()
  }, 120000)
})
