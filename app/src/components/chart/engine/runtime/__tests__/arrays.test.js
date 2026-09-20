// app/src/components/chart/engine/runtime/__tests__/arrays.test.js
//
// ─── TYPED ARRAYS, THE THING A WATCHLIST BECOMES ────────────────────────────
//
// ⛔⛔ PINE'S OUT-OF-RANGE `array.get` IS A RUNTIME ERROR THAT STOPS THE SCRIPT,
// NOT AN `na`. A dashboard that silently answered `na` for a bad index would
// draw a table with blank cells where TradingView shows an error — and a member
// reads a blank cell as "no data for this symbol" and TRUSTS it. That is a
// wrong answer presented as a fact, which is the one trade this runtime refuses
// to make for coverage. Both directions are pinned below: the throw, and a
// CONTROL that an in-range read does NOT throw, so "it throws" cannot pass for
// the wrong reason.
//
// ⛔ A SLOT HOLDS THE ARRAY ITSELF, and Pine arrays are REFERENCE types — `a2 =
// a1` aliases, `array.copy(a1)` does not. The aliasing case and the copy case
// are both here because an implementation that copied on assignment would pass
// every single-array test in this file.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 4
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

const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

describe('typed arrays in the runtime lane', () => {
  it('array.from + size + get round-trip a string', () => {
    expect(runPine(
      'a = array.from("AAPL", "MSFT")\n'
      + 'plot(array.size(a) == 2 and array.get(a, 1) == "MSFT" ? 1 : 0)\n')).toEqual(all(1))
  })

  it('array.new<T> with a size and an initial value', () => {
    expect(runPine(
      'a = array.new<float>(3, 1.5)\n'
      + 'plot(array.size(a) == 3 and array.get(a, 2) == 1.5 ? 1 : 0)\n')).toEqual(all(1))
  })

  it('push grows it; set replaces in place', () => {
    expect(runPine(
      'a = array.new<string>()\n'
      + 'array.push(a, "X")\n'
      + 'array.push(a, "Y")\n'
      + 'array.set(a, 0, "Z")\n'
      + 'plot(array.size(a) == 2 and array.get(a, 0) == "Z" and array.get(a, 1) == "Y" ? 1 : 0)\n'))
      .toEqual(all(1))
  })

  it('clear empties it', () => {
    expect(runPine(
      'a = array.from(1.0, 2.0, 3.0)\n'
      + 'array.clear(a)\n'
      + 'plot(array.size(a) == 0 ? 1 : 0)\n')).toEqual(all(1))
  })

  it('⛔ copy is a COPY — mutating the copy leaves the original alone', () => {
    expect(runPine(
      'a = array.from(1.0, 2.0)\n'
      + 'b = array.copy(a)\n'
      + 'array.set(b, 0, 9.0)\n'
      + 'plot(array.get(a, 0) == 1.0 and array.get(b, 0) == 9.0 ? 1 : 0)\n')).toEqual(all(1))
  })

  it('⛔ …and plain assignment ALIASES, because a Pine array is a reference', () => {
    // The other half of the same question. An implementation that copied on
    // assignment would pass every case above and be wrong about Pine.
    expect(runPine(
      'a = array.from(1.0, 2.0)\n'
      + 'b = a\n'
      + 'array.set(b, 0, 9.0)\n'
      + 'plot(array.get(a, 0) == 9.0 ? 1 : 0)\n')).toEqual(all(1))
  })

  it('⛔⛔ an out-of-range get STOPS the script — it does not answer na', () => {
    expect(() => runPine(
      'a = array.from(1.0, 2.0)\n'
      + 'plot(array.get(a, 5))\n')).toThrow(/index 5 is outside/)
  })

  it('⛔⛔ …and a negative index likewise', () => {
    expect(() => runPine(
      'a = array.from(1.0, 2.0)\n'
      + 'plot(array.get(a, -1))\n')).toThrow(/index -1 is outside/)
  })

  it('CONTROL: an in-range get does NOT throw', () => {
    // Without this, "it throws" above is satisfied by a `get` that always throws.
    expect(runPine('a = array.from(7.0, 8.0)\nplot(array.get(a, 1))\n')).toEqual(all(8))
  })

  it('CONTROL: set is bounds-checked the same way', () => {
    expect(() => runPine(
      'a = array.from(1.0)\n'
      + 'array.set(a, 3, 2.0)\n'
      + 'plot(array.size(a))\n')).toThrow(/index 3 is outside/)
  })

  it('an array past ARRAY_ELEMENTS raises the LIMIT by name', () => {
    expect(() => runPine(
      'a = array.new<float>()\n'
      + 'array.push(a, 1.0)\n'
      + 'array.push(a, 2.0)\n'
      + 'array.push(a, 3.0)\n'
      + 'plot(array.size(a))\n', { ARRAY_ELEMENTS: 2 })).toThrow(/ARRAY_ELEMENTS/)
  })

  it('CONTROL: the same program is fine under the real ceiling', () => {
    expect(runPine(
      'a = array.new<float>()\n'
      + 'array.push(a, 1.0)\n'
      + 'array.push(a, 2.0)\n'
      + 'array.push(a, 3.0)\n'
      + 'plot(array.size(a))\n')).toEqual(all(3))
  })

  it('CONTROL: array.sort_indices is refused BY NAME — vendor M7 is only PARTIAL', () => {
    // ⚠️ M7 was measured on 2026-09-19 for the tie case (ties keep their order
    // ascending, reversed descending) but its all-equal and already-descending
    // halves are still owed, and `sort_indices`'s whole value is the tie order.
    const r = refusalOf('a = array.from(1.0, 2.0)\nplot(array.size(array.sort_indices(a)))\n')
    expect(r.message).toMatch(/array\.sort_indices/)
  })

  it('CONTROL: matrix.new is refused BY NAME', () => {
    const r = refusalOf('m = matrix.new<float>(2, 2, 0.0)\nplot(matrix.rows(m))\n')
    expect(r.message).toMatch(/matrix\.new/)
  })

  it('array.new<T>(size) with NO initial value is served for int and float…', () => {
    // Pine documents the omitted initial value as `na` for the numeric types.
    expect(runPine(
      'a = array.new<float>(2)\n'
      + 'plot(array.size(a) == 2 and na(array.get(a, 0)) ? 1 : 0)\n')).toEqual(all(1))
  })

  it('…and REFUSED for bool and string, because that default is unmeasured', () => {
    // ⛔ What TradingView fills a sized `bool` or `string` array with has not
    // been measured on a chart, and a guess there is a wrong value in a
    // member's table with nothing to catch it. Both acceptance scripts use the
    // sized form only with <int>, so refusing it costs no coverage at all.
    expect(() => runPine('a = array.new<string>(2)\nplot(array.size(a))\n'))
      .toThrow(/has not been measured/)
  })

  it('a non-array operand is refused BY NAME AND POSITION, at the VM', () => {
    // ⛔ Found unproven by a mutation run: deleting the VM's kind check left
    // every other case here green, because nothing handed an array builtin the
    // wrong kind. `close` is a number; `array.size` takes a collection.
    expect(() => runPine('plot(array.size(close))\n'))
      .toThrow(/`array\.size` argument 1 takes an array, got number/)
  })

  it('⛔ TWO ELEMENT TYPES IN ONE PROGRAM stay apart', () => {
    // ⛔⛔ `array.new<float>` and `array.new<int>` are the same NAME and
    // different programs. Interning the op table by name alone gives the second
    // one the FIRST one's element type — found by a mutation run, and invisible
    // to every other case here because none used two types at once. The sized
    // `<string>` form must still refuse even though a `<float>` one preceded it.
    expect(() => runPine(
      'a = array.new<float>(1)\n'
      + 'b = array.new<string>(1)\n'
      + 'plot(array.size(a) + array.size(b))\n')).toThrow(/has not been measured/)
  })

  it('CONTROL: a void call cannot be used as a VALUE', () => {
    // `array.push` returns nothing; as a value it would leave the stack one
    // short, so it is refused by name rather than found later as an underflow.
    const r = refusalOf('a = array.new<float>()\nplot(array.push(a, 1.0))\n')
    expect(r.message).toMatch(/returns nothing/)
  })

  it('CONTROL: a numeric script is unaffected', () => {
    expect(runPine('plot(close > open ? 1 : 0)\n')).toEqual(all(1))
  })
})
