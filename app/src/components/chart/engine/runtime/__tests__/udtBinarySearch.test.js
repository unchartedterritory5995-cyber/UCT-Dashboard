// app/src/components/chart/engine/runtime/__tests__/udtBinarySearch.test.js
//
// ─── ⭐⭐ UDT UNIT (2026-11-16) — THE BINARY SEARCHES, AND THREE SHAPES TRADINGVIEW DOES NOT COMPILE ──
//
// 1. `array.binary_search` / `_leftmost` / `_rightmost` on the runtime lane, served from their Pine v6
//    reference entries (read through `tools/pine_survey/pine_reference_extract.js`); each `it` cites the
//    sentence it rests on. What the entries do not settle STOPS the run by name (Q-W19R2b). Two answers
//    the entries do not state are served because a capture witnesses them: `binary_search_rightmost` of an
//    EMPTY array is 0, and `array.insert` at `size` appends —
//    `vendorHarness.udtBinarySearch.test.js` grades `bollinger-band-width-percentile-rddt-1d-2026-11-14`.
// 2. Three READINGS of the capture queue's run cq1-2026-11-16 (TradingView's compile errors, PR #1472),
//    each refused by name here because a script TradingView refuses must not run on ours:
//    `array.every` / `array.some` over a non-bool array (`vw-w6-array-members`), two enum fields sharing
//    a name or title (`vw-w6-enum`), and assigning a `for … in` element variable
//    (`vw-w6-forin-loopvar-write`).
//
// ⛔ EVERY SERVED FIXTURE MOVES with the bars; the expected value is computed here in JavaScript.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { Budget } from '../limits.js'

const N = 6
// `low < open < close < high` on every bar (the sorted row below relies on it)
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + i * 3.5
  return { t: 1700000000 + i * 86400, o: c - 1, h: c + 2, l: c - 3, c, v: 1000 + i }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const per = (f) => BARS.map((b, i) => f(b, i))

