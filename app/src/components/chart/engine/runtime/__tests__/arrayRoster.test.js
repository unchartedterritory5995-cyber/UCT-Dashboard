// app/src/components/chart/engine/runtime/__tests__/arrayRoster.test.js
//
// ─── THE REST OF THE ARRAY ROSTER THE RUNTIME-LANE CORPUS REACHES FOR ───────
//
// Derived from the scripts walled on `runtime:array` (2026-09-27):
// `shift`/`last` (fibonacci-dolphintradebot), `remove`/`fill`/`avg`
// (range-filter-dw), `max`/`min` (wyckoff), `.unshift`/`.pop`/`.max`/`.min`
// (support-resistance-mtf), `.unshift`/`.avg` (trend-targets); `first` and `sum`
// ride along as the other half of a pair.
//
// Every expectation below is computed by hand from the literal arrays in the
// script, never read back from the engine.
//
// ⛔⛔ TWO KINDS OF STOP, AND THEY ARE DIFFERENT FACTS:
//   · an EMPTY array for `shift`/`pop`/`first`/`last`, an out-of-range index or
//     `nth` — Pine stops the script, and so does this engine (the `array.get`
//     rule in `arrays.test.js`);
//   · an `na` element, or an empty array, for `max`/`min`/`sum`/`avg` — what
//     TradingView answers is NOT MEASURED (capture queue Q5), so the engine stops
//     by name rather than pick one of three rules that disagree.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 4
// close 100, 101, 102, 103
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

function runPine(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return Array.from(outputs[0])
}
const all = (v) => new Array(N).fill(v)

describe('⭐ the mutators that answer a value — shift, pop, remove', () => {
  it('array.shift removes the FIRST element and answers it', () => {
    // x = 10, then [20, 30]: 10·1000 + 2·100 + 20 = 10220
    expect(runPine('a = array.from(10.0, 20.0, 30.0)\nx = array.shift(a)\n'
      + 'plot(x * 1000 + array.size(a) * 100 + array.get(a, 0))\n')).toEqual(all(10220))
  })

  it('…and as a STATEMENT its answer is discarded and the effect kept', () => {
    expect(runPine('a = array.from(10.0, 20.0, 30.0)\narray.shift(a)\n'
      + 'plot(array.get(a, 0) * 10 + array.size(a))\n')).toEqual(all(202))
  })

  it('array.pop removes the LAST element and answers it', () => {
    // x = 30, size 2: 3002
    expect(runPine('a = array.from(10.0, 20.0, 30.0)\nx = array.pop(a)\n'
      + 'plot(x * 100 + array.size(a))\n')).toEqual(all(3002))
  })

  it('array.remove(id, i) removes element i and answers it; the rest close up', () => {
    // x = 20; [10, 30] so a[1] = 30 → 50
    expect(runPine('a = array.from(10.0, 20.0, 30.0)\nx = array.remove(a, 1)\n'
      + 'plot(x + array.get(a, 1))\n')).toEqual(all(50))
  })

  it('⛔ an empty shift, pop, first or last STOPS the script by name', () => {
    for (const fn of ['shift', 'pop', 'first', 'last']) {
      expect(() => runPine(`a = array.new<float>()\nplot(array.${fn}(a))\n`), fn)
        .toThrow(new RegExp(`array\\.${fn}: the array is empty`))
    }
  })

  it('⛔ remove at an out-of-range index STOPS it, naming the index and size', () => {
    expect(() => runPine('a = array.from(1.0, 2.0)\nx = array.remove(a, 5)\nplot(x)\n'))
      .toThrow(/array\.remove: index 5 is outside an array of 2/)
  })
})

describe('⭐ unshift, first, last, fill', () => {
  it('array.unshift inserts at the front', () => {
    expect(runPine('a = array.from(2.0)\narray.unshift(a, 1.0)\n'
      + 'plot(array.get(a, 0) * 10 + array.get(a, 1))\n')).toEqual(all(12))
  })

  it('array.first / array.last read the ends without removing', () => {
    expect(runPine('a = array.from(3.0, 5.0, 7.0)\n'
      + 'plot(array.first(a) * 100 + array.last(a) * 10 + array.size(a))\n')).toEqual(all(373))
  })

  it('array.fill(id, v, from, to) fills the half-open range [from, to)', () => {
    // [0, 9, 9, 0] → 0·1000 + 9·100 + 9·10 + 0 = 990
    expect(runPine('a = array.new<float>(4, 0.0)\narray.fill(a, 9.0, 1, 3)\n'
      + 'plot(array.get(a, 0) * 1000 + array.get(a, 1) * 100 + array.get(a, 2) * 10 + array.get(a, 3))\n'))
      .toEqual(all(990))
  })

  it('array.fill(id, v) fills everything', () => {
    expect(runPine('a = array.new<float>(4, 0.0)\narray.fill(a, 2.0)\nplot(array.sum(a))\n'))
      .toEqual(all(8))
  })

  it('⛔ a fill range outside 0..size, or backwards, STOPS rather than clamps', () => {
    expect(() => runPine('a = array.new<float>(2, 0.0)\narray.fill(a, 1.0, 0, 3)\nplot(array.size(a))\n'))
      .toThrow(/array\.fill: the range 0\.\.3 is not inside an array of 2/)
    expect(() => runPine('a = array.new<float>(2, 0.0)\narray.fill(a, 1.0, 2, 1)\nplot(array.size(a))\n'))
      .toThrow(/array\.fill: the range 2\.\.1/)
  })
})

