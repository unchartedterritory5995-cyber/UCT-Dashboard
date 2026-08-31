// app/src/components/chart/engine/ast/pine.knob.test.js
//
// ─── ⭐⭐ A PASTED SCRIPT'S LENGTH BECOMES A KNOB AGAIN ──────────────────────
//
// ⛔ THE MEASURED COST OF NOT HAVING THIS: knobs came across on 5 of 51 pasted
// scripts, and ~31 were blocked by the WINDOW ceiling alone. `length =
// input.int(14)` folds to the literal 14 so the tree stays statically decidable —
// right for the maths, wrong for the member, who gets somebody else's constant and
// no way to change it. Every muscle-memory motion a TradingView user has (open the
// gear, drag the length, watch it redraw) was gone on most imports.
//
// ⭐⭐ AND THE TREE STILL HOLDS A LITERAL, WHICH IS THE WHOLE POINT. Nothing about
// static decidability moved: `maxLookback` is still a pure tree sum over literals
// with no evaluation, and the repaint linter still decides statically. The knob does
// not live IN the tree — it lives on the DOCUMENT, and moving it RE-TRANSLATES. A
// different length is a different indicator and gets a different `astHash`, which is
// correct rather than a workaround.
//
// ⭐ TRADINGVIEW DRAWS THE SAME LINE ONE QUALIFIER LOOSER, documented verbatim:
// "length arguments require a 'simple int', 'input int', or 'const int' value; they
// cannot accept 'series int' values."
// (https://www.tradingview.com/pine-script-docs/language/type-system/)
// They forbid a length that varies BAR TO BAR — exactly as we do. They permit one
// fixed before the first bar. This is that permission, reached from the other side:
// we fix it before TRANSLATION rather than before execution.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { parseFormula, astHash } from './parse.js'
import { maxLookback } from './interpret.js'

const SRC = '//@version=5\n'
  + 'indicator("t")\n'
  + 'length = input.int(14, "Length", minval=2, maxval=200)\n'
  + 'plot(ta.sma(close, length))\n'

const formulaOf = (out) => (out.outputs.find((o) => o.formula) || {}).formula