const build = (src, version = 6) => buildRuntimeIr(`//@version=${version}\nindicator("t")\n${src}`, { bars: BARS, inputs: {} })
function runPine(src, version = 6) {
  const built = build(src, version)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o))
}
const refusalOf = (src, version = 6) => {
  const b = build(src, version)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

// The sorted array every fixture searches: (low, open, close, close, high) — `low < open < close < high`
// on every bar, and close appears twice.
const ROW = 'a = array.from(low, open, close, close, high)\n'
const row = (b) => [b.l, b.o, b.c, b.c, b.h]

describe('⭐ array.binary_search — "returns an element\'s index if the value from that element equals the target value. Otherwise, it returns -1"', () => {
  it('the reference example: (5, -2, 0, 9, 1) sorted, 0 is at 1', () => {
    const [p] = runPine('a = array.from(5, -2, 0, 9, 1)\narray.sort(a)\nplot(array.binary_search(a, 0))')
    expect(p).toEqual(per(() => 1))
  })
  it('found once: its index; absent: -1; an empty array holds nothing equal: -1', () => {
    const [o, h, mid, e] = runPine(`${ROW}plot(array.binary_search(a, open))\nplot(a.binary_search(high))\n`
      + 'plot(array.binary_search(a, (open + close) / 2))\nplot(array.binary_search(array.new_float(), close))')
    expect(o).toEqual(per(() => 1))
    expect(h).toEqual(per(() => 4))
    expect(mid).toEqual(per(() => -1))
    expect(e).toEqual(per(() => -1))
  })
  it('⛔ a value held by several elements stops by name: "does not necessarily correspond to the first or last occurrence"', () => {
    expect(() => runPine(`${ROW}plot(array.binary_search(a, close))`)).toThrow(/held by 2 elements.*Q-W19R2b/)
  })
})

describe('⭐ array.binary_search_leftmost — "the first element whose retrieved value equals that value. Otherwise … the last element whose retrieved value is less than the target value, or 0 if the target value is less than the value from the first element"', () => {
  it('the reference examples: 3 in (-2, 0, 1, 5, 9) is 2; 5 in (4, 5, 5, 5) is 1', () => {
    const [p, q] = runPine('a = array.from(5, -2, 0, 9, 1)\narray.sort(a)\nplot(array.binary_search_leftmost(a, 3))\n'
      + 'b = array.from(4, 5, 5, 5)\nplot(array.binary_search_leftmost(b, 5))')
    expect(p).toEqual(per(() => 2))
    expect(q).toEqual(per(() => 1))
  })
  it('found: the FIRST equal; between: the last below; below all: 0; above all: the last index', () => {
    const [c, mid, lo, hi] = runPine(`${ROW}plot(array.binary_search_leftmost(a, close))\n`
      + 'plot(a.binary_search_leftmost((close + high) / 2))\nplot(a.binary_search_leftmost(low - 1))\n'
      + 'plot(a.binary_search_leftmost(high + 1))')
    expect(c).toEqual(per((b) => row(b).indexOf(b.c)))
    expect(mid).toEqual(per(() => 3))
    expect(lo).toEqual(per(() => 0))
    expect(hi).toEqual(per(() => 4))
  })
  it('⛔ an EMPTY array stops by name: neither clause has an element to name', () => {
    expect(() => runPine('plot(array.binary_search_leftmost(array.new_float(), close))')).toThrow(/leftmost of an empty array.*Q-W19R2b/)
  })
})

describe('⭐ array.binary_search_rightmost — "the last element whose retrieved value equals that value. Otherwise … the first element whose retrieved value is greater than the target value, or the array\'s last index plus one if the target value is greater than the value from the last element"', () => {
  it('the reference examples: 3 in (-2, 0, 1, 5, 9) is 3; 5 in (4, 5, 5, 5) is 3', () => {
    const [p, q] = runPine('a = array.from(5, -2, 0, 9, 1)\narray.sort(a)\nplot(array.binary_search_rightmost(a, 3))\n'
      + 'b = array.from(4, 5, 5, 5)\nplot(array.binary_search_rightmost(b, 5))')
    expect(p).toEqual(per(() => 3))
    expect(q).toEqual(per(() => 3))
  })
  it('found: the LAST equal; between: the first above; below all: 0; above all: the last index plus one', () => {
    const [c, mid, lo, hi] = runPine(`${ROW}plot(array.binary_search_rightmost(a, close))\n`
      + 'plot(a.binary_search_rightmost((open + close) / 2))\nplot(a.binary_search_rightmost(low - 1))\n'
      + 'plot(a.binary_search_rightmost(high + 1))')
    expect(c).toEqual(per((b) => row(b).lastIndexOf(b.c)))
    expect(mid).toEqual(per(() => 2))
    expect(lo).toEqual(per(() => 0))
    expect(hi).toEqual(per(() => 5))
  })
  it('an EMPTY array answers 0 (witnessed by the BBWP capture, not read), and an insert there is an append', () => {
    // bollinger-band-width-percentile's own shape: a `var` list kept sorted by inserting each value at its
    // rightmost position, from empty
    const [n, first, last] = runPine('var s = array.new_float()\narray.insert(s, array.binary_search_rightmost(s, close), close)\n'
      + 'plot(s.size())\nplot(s.first())\nplot(s.last())')
    expect(n).toEqual(per((_, i) => i + 1))
    expect(first).toEqual(per(() => BARS[0].c))
    expect(last).toEqual(per((b) => b.c))
  })
})

describe('⛔ what the three entries do not settle stops the run BY NAME (Q-W19R2b)', () => {
  it.each(['array.binary_search', 'array.binary_search_leftmost', 'array.binary_search_rightmost'])('%s', (fn) => {
    // not sorted ascending: "must be sorted in ascending order … for correct results"
    expect(() => runPine(`a = array.from(high, low)\nplot(${fn}(a, close))`)).toThrow(/not sorted ascending.*Q-W19R2b/)
    // an `na` element, an `na` target
    expect(() => runPine(`a = array.from(low, na, high)\nplot(${fn}(a, close))`)).toThrow(/over an `na` element.*Q-W19R2b/)
    expect(() => runPine(`a = array.from(low, high)\nplot(${fn}(a, na))`)).toThrow(/of an `na` target.*Q-W19R2b/)
    // CONTROL: the same calls over a sorted, na-free array run
    expect(runPine(`a = array.from(low, high)\nplot(${fn}(a, high))`)[0].every(Number.isFinite)).toBe(true)
  })
})

describe('⭐ array.get at an `na` index reads `na` and does not stop — v4 and v6 (witnessed), never at the object door', () => {
  const GET = 'a = array.from(10.0, 20.0)\nfloat nothing = na\nplot(array.get(a, math.round(nothing)))\nplot(bar_index)'
  it('v6: `na`, every bar, and the run goes on (bollinger-band-width-percentile\'s first bars)', () => {
    const [g, n] = runPine(GET)
    expect(g.every(Number.isNaN)).toBe(true)
    expect(n).toEqual(per((_, i) => i))
  })
  it('v4: `na` (vw-uie3-na-index-v4-spy-1d-2026-11-16, N03)', () => {
    const built = buildRuntimeIr('//@version=4\nstudy("t")\na = array.from(10, 20)\nfloat nothing = na\n'
      + 'plot(array.get(a, round(max(sign(nothing), 0))))', { bars: BARS, inputs: {} })
    expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
    const program = lowerIrProgram(built.ir)
    const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
    expect(Array.from(outputs[0]).every(Number.isNaN)).toBe(true)
  })
  it('⛔ v5 (not witnessed), a fractional index and an index past the end keep the stop', () => {
    expect(() => runPine(GET, 5)).toThrow(/array\.get: index NaN is outside an array of 2/)
    expect(() => runPine('a = array.from(10.0, 20.0)\nplot(array.get(a, 0.5))')).toThrow(/array\.get: index 0\.5/)
    expect(() => runPine('a = array.from(10.0, 20.0)\nplot(array.get(a, 2))')).toThrow(/array\.get: index 2 is outside/)
  })
  it('⛔ the C18 object door\'s run keeps master\'s stop (it is the one caller that carries `budget.unmeasured`)', () => {
    const built = build(GET)
    const program = lowerIrProgram(built.ir)
    const budget = new Budget()
    budget.unmeasured = { probe: -7.5, colourProbe: 0, hits: [] }
    expect(() => execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }, undefined, { budget }))
      .toThrow(/array\.get: index NaN is outside an array of 2/)
  })
})

