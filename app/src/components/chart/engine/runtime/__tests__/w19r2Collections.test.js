// app/src/components/chart/engine/runtime/__tests__/w19r2Collections.test.js
//
// ─── ⭐⭐ W19-R2 — `array.fill` AND `array.insert` ON THE RUNTIME LANE ─────────
//
// Served to the extent the Pine manual's Arrays page settles them (captured in
// `docs/pine/capture-queue-2026-10-05-w19-r2.md` § Manual): `fill` writes every
// element, or `[index_from, index_to)` with `index_to` exclusive (the manual's
// own `a.fill(close, 1, 3)` writes indices 1 and 2); `insert` puts the element AT
// `index` and moves the ones at or after it up by one. Every index the text does
// not settle (negative, `insert` at `size`, a range past the array) STOPS the run
// by name — Q-W19R2a asks TradingView.
//
// ⛔ EVERY FIXTURE MOVES A VALUE derived from the bars in JavaScript, never typed.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i * 2, l: 98 - i, c: 100 + i * 3, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const closes = BARS.map((b) => b.c)
const highs = BARS.map((b) => b.h)

function runPine(src, version = 6) {
  const built = buildRuntimeIr(`//@version=${version}\nindicator("t", overlay = true)\n${src}`, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o))
}

describe('⭐⭐ `array.fill` — every element, or [from, to) with `to` exclusive', () => {
  it('the two-argument form writes every element (range-filter-dw\'s line)', () => {
    const [sum, first] = runPine([
      'a = array.new_float(4, 0)',
      'array.fill(a, close)',
      'plot(array.sum(a))',
      'plot(array.get(a, 3))',
    ].join('\n'))
    expect(sum).toEqual(closes.map((c) => 4 * c))
    expect(first).toEqual(closes)
  })
  it('the method form is the same call', () => {
    const [sum] = runPine(['a = array.new_float(3, 1)', 'a.fill(high)', 'plot(a.sum())'].join('\n'))
    expect(sum).toEqual(highs.map((h) => 3 * h))
  })
  it('`fill(a, v, 1, 3)` writes indices 1 and 2 only (the manual\'s example)', () => {
    const [s, e0, e3] = runPine([
      'a = array.from(1.0, 2.0, 3.0, 4.0)',
      'a.fill(close, 1, 3)',
      'plot(a.sum())',
      'plot(a.get(0))',
      'plot(a.get(3))',
    ].join('\n'))
    expect(s).toEqual(closes.map((c) => 1 + 2 * c + 4))
    expect(e0).toEqual(closes.map(() => 1))
    expect(e3).toEqual(closes.map(() => 4))
  })
  it('`fill(a, v, from)` runs to the end; an `na` `to` is the end', () => {
    const [s1, s2] = runPine([
      'a = array.from(1.0, 2.0, 3.0)',
      'a.fill(close, 1)',
      'b = array.from(1.0, 2.0, 3.0)',
      'b.fill(close, 2, na)',
      'plot(a.sum())',
      'plot(b.sum())',
    ].join('\n'))
    expect(s1).toEqual(closes.map((c) => 1 + 2 * c))
    expect(s2).toEqual(closes.map((c) => 3 + c))
  })
  it('⛔ a range the manual does not settle STOPS by name', () => {
    expect(() => runPine('a = array.from(1.0, 2.0)\na.fill(close, 0, 3)\nplot(a.sum())'))
      .toThrow(/array\.fill: the range \[0, 3\) over an array of 2 .*Q-W19R2a/)
    expect(() => runPine('a = array.from(1.0, 2.0)\na.fill(close, -1)\nplot(a.sum())'))
      .toThrow(/array\.fill: the range \[-1, 2\)/)
    expect(() => runPine('a = array.from(1.0, 2.0)\na.fill(close, 2, 1)\nplot(a.sum())'))
      .toThrow(/array\.fill: the range \[2, 1\)/)
  })
  it('a filled range that is EMPTY writes nothing and does not stop', () => {
    const [s] = runPine('a = array.from(1.0, 2.0)\na.fill(close, 2, 2)\nplot(a.sum())')
    expect(s).toEqual(closes.map(() => 3))
  })
})

describe('⭐⭐ `array.insert` — at `index`, the rest moved up one', () => {
  it('at 0 and in the middle, as a statement and as a method', () => {
    const [e0, e1, e2, n] = runPine([
      'a = array.from(1.0, 2.0)',
      'array.insert(a, 0, close)',
      'a.insert(2, high)',
      'plot(a.get(0))',
      'plot(a.get(1))',
      'plot(a.get(2))',
      'plot(a.size())',
    ].join('\n'))
    expect(e0).toEqual(closes)
    expect(e1).toEqual(closes.map(() => 1))
    expect(e2).toEqual(highs)
    expect(n).toEqual(closes.map(() => 4))
  })
  it('a `var` list keeps sorted by insertion (bollinger-band-width-percentile\'s shape)', () => {
    const [last, size] = runPine([
      'var a = array.from(-1.0e9)',
      'array.insert(a, 1 - 1, -close)',
      'plot(a.get(0))',
      'plot(a.size())',
    ].join('\n'))
    expect(last).toEqual(closes.map((c) => -c))
    expect(size).toEqual(closes.map((_, i) => i + 2))
  })
  it('⛔ an index the manual does not settle STOPS by name: at `size`, negative, past the end', () => {
    expect(() => runPine('a = array.from(1.0, 2.0)\na.insert(2, close)\nplot(a.sum())'))
      .toThrow(/array\.insert: index 2 into an array of 2 .*Q-W19R2a/)
    expect(() => runPine('a = array.from(1.0, 2.0)\na.insert(-1, close)\nplot(a.sum())'))
      .toThrow(/array\.insert: index -1/)
    expect(() => runPine('a = array.new_float()\na.insert(0, close)\nplot(a.sum())'))
      .toThrow(/array\.insert: index 0 into an array of 0/)
  })
})

describe('⛔ the binary searches stay refused by name (Q-W19R2b)', () => {
  it.each(['array.binary_search', 'array.binary_search_leftmost', 'array.binary_search_rightmost'])('%s', (fn) => {
    const built = buildRuntimeIr(`//@version=6\nindicator("t")\na = array.from(1.0, 2.0)\nplot(${fn}(a, close))`, { bars: BARS, inputs: {} })
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:array')
    expect(built.refusal.message).toContain(fn)
  })
})
