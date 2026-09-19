// app/src/components/chart/engine/ast/inputWindowsAgreement.test.js
//
// ─── ⭐⭐ R-J — A WINDOW THAT NAMES A MEMBER'S KNOB ─────────────────────────
//
// Owner ruling, 2026-09-12, tied explicitly to R-H: **bound by the folded value
// FOR THIS WAVE.** The justification is entirely the premise, so the premise is a
// constant rather than an assumption living in four readers' heads:
//
//   R-H  a member `input.int` the translator folds becomes an IMMUTABLE
//        parameter baked into the tree
//   ⇒    the folded value is the ONLY value that window can take
//   ⇒    a lookback bounded by it is a promise the badge can keep
//
// ⛔⛔ AND THE DAY THAT PREMISE ENDS, THE BOUND BECOMES A LIE — bounding by a
// default would be false the first time a member raised the knob, which is
// exactly what `ast_lint`'s docstring warned about for months while `lint.js`
// did it anyway. So `INPUTS_ARE_FOLDED` is declared in the manifest, read by both
// lanes, and this file fires BY NAME when it flips.
//
// ⭐ THE REPLACEMENT IS ALREADY WRITTEN DOWN, which is the other half of the
// ruling: `_input_windows.whenRuntime` says `boundByDeclaredMaxval` — bound by
// the input's DECLARED `maxval`, and REFUSE when there is none. Never fall back
// to the default: a default is where the knob starts, and a bound must hold
// everywhere it can reach.
import { describe, it, expect } from 'vitest'
import {
  TABLE, INPUTS_ARE_FOLDED, RUNTIME_INPUT_WINDOW_RULE,
  bindFoldableWindow, usableWindowBound,
} from './parse.js'
import { maxLookback as lintMax } from './lint.js'
import { maxLookback as interpretMax } from './interpret.js'

/** `ta.sma(close, period)` where `period` is a member knob defaulting to 30. */
const KNOB_TREE = {
  type: 'call',
  name: 'sma',
  args: [
    { type: 'series', name: 'close' },
    { type: 'series', name: 'period', inputDefault: 30 },
  ],
}
const KNOB = KNOB_TREE.args[1]

describe('⛔⛔ the premise is a declared constant, and it fires by name when it flips', () => {
  it('⛔⛔ INPUTS_ARE_FOLDED is TRUE — and here is what must happen when it is not', () => {
    expect(INPUTS_ARE_FOLDED,
      'R-J bound a knob-named window by its FOLDED VALUE, and the ONLY thing that '
      + 'makes that honest is R-H: a folded `input.int` is baked into the tree, so '
      + 'the knob cannot move. `_input_windows.inputsAreFolded` is now false, which '
      + 'means a member CAN move it — and every bound this contract hands out is a '
      + 'promise about a value that is no longer fixed.\n\n'
      + 'THE REPLACEMENT IS ALREADY RULED and recorded at '
      + '`closedTable.json::_input_windows.whenRuntime`: bound by the input\'s '
      + 'DECLARED `maxval`, and REFUSE when there is none. ⛔ Never fall back to '
      + 'the default — a default is where the knob starts, and a lookback bound '
      + 'must hold everywhere the knob can reach. Implement that in '
      + '`bindFoldableWindow` and its Python twin, then rewrite this case.')
      .toBe(true)
  })

  it('⭐ the wave-2 rule is ON FILE, so it cannot be quietly re-decided', () => {
    // A ruling recorded nowhere is a ruling the next engineer re-litigates.
    expect(RUNTIME_INPUT_WINDOW_RULE).toBe('boundByDeclaredMaxval')
    const block = TABLE._input_windows
    expect(typeof block._whenRuntime).toBe('string')
    expect(block._whenRuntime).toContain('maxval')
    expect(block._whenRuntime).toContain('REFUSES')
  })

  it('⛔ the constant is READ, not hard-coded — the manifest is the one authority', () => {
    expect(INPUTS_ARE_FOLDED).toBe(TABLE._input_windows.inputsAreFolded === true)
  })
})

describe('⭐ today: all four readers bound a knob-named window by the folded value', () => {
  it('the contract bounds it', () => {
    expect(bindFoldableWindow(KNOB)).toEqual({ foldable: true, max: 30 })
    expect(usableWindowBound(KNOB)).toBe(30)
  })

  it('⭐⭐ and BOTH JS readers answer the same number', () => {
    // ⛔ `lint.js` needs the definition's declared inputs, exactly as
    // `lintDefinition` supplies them — an identifier the definition does not
    // declare is an unknown series and fails closed, which is correct and is a
    // different question from this one.
    expect(lintMax(KNOB_TREE, { inputs: { period: true } })).toBe(30)
    expect(interpretMax(KNOB_TREE)).toBe(30)
  })

  it('⛔⛔ THE CONTROL — the gate is load-bearing, not decorative', () => {
    // Pass the flag off explicitly and the same knob becomes unanalysable. Without
    // this, `INPUTS_ARE_FOLDED` could be deleted from the code path entirely and
    // every assertion above would still pass.
    expect(bindFoldableWindow(KNOB, false)).toEqual({ foldable: false, max: null })
    // …and a ternary OVER a knob folds or refuses with it, rather than half-folding.
    const ternary = {
      type: 'op',
      name: '?:',
      args: [{ type: 'series', name: 'isweekly' }, KNOB, { type: 'num', value: 10 }],
    }
    expect(bindFoldableWindow(ternary, true)).toEqual({ foldable: true, max: 30 })
    expect(bindFoldableWindow(ternary, false)).toEqual({ foldable: false, max: null })
  })

  it('⛔ CONTROL: an UNDECLARED identifier is still unanalysable, flag or no flag', () => {
    // R-J bounds a KNOB, never any bare name. A `series` node with no
    // `inputDefault` is a column or an undeclared identifier and neither has a
    // window this contract can promise anything about.
    const bare = { type: 'series', name: 'somethingElse' }
    expect(bindFoldableWindow(bare)).toEqual({ foldable: false, max: null })
    expect(usableWindowBound(bare)).toBe(null)
  })
})
