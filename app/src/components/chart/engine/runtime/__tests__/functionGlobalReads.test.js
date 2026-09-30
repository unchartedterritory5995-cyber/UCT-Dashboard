// app/src/components/chart/engine/runtime/__tests__/functionGlobalReads.test.js
//
// ─── ⭐⭐ C11 — A FUNCTION READS A GLOBAL, AND MUTATES A GLOBAL ARRAY THROUGH IT ─
//
// Pine lets a function body READ any variable declared above it — its CURRENT
// value, at the moment of the call — and, because an array is a reference, lets
// the body push into / clear / read a global array. What Pine forbids is
// ASSIGNING a global inside a function (`g := …` is a compile error), and that
// stays a refusal here.
//
// ⚰️ MEASURED (C11 step 1): `runtime:function-global-state` was the first wall of
// three of the nine C11 scripts — `options-max-pain-calculator-backquant`
// (`array.clear(strikes)` inside `generate_strikes`), `dual-view-htf-candlestick-
// patterns-theultimator5` (`array.size(htf_close)` inside `get_htf_open`) and
// `vdubus-pattern-gen-v2-restored-refined` (`array.size(waveHighs_val)`).
//
// ⛔ EVERY FIXTURE READS A VALUE THAT CHANGES BETWEEN CALLS, so a lane answering
// the global's value at some OTHER moment — the bar's start, the previous bar,
// a copy taken at definition — gives a different number.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { makeIrProgram, validateIr, readGlobal, exprStmt } from '../ir.js'
import { makeProgram, OP } from '../program.js'

const N = 5
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i * 2, l: 98 - i, c: 100 + i * 3, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t", overlay = true)\n'
const closes = BARS.map((b) => b.c)

const build = (src) => buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
function runPine(src) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o))
}

describe('⭐⭐ a function READS a global — its value at the moment of the call', () => {
  it('a `var` global read after it moved, and again after it moved again', () => {
    // g is 10·(bar+1) at the first call and 10·(bar+1)+1 at the second, so a
    // read of the global at any moment other than the call's gives another sum.
    const [out] = runPine(
      'var g = 0.0\n'
      + 'g := g + 10\n'
      + 'f(x) => x + g\n'
      + 'a = f(close)\n'
      + 'g := g + 1\n'
      + 'b = f(0)\n'
      + 'g := g - 1\n'
      + 'plot(a * 1000 + b)\n')
    expect(out).toEqual(closes.map((c, i) => (c + 10 * (i + 1)) * 1000 + 10 * (i + 1) + 1))
  })

  it('a per-bar (non-var) global, recomputed every bar', () => {
    const [out] = runPine(
      'm = close * 2\n'
      + 'm := m + 1\n'
      + 'f() => m * 10\n'
      + 'plot(f())\n')
    expect(out).toEqual(closes.map((c) => (c * 2 + 1) * 10))
  })

  it('⭐ max-pain\'s shape: a helper CLEARS and FILLS a global array, the caller reads it', () => {
    const [n, last] = runPine(
      'var strikes = array.new<float>()\n'
      + 'fill_strikes(k) =>\n'
      + '    array.clear(strikes)\n'
      + '    for i = 1 to k\n'
      + '        array.push(strikes, close + i)\n'
      + '    array.size(strikes)\n'
      + 'fill_strikes(3)\n'
      + 'plot(array.size(strikes))\n'
      + 'plot(array.get(strikes, array.size(strikes) - 1))\n')
    expect(n).toEqual(closes.map(() => 3))
    expect(last).toEqual(closes.map((c) => c + 3))
  })

  it('the METHOD form on a global array inside a function', () => {
    const [out] = runPine(
      'var w = array.new_float(0)\n'
      + 'grow(v) =>\n'
      + '    w.push(v)\n'
      + '    w.size()\n'
      + 'plot(grow(close) * 1000 + w.last())\n')
    expect(out).toEqual(closes.map((c, i) => (i + 1) * 1000 + c))
  })
})

describe('⛔ what Pine forbids, or has not been measured, still refuses by name', () => {
  it('ASSIGNING a global inside a function refuses — Pine does not compile it', () => {
    const r = build('var g = 0.0\nf(x) =>\n    g := x\n    x\nplot(f(close))\n')
    expect(r.ok).toBe(false)
  })

  it('a global\'s HISTORY inside a function still refuses — whose past it is has not been measured', () => {
    const r = build('var g = 0.0\ng := g + close\nf() => g[1]\nplot(f())\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:function-global-state')
  })

  it('a WINDOW over a bare global inside a function still refuses', () => {
    const r = build('var g = 0.0\ng := g + close\nf() => ta.sma(g, 3)\nplot(f())\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:function-global-state')
  })

  it('⛔ CONTROL — the same body at the ROOT reads the variable directly (no frame, no global op)', () => {
    const [out] = runPine('var g = 0.0\ng := g + 10\nplot(close + g)\n')
    expect(out).toEqual(closes.map((c, i) => c + 10 * (i + 1)))
  })
})

// ⛔ THE ARTIFACT BOUNDARY. The front end only ever emits a global read of a
// MAIN-program slot, so both checks below are unreachable from Pine — they are
// proved from a hand-edited artifact, the way `drop` is in callForEffect.test.js.
describe('⛔ a global read names a main-frame address, or the artifact is refused', () => {
  const built = build('var m = 0.0\nm := m + close\nf(x) =>\n    y = x + 1\n    y\nplot(f(m))\n')
  const withRead = (slot) => makeIrProgram({
    ...built.ir, statements: [...built.ir.statements, exprStmt(readGlobal(slot), 1)],
  })

  it('the IR refuses a global read of a slot a FUNCTION owns', () => {
    const owned = built.ir.slots.findIndex((s) => s.owner !== null)
    expect(owned).toBeGreaterThanOrEqual(0)
    expect(() => validateIr(withRead(owned))).toThrow(/which a function owns/)
  })

  it('CONTROL — the same read of a MAIN slot validates', () => {
    const main = built.ir.slots.findIndex((s) => s.owner === null)
    expect(main).toBeGreaterThanOrEqual(0)
    expect(() => validateIr(withRead(main))).not.toThrow()
  })

  it('the program refuses a global address past the MAIN frame, for both kinds', () => {
    const at = (op, a) => () => makeProgram({
      code: [op, a, 0, OP.HALT, 0, 0], consts: [], outputs: [], locals: 1, persists: 1,
    })
    expect(at(OP.LOAD_GLOBAL_LOCAL, 1)).toThrow(/LOAD_GLOBAL_LOCAL 1 outside 1/)
    expect(at(OP.LOAD_GLOBAL_PERSIST, 1)).toThrow(/LOAD_GLOBAL_PERSIST 1 outside 1/)
    expect(at(OP.LOAD_GLOBAL_LOCAL, 0)).not.toThrow()
    expect(at(OP.LOAD_GLOBAL_PERSIST, 0)).not.toThrow()
  })
})