describe('⭐ max, min, sum, avg — exact over finite numbers', () => {
  const A = 'a = array.from(4.0, 1.0, 3.0, 2.0)\n'
  it('max / min, and their nth', () => {
    expect(runPine(`${A}plot(array.max(a))\n`)).toEqual(all(4))
    expect(runPine(`${A}plot(array.max(a, 1))\n`)).toEqual(all(3))
    expect(runPine(`${A}plot(array.min(a))\n`)).toEqual(all(1))
    expect(runPine(`${A}plot(array.min(a, 2))\n`)).toEqual(all(3))
  })

  it('sum and avg', () => {
    expect(runPine(`${A}plot(array.sum(a))\n`)).toEqual(all(10))
    expect(runPine(`${A}plot(array.avg(a))\n`)).toEqual(all(2.5))
  })

  it('⭐ a `var` FIFO window — push, shift when over 2, average', () => {
    // closes 100,101,102,103 → [100] 100 · [100,101] 100.5 · [101,102] 101.5 · [102,103] 102.5
    expect(runPine('var a = array.new<float>()\narray.push(a, close)\n'
      + 'if array.size(a) > 2\n    array.shift(a)\nplot(array.avg(a))\n'))
      .toEqual([100, 100.5, 101.5, 102.5])
  })

  // Q5, vendor-measured 2026-09-27 (capture rtwalls-array-stats-na-rddt-1d):
  // `[1, na, 3]` answers max 3, min 1, sum 4, avg 2 — na is SKIPPED; and avg/max of
  // an empty array answer na on every bar.
  it('⭐ an `na` element is SKIPPED, as TradingView measures it (Q5)', () => {
    const src = (fn) => `a = array.from(1.0, na, 3.0)\nplot(array.${fn}(a))\n`
    expect(runPine(src('max'))).toEqual(all(3))
    expect(runPine(src('min'))).toEqual(all(1))
    expect(runPine(src('sum'))).toEqual(all(4))
    expect(runPine(src('avg'))).toEqual(all(2))
  })

  it('⭐ an EMPTY array answers na for max / min / avg (Q5)', () => {
    for (const fn of ['max', 'min', 'avg']) {
      expect(runPine(`a = array.new<float>()\nplot(array.${fn}(a))\n`), fn).toEqual(all(NaN))
    }
  })

  it('⛔ a SUM of nothing STOPS by name — 0 and na draw different lines and neither is measured', () => {
    for (const make of ['array.new<float>()', 'array.from(na, na)']) {
      expect(() => runPine(`a = ${make}\nplot(array.sum(a))\n`), make)
        .toThrow(/array\.sum: no number to add .*has not been measured/)
    }
  })

  it('⛔ a non-number element STOPS by name', () => {
    expect(() => runPine('a = array.from("x", "y")\nplot(array.max(a))\n'))
      .toThrow(/array\.max: element 0 is/)
  })

  it('⛔ an nth outside the array STOPS', () => {
    expect(() => runPine(`${A}plot(array.max(a, 4))\n`)).toThrow(/array\.max: nth 4 is outside an array of 4/)
  })
})

describe('⭐ a NUMBER bound from a collection call is still this lane\'s to compute', () => {
  it('`size = array.size(array.from(close))`, read by a later line — the nadaraya-watson shape', () => {
    // The binding is a number, not a collection, so it is an env binding; the
    // columnar lane expands it on read and refuses the collection inside, and the
    // route used to rethrow that (`pine:collection`). One element → 1 on every bar.
    expect(runPine('size = array.size(array.from(close))\nplot(size)\n')).toEqual(all(1))
    expect(runPine('size = array.size(array.from(close, open))\nplot(size * close)\n'))
      .toEqual([200, 202, 204, 206])
  })
})

describe('⭐ the METHOD form reaches the same implementation', () => {
  it('a.unshift / a.pop as statements, a.max / a.last as values', () => {
    // [1,2,3] → unshift 0 → [0,1,2,3] → pop → [0,1,2]; max 2, last 2, size 3 → 223
    expect(runPine('a = array.from(1.0, 2.0, 3.0)\na.unshift(0.0)\na.pop()\n'
      + 'plot(a.max() * 100 + a.last() * 10 + a.size())\n')).toEqual(all(223))
  })

  it('a value read inside a condition — the fibonacci-dolphintradebot shape', () => {
    // [5, 100 + bar]: last = close → `close > array.last(a)` is false → 0
    expect(runPine('a = array.from(5.0)\narray.push(a, close)\n'
      + 'plot(close > array.last(a) ? 1 : 0)\n')).toEqual(all(0))
    expect(runPine('a = array.from(5.0)\n'
      + 'plot(close > array.last(a) ? 1 : 0)\n')).toEqual(all(1))
  })
})
