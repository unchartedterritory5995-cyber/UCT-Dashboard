// app/src/components/chart/engine/runtime/__tests__/callSiteSpecialisation.test.js
//
// ─── A LENGTH THAT IS A PARAMETER: ONE SPECIALISATION PER CALL SITE (2026-09-27) ───
//
// `smoothrng(x, t, m) => ema(abs(x - x[1]), t) …` cannot be compiled once for every
// call: `t` is a frame slot and a recurrence's state is sized before bar 0. Pine's
// lengths are `simple`, though — fixed for the run at each call — and at
// `smoothrng(source, per1, mult1)` the argument IS a constant. The runtime lane now
// compiles the body again for that call with each constant-argument parameter bound
// to its number (`pineRuntimeFrontend.js::specializeCall`).
//
// The oracle is the HOST lane computing the same maths with the constants written in
// (`ema(abs(close - close[1]), 27)`): a different engine path (columnar trees through
// `interpret`), the same answer bar for bar.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { translatePine } from '../../ast/pine.js'
import { interpret } from '../../ast/interpret.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const LF = String.fromCharCode(10)
const v4 = (...xs) => ['//@version=4', 'study("t")', ...xs].join(LF) + LF
const N = 240
// ⛔ A MOVING, UNEVEN SERIES — so a wrong length cannot agree by accident.
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + Math.sin(i / 3.1) * 7 + i * 0.2 + (i % 5) * 0.9
  return { t: 1700000000 + i * 86400, o: c - 1, h: c + 2, l: c - 2, c, v: 1000 + i }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

function runtime(text) {
  const built = buildRuntimeIr(text, { bars: BARS, inputs: {} })
  if (!built.ok) return { refusal: built.refusal }
  const program = lowerIrProgram(built.ir)
  const res = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t) })
  return { outputs: res.outputs.map((o) => Array.from(o)), program }
}
function host(text) {
  const t = translatePine(text)
  return (t.outputs || []).map((o) => {
    expect(o.ast, JSON.stringify(o.refusal)).toBeTruthy()
    return Array.from(interpret(o.ast, BARS, {}))
  })
}
function same(a, b) {
  expect(a.length).toBe(b.length)
  let finite = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]; const y = b[i]
    expect(Number.isFinite(x), `bar ${i}: ${x} vs ${y}`).toBe(Number.isFinite(y))
    if (Number.isFinite(x)) { finite += 1; expect(Math.abs(x - y), `bar ${i}`).toBeLessThan(1e-9 * Math.max(1, Math.abs(y))) }
  }
  expect(finite, 'nothing was compared').toBeGreaterThan(N / 4)
}

const SMOOTHRNG = ['smoothrng(x, t, m) =>', '    wper = t * 2 - 1', '    avrng = ema(abs(x - x[1]), t)',
  '    smoothrng = ema(avrng, wper) * m', '    smoothrng']

describe('⭐ the twin-range-filter shape, against the host lane with the constants written in', () => {
  it('one call site: t = 27 (an input), m = 1.6 (a literal)', () => {
    const rt = runtime(v4('per1 = input(defval=27, minval=1, title="Fast period")', ...SMOOTHRNG,
      'plot(smoothrng(close, per1, 1.6))'))
    expect(rt.refusal).toBeUndefined()
    const [oracle] = host(v4('plot(ema(ema(abs(close - close[1]), 27), 53) * 1.6)'))
    same(rt.outputs[0], oracle)
  })

  it('⭐ two call sites, two constants — two specialisations, each its own answer', () => {
    const rt = runtime(v4('per1 = input(defval=27, minval=1)', 'per2 = input(defval=55, minval=1)',
      ...SMOOTHRNG, 'plot(smoothrng(close, per1, 1.6))', 'plot(smoothrng(close, per2, 2))'))
    expect(rt.refusal).toBeUndefined()
    const [a, b] = host(v4('plot(ema(ema(abs(close - close[1]), 27), 53) * 1.6)',
      'plot(ema(ema(abs(close - close[1]), 55), 109) * 2)'))
    same(rt.outputs[0], a)
    same(rt.outputs[1], b)
    expect(rt.outputs[0]).not.toEqual(rt.outputs[1])
    // …and they ARE two function bodies, not one body told two lengths at run time.
    expect(rt.program.functions.filter((f) => /^smoothrng#/.test(f.name)).length).toBe(2)
  })

  it('two call sites with the SAME constants share one body, and still keep their own state', () => {
    const rt = runtime(v4('per1 = input(defval=27, minval=1)', ...SMOOTHRNG,
      'plot(smoothrng(close, per1, 1.6))', 'plot(smoothrng(open, per1, 1.6))'))
    expect(rt.refusal).toBeUndefined()
    expect(rt.program.functions.filter((f) => /^smoothrng#/.test(f.name)).length).toBe(1)
    const [a, b] = host(v4('plot(ema(ema(abs(close - close[1]), 27), 53) * 1.6)',
      'plot(ema(ema(abs(open - open[1]), 27), 53) * 1.6)'))
    same(rt.outputs[0], a)
    same(rt.outputs[1], b)
  })
})

describe('⛔ what is NOT bound — each still refuses, by the same name as before', () => {
  it('a length argument that is a per-bar series is not a constant', () => {
    const rt = runtime(v4('f(x, n) =>', '    ema(x - x[1], n)', 'plot(f(close, bar_index % 3 + 1))'))
    expect(rt.refusal && rt.refusal.guard).toBe('runtime:history-dynamic-offset')
  })

  it('a parameter read WITH HISTORY stays a frame parameter (the history of a constant is na on bar 0)', () => {
    const rt = runtime(v4('f(x, n) =>', '    ema(x - x[1], n) + nz(n[1])', 'plot(f(close, 5))'))
    expect(rt.refusal && rt.refusal.guard).toBe('runtime:history-dynamic-offset')
  })

  it('⛔ CONTROL — the same body with a literal length compiles, so the refusals above are about binding', () => {
    const rt = runtime(v4('f(x, n) =>', '    ema(x - x[1], n)', 'plot(f(close, 5))'))
    expect(rt.refusal).toBeUndefined()
    const [oracle] = host(v4('plot(ema(close - close[1], 5))'))
    same(rt.outputs[0], oracle)
  })
})
