// app/src/components/chart/engine/runtime/__tests__/rt10LoopPerBar.test.js
//
// ─── RT10 (2026-10-04): `LOOP_ITERATIONS` IS A PER-BAR CEILING ──────────────
//
// It was a run-wide 100,000 passes. A run-wide count of a PER-BAR cost scales
// with how much history the chart has, not with what the script does:
// delta-rsi-oscillator-strategy walks a fixed regression window (1,163 passes
// every bar) and was stopped at bar 85 of RDDT's 636, while the same script
// would have drawn on a shorter chart. The limit now counts the passes ALL loops
// take on ONE bar, reset every bar (`vm.js`, OP.LOOP_TICK), and keeps the
// high-water mark as its count.
//
// What the run-wide count stood in for — runaway time on the one thread the
// member's chart runs on — stays bounded by `TOTAL_INSTRUCTIONS` (the run) and
// by the pane's wall clock. These rails pin:
//   1. an honest fixed-window loop over a long history runs to the end;
//   2. a runaway stops ON THE BAR IT RUNS AWAY IN, by name, in milliseconds —
//      by this limit for the cheapest body, by `INSTRUCTIONS_PER_BAR` for any
//      other, by `WHILE_ITERATIONS` (with its line) for a `while`;
//   3. the ordering that keeps all three guards reachable is DERIVED from a
//      measured pass cost, not restated;
//   4. the run as a whole is still bounded (`TOTAL_INSTRUCTIONS`).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { Budget, DEFAULT_LIMITS, RuntimeLimitError } from '../limits.js'

const barsOf = (n) => Array.from({ length: n }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + (i % 7), h: 101 + (i % 7), l: 98 + (i % 7), c: 100 + (i % 5), v: 1000 + i }))

/** Run `src` on `n` synthetic daily bars; returns the budget, the outputs, the
 *  stop (or null) and how long the run took. */
function run(src, n, limits) {
  const bars = barsOf(n)
  const built = buildRuntimeIr(`//@version=6\nindicator("rt10 loop")\n${src}`, { bars, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const budget = new Budget(limits)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const t0 = performance.now()
  let err = null
  let outputs = null
  try {
    outputs = execute(program, { bars: n, series, columns: program.columns, confirmed: true }, undefined, { budget }).outputs
  } catch (e) { err = e }
  return { budget, outputs, err, ms: performance.now() - t0 }
}

// A delta-rsi-shaped loop: a fixed window walked every bar.
const WINDOW_LOOP = 'float s = 0.0\nfor i = 0 to 1199\n    s := s + close\nplot(s)\n'
// ⚠️ A GENEROUS TIME BOUND, not a benchmark: each stop below is measured at a few
// milliseconds; this only fails if a runaway is no longer stopped on its own bar.
const FAST_MS = 1000

describe('RT10 — LOOP_ITERATIONS counts one bar, not the run', () => {
  it('an honest fixed-window loop runs every bar of a long history, and the count is the per-bar PEAK', () => {
    const n = 2000
    const r = run(WINDOW_LOOP, n)
    expect(r.err).toBe(null)
    // 1,200 passes plus the exit test, every bar: 2.4 million passes in the run,
    // 24x what the old run-wide ceiling allowed — and every bar computed.
    expect(r.budget.counts.LOOP_ITERATIONS).toBe(1201)
    const col = Array.from(r.outputs[0])
    expect(col.length).toBe(n)
    expect(col.every((v) => Number.isFinite(v))).toBe(true)
    expect(col[n - 1]).toBe(1200 * (100 + ((n - 1) % 5)))
  })

  it('CONTROL: the count is the worst bar, so a bar with more passes moves it and one with fewer does not', () => {
    const r = run('float s = 0.0\nfor i = 1 to (bar_index % 4) * 100\n    s := s + 1\nplot(s)\n', 40)
    expect(r.err).toBe(null)
    // `1 to 0` counts DOWN in Pine (two passes); the worst bar is `1 to 300`.
    expect(r.budget.counts.LOOP_ITERATIONS).toBe(301)
  })

  it('a runaway `for` with the cheapest body stops by LOOP_ITERATIONS on bar 0, fast', () => {
    const r = run('int s = 0\nfor i = 0 to 1000000000\n    continue\nplot(s)\n', 5000)
    expect(r.err).toBeInstanceOf(RuntimeLimitError)
    expect(r.err.limit).toBe('LOOP_ITERATIONS')
    expect(r.err.ceiling).toBe(DEFAULT_LIMITS.LOOP_ITERATIONS)
    expect(r.err.reached).toBe(DEFAULT_LIMITS.LOOP_ITERATIONS + 1)
    expect(r.err.bar).toBe(0)
    expect(r.budget.counts.TOTAL_INSTRUCTIONS).toBe(0) // no bar finished
    expect(r.ms).toBeLessThan(FAST_MS)
  })

  it('a runaway `for` with a real body stops by INSTRUCTIONS_PER_BAR on bar 0, fast', () => {
    const r = run('float s = 0.0\nfor i = 0 to 1000000000\n    s := s + close\nplot(s)\n', 5000)
    expect(r.err).toBeInstanceOf(RuntimeLimitError)
    expect(r.err.limit).toBe('INSTRUCTIONS_PER_BAR')
    expect(r.budget.counts.TOTAL_INSTRUCTIONS).toBe(0)
    expect(r.ms).toBeLessThan(FAST_MS)
  })

  it('a runaway `while` still stops by WHILE_ITERATIONS — the stop that names its line', () => {
    const r = run('float s = 0.0\nwhile true\n    s += 1\nplot(s)\n', 5000)
    expect(r.err).toBeInstanceOf(RuntimeLimitError)
    expect(r.err.limit).toBe('WHILE_ITERATIONS')
    expect(r.err.line).toBe(4)
    expect(r.err.bar).toBe(0)
    expect(r.ms).toBeLessThan(FAST_MS)
  })

  it('the ordering that keeps all three guards reachable, derived from a MEASURED pass cost', () => {
    // The cheapest `for` pass this VM runs: instructions per pass of a
    // `continue` body, measured, not typed.
    const probe = run('int s = 0\nfor i = 1 to 1000\n    continue\nplot(s)\n', 1)
    expect(probe.err).toBe(null)
    const passes = probe.budget.counts.LOOP_ITERATIONS
    const perPass = probe.budget.counts.INSTRUCTIONS_PER_BAR / passes
    expect(perPass).toBeGreaterThan(1)
    // reachable: the cheapest runaway meets this ceiling before the bar's instructions
    expect(DEFAULT_LIMITS.LOOP_ITERATIONS * perPass).toBeLessThan(DEFAULT_LIMITS.INSTRUCTIONS_PER_BAR)
    // and the `while` bound (which names the line) is met before this one
    expect(DEFAULT_LIMITS.LOOP_ITERATIONS).toBeGreaterThan(DEFAULT_LIMITS.WHILE_ITERATIONS)
  })

  it('the run is still bounded: a loop near the per-bar ceiling on every bar stops by TOTAL_INSTRUCTIONS', () => {
    // ⚠️ A TEST-ONLY run ceiling (the product's is 200,000,000) so the rail takes
    // milliseconds; the mechanism is the same.
    const r = run('float s = 0.0\nfor i = 0 to 9999\n    continue\nplot(s)\n', 5000, { TOTAL_INSTRUCTIONS: 20000000 })
    expect(r.err).toBeInstanceOf(RuntimeLimitError)
    expect(r.err.limit).toBe('TOTAL_INSTRUCTIONS')
    expect(r.budget.counts.LOOP_ITERATIONS).toBe(10001)
  })
})
