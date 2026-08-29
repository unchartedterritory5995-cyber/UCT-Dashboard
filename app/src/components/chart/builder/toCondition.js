// app/src/components/chart/builder/toCondition.js
//
// ─── ⭐⭐ A PASTED INDICATOR IS A COLUMN. THIS IS HOW IT BECOMES A SCREEN. ────
//
// ⛔⛔ THE MEASUREMENT THAT PUT THIS HERE. 41 corpus scripts translate and all 41
// can be SAVED — and only 19 can be RUN AS A SCREEN. 148 translated columns yield
// 49 scannable ones, and every one of the 99 refusals is the same gate: `yields`.
// The tree returns a NUMBER, and a screen needs a CONDITION.
//
// ⛔ THAT GATE IS CORRECT AND NOTHING HERE SOFTENS IT. `<tree> != 0` over a price
// column is true for every symbol trading above zero, so a numeric definition
// admitted as a screen would silently return the universe. This module does not
// bypass `assert_scannable`; it helps a member BUILD A TREE THAT SATISFIES IT.
//
// ⭐ WHICH IS WHAT THE RIVAL PRODUCT DOES. TradingView's Pine Screener never asks
// a script for a boolean: a plot becomes a NUMERIC COLUMN and the member picks the
// operator and the threshold in the screener UI. A pasted `rsi(close, 14)` is a
// perfectly good column — it simply is not a filter until somebody says `< 30`.
// The number stays the script's; the THRESHOLD is the member's, and it is visible
// in the formula they save rather than guessed by us (`_functions_na`'s rule, one
// surface over).
//
// ⚠️ AND THE ARITHMETIC IS WHY THIS IS THE NEXT THING RATHER THAN A NICETY: there
// are 20 OPEN translation gaps, and closing every one of them would add at most 20
// scripts — most of which plot numbers too, and would land in this same bucket.

import { TABLE, parseFormula } from '../engine/ast/parse'
import { treeYieldsBool } from '../engine/ast/pine'
import { interpret } from '../engine/ast/interpret'

/** ⭐⭐ THE COMPARISON OPERATORS, DERIVED — never a list typed here.
 *
 *  ⛔ THE MANIFEST CANNOT ANSWER THIS ON ITS OWN, and that is worth stating rather
 *  than working around silently: it declares `arity` and `yields` per operator, so
 *  `>` and `&&` are INDISTINGUISHABLE — both binary, both `yields: "bool"`. A list
 *  typed here would be a second authority over the operator vocabulary, which is
 *  this repo's most repeated defect.
 *
 *  ⭐ SO THE SPLIT IS DERIVED SEMANTICALLY, FROM THE ENGINE'S OWN ARITHMETIC. A
 *  COMPARISON distinguishes MAGNITUDES; a CONNECTIVE sees only zero vs non-zero.
 *  Probe each binary bool operator with `5 op 3` and `3 op 5` against `1 op 1`:
 *  `&&` and `||` answer the same for all three, every comparison differs on at
 *  least one. Measured, not asserted — and a new comparison added to the manifest
 *  appears here on the day it lands, while a new connective is excluded by the same
 *  rule rather than by somebody remembering to exclude it.
 *
 *  ⚠️ BOTH PROBES ARE NEEDED. `<` answers 0 for `5 < 3` and 0 for `1 < 1` — one
 *  probe alone would file it as a connective and quietly drop the most useful
 *  operator in the set. */
function deriveComparisons() {
  const bars = [{ t: 1700000000, o: 1, h: 1, l: 1, c: 1, v: 1 }]
  // ⚰️ `Array.isArray` IS THE WRONG QUESTION AND IT FAILED SILENTLY. `interpret`
  // answers with a TYPED array, so `Array.isArray` is false, the whole array came
  // back, and every comparison below was between two OBJECT IDENTITIES — always
  // unequal, so all eight binary bool operators were classified as comparisons.
  // ⛔ IT PRINTED CORRECTLY THE WHOLE TIME: a one-element array interpolates as
  // `1`, so the debug output read exactly like the numbers it was supposed to be.
  // What exposed it was `typeof`, not the value. Ask for a LENGTH, not for `Array`.
  const value = (src) => {
    const p = parseFormula(src)
    if (!p.ok) return null
    const col = interpret(p.ast, bars, {})
    const first = (col && typeof col === 'object' && 'length' in col) ? col[0] : col
    return typeof first === 'number' ? first : null
  }
  const out = []
  for (const [op, spec] of Object.entries(TABLE.operators)) {
    if (!spec || spec.arity !== 2 || spec.yields !== 'bool') continue
    const base = value(`1 ${op} 1`)
    const hi = value(`5 ${op} 3`)
    const lo = value(`3 ${op} 5`)
    if (base === null || hi === null || lo === null) continue
    if (hi !== base || lo !== base) out.push(op)
  }
  return Object.freeze(out)
}