describe('the member sets the length, within the AUTHOR\'s bounds', () => {
  it('⭐⭐ the default still folds exactly as before', () => {
    // ⛔ THE UNTOUCHED PATH FIRST. Every existing caller and every committed corpus
    // digest depends on this being byte-identical when no value is supplied.
    expect(formulaOf(translatePine(SRC))).toBe('sma(close, 14)')
  })

  it('⭐⭐ a member value replaces it, and the tree is an ordinary literal', () => {
    const out = translatePine(SRC, { inputValues: { length: 50 } })
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(formulaOf(out)).toBe('sma(close, 50)')
    // ⭐ THE LOAD-BEARING ASSERTION: the window is a `num` node, so `maxLookback`
    // reads it without evaluating anything. If this ever became an expression the
    // repaint linter would fail closed and the save door would refuse.
    const ast = parseFormula(formulaOf(out)).ast
    expect(ast.args[1].type).toBe('num')
    expect(maxLookback(ast)).toBe(50)
  })

  it('⛔ both ENDS of the author\'s range are reachable', () => {
    expect(formulaOf(translatePine(SRC, { inputValues: { length: 2 } }))).toBe('sma(close, 2)')
    expect(formulaOf(translatePine(SRC, { inputValues: { length: 200 } }))).toBe('sma(close, 200)')
  })

  it('⛔⛔ outside the author\'s bounds REFUSES — it is never clamped', () => {
    // ⭐ CLAMPING WOULD COMPUTE A DIFFERENT INDICATOR UNDER THE MEMBER'S OWN NUMBER,
    // silently, with nothing on the chart announcing the substitution. That is the
    // exact failure this whole engine is built against, so it refuses by name and
    // says whose bounds they are.
    for (const bad of [1, 201, 500, -5]) {
      const out = translatePine(SRC, { inputValues: { length: bad } })
      expect(out.ok, `${bad} was accepted`).toBe(false)
      expect(out.refusal.guard).toBe('pine:input-kind')
      expect(out.refusal.message).toMatch(/author/)
    }
  })

  it('⛔⛔ a non-number refuses — over a THRESHOLD, where nothing downstream saves it', () => {
    // ⚰⚰ THIS TEST WAS GREEN AND THE GUARD IT NAMES NEVER FIRED. It ran over
    // `SRC`, whose input is a WINDOW, so `windowLiteral` refused the zero-bar
    // window downstream and the pass proved only that. Measured against a
    // THRESHOLD, the shipped door answered:
    //
    //     { th: null }  ->  `rsi(close, 14) < 0`   ok: TRUE
    //     { th: [] }    ->  `rsi(close, 14) < 0`   ok: TRUE
    //     { th: false } ->  `rsi(close, 14) < 0`   ok: TRUE
    //     { th: '' }    ->  `rsi(close, 14) < 0`   ok: TRUE
    //     { th: true }  ->  `rsi(close, 14) < 1`   ok: TRUE
    //
    // `Number(null)`, `Number([])`, `Number(false)` and `Number('')` are all `0`,
    // and `0` is finite. A member's RSI-below-30 screen became RSI-below-ZERO:
    // matches nothing, on every symbol, forever, and looks exactly like a quiet
    // market. A fixture that cannot distinguish is not a rail.
    const TH = ['//@version=5', 'indicator("t")', 'th = input.int(30, "Level")',
      'plot(ta.rsi(close, 14) < th ? 1 : 0)', ''].join('\n')
    for (const bad of ['fifty', null, {}, NaN, undefined, [], false, true, '', '   ']) {
      const out = translatePine(TH, { inputValues: { th: bad } })
      expect(out.ok, `${JSON.stringify(String(bad))} was ACCEPTED as a number`).toBe(false)
      expect(out.refusal.guard).toBe('pine:input-kind')
    }
    // ⛔ AND IT DISCRIMINATES: a real zero is a real threshold and must pass.
    expect(formulaOf(translatePine(TH, { inputValues: { th: 0 } })))
      .toBe('rsi(close, 14) < 0 ? 1 : 0')
    expect(formulaOf(translatePine(TH, { inputValues: { th: '0' } })))
      .toBe('rsi(close, 14) < 0 ? 1 : 0')
  })

  it('⛔ …and the same non-numbers still refuse in a WINDOW', () => {
    // The original assertion, kept: it covers the other slot kind, and now it is
    // paired with one that can actually see the guard.
    for (const bad of ['fifty', null, {}, NaN, [], false, '']) {
      expect(translatePine(SRC, { inputValues: { length: bad } }).ok,
        JSON.stringify(String(bad))).toBe(false)
    }
  })

  it('⭐ a different length is a different indicator, and hashes differently', () => {
    // ⚠️ SAID OUT LOUD BECAUSE IT DECIDES DOWNSTREAM BEHAVIOUR. `astHash` is what
    // makes an edit force-migrate bindings and reset `last_value`. Two lengths ARE
    // two indicators, so two hashes is the correct answer, not a side effect to be
    // engineered away.
    const a = astHash(parseFormula(formulaOf(translatePine(SRC, { inputValues: { length: 20 } }))).ast)
    const b = astHash(parseFormula(formulaOf(translatePine(SRC, { inputValues: { length: 21 } }))).ast)
    expect(a).not.toBe(b)
  })

  it('⛔ an unbounded input is still settable — bounds are the author\'s, not required', () => {
    // ⚠️ Most real scripts write `input.int(14, "Length")` with no minval/maxval.
    // Refusing those would make the feature apply to almost nothing.
    const loose = '//@version=5\nindicator("t")\nlen = input.int(14)\nplot(ta.sma(close, len))\n'
    expect(formulaOf(translatePine(loose, { inputValues: { len: 75 } }))).toBe('sma(close, 75)')
  })

  it('⛔ a name that is not an input of this script is ignored, not obeyed', () => {
    // ⚰️ A stale knob from another script must not silently do nothing WORSE than
    // nothing — it must leave the formula exactly as written.
    expect(formulaOf(translatePine(SRC, { inputValues: { notAnInput: 99 } })))
      .toBe('sma(close, 14)')
  })
})
