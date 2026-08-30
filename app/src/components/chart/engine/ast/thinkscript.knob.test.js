// app/src/components/chart/engine/ast/thinkscript.knob.test.js
//
// ─── ⭐⭐ THE OTHER DOOR'S LENGTHS, AND THE SAME ANSWER ──────────────────────
//
// ⛔⛔ THE PINE DOOR TOOK A MEMBER'S VALUE AND THIS ONE DID NOT, so "we took your
// script" meant two different things depending on where the script came from.
// Measured on the committed corpus: 6 of the 10 thinkScript studies that
// translate fold 22 inputs between them, and not one reached the member — this
// lane never went through `memberInputTranslation`, so the paste box did not even
// NAME them. A length frozen at somebody else's number with nothing on screen
// saying so is the "formula that means something other than the script the member
// reads" this engine exists against, and it was the QUIETER of the two doors.
//
// ⭐ THE SEMANTICS ARE DELIBERATELY PINE'S — `pine.knob.test.js` is the twin of
// this file and the assertions are matched on purpose, because one product cannot
// answer two ways about whose number is in the formula. What differs is only what
// the LANGUAGE offers: thinkorswim's `input` declares no `minval`/`maxval`, so
// there are no author bounds to honour and this door invents none.
//
// ⛔ THE TREE STILL HOLDS A LITERAL, exactly as it does on the Pine side: the
// value is frozen BEFORE translation, so `maxLookback` stays a pure tree sum over
// `num` nodes with nothing evaluated and the repaint linter still decides
// statically.

import { describe, it, expect } from 'vitest'

import { translateThinkScript } from './thinkscript.js'
import { parseFormula, astHash } from './parse.js'
import { maxLookback } from './interpret.js'

const SRC = 'input length = 14;\nplot x = Average(close, length);\n'

const formulaOf = (out) => (out.outputs.find((o) => o.formula) || {}).formula

