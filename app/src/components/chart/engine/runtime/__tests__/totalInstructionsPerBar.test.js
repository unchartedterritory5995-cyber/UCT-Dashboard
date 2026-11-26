// ─── ⭐⭐ (e99, coordinator ruling 2026-11-26) — TOTAL INSTRUCTIONS PER BAR COVERED ─────────────────────────────
//
// `limits.js::TOTAL_INSTRUCTIONS` was a whole-chart count (200,000,000) an honest script crossed through chart LENGTH
// alone: kernel-channel-backquant takes a constant ~27,400 instructions a bar and stopped at bar 7,295 of SPY 1D's
// 8,509, where TradingView draws it. The ceiling is now `max(200,000,000, 30,000 x the bars the run covers)`
// (`scaledCeiling`, `PER_BAR_LIMITS`), set once by the top-level `execute` (`Budget.coverBars`). These rails hold:
//   1. the formula, in its one table;
//   2. kernel-channel over SPY 1D's 8,509 bars completes with the shipped limits (no pane budget);
//   3. a genuine runaway still stops BY NAME: ~147,000 instructions a bar stops on TOTAL_INSTRUCTIONS, naming the
//      ceiling and the bars it was set for, and a loop that never ends stops on its own bar;
//   4. below the floor (a chart of at most 6,666 bars) a script stops on the same bar, with the same numbers, as
//      under the old fixed ceiling;
//   5. a caller that NAMES the ceiling gets exactly that number.
// ⭐⭐ (e100, coordinator ruling 2026-11-26) THE RATE IS 100,000 A BAR (delta-rsi-oscillator-strategy takes a constant
// 44,471, which 30,000 stopped at SPY bar 5,740), so the floor holds up to 2,000 bars; the rails below read that.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { DEFAULT_LIMITS, RuntimeLimitError, TOTAL_INSTRUCTIONS_PER_BAR, PER_BAR_LIMITS, scaledCeiling } from '../limits.js'
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
const head = '//@version=6\nindicator("tipb", overlay = false)\n'
/** About `21 x k` instructions a bar: a `for` of `k` passes adding into a float. `LOOP_ITERATIONS` (5,000,000 a run)
 *  would stop it first, so the runaway rails lift THAT one only (naming a limit opts only it out of scaling). */
// (e100) and WALL_TIME, the VM's 5,000 ms backstop: at 100,000 a bar the runaway runs ~5,800 bars before it stops
const LOOPS_LIFTED = { LOOP_ITERATIONS: 1e12, WALL_TIME: 1e9 }
const loopBar = (k) => `float s = 0.0\nfor i = 0 to ${k}\n    s += i\nplot(s)\n`
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
    return { counts: res.budget.counts, ceiling: res.budget.limits.TOTAL_INSTRUCTIONS }
  } catch (err) {
    if (!(err instanceof RuntimeLimitError)) throw err
    return { err, stoppedOn: last + 1 }
  }
}

describe('the instruction ceiling scales with the bars a run covers', () => {
  it('the formula: the 200,000,000 floor up to 2,000 bars, 100,000 a bar above it, in the one table', () => {
    expect(TOTAL_INSTRUCTIONS_PER_BAR).toBe(100000)
    expect(PER_BAR_LIMITS.TOTAL_INSTRUCTIONS).toBe(TOTAL_INSTRUCTIONS_PER_BAR)
    expect(scaledCeiling('TOTAL_INSTRUCTIONS', DEFAULT_LIMITS.TOTAL_INSTRUCTIONS, 2000)).toBe(200000000)
    expect(scaledCeiling('TOTAL_INSTRUCTIONS', DEFAULT_LIMITS.TOTAL_INSTRUCTIONS, 8509)).toBe(850900000)
    expect(scaledCeiling('TOTAL_INSTRUCTIONS', DEFAULT_LIMITS.TOTAL_INSTRUCTIONS, 32768)).toBe(3276800000)
    expect(scaledCeiling('CARRIED_STEPS', DEFAULT_LIMITS.CARRIED_STEPS, 32768)).toBe(DEFAULT_LIMITS.CARRIED_STEPS)
  })

  it('kernel-channel-backquant over SPY 1D (8,509 bars) completes with the shipped limits', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const door = enterMemberDoor(fs.readFileSync(path.join(REPO, 'corpus/committed/kernel-channel-backquant__d8c4b7f75c.pine'), 'utf8'))
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    expect(door.built && door.built.lane).toBe('runtime')
    const rows = JSON.parse(fs.readFileSync(path.join(REPO,
      'tests/fixtures/vendor/harness/machine-learning-moving-average-backquant-spy-1d-2026-11-17.json'), 'utf8')).bars.rows
    expect(rows.length).toBe(8509)
    let counts = null
    let limits = null
    const out = computeRuntimeColumns(door.def, rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })),
      { tf: 'D', newestBarIsForming: false, historyFromListing: true },
      { budgetMs: 600000, onBudget: (b) => { counts = { ...b.counts }; limits = b.limits } })
    expect(out && Object.keys(out).length).toBeGreaterThan(0)
    expect(counts.TOTAL_INSTRUCTIONS).toBeGreaterThan(DEFAULT_LIMITS.TOTAL_INSTRUCTIONS)   // past the old ceiling
    expect(counts.TOTAL_INSTRUCTIONS).toBeLessThanOrEqual(limits.TOTAL_INSTRUCTIONS)
  }, 120000)

  it('⛔ a runaway still stops BY NAME: ~147,000 a bar meets the scaled ceiling, which names its bars', () => {
    const n = 8509
    const r = vmRun(loopBar(7000), n, LOOPS_LIFTED)
    expect(r.err && r.err.limit).toBe('TOTAL_INSTRUCTIONS')
    expect(r.err.ceiling).toBe(scaledCeiling('TOTAL_INSTRUCTIONS', 200000000, n))
    expect(r.err.coveredBars).toBe(n)
    expect(r.stoppedOn).toBeGreaterThan(5500)
    expect(r.stoppedOn).toBeLessThan(6100)
    expect(runtimeLimitSentence(r.err, r.stoppedOn, n)).toMatch(/at most 850,900,000 for 8,509 bars/)
  }, 120000)

  it('⛔ a loop that never ends stops on its own bar, by name', () => {
    const r = vmRun('float s = 0.0\nwhile true\n    s += 1\nplot(s)\n', 8509)
    expect(r.err && ['INSTRUCTIONS_PER_BAR', 'WHILE_ITERATIONS']).toContain(r.err.limit)
    expect(r.stoppedOn).toBe(0)
  })

  it('below the floor the stop is the old one: same bar, same 200,000,000, no "for N bars"', () => {
    const scaled = vmRun(loopBar(7000), 1999, LOOPS_LIFTED)
    const fixed = vmRun(loopBar(7000), 1999, { ...LOOPS_LIFTED, TOTAL_INSTRUCTIONS: 200000000 })
    expect(scaled.err.limit).toBe('TOTAL_INSTRUCTIONS')
    expect(scaled.err.ceiling).toBe(200000000)
    expect(scaled.err.coveredBars).toBeUndefined()
    expect([scaled.stoppedOn, scaled.err.reached]).toEqual([fixed.stoppedOn, fixed.err.reached])
  }, 120000)

  it('a caller that NAMES the ceiling gets exactly that number', () => {
    const r = vmRun(loopBar(7000), 8509, { ...LOOPS_LIFTED, TOTAL_INSTRUCTIONS: 200000000 })
    expect(r.err.ceiling).toBe(200000000)
    expect(r.err.coveredBars).toBeUndefined()
  }, 120000)
})
