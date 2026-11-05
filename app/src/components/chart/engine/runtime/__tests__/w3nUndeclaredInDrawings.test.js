// app/src/components/chart/engine/runtime/__tests__/w3nUndeclaredInDrawings.test.js
//
// ─── W3W4-D3 — NAMES THE RUNTIME LANE REFUSED AS "UNDECLARED BUILTIN" ───────────
//
// Spike (the three sole-blocked drawing scripts, read from corpus/committed):
//   correlation-matrix                         `correlation(a, b, n)` (v1 spelling)  -> SERVED here
//   previous-day-high-and-low-separators-...   `ta.pivot_point_levels(...)`          -> real missing builtin
//   volume-profile-auto-line-v2                `time(timeframe)` (function form)     -> real missing builtin
// and `ta.correlation` (heat-map-seasons, v5) is the same name in its v5 spelling.
//
// ONLY `correlation` is served: Pine defines it, the host lane already expands it
// (`pine.js::BUILTIN_CALL_TREE.correlation`), and the runtime lane's respelling asks
// that same builder. The other two need kernels (a pivot table; a timeframe
// calendar) and stay refused BY NAME, as the controls below pin.
//
// Numbers are graded against Pearson's definition written out in plain JS, never
// against the expansion.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + Math.sin(i * 0.7) * 3,
  h: 106 + i * 0.3,
  l: 94 - i * 0.1,
  c: 100 + i * 0.4 + Math.cos(i * 1.3) * 4,
  v: 1000 + ((i * 7919) % 613),
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const X = BARS.map((b) => b.c * 2 - b.o)
const Y = BARS.map((b) => b.v)
const STATE = 'var float x = 0.0\nx := close * 2 - open\nvar float y = 0.0\ny := volume\n'
const head = (v) => `//@version=${v}\n${v >= 5 ? 'indicator' : 'study'}("t")\n`

const build = (version, body, opts = {}) => buildRuntimeIr(`${head(version)}${STATE}${body}`, { bars: BARS, inputs: {}, ...opts })
function run(version, body) {
  const built = build(version, body)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}
const refusalOf = (version, body, opts) => {
  const b = build(version, body, opts)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

// Pearson's r over the last n bars, from the definition (not from sma/stdev).
const pearson = (xs, ys, n) => xs.map((_, i) => {
  if (i - n + 1 < 0) return NaN
  const a = xs.slice(i - n + 1, i + 1)
  const b = ys.slice(i - n + 1, i + 1)
  const ma = a.reduce((p, q) => p + q, 0) / n
  const mb = b.reduce((p, q) => p + q, 0) / n
  let sab = 0
  let saa = 0
  let sbb = 0
  a.forEach((v, k) => { sab += (v - ma) * (b[k] - mb); saa += (v - ma) ** 2; sbb += (b[k] - mb) ** 2 })
  return sab / Math.sqrt(saa * sbb)
})
const near = (ours, ref) => {
  expect(ours.length).toBe(ref.length)
  let compared = 0
  ref.forEach((r, i) => {
    if (Number.isNaN(r)) { expect(Number.isNaN(ours[i]), `bar ${i}`).toBe(true); return }
    expect(Math.abs(ours[i] - r), `bar ${i}: ours ${ours[i]}, Pearson ${r}`).toBeLessThanOrEqual(1e-9)
    compared += 1
  })
  expect(compared).toBeGreaterThan(N / 2)
}

describe('correlation: served, equal to Pearson, in the script own spelling', () => {
  it('v4 bare `correlation(x, y, n)`', () => {
    near(run(4, 'plot(correlation(x, y, 8))\n'), pearson(X, Y, 8))
  })
  it('v5 `ta.correlation(x, y, n)`', () => {
    near(run(5, 'plot(ta.correlation(x, y, 8))\n'), pearson(X, Y, 8))
  })
  it('a length that is an input folds at its default', () => {
    near(run(5, 'len = input.int(6, "len")\nplot(ta.correlation(x, y, len))\n'), pearson(X, Y, 6))
  })
  it('control: the reference is not a constant (a wrong formula would be seen)', () => {
    const r = pearson(X, Y, 8).filter(Number.isFinite)
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(0.2)
  })
})

describe('grammar: a namespaced or shadowed form is not captured by the bare name', () => {
  it('bare `correlation` in a v5 script is no Pine function: refused as undeclared', () => {
    const r = refusalOf(5, 'plot(correlation(x, y, 8))\n')
    expect(r.guard).toBe('runtime:call-undeclared-builtin-state')
    expect(r.token).toBe('correlation')
  })
  it('`ta.correlation` in a v4 script: refused as undeclared', () => {
    const r = refusalOf(4, 'plot(ta.correlation(x, y, 8))\n')
    expect(r.guard).toBe('runtime:call-undeclared-builtin-state')
    expect(r.token).toBe('ta.correlation')
  })
  it('a script own `correlation` function is called, not Pine one', () => {
    const out = run(4, 'correlation(a, b, n) => a + b\nplot(correlation(x, y, 8))\n')
    near(out.map((v, i) => (i < 7 ? NaN : v)), X.map((v, i) => (i < 7 ? NaN : v + Y[i])))
  })
  it('the neighbours still answer: ta.linreg, ta.vwma, ta.sma', () => {
    expect(() => run(5, 'plot(ta.linreg(x, 5, 0))\n')).not.toThrow()
    expect(() => run(5, 'plot(ta.vwma(x, 6))\n')).not.toThrow()
    expect(() => run(5, 'plot(ta.sma(x, 6))\n')).not.toThrow()
  })
})

describe('keeps its refusal', () => {
  it.each([
    ['a length only known while the bar runs', 5, 'plot(ta.correlation(x, y, bar_index % 5 + 2))\n'],
    ['a length below 2', 5, 'plot(ta.correlation(x, y, 1))\n'],
    ['a fractional length', 5, 'plot(ta.correlation(x, y, 3.5))\n'],
    ['a named argument', 5, 'plot(ta.correlation(x, y, length = 8))\n'],
    ['an argument that could change what the run holds', 5,
      'plot(ta.correlation(x, request.security(syminfo.tickerid, "D", close), 8))\n'],
  ])('%s', (_, version, body) => {
    expect(refusalOf(version, body).guard).toMatch(/^runtime:|^pine:/)
  })
  it('the object door refuses it by name until a capture proves it', () => {
    expect(refusalOf(5, 'plot(ta.correlation(x, y, 8))\n', { objectDoor: true }).guard).toBe('runtime:object-door')
  })
})

describe('the other two sole-blocked names stay refused as undeclared, by name', () => {
  it('`ta.pivot_point_levels` (a real missing builtin, for W1 list)', () => {
    const r = refusalOf(5, 'p = ta.pivot_point_levels("Traditional", x > 0)\nplot(array.get(p, 0))\n')
    expect(r.guard).toBe('runtime:call-undeclared-builtin-state')
    expect(r.token).toBe('ta.pivot_point_levels')
  })
  it('`time(timeframe)` (a real missing builtin: needs a timeframe calendar)', () => {
    const r = refusalOf(5, 'plot(ta.change(time(x > 0 ? "D" : "W")))\n')
    expect(r.guard).toBe('runtime:call-undeclared-builtin-state')
    expect(r.token).toBe('time')
  })
  it('control: the `time` variable is unaffected', () => {
    expect(() => run(5, 'plot(time - time[1])\n')).not.toThrow()
  })
})
