// app/src/components/chart/engine/runtime/__tests__/loops.test.js
//
// ─── `for … to … [by]`, `break`, `continue` ─────────────────────────────────
//
// ⛔⛔ PINE'S LOOP COUNTS DOWN WHEN `to` IS LESS THAN `from`, and `by` is used
// as a MAGNITUDE. `for i = 5 to 1` runs five times descending; it is not an
// empty loop. Both bounds are INCLUSIVE. Getting either wrong is silent: a
// watchlist walk would visit the wrong symbols, or none, and still draw a
// table.
//
// ⛔ `from` AND `to` ARE EVALUATED ONCE, at loop entry. A script whose body
// pushes to the array it is walking must not walk the new elements — that is
// the difference between a bounded loop and one that grows as it runs.
//
// ⭐ THE BOUNDS ARE OFTEN ONLY KNOWN WHILE THE BAR RUNS (`array.size(parts) -
// 1`), so the DIRECTION cannot be decided when the program is built. It is
// computed at loop entry from the values themselves.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 3
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

function runPine(src, limits) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  }, limits)
  return Array.from(outputs[0])
}

const all = (v) => new Array(N).fill(v)

describe('the for loop', () => {
  it('sums an inclusive range', () => {
    // 1+2+3+4 = 10. If `to` were exclusive this would be 6.
    expect(runPine(
      'float s = 0.0\n'
      + 'for i = 1 to 4\n'
      + '    s := s + i\n'
      + 'plot(s)\n')).toEqual(all(10))
  })

  it('⛔ counts DOWN when `to` is less than `from`', () => {
    // 5+4+3+2+1 = 15. An implementation that treated this as an empty loop
    // would plot 0 — and a watchlist walked backwards is a real Pine idiom.
    expect(runPine(
      'float s = 0.0\n'
      + 'for i = 5 to 1\n'
      + '    s := s + i\n'
      + 'plot(s)\n')).toEqual(all(15))
  })

  it('honours `by`', () => {
    // 0+2+4+6 = 12 (0 to 7 by 2 stops at 6).
    expect(runPine(
      'float s = 0.0\n'
      + 'for i = 0 to 7 by 2\n'
      + '    s := s + i\n'
      + 'plot(s)\n')).toEqual(all(12))
  })

  it('⛔ `by` is a MAGNITUDE — a descending loop still steps by it', () => {
    // 6+4+2+0 = 12.
    expect(runPine(
      'float s = 0.0\n'
      + 'for i = 6 to 0 by 2\n'
      + '    s := s + i\n'
      + 'plot(s)\n')).toEqual(all(12))
  })

  it('⛔ a NEGATIVE `by` is used as a magnitude', () => {
    // 1+3 = 4. `for i = 1 to 4 by -2` steps FORWARD by 2, because the counter's
    // direction comes from the bounds and `by` contributes only its size.
    //
    // ⚠️ THIS IS THE PUBLISHED REFERENCE, NOT A CHART MEASUREMENT. Pine's
    // `for` documents step_num as "the absolute value is used" — the same
    // standing as the `array.new` default this engine also takes from the docs.
    // A chart capture would settle it harder; without this case the magnitude
    // logic is unproven, because a positive `by` behaves identically with or
    // without it (found by a mutation run).
    expect(runPine(
      'float s = 0.0\n'
      + 'for i = 1 to 4 by -2\n'
      + '    s := s + i\n'
      + 'plot(s)\n')).toEqual(all(4))
  })

  it('⛔ break leaves the loop IMMEDIATELY — later iterations do not run', () => {
    // ⛔⛔ THE FIXTURE ORDER IS THE POINT. With the increment BEFORE the break,
    // a `break` wrongly wired to the step instead of the exit still produces
    // the right answer in a "skip the adds" fixture — it just keeps looping
    // uselessly. Here it would run all ten passes and plot 10 instead of 3.
    // Found by a mutation run; the earlier break case could not see it.
    expect(runPine(
      'float s = 0.0\n'
      + 'for i = 1 to 10\n'
      + '    s := s + 1.0\n'
      + '    if i >= 3\n'
      + '        break\n'
      + 'plot(s)\n')).toEqual(all(3))
  })

  it('⛔ the counter is not visible to its OWN bounds', () => {
    // `for i = i to 3` is not a Pine program. The bounds are lowered in the
    // ENCLOSING scope, so `i` here is an unbound name and refuses — rather
    // than silently resolving to the counter slot and reading `na`.
    const r = buildRuntimeIr(`${head}float s = 0.0\nfor i = i to 3\n    s := s + 1.0\nplot(s)\n`,
      { bars: BARS, inputs: {} })
    expect(r.ok).toBe(false)
  })

  it('a single-iteration loop runs ONCE, not zero times', () => {
    expect(runPine(
      'float s = 0.0\n'
      + 'for i = 3 to 3\n'
      + '    s := s + 1.0\n'
      + 'plot(s)\n')).toEqual(all(1))
  })

  it('break leaves the loop', () => {
    // 1+2+3 = 6, then break before adding 4.
    expect(runPine(
      'float s = 0.0\n'
      + 'for i = 1 to 10\n'
      + '    if i > 3\n'
      + '        break\n'
      + '    s := s + i\n'
      + 'plot(s)\n')).toEqual(all(6))
  })

  it('continue skips the rest of the body but still advances', () => {
    // ⛔ THE CONDITION IS DELIBERATELY "SKIP THE EARLY ONES". A `continue` that
    // skipped the LATE ones would sum 1..4 — exactly what `break` gives — so
    // the fixture could not tell the two apart. Skipping 1..4 and summing 5..9
    // = 35 is reachable only if the loop kept going after the skip.
    //
    // ⚠️ `i % 2 == 0` would have been the natural fixture and is not writable:
    // neither lane has a `%` operator (`interpret.js`'s BINARY table has none
    // either), so it refuses by name. Recorded rather than worked around,
    // because the first instinct on reading this test will be to "simplify" it
    // back to modulo.
    expect(runPine(
      'float s = 0.0\n'
      + 'for i = 1 to 9\n'
      + '    if i < 5\n'
      + '        continue\n'
      + '    s := s + i\n'
      + 'plot(s)\n')).toEqual(all(35))
  })

  it('the counter is visible in the body and gone after it', () => {
    const r = buildRuntimeIr(`${head}float s = 0.0\nfor i = 1 to 2\n    s := s + i\nplot(s + i)\n`,
      { bars: BARS, inputs: {} })
    expect(r.ok).toBe(false)
  })

  it('nests', () => {
    // 3 outer x 4 inner = 12 increments.
    expect(runPine(
      'float s = 0.0\n'
      + 'for i = 1 to 3\n'
      + '    for j = 1 to 4\n'
      + '        s := s + 1.0\n'
      + 'plot(s)\n')).toEqual(all(12))
  })

  it('⛔ the bounds are evaluated ONCE — a body that grows the array does not extend the walk', () => {
    // The array starts with 2 elements; the body pushes one per iteration. A
    // loop that re-read `array.size(a)` every pass would never terminate (and
    // would be caught only by the iteration ceiling, thousands of passes later).
    expect(runPine(
      'a = array.from(1.0, 2.0)\n'
      + 'float s = 0.0\n'
      + 'for i = 0 to array.size(a) - 1\n'
      + '    s := s + array.get(a, i)\n'
      + '    array.push(a, 9.0)\n'
      + 'plot(s)\n')).toEqual(all(3))
  })

  it('walks an array — the shape a watchlist parse is made of', () => {
    expect(runPine(
      'p = str.split("AAPL,MSFT,NVDA", ",")\n'
      + 'float n = 0.0\n'
      + 'for i = 0 to array.size(p) - 1\n'
      + '    if str.length(array.get(p, i)) > 0\n'
      + '        n := n + 1.0\n'
      + 'plot(n)\n')).toEqual(all(3))
  })

  it('an empty range does not run the body', () => {
    // `0 to array.size(a) - 1` over an EMPTY array is `0 to -1`, which in Pine
    // counts DOWN from 0 to -1 — two iterations, not zero. The scripts guard
    // this with a size check, and so must anyone reading this test.
    expect(runPine(
      'a = array.new<float>()\n'
      + 'float s = 0.0\n'
      + 'if array.size(a) > 0\n'
      + '    for i = 0 to array.size(a) - 1\n'
      + '        s := s + 1.0\n'
      + 'plot(s)\n')).toEqual(all(0))
  })

  it('a runaway loop is stopped by LOOP_ITERATIONS, by name', () => {
    expect(() => runPine(
      'float s = 0.0\n'
      + 'for i = 1 to 100\n'
      + '    s := s + 1.0\n'
      + 'plot(s)\n', { LOOP_ITERATIONS: 10 })).toThrow(/LOOP_ITERATIONS/)
  })

  it('CONTROL: the same program is fine under the real ceiling', () => {
    expect(runPine(
      'float s = 0.0\n'
      + 'for i = 1 to 100\n'
      + '    s := s + 1.0\n'
      + 'plot(s)\n')).toEqual(all(100))
  })

  it('LOOP_NESTING is bounded by name', () => {
    expect(() => runPine(
      'float s = 0.0\n'
      + 'for i = 1 to 2\n'
      + '    for j = 1 to 2\n'
      + '        s := s + 1.0\n'
      + 'plot(s)\n', { LOOP_NESTING: 1 })).toThrow(/LOOP_NESTING/)
  })
})
