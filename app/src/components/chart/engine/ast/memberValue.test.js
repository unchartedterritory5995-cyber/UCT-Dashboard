// app/src/components/chart/engine/ast/memberValue.test.js
//
// ─── ⛔⛔ THE COERCION TABLE, WRITTEN OUT ─────────────────────────────────────
//
// ⚰️ THIS MODULE EXISTS BECAUSE `Number.isFinite(Number(v))` SHIPPED AS THE TEST
// FOR "is this a number the member supplied", AND IT IS WRONG FOR SIX VALUES.
// Measured against the live Pine door before the fix:
//
//     { th: null }  ->  `rsi(close, 14) < 0`   ok: TRUE
//     { th: [] }    ->  `rsi(close, 14) < 0`   ok: TRUE
//     { th: false } ->  `rsi(close, 14) < 0`   ok: TRUE
//     { th: '' }    ->  `rsi(close, 14) < 0`   ok: TRUE
//     { th: '  ' }  ->  `rsi(close, 14) < 0`   ok: TRUE
//     { th: true }  ->  `rsi(close, 14) < 1`   ok: TRUE
//
// An RSI-below-30 screen became RSI-below-ZERO: it matches nothing, on every
// symbol, forever, and reads exactly like a quiet market.
//
// ⛔ BOTH DOORS DRIVE THIS THROUGH THEIR OWN KNOB TESTS, and this file is still
// worth having: those go through a translator, so a change to the predicate that
// happened to be masked by a downstream guard (which is precisely how the defect
// survived) would look fine there. This asks the question directly, as a table, so
// the answer cannot be rescued by anything.

import { describe, it, expect } from 'vitest'

import { memberNumber, isNumericText } from './memberValue.js'

describe('memberNumber — is this a number, not can it be coerced into one', () => {
  it('⭐ a finite number is itself, including the ones that read as falsy', () => {
    // ⛔ ZERO AND NEGATIVE ZERO ARE REAL THRESHOLDS. A caller testing the result
    // for truthiness rather than for `null` would throw away the value a
    // threshold most often wants, so the contract is `=== null` and this pins it.
    for (const n of [0, -0, 1, -5, 3.25, 1e9, Number.MIN_SAFE_INTEGER]) {
      expect(memberNumber(n), String(n)).toBe(n)
    }
  })

  it('⭐ a string that is ENTIRELY a number is admitted — number fields hand back strings', () => {
    expect(memberNumber('0')).toBe(0)
    expect(memberNumber('14')).toBe(14)
    expect(memberNumber(' 21 ')).toBe(21)
    expect(memberNumber('-3.5')).toBe(-3.5)
    expect(memberNumber('1e3')).toBe(1000)
  })

  it('⛔⛔ every value `Number()` silently turns into 0 or 1 is REFUSED', () => {
    // ⚰️ THE SIX MEASURED SHAPES, PLUS THE REST OF THE FAMILY.
    for (const bad of [null, undefined, '', '   ', '\n', [], false, true, {}, NaN,
      Infinity, -Infinity, '14px', 'fifty', '1,000', () => 14, Symbol.iterator]) {
      expect(memberNumber(bad), `${String(bad)} was ACCEPTED`).toBe(null)
    }
  })

  it('⛔ an empty array is 0 and a one-element array is its element — both refused', () => {
    // ⭐ NAMED SEPARATELY BECAUSE IT IS THE LEAST OBVIOUS ONE. `Number([])` is 0
    // and `Number([14])` is 14, so a coercing predicate would take a LIST as a
    // length and answer confidently.
    expect(memberNumber([])).toBe(null)
    expect(memberNumber([14])).toBe(null)
  })
})

describe('isNumericText — is a translator\'s printed default a number', () => {
  it('⭐ the folds a member may replace', () => {
    for (const t of ['14', '2.5', '0', '-1', '126']) expect(isNumericText(t), t).toBe(true)
  })

  it('⛔ …and the folds that are NOT numbers, which is what it exists to catch', () => {
    // These are real `inputsFolded` values from the committed corpora: a source
    // input folds to a column, an average-type input folds to a name. A number
    // field seeded with either is a control nobody can use, and a number aimed at
    // one is refused BY NAME by both translators.
    for (const t of ['close', '(high + low) / 2', 'AverageType.WILDERS',
      'AverageType.EXPONENTIAL', '', null, undefined]) {
      expect(isNumericText(t), String(t)).toBe(false)
    }
  })

  it('⛔ it is the SAME question as memberNumber, not a second opinion', () => {
    // ⚠️ A second predicate would let the box offer a field the translator then
    // refuses, or hide one it would have taken.
    for (const v of ['14', 'close', '', null, 0, [], false, '  ', 'AverageType.WILDERS']) {
      expect(isNumericText(v)).toBe(memberNumber(v) !== null)
    }
  })
})
