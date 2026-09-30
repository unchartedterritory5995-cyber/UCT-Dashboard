// app/src/components/chart/engine/runtime/__tests__/declarationPersistence.test.js
//
// ─── ⭐⭐ C21 — A DECLARATION PERSISTS BECAUSE IT SAYS `var`, NOT BECAUSE A NAMESAKE DOES ─
//
// Pine scopes a variable to its function (and to its block), and a function
// local may shadow a global. So `f() => var float x = na` and `g() => float x =
// close` are TWO variables: `f`'s keeps its value from bar to bar, `g`'s is
// declared afresh on every call.
//
// ⚰️ MEASURED 2026-09-30, AND IT WAS A WRONG VALUE, NOT A REFUSAL. The runtime
// lane decided persistence for a plain binding by asking a whole-script set of
// NAMES declared `var` anywhere (`scanMutability(...).persistent`). `g`'s `x`
// became a persistent slot, its initialiser guarded by `JUMP_IF_INIT` — so
// `g()` returned the FIRST bar's close on every bar. Found on
// `dual-view-htf-candlestick-patterns-theultimator5`: `var float htf_o` inside
// `update_drawings`, `float htf_o = get_htf_open(i)` inside
// `detect_pattern_at_index`; the run found 51 candle patterns where
// TradingView drew 43 (see `vendorHarness.c21DualView.test.js`).
//
// ⭐ THE RULE, IN ONE PLACE: `pineRuntimeFrontend.js::declarationPersists`.
// ⭐ AND ITS COMPANION (`lowerIr.js::persistTotal`): a function body is emitted
// whether or not a call site reaches it, so the persistent bound covers every
// function's own frame — `f() => var float x = na` beside `plot(close)` refused
// to lower until then, and lowered only by the accident above.
//
// ⚠️ EXPECTATIONS ARE WRITTEN OUT FROM THE BARS, never "the runtime equals itself".
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr, declarationPersists } from '../../ast/pineRuntimeFrontend.js'
import { lexPine, blockStatements } from '../../ast/pine.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 12
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 50 + i, h: 53 + i, l: 49 + i, c: 51 + i * 2, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const closes = BARS.map((b) => b.c)
const head = '//@version=6\nindicator("t")\n'

function runPine(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o))
}

describe('⭐⭐ C21 — a plain declaration is declared afresh, whatever else shares its name', () => {
  it('⭐ a `var x` in ONE function does not make another function\'s `x` persistent', () => {
    const [out] = runPine(
      'f() =>\n'
      + '    var float x = na\n'
      + '    x\n'
      + 'g() =>\n'
      + '    float x = close\n'
      + '    x\n'
      + 'plot(g())\n')
    // was the FIRST close (51) on every bar
    expect(out).toEqual(closes)
  })

  it('⭐ a `var x` at the TOP LEVEL does not make a function\'s own `x` persistent', () => {
    const [out] = runPine(
      'var float x = na\n'
      + 'g() =>\n'
      + '    float x = close\n'
      + '    x\n'
      + 'plot(g())\n')
    expect(out).toEqual(closes)
  })

  it('⭐ dual-view\'s shape: a `var` inside ANOTHER function\'s loop, and a local of that name', () => {
    const [f, g] = runPine(
      'f() =>\n'
      + '    for i = 0 to 2\n'
      + '        var float x = na\n'
      + '        x := i\n'
      + '    0\n'
      + 'g() =>\n'
      + '    float x = close * 2\n'
      + '    x\n'
      + 'plot(f())\n'
      + 'plot(g())\n')
    expect(f).toEqual(closes.map(() => 0))
    expect(g).toEqual(closes.map((c) => c * 2))
  })

  it('⭐ a block-valued binding (`x = if …`, no else) is declared afresh: `na` where no arm runs', () => {
    // closes rise 51, 53, …, 73; the arm runs while close < 60. A persistent `x`
    // would keep the last close it held; Pine declares it anew — `na`.
    const [out] = runPine(
      'f() =>\n'
      + '    var float x = na\n'
      + '    x\n'
      + 'g() =>\n'
      + '    x = if close < 60\n'
      + '        close\n'
      + '    x\n'
      + 'plot(g())\n')
    expect(out).toEqual(closes.map((c) => (c < 60 ? c : NaN)))
  })

  it('⛔ CONTROL — a real `var` still persists: a counter counts bars, beside a namesake local', () => {
    const [n, g] = runPine(
      'f() =>\n'
      + '    var int x = 0\n'
      + '    x += 1\n'
      + '    x\n'
      + 'g() =>\n'
      + '    int x = 7\n'
      + '    x\n'
      + 'plot(f())\n'
      + 'plot(g())\n')
    expect(n).toEqual(closes.map((_, i) => i + 1))
    expect(g).toEqual(closes.map(() => 7))
  })

  it('⛔ CONTROL — a top-level `var` initialiser runs ONCE (the first bar\'s close, kept)', () => {
    const [out] = runPine('var float x = close\nplot(x)\n')
    expect(out).toEqual(closes.map(() => closes[0]))
  })

  it('⭐ an UNCALLED function holding a `var` lowers and runs (`persistTotal`)', () => {
    const [out] = runPine(
      'f() =>\n'
      + '    var float x = na\n'
      + '    x\n'
      + 'plot(close)\n')
    expect(out).toEqual(closes)
  })

  it('the predicate reads the declaration\'s OWN keyword, and nothing else', () => {
    const headerOf = (line) => {
      const { tokens, indents } = lexPine(`//@version=6\nindicator("t")\n${line}\n`)
      const stmts = blockStatements(tokens, indents, 0)
      return stmts[stmts.length - 1].header
    }
    expect(declarationPersists(headerOf('var float x = na'))).toBe(true)
    expect(declarationPersists(headerOf('var x = 1'))).toBe(true)
    expect(declarationPersists(headerOf('float x = close'))).toBe(false)
    expect(declarationPersists(headerOf('x = close'))).toBe(false)
    expect(declarationPersists([])).toBe(false)
  })
})
