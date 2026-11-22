// app/src/components/chart/engine/runtime/__tests__/udtAc6Readings.test.js
//
// ─── ⭐⭐ UDT UNIT, FOLLOW-UP — WHAT TRADINGVIEW ANSWERED IN CAPTURE RUN ac6 (2026-11-16) ───────────────
//
// Where TradingView refuses to compile, the runtime lane refuses by name; where it raises a runtime error, our run
// stops by name at the bar it reaches the same call (never a value). Each `it` quotes the reading it rests on
// (the capture session's verbatim error text, values unsubstituted).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 99 + i, h: 103 + i, l: 97 + i, c: 100 + i, v: 1000 }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const build = (src) => buildRuntimeIr(`//@version=6\nindicator("t")\n${src}`, { bars: BARS, inputs: {} })
function runPine(src) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o))
}

describe('⛔ a method that never uses its first argument — "The "{argName}" argument is not used. The first method argument should be used." (compile error: vw-w6-receivers, -get-float, -get-int, -pick-int)', () => {
  it.each([
    ['one line', 'method clr(array<string> id) =>\n    1\ns = array.new<string>()\nplot(s.clr())', 'clr', 'id'],
    ['a typed receiver beside another parameter', 'method get2(array<float> a, int i) =>\n    99.0 + i\nplot(array.from(1.0).get2(0))', 'get2', 'a'],
    ['a generic receiver', 'method m2(map<string, float> m) =>\n    1\nplot(close)', 'm2', 'm'],
    ['never called at all (TradingView refuses the whole script)', 'method q(float x) =>\n    1\nplot(close)', 'q', 'x'],
  ])('%s: refused by name at the declaration', (_, src, m, p) => {
    const b = build(src)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:udt-method')
    expect(b.refusal.message).toContain(`\`${m}\` never uses its first argument \`${p}\``)
    expect(b.refusal.message).toMatch(/TradingView does not compile that/)
  })
  it.each([
    ['in the one-line body', 'method clr(array<string> id) => id.size() + 1\ns = array.new<string>()\nplot(s.clr())', 1],
    ['in a block body, through a dotted name', 'method clr(array<string> id) =>\n    n = id.size()\n    n + 1\ns = array.new<string>()\nplot(s.clr())', 1],
    ['through a field of a user-type receiver', 'type P\n    float v\nmethod two(P p) =>\n    p.v * 0 + 2\nplot(P.new(close).two())', 2],
  ])('CONTROL — a method that reads it, %s, builds and runs', (_, src, want) => {
    expect(runPine(src)[0]).toEqual(BARS.map(() => want))
  })
})

describe('⛔ runtime errors TradingView raises, and our run stops on, by name', () => {
  it('array.fill past the end / from a negative start: "Index {index} is out of bounds, array size is {size}" (vw-w19r2a-fill-past-end, -fill-negative-from)', () => {
    expect(() => runPine('a = array.from(1.0, 2.0, 3.0)\narray.fill(a, 7.0, 1, 5)\nplot(array.sum(a))'))
      .toThrow(/array\.fill: the range \[1, 5\) over an array of 3 — TradingView stops the script here too/)
    expect(() => runPine('a = array.from(1.0, 2.0, 3.0)\narray.fill(a, 7.0, -1)\nplot(array.sum(a))'))
      .toThrow(/array\.fill: the range \[-1, 3\) over an array of 3 — TradingView stops the script here too/)
    // a reversed range is still unasked: the old, unsettled sentence
    expect(() => runPine('a = array.from(1.0, 2.0, 3.0)\narray.fill(a, 7.0, 2, 1)\nplot(array.sum(a))'))
      .toThrow(/the manual text this engine holds does not settle that index/)
  })
  it('array.covariance of two sizes: "The sizes of the `id1` and `id2` arrays must be equal." (vw-w6-array-members V02)', () => {
    expect(() => runPine('plot(array.covariance(array.from(1.0), array.from(1.0, 2.0)))'))
      .toThrow(/arrays of 1 and 2 elements — TradingView stops the script here too \("The sizes of the `id1` and `id2` arrays must be equal\."/)
  })
  it('a field read off an `na` object: "Cannot access the \'{name}\' field of an undefined object. The object is \'na\'." (vw-w6-receivers-na-field), on the bar it is reached', () => {
    // W6-T9's own shape: the list's last element is `na` from bar 3 on
    const src = (k) => `type Z\n    float s = 0\nvar zs = array.new<Z>()\nzs.push(bar_index < ${k} ? Z.new(close) : na)\nplot(zs.last().s)`
    expect(() => runPine(src(3))).toThrow(/`\.s` reads a field of a user-defined type, and this value is `na` — TradingView stops the script here too \("Cannot access the 's' field of an undefined object/)
    // CONTROL: no `na` element is ever read, so no stop and the values are the closes
    expect(runPine(src(99))[0]).toEqual(BARS.map((b) => b.c))
  })
})
