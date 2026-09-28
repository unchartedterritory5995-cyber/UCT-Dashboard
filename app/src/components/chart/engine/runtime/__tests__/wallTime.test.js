// app/src/components/chart/engine/runtime/__tests__/wallTime.test.js
//
// ─── WALL_TIME IS ENFORCED, BY NAME, OFF AN INJECTED CLOCK (2026-09-28) ───────
//
// `limits.js` declared `WALL_TIME: 5000` and nothing charged it, so it bounded
// nothing. `vm.js` now reads a clock every `WALL_CHECK_EVERY` instructions and
// stops with `WALL_TIME_EXCEEDED` past the ceiling. Every rail here drives the
// clock — `execute(…, { clock })` — so none of them sleeps and none of them
// depends on how busy the machine is, except the one that is ABOUT the machine:
// a real script on a real 3,000-bar chart finishing under the real ceiling.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { RuntimeLimitError, WALL_CHECK_EVERY, DEFAULT_LIMITS } from '../limits.js'

const N = 50
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 103 + i, l: 97 + i, c: 100 + i * 2, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'
// ~9 instructions an iteration, 2,000 iterations a bar: ~18,000 a bar, ~900,000 a run.
const HEAVY = 'float s = 0.0\nfor i = 1 to 2000\n    s := s + 1.0\nplot(s)\n'

function program(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  return lowerIrProgram(built.ir)
}
function run(src, { clock, limits } = {}) {
  const p = program(src)
  return execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true }, limits, { clock })
}
/** A clock that advances `step` ms on every read, and counts its reads. */
function steppingClock(step) {
  let t = 1000
  const clock = () => { clock.reads += 1; const now = t; t += step; return now }
  clock.reads = 0
  return clock
}

