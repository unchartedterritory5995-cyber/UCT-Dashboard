// app/src/components/chart/engine/runtime/__tests__/runtimeLimitsAcceptance.test.js
//
// ⭐⭐ UIE PHASE B (2026-10-11) — EVERY ONE OF THE 24 LIMITS STOPS A REAL SCRIPT BY NAME.
//
// For each name in `LIMIT_NAMES`: a small, real Pine script that exercises the resource,
// run through the real front end → lowering → VM with ONLY that limit lowered, must stop
// with `RuntimeLimitError` naming exactly that limit — and the SAME script must run to
// completion under the default limits (so the case proves the limit, not a broken
// script). `PROGRAM_SIZE` is a door limit (the source's bytes), asserted at the door.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { LIMIT_NAMES, DEFAULT_LIMITS, RuntimeLimitError } from '../limits.js'
import { computeRuntimeColumns, RUNTIME_LIMIT_GUARD } from '../runtimeColumns.js'

const N = 200
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 7) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) * 10 }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

function build(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  return lowerIrProgram(built.ir)
}
const ctx = (program) => ({ bars: N, series: SERIES, columns: program.columns, confirmed: true,
  barTimes: BARS.map((b) => b.t), requestBars: {} })
const run = (src, limits, opts) => { const p = build(src); return execute(p, ctx(p), limits, opts) }

/** limit → [script, the lowered ceiling, opts?]. Each script stresses exactly that resource. */
const CASES = {
  IR_SIZE: ['plot(close)\n', 2],
  // a PURE expression is evaluated once as a column (two instructions a bar), so the
  // per-bar cost has to come from statements the VM really executes on every bar
  INSTRUCTIONS_PER_BAR: ['float s = 0.0\nfor i = 0 to 9\n    s += i\nplot(s)\n', 20],
  TOTAL_INSTRUCTIONS: ['plot(close)\n', 50],
  LOOP_ITERATIONS: ['float s = 0.0\nfor i = 0 to 9\n    s += i\nplot(s)\n', 5],
  WHILE_ITERATIONS: ['int k = 0\nwhile k < 20\n    k += 1\nplot(k)\n', 5],
  LOOP_NESTING: ['float s = 0.0\nfor i = 0 to 2\n    for j = 0 to 2\n        s += j\nplot(s)\n', 1],
  CALL_DEPTH: ['f(x) => x + 1\ng(x) => f(x) * 2\nplot(g(close))\n', 1],
  CALL_COUNT: ['f(x) => x + 1\nplot(f(close))\n', 5],
  ARRAY_ELEMENTS: ['var a = array.new_float(0)\narray.push(a, close)\nplot(array.size(a))\n', 5],
  ARRAY_OPERATIONS: ['var a = array.new_float(0)\narray.push(a, close)\nplot(array.size(a))\n', 5],
  LIVE_OBJECTS: ['label.new(bar_index, close, "x")\n', 5],
  OBJECT_OPERATIONS: ['label.new(bar_index, close, "x")\n', 5],
  HISTORY: ['plot(close)\n', 10],
  HISTORY_SLOTS: ['var float x = 0.0\nx := x + 1\nplot(x[1])\n', 0],
  HISTORY_VALUES: ['var float x = 0.0\nx := x + 1\nplot(x[1])\n', 0],
  WINDOW_CELLS: ['var float x = 0.0\nx := x + close\nplot(ta.sma(x, 5))\n', 10],
  CARRIED_INSTANCES: ['var float x = 0.0\nx := x + close\nplot(ta.ema(x, 5))\n', 0],
  CARRIED_CELLS: ['var float x = 0.0\nx := x + close\nplot(ta.ema(x, 5))\n', 0],
  CARRIED_STEPS: ['var float x = 0.0\nx := x + close\nplot(ta.ema(x, 5))\n', 10],
  REQUEST_COUNT: ['plot(request.security("NASDAQ:AAPL", "D", close))\n', 0],
  REQUEST_FANOUT: ['plot(close)\n', 2, { requestDepth: 3 }],
  MEMORY: ['plot(close)\n', 100],
  WALL_TIME: ['plot(close)\n', 50, { now: (() => { let t = 0; return () => { t += 10; return t } })() }],
}

describe('⭐ all 24 execution limits stop a real script by name', () => {
  it('every declared limit has a case here (PROGRAM_SIZE at the door, the rest in the VM)', () => {
    expect(LIMIT_NAMES.length).toBe(24)
    expect(LIMIT_NAMES.filter((n) => n !== 'PROGRAM_SIZE' && !CASES[n])).toEqual([])
  })

  for (const [limit, [src, ceiling, opts]] of Object.entries(CASES)) {
    it(`${limit}: stops by name at a lowered ceiling, and the same script runs under the default`, () => {
      let err = null
      try { run(src, { [limit]: ceiling }, opts) } catch (e) { err = e }
      expect(err, `${limit} did not stop`).toBeInstanceOf(RuntimeLimitError)
      expect(err.limit).toBe(limit)
      expect(err.ceiling).toBe(ceiling)
      if (limit !== 'REQUEST_FANOUT' && limit !== 'WALL_TIME') {
        expect(() => run(src, undefined, opts)).not.toThrow()       // the script itself is sound
      }
    })
  }

  it('PROGRAM_SIZE: a source over the byte ceiling is refused at the door, by name', () => {
    const huge = `${head}plot(close)\n// ${'x'.repeat(DEFAULT_LIMITS.PROGRAM_SIZE)}\n`
    let err = null
    try { computeRuntimeColumns({ id: 'p', compute: { fn: 'p', source: huge, outputs: { v: 0 } } }, BARS, { tf: 'D' }) } catch (e) { err = e }
    expect(err && err.guard).toBe(RUNTIME_LIMIT_GUARD)
    expect(err.message).toMatch(/PROGRAM_SIZE/)
  })
})
