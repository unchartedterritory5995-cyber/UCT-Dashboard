// app/src/components/chart/engine/runtime/__tests__/rt17PerBarWork.test.js
//
// ─── RT17 (2026-10-04): THE CHARGED WORK LIMITS COUNT ONE BAR, NOT THE RUN ──
//
// `CALL_COUNT`, `ARRAY_OPERATIONS`, `WINDOW_CELLS` and `CARRIED_STEPS` were
// run-wide totals (5,000,000 / 2,000,000 / 100,000,000 / 100,000,000). None has a
// TradingView counterpart: TradingView bounds a script by elapsed TIME (20 s / 40 s
// a run, 500 ms a loop) and by collection SIZE, never by a count of operations
// (`docs/pine/pine-presentation-spec.md` §3.5). A run-wide count of a per-bar cost
// scales with HISTORY, not with the script — wyckoff-accumulation-distribution
// costs ~262 array operations a bar and stopped by name on bar 7,628 of SPY's
// 8,477 (W17R), the class RT10 fixed for `LOOP_ITERATIONS`.
//
// These rails pin, for each limit:
//   1. an honest fixed per-bar cost over a history whose RUN total passes the old
//      run-wide ceiling runs to the end, and the count is the WORST BAR (a peak);
//   2. a runaway stops by name ON THE BAR it runs away in, in milliseconds;
//   3. the ceiling is DERIVED (`TOTAL_INSTRUCTIONS / HISTORY`), never restated,
//      so the longest history cannot spend more element work than the run's
//      instruction safety allows — and `TOTAL_INSTRUCTIONS` stays run-wide;
//   4. a run nested inside a bar (a request) hands the outer bar its count back.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { Budget, DEFAULT_LIMITS, PER_BAR_CHARGED, RuntimeLimitError } from '../limits.js'

const T0 = 1700000000
const barsOf = (n, base = 100) => Array.from({ length: n }, (_, i) => (
  { t: T0 + i * 86400, o: base - 1 + (i % 7), h: base + 1 + (i % 7), l: base - 2 + (i % 7), c: base + (i % 5), v: 1000 + i }))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))

/** Run `src` on `n` synthetic daily bars; returns the budget, the outputs, the
 *  stop (or null), the bars that finished and how long the run took. */