describe('⛔⛔ READINGS — shapes TradingView does not compile are refused by name (run cq1-2026-11-16)', () => {
  it('array.every / array.some over a numeric array (vw-w6-array-members: "An argument of … type was used but a … is expected")', () => {
    for (const fn of ['array.every', 'array.some']) {
      const r = refusalOf(`plot(${fn}(array.from(1.5, 0.0)) ? 1 : 0)`)
      expect(r.guard).toBe('runtime:array')
      expect(r.message).toMatch(new RegExp(`\`${fn.replace('.', '\\.')}\` over an \`array<float>\`.*does not compile`))
    }
    // a binding whose element type this lane cannot prove: refused, and the sentence says how to write it
    expect(refusalOf('f = array.new_float()\nplot(f.some() ? 1 : 0)').message).toMatch(/cannot prove is `bool`.*array<bool> name/)
    // CONTROL: over a WRITTEN array<bool>, and over a bool array built in place, it is served
    expect(runPine('array<bool> b = array.from(close > open, true)\nplot(array.some(b) ? 1 : 0)')[0]).toEqual(per(() => 1))
    expect(runPine('plot(array.every(array.from(close > 0, open > 0)) ? 1 : 0)')[0]).toEqual(per(() => 1))
  })
  it('two enum fields sharing a name or title (vw-w6-enum: "cannot match the name or title of the … field")', () => {
    const r = refusalOf('enum T\n    p = "Same"\n    q = "Same"\nplot(close)')
    expect(r.guard).toBe('runtime:enum')
    expect(r.message).toMatch(/fields `p` and `q` share the name or title "Same".*does not compile/)
    expect(refusalOf('enum T\n    p = "q"\n    q\nplot(close)').message).toMatch(/share the name or title "q"/)
    // CONTROL
    expect(runPine('enum T\n    p = "P"\n    q\nplot(T.p == T.q ? 1 : 0)')[0]).toEqual(per(() => 0))
  })
  it('assigning a `for … in` element variable (vw-w6-forin-loopvar-write: "Variable … cannot be mutable")', () => {
    const r = refusalOf('a = array.from(1.0, 2.0, 3.0)\nfloat s = 0.0\nfor x in a\n    x := x * 10\n    s += x\nplot(s)')
    expect(r.guard).toBe('runtime:loop')
    expect(r.message).toMatch(/assigns the loop variable `x`, and TradingView does not compile that/)
    // a write THROUGH the element keeps its own (W6-F1) sentence: not this reading
    const rec = refusalOf('type P\n    float v\nps = array.from(P.new(1))\nfor p in ps\n    p.v := 2\nplot(close)')
    expect(rec.message).toMatch(/writes the loop variable `p` or through it, not yet captured \(W6-F1\)/)
    // CONTROL: reading it is served
    expect(runPine('a = array.from(1.0, 2.0, 3.0)\nfloat s = 0.0\nfor x in a\n    s += x\nplot(s)')[0]).toEqual(per(() => 6))
  })
})