describe('⭐ WALL_TIME stops a run that outlives it — by name', () => {
  it('⭐ a run past the ceiling throws RuntimeLimitError WALL_TIME_EXCEEDED', () => {
    // 10 ms a read against a 50 ms wall: the sixth check is past it.
    const clock = steppingClock(10)
    let err = null
    try { run(HEAVY, { clock, limits: { WALL_TIME: 50 } }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(RuntimeLimitError)
    expect(err.limit).toBe('WALL_TIME')
    expect(err.code).toBe('WALL_TIME_EXCEEDED')
    expect(err.message).toMatch(/^WALL_TIME_EXCEEDED — ceiling 50, reached 60$/)
    // one read to start the wall, then six checks: it stopped at the FIRST check past the ceiling
    expect(clock.reads).toBe(7)
  })

  it('⛔ CONTROL: the same run with a clock that never advances completes, answering the same series', () => {
    const frozen = steppingClock(0)
    const res = run(HEAVY, { clock: frozen, limits: { WALL_TIME: 50 } })
    expect(Array.from(res.outputs[0])).toEqual(new Array(N).fill(2000))
  })

  it('⭐ the clock is read once per WALL_CHECK_EVERY instructions — never per instruction', () => {
    const frozen = steppingClock(0)
    const res = run(HEAVY, { clock: frozen })
    const total = res.budget.counts.TOTAL_INSTRUCTIONS
    expect(total).toBeGreaterThan(WALL_CHECK_EVERY * 10) // the run is long enough to say something
    expect(frozen.reads).toBe(1 + Math.floor(total / WALL_CHECK_EVERY))
    // elapsed is recorded beside the counts, never in them (counts are the program's)
    expect(res.budget.counts.WALL_TIME).toBe(0)
    expect(res.budget.wallElapsed).toBe(0)
  })

  it('⭐ the countdown runs ACROSS bars: many tiny bars are checked, not only long ones', () => {
    // ~6 instructions a bar would never reach 4,096 inside one bar
    const clock = steppingClock(1000)
    const tiny = program('plot(close + 1)\n')
    const bars = 20000
    const series = SERIES.map(() => new Float64Array(bars).fill(1))
    let err = null
    try {
      execute(tiny, { bars, series, columns: tiny.columns.map(() => new Float64Array(bars)), confirmed: true },
        { WALL_TIME: 1500 }, { clock })
    } catch (e) { err = e }
    expect(err && err.code).toBe('WALL_TIME_EXCEEDED')
  })

  it('⭐ the default ceiling is the declared 5,000 ms', () => {
    expect(DEFAULT_LIMITS.WALL_TIME).toBe(5000)
    const clock = steppingClock(2000)
    let err = null
    try { run(HEAVY, { clock }) } catch (e) { err = e }
    expect(err && err.message).toMatch(/^WALL_TIME_EXCEEDED — ceiling 5000, reached 6000$/)
  })
})

// ─── the rails that are about the machine ───────────────────────────────────
//
// ⭐ The REAL clock and the DEFAULT ceiling, no injection. The four typical
// loop-bearing scripts are the hard rail: each runs a 3,000-bar chart in tens of
// milliseconds, two orders of magnitude inside the wall, so a busy box cannot
// flip it. ⚠️ kernel-channel — the costliest script the lane attaches — is
// MEASURED here, not asserted against the wall: ~0.8 s for 3,000 bars on a quiet
// box but 3.6–4.8 s measured while other sessions held this machine at 100% CPU
// (2026-09-28). A rail that fails when the box is busy teaches everyone to
// ignore it; the number is printed so a regression is still visible.
const REPO = path.resolve(process.cwd(), '..')
const SPY3000 = () => JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8')).bars.slice(-3000)
function runCorpus(name, bars, limits) {
  const source = fs.readFileSync(path.join(REPO, 'corpus/committed', `${name}.pine`), 'utf8')
  const opts = (ownsDrawing) => ({ bars, inputs: {}, ...runtimeClockOpts(false),
    plotColours: true, inputsReachEveryFold: true, collectInputs: true,
    ...(ownsDrawing ? { objectTrees: [] } : {}) })
  let built = buildRuntimeIr(source, opts(false))
  if (!built.ok && built.refusal.guard === 'runtime:object-op') built = buildRuntimeIr(source, opts(true))
  expect(built.ok, name).toBe(true)
  const p = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars, (b) => Number(b[k])))
  return execute(p, { bars: bars.length, series, columns: p.columns, confirmed: true,
    barTimes: bars.map((b) => b.t) }, limits)
}

describe('⭐ an honest script on a 3,000-bar chart does NOT meet the wall', () => {
  const bars = SPY3000()
  for (const name of [
    'atr-stepped-pdf-ma-loxx__9b90a3f7bb',
    'nadaraya-watson-rational-quadratic-kernel-non-repainting__2d248c3125',
    'wyckoff-accumulation-distribution__d9ae726e21',
    'nonlinear-regression-zero-lag-moving-average-loxx__e5075eb888',
  ]) {
    it(`${name} on 3,000 SPY daily bars — real clock, default 5,000 ms wall`, { timeout: 60000 }, () => {
      expect(bars.length).toBe(3000)
      const res = runCorpus(name, bars) // throws WALL_TIME_EXCEEDED if it met the wall
      expect(res.outputs.every((o) => o.length === 3000)).toBe(true)
      expect(res.budget.wallElapsed).toBeLessThan(DEFAULT_LIMITS.WALL_TIME)
    })
  }

  it('kernel-channel-backquant on 3,000 SPY daily bars — measured, printed', { timeout: 120000 }, () => {
    const res = runCorpus('kernel-channel-backquant__d8c4b7f75c', bars, { WALL_TIME: Infinity })
    expect(res.outputs[0].length).toBe(3000)
    expect(res.budget.wallElapsed).toBeGreaterThan(0) // the wall was read on the real clock
    console.log(`[wallTime] kernel-channel 3,000 bars: ${Math.round(res.budget.wallElapsed)} ms `
      + `at the last check (default wall ${DEFAULT_LIMITS.WALL_TIME} ms), `
      + `${res.budget.counts.TOTAL_INSTRUCTIONS} instructions`)
  })
})