function run(src, n, limits, requestBars) {
  const bars = barsOf(n)
  const built = buildRuntimeIr(`//@version=6\nindicator("rt17 work")\n${src}`, { bars, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const budget = new Budget(limits)
  let finished = 0
  let err = null
  let outputs = null
  const t0 = performance.now()
  try {
    outputs = execute(program, {
      bars: n, series: seriesOf(bars), columns: program.columns, confirmed: true,
      barTimes: bars.map((b) => b.t), requestBars: requestBars || {},
    }, undefined, { budget, onBar: (b) => { finished = b + 1 } }).outputs
  } catch (e) { err = e }
  return { budget, outputs, err, finished, ms: performance.now() - t0 }
}

// ⚠️ A GENEROUS TIME BOUND, not a benchmark: it only fails if a runaway is no
// longer stopped on its own bar.
const FAST_MS = 1000
const OLD_RUN_WIDE = { CALL_COUNT: 5000000, ARRAY_OPERATIONS: 2000000, WINDOW_CELLS: 100000000, CARRIED_STEPS: 100000000 }

describe('RT17 — the per-bar work limits and their derived ceiling', () => {
  it('exactly these four are counted per bar, each at TOTAL_INSTRUCTIONS / HISTORY', () => {
    expect([...PER_BAR_CHARGED].sort()).toEqual(['ARRAY_OPERATIONS', 'CALL_COUNT', 'CARRIED_STEPS', 'WINDOW_CELLS'])
    const derived = DEFAULT_LIMITS.TOTAL_INSTRUCTIONS / DEFAULT_LIMITS.HISTORY
    for (const n of PER_BAR_CHARGED) {
      expect(DEFAULT_LIMITS[n], n).toBe(derived)
      // the longest history can never spend more of it than the run's safety
      expect(DEFAULT_LIMITS[n] * DEFAULT_LIMITS.HISTORY, n).toBeLessThanOrEqual(DEFAULT_LIMITS.TOTAL_INSTRUCTIONS)
    }
    // ⛔ and the measured worst FINISHING bar (RT17: wyckoff 1,504 array
    // operations, delta-rsi 1,201 calls) sits well under it
    expect(DEFAULT_LIMITS.ARRAY_OPERATIONS).toBeGreaterThan(1504 * 5)
    expect(DEFAULT_LIMITS.CALL_COUNT).toBeGreaterThan(1201 * 5)
  })

  it('Budget: a per-bar limit restarts every bar and keeps its worst bar; a run-wide one does not restart', () => {
    const b = new Budget({ ARRAY_OPERATIONS: 10 })
    b.startBar(); b.charge('ARRAY_OPERATIONS', 7); b.charge('TOTAL_INSTRUCTIONS', 7)
    b.startBar(); b.charge('ARRAY_OPERATIONS', 9); b.charge('TOTAL_INSTRUCTIONS', 9)
    b.startBar(); b.charge('ARRAY_OPERATIONS', 3); b.charge('TOTAL_INSTRUCTIONS', 3)
    expect(b.counts.ARRAY_OPERATIONS).toBe(9)
    expect(b.runTotals.ARRAY_OPERATIONS).toBe(19)
    expect(b.counts.TOTAL_INSTRUCTIONS).toBe(19)
    expect(() => b.charge('ARRAY_OPERATIONS', 8)).toThrow(RuntimeLimitError)
    b.startBar()
    expect(() => b.charge('ARRAY_OPERATIONS', 10)).not.toThrow()
  })
})

describe('RT17 — ARRAY_OPERATIONS', () => {
  it('a fixed 500-element sum every bar runs a 5,000-bar history (2.5M operations, past the old 2M run total)', () => {
    const r = run('a = array.new_float(500, 1.0)\ns = array.sum(a)\nplot(s)\n', 5000)
    expect(r.err).toBe(null)
    expect(r.finished).toBe(5000)
    expect(r.budget.counts.ARRAY_OPERATIONS).toBe(500)
    expect(r.budget.runTotals.ARRAY_OPERATIONS).toBe(2500000)
    expect(r.budget.runTotals.ARRAY_OPERATIONS).toBeGreaterThan(OLD_RUN_WIDE.ARRAY_OPERATIONS)
    expect(r.outputs[0][4999]).toBe(500)
  })

  it('CONTROL: the count is the worst bar', () => {
    const r = run('a = array.new_float((bar_index % 4) * 100 + 1, 1.0)\nplot(array.sum(a))\n', 40)
    expect(r.err).toBe(null)
    expect(r.budget.counts.ARRAY_OPERATIONS).toBe(301)
  })

  it('a runaway (one sum over 20,000 elements) stops by ARRAY_OPERATIONS on bar 0, fast', () => {
    const r = run('a = array.new_float(20000, 1.0)\nplot(array.sum(a))\n', 5000)
    expect(r.err).toBeInstanceOf(RuntimeLimitError)
    expect(r.err.limit).toBe('ARRAY_OPERATIONS')
    expect(r.err.ceiling).toBe(DEFAULT_LIMITS.ARRAY_OPERATIONS)
    expect(r.err.reached).toBe(20000)
    expect(r.finished).toBe(0)
    expect(r.ms).toBeLessThan(FAST_MS)
  })

  it('work spread over the bar adds up within the bar: 30 sums of 400 stop on bar 0 at 10,400', () => {
    const r = run('a = array.new_float(400, 1.0)\nfloat s = 0.0\nfor i = 1 to 30\n    s += array.sum(a)\nplot(s)\n', 50)
    expect(r.err).toBeInstanceOf(RuntimeLimitError)
    expect(r.err.limit).toBe('ARRAY_OPERATIONS')
    expect(r.err.reached).toBe(10400)
    expect(r.finished).toBe(0)
  })
})

describe('RT17 — CALL_COUNT', () => {
  it('1,200 calls every bar run every bar under a test ceiling of 2,000 (60,000 calls in the run)', () => {
    // ⚠️ A TEST-ONLY ceiling so the rail takes milliseconds; the mechanism is the product's.
    const r = run('f(x) => x + 1\nfloat s = 0.0\nfor i = 1 to 1200\n    s := f(s)\nplot(s)\n', 50, { CALL_COUNT: 2000 })
    expect(r.err).toBe(null)
    expect(r.finished).toBe(50)
    expect(r.budget.counts.CALL_COUNT).toBe(1200)
    expect(r.budget.runTotals.CALL_COUNT).toBe(60000)
  })

  it('a runaway of calls stops by CALL_COUNT on bar 0 at the product ceiling — before the bar\'s instructions', () => {
    const body = Array.from({ length: 20 }, () => 'f(x)').join(' + ')
    const r = run(`f(x) => x + 1\ng(x) => ${body}\nfloat s = 0.0\nfor i = 1 to 600\n    s := g(s)\nplot(s)\n`, 50)
    expect(r.err).toBeInstanceOf(RuntimeLimitError)
    expect(r.err.limit).toBe('CALL_COUNT')
    expect(r.err.reached).toBe(DEFAULT_LIMITS.CALL_COUNT + 1)
    expect(r.finished).toBe(0)
    expect(r.ms).toBeLessThan(FAST_MS)
  })
})

// ⭐ A builtin over a MUTATED value runs in the VM; over `close` the columnar lane
// computes it before the run and the VM never charges it.
const MUT = 'var x = 0.0\nx := close\n'

describe('RT17 — WINDOW_CELLS', () => {
  it('three windows (400 cells) run 3,000 bars under a test ceiling of 500 cells a bar', () => {
    const r = run(`${MUT}plot(ta.sma(x, 200) + ta.sma(x, 100) + ta.sma(x, 100))\n`, 3000, { WINDOW_CELLS: 500 })
    expect(r.err).toBe(null)
    expect(r.finished).toBe(3000)
    expect(r.budget.counts.WINDOW_CELLS).toBe(400)
    expect(r.budget.runTotals.WINDOW_CELLS).toBe(400 * 3000)
  })

  it('windows reading more than the ceiling on one bar stop by WINDOW_CELLS on bar 0, at the product ceiling', () => {
    // eleven windows near the 960-bar lookback cap read 10,505 cells a bar
    const sum = Array.from({ length: 11 }, (_, k) => `ta.sma(x, ${960 - k})`).join(' + ')
    const r = run(`${MUT}plot(${sum})\n`, 50)
    expect(r.err).toBeInstanceOf(RuntimeLimitError)
    expect(r.err.limit).toBe('WINDOW_CELLS')
    expect(r.err.reached).toBeGreaterThan(DEFAULT_LIMITS.WINDOW_CELLS)
    expect(r.finished).toBe(0)
  })
})

describe('RT17 — CARRIED_STEPS', () => {
  it('three recurrences step every bar of a long run under a test ceiling of 5 a bar', () => {
    const r = run(`${MUT}plot(ta.ema(x, 10) + ta.rma(x, 10) + ta.ema(x, 5))\n`, 3000, { CARRIED_STEPS: 5 })
    expect(r.err).toBe(null)
    expect(r.finished).toBe(3000)
    expect(r.budget.counts.CARRIED_STEPS).toBe(3)
    expect(r.budget.runTotals.CARRIED_STEPS).toBe(9000)
  })

  it('a bar stepping more than the ceiling stops by CARRIED_STEPS on bar 0', () => {
    const r = run(`${MUT}plot(ta.ema(x, 10) + ta.rma(x, 10) + ta.ema(x, 5))\n`, 3000, { CARRIED_STEPS: 2 })
    expect(r.err).toBeInstanceOf(RuntimeLimitError)
    expect(r.err.limit).toBe('CARRIED_STEPS')
    expect(r.finished).toBe(0)
  })
})

describe('RT17 — a run nested inside a bar', () => {
  it('a request\'s sub-run counts its own bars, and the outer bar gets its own count back', () => {
    // The requested expression costs 120 array operations on each of ITS bars;
    // the chart's bar costs 100 after it. Ceiling 150: the chart's bar is 100,
    // never 220 — the sub-run's last bar is not the chart's.
    const other = barsOf(5, 200)
    const src = 'x = request.security("OTHER", "D", array.sum(array.new_float(120, close)))\n'
      + 'a = array.new_float(100, 1.0)\nplot(x + array.sum(a))\n'
    const r = run(src, 5, { ARRAY_OPERATIONS: 150 }, { 'OTHER|D': other })
    expect(r.err).toBe(null)
    expect(r.finished).toBe(5)
    expect(r.budget.counts.ARRAY_OPERATIONS).toBe(120)
  })
})