export const COMPARISONS = deriveComparisons()

/** How to say each operator to a member. ⚠️ NOT an authority on which operators
 *  exist — a comparison with no entry here falls back to the symbol itself, so a
 *  newly-declared operator is offered (unlabelled) rather than hidden. */
const ENGLISH = Object.freeze({
  '>': 'is above', '<': 'is below', '>=': 'is at or above', '<=': 'is at or below',
  '==': 'equals', '!=': 'is not',
})

export const operatorLabel = (op) => ENGLISH[op] || op

/** Does this formula already answer a screen's question? */
export function yieldsCondition(formula) {
  if (typeof formula !== 'string' || formula.trim() === '') return false
  const p = parseFormula(formula)
  if (!p.ok || !p.ast) return false
  try { return !!treeYieldsBool(p.ast) } catch (e) { return false }
}

/**
 * ⭐ `rsi(close, 14)` + `<` + `30` → `rsi(close, 14) < 30`, and the result is
 * VERIFIED rather than assembled: it is parsed back and asked whether it yields a
 * condition, so this can never hand the scan door a string that looks right and
 * refuses there.
 *
 * ⛔ THE COLUMN IS PARENTHESISED, ALWAYS. `close > open` is already a condition and
 * `a + b` binds looser than `<` — a naive concatenation would silently reassociate
 * somebody's formula. Wrapping costs a pair of brackets in the read-back and
 * removes a whole class of quiet wrongness.
 *
 * @returns {{ok: true, formula: string} | {ok: false, reason: string}}
 */
export function conditionFrom(formula, op, threshold) {
  if (typeof formula !== 'string' || formula.trim() === '') {
    return { ok: false, reason: 'there is no column to turn into a screen' }
  }
  if (!COMPARISONS.includes(op)) {
    return {
      ok: false,
      reason: `\`${op}\` is not a comparison this engine declares — `
        + `${COMPARISONS.join(', ')}`,
    }
  }
  // ⚰️ `Number('')` IS `0`, NOT `NaN`, AND AN EMPTY BOX IS NOT A THRESHOLD.
  // Left to `Number` alone, a member who cleared the field got a screen for
  // "below zero" — a real, saveable, scannable formula that answers nothing on
  // every symbol, and nothing anywhere would have said so. The blank is rejected
  // BEFORE the conversion rather than after it.
  const raw = typeof threshold === 'number' ? threshold : String(threshold == null ? '' : threshold).trim()
  const n = raw === '' ? NaN : Number(raw)
  if (!Number.isFinite(n)) {
    return { ok: false, reason: 'a screen needs a number to compare against' }
  }
  const source = parseFormula(formula)
  if (!source.ok) {
    return { ok: false, reason: 'this column does not read back, so it cannot be compared' }
  }
  const built = `(${formula.trim()}) ${op} ${n}`
  const check = parseFormula(built)
  if (!check.ok || !check.ast) {
    return { ok: false, reason: 'the comparison did not read back' }
  }
  let bool = false
  try { bool = !!treeYieldsBool(check.ast) } catch (e) { bool = false }
  if (!bool) {
    // ⚰️ NOT REACHABLE THROUGH THE UI TODAY, and kept anyway: it is the ONLY thing
    // standing between a future change in `treeYieldsBool` and this module handing
    // the scan door a tree it will refuse. A builder that trusts its own output is
    // how "saveable but not scannable" happened in the first place.
    return { ok: false, reason: 'the comparison still does not answer a screen question' }
  }
  return { ok: true, formula: built }
}
