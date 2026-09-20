// app/src/components/chart/engine/runtime/__tests__/tuples.test.js
//
// ─── A FUNCTION THAT RETURNS SEVERAL VALUES, AND THE LINE THAT UNPACKS IT ───
//
// ⭐⭐ THIS IS THE ACCEPTANCE SCRIPT'S NEXT WALL. Its per-symbol read is
//
//     [rv, cg, dOpen, dLow, dPrev] = request.security(sym, "1D", calcDaily(n), …)
//
// where `calcDaily` ends `[rv, cg, open, low, close[1]]`. The REQUEST half is a
// separate capability; this is the language half — a user function with several
// results, and destructuring on the receiving side.
//
// ⛔⛔ ORDER IS THE WHOLE RISK. A stack returns values in reverse, so an
// implementation that unpacks in the order it pops assigns every name to the
// wrong value — and each one is a plausible number, so nothing looks broken. A
// dashboard would simply print the change% under "RVOL". Every case below uses
// values that cannot be confused for one another.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 3
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

function runPine(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return Array.from(outputs[0])
}

const all = (v) => new Array(N).fill(v)

const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

describe('tuples', () => {
  it('a function returns two values and the caller unpacks them IN ORDER', () => {
    // ⛔ 1 and 2 are deliberately distinguishable: `a * 10 + b` is 12 in the
    // right order and 21 in the wrong one, so a reversed unpack cannot pass.
    expect(runPine(
      'f() =>\n'
      + '    [1.0, 2.0]\n'
      + '[a, b] = f()\n'
      + 'plot(a * 10 + b)\n')).toEqual(all(12))
  })

  it('five values, which is what the acceptance script actually returns', () => {
    expect(runPine(
      'g() =>\n'
      + '    [1.0, 2.0, 3.0, 4.0, 5.0]\n'
      + '[a, b, c, d, e] = g()\n'
      + 'plot(a * 10000 + b * 1000 + c * 100 + d * 10 + e)\n')).toEqual(all(12345))
  })

  it('the values can be computed, not just literals', () => {
    expect(runPine(
      'h() =>\n'
      + '    float x = close\n'
      + '    [x, x * 2.0]\n'
      + '[p, q] = h()\n'
      + 'plot(q - p)\n')).toEqual(BARS.map((b) => b.c))
  })

  it('a tuple-returning function carries its own state per call site', () => {
    // ⭐ The existing per-call-site rule has to hold for a tuple result too: two
    // calls to one counter are two counters, not one shared by both.
    expect(runPine(
      'c() =>\n'
      + '    var float n = 0.0\n'
      + '    n := n + 1.0\n'
      + '    [n, n * 10.0]\n'
      + '[x1, y1] = c()\n'
      + '[x2, y2] = c()\n'
      + 'plot(x1 + x2)\n')).toEqual(BARS.map((_, i) => (i + 1) * 2))
  })

  it('the unpacked names are ordinary values afterwards', () => {
    expect(runPine(
      'f() =>\n'
      + '    [3.0, 4.0]\n'
      + '[a, b] = f()\n'
      + 'float s = a + b\n'
      + 'plot(s)\n')).toEqual(all(7))
  })

  it('⛔ a COUNT MISMATCH is refused BY NAME, not padded with na', () => {
    // Padding would give the member a table column full of blanks and no reason.
    const r = refusalOf('f() =>\n    [1.0, 2.0]\n[a, b, c] = f()\nplot(a)\n')
    expect(r.message).toMatch(/3|two|2/)
  })

  it('CONTROL: a single-value function is unchanged', () => {
    expect(runPine('f() =>\n    close * 2.0\nplot(f())\n'))
      .toEqual(BARS.map((b) => b.c * 2))
  })

  it('CONTROL: a tuple used as a plain VALUE is refused', () => {
    // `plot(f())` where f returns two values is not a Pine program; the refusal
    // says so rather than plotting whichever value happened to be on top.
    const r = refusalOf('f() =>\n    [1.0, 2.0]\nplot(f())\n')
    expect(r.ok).not.toBe(true)
  })
})
