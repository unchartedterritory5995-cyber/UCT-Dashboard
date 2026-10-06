// app/src/components/chart/engine/runtime/__tests__/respelledBuiltins.test.js
//
// ─── ⭐⭐ RT3 — `iff`, `vwma`, `linreg`, `alma` OVER RUNTIME STATE ──────────────
//
// Each refused `runtime:call-undeclared-builtin-state` ("the CLOSED TABLE does
// not declare it at all") when fed a value the runtime produces. Each is defined
// by Pine itself in vocabulary this lane already runs, so RT3 rebuilds it as a
// parse tree over the call's own arguments (`pineRuntimeFrontend.js::
// runtimeRespelling`): `iff` and `vwma`/`linreg` through the HOST lane's own
// expansions (`pine.js::BUILTIN_CALL_TREE`), `alma` from TradingView's published
// `pine_alma`.
//
// No vendor capture covers the corpus scripts these unblock, so every number
// here is graded against an INDEPENDENT reference written from Pine's own
// definition in plain JS over the same bars — never against the expansion
// itself, which would only prove the expansion equals itself.

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
// the runtime value every case reads: a VARIABLE, so the call is fed runtime state
const X = BARS.map((b) => b.c * 2 - b.o)
const STATE = 'var float x = 0.0\nx := close * 2 - open\n'

function run(version, body) {
  const head = `//@version=${version}\n${version >= 5 ? 'indicator' : 'study'}("t")\n`
  const built = buildRuntimeIr(`${head}${STATE}${body}`, { bars: BARS, inputs: {} })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}
const refusalOf = (version, body) => {
  const head = `//@version=${version}\n${version >= 5 ? 'indicator' : 'study'}("t")\n`
  const b = buildRuntimeIr(`${head}${STATE}${body}`, { bars: BARS, inputs: {} })
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}
const near = (ours, ref, tol = 1e-9) => {
  expect(ours.length).toBe(ref.length)
  let compared = 0
  ref.forEach((r, i) => {
    if (Number.isNaN(r)) { expect(Number.isNaN(ours[i]), `bar ${i}: ours ${ours[i]}, Pine na`).toBe(true); return }
    expect(Math.abs(ours[i] - r), `bar ${i}: ours ${ours[i]}, Pine ${r}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(r)))
    compared += 1
  })
  expect(compared).toBeGreaterThan(N / 2) // non-vacuity: most bars carry a number
}

// ── Pine's definitions, written out ──
const window = (xs, i, n) => (i - n + 1 < 0 ? null : xs.slice(i - n + 1, i + 1)) // oldest → newest
const sma = (xs, n) => xs.map((_, i) => { const w = window(xs, i, n); return w ? w.reduce((a, b) => a + b, 0) / n : NaN })
const linreg = (xs, n, off) => xs.map((_, i) => {
  const w = window(xs, i, n)
  if (!w) return NaN
  // least squares of y over x = 0..n-1 (oldest = 0), evaluated at x = n - 1 - off
  const mx = (n - 1) / 2
  const my = w.reduce((a, b) => a + b, 0) / n
  let sxy = 0; let sxx = 0
  w.forEach((y, k) => { sxy += (k - mx) * (y - my); sxx += (k - mx) * (k - mx) })
  const slope = sxy / sxx
  return my - slope * mx + slope * (n - 1 - off)
})
const alma = (xs, n, offset, sigma, floor = false) => xs.map((_, i) => {
  // TradingView's `pine_alma`, verbatim
  if (i - n + 1 < 0) return NaN
  const m = floor ? Math.floor(offset * (n - 1)) : offset * (n - 1)
  const s = n / sigma
  let norm = 0; let sum = 0
  for (let k = 0; k <= n - 1; k += 1) {
    const weight = Math.exp(-1 * Math.pow(k - m, 2) / (2 * Math.pow(s, 2)))
    norm += weight
    sum += xs[i - (n - k - 1)] * weight
  }
  return sum / norm
})

describe('⭐⭐ admitted, and equal to Pine\'s own definition', () => {
  it('`iff` (v4) is the ternary over runtime state', () => {
    const ours = run(4, 'plot(iff(x > open, x, open))\n')
    near(ours, X.map((x, i) => (x > BARS[i].o ? x : BARS[i].o)))
  })

  it('`vwma` / `ta.vwma` is sma(src * volume, n) / sma(volume, n)', () => {
    const vol = BARS.map((b) => b.v)
    const ref = sma(X.map((x, i) => x * vol[i]), 6).map((a, i) => a / sma(vol, 6)[i])
    near(run(5, 'plot(ta.vwma(x, 6))\n'), ref)
    near(run(4, 'plot(vwma(x, 6))\n'), ref)
  })

  it.each([[0], [2]])('`ta.linreg(src, 9, %i)` is the least-squares line at `n - 1 - offset`', (off) => {
    near(run(5, `plot(ta.linreg(x, 9, ${off}))\n`), linreg(X, 9, off), 1e-9)
  })

  it('a length that is an input folds at its default, like every window', () => {
    near(run(5, 'len = input.int(7, "len")\nplot(ta.linreg(x, len, 1))\n'), linreg(X, 7, 1), 1e-9)
  })

  it.each([[false], [true]])('`ta.alma(src, 9, 0.85, 6, floor=%s)` is `pine_alma`', (floor) => {
    const call = floor ? 'ta.alma(x, 9, 0.85, 6, true)' : 'ta.alma(x, 9, 0.85, 6)'
    near(run(5, `plot(${call})\n`), alma(X, 9, 0.85, 6, floor), 1e-12)
  })

  it('control: the references are not each other (a wrong formula would be seen)', () => {
    const a = linreg(X, 9, 0); const b = sma(X, 9); const c = alma(X, 9, 0.85, 6)
    expect(a.slice(20).some((v, i) => Math.abs(v - b[20 + i]) > 1e-3)).toBe(true)
    expect(c.slice(20).some((v, i) => Math.abs(v - b[20 + i]) > 1e-3)).toBe(true)
  })
})

describe('⛔ still refused, by name', () => {
  it.each([
    ['a length only known while the bar runs', 5, 'plot(ta.linreg(x, bar_index % 5 + 2, 0))\n'],
    ['a named argument', 5, 'plot(ta.alma(x, 9, 0.85, sigma = 6))\n'],
    ['`iff` in v5 (Pine removed it)', 5, 'plot(iff(x > open, x, open))\n'],
    ['a `ta.` spelling in a v4 script', 4, 'plot(ta.vwma(x, 6))\n'],
  ])('%s', (_, version, body) => {
    expect(refusalOf(version, body).guard).toMatch(/^runtime:|^pine:/)
  })

  it('control: the same calls written correctly compile', () => {
    expect(() => run(5, 'plot(ta.linreg(x, 5, 0))\n')).not.toThrow()
    expect(() => run(5, 'plot(ta.alma(x, 9, 0.85, 6))\n')).not.toThrow()
    expect(() => run(4, 'plot(iff(x > open, x, open))\n')).not.toThrow()
    expect(() => run(4, 'plot(vwma(x, 6))\n')).not.toThrow()
  })
})