describe('a thinkScript study takes the member\'s own lengths', () => {
  it('⭐⭐ the default still folds exactly as before', () => {
    // ⛔ THE UNTOUCHED PATH FIRST. Every existing caller, every committed corpus
    // digest and every saved definition depends on this being byte-identical when
    // no value is supplied.
    expect(formulaOf(translateThinkScript(SRC))).toBe('sma(close, 14)')
  })

  it('⭐⭐ a member value replaces it, and the tree is an ordinary literal', () => {
    const out = translateThinkScript(SRC, { inputValues: { length: 50 } })
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(formulaOf(out)).toBe('sma(close, 50)')
    // ⭐ THE LOAD-BEARING ASSERTION, and it is the same one the Pine twin makes:
    // the window is a `num` node, so `maxLookback` reads it without evaluating
    // anything. If this ever became an expression the save door would refuse it.
    const ast = parseFormula(formulaOf(out)).ast
    expect(ast.args[1].type).toBe('num')
    expect(maxLookback(ast)).toBe(50)
  })

  it('⛔⛔ every input is settable INDEPENDENTLY — the half-applied trap', () => {
    // ⚠️ `02-macd-lookback-cross-watchlist` folds FIVE inputs and three of them are
    // lengths. A door that applied only the first would look correct on a
    // one-input study and silently half-apply on a real one; a door that moved
    // them together would be worse still, because nothing on screen says which
    // number the member actually chose.
    const src = ['input fastLength = 12;', 'input slowLength = 26;',
      'plot m = ExpAverage(close, fastLength) - ExpAverage(close, slowLength);', ''].join('\n')
    expect(formulaOf(translateThinkScript(src))).toBe('ema(close, 12) - ema(close, 26)')
    expect(formulaOf(translateThinkScript(src,
      { inputValues: { fastLength: 5, slowLength: 34 } }))).toBe('ema(close, 5) - ema(close, 34)')
    // ⛔ ONE OF TWO: the other input must keep the AUTHOR's number.
    expect(formulaOf(translateThinkScript(src, { inputValues: { fastLength: 5 } })))
      .toBe('ema(close, 5) - ema(close, 26)')
  })

  it('⛔⛔ a non-number refuses — over a THRESHOLD, where nothing downstream saves it', () => {
    // ⚰️⚰️ THE TWIN'S OWN RAIL WAS GREEN WITH ITS GUARD UNFIRED. `pine.knob.test.js`
    // asserted this over a fixture whose input is a WINDOW, so `windowLiteral`
    // refused the zero-bar window downstream and the pass proved only that.
    // Measured against a THRESHOLD, the shipped Pine door answered `ok: true` for
    // `null`, `[]`, `false`, `''` and `'   '` — all of which `Number()` turns into
    // `0` — so an RSI-below-30 screen became RSI-below-ZERO. This lane is written
    // against a threshold from the start so it cannot inherit that blind spot.
    // ⚠️ THE FULLY-ARGUMENTED `RSI` CALL, AND THAT MATTERS. `RSI(14)` refuses
    // `thinkscript:arity` on its own — thinkorswim publishes no default for
    // `price` — so a fixture written that way refuses whatever is passed, and the
    // "a real zero is admitted" half below could never have distinguished. That is
    // the identical defect this test exists to fix, one level up; it was caught
    // here only because that half was written at all.
    const TH = ['input level = 30;',
      'plot x = if RSI(length = 14, price = close) < level then 1 else 0;', ''].join('\n')
    expect(translateThinkScript(TH).ok, 'the fixture itself must translate').toBe(true)
    for (const bad of ['fifty', null, {}, NaN, undefined, [], false, true, '', '   ']) {
      const out = translateThinkScript(TH, { inputValues: { level: bad } })
      expect(out.ok, `${JSON.stringify(String(bad))} was ACCEPTED as a number`).toBe(false)
      expect(out.refusal.guard).toBe('thinkscript:input-kind')
    }
    // ⛔ AND IT DISCRIMINATES: a real zero is a real threshold, in both spellings.
    expect(translateThinkScript(TH, { inputValues: { level: 0 } }).ok).toBe(true)
    expect(translateThinkScript(TH, { inputValues: { level: '0' } }).ok).toBe(true)
  })

  it('⛔ …and the same non-numbers still refuse in a WINDOW', () => {
    for (const bad of ['fifty', null, {}, NaN, [], false, '']) {
      expect(translateThinkScript(SRC, { inputValues: { length: bad } }).ok,
        JSON.stringify(String(bad))).toBe(false)
    }
  })

  it('⛔⛔ an input whose default is NOT a number refuses BY NAME, never silently', () => {
    // ⚰️ THE TRAP THIS EXISTS FOR. `input averageType = AverageType.WILDERS` and
    // `input price = close` are folded inputs like any other. Quietly ignoring a
    // number aimed at one would show the member a formula that is not the one they
    // asked for, with nothing saying which half of their request was dropped.
    for (const [decl, use] of [
      ['input averageType = AverageType.WILDERS;', 'plot x = RSI(14, 70, 30, close, averageType);'],
      ['input price = close;', 'plot x = Average(price, 14);'],
    ]) {
      const out = translateThinkScript(`${decl}\n${use}\n`,
        { inputValues: { averageType: 3, price: 3 } })
      expect(out.ok, decl).toBe(false)
      expect(out.refusal.guard).toBe('thinkscript:input-kind')
      expect(out.refusal.message).toMatch(/not a numeric input/)
    }
  })

  it('⛔ an ENUM input refuses too — the arm is a choice, not a number', () => {
    // ⛔ THE GUARD SITS ABOVE THE ENUM ARM FOR THIS CASE. Below it, the override
    // would fall through and be silently ignored — the one answer that is never
    // right.
    const out = translateThinkScript(
      'input mode = {default First, Second};\nplot x = if mode == mode.First then close else low;\n',
      { inputValues: { mode: 2 } })
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('thinkscript:input-kind')
  })

  it('⛔ a name that is not an input of this study is ignored, not obeyed', () => {
    // ⚰️ A stale knob from another script must leave the formula exactly as
    // written — the same contract the Pine twin holds.
    expect(formulaOf(translateThinkScript(SRC, { inputValues: { notAnInput: 99 } })))
      .toBe('sma(close, 14)')
  })

  it('⭐ a different length is a different indicator, and hashes differently', () => {
    const h = (n) => astHash(parseFormula(
      formulaOf(translateThinkScript(SRC, { inputValues: { length: n } }))).ast)
    expect(h(20)).not.toBe(h(21))
  })

  it('⭐ the fold RECORDS the member\'s number, so the box can read back what ran', () => {
    const out = translateThinkScript(SRC, { inputValues: { length: 50 } })
    const folded = out.outputs.find((o) => o.formula).inputsFolded
    expect(folded).toEqual([expect.objectContaining({ name: 'length', folded: '50' })])
  })
})
